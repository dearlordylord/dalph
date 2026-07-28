import { Clock, Context, Duration, Effect, Exit, Layer, Match, Option, Queue } from "effect"
import { ActivationCause, makeActivationCoordinator, type OwnedTransitionExecution } from "./activation-coordinator.js"
import { OperationId, TechnicalRetryNotBefore } from "./domain.js"
import type {
  ExecutorOuterInvocationId as ExecutorOuterInvocationIdType,
  ProviderObservationId,
  RunId,
  TaskId,
  TaskWorkCapacity
} from "./domain.js"
import { executorOuterInvocationIdForOperation } from "./executor-boundary.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import { JournalStore, type JournalStoreError } from "./journal-store.js"
import { managedHistoryTransitionRuleFor } from "./managed-history-transition.js"
import { reduceManagedHistory } from "./managed-history.js"
import { workflowResponsibilityOperationId } from "./reconstructed-managed-run-state.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontier,
  type RunnableFrontierTransition
} from "./runnable-frontier.js"
import { recoverRunnableTransition } from "./runnable-transition-recovery.js"
import {
  makeRecoveredSelectedExecutorStages,
  recoverSelectedExecutorInvocation,
  selectedExecutorProjectionFor,
  type SelectedExecutorStageError,
  selectedExecutorTaskExecutionLookup
} from "./selected-executor-protocol.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "./selected-transition.js"
import {
  makeTaskAdmissionController,
  type MultipleLatestExecutorReportsForTask,
  type MultipleUnfinishedExecutorInvocationsForTask,
  unfinishedRecordedExecutorInvocationsFor,
  validateCurrentTaskCapacityFacts
} from "./task-admission-controller.js"
import { type TaskExecutionReport, TaskExecutor } from "./task-execution.js"
import type { WorkflowInterpreter, WorkflowInterpreterService, WorkflowTrace } from "./workflow.js"

/**
 * Transitional #158 composition warning:
 * this generic module still imports the concrete review-loop adapter and
 * consumes its internal operation identities. Do not copy this dependency
 * into new generic code. #158 replaces it with an injected executor bundle
 * that emits one normalized outer lifecycle.
 */
type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]: Effect.Error<
    ReturnType<WorkflowInterpreterService[Key]>
  >
}[keyof WorkflowInterpreterService]

type InvalidManagedHistory = Extract<
  ReturnType<typeof reduceManagedHistory>,
  { readonly _tag: "InvalidManagedHistory" }
>

export type ManagedRecoveryActivationError =
  | SelectedExecutorStageError
  | InvalidManagedHistory
  | InterpreterError
  | JournalStoreError
  | MultipleUnfinishedExecutorInvocationsForTask
  | MultipleLatestExecutorReportsForTask

export interface RecoveredAdmissionCapacityEvidence {
  readonly latestExecutorActiveReports: ReadonlyArray<{
    readonly observationId: ProviderObservationId
    readonly invocationId: ExecutorOuterInvocationIdType
    readonly taskId: TaskId
  }>
  readonly freshlyReleasedInvocationIds: ReadonlySet<ExecutorOuterInvocationIdType>
}

const noRecoveredAdmissionCapacityEvidence = {
  latestExecutorActiveReports: [],
  freshlyReleasedInvocationIds: new Set()
} satisfies RecoveredAdmissionCapacityEvidence

const noOccupiedInvocations = (): RecoveredAdmissionCapacityEvidence["latestExecutorActiveReports"] => []
const noOperationIds = (): ReadonlyArray<OperationId> => []
const noOuterInvocationIds = (): ReadonlyArray<ExecutorOuterInvocationIdType> => []
const releasedInvocationId = (report: TaskExecutionReport): ReadonlyArray<ExecutorOuterInvocationIdType> =>
  report._tag === "RunningTaskExecutionReported"
    || report._tag === "AmbiguousTaskExecutionReported"
    || report._tag === "TaskExecutionSessionConflictReported"
    ? []
    : [executorOuterInvocationIdForOperation(report.operationId)]

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
  const settledExecutionOperationIds = new Set(
    records.flatMap(({ event }) =>
      Match.value(event).pipe(
        Match.tag("TaskExecutionOutcomeObserved", ({ outcome }) => [
          outcome.outcome.operationId
        ]),
        Match.orElse(noOperationIds)
      )
    )
  )
  const observations = yield* Effect.forEach(
    reduction.managedRun.responsibility.entries,
    (responsibility) => {
      if (responsibility._tag !== "ExecutorInvocationResponsibility") {
        return Effect.succeed(undefined)
      }
      const invocationId = responsibility.invocation.correlation.invocationId
      const lookup = selectedExecutorTaskExecutionLookup(
        records,
        OperationId.make(invocationId)
      )
      if (
        lookup === undefined
        || settledExecutionOperationIds.has(OperationId.make(invocationId))
      ) return Effect.succeed(undefined)
      return executor.observeTaskExecution(lookup).pipe(
        Effect.map((report) => ({ report, responsibility }))
      )
    },
    { concurrency: "unbounded" }
  )
  return {
    latestExecutorActiveReports: observations.flatMap((observation) =>
      Option.match(Option.fromUndefinedOr(observation), {
        onNone: noOccupiedInvocations,
        onSome: (candidate) =>
          Match.value(candidate.report).pipe(
            Match.tag("RunningTaskExecutionReported", (report) => [{
              invocationId: executorOuterInvocationIdForOperation(report.operationId),
              observationId: report.observationId,
              taskId: candidate.responsibility.invocation.correlation.taskId
            }]),
            Match.orElse(noOccupiedInvocations)
          )
      })
    ),
    freshlyReleasedInvocationIds: new Set(
      observations.flatMap((observation) =>
        Option.match(Option.fromUndefinedOr(observation), {
          onNone: noOuterInvocationIds,
          onSome: ({ report }) => releasedInvocationId(report)
        })
      )
    )
  } satisfies RecoveredAdmissionCapacityEvidence
})

