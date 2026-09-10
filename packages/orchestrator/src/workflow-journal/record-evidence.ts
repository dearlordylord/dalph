import { HashMap, Option } from "effect"
import type { AttemptId, TaskId } from "@dalph/contracts"
import type { OperationId } from "../workflow/identity.js"
import { workflowOperationId, type WorkflowOperation } from "../workflow/registry/operation.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import type { JournalPosition, JournalRecordKey } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendJournalRecord,
  emptyJournalRecords,
  inspectJournalRecordStorage,
  journalRecordAt,
  journalRecordsBefore,
  type JournalRecordSequence
} from "./record-sequence.js"

const JournalRecordEvidenceTypeId: unique symbol = Symbol("JournalRecordEvidence")
const binarySearchDivisor = 2

/** Indexed immutable decoded records. This value makes no semantic acceptance claim. */
export interface JournalRecordEvidence {
  readonly [JournalRecordEvidenceTypeId]: true
  readonly records: JournalRecordSequence
}

/** Raw arrays enter at cold/presentation boundaries; live callers supply indexed evidence. */
export type JournalHistorySource = ReadonlyArray<JournalRecord> | JournalRecordEvidence

interface EvidenceIndexes {
  readonly byKey: HashMap.HashMap<JournalRecordKey, JournalRecord>
  readonly byKind: HashMap.HashMap<JournalRecord["event"]["_tag"], JournalRecordSequence>
  readonly byAttempt: HashMap.HashMap<AttemptId, JournalRecordSequence>
  readonly byTask: HashMap.HashMap<TaskId, JournalRecordSequence>
  readonly operations: HashMap.HashMap<OperationId, JournalRecordSequence>
}

const indexesByEvidence = new WeakMap<JournalRecordEvidence, EvidenceIndexes>()
const indexesFor = (evidence: JournalRecordEvidence): EvidenceIndexes =>
  Option.getOrThrow(Option.fromUndefinedOr(indexesByEvidence.get(evidence)))

export const isJournalRecordEvidence = (source: JournalHistorySource): source is JournalRecordEvidence =>
  JournalRecordEvidenceTypeId in source

const evidence = (records: JournalRecordSequence, indexes: EvidenceIndexes): JournalRecordEvidence => {
  const result: JournalRecordEvidence = { [JournalRecordEvidenceTypeId]: true, records }
  indexesByEvidence.set(result, indexes)
  return result
}

export const emptyJournalEvidence = (): JournalRecordEvidence =>
  evidence(emptyJournalRecords(), {
    byKey: HashMap.empty(),
    byKind: HashMap.empty(),
    byAttempt: HashMap.empty(),
    byTask: HashMap.empty(),
    operations: HashMap.empty()
  })

const operationOf = ({ event }: JournalRecord): WorkflowOperation | undefined =>
  event._tag === "PlannedAttemptReplaced" ? event.successorPlan : "operation" in event ? event.operation : undefined

const attemptIdsOf = (record: JournalRecord): ReadonlySet<AttemptId> => {
  const ids = new Set<AttemptId>()
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor") ids.add(descriptor.correlation.attemptId)
  if (descriptor._tag === "IntegrationEventDescriptor") ids.add(descriptor.attemptId)
  if (descriptor._tag === "OperationEventDescriptor" && descriptor.plannedAttempt._tag === "PlannedAttempt") {
    ids.add(descriptor.plannedAttempt.plannedAttempt.attemptId)
  }
  const event = record.event
  if ("plannedAttempt" in event) ids.add(event.plannedAttempt.attemptId)
  if ("subject" in event && "plannedAttempt" in event.subject) ids.add(event.subject.plannedAttempt.attemptId)
  if (event._tag === "PlannedAttemptReplaced") ids.add(event.successorPlan.plannedAttempt.attemptId)
  if ("run" in event) ids.add(event.run.session.plannedAttempt.attemptId)
  if ("claim" in event && "plannedAttempt" in event.claim) ids.add(event.claim.plannedAttempt.attemptId)
  return ids
}

