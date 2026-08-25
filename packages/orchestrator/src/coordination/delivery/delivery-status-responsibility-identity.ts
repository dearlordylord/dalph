import type { TaskId } from "@dalph/contracts"
import type { TicketDelivery } from "./relations.js"
import {
  DeliveryStatusProjectionConflict,
  makeDeliveryStatusEntryIdentity,
  type DeliveryStatusSubject
} from "./delivery-status-model.js"
import { canonicalIdentity } from "./delivery-status-order.js"
import { workflowResponsibilityKey, type WorkflowResponsibilityEntry } from "../reconstruction/state.js"

const responsibilityTaskIdFor = (responsibility: WorkflowResponsibilityEntry): TaskId =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? responsibility.plannedAttempt.taskId
    : responsibility.taskId

const responsibilityRunIdFor = (responsibility: WorkflowResponsibilityEntry) =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? responsibility.plannedAttempt.runId
    : responsibility._tag === "TaskWorktreeResponsibility"
      ? responsibility.operation.plannedAttempt.runId
      : null

/** Rejects a responsibility whose embedded task or planned-attempt Run differs from its delivery. */
export const validateResponsibilityIdentityForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  responsibility: WorkflowResponsibilityEntry
): DeliveryStatusProjectionConflict | null => {
  const plannedAttemptRunId = responsibilityRunIdFor(responsibility)
  if (
    responsibilityTaskIdFor(responsibility) === delivery.taskId &&
    (plannedAttemptRunId === null || plannedAttemptRunId === subject.runId)
  ) {
    return null
  }
  return new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(
      canonicalIdentity(["responsibility-identity", delivery.taskId, workflowResponsibilityKey(responsibility)])
    ),
    detail: "a responsibility standing embeds a task or planned-attempt Run identity different from its delivery"
  })
}
