import { Schema } from "effect"
import { JournalPosition, OperationId, TaskId, TrackerRevision, TrackerTarget } from "./domain.js"
import type { RunId } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
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
export const WorkflowResponsibilityEntry = Schema.TaggedUnion({
  TaskClaimResponsibility: {
    acquisition: TaskClaimAcquisition,
    beganAt: JournalPosition
  },
  TaskWorktreeResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.ReconcileTaskWorktree
  },
  TaskWorkSessionResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  },
  TaskExecutionResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.ExecuteTaskWork
  },
  ImplementationEvidenceResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.SealImplementationEvidence
  },
  ImplementationReviewResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.ReviewImplementation
  },
  ReviewFindingsHandbackResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.HandBackReviewFindings
  }
})
export type WorkflowResponsibilityEntry = typeof WorkflowResponsibilityEntry.Type

export const WorkflowResponsibilityState = Schema.Struct({
  entries: Schema.Array(WorkflowResponsibilityEntry)
})
export type WorkflowResponsibilityState = typeof WorkflowResponsibilityState.Type

/** Run pause and per-task pause remain distinct domain dimensions. */
export const ReconstructedRunPauseState = Schema.TaggedUnion({ RunUnpaused: {} })
export const ReconstructedTaskPauseState = Schema.TaggedUnion({ NoTaskPauses: {} })
export const ReconstructedPauseState = Schema.Struct({
  run: ReconstructedRunPauseState,
  tasks: ReconstructedTaskPauseState
})
export type ReconstructedPauseState = typeof ReconstructedPauseState.Type

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
