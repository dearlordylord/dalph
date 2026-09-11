import type { RunId } from "@dalph/contracts"
import type { JournalRecordKey } from "./identity.js"
import type { JournalRecord } from "./store.js"
import { type JournalRecordSequence } from "./record-sequence.js"
import {
  appendJournalEvidence,
  journalEvidenceFrom,
  retainJournalEvidence,
  journalRecordByKey,
  journalEvidenceKindSequence,
  inspectJournalEvidenceStorage,
  type JournalRecordEvidence
} from "./record-evidence.js"

const AcceptedJournalPrefixTypeId: unique symbol = Symbol("AcceptedJournalPrefix")
const JournalSuccessorProvenanceTypeId: unique symbol = Symbol("JournalSuccessorProvenance")
const JournalPrefixIdentityTypeId: unique symbol = Symbol("JournalPrefixIdentity")

/** Process-local constructor identity, without a reference to prefix storage. */
export interface JournalPrefixIdentity {
  readonly [JournalPrefixIdentityTypeId]: symbol
}

const identityByPrefix = new WeakMap<AcceptedJournalPrefix, JournalPrefixIdentity>()

export const acceptedJournalPrefixIdentity = (prefix: AcceptedJournalPrefix): JournalPrefixIdentity => {
  const existing = identityByPrefix.get(prefix)
  if (existing !== undefined) return existing
  const identity = { [JournalPrefixIdentityTypeId]: Symbol() }
  identityByPrefix.set(prefix, identity)
  return identity
}

/**
 * The exact immutable records whose semantics the chronological validator has
 * accepted. It certifies journal history only, never current outside facts.
 */
export interface AcceptedJournalPrefix extends JournalRecordEvidence {
  readonly [AcceptedJournalPrefixTypeId]: true
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
  return acceptedJournalPrefixFromValidatedEvidence(runId, journalEvidenceFrom(records))
}

/** The chronological kernel certifies these already-built roots only after every semantic check succeeds. */
export const acceptedJournalPrefixFromValidatedEvidence = (
  runId: RunId,
  source: JournalRecordEvidence
): AcceptedJournalPrefix => retainJournalEvidence(source, { ...source, [AcceptedJournalPrefixTypeId]: true, runId })

/** Used only after the successor kernel accepts this record against this exact predecessor. */
export const appendValidatedJournalRecord = (
  prior: AcceptedJournalPrefix,
  record: JournalRecord
): AcceptedJournalPrefix => {
  const source = appendJournalEvidence(prior, record)
  const next: AcceptedJournalPrefix = retainJournalEvidence(source, {
    ...source,
    [AcceptedJournalPrefixTypeId]: true,
    runId: prior.runId
  })
  provenanceByPrefix.set(next, {
    [JournalSuccessorProvenanceTypeId]: true,
    predecessor: acceptedJournalPrefixIdentity(prior),
    record
  })
  return next
}

export const acceptedJournalRecordForKey = (
  prefix: AcceptedJournalPrefix,
  key: JournalRecordKey
): JournalRecord | undefined => journalRecordByKey(prefix, key)

export const acceptedJournalRecordsForKind = (
  prefix: AcceptedJournalPrefix,
  kind: JournalRecord["event"]["_tag"]
): JournalRecordSequence => journalEvidenceKindSequence(prefix, kind)

export const acceptedJournalSuccessorProvenance = (
  prefix: AcceptedJournalPrefix
): JournalSuccessorProvenance | undefined => provenanceByPrefix.get(prefix)

/** Test-only retained roots, including private per-kind and ordered record storage. */
export const inspectAcceptedPrefixStorage = (prefix: AcceptedJournalPrefix): ReadonlyArray<object> => {
  return inspectJournalEvidenceStorage(prefix)
}
