import { Schema } from "effect"
import { ControlCommandRecordedEvent } from "../../control/command.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { workflowJournalEventVersion } from "../kernel/event.js"
import { PlannedAttemptExecutorJournalEvent } from "../protocols/planned-attempt-executor-work/events.js"
import { TaskTrackerFactsObservedEvent } from "../task-tracker-facts/observation.js"
import { OperationId } from "../identity.js"
import { WorkflowOperation as WorkflowOperationSchema } from "./operation.js"

const TaskTrackerReadOperation = Schema.Union([
  WorkflowOperationSchema.cases.ReadTrackerGraph,
  WorkflowOperationSchema.cases.ReadTaskWorkSpecification
])

const TaskTrackerReadIntentRecorded = Schema.TaggedStruct("TaskTrackerReadIntentRecorded", {
  operation: TaskTrackerReadOperation,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskClaimAcquisitionIntendedEvent = Schema.TaggedStruct("TaskClaimAcquisitionIntended", {
  operation: WorkflowOperationSchema.cases.AcquireTaskClaim,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskClaimAcquiredEvent = Schema.TaggedStruct("TaskClaimAcquired", {
  claim: ActiveTaskClaim,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskAttemptPlannedEvent = Schema.TaggedStruct("TaskAttemptPlanned", {
  operation: WorkflowOperationSchema.cases.RecordTaskAttemptPlan,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskWorktreeReconciliationIntendedEvent = Schema.TaggedStruct("TaskWorktreeReconciliationIntended", {
  operation: WorkflowOperationSchema.cases.ReconcileTaskWorktree,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskWorktreeReadyEvent = Schema.TaggedStruct("TaskWorktreeReady", {
  operationId: OperationId,
  proof: PlannedWorktreeReady,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Closed semantic event vocabulary accepted by the workflow journal. */
export const WorkflowJournalEvent = Schema.Union([
  ControlCommandRecordedEvent,
  TaskTrackerReadIntentRecorded,
  TaskTrackerFactsObservedEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquiredEvent,
  TaskAttemptPlannedEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskWorktreeReadyEvent,
  PlannedAttemptExecutorJournalEvent
])
export type WorkflowJournalEvent = typeof WorkflowJournalEvent.Type

export const taskTrackerReadIntent = (
  operation: typeof TaskTrackerReadOperation.Type
): typeof TaskTrackerReadIntentRecorded.Type =>
  TaskTrackerReadIntentRecorded.make({ operation, version: workflowJournalEventVersion })
