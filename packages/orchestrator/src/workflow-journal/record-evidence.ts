/* eslint-disable max-lines -- Journal evidence indexes are co-located so one append updates every immutable query root atomically. */
import { HashMap, Option } from "effect"
import type { AttemptId, TaskId } from "@dalph/contracts"
import type { OperationId } from "../workflow/identity.js"
import type { TargetPromotionRequestId } from "../workflow/protocols/target-promotion/events.js"
import type { IntegratorSessionId } from "../workflow/protocols/integrator/events.js"
import {
  appendClaimObservationEpisode,
  claimObservationEpisodeAt,
  emptyClaimObservationEpisodes,
  inspectClaimObservationEpisodeStorage,
  type ClaimObservationEpisodeIndex
} from "./claim-observation-episodes.js"
import { workflowOperationId, type WorkflowOperation } from "../workflow/registry/operation.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import type { JournalPosition, JournalRecordKey } from "./identity.js"
import { outcomeRecordKey } from "./record-key.js"
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
  readonly byAttemptKind: HashMap.HashMap<
    AttemptId,
    HashMap.HashMap<JournalRecord["event"]["_tag"], JournalRecordSequence>
  >
  readonly byAttemptCommandKind: HashMap.HashMap<
    string,
    HashMap.HashMap<JournalRecord["event"]["_tag"], JournalRecordSequence>
  >
  readonly byTask: HashMap.HashMap<TaskId, JournalRecordSequence>
  readonly byTaskKind: HashMap.HashMap<TaskId, HashMap.HashMap<JournalRecord["event"]["_tag"], JournalRecordSequence>>
  readonly operations: HashMap.HashMap<OperationId, JournalRecordSequence>
  readonly recordsByOperation: HashMap.HashMap<OperationId, JournalRecordSequence>
  readonly byPromotionRequest: HashMap.HashMap<TargetPromotionRequestId, JournalRecordSequence>
  readonly byIntegratorSession: HashMap.HashMap<IntegratorSessionId, JournalRecordSequence>
  readonly byRestartRead: HashMap.HashMap<string, JournalRecordSequence>
  readonly claimObservationEpisodes: ClaimObservationEpisodeIndex
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
    byAttemptKind: HashMap.empty(),
    byAttemptCommandKind: HashMap.empty(),
    byTask: HashMap.empty(),
    byTaskKind: HashMap.empty(),
    operations: HashMap.empty(),
    recordsByOperation: HashMap.empty(),
    byPromotionRequest: HashMap.empty(),
    byIntegratorSession: HashMap.empty(),
    byRestartRead: HashMap.empty(),
    claimObservationEpisodes: emptyClaimObservationEpisodes()
  })

const operationOf = ({ event }: JournalRecord): WorkflowOperation | undefined =>
  event._tag === "PlannedAttemptReplaced" ? event.successorPlan : "operation" in event ? event.operation : undefined

const operationIdsOf = (record: JournalRecord): ReadonlySet<OperationId> => {
  const ids = new Set<OperationId>()
  const operation = operationOf(record)
  if (operation !== undefined) ids.add(workflowOperationId(operation))
  if ("operationId" in record.event) ids.add(record.event.operationId)
  if ("request" in record.event && "operationId" in record.event.request) ids.add(record.event.request.operationId)
  if ("authorization" in record.event && "operationId" in record.event.authorization) {
    ids.add(record.event.authorization.operationId)
  }
  if ("deletionOperationId" in record.event) ids.add(record.event.deletionOperationId)
  if ("replacementOperationId" in record.event) ids.add(record.event.replacementOperationId)
  if (
    "observation" in record.event &&
    typeof record.event.observation === "object" &&
    record.event.observation !== null &&
    "request" in record.event.observation &&
    "operationId" in record.event.observation.request
  ) {
    ids.add(record.event.observation.request.operationId)
  }
  return ids
}

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

