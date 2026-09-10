import { HashMap, Option } from "effect"
import type { RunId } from "@dalph/contracts"
import type { JournalRecordKey } from "./identity.js"
import type { JournalRecord } from "./store.js"
import { appendJournalRecord, emptyJournalRecords, type JournalRecordSequence } from "./record-sequence.js"

const AcceptedJournalPrefixTypeId: unique symbol = Symbol("AcceptedJournalPrefix")
const JournalSuccessorProvenanceTypeId: unique symbol = Symbol("JournalSuccessorProvenance")
const JournalPrefixIdentityTypeId: unique symbol = Symbol("JournalPrefixIdentity")

/** Process-local constructor identity, without a reference to prefix storage. */
export interface JournalPrefixIdentity {
  readonly [JournalPrefixIdentityTypeId]: symbol
}

const identityByPrefix = new WeakMap<AcceptedJournalPrefix, JournalPrefixIdentity>()

const prefixIdentity = (prefix: AcceptedJournalPrefix): JournalPrefixIdentity => {
  const existing = identityByPrefix.get(prefix)
  if (existing !== undefined) return existing
  const identity = { [JournalPrefixIdentityTypeId]: Symbol() }
  identityByPrefix.set(prefix, identity)
  return identity
}

interface AcceptedRecordIndexes {
  readonly byKey: HashMap.HashMap<JournalRecordKey, JournalRecord>
  readonly byKind: HashMap.HashMap<JournalRecord["event"]["_tag"], JournalRecordSequence>
}

/**
 * The exact immutable records whose semantics the chronological validator has
 * accepted. It certifies journal history only, never current outside facts.
 */
export interface AcceptedJournalPrefix {
  readonly [AcceptedJournalPrefixTypeId]: AcceptedRecordIndexes
  readonly records: JournalRecordSequence
  readonly runId: RunId
}

/** Exact constructor-owned predecessor/successor relationship after semantic acceptance. */
export interface JournalSuccessorProvenance {
  readonly [JournalSuccessorProvenanceTypeId]: true
  readonly predecessor: JournalPrefixIdentity
  readonly record: JournalRecord
}

const provenanceByPrefix = new WeakMap<AcceptedJournalPrefix, JournalSuccessorProvenance>()

/** Used only by the chronological validator after it has accepted the complete input. */
export const acceptedJournalPrefixFromValidatedHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): AcceptedJournalPrefix => {
  const empty: AcceptedJournalPrefix = {
    [AcceptedJournalPrefixTypeId]: { byKey: HashMap.empty(), byKind: HashMap.empty() },
    records: emptyJournalRecords(),
    runId
  }
  return records.reduce(appendValidatedJournalRecord, empty)
}

/** Used only after the successor kernel accepts this record against this exact predecessor. */
export const appendValidatedJournalRecord = (
  prior: AcceptedJournalPrefix,
  record: JournalRecord
): AcceptedJournalPrefix => {
  const indexes = prior[AcceptedJournalPrefixTypeId]
  const kindRecords = Option.getOrElse(HashMap.get(indexes.byKind, record.event._tag), emptyJournalRecords)
  const next: AcceptedJournalPrefix = {
    [AcceptedJournalPrefixTypeId]: {
      byKey: HashMap.set(indexes.byKey, record.key, record),
      byKind: HashMap.set(indexes.byKind, record.event._tag, appendJournalRecord(kindRecords, record))
    },
    records: appendJournalRecord(prior.records, record),
    runId: prior.runId
  }
  provenanceByPrefix.set(next, { [JournalSuccessorProvenanceTypeId]: true, predecessor: prefixIdentity(prior), record })
  return next
}

export const acceptedJournalRecordForKey = (
  prefix: AcceptedJournalPrefix,
  key: JournalRecordKey
): JournalRecord | undefined => Option.getOrUndefined(HashMap.get(prefix[AcceptedJournalPrefixTypeId].byKey, key))

export const acceptedJournalRecordsForKind = (
  prefix: AcceptedJournalPrefix,
  kind: JournalRecord["event"]["_tag"]
): JournalRecordSequence =>
  Option.getOrElse(HashMap.get(prefix[AcceptedJournalPrefixTypeId].byKind, kind), emptyJournalRecords)

export const acceptedJournalSuccessorProvenance = (
  prefix: AcceptedJournalPrefix
): JournalSuccessorProvenance | undefined => provenanceByPrefix.get(prefix)
