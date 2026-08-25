import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import type { ExactWorkflowObligation, TicketDelivery } from "./relations.js"
import {
  DeliveryStatusProjectionConflict,
  makeDeliveryStatusEntryIdentity,
  type DeliveryStatusSubject
} from "./delivery-status-model.js"
import { canonicalIdentity } from "./delivery-status-order.js"
import { workflowResponsibilityKey, type WorkflowResponsibilityEntry } from "../reconstruction/state.js"

const responsibilityTaskIdsFor = (responsibility: WorkflowResponsibilityEntry): ReadonlyArray<TaskId> => {
  if (responsibility._tag === "PlannedAttemptExecutorWorkResponsibility") {
    return [responsibility.plannedAttempt.taskId]
  }
  if (responsibility._tag === "TaskWorktreeResponsibility") {
    return [responsibility.taskId, responsibility.operation.plannedAttempt.taskId]
  }
  if (responsibility._tag === "TaskClaimReleaseResponsibility") {
    return [responsibility.taskId, responsibility.operation.release.claim.taskId]
  }
  return [responsibility.taskId, responsibility.acquisition.taskId]
}

const responsibilityRunIdFor = (responsibility: WorkflowResponsibilityEntry) =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? responsibility.plannedAttempt.runId
    : responsibility._tag === "TaskWorktreeResponsibility"
      ? responsibility.operation.plannedAttempt.runId
      : null

type ResponsibilityIdentity = {
  readonly taskIds: ReadonlyArray<TaskId>
  readonly runIds: ReadonlyArray<RunId>
  readonly key: string
}

const responsibilityIdentityFor = (responsibility: WorkflowResponsibilityEntry): ResponsibilityIdentity => {
  const runId = responsibilityRunIdFor(responsibility)
  return {
    taskIds: responsibilityTaskIdsFor(responsibility),
    runIds: runId === null ? [] : [runId],
    key: workflowResponsibilityKey(responsibility)
  }
}

const plannedAttemptIdentityFor = (plannedAttempt: PlannedTaskAttempt): ResponsibilityIdentity => ({
  taskIds: [plannedAttempt.taskId],
  runIds: [plannedAttempt.runId],
  key: plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt))
})

const identityConflictFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  identity: ResponsibilityIdentity,
  detail: string
): DeliveryStatusProjectionConflict | null => {
  if (
    identity.taskIds.every((taskId) => taskId === delivery.taskId) &&
    identity.runIds.every((runId) => runId === subject.runId)
  ) {
    return null
  }
  return new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(
      canonicalIdentity(["responsibility-identity", delivery.taskId, identity.key])
    ),
    detail
  })
}

/** Rejects a responsibility whose embedded task or planned-attempt Run differs from its delivery. */
export const validateResponsibilityIdentityForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  responsibility: WorkflowResponsibilityEntry
): DeliveryStatusProjectionConflict | null =>
  identityConflictFor(
    subject,
    delivery,
    responsibilityIdentityFor(responsibility),
    "a responsibility standing embeds a task or planned-attempt Run identity different from its delivery"
  )

/** Rejects an integration wait or obligation whose planned attempt differs from its delivery subject. */
export const validatePlannedAttemptIdentityForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  plannedAttempt: PlannedTaskAttempt
): DeliveryStatusProjectionConflict | null =>
  identityConflictFor(
    subject,
    delivery,
    plannedAttemptIdentityFor(plannedAttempt),
    "an integration fact embeds a task or planned-attempt Run identity different from its delivery"
  )

const plannedAttemptForObligation = (
  obligation: Exclude<ExactWorkflowObligation, { readonly _tag: "WorkflowResponsibility" }>
): PlannedTaskAttempt =>
  obligation._tag === "AcceptedAwaitingIntegration"
    ? obligation.accepted.plannedAttempt
    : obligation.responsibility.plannedAttempt

/** Validates every retained obligation before any key-only lookup can trust its identity. */
export const validateDeliveryObligationsForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict | null => {
  for (const obligation of delivery.obligations) {
    const conflict =
      obligation._tag === "WorkflowResponsibility"
        ? validateResponsibilityIdentityForStatus(subject, delivery, obligation.responsibility)
        : validatePlannedAttemptIdentityForStatus(subject, delivery, plannedAttemptForObligation(obligation))
    if (conflict !== null) return conflict
  }
  return null
}
