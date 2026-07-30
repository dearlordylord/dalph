import { Schema, type Option } from "effect"
import {
  AttemptId,
  PlannedTaskAttempt,
  TaskId,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey
} from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { type RunId } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { WorkflowOperation } from "../../workflow/registry/operation.js"
import { TaskTrackerFactsObservation } from "../../workflow/task-tracker-facts/observation.js"
import type { RunControlPolicy } from "../../control/policy.js"

/** Best available journaled graph knowledge, never current tracker authority. */
export const BestAvailableDurableGraphKnowledge = Schema.Struct({
  taskTrackerFacts: Schema.Array(TaskTrackerFactsObservation)
})
export type BestAvailableDurableGraphKnowledge = typeof BestAvailableDurableGraphKnowledge.Type

/** One exact workflow subject whose obligation remains outstanding. */
const WorkflowResponsibilityEntryShape = Schema.TaggedUnion({
  TaskClaimResponsibility: { acquisition: TaskClaimAcquisition, beganAt: JournalPosition, taskId: TaskId },
  TaskWorktreeResponsibility: {
    beganAt: JournalPosition,
    operation: WorkflowOperation.cases.ReconcileTaskWorktree,
    taskId: TaskId
  },
  PlannedAttemptExecutorWorkResponsibility: { beganAt: JournalPosition, plannedAttempt: PlannedTaskAttempt }
})
export const WorkflowResponsibilityEntry = WorkflowResponsibilityEntryShape.check(
  Schema.makeFilter((entry) => {
    if (entry._tag === "PlannedAttemptExecutorWorkResponsibility") return undefined
    const embeddedTaskId =
      entry._tag === "TaskClaimResponsibility" ? entry.acquisition.taskId : entry.operation.plannedAttempt.taskId
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
export const workflowResponsibilityOperationId = (entry: WorkflowOperationResponsibility): OperationId =>
  entry._tag === "TaskClaimResponsibility" ? entry.acquisition.operationId : entry.operation.operationId

/** Process-local comparison key for either an operation or planned-attempt responsibility. */
export const workflowResponsibilityKey = (entry: WorkflowResponsibilityEntry): string =>
  entry._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))
    : `operation:${workflowResponsibilityOperationId(entry)}`

export const WorkflowResponsibilityState = Schema.Struct({ entries: Schema.Array(WorkflowResponsibilityEntry) })
export type WorkflowResponsibilityState = typeof WorkflowResponsibilityState.Type

/** The latest applied operator direction for the whole run. */
export const ReconstructedRunPauseState = Schema.TaggedUnion({ RunPaused: {}, RunUnpaused: {} })

/** The exact tasks whose latest applied operator direction is Pause. */
export const ReconstructedTaskPauseState = Schema.TaggedUnion({
  NoTaskPauses: {},
  TaskPauses: { taskIds: Schema.Array(TaskId).check(Schema.isUnique()) }
})
export const ReconstructedPauseState = Schema.Struct({
  run: ReconstructedRunPauseState,
  tasks: ReconstructedTaskPauseState
})
export type ReconstructedPauseState = typeof ReconstructedPauseState.Type

export const reconstructedTaskIsPaused = (pause: ReconstructedPauseState, taskId: TaskId): boolean =>
  pause.run._tag === "RunPaused" || (pause.tasks._tag === "TaskPauses" && pause.tasks.taskIds.includes(taskId))

export interface ReconstructedWorkflowHistory {
  readonly records: ReadonlyArray<JournalRecord>
}

/** Validated process-local composition; never persisted frontier or capacity. */
export interface ReconstructedRunState {
  readonly appliedThrough: JournalPosition | null
  readonly controlPolicy: Option.Option<RunControlPolicy>
  readonly graphKnowledge: BestAvailableDurableGraphKnowledge
  readonly pause: ReconstructedPauseState
  readonly responsibility: WorkflowResponsibilityState
  readonly runId: RunId
  readonly workflowHistory: ReconstructedWorkflowHistory
}

export const ReconstructedRunInvariantIssue = Schema.TaggedUnion({
  GraphKnowledgeHistoryMismatch: { operationId: OperationId, position: JournalPosition },
  ResponsibilityHistoryMismatch: { operationId: OperationId, position: JournalPosition },
  PlannedAttemptExecutorWorkHistoryMismatch: { attemptId: AttemptId, position: JournalPosition }
})
export type ReconstructedRunInvariantIssue = typeof ReconstructedRunInvariantIssue.Type

export type ReconstructedRunResult =
  | { readonly _tag: "ValidReconstructedRun"; readonly state: ReconstructedRunState }
  | {
      readonly _tag: "InvalidReconstructedRun"
      readonly issues: readonly [ReconstructedRunInvariantIssue, ...ReadonlyArray<ReconstructedRunInvariantIssue>]
    }
