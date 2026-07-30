import { Context, Effect, Schema } from "effect"
import { TaskId } from "@dalph/contracts"
import type { CoordinatorOwnershipError } from "../../authorities/coordinator-ownership/ownership.js"
import type { GitWorktreeCreateFailure, GitWorktreeObservationError } from "../../authorities/git/worktree.js"
import type { JournalAppendError } from "../../workflow-journal/store.js"
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
  TaskClaimObservation,
  type TaskClaimConflict,
  type TaskClaimOwnershipConflict,
  type TaskClaimReadFailure,
  TaskClaimRelease,
  type TaskClaimReleaseFailure,
  type TaskClaimRequestFailure,
  type TrackerMutationService
} from "../../authorities/task-tracker/claim-mutation.js"
import * as TrackerTrace from "../../presentation/tracker-workflow-trace.js"
import { WorkflowOperation } from "../registry/operation.js"
import { taskClaimObservationAttemptBound } from "../protocols/task-claim-observation/bound.js"
import {
  AuthoritativeTaskClaimReleased,
  runTaskClaimReleaseProtocol,
  type TaskClaimReleaseDidNotConverge
} from "../protocols/task-claim-release/protocol.js"
import { observeTaskClaim } from "../protocols/task-claim-observation/protocol.js"

type TaskAttemptPlanRecordingError = JournalAppendError | TaskAttemptPlan.TaskAttemptPlanRunContradiction

/** The generic operation handlers used before complete-attempt executor work. */
export interface WorkflowInterpreterService {
  readonly acquireTaskClaim: (
    operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
    onIntentRecorded?: Effect.Effect<void>
  ) => Effect.Effect<
    TaskClaimAcquisitionResult,
    | CoordinatorOwnershipError
    | JournalAppendError
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
    | JournalAppendError
    | TaskTrackerKnowledgeUnavailable
    | TrackerAdapterReadError
    | TrackerReadError
  >
  readonly readTaskClaim: (
    operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
  ) => Effect.Effect<TaskClaimObservationResult, JournalAppendError>
  readonly releaseTaskClaim: (
    operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
  ) => Effect.Effect<
    TaskClaimReleaseResult,
    | CoordinatorOwnershipError
    | JournalAppendError
    | TaskClaimOwnershipConflict
    | TaskClaimReadFailure
    | TaskClaimReleaseDidNotConverge
    | TaskClaimReleaseFailure
  >
  readonly readTaskWorkSpecification: (
    operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
  ) => Effect.Effect<
    TaskWorkSpecification,
    FixtureReadError | JournalAppendError | TaskTrackerKnowledgeUnavailable | TrackerAdapterReadError | TrackerReadError
  >
  readonly reconcileTaskWorktree: (
    operation: typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type
  ) => Effect.Effect<
    TaskWorktree.TaskWorktreeReconciliationResult,
    | CoordinatorOwnershipError
    | GitWorktreeCreateFailure
    | GitWorktreeObservationError
    | JournalAppendError
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

export const AuthoritativeTaskClaimObserved = Schema.TaggedStruct("AuthoritativeTaskClaimObserved", {
  observation: TaskClaimObservation
})

export const TaskClaimObservationUnreadable = Schema.TaggedStruct("TaskClaimObservationUnreadable", {
  attempts: Schema.Literal(taskClaimObservationAttemptBound),
  taskId: TaskId
})

export const TaskClaimObservationSimulated = Schema.TaggedStruct("TaskClaimObservationSimulated", {
  operation: WorkflowOperation.cases.ReadTaskClaim
})

const TaskClaimObservationResult = Schema.Union([
  AuthoritativeTaskClaimObserved,
  TaskClaimObservationUnreadable,
  TaskClaimObservationSimulated
])
export type TaskClaimObservationResult = typeof TaskClaimObservationResult.Type

/** Dry-run records intended ownership without claiming or reading claim state. */
export const TaskClaimAcquisitionSimulated = Schema.TaggedStruct("TaskClaimAcquisitionSimulated", {
  operation: WorkflowOperation.cases.AcquireTaskClaim
})

const TaskClaimAcquisitionResult = Schema.Union([AuthoritativeTaskClaimAcquired, TaskClaimAcquisitionSimulated])
type TaskClaimAcquisitionResult = typeof TaskClaimAcquisitionResult.Type

/** Dry-run records an exact release without changing or reading tracker state. */
export const TaskClaimReleaseSimulated = Schema.TaggedStruct("TaskClaimReleaseSimulated", { release: TaskClaimRelease })

const TaskClaimReleaseResult = Schema.Union([AuthoritativeTaskClaimReleased, TaskClaimReleaseSimulated])
type TaskClaimReleaseResult = typeof TaskClaimReleaseResult.Type

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

export const observeTaskClaimThrough = (
  tracker: TrackerMutationService,
  operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
) =>
  observeTaskClaim(tracker, operation.taskId).pipe(
    Effect.match({
      onFailure: ({ attempts, taskId }) => TaskClaimObservationUnreadable.make({ attempts, taskId }),
      onSuccess: (observation) => AuthoritativeTaskClaimObserved.make({ observation })
    })
  )

export const releaseTaskClaimThrough = (
  tracker: TrackerMutationService,
  operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
) => runTaskClaimReleaseProtocol(tracker, operation.release)
