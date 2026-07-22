import { Context, Effect, Ref, Schedule, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import { OperationId, PlannedTaskAttempt, ProviderObservationId, RunId } from "./domain.js"
import type { JournalStoreContradiction, JournalStoreError } from "./journal-store.js"
import * as TaskAttemptPlan from "./task-attempt-plan-recording.js"
import type { TaskClaimAcquisitionDidNotConverge } from "./task-claim-protocol.js"
import { runTaskClaimAcquisitionProtocol } from "./task-claim-protocol.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "./task-dag.js"
import * as TaskExecutionTrace from "./task-execution-trace.js"
import {
  decideTaskWorkSessionRecovery,
  TaskWorkSessionEstablishmentDidNotConverge,
  TaskWorkSessionLookupDidNotConverge
} from "./task-work-session-recovery-decision.js"
import type {
  TaskRunnerService,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionLookup,
  TaskWorkStartRequest
} from "./task-work-start.js"
import {
  MatchingTaskWorkSessionReported,
  TaskWorkSessionLookupFailure,
  TaskWorkSessionReport,
  TaskWorkStartRequestAcknowledgement,
  TaskWorkStartRequestFailure
} from "./task-work-start.js"
import type { TraceOutputError } from "./trace-output.js"
import type { FixtureReadError, TrackerAdapterReadError, TrackerReadError } from "./tracker-graph-reader.js"
import {
  ActiveTaskClaim,
  type TaskClaimConflict,
  type TaskClaimOwnershipConflict,
  type TaskClaimReadFailure,
  type TaskClaimRequestFailure,
  type TrackerMutationService
} from "./tracker-mutation.js"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
export {
  causalGraphProjection,
  compareOperationIds,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTrackerGraphObservationOperation,
  workflowOperationId
} from "./workflow-operation.js"
export { WorkflowOperation }
export {
  decideTaskWorkSessionRecovery,
  TaskWorkSessionEstablishmentDidNotConverge,
  TaskWorkSessionLookupDidNotConverge
} from "./task-work-session-recovery-decision.js"
export { makeTrackerGraphObservedOutcome, WorkflowOutcome } from "./workflow-outcome.js"

/** Fresh provider evidence contradicts an earlier matching-session report. */
export class TaskWorkSessionEvidenceContradiction
  extends Schema.TaggedErrorClass<TaskWorkSessionEvidenceContradiction>()(
    "TaskWorkSessionEvidenceContradiction",
    {
      currentReport: TaskWorkSessionReport,
      operationId: OperationId,
      previousReport: MatchingTaskWorkSessionReported
    }
  )
{}

/** The planned attempt belongs to a different recoverable workflow run. */
export class TaskWorkSessionRunContradiction extends Schema.TaggedErrorClass<TaskWorkSessionRunContradiction>()(
  "TaskWorkSessionRunContradiction",
  {
    journalRunId: RunId,
    operationId: OperationId,
    plannedAttemptRunId: RunId
  }
) {}

type TaskWorkSessionObservationError =
  | JournalStoreContradiction
  | JournalStoreError
  | TaskWorkSessionEvidenceContradiction
  | TaskWorkSessionRunContradiction
  | TaskAttemptPlan.TaskAttemptPlanHistoryContradiction
  | TraceOutputError

interface TaskWorkSessionProtocolObserver {
  readonly lookupFailed: (
    lookup: TaskWorkSessionLookup,
    failure: TaskWorkSessionLookupFailure
  ) => Effect.Effect<void, TaskWorkSessionObservationError>
  readonly sessionReported: (
    lookup: TaskWorkSessionLookup,
    report: TaskWorkSessionReport
  ) => Effect.Effect<void, TaskWorkSessionObservationError>
  readonly startFailed: (
    request: TaskWorkStartRequest,
    failure: TaskWorkStartRequestFailure
  ) => Effect.Effect<void, TaskWorkSessionObservationError>
  readonly startRequested: (
    request: TaskWorkStartRequest,
    acknowledgement: TaskWorkStartRequestAcknowledgement
  ) => Effect.Effect<void, TaskWorkSessionObservationError>
}

const silentTaskWorkSessionProtocolObserver: TaskWorkSessionProtocolObserver = {
  lookupFailed: () => Effect.void,
  sessionReported: () => Effect.void,
  startFailed: () => Effect.void,
  startRequested: () => Effect.void
}

type TaskWorkSessionProtocolFailure =
  | CoordinatorOwnershipError
  | TaskWorkSessionObservationError
  | typeof TaskWorkSessionCorrelationConflict.Type
  | TaskWorkSessionEstablishmentDidNotConverge
  | TaskWorkSessionLookupDidNotConverge

type TaskWorkSessionProtocolResult =
  | {
    readonly _tag: "Established"
    readonly outcome: typeof WorkflowOutcome.cases.TaskWorkSessionEstablished.Type
  }
  | { readonly _tag: "Failed"; readonly error: TaskWorkSessionProtocolFailure }

const taskWorkSessionLookupAttemptBound = 3
const taskWorkSessionRecoverySchedule = Schedule.recurs(taskWorkSessionLookupAttemptBound - 1)

export const runTaskWorkSessionEstablishmentProtocol = Effect.fn(
  "WorkflowInterpreter.runTaskWorkSessionEstablishmentProtocol"
)(function*(
  runner: TaskRunnerService,
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  requestBeforeFirstLookup: boolean,
  observer: TaskWorkSessionProtocolObserver = silentTaskWorkSessionProtocolObserver
) {
  const pendingRequest = yield* Ref.make(requestBeforeFirstLookup)
  const lookup: TaskWorkSessionLookup = {
    operationId: operation.request.operationId,
    plannedAttempt: operation.request.plannedAttempt
  }

  const observe = <E extends TaskWorkSessionObservationError>(
    effect: Effect.Effect<void, E>
  ) =>
    effect.pipe(
      Effect.result,
      Effect.map((result): TaskWorkSessionProtocolResult | undefined =>
        result._tag === "Failure"
          ? { _tag: "Failed", error: result.failure }
          : undefined
      )
    )

  const pass = Effect.gen(function*() {
    if (yield* Ref.getAndSet(pendingRequest, false)) {
      const requestResult = yield* runner.requestTaskWorkStart(operation.request).pipe(Effect.result)
      if (requestResult._tag === "Failure") {
        if (!(requestResult.failure instanceof TaskWorkStartRequestFailure)) {
          return { _tag: "Failed", error: requestResult.failure } satisfies TaskWorkSessionProtocolResult
        }
        const failed = yield* observe(observer.startFailed(operation.request, requestResult.failure))
        if (failed !== undefined) return failed
      } else {
        const failed = yield* observe(observer.startRequested(operation.request, requestResult.success))
        if (failed !== undefined) return failed
      }
    }

    const lookupResult = yield* runner.lookupTaskWorkSession(lookup).pipe(Effect.result)
    if (lookupResult._tag === "Failure") {
      const failed = yield* observe(observer.lookupFailed(lookup, lookupResult.failure))
      if (failed !== undefined) return failed
      const decision = decideTaskWorkSessionRecovery(
        operation,
        lookupResult.failure
      )
      return yield* Effect.fail(decision.retry)
    }

    const report = lookupResult.success
    const failed = yield* observe(observer.sessionReported(lookup, report))
    if (failed !== undefined) return failed
    const decision = decideTaskWorkSessionRecovery(
      operation,
      report
    )
    if (decision._tag === "RepeatRequest") {
      yield* Ref.set(pendingRequest, true)
      return yield* Effect.fail(decision.retry)
    }
    return decision
  })

  const result = yield* pass.pipe(
    Effect.retryOrElse(
      taskWorkSessionRecoverySchedule,
      (retry): Effect.Effect<TaskWorkSessionProtocolResult> =>
        Effect.succeed({ _tag: "Failed", error: retry.atBoundError })
    )
  )
  return result._tag === "Established"
    ? result.outcome
    : yield* Effect.fail(result.error)
})

type TaskAttemptPlanRecordingError =
  | JournalStoreContradiction
  | JournalStoreError
  | TaskAttemptPlan.TaskAttemptPlanRunContradiction

interface WorkflowInterpreterService {
  readonly acquireTaskClaim: (
    operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type
  ) => Effect.Effect<
    TaskClaimAcquisitionResult,
    | CoordinatorOwnershipError
    | JournalStoreContradiction
    | JournalStoreError
    | TaskClaimAcquisitionDidNotConverge
    | TaskClaimConflict
    | TaskClaimOwnershipConflict
    | TaskClaimReadFailure
    | TaskClaimRequestFailure
  >
  readonly establishTaskWorkSession: (
    operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type
  ) => Effect.Effect<
    typeof WorkflowOutcome.cases.TaskWorkSessionEstablished.Type,
    TaskWorkSessionProtocolFailure
  >
  readonly simulateTaskWorkSession: (
    operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type
  ) => Effect.Effect<
    typeof WorkflowOutcome.cases.TaskWorkSessionEstablishmentSimulated.Type
  >
  readonly recordTaskAttemptPlan: (
    operation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
  ) => Effect.Effect<TaskAttemptPlan.TaskAttemptPlanRecordingResult, TaskAttemptPlanRecordingError>
  readonly readTrackerGraph: (
    operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
  ) => Effect.Effect<
    TaskDagSnapshot,
    | FixtureReadError
    | GraphProjectionError
    | JournalStoreContradiction
    | JournalStoreError
    | TrackerAdapterReadError
    | TrackerReadError
  >
}

export class WorkflowInterpreter extends Context.Service<
  WorkflowInterpreter,
  WorkflowInterpreterService
>()("@dalph/WorkflowInterpreter") {}

/** The real tracker proved the exact task claim after a fresh observation. */
export const AuthoritativeTaskClaimAcquired = Schema.TaggedStruct(
  "AuthoritativeTaskClaimAcquired",
  { claim: ActiveTaskClaim }
)

/** Dry-run records intended ownership without claiming or reading claim state. */
export const TaskClaimAcquisitionSimulated = Schema.TaggedStruct(
  "TaskClaimAcquisitionSimulated",
  { operation: WorkflowOperation.cases.AcquireTaskClaim }
)

const TaskClaimAcquisitionResult = Schema.Union([
  AuthoritativeTaskClaimAcquired,
  TaskClaimAcquisitionSimulated
])
type TaskClaimAcquisitionResult = typeof TaskClaimAcquisitionResult.Type

/** Records selection of one immutable workflow operation. */
export const OperationSelected = Schema.TaggedStruct("OperationSelected", {
  operation: WorkflowOperation
})

export const TrackerGraphOutcomeObserved = Schema.TaggedStruct(
  "TrackerGraphOutcomeObserved",
  {
    operation: WorkflowOperation.cases.ReadTrackerGraph,
    outcome: WorkflowOutcome.cases.TrackerGraphObserved
  }
)

/** Records immutable claim intent before any task-tracker state-changing request. */
export const TaskClaimAcquisitionIntended = Schema.TaggedStruct(
  "TaskClaimAcquisitionIntended",
  { operation: WorkflowOperation.cases.AcquireTaskClaim }
)

/** Records the exact claim only after a fresh tracker claim observation. */
export const TaskClaimAcquiredTrace = Schema.TaggedStruct(
  "TaskClaimAcquired",
  {
    claim: ActiveTaskClaim,
    operation: WorkflowOperation.cases.AcquireTaskClaim
  }
)

/**
 * Records tracker execution admission after a post-claim graph read proves the
 * task is open and within the run's current tracker target closure.
 */
export const TrackerExecutionAdmitted = Schema.TaggedStruct(
  "TrackerExecutionAdmitted",
  {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    observationOperation: WorkflowOperation.cases.ReadTrackerGraph
  }
)

export const TaskWorkStartRequestedTrace = Schema.TaggedStruct(
  "TaskWorkStartRequested",
  { operation: WorkflowOperation.cases.EstablishTaskWorkSession }
)

export const TaskWorkStartRequestAcknowledgedTrace = Schema.TaggedStruct(
  "TaskWorkStartRequestAcknowledged",
  {
    acknowledgement: TaskWorkStartRequestAcknowledgement,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkStartRequestFailedTrace = Schema.TaggedStruct(
  "TaskWorkStartRequestFailed",
  {
    failure: TaskWorkStartRequestFailure,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionLookupRequestedTrace = Schema.TaggedStruct(
  "TaskWorkSessionLookupRequested",
  {
    lookup: Schema.Struct({
      operationId: OperationId,
      plannedAttempt: PlannedTaskAttempt
    }),
    observationId: ProviderObservationId,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionLookupFailedTrace = Schema.TaggedStruct(
  "TaskWorkSessionLookupFailed",
  {
    failure: TaskWorkSessionLookupFailure,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionReportedTrace = Schema.TaggedStruct(
  "TaskWorkSessionReported",
  {
    operation: WorkflowOperation.cases.EstablishTaskWorkSession,
    report: TaskWorkSessionReport
  }
)

export const TaskWorkSessionEstablishedTrace = Schema.TaggedStruct(
  "TaskWorkSessionEstablished",
  {
    operation: WorkflowOperation.cases.EstablishTaskWorkSession,
    outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished
  }
)

export const TaskWorkSessionLookupDidNotConvergeTrace = Schema.TaggedStruct(
  "TaskWorkSessionLookupDidNotConverge",
  {
    failure: TaskWorkSessionLookupDidNotConverge,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TaskWorkSessionEstablishmentDidNotConvergeTrace = Schema.TaggedStruct(
  "TaskWorkSessionEstablishmentDidNotConverge",
  {
    failure: TaskWorkSessionEstablishmentDidNotConverge,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  }
)

export const TraceItem = Schema.Union([
  OperationSelected,
  TrackerGraphOutcomeObserved,
  TaskClaimAcquisitionIntended,
  TaskClaimAcquiredTrace,
  TaskAttemptPlan.TaskAttemptPlanAcknowledged,
  TaskAttemptPlan.TaskAttemptPlanRecordingSimulated,
  TrackerExecutionAdmitted,
  TaskExecutionTrace.TaskExecutionAdmitted,
  TaskExecutionTrace.TaskExecutionStarted,
  TaskWorkStartRequestedTrace,
  TaskWorkStartRequestAcknowledgedTrace,
  TaskWorkStartRequestFailedTrace,
  TaskWorkSessionLookupRequestedTrace,
  TaskWorkSessionLookupFailedTrace,
  TaskWorkSessionReportedTrace,
  TaskWorkSessionEstablishedTrace,
  TaskExecutionTrace.TaskWorkSessionEstablishmentSimulatedTrace,
  TaskWorkSessionLookupDidNotConvergeTrace,
  TaskWorkSessionEstablishmentDidNotConvergeTrace
])
export type TraceItem = typeof TraceItem.Type

interface WorkflowTraceService {
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
}

export class WorkflowTrace extends Context.Service<WorkflowTrace, WorkflowTraceService>()(
  "@dalph/WorkflowTrace"
) {}

export const taskWorkSessionTraceObserver = (
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  trace: WorkflowTraceService
): TaskWorkSessionProtocolObserver => ({
  lookupFailed: Effect.fn("WorkflowTrace.taskWorkSessionLookupFailed")(function*(lookup, failure) {
    yield* trace.emit(TaskWorkSessionLookupRequestedTrace.make({
      lookup,
      observationId: failure.observationId,
      operation
    }))
    yield* trace.emit(TaskWorkSessionLookupFailedTrace.make({ failure, operation }))
  }),
  sessionReported: Effect.fn("WorkflowTrace.taskWorkSessionReported")(function*(lookup, report) {
    yield* trace.emit(TaskWorkSessionLookupRequestedTrace.make({
      lookup,
      observationId: report.observationId,
      operation
    }))
    yield* trace.emit(TaskWorkSessionReportedTrace.make({ operation, report }))
  }),
  startFailed: Effect.fn("WorkflowTrace.taskWorkStartFailed")(function*(_request, failure) {
    yield* trace.emit(TaskWorkStartRequestedTrace.make({ operation }))
    yield* trace.emit(TaskWorkStartRequestFailedTrace.make({ failure, operation }))
  }),
  startRequested: Effect.fn("WorkflowTrace.taskWorkStartRequested")(function*(_request, acknowledgement) {
    yield* trace.emit(TaskWorkStartRequestedTrace.make({ operation }))
    yield* trace.emit(TaskWorkStartRequestAcknowledgedTrace.make({ acknowledgement, operation }))
  })
})

export const acquireTaskClaimThrough = (
  tracker: TrackerMutationService,
  operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type
) =>
  runTaskClaimAcquisitionProtocol(
    tracker,
    operation.acquisition
  ).pipe(
    Effect.map((claim) => AuthoritativeTaskClaimAcquired.make({ claim }))
  )

export const emitTaskWorkSessionNonConvergence = (
  failure: TaskWorkSessionProtocolFailure,
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  trace: WorkflowTraceService
) =>
  failure instanceof TaskWorkSessionLookupDidNotConverge
    ? trace.emit(TaskWorkSessionLookupDidNotConvergeTrace.make({ failure, operation }))
    : failure instanceof TaskWorkSessionEstablishmentDidNotConverge
    ? trace.emit(TaskWorkSessionEstablishmentDidNotConvergeTrace.make({ failure, operation }))
    : Effect.void
