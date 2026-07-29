import { Context, Effect, Exit, Layer, Queue } from "effect"
import { ActivationCause, makeActivationCoordinator, type OwnedTransitionExecution } from "./activation-coordinator.js"
import { type AttemptId, type PlannedTaskAttempt, type RunId, type TaskId, type TaskWorkCapacity } from "./domain.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import { JournalStore, type JournalStoreError } from "./journal-store.js"
import { managedHistoryTransitionRuleFor } from "./managed-history-transition.js"
import { reduceManagedHistory } from "./managed-history.js"
import {
  continuePlannedAttemptExecutorWork,
  requestPlannedAttemptExecutorSuspension
} from "./planned-attempt-executor-workflow.js"
import {
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "./planned-attempt-executor.js"
import {
  PlannedAttemptRecoveryAuthority,
  type PlannedAttemptRecoveryAuthorityError
} from "./planned-attempt-recovery-authority.js"
import {
  type ReconstructedManagedRunState,
  reconstructedTaskIsPaused,
  workflowResponsibilityOperationId
} from "./reconstructed-managed-run-state.js"
import type { ResponsibilityFreshFacts } from "./responsibility-fresh-facts.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontier,
  type RunnableFrontierTransition
} from "./runnable-frontier.js"
import { recoverRunnableTransition } from "./runnable-transition-recovery.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import type { WorkflowInterpreter, WorkflowInterpreterService, WorkflowTrace } from "./workflow.js"

type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]: Effect.Error<ReturnType<WorkflowInterpreterService[Key]>>
}[keyof WorkflowInterpreterService]

type InvalidManagedHistory = Extract<
  ReturnType<typeof reduceManagedHistory>,
  { readonly _tag: "InvalidManagedHistory" }
>

export type ManagedRecoveryActivationError =
  | Effect.Error<ReturnType<typeof continuePlannedAttemptExecutorWork>>
  | Effect.Error<ReturnType<typeof requestPlannedAttemptExecutorSuspension>>
  | InvalidManagedHistory
  | InterpreterError
  | JournalStoreError
  | PlannedAttemptRecoveryAuthorityError

/** Derives which journaled responsibilities are still unfinished. */
const deriveJournalResponsibilityFacts = (
  managedRun: ReconstructedManagedRunState
): ReadonlyArray<ResponsibilityFreshFacts> => {
  const records = managedRun.workflowHistory.records
  const settledOperationIds = new Set(
    records.flatMap(({ event }) => {
      const transition = managedHistoryTransitionRuleFor(event._tag)
      const descriptor = describeJournalEvent(event)
      return transition?._tag === "Outcome" && descriptor._tag === "OperationEventDescriptor"
        ? [descriptor.operationId]
        : []
    })
  )
  return managedRun.responsibility.entries.map((responsibility) => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") {
      return {
        _tag: "WorkflowOperationFreshFacts" as const,
        disposition: !settledOperationIds.has(workflowResponsibilityOperationId(responsibility))
          ? ResponsibilityDisposition.Ready()
          : ResponsibilityDisposition.Settled({ outcome: "ResponsibilityCompleted" }),
        responsibility
      }
    }
    const report = records.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.runId === responsibility.plannedAttempt.runId &&
        event.report.correlation.attemptId === responsibility.plannedAttempt.attemptId
    )?.event
    const paused = reconstructedTaskIsPaused(managedRun.pause, responsibility.plannedAttempt.taskId)
    const disposition =
      report?._tag === "PlannedAttemptExecutorWorkReported" && report.report._tag === "Terminal"
        ? ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report: report.report })
        : report?._tag === "PlannedAttemptExecutorWorkReported" && report.report._tag === "SafelySuspended" && paused
          ? ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
              correlation: report.report.correlation
            })
          : paused
            ? ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
            : ResponsibilityDisposition.Ready()
    return { _tag: "PlannedAttemptExecutorFreshFacts" as const, disposition, responsibility }
  })
}

