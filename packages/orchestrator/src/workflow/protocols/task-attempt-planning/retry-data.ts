import { RunId, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { OperationId } from "../../identity.js"
import { WorkflowActor } from "../../registry/actor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Transport identity for one explicit retry of an exact settled Base refusal. */
export const TaskAttemptBaseRetryRequestId = Schema.NonEmptyString.pipe(Schema.brand("TaskAttemptBaseRetryRequestId"))
export type TaskAttemptBaseRetryRequestId = typeof TaskAttemptBaseRetryRequestId.Type
export const TaskAttemptBaseRetrySubject = Schema.Struct({
  runId: RunId,
  taskId: TaskId,
  refusedReadOperationId: OperationId
})
export type TaskAttemptBaseRetrySubject = typeof TaskAttemptBaseRetrySubject.Type
export const ApplyTaskAttemptBaseRetryRequest = Schema.Struct({
  requestId: TaskAttemptBaseRetryRequestId,
  subject: TaskAttemptBaseRetrySubject
})
export type ApplyTaskAttemptBaseRetryRequest = typeof ApplyTaskAttemptBaseRetryRequest.Type

/** Operator authorizes fresh tracker checks for one successor to a settled refused read. */
export const TaskAttemptBaseRetryRequestedEvent = Schema.TaggedStruct("TaskAttemptBaseRetryRequested", {
  ...ApplyTaskAttemptBaseRetryRequest.fields,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TaskAttemptBaseRetryRequestedEvent = typeof TaskAttemptBaseRetryRequestedEvent.Type

export class TaskAttemptBaseRetryRejected extends Schema.TaggedError<TaskAttemptBaseRetryRejected>()(
  "TaskAttemptBaseRetryRejected",
  {
    reason: Schema.Literals(["NotRefused", "AlreadyRequested", "PlanExists", "RunMismatch", "RequestIdentityConflict"])
  }
) {}
