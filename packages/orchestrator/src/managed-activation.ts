import { Context, Effect, Exit, Layer, Match, Queue } from "effect"
import { ActivationCause, makeActivationCoordinator, type OwnedTransitionExecution } from "./activation-coordinator.js"
import { type OperationId, type ProviderObservationId, RunId, type TaskId, type TaskWorkCapacity } from "./domain.js"
import { makeRecoveredImplementationConvergenceStages } from "./implementation-convergence-recovery.js"
import type { FreshImplementationConvergenceStageError } from "./implementation-convergence-stage.js"
import { JournalStore, type JournalStoreError } from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontier,
  type RunnableFrontierTransition
} from "./runnable-frontier.js"
import { recoverRunnableTransition } from "./runnable-transition-recovery.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "./selected-transition.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { TaskExecutor } from "./task-execution.js"
import type { TraceOutputError } from "./trace-output.js"
import type { WorkflowInterpreter, WorkflowInterpreterService, WorkflowTrace } from "./workflow.js"

type InterpreterOperation = WorkflowInterpreterService[keyof WorkflowInterpreterService]

type InvalidManagedHistory = Extract<
  ReturnType<typeof reduceManagedHistory>,
  { readonly _tag: "InvalidManagedHistory" }
>

export type ManagedRecoveryActivationError =
  | Effect.Error<ReturnType<InterpreterOperation>>
  | FreshImplementationConvergenceStageError
  | InvalidManagedHistory
  | JournalStoreError
  | TraceOutputError

export interface RecoveredAdmissionCapacityEvidence {
  readonly freshOccupiedInvocations: ReadonlyArray<{
    readonly observationId: ProviderObservationId
    readonly operationId: OperationId
    readonly taskId: TaskId
  }>
  readonly freshlyReleasedOperationIds: ReadonlySet<OperationId>
}

const noRecoveredAdmissionCapacityEvidence = {
  freshOccupiedInvocations: [],
  freshlyReleasedOperationIds: new Set()
} satisfies RecoveredAdmissionCapacityEvidence

/**
 * Reads current execution-provider evidence for each unresolved execution.
 * A proved absence can free its retained position; unreadable or ambiguous
 * evidence fails closed through the provider's typed error/result.
 */
export const observeRecoveredAdmissionCapacity = Effect.fn(
  "ManagedActivation.observeRecoveredAdmissionCapacity"
)(function*(runId: RunId) {
  const journal = yield* JournalStore
  const executor = yield* TaskExecutor
  const reduction = reduceManagedHistory(runId, yield* journal.read(runId))
  if (reduction._tag === "InvalidManagedHistory") {
    return yield* Effect.fail(reduction)
  }
  const records = reduction.managedRun.workflowHistory.records
  const observations = yield* Effect.forEach(
    reduction.managedRun.responsibility.entries,
    (responsibility) => {
      if (
        responsibility._tag !== "TaskExecutionResponsibility"
        || responsibility.operation.request.session._tag !== "EstablishedSession"
        || records.some(({ event }) =>
          event._tag === "TaskExecutionOutcomeObserved"
          && event.outcome.outcome.operationId
            === responsibility.operation.request.operationId
        )
      ) return Effect.succeed(undefined)
      return executor.observeTaskExecution({
        operationId: responsibility.operation.request.operationId,
        plannedAttempt: responsibility.operation.request.plannedAttempt,
        sessionId: responsibility.operation.request.session.sessionId
      }).pipe(
        Effect.map((report) => ({ report, responsibility }))
      )
    },
    { concurrency: "unbounded" }
  )
  return {
    freshOccupiedInvocations: observations.flatMap((observation) =>
      observation?.report._tag === "RunningTaskExecutionReported"
        ? [{
          observationId: observation.report.observationId,
          operationId: observation.responsibility.operation.request.operationId,
          taskId: observation.responsibility.taskId
        }]
        : []
    ),
    freshlyReleasedOperationIds: new Set(
      observations.flatMap((observation) =>
        observation?.report._tag === "NoTaskExecutionReported"
          ? [observation.responsibility.operation.request.operationId]
          : []
      )
    )
  } satisfies RecoveredAdmissionCapacityEvidence
})

