import { Context, Effect, Exit, Layer, Queue } from "effect"
import { ActivationCause, makeActivationCoordinator, type OwnedTransitionExecution } from "../activation/coordinator.js"
import {
  type AttemptId,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId,
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { type TaskWorkCapacity } from "../admission/capacity.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { JournalStore, type JournalStoreError } from "../../workflow-journal/store.js"
import { workflowJournalTransitionRuleFor } from "../reconstruction/history-transition.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  continuePlannedAttemptExecutorWork,
  requestPlannedAttemptExecutorSuspension
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import { PlannedAttemptRecoveryAuthority, type PlannedAttemptRecoveryAuthorityError } from "./recovery-authority.js"
import {
  type ReconstructedRunState,
  reconstructedTaskIsPaused,
  workflowResponsibilityOperationId
} from "../reconstruction/state.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontier,
  type RunnableFrontierTransition
} from "../frontier/frontier.js"
import { recoverRunnableTransition } from "../frontier/recovery.js"
import { makeTaskAdmissionController } from "../admission/controller.js"
import type {
  WorkflowInterpreter,
  WorkflowInterpreterService,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"

type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]: Effect.Error<ReturnType<WorkflowInterpreterService[Key]>>
}[keyof WorkflowInterpreterService]

type InvalidWorkflowJournalHistory = Extract<
  ReturnType<typeof reduceWorkflowJournalHistory>,
  { readonly _tag: "InvalidWorkflowJournalHistory" }
>

export type RunRecoveryActivationError =
  | Effect.Error<ReturnType<typeof continuePlannedAttemptExecutorWork>>
  | InvalidWorkflowJournalHistory
  | InterpreterError
  | JournalStoreError
  | PlannedAttemptRecoveryAuthorityError

/** Derives which journaled responsibilities are still unfinished. */
const deriveJournalResponsibilityFacts = (runState: ReconstructedRunState): ReadonlyArray<ResponsibilityFreshFacts> => {
  const records = runState.workflowHistory.records
  const settledOperationIds = new Set(
    records.flatMap(({ event }) => {
      const transition = workflowJournalTransitionRuleFor(event._tag)
      const descriptor = describeJournalEvent(event)
      return transition?._tag === "Outcome" && descriptor._tag === "OperationEventDescriptor"
        ? [descriptor.operationId]
        : []
    })
  )
  return runState.responsibility.entries.map((responsibility) => {
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
    const paused = reconstructedTaskIsPaused(runState.pause, responsibility.plannedAttempt.taskId)
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

/** True when the journal still assigns work to this Dalph run. */
export const hasUnfinishedRunResponsibility = (runState: ReconstructedRunState): boolean =>
  deriveJournalResponsibilityFacts(runState).some(
    ({ disposition }) => disposition._tag !== "Settled" && disposition._tag !== "PlannedAttemptExecutorWorkTerminal"
  )

const readRecoveredFrontier = Effect.fn("RunRecoveryActivation.readRecoveredFrontier")(function* (runId: RunId) {
  const journal = yield* JournalStore
  const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.fail(reduction)
  }
  return deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: reduction.runState.responsibility,
    responsibilityFacts: deriveJournalResponsibilityFacts(reduction.runState)
  })
})

// eslint-disable-next-line functional/no-mixed-types -- The source pairs immutable reconstruction with its executor capability.
interface RunRecoveryActivationSource {
  readonly continuePlannedAttemptExecutorWork: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, RunRecoveryActivationError>
  readonly readFrontier: Effect.Effect<RunnableFrontier, RunRecoveryActivationError, never>
  readonly reconstructedPlannedAttemptPositions: ReadonlyArray<{
    readonly attemptId: AttemptId
    readonly runId: RunId
    readonly taskId: TaskId
  }>
  readonly waitForNextExecutorWake: Effect.Effect<void, RunRecoveryActivationError, never>
}

/** A journal-backed source can execute recovered transitions for its exact run. */
// eslint-disable-next-line functional/no-mixed-types -- The discriminated source carries the exact run and its sole recovered-transition capability.
interface AuthoritativeRunRecoveryActivation extends RunRecoveryActivationSource {
  readonly _tag: "AuthoritativeRunRecoveryActivation"
  readonly runId: RunId
  readonly runTransition: (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) => Effect.Effect<void, RunRecoveryActivationError, never>
}

/** A non-journaled composition has no recovered-transition capability. */
interface SyntheticFreshOnlyActivation extends RunRecoveryActivationSource {
  readonly _tag: "SyntheticFreshOnlyActivation"
}

