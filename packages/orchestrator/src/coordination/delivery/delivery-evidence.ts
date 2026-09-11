import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { acceptedOperationIdOf } from "../../workflow/registry/event-descriptor.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  deriveCurrentIntegratorState,
  integratorRunQualifiedCandidateFromState
} from "../../workflow/protocols/integrator/state.js"
import { deriveTargetPromotionStateFor } from "../../workflow/protocols/target-promotion/protocol.js"
import { deriveIntegrationFinalityStateFor } from "../../workflow/protocols/integration-finality/state.js"
import { completionTaskConfirmationDisposition } from "../../workflow/protocols/integration-finality/completion-task-protocol.js"
import { completionTaskRequestEquals } from "../../workflow/protocols/integration-finality/events.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import type { ExactTicketDeliveryEvidence, TicketDeliveryEvidence } from "./relations.js"
import {
  journalRecordsForOperationId,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"

type StartedDeliveryResponsibility = Extract<
  ReturnType<typeof deriveIntegrationAdmission>["responsibilities"][number],
  { readonly _tag: "StartedIntegrationResponsibility" }
>
type IntegratorReconstructionState = ReturnType<typeof deriveCurrentIntegratorState>

const focusedTaskCompletionSuccessOf = (
  { event, position }: JournalRecord,
  records: JournalHistorySource
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  if (event._tag !== "TaskTrackerFactsObserved" || event.observation._tag !== "FocusedTaskCompletionFacts") return []
  const focused = event.observation
  const requestIntentPrecedesSuccess = Array.from(
    journalRecordsForOperationId(records, event.observation.request.operationId)
  ).some(
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

const integratorEvidenceOf = (
  responsibility: StartedDeliveryResponsibility,
  integratorState: IntegratorReconstructionState
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  if (integratorState._tag === "Absent") return []
  return [{ _tag: "IntegratorPreparation", responsibility, state: integratorState }]
}

const targetPromotionEvidenceOf = (
  records: JournalHistorySource,
  responsibility: StartedDeliveryResponsibility,
  integratorState: IntegratorReconstructionState
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  if (integratorState._tag !== "GitQualifiedPrepared") return []
  const promotion = deriveTargetPromotionStateFor(records, integratorRunQualifiedCandidateFromState(integratorState))
  if (promotion === undefined) return []
  return [{ _tag: "TargetPromotion", responsibility, state: promotion }]
}

const integrationEvidenceOf = (
  records: JournalHistorySource,
  responsibility: ReturnType<typeof deriveIntegrationAdmission>["responsibilities"][number]
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const initial =
    responsibility._tag === "QueuedIntegrationResponsibility"
      ? ({ _tag: "QueuedIntegration", responsibility } as const)
      : ({ _tag: "StartedIntegration", responsibility } as const)
  if (responsibility._tag !== "StartedIntegrationResponsibility") return [initial]
  const integratorState = deriveCurrentIntegratorState(records, responsibility)
  return [
    initial,
    ...integratorEvidenceOf(responsibility, integratorState),
    ...targetPromotionEvidenceOf(records, responsibility, integratorState)
  ]
}

const initiatingOperationKinds = [
  "PlannedAttemptReplaced",
  "TaskTrackerReadIntentRecorded",
  "GitReadIntentRecorded",
  "TaskClaimAcquisitionIntended",
  "TaskClaimReleaseIntended",
  "TaskAttemptPlanned",
  "TaskWorktreeReconciliationIntended"
] as const

/** Every operation identity whose initiating journal fact is available to delivery proposal derivation. */
const acceptedOperationIdsByPrefix = new WeakMap<object, ReadonlySet<OperationId>>()

export const acceptedOperationIdsOf = (records: JournalHistorySource): ReadonlySet<OperationId> => {
  const cached = acceptedOperationIdsByPrefix.get(records)
  if (cached !== undefined) return cached
  const operationIds = new Set<OperationId>()
  for (const kind of initiatingOperationKinds) {
    for (const { event } of journalRecordsOfKind(records, kind)) {
      const accepted = acceptedOperationIdOf(event)
      if (accepted !== undefined) operationIds.add(accepted)
    }
  }
  acceptedOperationIdsByPrefix.set(records, operationIds)
  return operationIds
}

/** Ordinary tracker or Git read identities whose journal-first intent has no typed outcome yet. */
export const pendingReadOperationIdsOf = (records: JournalHistorySource): ReadonlySet<OperationId> => {
  const completed = new Set(
    [
      ...journalRecordsOfKind(records, "TaskTrackerFactsObserved"),
      ...journalRecordsOfKind(records, "PlannedAttemptWorktreeObserved"),
      ...journalRecordsOfKind(records, "TargetLineageObserved"),
      ...journalRecordsOfKind(records, "AttemptRestartAuthorityReadFailed")
    ].flatMap(({ event }) => {
      if (event._tag === "TaskTrackerFactsObserved") return [event.operationId]
      if (event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved") {
        return [event.operationId]
      }
      if (
        event._tag === "AttemptRestartAuthorityReadFailed" &&
        event.failure._tag !== "AttemptRestartTaskFactsReadFailure"
      ) {
        return [event.operationId]
      }
      return []
    })
  )
  return new Set(
    [
      ...journalRecordsOfKind(records, "GitReadIntentRecorded"),
      ...journalRecordsOfKind(records, "TaskTrackerReadIntentRecorded")
    ].flatMap(({ event }) =>
      (event._tag === "GitReadIntentRecorded" || event._tag === "TaskTrackerReadIntentRecorded") &&
      !completed.has(event.operation.operationId)
        ? [event.operation.operationId]
        : []
    )
  )
}

const journaledIntegrationEvidenceByPrefix = new WeakMap<object, ReadonlyArray<ExactTicketDeliveryEvidence>>()

export const journaledIntegrationEvidenceOf = (
  records: JournalHistorySource
): ReadonlyArray<ExactTicketDeliveryEvidence> => {
  const cached = journaledIntegrationEvidenceByPrefix.get(records)
  if (cached !== undefined) return cached
  const focusedCompletionSuccesses = Array.from(journalRecordsOfKind(records, "TaskTrackerFactsObserved")).flatMap(
    (record) => focusedTaskCompletionSuccessOf(record, records)
  )
  const finalitySettlements: ReadonlyArray<ExactTicketDeliveryEvidence> = Array.from(
    journalRecordsOfKind(records, "IntegrationFinalitySettled")
  ).flatMap(({ event }) =>
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

/** Derives exact delivery evidence from journal facts, never from a second runnable-frontier projection. */
export const ticketDeliveryEvidenceOf = (
  frame: CurrentDeliveryFrame,
  responsibilityFacts: ReadonlyArray<ResponsibilityFreshFacts>
): ReadonlyArray<TicketDeliveryEvidence> => {
  const evidence: ReadonlyArray<TicketDeliveryEvidence> = responsibilityFacts.map((facts) => ({
    _tag: "ResponsibilityFacts",
    facts
  }))
  return [...evidence, ...journaledIntegrationEvidenceOf(frame.workflowHistory.prefix ?? frame.workflowHistory.records)]
}