const readRecoveredFrontier = Effect.fn("ManagedActivation.readRecoveredFrontier")(
  function*(runId: RunId) {
    const journal = yield* JournalStore
    const reduction = reduceManagedHistory(runId, yield* journal.read(runId))
    if (reduction._tag === "InvalidManagedHistory") {
      return yield* Effect.fail(reduction)
    }
    const records = reduction.managedRun.workflowHistory.records
    const isUnresolved = (
      responsibility: typeof reduction.managedRun.responsibility.entries[number]
    ): boolean =>
      Match.value(responsibility).pipe(
        Match.tags({
          ImplementationEvidenceResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "ImplementationEvidenceSealed"
              && event.operationId === operation.operationId
            ),
          ImplementationReviewResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "ImplementationReviewCompleted"
              && event.review.manifest.operationId
                === operation.request.operationId
            ),
          ReviewFindingsHandbackResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "ReviewFindingsHandbackCompleted"
              && event.acknowledgement.operationId
                === operation.request.operationId
            ),
          TaskClaimResponsibility: ({ acquisition }) =>
            !records.some(({ event }) =>
              event._tag === "TaskClaimAcquired"
              && event.claim.operationId === acquisition.operationId
            ),
          TaskExecutionResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "TaskExecutionOutcomeObserved"
              && event.outcome.outcome.operationId
                === operation.request.operationId
            ),
          TaskWorkSessionResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "TaskWorkSessionEstablished"
              && event.outcome.operationId === operation.request.operationId
            ),
          TaskWorktreeResponsibility: ({ operation }) =>
            !records.some(({ event }) =>
              event._tag === "TaskWorktreeReady"
              && event.operationId === operation.operationId
            )
        }),
        Match.exhaustive
      )
    return deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: reduction.managedRun.responsibility,
      responsibilityFacts: reduction.managedRun.responsibility.entries.map(
        (responsibility) => ({
          disposition: isUnresolved(responsibility)
            ? ResponsibilityDisposition.Ready()
            : ResponsibilityDisposition.Settled({
              outcome: "ResponsibilityCompleted"
            }),
          responsibility
        })
      )
    })
  }
)

// eslint-disable-next-line functional/no-mixed-types -- The source pairs immutable reconstruction inputs with their exact recovered operation.
interface ManagedRecoveryActivationService {
  /**
   * Identifies whether activation is attached to an authoritative journal run
   * or is the explicit synthetic source used by non-journaled compositions.
   */
  readonly composition:
    | { readonly _tag: "AuthoritativeManagedRun"; readonly runId: RunId }
    | { readonly _tag: "SyntheticFreshOnly"; readonly runId: RunId }
  readonly capacityEvidence: RecoveredAdmissionCapacityEvidence
  readonly readFrontier: Effect.Effect<
    RunnableFrontier,
    ManagedRecoveryActivationError,
    never
  >
  readonly reconstructedReservedPositions: ReadonlyArray<{
    readonly operationId: OperationId
    readonly taskId: TaskId
  }>
  readonly runTransition: (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) => Effect.Effect<void, ManagedRecoveryActivationError, never>
}

/**
 * Current-run recovered work source. It owns no selector, admission controller,
 * or runner; a caller composes these transitions into its one activation loop.
 */
export class ManagedRecoveryActivation extends Context.Service<
  ManagedRecoveryActivation,
  ManagedRecoveryActivationService
>()("@dalph/ManagedRecoveryActivation") {}

/** Explicit fresh-only composition for dry-run and deterministic tests. */
export const emptyManagedRecoveryActivationLayer = Layer.succeed(
  ManagedRecoveryActivation,
  ManagedRecoveryActivation.of({
    composition: {
      _tag: "SyntheticFreshOnly",
      runId: RunId.make("fresh-only-activation")
    },
    capacityEvidence: noRecoveredAdmissionCapacityEvidence,
    readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
    reconstructedReservedPositions: [],
    runTransition: () => Effect.die("fresh-only activation cannot execute a recovered transition")
  })
)

