import { Option } from "effect"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { acceptedOperationIdOf } from "../../workflow/registry/event-descriptor.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  deriveConstructedIntegrationCandidateOccurrence,
  deriveIntegrationCandidateConstruction
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { deriveTargetVerificationState } from "../../workflow/protocols/target-verification/protocol.js"
import { deriveTargetPromotionStateFor } from "../../workflow/protocols/target-promotion/protocol.js"
import { deriveIntegrationFinalityStateFor } from "../../workflow/protocols/integration-finality/state.js"
import { completionTaskConfirmationDisposition } from "../../workflow/protocols/integration-finality/completion-task-protocol.js"
import { completionTaskRequestEquals } from "../../workflow/protocols/integration-finality/events.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import type { ExactTicketDeliveryEvidence, TicketDeliveryEvidence } from "./relations.js"
import { journalPrefixPredecessorOf } from "../../workflow-journal/prefix-lineage.js"

const focusedTaskCompletionSuccessOf = (
  { event, position }: JournalRecord,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  if (event._tag !== "TaskTrackerFactsObserved" || event.observation._tag !== "FocusedTaskCompletionFacts") return []
  const focused = event.observation
  const requestIntentPrecedesSuccess = records.some(
    (candidate) =>
      candidate.position < position &&
      candidate.event._tag === "CompletionTaskIntended" &&
      completionTaskRequestEquals(candidate.event.request, focused.request)
  )
  return requestIntentPrecedesSuccess &&
    completionTaskConfirmationDisposition(focused.request, focused.target, event.operationId, focused.facts)._tag ===
      "CompletedSuccessfully"
    ? [{ _tag: "FocusedTaskCompletionSuccess", observed: { ...event, observation: focused }, recordedAt: position }]
    : []
}

const targetVerificationEvidenceOf = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: Extract<
    ReturnType<typeof deriveIntegrationAdmission>["responsibilities"][number],
    { readonly _tag: "StartedIntegrationResponsibility" }
  >
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const constructed = Option.getOrThrow(
    Option.fromUndefinedOr(deriveConstructedIntegrationCandidateOccurrence(records, responsibility))
  )
  const verification = deriveTargetVerificationState(records, constructed)
  if (verification === undefined) return []
  const promotion =
    verification._tag === "VerificationPassed"
      ? deriveTargetPromotionStateFor(records, constructed, verification)
      : undefined
  return [
    { _tag: "TargetVerification", responsibility, state: verification },
    ...(promotion === undefined ? [] : [{ _tag: "TargetPromotion" as const, responsibility, state: promotion }])
  ]
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
const acceptedOperationIdsByPrefix = new WeakMap<ReadonlyArray<JournalRecord>, ReadonlySet<OperationId>>()

export const acceptedOperationIdsOf = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> => {
  const cached = acceptedOperationIdsByPrefix.get(records)
  if (cached !== undefined) return cached
  const predecessor = journalPrefixPredecessorOf(records)
  const operationIds = (() => {
    if (predecessor === undefined)
      return new Set(
        records.flatMap(({ event }) => Option.toArray(Option.fromUndefinedOr(acceptedOperationIdOf(event))))
      )
    const accepted = acceptedOperationIdOf(predecessor.appended.event)
    return accepted === undefined
      ? acceptedOperationIdsOf(predecessor.prior)
      : new Set(acceptedOperationIdsOf(predecessor.prior)).add(accepted)
  })()
  acceptedOperationIdsByPrefix.set(records, operationIds)
  return operationIds
}

const journaledIntegrationEvidenceByPrefix = new WeakMap<
  ReadonlyArray<JournalRecord>,
  ReadonlyArray<ExactTicketDeliveryEvidence>
>()

export const journaledIntegrationEvidenceOf = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const cached = journaledIntegrationEvidenceByPrefix.get(records)
  if (cached !== undefined) return cached
  const focusedCompletionSuccesses = records.flatMap((record) => focusedTaskCompletionSuccessOf(record, records))
  const finalitySettlements: ReadonlyArray<ExactTicketDeliveryEvidence> = records.flatMap(({ event }) =>
    event._tag === "IntegrationFinalitySettled" &&
    deriveIntegrationFinalityStateFor(records, event.claim)?._tag === "IntegrationFinalitySettled"
      ? [{ _tag: "IntegrationFinalitySettlement" as const, settlement: event }]
      : []
  )
  const evidence = [
    ...deriveUnqueuedAcceptedResults(records).map((accepted) => ({
      _tag: "AcceptedAwaitingIntegration" as const,
      accepted
    })),
    ...deriveIntegrationAdmission(records).responsibilities.flatMap((responsibility) =>
      integrationEvidenceOf(records, responsibility)
    ),
    ...focusedCompletionSuccesses,
    ...finalitySettlements
  ]
  journaledIntegrationEvidenceByPrefix.set(records, evidence)
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
  return [...evidence, ...journaledIntegrationEvidenceOf(frame.workflowHistory.records)]
}