const integratorSessionIdsOf = (record: JournalRecord): ReadonlySet<IntegratorSessionId> => {
  const ids = new Set<IntegratorSessionId>()
  const event = record.event
  if ("correlation" in event && "sessionId" in event.correlation) ids.add(event.correlation.sessionId)
  if ("run" in event && "session" in event.run) ids.add(event.run.session.sessionId)
  if ("fingerprint" in event && "sessionId" in event.fingerprint) ids.add(event.fingerprint.sessionId)
  if ("predecessor" in event && "sessionId" in event.predecessor) ids.add(event.predecessor.sessionId)
  if ("successor" in event && "sessionId" in event.successor) ids.add(event.successor.sessionId)
  return ids
}

const restartReadKeyOf = (record: JournalRecord): string | undefined => {
  const event = record.event
  if (event._tag !== "TaskTrackerReadIntentRecorded" && event._tag !== "GitReadIntentRecorded") return undefined
  const matched = /^attempt-restart:([^:]+):(claim|graph|specification|target-lineage|worktree):after:/.exec(
    event.operation.operationId
  )
  return matched === null ? undefined : `${matched[1]}:${matched[2]}`
}

const graphObservationTaskIds = (record: JournalRecord, indexes: EvidenceIndexes | undefined): ReadonlySet<TaskId> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return new Set()
  const observation = record.event.observation
  if (observation._tag === "CompleteTaskTrackerFacts") {
    return new Set([
      ...observation.factFamilies[0].taskIds,
      ...observation.factFamilies.flatMap(({ coverage }) => coverage.explicitlyCoveredTaskIds)
    ])
  }
  if (observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") return new Set()
  const prior =
    indexes === undefined
      ? undefined
      : Option.getOrUndefined(HashMap.get(indexes.byKey, outcomeRecordKey(observation.priorFullObservationOperationId)))
  const priorTaskIds =
    prior?.event._tag === "TaskTrackerFactsObserved" && prior.event.observation._tag === "CompleteTaskTrackerFacts"
      ? prior.event.observation.factFamilies[0].taskIds
      : []
  return new Set([
    ...priorTaskIds,
    ...observation.factFamilies.flatMap(({ coverage }) => coverage.explicitlyCoveredTaskIds)
  ])
}

const taskIdsOf = (record: JournalRecord, indexes?: EvidenceIndexes): ReadonlySet<TaskId> => {
  const ids = new Set<TaskId>()
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor" && descriptor.plannedAttempt !== undefined) {
    ids.add(descriptor.plannedAttempt.taskId)
  }
  if (descriptor._tag === "OperationEventDescriptor" && descriptor.plannedAttempt._tag === "PlannedAttempt") {
    ids.add(descriptor.plannedAttempt.plannedAttempt.taskId)
  }
  const event = record.event
  if (event._tag === "TaskTrackerFactsObserved") {
    const observation = event.observation
    if (observation._tag === "FocusedTaskWorkSpecificationFacts") {
      ids.add(observation.factFamily.coverage.taskId)
    }
    if (observation._tag === "FocusedTaskClaimFacts" || observation._tag === "FocusedTaskClaimFactsUnreadable") {
      ids.add(observation.coverage.taskId)
    }
    if (observation._tag === "FocusedTaskCompletionFacts") ids.add(observation.request.taskId)
  }
  if ("plannedAttempt" in event) ids.add(event.plannedAttempt.taskId)
  if ("subject" in event) {
    if ("plannedAttempt" in event.subject) ids.add(event.subject.plannedAttempt.taskId)
    if ("taskId" in event.subject) ids.add(event.subject.taskId)
  }
  if ("claim" in event) {
    if ("taskId" in event.claim) ids.add(event.claim.taskId)
    if ("plannedAttempt" in event.claim) ids.add(event.claim.plannedAttempt.taskId)
  }
  if ("release" in event) ids.add(event.release.claim.taskId)
  if ("expectedClaim" in event) ids.add(event.expectedClaim.taskId)
  if ("request" in event) {
    if ("taskId" in event.request) ids.add(event.request.taskId)
    if ("claim" in event.request) ids.add(event.request.claim.plannedAttempt.taskId)
  }
  if ("operation" in event) {
    const operation = event.operation
    if ("plannedAttempt" in operation) ids.add(operation.plannedAttempt.taskId)
    if ("taskId" in operation) ids.add(operation.taskId)
    if ("readShape" in operation) {
      for (const taskId of operation.readShape.explicitlyCoveredTaskIds) ids.add(taskId)
    }
    if ("acquisition" in operation) ids.add(operation.acquisition.taskId)
    if ("release" in operation) ids.add(operation.release.claim.taskId)
    if ("request" in operation) {
      if ("taskId" in operation.request) ids.add(operation.request.taskId)
      if ("claim" in operation.request) ids.add(operation.request.claim.plannedAttempt.taskId)
    }
  }
  if (event._tag === "PlannedAttemptReplaced") {
    ids.add(event.subject.plannedAttempt.taskId)
    ids.add(event.successorPlan.plannedAttempt.taskId)
  }
  for (const taskId of graphObservationTaskIds(record, indexes)) ids.add(taskId)
  return ids
}

