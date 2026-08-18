import type { JournalRecord } from "./store.js"

/** Total lookup result for one journal key; duplicate history is not absence. */
type ExactJournalRecordAtKey =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Duplicate"; readonly detail: string }
  | { readonly _tag: "Found"; readonly record: JournalRecord }

/** Finds exactly one record at a key without encoding contradiction as a string sentinel. */
export const exactJournalRecordAtKey = (
  records: ReadonlyArray<JournalRecord>,
  key: JournalRecord["key"]
): ExactJournalRecordAtKey => {
  const matches = records.filter((record) => record.key === key)
  if (matches.length > 1) {
    return { _tag: "Duplicate", detail: "Journal history contains duplicate records for one exact key" }
  }
  const record = matches[0]
  return record === undefined ? { _tag: "Missing" } : { _tag: "Found", record }
}
