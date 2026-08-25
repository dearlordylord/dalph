import { Context, Effect, Schema } from "effect"
import { TaskId } from "@dalph/contracts"
import type { CoordinatorOwnershipError } from "../../authorities/coordinator-ownership/ownership.js"
import type {
  GitWorktreeCreateFailure,
  GitWorktreeObservationError,
  GitWorktreeReadFailure,
  GitWorktreeService
} from "../../authorities/git/worktree.js"
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
import type { TaskWorkSpecification } from "@dalph/contracts"
import type { TaskTrackerKnowledgeUnavailable } from "../../coordination/reconstruction/graph-knowledge.js"
import type { TaskTrackerFactsReadUnavailable } from "../task-tracker-facts/observation.js"
import {
  ActiveTaskClaim,
  TaskClaimObservation,
  type TaskClaimConflict,
  type TaskClaimOwnershipConflict,
  type TaskClaimReadFailure,
  type TaskClaimReleaseFailure,
  type TaskClaimRequestFailure,
  type TrackerMutationService
} from "../../authorities/task-tracker/claim-mutation.js"
import * as TrackerTrace from "../../presentation/tracker-workflow-trace.js"
import type { WorkflowOperation } from "../registry/operation.js"
import { taskClaimObservationAttemptBound } from "../protocols/task-claim-observation/bound.js"
import {
  AuthoritativeTaskClaimReleased,
  runTaskClaimReleaseProtocol,
  type TaskClaimReleaseDidNotConverge
} from "../protocols/task-claim-release/protocol.js"
import { observeTaskClaim } from "../protocols/task-claim-observation/protocol.js"
import {
  observePlannedAttemptWorktree,
  PlannedAttemptWorktreeObservation
} from "../protocols/planned-attempt-worktree-observation/protocol.js"
import type { GitTargetLineageReadFailure, GitTargetLineageService } from "../../authorities/git/target-lineage.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import type { InterruptibleWorkflowBoundaryExecution } from "./interruptible-boundary.js"
export {
  CompletionClaimCleanupBoundaryCall,
  CompletionClaimCleanupBoundaryCallId,
  CompletionClaimCleanupSequenceId,
  InterruptibleWorkflowBoundaryIntent,
  runInterruptibleBoundary
} from "./interruptible-boundary.js"
export type {
  InterruptibleWorkflowBoundaryExecution,
  InterruptibleWorkflowBoundaryFamily
} from "./interruptible-boundary.js"

type TaskAttemptPlanRecordingError = JournalAppendError | TaskAttemptPlan.TaskAttemptPlanRunContradiction

type TaskClaimAcquisitionError =
  | CoordinatorOwnershipError
  | JournalAppendError
  | TaskClaimAcquisitionDidNotConverge
  | TaskClaimConflict
  | TaskClaimOwnershipConflict
  | TaskClaimReadFailure
  | TaskClaimRequestFailure

