import { HashMap, Option } from "effect"
import type { JournalRecord } from "./store.js"

const JournalRecordSequenceTypeId: unique symbol = Symbol("JournalRecordSequence")

/**
 * An immutable ordered sequence of decoded journal records. The sequence does
 * not certify semantic validity. Appends share persistent storage, and a prefix
 * view cannot expose records after its exact exclusive upper bound.
 */
export interface JournalRecordSequence {
  readonly [JournalRecordSequenceTypeId]: HashMap.HashMap<number, JournalRecord>
  readonly length: number
}

export const emptyJournalRecords = (): JournalRecordSequence => ({
  [JournalRecordSequenceTypeId]: HashMap.empty(),
  length: 0
})

/** Adds one decoded record without traversing or copying the existing prefix. */
export const appendJournalRecord = (prior: JournalRecordSequence, record: JournalRecord): JournalRecordSequence => ({
  [JournalRecordSequenceTypeId]: HashMap.set(prior[JournalRecordSequenceTypeId], prior.length, record),
  length: prior.length + 1
})

/** Zero-based access; a negative offset counts back from this exact prefix. */
export const journalRecordAt = (records: JournalRecordSequence, offset: number): JournalRecord | undefined => {
  const index = offset < 0 ? records.length + offset : offset
  return index < 0 || index >= records.length
    ? undefined
    : Option.getOrUndefined(HashMap.get(records[JournalRecordSequenceTypeId], index))
}

/** Shares storage while exposing only records before an exclusive zero-based offset. */
export const journalRecordsBefore = (records: JournalRecordSequence, exclusiveEnd: number): JournalRecordSequence => ({
  [JournalRecordSequenceTypeId]: records[JournalRecordSequenceTypeId],
  length: Math.max(0, Math.min(records.length, exclusiveEnd))
})

/** Explicit export boundary; live successor validation must use indexed access. */
export const materializeJournalRecords = (records: JournalRecordSequence): ReadonlyArray<JournalRecord> =>
  Array.from({ length: records.length }, (_, index) =>
    Option.getOrThrow(HashMap.get(records[JournalRecordSequenceTypeId], index))
  )

/** Imports decoded storage history once at establishment, without certifying its semantics. */
export const journalRecordsFrom = (records: ReadonlyArray<JournalRecord>): JournalRecordSequence =>
  records.reduce(appendJournalRecord, emptyJournalRecords())
