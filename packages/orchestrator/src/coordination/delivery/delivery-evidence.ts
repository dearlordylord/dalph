import { plannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelationKey } from "@dalph/contracts"
import { Option } from "effect"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { acceptedOperationIdOf } from "../../workflow/registry/event-descriptor.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults
} from "../../workflow/protocols/integration-admission/protocol.js"
import { deriveIntegrationCandidateConstruction } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import type { ExactTicketDeliveryEvidence, TicketDeliveryEvidence } from "./relations.js"

/** Every operation identity whose journal fact is available to delivery proposal derivation. */
export const acceptedOperationIdsOf = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> =>
  new Set(records.flatMap(({ event }) => Option.toArray(Option.fromUndefinedOr(acceptedOperationIdOf(event)))))

const syntheticExecutorEvidenceOf = (
  frame: Extract<CurrentDeliveryFrame, { readonly _tag: "SyntheticCurrentDeliveryFrame" }>
): ReadonlyArray<TicketDeliveryEvidence> => {
  const latestByAttempt = new Map<
    string,
    Extract<(typeof frame.workflowFacts)[number], { readonly _tag: "PlannedAttemptExecutorWorkReported" }>
  >()
  for (const fact of frame.workflowFacts) {
    if (fact._tag === "PlannedAttemptExecutorWorkReported") {
      latestByAttempt.set(
        plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(fact.plannedAttempt)),
        fact
      )
    }
  }
  return [...latestByAttempt.values()].map((fact) => ({
    _tag: "SyntheticExecutorFacts",
    plannedAttempt: fact.plannedAttempt,
    report: fact.report
  }))
}

export const journaledIntegrationEvidenceOf = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const evidence: Array<ExactTicketDeliveryEvidence> = deriveUnqueuedAcceptedResults(records).map((accepted) => ({
    _tag: "AcceptedAwaitingIntegration",
    accepted
  }))
  for (const responsibility of deriveIntegrationAdmission(records).responsibilities) {
    evidence.push(
      responsibility._tag === "QueuedIntegrationResponsibility"
        ? { _tag: "QueuedIntegration", responsibility }
        : { _tag: "StartedIntegration", responsibility }
    )
    if (responsibility._tag === "StartedIntegrationResponsibility") {
      const state = deriveIntegrationCandidateConstruction(records, responsibility)
      if (state !== undefined) evidence.push({ _tag: "IntegrationCandidate", responsibility, state })
    }
  }
  return evidence
}

/** Derives exact delivery evidence from journal facts, never from the legacy runnable frontier. */
export const ticketDeliveryEvidenceOf = (
  frame: CurrentDeliveryFrame,
  responsibilityFacts: ReadonlyArray<ResponsibilityFreshFacts>
): ReadonlyArray<TicketDeliveryEvidence> => {
  const evidence: ReadonlyArray<TicketDeliveryEvidence> = responsibilityFacts.map((facts) => ({
    _tag: "ResponsibilityFacts",
    facts
  }))
  return frame._tag === "SyntheticCurrentDeliveryFrame"
    ? [...evidence, ...syntheticExecutorEvidenceOf(frame)]
    : [...evidence, ...journaledIntegrationEvidenceOf(frame.workflowHistory.records)]
}