const taskIdsOf = (record: JournalRecord): ReadonlySet<TaskId> => {
  const ids = new Set<TaskId>()
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor" && descriptor.plannedAttempt !== undefined) {
    ids.add(descriptor.plannedAttempt.taskId)
  }
  if (descriptor._tag === "OperationEventDescriptor" && descriptor.plannedAttempt._tag === "PlannedAttempt") {
    ids.add(descriptor.plannedAttempt.plannedAttempt.taskId)
  }
  const event = record.event
  if ("plannedAttempt" in event) ids.add(event.plannedAttempt.taskId)
  if ("subject" in event) {
    if ("plannedAttempt" in event.subject) ids.add(event.subject.plannedAttempt.taskId)
    if ("taskId" in event.subject) ids.add(event.subject.taskId)
  }
  if ("claim" in event) {
    if ("taskId" in event.claim) ids.add(event.claim.taskId)
    if ("plannedAttempt" in event.claim) ids.add(event.claim.plannedAttempt.taskId)
  }
  if ("operation" in event) {
    const operation = event.operation
    if ("plannedAttempt" in operation) ids.add(operation.plannedAttempt.taskId)
    if ("taskId" in operation) ids.add(operation.taskId)
    if ("acquisition" in operation) ids.add(operation.acquisition.taskId)
    if ("release" in operation) ids.add(operation.release.claim.taskId)
  }
  if (event._tag === "PlannedAttemptReplaced") {
    ids.add(event.subject.plannedAttempt.taskId)
    ids.add(event.successorPlan.plannedAttempt.taskId)
  }
  return ids
}

/** Adds the candidate's indexes without modifying accepted predecessor evidence. */
export const appendJournalEvidence = (prior: JournalRecordEvidence, record: JournalRecord): JournalRecordEvidence => {
  const indexes = indexesFor(prior)
  const ofKind = Option.getOrElse(HashMap.get(indexes.byKind, record.event._tag), emptyJournalRecords)
  let byAttempt = indexes.byAttempt
  for (const attemptId of attemptIdsOf(record)) {
    const priorAttempt = Option.getOrElse(HashMap.get(byAttempt, attemptId), emptyJournalRecords)
    byAttempt = HashMap.set(byAttempt, attemptId, appendJournalRecord(priorAttempt, record))
  }
  let byTask = indexes.byTask
  for (const taskId of taskIdsOf(record)) {
    const priorTask = Option.getOrElse(HashMap.get(byTask, taskId), emptyJournalRecords)
    byTask = HashMap.set(byTask, taskId, appendJournalRecord(priorTask, record))
  }
  const operation = operationOf(record)
  return evidence(appendJournalRecord(prior.records, record), {
    byKey: HashMap.has(indexes.byKey, record.key) ? indexes.byKey : HashMap.set(indexes.byKey, record.key, record),
    byKind: HashMap.set(indexes.byKind, record.event._tag, appendJournalRecord(ofKind, record)),
    byAttempt,
    byTask,
    operations: operation === undefined ? indexes.operations : HashMap.set(indexes.operations, workflowOperationId(operation), appendJournalRecord(Option.getOrElse(HashMap.get(indexes.operations, workflowOperationId(operation)), emptyJournalRecords), record))
  })
}

/** Imports a canonical decoded sequence once. Semantic validation remains a separate step. */
export const journalEvidenceFrom = (records: ReadonlyArray<JournalRecord>): JournalRecordEvidence =>
  records.reduce(appendJournalEvidence, emptyJournalEvidence())

/** A historical evidence window, not a new semantic acceptance certificate. */
export const journalEvidenceBefore = (source: JournalRecordEvidence, exclusivePosition: number): JournalRecordEvidence =>
  evidence(journalRecordsBefore(source.records, exclusivePosition - 1), indexesFor(source))

/** Copies only the opaque evidence shell when the semantic validator certifies it. */
export const retainJournalEvidence = <A extends JournalRecordEvidence>(source: JournalRecordEvidence, value: A): A => {
  indexesByEvidence.set(value, indexesFor(source))
  return value
}

const visible = (source: JournalRecordEvidence, record: JournalRecord | undefined): JournalRecord | undefined =>
  record !== undefined && record.position <= source.records.length ? record : undefined

