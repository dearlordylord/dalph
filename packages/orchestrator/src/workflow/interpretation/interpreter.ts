import { Context, Effect, Schema } from "effect"
import type { CoordinatorOwnershipError } from "../../authorities/coordinator-ownership/ownership.js"
import type { GitWorktreeCreateFailure, GitWorktreeObservationError } from "../../authorities/git/worktree.js"
import type { JournalStoreContradiction, JournalStoreError } from "../../workflow-journal/store.js"
import * as TaskAttemptPlan from "../protocols/task-attempt-planning/record.js"
import {
  runTaskClaimAcquisitionProtocol,
  type TaskClaimAcquisitionDidNotConverge
} from "../protocols/task-claim-acquisition/protocol.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import * as TaskWorktree from "../protocols/worktree-reconciliation/protocol.js"
import type { TraceOutputError } from "../../presentation/trace-output.js"
import type {
  FixtureReadError,
  TrackerAdapterReadError,
  TrackerReadError
} from "../../authorities/task-tracker/graph-reader.js"
import type { TaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import type { TaskTrackerKnowledgeUnavailable } from "../../coordination/reconstruction/graph-knowledge.js"
import {
  ActiveTaskClaim,
  type TaskClaimConflict,
  type TaskClaimOwnershipConflict,
  type TaskClaimReadFailure,
  type TaskClaimRequestFailure,
  type TrackerMutationService
} from "../../authorities/task-tracker/claim-mutation.js"
import * as TrackerTrace from "../../presentation/tracker-workflow-trace.js"
import { WorkflowOperation } from "../registry/operation.js"

export {
  causalGraphProjection,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  workflowOperationId
} from "../registry/operation.js"
export { WorkflowOperation }
export {
  AuthoritativeTaskWorktreeReady,
  TaskWorktreeExecutionModeContradiction,
  TaskWorktreeHistoryContradiction,
  TaskWorktreeReadyTrace,
  TaskWorktreeReconciliationSimulated,
  TaskWorktreeReconciliationSimulatedTrace
} from "../protocols/worktree-reconciliation/protocol.js"
export * from "../../presentation/tracker-workflow-trace.js"

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