/** True when the journal still assigns work to this managed run. */
export const hasUnfinishedManagedRunResponsibility = (managedRun: ReconstructedManagedRunState): boolean =>
  deriveJournalResponsibilityFacts(managedRun).some(
    ({ disposition }) => disposition._tag !== "Settled" && disposition._tag !== "PlannedAttemptExecutorWorkTerminal"
  )

const readRecoveredFrontier = Effect.fn("ManagedActivation.readRecoveredFrontier")(function* (runId: RunId) {
  const journal = yield* JournalStore
  const reduction = reduceManagedHistory(runId, yield* journal.read(runId))
  if (reduction._tag === "InvalidManagedHistory") {
    return yield* Effect.fail(reduction)
  }
  return deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: reduction.managedRun.responsibility,
    responsibilityFacts: deriveJournalResponsibilityFacts(reduction.managedRun)
  })
})

// eslint-disable-next-line functional/no-mixed-types -- The source pairs immutable reconstruction with its executor capability.
interface ManagedActivationSource {
  readonly continuePlannedAttemptExecutorWork: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, ManagedRecoveryActivationError>
  readonly readFrontier: Effect.Effect<RunnableFrontier, ManagedRecoveryActivationError, never>
  readonly reconstructedPlannedAttemptPositions: ReadonlyArray<{
    readonly attemptId: AttemptId
    readonly runId: RunId
    readonly taskId: TaskId
  }>
  readonly waitForNextExecutorWake: Effect.Effect<void, ManagedRecoveryActivationError, never>
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

type ManagedRecoveryActivationService = AuthoritativeManagedRunActivation | SyntheticFreshOnlyActivation

/**
 * Current-run recovered work source. It owns no selector, admission controller,
 * or runner; a caller composes these transitions into its one activation loop.
 */
export class ManagedRecoveryActivation extends Context.Service<
  ManagedRecoveryActivation,
  ManagedRecoveryActivationService
>()("@dalph/ManagedRecoveryActivation") {}

/** Explicit fresh-only composition for dry-run and deterministic tests. */
export const emptyManagedRecoveryActivationLayer = Layer.effect(
  ManagedRecoveryActivation,
  PlannedAttemptExecutor.pipe(
    Effect.map((executor) =>
      ManagedRecoveryActivation.of({
        _tag: "SyntheticFreshOnlyActivation",
        continuePlannedAttemptExecutorWork: (plannedAttempt) => executor.startOrContinue(plannedAttempt),
        readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        reconstructedPlannedAttemptPositions: [],
        waitForNextExecutorWake: Effect.void
      })
    )
  )
)

export const makeManagedRecoveryActivation = Effect.fn("ManagedActivation.makeRecoverySource")(function* (
  runId: RunId
) {
  const dependencies = yield* Effect.context<JournalStore | WorkflowInterpreter | WorkflowTrace>()
  const plannedAttemptExecutor = yield* PlannedAttemptExecutor
  const recoveryAuthority = yield* PlannedAttemptRecoveryAuthority
  const provideDependencies = <A, E>(
    effect: Effect.Effect<A, E, JournalStore | WorkflowInterpreter | WorkflowTrace>
  ): Effect.Effect<A, E> => Effect.provide(effect, dependencies)
  const journal = yield* JournalStore
  const initialReduction = reduceManagedHistory(runId, yield* journal.read(runId))
  if (initialReduction._tag === "InvalidManagedHistory") {
    return yield* Effect.fail(initialReduction)
  }
  const initialRecords = initialReduction.managedRun.workflowHistory.records
  const reconstructedPlannedAttemptPositions = initialReduction.managedRun.responsibility.entries.flatMap(
    (responsibility) => {
      if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
      const report = initialRecords.findLast(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === responsibility.plannedAttempt.attemptId &&
          event.report.correlation.runId === responsibility.plannedAttempt.runId
      )?.event
      return report?._tag === "PlannedAttemptExecutorWorkReported" &&
        (report.report._tag === "SafelySuspended" || report.report._tag === "Terminal")
        ? []
        : [
            {
              attemptId: responsibility.plannedAttempt.attemptId,
              runId: responsibility.plannedAttempt.runId,
              taskId: responsibility.plannedAttempt.taskId
            }
          ]
    }
  )
  const readFrontier = Effect.fn("ManagedActivation.readActivationFrontier")(function* () {
    return yield* readRecoveredFrontier(runId)
  })
  const waitForNextExecutorWake = Effect.fn("ManagedActivation.waitForNextExecutorWake")(function* () {
    return
  })
  const runTransition = Effect.fn("ManagedActivation.runTransition")(function* (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) {
    if (
      transition._tag === "ContinuePlannedAttemptExecutorWork" ||
      transition._tag === "SuspendPlannedAttemptExecutorWork"
    ) {
      const correlation = plannedAttemptExecutorCorrelation(transition.plannedAttempt)
      yield* recoveryAuthority.verify(transition.plannedAttempt)
      if (transition._tag === "ContinuePlannedAttemptExecutorWork") {
        yield* execution.bindPlannedAttemptExecutorPosition(correlation)
      }
      const report = yield* (
        transition._tag === "ContinuePlannedAttemptExecutorWork"
          ? continuePlannedAttemptExecutorWork(transition.plannedAttempt)
          : requestPlannedAttemptExecutorSuspension(transition.plannedAttempt)
      ).pipe(Effect.provideService(PlannedAttemptExecutor, plannedAttemptExecutor))
      if (report._tag === "SafelySuspended" || report._tag === "Terminal") {
        yield* execution.releasePlannedAttemptExecutorWorkPosition(correlation)
      }
      return
    }
    yield* recoverRunnableTransition(runId, transition)
  })
  return {
    _tag: "AuthoritativeManagedRunActivation",
    continuePlannedAttemptExecutorWork: (plannedAttempt) =>
      provideDependencies(
        recoveryAuthority
          .verify(plannedAttempt)
          .pipe(
            Effect.andThen(
              continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
                Effect.provideService(PlannedAttemptExecutor, plannedAttemptExecutor)
              )
            )
          )
      ),
    readFrontier: provideDependencies(readFrontier()),
    reconstructedPlannedAttemptPositions,
    runId,
    runTransition: (transition, execution) => provideDependencies(runTransition(transition, execution)),
    waitForNextExecutorWake: provideDependencies(waitForNextExecutorWake())
  } satisfies AuthoritativeManagedRunActivation
})

