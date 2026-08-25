import type { TicketDelivery, TicketDeliveryStanding } from "./relations.js"
import {
  DeliveryStatusProjectionConflict,
  makeDeliveryStatusEntryIdentity,
  type DeliveryStatusAcceptedStandingSettlement,
  type DeliveryStatusSubject
} from "./delivery-status-model.js"
import { acceptedStandingSettlementTagFor } from "./delivery-status-responsibility-semantics.js"
import { addEntry, canonicalIdentity, type OrderedStatusEntry, type StatusTaskOrder } from "./delivery-status-order.js"

type ResponsibilityStanding = Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>

/** Builds the accepted terminal standing without recreating an outstanding obligation. */
const acceptedStandingSettlementFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding
): DeliveryStatusAcceptedStandingSettlement | null => {
  const tag = acceptedStandingSettlementTagFor(standing.facts)
  if (tag === null || standing.facts._tag !== "PlannedAttemptExecutorFreshFacts") return null
  const disposition = standing.facts.disposition
  if (disposition._tag !== "CancelledAttemptSettled" && disposition._tag !== "StoppedAttemptSettled") return null
  const responsibility = standing.facts.responsibility
  if (
    responsibility.plannedAttempt.taskId !== delivery.taskId ||
    responsibility.plannedAttempt.runId !== subject.runId
  ) {
    return null
  }
  const base = { _tag: "AcceptedStandingSettlement" as const }
  return tag === "CancelledAttemptSettled"
    ? {
        ...base,
        standing: {
          _tag: "CancelledAttemptSettled" as const,
          claimDisposition: disposition.claimDisposition,
          responsibility
        }
      }
    : {
        ...base,
        standing: {
          _tag: "StoppedAttemptSettled" as const,
          claimDisposition: disposition.claimDisposition,
          responsibility
        }
      }
}

const taskStatusSubject = (subject: DeliveryStatusSubject, taskId: TicketDelivery["taskId"]): DeliveryStatusSubject =>
  subject._tag === "Task" ? subject : { _tag: "Task", runId: subject.runId, taskId }

export const addAcceptedStandingSettlementEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const settlement = acceptedStandingSettlementFor(subject, delivery, standing)
  if (settlement === null) return
  addEntry(
    entries,
    {
      _tag: "Settlement",
      classification: "Settled",
      subject: taskStatusSubject(subject, delivery.taskId),
      taskId: delivery.taskId,
      attemptId: settlement.standing.responsibility.plannedAttempt.attemptId,
      settlement
    },
    taskOrder
  )
}

const acceptedStandingProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(
      canonicalIdentity(["accepted-standing-settlement", delivery.taskId, standing.facts.disposition._tag])
    ),
    detail: "an accepted settled standing has a mismatched planned-attempt task or Run identity"
  })

export const validateAcceptedStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding
): DeliveryStatusProjectionConflict | null => {
  if (acceptedStandingSettlementTagFor(standing.facts) === null) return null
  if (standing.facts._tag !== "PlannedAttemptExecutorFreshFacts") {
    return acceptedStandingProjectionConflict(subject, delivery, standing)
  }
  const responsibility = standing.facts.responsibility
  return responsibility.plannedAttempt.taskId !== delivery.taskId ||
    responsibility.plannedAttempt.runId !== subject.runId
    ? acceptedStandingProjectionConflict(subject, delivery, standing)
    : null
}