const readRecoveredFrontier = Effect.fn("ManagedActivation.readRecoveredFrontier")(
  function*(runId: RunId) {
    const journal = yield* JournalStore
    const reduction = reduceManagedHistory(runId, yield* journal.read(runId))
    if (reduction._tag === "InvalidManagedHistory") return yield* Effect.fail(reduction)
    const records = reduction.managedRun.workflowHistory.records
    const now = TechnicalRetryNotBefore.make(
      yield* Clock.currentTimeMillis
    )
    const settledOperationIds = new Set(records.flatMap(({ event }) => {
      const transition = managedHistoryTransitionRuleFor(event._tag)
      const descriptor = describeJournalEvent(event)
      return (
          transition?._tag === "Outcome"
          || transition?._tag === "ProviderOutcome"
        )
          && descriptor._tag === "OperationEventDescriptor"
        ? [descriptor.operationId]
        : []
    }))
    const dispositionFor = (
      responsibility: typeof reduction.managedRun.responsibility.entries[number]
    ) => {
      if (responsibility._tag === "ExecutorInvocationResponsibility") {
        const projection = selectedExecutorProjectionFor(
          records,
          responsibility.invocation,
          now
        )
        return projection._tag === "Ready"
          ? ResponsibilityDisposition.Ready()
          : projection._tag === "Waiting"
          ? ResponsibilityDisposition.ExecutorInvocationWait({
            wait: projection.wait
          })
          : ResponsibilityDisposition.ExecutorInvocationSettled({
            outcome: projection.outcome
          })
      }
      return !settledOperationIds.has(
          workflowResponsibilityOperationId(responsibility)
        )
        ? ResponsibilityDisposition.Ready()
        : ResponsibilityDisposition.Settled({
          outcome: "ResponsibilityCompleted"
        })
    }
    const responsibilityFacts = reduction.managedRun.responsibility.entries.map(
      (responsibility) => ({
        disposition: dispositionFor(responsibility),
        responsibility
      })
    )
    yield* validateCurrentTaskCapacityFacts(responsibilityFacts)
    const frontier = deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: reduction.managedRun.responsibility,
      responsibilityFacts
    })
    return {
      ...frontier,
      unfinishedRecordedExecutorInvocationsFor: unfinishedRecordedExecutorInvocationsFor(responsibilityFacts)
    }
  }
)

interface ManagedActivationSource {
  readonly capacityEvidence: RecoveredAdmissionCapacityEvidence
  readonly readFrontier: Effect.Effect<
    RunnableFrontier,
    ManagedRecoveryActivationError,
    never
  >
  readonly unfinishedRecordedExecutorInvocations: ReadonlyArray<{
    readonly invocationId: ExecutorOuterInvocationIdType
    readonly taskId: TaskId
  }>
  readonly waitForNextExecutorWake: Effect.Effect<
    boolean,
    ManagedRecoveryActivationError,
    never
  >
}

/** A journal-backed source can execute recovered transitions for its exact run. */
// eslint-disable-next-line functional/no-mixed-types -- The discriminated source carries the exact run and its sole recovered-transition capability.
interface AuthoritativeManagedRunActivation extends ManagedActivationSource {
  readonly _tag: "AuthoritativeManagedRunActivation"
  readonly runId: RunId
  readonly runTransition: (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) => Effect.Effect<void, ManagedRecoveryActivationError, never>
}

/** A non-journaled composition has no recovered-transition capability. */
interface SyntheticFreshOnlyActivation extends ManagedActivationSource {
  readonly _tag: "SyntheticFreshOnlyActivation"
}

