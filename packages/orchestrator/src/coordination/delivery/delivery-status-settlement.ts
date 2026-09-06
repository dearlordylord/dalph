import { plannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelationKey } from "@dalph/contracts"
import type { TicketDelivery, TicketDeliveryStanding } from "./relations.js"
import {
  DeliveryStatusProjectionConflict,
  makeDeliveryStatusEntryIdentity,
  type DeliveryStatusAcceptedStandingSettlement,
  type DeliveryStatusSubject
} from "./delivery-status-model.js"
import { acceptedStandingSettlementDispositionFor } from "./delivery-status-responsibility-semantics.js"
import { addEntry, canonicalIdentity, type OrderedStatusEntry, type StatusTaskOrder } from "./delivery-status-order.js"
import { taskStatusSubject } from "./delivery-status-subject.js"
import { workflowResponsibilityKey } from "../reconstruction/state.js"

type ResponsibilityStanding = Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }>
const acceptedStandingCompositionOf = (standing: TicketDeliveryStanding) => {
  if (standing._tag !== "ResponsibilitySituation" || standing.facts._tag !== "PlannedAttemptExecutorFreshFacts") {
    return null
  }
  const disposition = acceptedStandingSettlementDispositionFor(standing.facts)
  if (disposition === null) return null
  return {
    disposition,
    responsibility: standing.facts.responsibility,
    correlationKey: plannedAttemptExecutorCorrelationKey(
      plannedAttemptExecutorCorrelation(standing.facts.responsibility.plannedAttempt)
    )
  }
}
const integrationObligationMatches = (delivery: TicketDelivery, correlationKey: string): boolean =>
  delivery.obligations.some((obligation) => {
    if (obligation._tag === "QueuedIntegration") {
      return (
        plannedAttemptExecutorCorrelationKey(
          plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt)
        ) === correlationKey
      )
    }
    if (obligation._tag === "StartedIntegration") {
      return (
        plannedAttemptExecutorCorrelationKey(
          plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt)
        ) === correlationKey
      )
    }
    return false
  })

const acceptedStandingCompositionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  correlationKey: string,
  detail: string
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(
      canonicalIdentity(["accepted-standing-settlement", delivery.taskId, correlationKey, "composition"])
    ),
    detail
  })

/** Rejects impossible cross-standing and integration-lifecycle compositions before entry building. */
export const validateAcceptedStandingCompositionForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery
): DeliveryStatusProjectionConflict | null => {
  const acceptedCompositions = delivery.standings.flatMap((standing) => {
    const accepted = acceptedStandingCompositionOf(standing)
    return accepted === null ? [] : [accepted]
  })
  for (const [index, accepted] of acceptedCompositions.entries()) {
    const previous = acceptedCompositions
      .slice(0, index)
      .find(({ correlationKey }) => correlationKey === accepted.correlationKey)
    if (previous !== undefined && previous.disposition._tag !== accepted.disposition._tag) {
      return acceptedStandingCompositionConflict(
        subject,
        delivery,
        accepted.correlationKey,
        "one planned-attempt correlation has contradictory cancelled and stopped settlements"
      )
    }
    if (integrationObligationMatches(delivery, accepted.correlationKey)) {
      return acceptedStandingCompositionConflict(
        subject,
        delivery,
        accepted.correlationKey,
        "an accepted settled standing shares its planned-attempt correlation with a queued or started integration"
      )
    }
  }
  return null
}

type AcceptedStandingSettlementResolution =
  | { readonly _tag: "NotAccepted" }
  | { readonly _tag: "Accepted"; readonly settlement: DeliveryStatusAcceptedStandingSettlement }
  | {
      readonly _tag: "ProjectionConflict"
      readonly reason: "MismatchedPlannedAttemptIdentity" | "OutstandingWorkflowResponsibility"
    }
type AcceptedStandingSettlementConflictReason = Extract<
  AcceptedStandingSettlementResolution,
  { readonly _tag: "ProjectionConflict" }
>["reason"]

/** Classifies and validates one accepted terminal standing for both entry building and conflict validation. */
const acceptedStandingSettlementResolutionFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding
): AcceptedStandingSettlementResolution => {
  // The accepted terminal dispositions are restricted to executor fresh facts by
  // ResponsibilityFreshFacts; workflow-operation facts cannot form this variant.
  if (standing.facts._tag !== "PlannedAttemptExecutorFreshFacts") return { _tag: "NotAccepted" }
  const disposition = acceptedStandingSettlementDispositionFor(standing.facts)
  if (disposition === null) return { _tag: "NotAccepted" }
  const responsibility = standing.facts.responsibility
  if (
    responsibility.plannedAttempt.taskId !== delivery.taskId ||
    responsibility.plannedAttempt.runId !== subject.runId
  ) {
    return { _tag: "ProjectionConflict", reason: "MismatchedPlannedAttemptIdentity" }
  }
  if (
    delivery.obligations.some(
      (obligation) =>
        obligation._tag === "WorkflowResponsibility" &&
        workflowResponsibilityKey(obligation.responsibility) === workflowResponsibilityKey(responsibility)
    )
  ) {
    return { _tag: "ProjectionConflict", reason: "OutstandingWorkflowResponsibility" }
  }
  return {
    _tag: "Accepted",
    settlement:
      disposition._tag === "CancelledAttemptSettled"
        ? { _tag: "CancelledAttemptSettled" as const, claimDisposition: disposition.claimDisposition, responsibility }
        : { _tag: "StoppedAttemptSettled" as const, claimDisposition: disposition.claimDisposition, responsibility }
  }
}

export const addAcceptedStandingSettlementEntryFor = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding,
  taskOrder: StatusTaskOrder,
  entries: Array<OrderedStatusEntry>
): void => {
  const resolution = acceptedStandingSettlementResolutionFor(subject, delivery, standing)
  if (resolution._tag !== "Accepted") return
  addEntry(
    entries,
    {
      _tag: "Settlement",
      classification: "Settled",
      subject: taskStatusSubject(subject, delivery.taskId),
      settlement: resolution.settlement
    },
    taskOrder
  )
}

const acceptedStandingProjectionConflict = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding,
  reason: AcceptedStandingSettlementConflictReason
): DeliveryStatusProjectionConflict =>
  new DeliveryStatusProjectionConflict({
    subject,
    entryIdentity: makeDeliveryStatusEntryIdentity(
      canonicalIdentity(["accepted-standing-settlement", delivery.taskId, standing.facts.disposition._tag])
    ),
    detail:
      reason === "OutstandingWorkflowResponsibility"
        ? "an accepted settled standing still has a matching outstanding workflow responsibility"
        : "an accepted settled standing has a mismatched planned-attempt task or Run identity"
  })

export const validateAcceptedStandingForStatus = (
  subject: DeliveryStatusSubject,
  delivery: TicketDelivery,
  standing: ResponsibilityStanding
): DeliveryStatusProjectionConflict | null => {
  const resolution = acceptedStandingSettlementResolutionFor(subject, delivery, standing)
  return resolution._tag === "ProjectionConflict"
    ? acceptedStandingProjectionConflict(subject, delivery, standing, resolution.reason)
    : null
}