/** Adds the candidate's indexes without modifying accepted predecessor evidence. */
export const appendJournalEvidence = (prior: JournalRecordEvidence, record: JournalRecord): JournalRecordEvidence => {
  const indexes = indexesFor(prior)
  const ofKind = Option.getOrElse(HashMap.get(indexes.byKind, record.event._tag), emptyJournalRecords)
  let byAttempt = indexes.byAttempt
  let byAttemptKind = indexes.byAttemptKind
  let byAttemptCommandKind = indexes.byAttemptCommandKind
  for (const attemptId of attemptIdsOf(record)) {
    const priorAttempt = Option.getOrElse(HashMap.get(byAttempt, attemptId), emptyJournalRecords)
    byAttempt = HashMap.set(byAttempt, attemptId, appendJournalRecord(priorAttempt, record))
    const priorKinds = Option.getOrElse(HashMap.get(byAttemptKind, attemptId), HashMap.empty)
    const priorKind = Option.getOrElse(HashMap.get(priorKinds, record.event._tag), emptyJournalRecords)
    byAttemptKind = HashMap.set(
      byAttemptKind,
      attemptId,
      HashMap.set(priorKinds, record.event._tag, appendJournalRecord(priorKind, record))
    )
    if ("commandOrdinal" in record.event) {
      const commandKey = `${attemptId}:${record.event.commandOrdinal}`
      const priorCommandKinds = Option.getOrElse(HashMap.get(byAttemptCommandKind, commandKey), HashMap.empty)
      const priorCommandKind = Option.getOrElse(HashMap.get(priorCommandKinds, record.event._tag), emptyJournalRecords)
      byAttemptCommandKind = HashMap.set(
        byAttemptCommandKind,
        commandKey,
        HashMap.set(priorCommandKinds, record.event._tag, appendJournalRecord(priorCommandKind, record))
      )
    }
  }
  let byTask = indexes.byTask
  let byTaskKind = indexes.byTaskKind
  for (const taskId of taskIdsOf(record, indexes)) {
    const priorTask = Option.getOrElse(HashMap.get(byTask, taskId), emptyJournalRecords)
    byTask = HashMap.set(byTask, taskId, appendJournalRecord(priorTask, record))
    const priorKinds = Option.getOrElse(HashMap.get(byTaskKind, taskId), HashMap.empty)
    const priorKind = Option.getOrElse(HashMap.get(priorKinds, record.event._tag), emptyJournalRecords)
    byTaskKind = HashMap.set(
      byTaskKind,
      taskId,
      HashMap.set(priorKinds, record.event._tag, appendJournalRecord(priorKind, record))
    )
  }
  const operation = operationOf(record)
  let recordsByOperation = indexes.recordsByOperation
  for (const operationId of operationIdsOf(record)) {
    const priorOperation = Option.getOrElse(HashMap.get(recordsByOperation, operationId), emptyJournalRecords)
    recordsByOperation = HashMap.set(recordsByOperation, operationId, appendJournalRecord(priorOperation, record))
  }
  const promotionRequestId = (() => {
    const event = record.event
    if ("correlation" in event && "requestId" in event.correlation) return event.correlation.requestId
    if ("claim" in event && "promotionCorrelation" in event.claim) {
      return event.claim.promotionCorrelation.requestId
    }
    if ("request" in event && "claim" in event.request) {
      return event.request.claim.promotionCorrelation.requestId
    }
    if ("authorization" in event && "claim" in event.authorization) {
      return event.authorization.claim.promotionCorrelation.requestId
    }
    return undefined
  })()
  const byPromotionRequest =
    promotionRequestId === undefined
      ? indexes.byPromotionRequest
      : HashMap.set(
          indexes.byPromotionRequest,
          promotionRequestId,
          appendJournalRecord(
            Option.getOrElse(HashMap.get(indexes.byPromotionRequest, promotionRequestId), emptyJournalRecords),
            record
          )
        )
  let byIntegratorSession = indexes.byIntegratorSession
  for (const sessionId of integratorSessionIdsOf(record)) {
    const priorSession = Option.getOrElse(HashMap.get(byIntegratorSession, sessionId), emptyJournalRecords)
    byIntegratorSession = HashMap.set(byIntegratorSession, sessionId, appendJournalRecord(priorSession, record))
  }
  const restartReadKey = restartReadKeyOf(record)
  const byRestartRead = restartReadKey === undefined
    ? indexes.byRestartRead
    : HashMap.set(
        indexes.byRestartRead,
        restartReadKey,
        appendJournalRecord(
          Option.getOrElse(HashMap.get(indexes.byRestartRead, restartReadKey), emptyJournalRecords),
          record
        )
      )
  return evidence(appendJournalRecord(prior.records, record), {
    byKey: HashMap.has(indexes.byKey, record.key) ? indexes.byKey : HashMap.set(indexes.byKey, record.key, record),
    byKind: HashMap.set(indexes.byKind, record.event._tag, appendJournalRecord(ofKind, record)),
    byAttempt,
    byAttemptKind,
    byAttemptCommandKind,
    byTask,
    byTaskKind,
    operations:
      operation === undefined
        ? indexes.operations
        : HashMap.set(
            indexes.operations,
            workflowOperationId(operation),
            appendJournalRecord(
              Option.getOrElse(HashMap.get(indexes.operations, workflowOperationId(operation)), emptyJournalRecords),
              record
            )
          ),
    recordsByOperation,
    byPromotionRequest,
    byIntegratorSession,
    byRestartRead,
    claimObservationEpisodes: appendClaimObservationEpisode(indexes.claimObservationEpisodes, record)
  })
}

