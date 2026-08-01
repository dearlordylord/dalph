import { Schema } from "effect"
import { RunId, TaskId } from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"

/** Monotonic position among one Run's explicit task-claim reacquisition directions. */
export const TaskClaimReacquisitionDirectionOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("TaskClaimReacquisitionDirectionOrdinal")
)
export type TaskClaimReacquisitionDirectionOrdinal = typeof TaskClaimReacquisitionDirectionOrdinal.Type

export const TaskClaimReacquisitionSubject = Schema.Struct({ runId: RunId, taskId: TaskId })
export type TaskClaimReacquisitionSubject = typeof TaskClaimReacquisitionSubject.Type

/** Operator explicitly directed Dalph to reacquire one exact task claim. */
export const TaskClaimReacquisitionDirectedEvent = Schema.TaggedStruct("TaskClaimReacquisitionDirected", {
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  ordinal: TaskClaimReacquisitionDirectionOrdinal,
  subject: TaskClaimReacquisitionSubject,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TaskClaimReacquisitionDirectedEvent = typeof TaskClaimReacquisitionDirectedEvent.Type
