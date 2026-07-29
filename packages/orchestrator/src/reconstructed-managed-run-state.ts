import { Schema } from "effect"
import {
  AttemptId,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  TaskId,
  TrackerRevision,
  TrackerTarget
} from "./domain.js"
import type { RunId } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
import { plannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelationKey } from "./planned-attempt-executor.js"
import { TaskClaimAcquisition } from "./tracker-mutation.js"
import { WorkflowOperation } from "./workflow-operation.js"

/** Coverage currently retained by the normalized target-closure membership event. */
const TaskGraphFactFamily = Schema.Literals(["TargetMembership"])
type TaskGraphFactFamily = typeof TaskGraphFactFamily.Type

export const completeTargetClosureFactFamilies = (["TargetMembership"] as const) satisfies readonly [
  TaskGraphFactFamily
]
export const trackerTargetKey = (target: typeof TrackerTarget.Type): string =>
  JSON.stringify(Schema.encodeUnknownSync(TrackerTarget)(target))
export const taskMembershipKey = (taskIds: ReadonlyArray<TaskId>): string => JSON.stringify([...taskIds].sort())

/**
 * One complete observation of a task-tracker target closure's membership.
 * Journal order cannot resolve an incompatible potentially mixed-time read.
 */
export const TaskTrackerTargetClosureObservation = Schema.TaggedStruct(
  "TaskTrackerTargetClosureObserved",
  {
    completeness: Schema.Literal("Complete"),
    consistency: Schema.Literal("PotentiallyMixedTime"),
    explicitlyCoveredTaskIds: Schema.Array(TaskId).check(Schema.isUnique()),
    factFamilies: Schema.Tuple([TaskGraphFactFamily]),
    freshness: Schema.Literal("FreshAtReadBoundary"),
    observedAt: JournalPosition,
    operationId: OperationId,
    provenAbsentTaskIds: Schema.Array(TaskId).check(Schema.isUnique()),
    revision: TrackerRevision,
    target: TrackerTarget,
    taskIds: Schema.Array(TaskId).check(Schema.isUnique())
  }
).check(
  Schema.makeFilter((observation) =>
    observation.provenAbsentTaskIds.some((taskId) => observation.taskIds.includes(taskId))
      ? "one task cannot be both observed and proven absent"
      : observation.provenAbsentTaskIds.some((taskId) => !observation.explicitlyCoveredTaskIds.includes(taskId))
      ? "every proven-absent task must be explicitly covered"
      : observation.explicitlyCoveredTaskIds.some((taskId) =>
          !observation.taskIds.includes(taskId)
          && !observation.provenAbsentTaskIds.includes(taskId)
        )
      ? "every explicitly covered task must be observed or proven absent"
      : undefined
  )
)
export type TaskTrackerTargetClosureObservation = typeof TaskTrackerTargetClosureObservation.Type

const minimumConflictObservations = 2

/** Incomparable membership facts that isolate only their target closure. */
export const TaskTrackerTargetClosureKnowledgeConflict = Schema.TaggedStruct(
  "TaskTrackerTargetClosureKnowledgeConflict",
  {
    observations: Schema.Array(TaskTrackerTargetClosureObservation).check(
      Schema.isMinLength(minimumConflictObservations)
    ),
    target: TrackerTarget
  }
).check(
  Schema.makeFilter((conflict) => {
    const targetKey = trackerTargetKey(conflict.target)
    if (conflict.observations.some((observation) => trackerTargetKey(observation.target) !== targetKey)) {
      return "every conflicting observation must cover the conflict target"
    }
    return new Set(conflict.observations.map((observation) => taskMembershipKey(observation.taskIds))).size
        < minimumConflictObservations
      ? "a conflict requires at least two different target memberships"
      : undefined
  })
)

export const TaskTrackerTargetClosureKnowledge = Schema.Union([
  TaskTrackerTargetClosureObservation,
  TaskTrackerTargetClosureKnowledgeConflict
])
export type TaskTrackerTargetClosureKnowledge = typeof TaskTrackerTargetClosureKnowledge.Type

/** Best available journaled graph knowledge, never current tracker authority. */
export const BestAvailableDurableGraphKnowledge = Schema.Struct({
  targetClosures: Schema.Array(TaskTrackerTargetClosureKnowledge)
})
export type BestAvailableDurableGraphKnowledge = typeof BestAvailableDurableGraphKnowledge.Type