/** Imports a canonical decoded sequence once. Semantic validation remains a separate step. */
export const journalEvidenceFrom = (records: ReadonlyArray<JournalRecord>): JournalRecordEvidence =>
  records.reduce(appendJournalEvidence, emptyJournalEvidence())

/** A historical evidence window, not a new semantic acceptance certificate. */
export const journalEvidenceBefore = (
  source: JournalRecordEvidence,
  exclusivePosition: number
): JournalRecordEvidence => evidence(journalRecordsBefore(source.records, exclusivePosition - 1), indexesFor(source))

/** Copies only the opaque evidence shell when the semantic validator certifies it. */
export const retainJournalEvidence = <A extends JournalRecordEvidence>(source: JournalRecordEvidence, value: A): A => {
  indexesByEvidence.set(value, indexesFor(source))
  return value
}

const visible = (source: JournalRecordEvidence, record: JournalRecord | undefined): JournalRecord | undefined =>
  record !== undefined && record.position <= source.records.length ? record : undefined

export const journalRecordByPosition = (
  source: JournalHistorySource,
  position: JournalPosition
): JournalRecord | undefined =>
  isJournalRecordEvidence(source)
    ? journalRecordAt(source.records, position - 1)
    : source.find((record) => record.position === position)

export const journalRecordByKey = (source: JournalHistorySource, key: JournalRecordKey): JournalRecord | undefined =>
  isJournalRecordEvidence(source)
    ? visible(source, Option.getOrUndefined(HashMap.get(indexesFor(source).byKey, key)))
    : source.find((record) => record.key === key)

