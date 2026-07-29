import { Context, Effect, Schema } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import type { GitWorktreeCreateFailure, GitWorktreeObservationError } from "./git-worktree.js"
import type { JournalStoreContradiction, JournalStoreError } from "./journal-store.js"
import * as TaskAttemptPlan from "./task-attempt-plan-recording.js"
import { runTaskClaimAcquisitionProtocol, type TaskClaimAcquisitionDidNotConverge } from "./task-claim-protocol.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "./task-dag.js"
import * as TaskWorktree from "./task-worktree-reconciliation.js"
import type { TraceOutputError } from "./trace-output.js"
import type { FixtureReadError, TrackerAdapterReadError, TrackerReadError } from "./tracker-graph-reader.js"
import type { TaskWorkSpecification } from "./task-tracker-facts.js"
import type { TaskTrackerKnowledgeUnavailable } from "./task-tracker-knowledge.js"
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

export {
  causalGraphProjection,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  workflowOperationId
} from "./workflow-operation.js"
export { WorkflowOperation }
export {
  AuthoritativeTaskWorktreeReady,
  TaskWorktreeExecutionModeContradiction,
  TaskWorktreeHistoryContradiction,
  TaskWorktreeReadyTrace,
  TaskWorktreeReconciliationSimulated,
  TaskWorktreeReconciliationSimulatedTrace
} from "./task-worktree-reconciliation.js"
export * from "./tracker-workflow-trace.js"

type TaskAttemptPlanRecordingError =
  | JournalStoreContradiction
  | JournalStoreError
  | TaskAttemptPlan.TaskAttemptPlanRunContradiction

/** The generic operation handlers used before complete-attempt executor work. */
export interface WorkflowInterpreterService {
  readonly acquireTaskClaim: (
    operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
    onIntentRecorded?: Effect.Effect<void>
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
  readonly readTrackerGraph: (
    operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
  ) => Effect.Effect<
    TaskDagSnapshot,
    | FixtureReadError
    | GraphProjectionError
    | JournalStoreContradiction
    | JournalStoreError
    | TaskTrackerKnowledgeUnavailable
    | TrackerAdapterReadError
    | TrackerReadError
  >
  readonly readTaskWorkSpecification: (
    operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
  ) => Effect.Effect<
    TaskWorkSpecification,
    | FixtureReadError
    | JournalStoreContradiction
    | JournalStoreError
    | TaskTrackerKnowledgeUnavailable
    | TrackerAdapterReadError
    | TrackerReadError
  >
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
  readonly recordTaskAttemptPlan: (
    operation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
  ) => Effect.Effect<TaskAttemptPlan.TaskAttemptPlanRecordingResult, TaskAttemptPlanRecordingError>
}

export class WorkflowInterpreter extends Context.Service<WorkflowInterpreter, WorkflowInterpreterService>()(
  "@dalph/WorkflowInterpreter"
) {}

/** The real tracker proved the exact task claim after a fresh observation. */
export const AuthoritativeTaskClaimAcquired = Schema.TaggedStruct("AuthoritativeTaskClaimAcquired", {
  claim: ActiveTaskClaim
})

/** Dry-run records intended ownership without claiming or reading claim state. */
export const TaskClaimAcquisitionSimulated = Schema.TaggedStruct("TaskClaimAcquisitionSimulated", {
  operation: WorkflowOperation.cases.AcquireTaskClaim
})

const TaskClaimAcquisitionResult = Schema.Union([AuthoritativeTaskClaimAcquired, TaskClaimAcquisitionSimulated])
type TaskClaimAcquisitionResult = typeof TaskClaimAcquisitionResult.Type

/** Generic traces stop at the complete-attempt executor boundary. */
export const TraceItem = Schema.Union([
  TrackerTrace.OperationSelected,
  TrackerTrace.TaskTrackerFactsObservedTrace,
  TrackerTrace.TaskClaimAcquisitionIntended,
  TrackerTrace.TaskClaimAcquiredTrace,
  TaskAttemptPlan.TaskAttemptPlanAcknowledged,
  TaskAttemptPlan.TaskAttemptPlanRecordingSimulated,
  TrackerTrace.TrackerExecutionAdmitted,
  TaskWorktree.TaskWorktreeReadyTrace,
  TaskWorktree.TaskWorktreeReconciliationSimulatedTrace
])
export type TraceItem = typeof TraceItem.Type

interface WorkflowTraceService {
  readonly emit: (item: TraceItem) => Effect.Effect<void, TraceOutputError>
}

export class WorkflowTrace extends Context.Service<WorkflowTrace, WorkflowTraceService>()("@dalph/WorkflowTrace") {}

export const acquireTaskClaimThrough = (
  tracker: TrackerMutationService,
  operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type
) =>
  runTaskClaimAcquisitionProtocol(tracker, operation.acquisition).pipe(
    Effect.map((claim) => AuthoritativeTaskClaimAcquired.make({ claim }))
  )
