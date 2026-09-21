import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { remotePublicationCorrelationEquals, remotePublicationCorrelationFor } from "../direct-publication/events.js"
import { deriveRemotePublicationState } from "../direct-publication/state.js"
import { remotePublicationEventsFor } from "../direct-publication/transition-journal.js"
import type { CompletionTaskClaim } from "./events.js"

/** Exact publication proof required before finality may mutate the tracker. */
export const exactPublicationWasObserved = (
  records: JournalHistorySource,
  claim: CompletionTaskClaim,
  before?: JournalPosition
): boolean => {
  const accepted =
    before === undefined
      ? records
      : isJournalRecordEvidence(records)
        ? journalEvidenceBefore(records, before)
        : records.filter((record) => record.position < before)
  const began = Array.from(journalRecordsOfKind(accepted, "WorkflowRunBegan"))[0]
  if (began?.event._tag !== "WorkflowRunBegan") return false
  const expected = remotePublicationCorrelationFor(
    claim.promotionCorrelation.qualifiedCandidate,
    began.event.remotePublicationTarget
  )
  const state = deriveRemotePublicationState(remotePublicationEventsFor(accepted, expected))
  return state._tag === "PublicationSucceeded" && remotePublicationCorrelationEquals(state.correlation, expected)
}

/** Journal proof validation; invalid history is not evidence of a later remote Git observation. */
export const publicationPremiseFor = (
  records: JournalHistorySource,
  claim: CompletionTaskClaim
): "Proved" | "Missing" | "HistoryInvalid" => {
  const began = Array.from(journalRecordsOfKind(records, "WorkflowRunBegan"))[0]
  if (began?.event._tag !== "WorkflowRunBegan") return "Missing"
  const expected = remotePublicationCorrelationFor(
    claim.promotionCorrelation.qualifiedCandidate,
    began.event.remotePublicationTarget
  )
  const state = deriveRemotePublicationState(remotePublicationEventsFor(records, expected))
  if (state._tag === "PublicationContradiction") return "HistoryInvalid"
  return state._tag === "PublicationSucceeded" && remotePublicationCorrelationEquals(state.correlation, expected)
    ? "Proved"
    : "Missing"
}