export const journalRecordsAfter = (
  source: JournalHistorySource,
  after: JournalPosition | null
): Iterable<JournalRecord> => {
  if (!isJournalRecordEvidence(source)) {
    return source.filter((record) => after === null || record.position > after)
  }
  const firstOffset = after ?? 0
  return {
    *[Symbol.iterator]() {
      for (let offset = firstOffset; offset < source.records.length; offset += 1) {
        const record = journalRecordAt(source.records, offset)
        if (record !== undefined) yield record
      }
    }
  }
}

function* indexedRecords(
  source: JournalRecordEvidence,
  records: JournalRecordSequence
): IterableIterator<JournalRecord> {
  for (let index = 0; index < records.length; index += 1) {
    const record = journalRecordAt(records, index)
    if (record === undefined || record.position > source.records.length) return
    yield record
  }
}

export const journalRecordsOfKind = (
  source: JournalHistorySource,
  kind: JournalRecord["event"]["_tag"]
): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(source, Option.getOrElse(HashMap.get(indexesFor(source).byKind, kind), emptyJournalRecords))
    : source.filter((record) => record.event._tag === kind)

export const firstJournalRecordOfKind = (
  source: JournalHistorySource,
  kind: JournalRecord["event"]["_tag"]
): JournalRecord | undefined => {
  if (!isJournalRecordEvidence(source)) return source.find((record) => record.event._tag === kind)
  return visible(
    source,
    journalRecordAt(Option.getOrElse(HashMap.get(indexesFor(source).byKind, kind), emptyJournalRecords), 0)
  )
}

export const lastJournalRecordOfKind = (
  source: JournalHistorySource,
  kind: JournalRecord["event"]["_tag"]
): JournalRecord | undefined => {
  if (!isJournalRecordEvidence(source)) return source.findLast((record) => record.event._tag === kind)
  const records = Option.getOrElse(HashMap.get(indexesFor(source).byKind, kind), emptyJournalRecords)
  return lastVisibleRecord(source, records)
}

const lastVisibleRecord = (
  source: JournalRecordEvidence,
  records: JournalRecordSequence
): JournalRecord | undefined => {
  const length = visibleRecordCount(source, records)
  return length === 0 ? undefined : journalRecordAt(records, length - 1)
}

const visibleRecordCount = (source: JournalRecordEvidence, records: JournalRecordSequence): number => {
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchDivisor)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= source.records.length) low = middle + 1
    else high = middle
  }
  return low
}

export const journalOperationById = (
  source: JournalHistorySource,
  operationId: OperationId
): WorkflowOperation | undefined => {
  if (!isJournalRecordEvidence(source))
    return source
      .map(operationOf)
      .findLast((operation) => operation !== undefined && workflowOperationId(operation) === operationId)
  const found = lastVisibleRecord(
    source,
    Option.getOrElse(HashMap.get(indexesFor(source).operations, operationId), emptyJournalRecords)
  )
  return found === undefined ? undefined : operationOf(found)
}

/** The latest record carrying one exact operation identity. */
export const journalRecordForOperationId = (
  source: JournalHistorySource,
  operationId: OperationId
): JournalRecord | undefined => {
  if (!isJournalRecordEvidence(source)) {
    return source.findLast((record) => {
      const operation = operationOf(record)
      return operation !== undefined && workflowOperationId(operation) === operationId
    })
  }
  return lastVisibleRecord(
    source,
    Option.getOrElse(HashMap.get(indexesFor(source).operations, operationId), emptyJournalRecords)
  )
}

export const journalRecordsForOperationId = (
  source: JournalHistorySource,
  operationId: OperationId
): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(
        source,
        Option.getOrElse(HashMap.get(indexesFor(source).recordsByOperation, operationId), emptyJournalRecords)
      )
    : source.filter((record) => operationIdsOf(record).has(operationId))

