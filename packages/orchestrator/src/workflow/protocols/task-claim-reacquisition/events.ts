import { Schema } from "effect"
import { RunId, TaskId } from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"

/** Transport identity that makes one explicit reacquisition direction exactly redeliverable. */
export const TaskClaimReacquisitionRequestId = Schema.NonEmptyString.pipe(
  Schema.brand("TaskClaimReacquisitionRequestId")
)
export type TaskClaimReacquisitionRequestId = typeof TaskClaimReacquisitionRequestId.Type

export const TaskClaimReacquisitionSubject = Schema.Struct({ runId: RunId, taskId: TaskId })
export type TaskClaimReacquisitionSubject = typeof TaskClaimReacquisitionSubject.Type

/** Operator explicitly directed Dalph to reacquire one exact task claim. */
export const TaskClaimReacquisitionDirectedEvent = Schema.TaggedStruct("TaskClaimReacquisitionDirected", {
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  requestId: TaskClaimReacquisitionRequestId,
  subject: TaskClaimReacquisitionSubject,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TaskClaimReacquisitionDirectedEvent = typeof TaskClaimReacquisitionDirectedEvent.Type
