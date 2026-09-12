import { HashMap, Option } from "effect"
import type { OperationId } from "../workflow/identity.js"
import type { AttemptChoiceRequestId } from "../workflow/protocols/attempt-choice/events.js"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendJournalRecord,
  emptyJournalRecords,
  inspectJournalRecordStorage,
  journalRecordAt,
  type JournalRecordSequence
} from "./record-sequence.js"

const StopRequestDispositionEvidenceTypeId: unique symbol = Symbol("StopRequestDispositionEvidence")
const lastOffset = -1
const partitions = 2
/** A Stop request's abandonment and exact claim disposition form one chronology, independent of other attempts on the same task. Derived evidence correlates arbitrary release operation identities; it grants no claim-release authority. */
export interface StopRequestDispositionEvidence {
  readonly [StopRequestDispositionEvidenceTypeId]: true
}
type DispositionKind =
  | "AttemptImplementationAbandoned"
  | "TaskClaimReleaseIntended"
  | "TaskClaimReleased"
  | "StoppedAttemptClaimNoReleaseObserved"
interface Roots {
  readonly byRequestKind: HashMap.HashMap<string, JournalRecordSequence>
  readonly releaseIntents: HashMap.HashMap<OperationId, JournalRecordSequence>
}
const rootsByIndex = new WeakMap<StopRequestDispositionEvidence, Roots>()
const retain = (roots: Roots): StopRequestDispositionEvidence => {
  const index: StopRequestDispositionEvidence = { [StopRequestDispositionEvidenceTypeId]: true }
  rootsByIndex.set(index, roots)
  return index
}
const rootsOf = (index: StopRequestDispositionEvidence) =>
  Option.getOrThrow(Option.fromUndefinedOr(rootsByIndex.get(index)))
export const emptyStopRequestDisposition = (): StopRequestDispositionEvidence =>
  retain({ byRequestKind: HashMap.empty(), releaseIntents: HashMap.empty() })
const keyFor = (request: AttemptChoiceRequestId, kind: DispositionKind) =>
  JSON.stringify([request.runId, request.nonce, kind])
const priorStopRequestForRelease = (
  roots: Roots,
  operationId: OperationId,
  position: JournalPosition
): AttemptChoiceRequestId | undefined => {
  const intents = Option.getOrElse(HashMap.get(roots.releaseIntents, operationId), emptyJournalRecords)
  const intent = lastVisible(intents, position - 1)
  return intent !== undefined &&
    intent.position < position &&
    intent.event._tag === "TaskClaimReleaseIntended" &&
    intent.event.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"
    ? intent.event.operation.authority.requestId
    : undefined
}
const requestFor = (roots: Roots, record: JournalRecord): AttemptChoiceRequestId | undefined => {
  const event = record.event
  if (event._tag === "AttemptImplementationAbandoned" || event._tag === "StoppedAttemptClaimNoReleaseObserved")
    return event.requestId
  if (event._tag === "TaskClaimReleaseIntended")
    return event.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"
      ? event.operation.authority.requestId
      : undefined
  return event._tag === "TaskClaimReleased"
    ? priorStopRequestForRelease(roots, event.release.operationId, record.position)
    : undefined
}

/** Chronological indexing never resolves an earlier outcome using a future intent; even non-Stop duplicate intents remain visible to correlation. */
export const appendStopRequestDisposition = (
  index: StopRequestDispositionEvidence,
  record: JournalRecord
): StopRequestDispositionEvidence => {
  const event = record.event
  if (
    event._tag !== "AttemptImplementationAbandoned" &&
    event._tag !== "TaskClaimReleaseIntended" &&
    event._tag !== "TaskClaimReleased" &&
    event._tag !== "StoppedAttemptClaimNoReleaseObserved"
  )
    return index
  const roots = rootsOf(index)
  const request = requestFor(roots, record)
  const key = request === undefined ? undefined : keyFor(request, event._tag)
  return retain({
    byRequestKind:
      key === undefined
        ? roots.byRequestKind
        : HashMap.set(
            roots.byRequestKind,
            key,
            appendJournalRecord(Option.getOrElse(HashMap.get(roots.byRequestKind, key), emptyJournalRecords), record)
          ),
    releaseIntents:
      event._tag === "TaskClaimReleaseIntended"
        ? HashMap.set(
            roots.releaseIntents,
            event.operation.release.operationId,
            appendJournalRecord(
              Option.getOrElse(
                HashMap.get(roots.releaseIntents, event.operation.release.operationId),
                emptyJournalRecords
              ),
              record
            )
          )
        : roots.releaseIntents
  })
}
const lastVisible = (records: JournalRecordSequence, cutoff: number): JournalRecord | undefined => {
  const latest = journalRecordAt(records, lastOffset)
  if (latest === undefined || latest.position <= cutoff) return latest
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / partitions)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= cutoff) low = middle + 1
    else high = middle
  }
  return low === 0 ? undefined : journalRecordAt(records, low - 1)
}
/** Latest distinct disposition facts visible at the cutoff; callers still validate their exact subject and claim correlations. */
export const stopRequestDispositionAt = (
  index: StopRequestDispositionEvidence,
  request: AttemptChoiceRequestId,
  throughPosition: number
): {
  readonly abandonment: JournalRecord | undefined
  readonly releaseIntent: JournalRecord | undefined
  readonly releaseOutcome: JournalRecord | undefined
  readonly noRelease: JournalRecord | undefined
} => {
  const roots = rootsOf(index)
  const at = (kind: DispositionKind) =>
    lastVisible(
      Option.getOrElse(HashMap.get(roots.byRequestKind, keyFor(request, kind)), emptyJournalRecords),
      throughPosition
    )
  return {
    abandonment: at("AttemptImplementationAbandoned"),
    releaseIntent: at("TaskClaimReleaseIntended"),
    releaseOutcome: at("TaskClaimReleased"),
    noRelease: at("StoppedAttemptClaimNoReleaseObserved")
  }
}
/** Test-only roots include all request and release-operation sequences, without predecessor object retention. */
export const inspectStopRequestDispositionStorage = (index: StopRequestDispositionEvidence): ReadonlyArray<object> => {
  const roots = rootsOf(index)
  return [
    roots,
    ...[roots.byRequestKind, roots.releaseIntents].flatMap((map) =>
      Array.from(map, ([, sequence]) => inspectJournalRecordStorage(sequence))
    )
  ]
}
