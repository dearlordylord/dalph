import { Option } from "effect"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { acceptedOperationIdOf } from "../../workflow/registry/event-descriptor.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults
} from "../../workflow/protocols/integration-admission/protocol.js"
import { deriveIntegrationCandidateConstruction } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { deriveTargetVerificationState } from "../../workflow/protocols/target-verification/protocol.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import type { ExactTicketDeliveryEvidence, TicketDeliveryEvidence } from "./relations.js"

const targetVerificationEvidenceOf = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: Extract<
    ReturnType<typeof deriveIntegrationAdmission>["responsibilities"][number],
    { readonly _tag: "StartedIntegrationResponsibility" }
  >
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const constructed = records.findLast(
    ({ event }) =>
      event._tag === "IntegrationCandidateConstructed" &&
      event.correlation.runId === responsibility.plannedAttempt.runId &&
      event.correlation.attemptId === responsibility.plannedAttempt.attemptId
  )
  if (constructed?.event._tag !== "IntegrationCandidateConstructed") return []
  const verification = deriveTargetVerificationState(records, {
    candidateCommit: constructed.event.candidateCommit,
    correlation: constructed.event.correlation,
    constructedAt: constructed.position
  })
  return verification === undefined ? [] : [{ _tag: "TargetVerification", responsibility, state: verification }]
}

const integrationEvidenceOf = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: ReturnType<typeof deriveIntegrationAdmission>["responsibilities"][number]
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const initial =
    responsibility._tag === "QueuedIntegrationResponsibility"
      ? ({ _tag: "QueuedIntegration", responsibility } as const)
      : ({ _tag: "StartedIntegration", responsibility } as const)
  if (responsibility._tag !== "StartedIntegrationResponsibility") return [initial]
  const state = deriveIntegrationCandidateConstruction(records, responsibility)
  const candidateEvidence =
    state === undefined ? [] : [{ _tag: "IntegrationCandidate" as const, responsibility, state }]
  const verificationEvidence =
    state?._tag === "CandidateConstructed" ? targetVerificationEvidenceOf(records, responsibility) : []
  return [initial, ...candidateEvidence, ...verificationEvidence]
}

/** Every operation identity whose journal fact is available to delivery proposal derivation. */
export const acceptedOperationIdsOf = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> =>
  new Set(records.flatMap(({ event }) => Option.toArray(Option.fromUndefinedOr(acceptedOperationIdOf(event)))))

export const journaledIntegrationEvidenceOf = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  return [
    ...deriveUnqueuedAcceptedResults(records).map((accepted) => ({
      _tag: "AcceptedAwaitingIntegration" as const,
      accepted
    })),
    ...deriveIntegrationAdmission(records).responsibilities.flatMap((responsibility) =>
      integrationEvidenceOf(records, responsibility)
    )
  ]
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
  return [...evidence, ...journaledIntegrationEvidenceOf(frame.workflowHistory.records)]
}
