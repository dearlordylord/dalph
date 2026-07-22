import { Context, Effect, Ref, Schedule, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import { OperationId, RunId } from "./domain.js"
import type { GitWorktreeCreateFailure, GitWorktreeObservationError } from "./git-worktree.js"
import type {
  EvidenceStoreFailure,
  ImplementationDiffReadFailure,
  ImplementationEvidenceHistoryContradiction,
  ImplementationEvidenceModeContradiction,
  ImplementationEvidenceSealingSimulated,
  ImplementationReviewNotAuthorized,
  SealedImplementationEvidence
} from "./implementation-evidence.js"
import * as ImplementationReviewTrace from "./implementation-review-trace.js"
import type {
  ImplementationReviewHistoryContradiction,
  ImplementationReviewInvocationFailure,
  ImplementationReviewModeContradiction,
  ImplementationReviewSimulated,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackFailure,
  SealedImplementationReview
} from "./implementation-review.js"
import type { JournalStoreContradiction, JournalStoreError } from "./journal-store.js"
import * as TaskAttemptPlan from "./task-attempt-plan-recording.js"
import { runTaskClaimAcquisitionProtocol, type TaskClaimAcquisitionDidNotConverge } from "./task-claim-protocol.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "./task-dag.js"
import * as TaskExecutionTrace from "./task-execution-trace.js"
import * as TaskExecutionWorkflow from "./task-execution-workflow.js"
import {
  decideTaskWorkSessionRecovery,
  TaskWorkSessionEstablishmentDidNotConverge,
  TaskWorkSessionLookupDidNotConverge
} from "./task-work-session-recovery-decision.js"
import * as TaskWorkSessionTrace from "./task-work-session-trace.js"
import type {
  TaskRunnerService,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionLookup,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest,
  TaskWorkStartRequestAcknowledgement
} from "./task-work-start.js"
import {
  MatchingTaskWorkSessionReported,
  TaskWorkSessionReport,
  TaskWorkStartRequestFailure
} from "./task-work-start.js"
import * as TaskWorktree from "./task-worktree-reconciliation.js"
import type { TechnicalRetryScheduleOverflow } from "./technical-retry.js"
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
import * as TrackerTrace from "./tracker-workflow-trace.js"
import { WorkflowOperation } from "./workflow-operation.js"
import type { WorkflowOutcome } from "./workflow-outcome.js"
export {
  causalGraphProjection,
  compareOperationIds,
  makeImplementationEvidenceSealingOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  workflowOperationId
} from "./workflow-operation.js"
export { WorkflowOperation }
export {
  ImplementationEvidenceSealingSimulatedTrace,
  ImplementationReviewCompletedTrace,
  ImplementationReviewSimulatedTrace,
  ReviewFindingsHandedBackTrace,
  SealedImplementationEvidenceTrace
} from "./implementation-review-trace.js"
export { runTaskExecutionProtocol, taskExecutionTraceObserver } from "./task-execution-workflow.js"
export {
  decideTaskWorkSessionRecovery,
  TaskWorkSessionEstablishmentDidNotConverge,
  TaskWorkSessionLookupDidNotConverge
} from "./task-work-session-recovery-decision.js"
export * from "./task-work-session-trace.js"
export {
  AuthoritativeTaskWorktreeReady,
  TaskWorktreeExecutionModeContradiction,
  TaskWorktreeHistoryContradiction,
  TaskWorktreeReadyTrace,
  TaskWorktreeReconciliationSimulated,
  TaskWorktreeReconciliationSimulatedTrace
} from "./task-worktree-reconciliation.js"
export * from "./tracker-workflow-trace.js"
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

export interface TaskWorkSessionProtocolObserver {
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
  | TaskWorktree.TaskWorktreeHistoryContradiction
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

type ImplementationReviewWorkflowError =
  | CoordinatorOwnershipError
  | EvidenceStoreFailure
  | ImplementationReviewHistoryContradiction
  | ImplementationReviewNotAuthorized
  | JournalStoreContradiction
  | JournalStoreError
  | TechnicalRetryScheduleOverflow

interface WorkflowInterpreterService {
  readonly handBackReviewFindings: (
    operation: typeof WorkflowOperation.cases.HandBackReviewFindings.Type
  ) => Effect.Effect<
    typeof ReviewFindingsHandbackAcknowledged.Type,
    | ImplementationReviewWorkflowError
    | ReviewFindingsHandbackFailure
  >
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
  readonly executeTaskWork: (
    operation: typeof WorkflowOperation.cases.ExecuteTaskWork.Type
  ) => Effect.Effect<
    typeof WorkflowOutcome.cases.TaskExecutionObserved.Type,
    TaskExecutionWorkflow.TaskExecutionProtocolFailure
  >
  readonly sealImplementationEvidence: (
    operation: typeof WorkflowOperation.cases.SealImplementationEvidence.Type
  ) => Effect.Effect<
    typeof SealedImplementationEvidence.Type | typeof ImplementationEvidenceSealingSimulated.Type,
    | CoordinatorOwnershipError
    | EvidenceStoreFailure
    | ImplementationDiffReadFailure
    | ImplementationEvidenceHistoryContradiction
    | ImplementationEvidenceModeContradiction
    | JournalStoreContradiction
    | JournalStoreError
  >
  readonly simulateTaskWorkSession: (
    operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type
  ) => Effect.Effect<
    typeof WorkflowOutcome.cases.TaskWorkSessionEstablishmentSimulated.Type
  >
  readonly simulateTaskExecution: (
    operation: typeof WorkflowOperation.cases.ExecuteTaskWork.Type
  ) => Effect.Effect<typeof WorkflowOutcome.cases.TaskExecutionSimulated.Type>
  readonly recordTaskAttemptPlan: (
    operation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
  ) => Effect.Effect<TaskAttemptPlan.TaskAttemptPlanRecordingResult, TaskAttemptPlanRecordingError>
  readonly reconcileTaskWorktree: (
    operation: typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type
  ) => Effect.Effect<
    TaskWorktree.TaskWorktreeReconciliationResult,
    | CoordinatorOwnershipError
    | GitWorktreeCreateFailure
    | GitWorktreeObservationError
    | JournalStoreContradiction
    | JournalStoreError
    | TaskAttemptPlan.TaskAttemptPlanHistoryContradiction
    | TaskAttemptPlan.TaskAttemptPlanRunContradiction
    | TaskWorktree.TaskWorktreeHistoryContradiction
  >
  readonly reviewImplementation: (
    operation: typeof WorkflowOperation.cases.ReviewImplementation.Type
  ) => Effect.Effect<
    typeof SealedImplementationReview.Type | typeof ImplementationReviewSimulated.Type,
    | ImplementationReviewWorkflowError
    | ImplementationReviewInvocationFailure
    | ImplementationReviewModeContradiction
  >
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

export const TraceItem = Schema.Union([
  TrackerTrace.OperationSelected,
  TrackerTrace.TrackerGraphOutcomeObserved,
  TrackerTrace.TaskClaimAcquisitionIntended,
  TrackerTrace.TaskClaimAcquiredTrace,
  TaskAttemptPlan.TaskAttemptPlanAcknowledged,
  TaskAttemptPlan.TaskAttemptPlanRecordingSimulated,
  TrackerTrace.TrackerExecutionAdmitted,
  TaskWorktree.TaskWorktreeReadyTrace,
  TaskWorktree.TaskWorktreeReconciliationSimulatedTrace,
  TaskExecutionTrace.TaskExecutionAdmitted,
  TaskExecutionTrace.TaskExecutionStarted,
  TaskExecutionTrace.TaskExecutionOutcomeObserved,
  TaskExecutionTrace.TaskExecutionSimulated,
  ImplementationReviewTrace.SealedImplementationEvidenceTrace,
  ImplementationReviewTrace.ImplementationEvidenceSealingSimulatedTrace,
  ImplementationReviewTrace.ImplementationReviewCompletedTrace,
  ImplementationReviewTrace.ImplementationReviewSimulatedTrace,
  ImplementationReviewTrace.ReviewFindingsHandedBackTrace,
  TaskExecutionWorkflow.TaskExecutionRequestReturnedTrace,
  TaskExecutionWorkflow.TaskExecutionRequestFailedTrace,
  TaskExecutionWorkflow.TaskExecutionObservationFailedTrace,
  TaskExecutionWorkflow.TaskExecutionReportedTrace,
  TaskWorkSessionTrace.TaskWorkStartRequestedTrace,
  TaskWorkSessionTrace.TaskWorkStartRequestAcknowledgedTrace,
  TaskWorkSessionTrace.TaskWorkStartRequestFailedTrace,
  TaskWorkSessionTrace.TaskWorkSessionLookupRequestedTrace,
  TaskWorkSessionTrace.TaskWorkSessionLookupFailedTrace,
  TaskWorkSessionTrace.TaskWorkSessionReportedTrace,
  TaskWorkSessionTrace.TaskWorkSessionEstablishedTrace,
  TaskExecutionTrace.TaskWorkSessionEstablishmentSimulatedTrace,
  TaskWorkSessionTrace.TaskWorkSessionLookupDidNotConvergeTrace,
  TaskWorkSessionTrace.TaskWorkSessionEstablishmentDidNotConvergeTrace
])
export type TraceItem = typeof TraceItem.Type

export interface WorkflowTraceService {
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
}

export class WorkflowTrace extends Context.Service<WorkflowTrace, WorkflowTraceService>()(
  "@dalph/WorkflowTrace"
) {}

export { taskWorkSessionTraceObserver } from "./task-work-session-trace.js"

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
    ? trace.emit(TaskWorkSessionTrace.TaskWorkSessionLookupDidNotConvergeTrace.make({ failure, operation }))
    : failure instanceof TaskWorkSessionEstablishmentDidNotConverge
    ? trace.emit(TaskWorkSessionTrace.TaskWorkSessionEstablishmentDidNotConvergeTrace.make({ failure, operation }))
    : Effect.void