/** One exact workflow subject whose obligation remains outstanding. */
const WorkflowResponsibilityEntryShape = Schema.TaggedUnion({
  TaskClaimResponsibility: {
    acquisition: TaskClaimAcquisition,
    beganAt: JournalPosition,
    taskId: TaskId
  },
  TaskWorktreeResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.ReconcileTaskWorktree,
    taskId: TaskId
  },
  PlannedAttemptExecutorWorkResponsibility: {
    beganAt: JournalPosition,
    plannedAttempt: PlannedTaskAttempt
  }
})
export const WorkflowResponsibilityEntry = WorkflowResponsibilityEntryShape.check(
  Schema.makeFilter((entry) => {
    if (
      entry._tag === "PlannedAttemptExecutorWorkResponsibility"
    ) return undefined
    const embeddedTaskId = entry._tag === "TaskClaimResponsibility"
      ? entry.acquisition.taskId
      : entry.operation.plannedAttempt.taskId
    if (embeddedTaskId !== entry.taskId) {
      return "responsibility task identity must match its exact operation subject"
    }
    return undefined
  })
)
export type WorkflowResponsibilityEntry = typeof WorkflowResponsibilityEntry.Type

export type WorkflowOperationResponsibility = Exclude<
  WorkflowResponsibilityEntry,
  { readonly _tag: "PlannedAttemptExecutorWorkResponsibility" }
>

/** The exact operation identity shared by reconstruction and frontier rules. */
export const workflowResponsibilityOperationId = (
  entry: WorkflowOperationResponsibility
): OperationId =>
  entry._tag === "TaskClaimResponsibility"
    ? entry.acquisition.operationId
    : entry.operation.operationId

/** Process-local comparison key for either an operation or planned-attempt responsibility. */
export const workflowResponsibilityKey = (
  entry: WorkflowResponsibilityEntry
): string =>
  entry._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? plannedAttemptExecutorCorrelationKey(
      plannedAttemptExecutorCorrelation(entry.plannedAttempt)
    )
    : `operation:${workflowResponsibilityOperationId(entry)}`

export const WorkflowResponsibilityState = Schema.Struct({
  entries: Schema.Array(WorkflowResponsibilityEntry)
})
export type WorkflowResponsibilityState = typeof WorkflowResponsibilityState.Type

/** The latest applied operator direction for the whole run. */
export const ReconstructedRunPauseState = Schema.TaggedUnion({
  RunPaused: {},
  RunUnpaused: {}
})

/** The exact tasks whose latest applied operator direction is Pause. */
export const ReconstructedTaskPauseState = Schema.TaggedUnion({
  NoTaskPauses: {},
  TaskPauses: {
    taskIds: Schema.Array(TaskId).check(Schema.isUnique())
  }
})
export const ReconstructedPauseState = Schema.Struct({
  run: ReconstructedRunPauseState,
  tasks: ReconstructedTaskPauseState
})
export type ReconstructedPauseState = typeof ReconstructedPauseState.Type

export const reconstructedTaskIsPaused = (
  pause: ReconstructedPauseState,
  taskId: typeof TaskId.Type
): boolean =>
  pause.run._tag === "RunPaused"
  || (
    pause.tasks._tag === "TaskPauses"
    && pause.tasks.taskIds.includes(taskId)
  )

export interface ReconstructedWorkflowHistory {
  readonly records: ReadonlyArray<JournalRecord>
}

/** Validated process-local composition; never persisted frontier or capacity. */
export interface ReconstructedManagedRunState {
  readonly appliedThrough: JournalPosition | null
  readonly graphKnowledge: BestAvailableDurableGraphKnowledge
  readonly pause: ReconstructedPauseState
  readonly responsibility: WorkflowResponsibilityState
  readonly runId: RunId
  readonly workflowHistory: ReconstructedWorkflowHistory
}

export const ReconstructedManagedRunInvariantIssue = Schema.TaggedUnion({
  GraphKnowledgeHistoryMismatch: {
    operationId: OperationId,
    position: JournalPosition
  },
  ResponsibilityHistoryMismatch: {
    operationId: OperationId,
    position: JournalPosition
  },
  PlannedAttemptExecutorWorkHistoryMismatch: {
    attemptId: AttemptId,
    position: JournalPosition
  }
})
export type ReconstructedManagedRunInvariantIssue = typeof ReconstructedManagedRunInvariantIssue.Type

export type ReconstructedManagedRunResult =
  | {
    readonly _tag: "ValidReconstructedManagedRun"
    readonly state: ReconstructedManagedRunState
  }
  | {
    readonly _tag: "InvalidReconstructedManagedRun"
    readonly issues: readonly [
      ReconstructedManagedRunInvariantIssue,
      ...ReadonlyArray<ReconstructedManagedRunInvariantIssue>
    ]
  }