export const journalRecordsForPromotionRequest = (
  source: JournalHistorySource,
  requestId: TargetPromotionRequestId
): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(
        source,
        Option.getOrElse(HashMap.get(indexesFor(source).byPromotionRequest, requestId), emptyJournalRecords)
      )
    : source.filter(
        (record) =>
          "correlation" in record.event &&
          "requestId" in record.event.correlation &&
          record.event.correlation.requestId === requestId
      )

export const journalRecordsForIntegratorSession = (
  source: JournalHistorySource,
  sessionId: IntegratorSessionId
): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(
        source,
        Option.getOrElse(HashMap.get(indexesFor(source).byIntegratorSession, sessionId), emptyJournalRecords)
      )
    : source.filter((record) => integratorSessionIdsOf(record).has(sessionId))

export const journalRestartReadIntents = (
  source: JournalHistorySource,
  nonce: string,
  phase: "claim" | "graph" | "specification" | "target-lineage" | "worktree"
): Iterable<JournalRecord> => {
  const key = `${encodeURIComponent(nonce)}:${phase}`
  return isJournalRecordEvidence(source)
    ? indexedRecords(
        source,
        Option.getOrElse(HashMap.get(indexesFor(source).byRestartRead, key), emptyJournalRecords)
      )
    : source.filter((record) => restartReadKeyOf(record) === key)
}

export const journalTaskClaimObservationAt = (source: JournalRecordEvidence, taskId: TaskId) =>
  claimObservationEpisodeAt(indexesFor(source).claimObservationEpisodes, taskId, source.records.length)