type ManagedRecoveryActivationService =
  | AuthoritativeManagedRunActivation
  | SyntheticFreshOnlyActivation

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
    _tag: "SyntheticFreshOnlyActivation",
    capacityEvidence: noRecoveredAdmissionCapacityEvidence,
    readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
    unfinishedRecordedExecutorInvocations: [],
    waitForNextExecutorWake: Effect.succeed(false)
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
  const unfinishedRecordedExecutorInvocations = initial.unfinishedRecordedExecutorInvocationsFor.filter(
    ({ invocationId }) => !capacityEvidence.freshlyReleasedInvocationIds.has(invocationId)
  )
  const readFrontier = Effect.fn(
    "ManagedActivation.readActivationFrontier"
  )(function*() {
    const recovered = yield* readRecoveredFrontier(runId)
    const reconstructedStages = yield* makeRecoveredSelectedExecutorStages(
      runId,
      false
    )
    return {
      explanations: recovered.explanations,
      transitions: [
        ...recovered.transitions,
        ...reconstructedStages.map(({ transition }) => transition)
      ]
    }
  })
  const waitForNextExecutorWake = Effect.fn(
    "ManagedActivation.waitForNextExecutorWake"
  )(function*() {
    const frontier = yield* readRecoveredFrontier(runId)
    const deadlines = frontier.explanations.flatMap((explanation) =>
      explanation._tag === "ExecutorInvocationWait"
        ? [explanation.wait.notBefore]
        : []
    )
    const next = deadlines.toSorted((left, right) => left - right)[0]
    if (next === undefined) return false
    const now = yield* Clock.currentTimeMillis
    yield* Effect.sleep(Duration.millis(Math.max(0, next - now)))
    return true
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
        yield* makeRecoveredSelectedExecutorStages(runId, false)
      ).find(
        (candidate) =>
          selectedTransitionKey(
            makeSelectedTransitionIdentity(runId, candidate.transition)
          ) === selectedKey
      )
      if (stage === undefined) {
        yield* recoverRunnableTransition(
          runId,
          transition,
          (recoveredRunId, invocationId) =>
            recoverSelectedExecutorInvocation(
              recoveredRunId,
              OperationId.make(invocationId)
            )
        )
        return
      }
      yield* stage.run(recordIntent)
    }
  )
  return {
    _tag: "AuthoritativeManagedRunActivation",
    capacityEvidence,
    readFrontier: provideDependencies(readFrontier()),
    unfinishedRecordedExecutorInvocations,
    runId,
    runTransition: (transition, execution) =>
      provideDependencies(
        runTransition(transition, execution.recordIntent)
      ),
    waitForNextExecutorWake: provideDependencies(waitForNextExecutorWake())
  } satisfies AuthoritativeManagedRunActivation
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
    latestExecutorActiveReports: capacityEvidence.latestExecutorActiveReports,
    freshlyReleasedInvocationIds: capacityEvidence.freshlyReleasedInvocationIds,
    unfinishedRecordedExecutorInvocations: recovery.unfinishedRecordedExecutorInvocations
  })
  const completed = yield* Queue.unbounded<
    Exit.Exit<void, ManagedRecoveryActivationError>
  >()
  const readFrontier: Effect.Effect<
    RunnableFrontier,
    ManagedRecoveryActivationError
  > = recovery.readFrontier

  yield* Effect.scoped(Effect.gen(function*() {
    const coordinator = yield* makeActivationCoordinator({
      admissionController,
      readFrontier,
      runId,
      runTransition: (
        transition,
        execution
      ): Effect.Effect<void, ManagedRecoveryActivationError> =>
        Effect.gen(function*() {
          const exit = yield* recovery.runTransition(
            transition,
            execution
          ).pipe(Effect.exit)
          yield* Queue.offer(completed, exit)
          yield* Exit.match(exit, {
            onFailure: Effect.failCause,
            onSuccess: () => Effect.void
          })
        })
    })

    function drainRecoveredResponsibilities(): Effect.Effect<
      void,
      ManagedRecoveryActivationError
    > {
      return Effect.gen(function*() {
        yield* coordinator.signal(ActivationCause.Restart()).pipe(Effect.orDie)
        const next = (yield* recovery.readFrontier).transitions[0]
        yield* Option.match(Option.fromUndefinedOr(next), {
          onNone: () =>
            recovery.waitForNextExecutorWake.pipe(
              Effect.flatMap((woke) =>
                woke
                  ? drainRecoveredResponsibilities()
                  : Effect.void
              )
            ),
          onSome: () =>
            Queue.take(completed).pipe(
              Effect.flatten,
              Effect.andThen(drainRecoveredResponsibilities)
            )
        })
      })
    }
    yield* drainRecoveredResponsibilities()
  }))
})