/**
 * Routes every already-intended recovered responsibility through the same
 * serial selector/admission/ownership loop used by fresh activation.
 */
export const activateRecoveredResponsibilities = Effect.fn("ManagedActivation.activateRecoveredResponsibilities")(
  function* (runId: RunId, capacity: TaskWorkCapacity) {
    const recovery = yield* makeManagedRecoveryActivation(runId)
    const admissionController = yield* makeTaskAdmissionController({
      capacity,
      reconstructedPlannedAttemptPositions: recovery.reconstructedPlannedAttemptPositions
    })
    const completed = yield* Queue.unbounded<Exit.Exit<void, ManagedRecoveryActivationError>>()
    const readFrontier: Effect.Effect<RunnableFrontier, ManagedRecoveryActivationError> = recovery.readFrontier

    yield* Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeActivationCoordinator({
          admissionController,
          readFrontier,
          runId,
          runTransition: (transition, execution): Effect.Effect<void, ManagedRecoveryActivationError> =>
            Effect.gen(function* () {
              const exit = yield* recovery.runTransition(transition, execution).pipe(Effect.exit)
              yield* Queue.offer(completed, exit)
              yield* Exit.match(exit, { onFailure: Effect.failCause, onSuccess: () => Effect.void })
            })
        })

        function drainRecoveredResponsibilities(): Effect.Effect<void, ManagedRecoveryActivationError> {
          return Effect.gen(function* () {
            yield* coordinator.signal(ActivationCause.Restart()).pipe(Effect.orDie)
            const next = (yield* recovery.readFrontier).transitions[0]
            if (next === undefined) {
              yield* recovery.waitForNextExecutorWake
              return
            }
            yield* Queue.take(completed).pipe(Effect.flatten, Effect.andThen(drainRecoveredResponsibilities))
          })
        }
        yield* drainRecoveredResponsibilities()
      })
    )
  }
)