/** Full accepted prefixes can reuse the exact indexed kind sequence. */
export const journalEvidenceKindSequence = (
  source: JournalRecordEvidence,
  kind: JournalRecord["event"]["_tag"]
): JournalRecordSequence => {
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

export const journalRecordsForAttempt = (
  source: JournalHistorySource,
  attemptId: AttemptId
): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(
        source,
        Option.getOrElse(HashMap.get(indexesFor(source).byAttempt, attemptId), emptyJournalRecords)
      )
    : source.filter((record) => attemptIdsOf(record).has(attemptId))

const attemptKindRecords = (
  source: JournalRecordEvidence,
  attemptId: AttemptId,
  kind: JournalRecord["event"]["_tag"]
): JournalRecordSequence => {
  const kinds = Option.getOrElse(HashMap.get(indexesFor(source).byAttemptKind, attemptId), HashMap.empty)
  return Option.getOrElse(HashMap.get(kinds, kind), emptyJournalRecords)
}

export const journalRecordsForAttemptKind = (
  source: JournalHistorySource,
  attemptId: AttemptId,
  kind: JournalRecord["event"]["_tag"]
): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(source, attemptKindRecords(source, attemptId, kind))
    : source.filter((record) => record.event._tag === kind && attemptIdsOf(record).has(attemptId))

export const lastJournalRecordForAttemptKind = (
  source: JournalHistorySource,
  attemptId: AttemptId,
  kind: JournalRecord["event"]["_tag"]
): JournalRecord | undefined =>
  isJournalRecordEvidence(source)
    ? lastVisibleRecord(source, attemptKindRecords(source, attemptId, kind))
    : source.findLast((record) => record.event._tag === kind && attemptIdsOf(record).has(attemptId))

export const journalRecordCountForAttemptKind = (
  source: JournalHistorySource,
  attemptId: AttemptId,
  kind: JournalRecord["event"]["_tag"]
): number =>
  isJournalRecordEvidence(source)
    ? visibleRecordCount(source, attemptKindRecords(source, attemptId, kind))
    : source.filter((record) => record.event._tag === kind && attemptIdsOf(record).has(attemptId)).length

export const journalRecordCountForAttemptCommandKind = (
  source: JournalHistorySource,
  attemptId: AttemptId,
  commandOrdinal: number,
  kind: JournalRecord["event"]["_tag"]
): number => {
  if (!isJournalRecordEvidence(source)) {
    return source.filter(
      (record) =>
        record.event._tag === kind &&
        "commandOrdinal" in record.event &&
        record.event.commandOrdinal === commandOrdinal &&
        attemptIdsOf(record).has(attemptId)
    ).length
  }
  const kinds = Option.getOrElse(
    HashMap.get(indexesFor(source).byAttemptCommandKind, `${attemptId}:${commandOrdinal}`),
    HashMap.empty
  )
  const records = Option.getOrElse(HashMap.get(kinds, kind), emptyJournalRecords)
  return visibleRecordCount(source, records)
}

export const journalRecordsForTask = (source: JournalHistorySource, taskId: TaskId): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(source, Option.getOrElse(HashMap.get(indexesFor(source).byTask, taskId), emptyJournalRecords))
    : source.filter((record) => {
        if (taskIdsOf(record).has(taskId)) return true
        if (
          record.event._tag !== "TaskTrackerFactsObserved" ||
          record.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
        )
          return false
        const prior = source.find(
          ({ key }) => key === outcomeRecordKey(record.event.observation.priorFullObservationOperationId)
        )
        return prior !== undefined && taskIdsOf(prior).has(taskId)
      })

export const journalRecordsForTaskKind = (
  source: JournalHistorySource,
  taskId: TaskId,
  kind: JournalRecord["event"]["_tag"]
): Iterable<JournalRecord> => {
  if (!isJournalRecordEvidence(source)) {
    return source.filter((record) => record.event._tag === kind && taskIdsOf(record).has(taskId))
  }
  const kinds = Option.getOrElse(HashMap.get(indexesFor(source).byTaskKind, taskId), HashMap.empty)
  return indexedRecords(source, Option.getOrElse(HashMap.get(kinds, kind), emptyJournalRecords))
}

export const lastJournalRecordForTaskKind = (
  source: JournalHistorySource,
  taskId: TaskId,
  kind: JournalRecord["event"]["_tag"]
): JournalRecord | undefined => {
  if (!isJournalRecordEvidence(source)) {
    let latest: JournalRecord | undefined
    for (const record of journalRecordsForTask(source, taskId)) {
      if (record.event._tag === kind) latest = record
    }
    return latest
  }
  const kinds = Option.getOrElse(HashMap.get(indexesFor(source).byTaskKind, taskId), HashMap.empty)
  return lastVisibleRecord(source, Option.getOrElse(HashMap.get(kinds, kind), emptyJournalRecords))
}

/** Test-only retained storage roots; no array of records is constructed. */
export const inspectJournalEvidenceStorage = (source: JournalRecordEvidence): ReadonlyArray<object> => {
  const indexes = indexesFor(source)
  return [
    source,
    indexes,
    indexes.byKey,
    indexes.byKind,
    indexes.byAttempt,
    indexes.byAttemptKind,
    indexes.byAttemptCommandKind,
    indexes.byTask,
    indexes.byTaskKind,
    indexes.operations,
    indexes.recordsByOperation,
    indexes.byPromotionRequest,
    indexes.byIntegratorSession,
    indexes.byRestartRead,
    indexes.claimObservationEpisodes,
    inspectJournalRecordStorage(source.records),
    ...Array.from(HashMap.values(indexes.byKind), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byAttempt), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byAttemptKind)).flatMap((kinds) =>
      Array.from(HashMap.values(kinds), inspectJournalRecordStorage)
    ),
    ...Array.from(HashMap.values(indexes.byAttemptCommandKind)).flatMap((kinds) =>
      Array.from(HashMap.values(kinds), inspectJournalRecordStorage)
    ),
    ...Array.from(HashMap.values(indexes.byTask), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byTaskKind)).flatMap((kinds) =>
      Array.from(HashMap.values(kinds), inspectJournalRecordStorage)
    ),
    ...Array.from(HashMap.values(indexes.operations), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.recordsByOperation), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byPromotionRequest), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byIntegratorSession), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byRestartRead), inspectJournalRecordStorage),
    ...inspectClaimObservationEpisodeStorage(indexes.claimObservationEpisodes)
  ]
}