type RunRecoveryActivationService = AuthoritativeRunRecoveryActivation | SyntheticFreshOnlyActivation

/**
 * Current-run recovered work source. It owns no selector, admission controller,
 * or runner; a caller composes these transitions into its one activation loop.
 */
export class RunRecoveryActivation extends Context.Service<RunRecoveryActivation, RunRecoveryActivationService>()(
  "@dalph/RunRecoveryActivation"
) {}

/** Explicit fresh-only composition for dry-run and deterministic tests. */
export const emptyRunRecoveryActivationLayer = Layer.effect(
  RunRecoveryActivation,
  PlannedAttemptExecutor.pipe(
    Effect.map((executor) =>
      RunRecoveryActivation.of({
        _tag: "SyntheticFreshOnlyActivation",
        continuePlannedAttemptExecutorWork: (plannedAttempt) => executor.startOrContinue(plannedAttempt),
        readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        reconstructedPlannedAttemptPositions: [],
        waitForNextExecutorWake: Effect.void
      })
    )
  )
)

/**
 * Fresh-run composition that records coarse executor responsibility and
 * reports while exposing no recovered transitions.
 */
export const journaledFreshRunRecoveryActivationLayer = Layer.effect(
  RunRecoveryActivation,
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const journal = yield* JournalStore
    return RunRecoveryActivation.of({
      _tag: "SyntheticFreshOnlyActivation",
      continuePlannedAttemptExecutorWork: (plannedAttempt) =>
        continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, executor),
          Effect.provideService(JournalStore, journal)
        ),
      readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
      reconstructedPlannedAttemptPositions: [],
      waitForNextExecutorWake: Effect.void
    })
  })
)

export const makeRunRecoveryActivation = Effect.fn("RunRecoveryActivation.makeRecoverySource")(function* (
  runId: RunId
) {
  const dependencies = yield* Effect.context<JournalStore | WorkflowInterpreter | WorkflowTrace>()
  const plannedAttemptExecutor = yield* PlannedAttemptExecutor
  const recoveryAuthority = yield* PlannedAttemptRecoveryAuthority
  const provideDependencies = <A, E>(
    effect: Effect.Effect<A, E, JournalStore | WorkflowInterpreter | WorkflowTrace>
  ): Effect.Effect<A, E> => Effect.provide(effect, dependencies)
  const journal = yield* JournalStore
  const initialReduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (initialReduction._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.fail(initialReduction)
  }
  const initialRecords = initialReduction.runState.workflowHistory.records
  const reconstructedPlannedAttemptPositions = initialReduction.runState.responsibility.entries.flatMap(
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
  const readFrontier = Effect.fn("RunRecoveryActivation.readActivationFrontier")(function* () {
    return yield* readRecoveredFrontier(runId)
  })
  const waitForNextExecutorWake = Effect.fn("RunRecoveryActivation.waitForNextExecutorWake")(() => Effect.void)
  const runTransition = Effect.fn("RunRecoveryActivation.runTransition")(function* (
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
    _tag: "AuthoritativeRunRecoveryActivation",
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
  } satisfies AuthoritativeRunRecoveryActivation
})

/**
 * Routes every already-intended recovered responsibility through the same
 * serial selector/admission/ownership loop used by fresh activation.
 */
export const activateRecoveredResponsibilities = Effect.fn("RunRecoveryActivation.activateRecoveredResponsibilities")(
  function* (runId: RunId, capacity: TaskWorkCapacity) {
    const recovery = yield* makeRunRecoveryActivation(runId)
    const admissionController = yield* makeTaskAdmissionController({
      capacity,
      reconstructedPlannedAttemptPositions: recovery.reconstructedPlannedAttemptPositions
    })
    const completed = yield* Queue.unbounded<Exit.Exit<void, RunRecoveryActivationError>>()
    const readFrontier: Effect.Effect<RunnableFrontier, RunRecoveryActivationError> = recovery.readFrontier

    yield* Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeActivationCoordinator({
          admissionController,
          readFrontier,
          runId,
          runTransition: (transition, execution): Effect.Effect<void, RunRecoveryActivationError> =>
            Effect.gen(function* () {
              const exit = yield* recovery.runTransition(transition, execution).pipe(Effect.exit)
              yield* Queue.offer(completed, exit)
              yield* Exit.match(exit, { onFailure: Effect.failCause, onSuccess: () => Effect.void })
            })
        })

        function drainRecoveredResponsibilities(): Effect.Effect<void, RunRecoveryActivationError> {
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