export const journalRecordByPosition = (source: JournalHistorySource, position: JournalPosition): JournalRecord | undefined =>
  isJournalRecordEvidence(source) ? journalRecordAt(source.records, position - 1) : source.find((record) => record.position === position)

export const journalRecordByKey = (source: JournalHistorySource, key: JournalRecordKey): JournalRecord | undefined =>
  isJournalRecordEvidence(source) ? visible(source, Option.getOrUndefined(HashMap.get(indexesFor(source).byKey, key))) : source.find((record) => record.key === key)

function* indexedRecords(source: JournalRecordEvidence, records: JournalRecordSequence): IterableIterator<JournalRecord> {
  for (let index = 0; index < records.length; index += 1) {
    const record = journalRecordAt(records, index)
    if (record === undefined || record.position > source.records.length) return
    yield record
  }
}

export const journalRecordsOfKind = (source: JournalHistorySource, kind: JournalRecord["event"]["_tag"]): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(source, Option.getOrElse(HashMap.get(indexesFor(source).byKind, kind), emptyJournalRecords))
    : source.filter((record) => record.event._tag === kind)

export const firstJournalRecordOfKind = (source: JournalHistorySource, kind: JournalRecord["event"]["_tag"]): JournalRecord | undefined => {
  if (!isJournalRecordEvidence(source)) return source.find((record) => record.event._tag === kind)
  return visible(source, journalRecordAt(Option.getOrElse(HashMap.get(indexesFor(source).byKind, kind), emptyJournalRecords), 0))
}

export const lastJournalRecordOfKind = (source: JournalHistorySource, kind: JournalRecord["event"]["_tag"]): JournalRecord | undefined => {
  if (!isJournalRecordEvidence(source)) return source.findLast((record) => record.event._tag === kind)
  const records = Option.getOrElse(HashMap.get(indexesFor(source).byKind, kind), emptyJournalRecords)
  return lastVisibleRecord(source, records)
}

const lastVisibleRecord = (source: JournalRecordEvidence, records: JournalRecordSequence): JournalRecord | undefined => {
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchDivisor)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= source.records.length) low = middle + 1
    else high = middle
  }
  return low === 0 ? undefined : journalRecordAt(records, low - 1)
}

export const journalOperationById = (source: JournalHistorySource, operationId: OperationId): WorkflowOperation | undefined => {
  if (!isJournalRecordEvidence(source)) return source.map(operationOf).findLast((operation) => operation !== undefined && workflowOperationId(operation) === operationId)
  const found = lastVisibleRecord(source, Option.getOrElse(HashMap.get(indexesFor(source).operations, operationId), emptyJournalRecords))
  return found === undefined ? undefined : operationOf(found)
}

/** Full accepted prefixes can reuse the exact indexed kind sequence. */
export const journalEvidenceKindSequence = (source: JournalRecordEvidence, kind: JournalRecord["event"]["_tag"]): JournalRecordSequence => {
  const records = Option.getOrElse(HashMap.get(indexesFor(source).byKind, kind), emptyJournalRecords)
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchDivisor)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= source.records.length) low = middle + 1
    else high = middle
  }
  return low === records.length ? records : journalRecordsBefore(records, low)
}

export const journalRecordsForAttempt = (source: JournalHistorySource, attemptId: AttemptId): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(source, Option.getOrElse(HashMap.get(indexesFor(source).byAttempt, attemptId), emptyJournalRecords))
    : source.filter((record) => attemptIdsOf(record).has(attemptId))

export const journalRecordsForTask = (source: JournalHistorySource, taskId: TaskId): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(source, Option.getOrElse(HashMap.get(indexesFor(source).byTask, taskId), emptyJournalRecords))
    : source.filter((record) => taskIdsOf(record).has(taskId))

/** Test-only retained storage roots; no array of records is constructed. */
export const inspectJournalEvidenceStorage = (source: JournalRecordEvidence): ReadonlyArray<object> => {
  const indexes = indexesFor(source)
  return [source, indexes, inspectJournalRecordStorage(source.records), ...Array.from(HashMap.values(indexes.byKind), inspectJournalRecordStorage), ...Array.from(HashMap.values(indexes.byAttempt), inspectJournalRecordStorage), ...Array.from(HashMap.values(indexes.byTask), inspectJournalRecordStorage)]
}
