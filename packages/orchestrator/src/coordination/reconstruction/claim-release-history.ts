import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordsForOperationId,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"

const releaseIntentMatchesOutcome = (
  intent: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleaseIntended" }>,
  released: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleased" }>["release"]
): boolean =>
  intent.operation.release.claim.operationId === released.claim.operationId &&
  intent.operation.release.claim.owner === released.claim.owner &&
  intent.operation.release.claim.taskId === released.claim.taskId &&
  intent.operation.release.claim.token === released.claim.token

/** Raw diagnostic histories retain the first matching intent, including malformed duplicate operation identities. */
const firstReleaseIntentBefore = (records: JournalHistorySource, operationId: OperationId, before: JournalPosition) => {
  const accepted = isJournalRecordEvidence(records) ? journalEvidenceBefore(records, before) : records
  for (const candidate of journalRecordsForOperationId(accepted, operationId)) {
    if (
      candidate.position < before &&
      candidate.event._tag === "TaskClaimReleaseIntended" &&
      candidate.event.operation.release.operationId === operationId
    ) {
      return candidate.event
    }
  }
  return undefined
}

/** Returns why a release outcome does not match its earlier exact-claim intent. */
export const invalidTaskClaimRelease = (record: JournalRecord, records: JournalHistorySource): string | undefined => {
  if (record.event._tag !== "TaskClaimReleased") return undefined
  const released = record.event.release
  const intent = firstReleaseIntentBefore(records, released.operationId, record.position)
  return intent?._tag !== "TaskClaimReleaseIntended" || !releaseIntentMatchesOutcome(intent, released)
    ? `released task claim contradicts operation ${released.operationId}`
    : undefined
}

export const validateTaskClaimRelease = (
  record: JournalRecord,
  records: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  const detail = invalidTaskClaimRelease(record, records)
  if (detail !== undefined) onInvalid(detail)
}