export const makeManagedRecoveryActivation = Effect.fn(
  "ManagedActivation.makeRecoverySource"
)(function*(
  runId: RunId,
  capacityEvidence: RecoveredAdmissionCapacityEvidence = noRecoveredAdmissionCapacityEvidence
) {
  const dependencies = yield* Effect.context<
    JournalStore | WorkflowInterpreter | WorkflowTrace
  >()
  const provideDependencies = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      JournalStore | WorkflowInterpreter | WorkflowTrace
    >
  ): Effect.Effect<A, E> => Effect.provide(effect, dependencies)
  const initial = yield* readRecoveredFrontier(runId)
  const reconstructedReservedPositions = initial.transitions.flatMap(
    (transition) =>
      "operationId" in transition
        && (
          transition._tag === "ContinueTaskExecution"
          || transition._tag === "ContinueImplementationReview"
          || transition._tag === "ContinueReviewFindingsHandback"
        )
        && !capacityEvidence.freshlyReleasedOperationIds.has(
          transition.operationId
        )
        ? [{ operationId: transition.operationId, taskId: transition.taskId }]
        : []
  )
  const readFrontier = Effect.fn(
    "ManagedActivation.readActivationFrontier"
  )(function*() {
    const recovered = yield* readRecoveredFrontier(runId)
    const reconstructedStages = yield* makeRecoveredImplementationConvergenceStages(runId, false)
    return {
      explanations: recovered.explanations,
      transitions: [
        ...recovered.transitions,
        ...reconstructedStages.map(({ transition }) => transition)
      ]
    }
  })
  const runTransition = Effect.fn("ManagedActivation.runTransition")(
    function*(
      transition: RunnableFrontierTransition,
      recordIntent: (operationId: OperationId) => Effect.Effect<void>
    ) {
      const selectedKey = selectedTransitionKey(
        makeSelectedTransitionIdentity(runId, transition)
      )
      const stage = (
        yield* makeRecoveredImplementationConvergenceStages(runId, false)
      ).find(
        (candidate) =>
          selectedTransitionKey(
            makeSelectedTransitionIdentity(runId, candidate.transition)
          ) === selectedKey
      )
      if (stage === undefined) {
        yield* recoverRunnableTransition(runId, transition)
        return
      }
      yield* stage.run(recordIntent)
    }
  )
  return ManagedRecoveryActivation.of({
    composition: { _tag: "AuthoritativeManagedRun", runId },
    capacityEvidence,
    readFrontier: provideDependencies(readFrontier()),
    reconstructedReservedPositions,
    runTransition: (transition, execution) =>
      provideDependencies(
        runTransition(transition, execution.recordIntent)
      )
  })
})

/**
 * Routes every already-intended recovered responsibility through the same
 * serial selector/admission/ownership loop used by fresh activation.
 */
export const activateRecoveredResponsibilities = Effect.fn(
  "ManagedActivation.activateRecoveredResponsibilities"
)(function*(
  runId: RunId,
  capacity: TaskWorkCapacity,
  capacityEvidence: RecoveredAdmissionCapacityEvidence = noRecoveredAdmissionCapacityEvidence
) {
  const recovery = yield* makeManagedRecoveryActivation(
    runId,
    capacityEvidence
  )
  const admissionController = yield* makeTaskAdmissionController({
    capacity,
    freshOccupiedInvocations: capacityEvidence.freshOccupiedInvocations,
    freshlyReleasedOperationIds: capacityEvidence.freshlyReleasedOperationIds,
    reconstructedReservedPositions: recovery.reconstructedReservedPositions
  })
  const completed = yield* Queue.unbounded<Exit.Exit<void, unknown>>()

  yield* Effect.scoped(Effect.gen(function*() {
    const coordinator = yield* makeActivationCoordinator({
      admissionController,
      readFrontier: recovery.readFrontier,
      runId,
      runTransition: (transition, execution) =>
        Effect.gen(function*() {
          const exit = yield* recovery.runTransition(
            transition,
            execution
          ).pipe(Effect.exit)
          yield* Queue.offer(completed, exit)
          if (Exit.isFailure(exit)) {
            return yield* Effect.failCause(exit.cause)
          }
        })
    })

    for (;;) {
      yield* coordinator.signal(ActivationCause.Restart())
      if ((yield* recovery.readFrontier).transitions.length === 0) {
        return
      }
      const completion = yield* Queue.take(completed)
      if (Exit.isFailure(completion)) {
        return yield* Effect.failCause(completion.cause)
      }
    }
  }))
})