/** The generic operation handlers used before complete-attempt executor work. */
export interface WorkflowInterpreterService {
  readonly acquireTaskClaim: <IntentError = never>(
    operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
    onIntentRecorded?: Effect.Effect<void, IntentError>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
  ) => Effect.Effect<TaskClaimAcquisitionResult, TaskClaimAcquisitionError | IntentError>
  readonly readTrackerGraph: (
    operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
    onIntentRecorded?: Effect.Effect<void>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
  ) => Effect.Effect<
    TaskDagSnapshot,
    | FixtureReadError
    | GraphProjectionError
    | JournalAppendError
    | TaskTrackerKnowledgeUnavailable
    | TaskTrackerFactsReadUnavailable
    | TrackerAdapterReadError
    | TrackerReadError
  >
  readonly readTaskClaim: (
    operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type,
    onIntentRecorded?: Effect.Effect<void>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
  ) => Effect.Effect<TaskClaimObservationResult, JournalAppendError>
  readonly readTaskWorktree: (
    operation: typeof WorkflowOperation.cases.ReadTaskWorktree.Type,
    onIntentRecorded?: Effect.Effect<void>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
  ) => Effect.Effect<PlannedAttemptWorktreeObservationResult, GitWorktreeReadFailure | JournalAppendError>
  readonly readTargetLineage: (
    operation: typeof WorkflowOperation.cases.ReadTargetLineage.Type,
    onIntentRecorded?: Effect.Effect<void>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
  ) => Effect.Effect<TargetLineageObservationResult, GitTargetLineageReadFailure | JournalAppendError>
  readonly releaseTaskClaim: (
    operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type,
    onIntentRecorded?: Effect.Effect<void>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
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
    operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type,
    onIntentRecorded?: Effect.Effect<void>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
  ) => Effect.Effect<
    TaskWorkSpecification,
    FixtureReadError | JournalAppendError | TaskTrackerKnowledgeUnavailable | TrackerAdapterReadError | TrackerReadError
  >
  readonly reconcileTaskWorktree: (
    operation: typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type,
    onIntentRecorded?: Effect.Effect<void>,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
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

type EffectFunctionFailure<F> = F extends (...args: infer _Args) => Effect.Effect<infer _A, infer E, infer _R>
  ? E
  : never

/** All failures exposed by the interpreter's concrete handlers; claim intent hooks add their own caller error. */
export type WorkflowInterpreterServiceFailure =
  | TaskClaimAcquisitionError
  | EffectFunctionFailure<WorkflowInterpreterService["readTrackerGraph"]>
  | EffectFunctionFailure<WorkflowInterpreterService["readTaskClaim"]>
  | EffectFunctionFailure<WorkflowInterpreterService["readTaskWorktree"]>
  | EffectFunctionFailure<WorkflowInterpreterService["readTargetLineage"]>
  | EffectFunctionFailure<WorkflowInterpreterService["releaseTaskClaim"]>
  | EffectFunctionFailure<WorkflowInterpreterService["readTaskWorkSpecification"]>
  | EffectFunctionFailure<WorkflowInterpreterService["reconcileTaskWorktree"]>
  | EffectFunctionFailure<WorkflowInterpreterService["recordTaskAttemptPlan"]>

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

const TaskClaimObservationResult = Schema.Union([AuthoritativeTaskClaimObserved, TaskClaimObservationUnreadable])
export type TaskClaimObservationResult = typeof TaskClaimObservationResult.Type

export const AuthoritativePlannedAttemptWorktreeObserved = Schema.TaggedStruct(
  "AuthoritativePlannedAttemptWorktreeObserved",
  { observation: PlannedAttemptWorktreeObservation }
)

const PlannedAttemptWorktreeObservationResult = AuthoritativePlannedAttemptWorktreeObserved
export type PlannedAttemptWorktreeObservationResult = typeof PlannedAttemptWorktreeObservationResult.Type

export const AuthoritativeTargetLineageObserved = Schema.TaggedStruct("AuthoritativeTargetLineageObserved", {
  observation: TargetLineageObservation
})
const TargetLineageObservationResult = AuthoritativeTargetLineageObserved
export type TargetLineageObservationResult = typeof TargetLineageObservationResult.Type

const TaskClaimAcquisitionResult = AuthoritativeTaskClaimAcquired
type TaskClaimAcquisitionResult = typeof TaskClaimAcquisitionResult.Type

const TaskClaimReleaseResult = AuthoritativeTaskClaimReleased
type TaskClaimReleaseResult = typeof TaskClaimReleaseResult.Type

/** Generic traces stop at the complete-attempt executor boundary. */
export const TraceItem = Schema.Union([
  TrackerTrace.OperationSelected,
  TrackerTrace.TaskTrackerFactsObservedTrace,
  TrackerTrace.TaskClaimAcquisitionIntended,
  TrackerTrace.TaskClaimAcquiredTrace,
  TaskAttemptPlan.TaskAttemptPlanAcknowledged,
  TrackerTrace.TrackerExecutionAdmitted,
  TaskWorktree.TaskWorktreeReadyTrace
])
export type TraceItem = typeof TraceItem.Type

export interface WorkflowTraceService {
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

export const observePlannedAttemptWorktreeThrough = (
  git: GitWorktreeService,
  operation: typeof WorkflowOperation.cases.ReadTaskWorktree.Type
) =>
  observePlannedAttemptWorktree(git, operation.plannedAttempt).pipe(
    Effect.map((observation) => AuthoritativePlannedAttemptWorktreeObserved.make({ observation }))
  )

export const observeTargetLineageThrough = (
  targetLineage: GitTargetLineageService,
  operation: typeof WorkflowOperation.cases.ReadTargetLineage.Type
) =>
  targetLineage
    .read(operation.plannedAttempt.baseSha, operation.integrationTarget)
    .pipe(Effect.map((observation) => AuthoritativeTargetLineageObserved.make({ observation })))

export const releaseTaskClaimThrough = (
  tracker: TrackerMutationService,
  operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
) => runTaskClaimReleaseProtocol(tracker, operation.release)
