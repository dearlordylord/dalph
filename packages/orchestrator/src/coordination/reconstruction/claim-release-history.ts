import type { JournalRecord } from "../../workflow-journal/store.js"

const releaseIntentMatchesOutcome = (
  intent: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleaseIntended" }>,
  released: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleased" }>["release"]
): boolean =>
  intent.operation.release.claim.operationId === released.claim.operationId &&
  intent.operation.release.claim.owner === released.claim.owner &&
  intent.operation.release.claim.taskId === released.claim.taskId &&
  intent.operation.release.claim.token === released.claim.token

/** Returns why a release outcome does not match its earlier exact-claim intent. */
export const invalidTaskClaimRelease = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>
): string | undefined => {
  if (record.event._tag !== "TaskClaimReleased") return undefined
  const released = record.event.release
  const intent = records.find(
    ({ event, position }) =>
      position < record.position &&
      event._tag === "TaskClaimReleaseIntended" &&
      event.operation.release.operationId === released.operationId
  )?.event
  return intent?._tag !== "TaskClaimReleaseIntended" || !releaseIntentMatchesOutcome(intent, released)
    ? `released task claim contradicts operation ${released.operationId}`
    : undefined
}

export const validateTaskClaimRelease = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  const detail = invalidTaskClaimRelease(record, records)
  if (detail !== undefined) onInvalid(detail)
}
