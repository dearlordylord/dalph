/* eslint-disable max-lines -- Journal evidence indexes are co-located so one append updates every immutable query root atomically. */
import { HashMap, HashSet, Option } from "effect"
import type { AttemptId, PlannedTaskAttempt, RunId, TaskId, TaskRevision } from "@dalph/contracts"
import type { TrackerTarget } from "../authorities/task-tracker/target.js"
import type { OperationId } from "../workflow/identity.js"
import type { TargetPromotionRequestId } from "../workflow/protocols/target-promotion/events.js"
import type { IntegratorSessionId } from "../workflow/protocols/integrator/events.js"
import type { IntegrationQuarantineDirectionRequestId } from "../workflow/protocols/integration-quarantine/events.js"
import {
  appendCompletionReadCycleEvidence,
  completionReadCycleAt,
  emptyCompletionReadCycles,
  inspectCompletionReadCycleStorage,
  type CompletionReadCycles
} from "./completion-read-cycles.js"
import {
  appendClaimObservationEpisode,
  claimObservationEpisodeAt,
  emptyClaimObservationEpisodes,
  inspectClaimObservationEpisodeStorage,
  type ClaimObservationEpisodeIndex
} from "./claim-observation-episodes.js"
import {
  appendGraphEvidence,
  emptyGraphEvidence,
  graphBlockerClearEpisodeAt,
  graphSnapshotForObservation,
  inspectGraphEvidenceStorage,
  lastGraphObservationAt,
  type GraphEvidence
} from "./graph-evidence.js"
import {
  appendSpecificationDivergence,
  emptySpecificationDivergence,
  inspectSpecificationDivergenceStorage,
  specificationDivergedAfter,
  type SpecificationDivergence
} from "./specification-divergence.js"
import {
  appendReadFreshnessEvidence,
  emptyReadFreshnessEvidence,
  inspectReadFreshnessEvidenceStorage,
  latestAttemptReadAt,
  latestTaskObservationAt,
  latestTaskReadAt,
  type ReadFreshnessEvidence
} from "./read-freshness-evidence.js"
import {
  appendStopRequestDisposition,
  emptyStopRequestDisposition,
  inspectStopRequestDispositionStorage,
  stopRequestDispositionAt,
  type StopRequestDispositionEvidence
} from "./stop-request-disposition.js"
import {
  appendRetainedExecutorResponsibilitySubjects,
  emptyRetainedExecutorResponsibilitySubjects,
  inspectRetainedExecutorResponsibilityStorage,
  retainedExecutorResponsibilitySubjectsAt,
  type RetainedExecutorResponsibilitySubjects
} from "./retained-executor-responsibility.js"
import {
  appendSettledCompletionClaimReplacementEvidence,
  emptySettledCompletionClaimReplacements,
  inspectSettledCompletionClaimReplacementStorage,
  settledCompletionClaimReplacementAt,
  type SettledCompletionClaimReplacementEvidence
} from "./settled-completion-claim-replacement.js"
import {
  appendWorkflowFinalityPremiseChanges,
  emptyWorkflowFinalityPremiseChanges,
  inspectWorkflowFinalityPremiseChangesStorage,
  lastWorkflowFinalityPremiseChangeAt,
  type WorkflowFinalityPremiseChanges
} from "./workflow-finality-premise-changes.js"
import type { CompletionTaskClaim } from "../workflow/protocols/integration-finality/events.js"
import {
  completionTaskCandidateAncestryReadOperationIdFor,
  completionTaskRequestLookupOperationIdFor
} from "../workflow/protocols/integration-finality/completion-task-operation-identity.js"
import type { AttemptChoiceRequestId } from "../workflow/protocols/attempt-choice/events.js"
import { workflowOperationId, type WorkflowOperation } from "../workflow/registry/operation.js"
import { acceptedOperationIdOf, describeJournalEvent } from "../workflow/registry/event-descriptor.js"
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
const lastSequenceEntryOffset = -1

/** Indexed immutable decoded records. This value makes no semantic acceptance claim. */
export interface JournalRecordEvidence {
  readonly [JournalRecordEvidenceTypeId]: true
  readonly records: JournalRecordSequence
  /** Last actual journal position in this chronological view; sparse diagnostic records need not start at one. */
  readonly lastPosition: JournalPosition | null
}

/** Raw arrays enter at cold/presentation boundaries; live callers supply indexed evidence. */
export type JournalHistorySource = ReadonlyArray<JournalRecord> | JournalRecordEvidence

interface EvidenceIndexes {
  /** Derived storage fact, not acceptance: every appended position equals its one-based sequence offset. */
  readonly positionsAreOrdinals: boolean
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
  readonly recordsByOperationKind: HashMap.HashMap<
    OperationId,
    HashMap.HashMap<JournalRecord["event"]["_tag"], JournalRecordSequence>
  >
  readonly byPromotionRequest: HashMap.HashMap<TargetPromotionRequestId, JournalRecordSequence>
  readonly byIntegratorSession: HashMap.HashMap<IntegratorSessionId, JournalRecordSequence>
  readonly byQuarantineDirectionRequest: HashMap.HashMap<string, JournalRecordSequence>
  readonly byRestartRead: HashMap.HashMap<string, JournalRecordSequence>
  readonly claimObservationEpisodes: ClaimObservationEpisodeIndex
  readonly completionReadCycles: CompletionReadCycles
  readonly graphEvidence: GraphEvidence
  readonly specificationDivergence: SpecificationDivergence
  readonly readFreshnessEvidence: ReadFreshnessEvidence
  readonly stopRequestDisposition: StopRequestDispositionEvidence
  readonly retainedExecutorResponsibilitySubjects: RetainedExecutorResponsibilitySubjects
  readonly settledCompletionClaimReplacements: SettledCompletionClaimReplacementEvidence
  readonly workflowFinalityPremiseChanges: WorkflowFinalityPremiseChanges
  readonly acceptedOperationIds: HashSet.HashSet<OperationId>
  readonly acceptedOperationIdsByPosition: HashMap.HashMap<JournalPosition, HashSet.HashSet<OperationId>>
  readonly completedReadOperationIds: HashSet.HashSet<OperationId>
  readonly pendingReadOperationIds: HashSet.HashSet<OperationId>
  readonly pendingReadOperationIdsByPosition: HashMap.HashMap<JournalPosition, HashSet.HashSet<OperationId>>
}

const indexesByEvidence = new WeakMap<JournalRecordEvidence, EvidenceIndexes>()
const indexesFor = (evidence: JournalRecordEvidence): EvidenceIndexes =>
  Option.getOrThrow(Option.fromUndefinedOr(indexesByEvidence.get(evidence)))

export const isJournalRecordEvidence = (source: JournalHistorySource): source is JournalRecordEvidence =>
  JournalRecordEvidenceTypeId in source

const evidence = (
  records: JournalRecordSequence,
  indexes: EvidenceIndexes,
  lastPosition: JournalPosition | null
): JournalRecordEvidence => {
  const result: JournalRecordEvidence = { [JournalRecordEvidenceTypeId]: true, records, lastPosition }
  indexesByEvidence.set(result, indexes)
  return result
}

export const emptyJournalEvidence = (): JournalRecordEvidence =>
  evidence(
    emptyJournalRecords(),
    {
      positionsAreOrdinals: true,
      byKey: HashMap.empty(),
      byKind: HashMap.empty(),
      byAttempt: HashMap.empty(),
      byAttemptKind: HashMap.empty(),
      byAttemptCommandKind: HashMap.empty(),
      byTask: HashMap.empty(),
      byTaskKind: HashMap.empty(),
      operations: HashMap.empty(),
      recordsByOperation: HashMap.empty(),
      recordsByOperationKind: HashMap.empty(),
      byPromotionRequest: HashMap.empty(),
      byIntegratorSession: HashMap.empty(),
      byQuarantineDirectionRequest: HashMap.empty(),
      byRestartRead: HashMap.empty(),
      claimObservationEpisodes: emptyClaimObservationEpisodes(),
      completionReadCycles: emptyCompletionReadCycles(),
      graphEvidence: emptyGraphEvidence(),
      specificationDivergence: emptySpecificationDivergence(),
      readFreshnessEvidence: emptyReadFreshnessEvidence(),
      stopRequestDisposition: emptyStopRequestDisposition(),
      retainedExecutorResponsibilitySubjects: emptyRetainedExecutorResponsibilitySubjects(),
      settledCompletionClaimReplacements: emptySettledCompletionClaimReplacements(),
      workflowFinalityPremiseChanges: emptyWorkflowFinalityPremiseChanges(),
      acceptedOperationIds: HashSet.empty(),
      acceptedOperationIdsByPosition: HashMap.empty(),
      completedReadOperationIds: HashSet.empty(),
      pendingReadOperationIds: HashSet.empty(),
      pendingReadOperationIdsByPosition: HashMap.empty()
    },
    null
  )

const operationOf = ({ event }: JournalRecord): WorkflowOperation | undefined =>
  event._tag === "PlannedAttemptReplaced" ? event.successorPlan : "operation" in event ? event.operation : undefined

const quarantineDirectionRequestKey = ({ nonce, runId }: IntegrationQuarantineDirectionRequestId): string =>
  `${runId.length}:${runId}${nonce}`

const operationIdsOf = (record: JournalRecord): HashSet.HashSet<OperationId> => {
  let ids = HashSet.empty<OperationId>()
  const operation = operationOf(record)
  if (operation !== undefined) ids = HashSet.add(ids, workflowOperationId(operation))
  if (
    record.event._tag === "TaskTrackerReadIntentRecorded" &&
    record.event.operation._tag === "ReadCompletionTaskFacts"
  ) {
    const { purpose, request } = record.event.operation
    ids = HashSet.add(ids, request.operationId)
    ids = HashSet.add(
      ids,
      purpose._tag === "Authorization"
        ? completionTaskCandidateAncestryReadOperationIdFor(request, purpose)
        : completionTaskRequestLookupOperationIdFor(request, purpose.attemptOrdinal)
    )
  }
  if (
    record.event._tag === "TaskTrackerFactsObserved" &&
    record.event.observation._tag === "FocusedTaskCompletionFacts"
  ) {
    const { purpose, request } = record.event.observation
    ids = HashSet.add(
      ids,
      purpose._tag === "Authorization"
        ? completionTaskCandidateAncestryReadOperationIdFor(request, purpose)
        : completionTaskRequestLookupOperationIdFor(request, purpose.attemptOrdinal)
    )
  }
  if (
    record.event._tag === "CompletionTaskAttemptIntended" ||
    record.event._tag === "CompletionTaskAcknowledged" ||
    record.event._tag === "CompletionTaskResponseLost" ||
    record.event._tag === "CompletionTaskRejected"
  ) {
    ids = HashSet.add(ids, completionTaskRequestLookupOperationIdFor(record.event.request, record.event.attemptOrdinal))
  }
  if ("operationId" in record.event) ids = HashSet.add(ids, record.event.operationId)
  // Claim acquisition outcomes carry their causal operation inside the authoritative claim.
  if (record.event._tag === "TaskClaimAcquired") ids = HashSet.add(ids, record.event.claim.operationId)
  if ("request" in record.event && "operationId" in record.event.request) {
    ids = HashSet.add(ids, record.event.request.operationId)
  }
  if ("authorization" in record.event && "operationId" in record.event.authorization) {
    ids = HashSet.add(ids, record.event.authorization.operationId)
  }
  if ("deletionOperationId" in record.event) ids = HashSet.add(ids, record.event.deletionOperationId)
  if ("replacementOperationId" in record.event) ids = HashSet.add(ids, record.event.replacementOperationId)
  if ("expectedClaim" in record.event) ids = HashSet.add(ids, record.event.expectedClaim.operationId)
  if ("release" in record.event) {
    ids = HashSet.add(ids, record.event.release.operationId)
    ids = HashSet.add(ids, record.event.release.claim.operationId)
  }
  if ("operation" in record.event && "release" in record.event.operation) {
    ids = HashSet.add(ids, record.event.operation.release.claim.operationId)
  }
  if (
    "observation" in record.event &&
    "request" in record.event.observation &&
    "operationId" in record.event.observation.request
  ) {
    ids = HashSet.add(ids, record.event.observation.request.operationId)
  }
  return ids
}

const attemptIdsOf = (record: JournalRecord): HashSet.HashSet<AttemptId> => {
  let ids = HashSet.empty<AttemptId>()
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor") {
    ids = HashSet.add(ids, descriptor.correlation.attemptId)
  }
  if (descriptor._tag === "IntegrationEventDescriptor") ids = HashSet.add(ids, descriptor.attemptId)
  if (descriptor._tag === "OperationEventDescriptor" && descriptor.plannedAttempt._tag === "PlannedAttempt") {
    ids = HashSet.add(ids, descriptor.plannedAttempt.plannedAttempt.attemptId)
  }
  const event = record.event
  if ("plannedAttempt" in event) ids = HashSet.add(ids, event.plannedAttempt.attemptId)
  if ("subject" in event && "plannedAttempt" in event.subject) {
    ids = HashSet.add(ids, event.subject.plannedAttempt.attemptId)
  }
  if (event._tag === "PlannedAttemptReplaced") ids = HashSet.add(ids, event.successorPlan.plannedAttempt.attemptId)
  if ("run" in event) ids = HashSet.add(ids, event.run.session.plannedAttempt.attemptId)
  if ("claim" in event && "plannedAttempt" in event.claim) {
    ids = HashSet.add(ids, event.claim.plannedAttempt.attemptId)
  }
  return ids
}

/** Raw diagnostic rows have no retained indexes; preserve their exact earlier-intent predicate. */
const rawRecordBelongsToAttempt = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord,
  attemptId: AttemptId
): boolean => {
  if (HashSet.has(attemptIdsOf(record), attemptId)) return true
  if (record.event._tag !== "PlannedAttemptWorktreeObserved") return false
  const operationId = record.event.operationId
  return records.some(
    ({ event, position }) =>
      position < record.position &&
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorktree" &&
      event.operation.operationId === operationId &&
      event.operation.plannedAttempt.runId === record.runId &&
      event.operation.plannedAttempt.attemptId === attemptId
  )
}

const integratorSessionIdsOf = (record: JournalRecord): HashSet.HashSet<IntegratorSessionId> => {
  let ids = HashSet.empty<IntegratorSessionId>()
  const event = record.event
  if ("correlation" in event && "sessionId" in event.correlation) {
    ids = HashSet.add(ids, event.correlation.sessionId)
  }
  if ("run" in event && "session" in event.run) ids = HashSet.add(ids, event.run.session.sessionId)
  if ("fingerprint" in event && "sessionId" in event.fingerprint) {
    ids = HashSet.add(ids, event.fingerprint.sessionId)
  }
  if ("predecessor" in event && "sessionId" in event.predecessor) {
    ids = HashSet.add(ids, event.predecessor.sessionId)
  }
  if ("successor" in event && "sessionId" in event.successor) ids = HashSet.add(ids, event.successor.sessionId)
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

const completedReadOperationIdOf = ({ event }: JournalRecord): OperationId | undefined => {
  if (event._tag === "TaskTrackerFactsObserved") return event.operationId
  if (event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved") {
    return event.operationId
  }
  return event._tag === "AttemptRestartAuthorityReadFailed" &&
    event.failure._tag !== "AttemptRestartTaskFactsReadFailure"
    ? event.operationId
    : undefined
}

const graphObservationTaskIds = (
  record: JournalRecord,
  indexes: EvidenceIndexes | undefined
): HashSet.HashSet<TaskId> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return HashSet.empty()
  const observation = record.event.observation
  if (observation._tag === "CompleteTaskTrackerFacts") {
    return HashSet.fromIterable([
      ...observation.factFamilies[0].taskIds,
      ...observation.factFamilies.flatMap(({ coverage }) => coverage.explicitlyCoveredTaskIds)
    ])
  }
  if (observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") return HashSet.empty()
  const prior =
    indexes === undefined
      ? undefined
      : Option.getOrUndefined(HashMap.get(indexes.byKey, outcomeRecordKey(observation.priorFullObservationOperationId)))
  const priorTaskIds =
    prior?.event._tag === "TaskTrackerFactsObserved" && prior.event.observation._tag === "CompleteTaskTrackerFacts"
      ? prior.event.observation.factFamilies[0].taskIds
      : []
  return HashSet.fromIterable([
    ...priorTaskIds,
    ...observation.factFamilies.flatMap(({ coverage }) => coverage.explicitlyCoveredTaskIds)
  ])
}

const taskIdsOf = (record: JournalRecord, indexes?: EvidenceIndexes): HashSet.HashSet<TaskId> => {
  let ids = HashSet.empty<TaskId>()
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor" && descriptor.plannedAttempt !== undefined) {
    ids = HashSet.add(ids, descriptor.plannedAttempt.taskId)
  }
  if (descriptor._tag === "OperationEventDescriptor" && descriptor.plannedAttempt._tag === "PlannedAttempt") {
    ids = HashSet.add(ids, descriptor.plannedAttempt.plannedAttempt.taskId)
  }
  const event = record.event
  if (event._tag === "TaskTrackerFactsObserved") {
    const observation = event.observation
    if (observation._tag === "FocusedTaskWorkSpecificationFacts") {
      ids = HashSet.add(ids, observation.factFamily.coverage.taskId)
    }
    if (observation._tag === "FocusedTaskClaimFacts" || observation._tag === "FocusedTaskClaimFactsUnreadable") {
      ids = HashSet.add(ids, observation.coverage.taskId)
    }
    if (observation._tag === "FocusedTaskCompletionFacts") ids = HashSet.add(ids, observation.request.taskId)
  }
  if ("plannedAttempt" in event) ids = HashSet.add(ids, event.plannedAttempt.taskId)
  if ("subject" in event) {
    if ("plannedAttempt" in event.subject) ids = HashSet.add(ids, event.subject.plannedAttempt.taskId)
    if ("taskId" in event.subject) ids = HashSet.add(ids, event.subject.taskId)
  }
  if ("claim" in event) {
    if ("taskId" in event.claim) ids = HashSet.add(ids, event.claim.taskId)
    if ("plannedAttempt" in event.claim) ids = HashSet.add(ids, event.claim.plannedAttempt.taskId)
  }
  if ("release" in event) ids = HashSet.add(ids, event.release.claim.taskId)
  if ("expectedClaim" in event) ids = HashSet.add(ids, event.expectedClaim.taskId)
  if ("request" in event) {
    if ("taskId" in event.request) ids = HashSet.add(ids, event.request.taskId)
    if ("claim" in event.request) ids = HashSet.add(ids, event.request.claim.plannedAttempt.taskId)
  }
  if ("operation" in event) {
    const operation = event.operation
    if ("plannedAttempt" in operation) ids = HashSet.add(ids, operation.plannedAttempt.taskId)
    if ("taskId" in operation) ids = HashSet.add(ids, operation.taskId)
    if ("readShape" in operation) {
      for (const taskId of operation.readShape.explicitlyCoveredTaskIds) ids = HashSet.add(ids, taskId)
    }
    if ("acquisition" in operation) ids = HashSet.add(ids, operation.acquisition.taskId)
    if ("release" in operation) ids = HashSet.add(ids, operation.release.claim.taskId)
    if ("request" in operation) {
      if ("taskId" in operation.request) ids = HashSet.add(ids, operation.request.taskId)
      if ("claim" in operation.request) ids = HashSet.add(ids, operation.request.claim.plannedAttempt.taskId)
    }
  }
  if (event._tag === "PlannedAttemptReplaced") {
    ids = HashSet.add(ids, event.subject.plannedAttempt.taskId)
    ids = HashSet.add(ids, event.successorPlan.plannedAttempt.taskId)
  }
  if (event._tag === "TargetPromotionObservedSuccess") {
    ids = HashSet.add(ids, event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId)
  }
  for (const taskId of graphObservationTaskIds(record, indexes)) ids = HashSet.add(ids, taskId)
  return ids
}

/** Adds the candidate's indexes without modifying accepted predecessor evidence. */
export const appendJournalEvidence = (prior: JournalRecordEvidence, record: JournalRecord): JournalRecordEvidence => {
  const indexes = indexesFor(prior)
  const ofKind = Option.getOrElse(HashMap.get(indexes.byKind, record.event._tag), emptyJournalRecords)
  let byAttempt = indexes.byAttempt
  let byAttemptKind = indexes.byAttemptKind
  let byAttemptCommandKind = indexes.byAttemptCommandKind
  let indexedAttemptIds = attemptIdsOf(record)
  // Git's worktree outcome names its read operation, not the planned attempt.
  // Link only through an already recorded exact worktree read in this Run.
  if (record.event._tag === "PlannedAttemptWorktreeObserved") {
    const operation = journalOperationById(journalEvidenceBefore(prior, record.position), record.event.operationId)
    if (operation?._tag === "ReadTaskWorktree" && operation.plannedAttempt.runId === record.runId) {
      indexedAttemptIds = HashSet.add(indexedAttemptIds, operation.plannedAttempt.attemptId)
    }
  }
  for (const attemptId of indexedAttemptIds) {
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
  let recordsByOperationKind = indexes.recordsByOperationKind
  for (const operationId of operationIdsOf(record)) {
    const priorOperation = Option.getOrElse(HashMap.get(recordsByOperation, operationId), emptyJournalRecords)
    recordsByOperation = HashMap.set(recordsByOperation, operationId, appendJournalRecord(priorOperation, record))
    const priorKinds = Option.getOrElse(HashMap.get(recordsByOperationKind, operationId), HashMap.empty)
    const priorKind = Option.getOrElse(HashMap.get(priorKinds, record.event._tag), emptyJournalRecords)
    recordsByOperationKind = HashMap.set(
      recordsByOperationKind,
      operationId,
      HashMap.set(priorKinds, record.event._tag, appendJournalRecord(priorKind, record))
    )
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
  const quarantineDirectionRequestId =
    record.event._tag === "IntegrationQuarantineDirectionApplied" ? record.event.requestId : undefined
  const byQuarantineDirectionRequest =
    quarantineDirectionRequestId === undefined
      ? indexes.byQuarantineDirectionRequest
      : HashMap.modifyAt(
          indexes.byQuarantineDirectionRequest,
          quarantineDirectionRequestKey(quarantineDirectionRequestId),
          Option.match({
            onNone: () => Option.some(appendJournalRecord(emptyJournalRecords(), record)),
            onSome: (records) => Option.some(appendJournalRecord(records, record))
          })
        )
  const restartReadKey = restartReadKeyOf(record)
  const byRestartRead =
    restartReadKey === undefined
      ? indexes.byRestartRead
      : HashMap.set(
          indexes.byRestartRead,
          restartReadKey,
          appendJournalRecord(
            Option.getOrElse(HashMap.get(indexes.byRestartRead, restartReadKey), emptyJournalRecords),
            record
          )
        )
  const graphEvidence = appendGraphEvidence(indexes.graphEvidence, record, (operationId) => {
    const records = Option.getOrElse(HashMap.get(indexes.operations, operationId), emptyJournalRecords)
    const operationRecord = journalRecordAt(records, lastSequenceEntryOffset)
    return operationRecord === undefined ? undefined : operationOf(operationRecord)
  })
  const acceptedOperationId = acceptedOperationIdOf(record.event)
  const acceptedOperationIds =
    acceptedOperationId === undefined
      ? indexes.acceptedOperationIds
      : HashSet.add(indexes.acceptedOperationIds, acceptedOperationId)
  const completedReadOperationId = completedReadOperationIdOf(record)
  const completedReadOperationIds =
    completedReadOperationId === undefined
      ? indexes.completedReadOperationIds
      : HashSet.add(indexes.completedReadOperationIds, completedReadOperationId)
  const pendingReadOperationIds = (() => {
    const event = record.event
    const withIntent =
      (event._tag === "GitReadIntentRecorded" || event._tag === "TaskTrackerReadIntentRecorded") &&
      !HashSet.has(completedReadOperationIds, event.operation.operationId)
        ? HashSet.add(indexes.pendingReadOperationIds, event.operation.operationId)
        : indexes.pendingReadOperationIds
    return completedReadOperationId === undefined ? withIntent : HashSet.remove(withIntent, completedReadOperationId)
  })()
  return evidence(
    appendJournalRecord(prior.records, record),
    {
      positionsAreOrdinals: indexes.positionsAreOrdinals && record.position === prior.records.length + 1,
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
      recordsByOperationKind,
      byPromotionRequest,
      byIntegratorSession,
      byQuarantineDirectionRequest,
      byRestartRead,
      claimObservationEpisodes: appendClaimObservationEpisode(indexes.claimObservationEpisodes, record),
      completionReadCycles: appendCompletionReadCycleEvidence(indexes.completionReadCycles, record),
      graphEvidence,
      specificationDivergence: appendSpecificationDivergence(indexes.specificationDivergence, record),
      readFreshnessEvidence: appendReadFreshnessEvidence(indexes.readFreshnessEvidence, record),
      stopRequestDisposition: appendStopRequestDisposition(indexes.stopRequestDisposition, record),
      retainedExecutorResponsibilitySubjects: appendRetainedExecutorResponsibilitySubjects(
        indexes.retainedExecutorResponsibilitySubjects,
        record
      ),
      settledCompletionClaimReplacements: appendSettledCompletionClaimReplacementEvidence(
        indexes.settledCompletionClaimReplacements,
        record
      ),
      workflowFinalityPremiseChanges: appendWorkflowFinalityPremiseChanges(
        indexes.workflowFinalityPremiseChanges,
        record
      ),
      acceptedOperationIds,
      acceptedOperationIdsByPosition: HashMap.set(
        indexes.acceptedOperationIdsByPosition,
        record.position,
        acceptedOperationIds
      ),
      completedReadOperationIds,
      pendingReadOperationIds,
      pendingReadOperationIdsByPosition: HashMap.set(
        indexes.pendingReadOperationIdsByPosition,
        record.position,
        pendingReadOperationIds
      )
    },
    record.position
  )
}

/** Imports a chronological decoded sequence once. Semantic validation remains a separate step. */
export const journalEvidenceFrom = (records: ReadonlyArray<JournalRecord>): JournalRecordEvidence =>
  records.reduce(appendJournalEvidence, emptyJournalEvidence())

/** A historical evidence window, not a new semantic acceptance certificate. */
export const journalEvidenceBefore = (
  source: JournalRecordEvidence,
  exclusivePosition: number
): JournalRecordEvidence => {
  if (source.lastPosition === null || source.lastPosition < exclusivePosition) return source
  const length = indexesFor(source).positionsAreOrdinals
    ? Math.max(0, exclusivePosition - 1)
    : recordCountThroughPosition(source.records, exclusivePosition - 1)
  const records = journalRecordsBefore(source.records, length)
  return evidence(records, indexesFor(source), journalRecordAt(records, lastSequenceEntryOffset)?.position ?? null)
}

/** Copies only the opaque evidence shell when the semantic validator certifies it. */
export const retainJournalEvidence = <A extends JournalRecordEvidence>(source: JournalRecordEvidence, value: A): A => {
  indexesByEvidence.set(value, indexesFor(source))
  return value
}

const visible = (source: JournalRecordEvidence, record: JournalRecord | undefined): JournalRecord | undefined =>
  record !== undefined && record.position <= (source.lastPosition ?? 0) ? record : undefined

export const journalRecordByPosition = (
  source: JournalHistorySource,
  position: JournalPosition
): JournalRecord | undefined => {
  if (!isJournalRecordEvidence(source)) return source.find((record) => record.position === position)
  if (position > (source.lastPosition ?? 0)) return undefined
  if (indexesFor(source).positionsAreOrdinals) return journalRecordAt(source.records, position - 1)
  const offset = recordCountThroughPosition(source.records, position - 1)
  const record = journalRecordAt(source.records, offset)
  return record?.position === position ? record : undefined
}

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
  const firstOffset =
    after === null
      ? 0
      : indexesFor(source).positionsAreOrdinals
        ? after
        : recordCountThroughPosition(source.records, after)
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
    if (record === undefined || record.position > (source.lastPosition ?? 0)) return
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
  const last = journalRecordAt(records, records.length - 1)
  if (last === undefined || last.position <= (source.lastPosition ?? 0)) return last
  const length = visibleRecordCount(source, records)
  return length === 0 ? undefined : journalRecordAt(records, length - 1)
}

const recordCountThroughPosition = (records: JournalRecordSequence, position: number): number => {
  let low = 0
  let high = records.length
  while (low < high) {
    const middle = Math.floor((low + high) / binarySearchDivisor)
    const record = journalRecordAt(records, middle)
    if (record !== undefined && record.position <= position) low = middle + 1
    else high = middle
  }
  return low
}

const visibleRecordCount = (source: JournalRecordEvidence, records: JournalRecordSequence): number =>
  recordCountThroughPosition(records, source.lastPosition ?? 0)

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
    : source.filter((record) => HashSet.has(operationIdsOf(record), operationId))

export const journalRecordsForOperationIdKind = (
  source: JournalHistorySource,
  operationId: OperationId,
  kind: JournalRecord["event"]["_tag"]
): Iterable<JournalRecord> => {
  if (!isJournalRecordEvidence(source)) {
    return source.filter((record) => record.event._tag === kind && HashSet.has(operationIdsOf(record), operationId))
  }
  const kinds = Option.getOrElse(HashMap.get(indexesFor(source).recordsByOperationKind, operationId), HashMap.empty)
  return indexedRecords(source, Option.getOrElse(HashMap.get(kinds, kind), emptyJournalRecords))
}

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
    : source.filter((record) => HashSet.has(integratorSessionIdsOf(record), sessionId))

/** Every applied direction carrying one exact redeliverable transport identity, in Journal order. */
export const journalRecordsForQuarantineDirectionRequest = (
  source: JournalHistorySource,
  requestId: IntegrationQuarantineDirectionRequestId
): Iterable<JournalRecord> =>
  isJournalRecordEvidence(source)
    ? indexedRecords(
        source,
        Option.getOrElse(
          HashMap.get(indexesFor(source).byQuarantineDirectionRequest, quarantineDirectionRequestKey(requestId)),
          emptyJournalRecords
        )
      )
    : source.filter(
        (record) =>
          record.event._tag === "IntegrationQuarantineDirectionApplied" &&
          record.event.requestId.runId === requestId.runId &&
          record.event.requestId.nonce === requestId.nonce
      )

export const journalRestartReadIntents = (
  source: JournalHistorySource,
  nonce: string,
  phase: "claim" | "graph" | "specification" | "target-lineage" | "worktree"
): Iterable<JournalRecord> => {
  const key = `${encodeURIComponent(nonce)}:${phase}`
  return isJournalRecordEvidence(source)
    ? indexedRecords(source, Option.getOrElse(HashMap.get(indexesFor(source).byRestartRead, key), emptyJournalRecords))
    : source.filter((record) => restartReadKeyOf(record) === key)
}

export const journalTaskClaimObservationAt = (source: JournalRecordEvidence, taskId: TaskId) =>
  claimObservationEpisodeAt(indexesFor(source).claimObservationEpisodes, taskId, source.lastPosition ?? 0)

export const journalCompletionReadCycle = (
  source: JournalRecordEvidence,
  query: Omit<Parameters<typeof completionReadCycleAt>[1], "throughPosition">
) =>
  completionReadCycleAt(indexesFor(source).completionReadCycles, {
    ...query,
    throughPosition: source.lastPosition ?? 0
  })

/** Latest graph observation visible at this evidence cutoff, optionally scoped to target and named plan. */
export const journalGraphObservationAt = (
  source: JournalRecordEvidence,
  query: { readonly target?: TrackerTarget; readonly plannedAttempt?: PlannedTaskAttempt }
): JournalRecord | undefined =>
  lastGraphObservationAt(indexesFor(source).graphEvidence, { ...query, throughPosition: source.lastPosition ?? 0 })

/** Immutable graph snapshot derived at one exact observation and bounded by this evidence cutoff. */
export const journalGraphSnapshotForObservation = (source: JournalRecordEvidence, position: JournalPosition) =>
  graphSnapshotForObservation(indexesFor(source).graphEvidence, position, source.lastPosition ?? 0)

/** Exact blocked-then-clear graph episode visible at this immutable evidence cutoff. */
export const journalGraphBlockerClearEpisodeAt = (
  source: JournalRecordEvidence,
  query: { readonly target: TrackerTarget; readonly taskId: TaskId; readonly afterPosition: number }
) =>
  graphBlockerClearEpisodeAt(indexesFor(source).graphEvidence, { ...query, throughPosition: source.lastPosition ?? 0 })

/** Whether a distinct authored specification was observed after one exact earlier choice. */
export const journalSpecificationDivergedAfter = (
  source: JournalRecordEvidence,
  query: {
    readonly taskId: TaskId
    readonly target?: TrackerTarget
    readonly expected: TaskRevision
    readonly afterPosition: number
  }
): boolean =>
  specificationDivergedAfter(indexesFor(source).specificationDivergence, {
    ...query,
    throughPosition: source.lastPosition ?? 0
  })

export const journalLatestTaskObservation = (
  source: JournalRecordEvidence,
  query: Omit<Parameters<typeof latestTaskObservationAt>[1], "throughPosition">
): JournalRecord | undefined =>
  latestTaskObservationAt(indexesFor(source).readFreshnessEvidence, {
    ...query,
    throughPosition: source.lastPosition ?? 0
  })

export const journalLatestTaskRead = (
  source: JournalRecordEvidence,
  query: Omit<Parameters<typeof latestTaskReadAt>[1], "throughPosition">
): JournalRecord | undefined =>
  latestTaskReadAt(indexesFor(source).readFreshnessEvidence, { ...query, throughPosition: source.lastPosition ?? 0 })

export const journalLatestAttemptRead = (
  source: JournalRecordEvidence,
  query: Omit<Parameters<typeof latestAttemptReadAt>[1], "throughPosition">
): JournalRecord | undefined =>
  latestAttemptReadAt(indexesFor(source).readFreshnessEvidence, { ...query, throughPosition: source.lastPosition ?? 0 })

/** One Stop request's latest distinct claim-disposition facts visible at this immutable evidence cutoff. */
export const journalStopRequestDispositionAt = (
  source: JournalRecordEvidence,
  request: AttemptChoiceRequestId
): ReturnType<typeof stopRequestDispositionAt> =>
  stopRequestDispositionAt(indexesFor(source).stopRequestDisposition, request, source.lastPosition ?? 0)

/** Retained executor responsibilities visible at this immutable evidence cutoff; current execution is a separate fact. */
export const journalRetainedExecutorResponsibilitySubjects = (source: JournalRecordEvidence, runId: RunId) =>
  retainedExecutorResponsibilitySubjectsAt(indexesFor(source).retainedExecutorResponsibilitySubjects, {
    runId,
    throughPosition: source.lastPosition ?? 0
  })

/** The first exact replacement intent and outcome settled for one completion claim at this evidence cutoff. */
export const journalSettledCompletionClaimReplacement = (source: JournalRecordEvidence, claim: CompletionTaskClaim) =>
  settledCompletionClaimReplacementAt(indexesFor(source).settledCompletionClaimReplacements, {
    claim,
    throughPosition: source.lastPosition ?? 0
  })

/** Latest record that may invalidate a Run finality proof at this immutable evidence cutoff. */
export const journalWorkflowFinalityPremiseChangeAt = (
  source: JournalRecordEvidence,
  runId: RunId
): JournalPosition | undefined =>
  lastWorkflowFinalityPremiseChangeAt(indexesFor(source).workflowFinalityPremiseChanges, {
    runId,
    throughPosition: source.lastPosition ?? 0
  })

/** Persistent operation identities whose initiating facts are visible at this exact evidence cutoff. */
export const journalAcceptedOperationIds = (source: JournalRecordEvidence): HashSet.HashSet<OperationId> =>
  source.lastPosition === null
    ? HashSet.empty()
    : Option.getOrElse(
        HashMap.get(indexesFor(source).acceptedOperationIdsByPosition, source.lastPosition),
        HashSet.empty
      )

/** Persistent ordinary read identities with an intent and no typed outcome at this exact evidence cutoff. */
export const journalPendingReadOperationIds = (source: JournalRecordEvidence): HashSet.HashSet<OperationId> =>
  source.lastPosition === null
    ? HashSet.empty()
    : Option.getOrElse(
        HashMap.get(indexesFor(source).pendingReadOperationIdsByPosition, source.lastPosition),
        HashSet.empty
      )

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
    if (record !== undefined && record.position <= (source.lastPosition ?? 0)) low = middle + 1
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
    : source.filter((record) => rawRecordBelongsToAttempt(source, record, attemptId))

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
    : source.filter((record) => record.event._tag === kind && rawRecordBelongsToAttempt(source, record, attemptId))

export const lastJournalRecordForAttemptKind = (
  source: JournalHistorySource,
  attemptId: AttemptId,
  kind: JournalRecord["event"]["_tag"]
): JournalRecord | undefined =>
  isJournalRecordEvidence(source)
    ? lastVisibleRecord(source, attemptKindRecords(source, attemptId, kind))
    : source.findLast((record) => record.event._tag === kind && rawRecordBelongsToAttempt(source, record, attemptId))

/** Read-only presence hint; false proves the persistent attempt/kind index has no record at any retained cutoff. */
export const journalHasAttemptKindRecords = (
  source: JournalRecordEvidence,
  attemptId: AttemptId,
  kind: JournalRecord["event"]["_tag"]
): boolean => attemptKindRecords(source, attemptId, kind).length > 0

export const journalRecordCountForAttemptKind = (
  source: JournalHistorySource,
  attemptId: AttemptId,
  kind: JournalRecord["event"]["_tag"]
): number =>
  isJournalRecordEvidence(source)
    ? visibleRecordCount(source, attemptKindRecords(source, attemptId, kind))
    : source.filter((record) => record.event._tag === kind && rawRecordBelongsToAttempt(source, record, attemptId))
        .length

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
        HashSet.has(attemptIdsOf(record), attemptId)
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
        if (HashSet.has(taskIdsOf(record), taskId)) return true
        if (
          record.event._tag !== "TaskTrackerFactsObserved" ||
          record.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
        )
          return false
        const priorOperationId = record.event.observation.priorFullObservationOperationId
        const prior = source.find(({ key }) => key === outcomeRecordKey(priorOperationId))
        return prior !== undefined && HashSet.has(taskIdsOf(prior), taskId)
      })

export const journalRecordsForTaskKind = (
  source: JournalHistorySource,
  taskId: TaskId,
  kind: JournalRecord["event"]["_tag"]
): Iterable<JournalRecord> => {
  if (!isJournalRecordEvidence(source)) {
    return source.filter((record) => record.event._tag === kind && HashSet.has(taskIdsOf(record), taskId))
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
    indexes.recordsByOperationKind,
    indexes.byPromotionRequest,
    indexes.byIntegratorSession,
    indexes.byQuarantineDirectionRequest,
    indexes.byRestartRead,
    indexes.claimObservationEpisodes,
    indexes.completionReadCycles,
    indexes.graphEvidence,
    indexes.specificationDivergence,
    indexes.readFreshnessEvidence,
    indexes.stopRequestDisposition,
    indexes.retainedExecutorResponsibilitySubjects,
    indexes.settledCompletionClaimReplacements,
    indexes.workflowFinalityPremiseChanges,
    indexes.acceptedOperationIds,
    indexes.acceptedOperationIdsByPosition,
    indexes.completedReadOperationIds,
    indexes.pendingReadOperationIds,
    indexes.pendingReadOperationIdsByPosition,
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
    ...Array.from(HashMap.values(indexes.recordsByOperationKind)).flatMap((kinds) =>
      Array.from(HashMap.values(kinds), inspectJournalRecordStorage)
    ),
    ...Array.from(HashMap.values(indexes.byPromotionRequest), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byIntegratorSession), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byQuarantineDirectionRequest), inspectJournalRecordStorage),
    ...Array.from(HashMap.values(indexes.byRestartRead), inspectJournalRecordStorage),
    ...inspectClaimObservationEpisodeStorage(indexes.claimObservationEpisodes),
    ...inspectCompletionReadCycleStorage(indexes.completionReadCycles),
    ...inspectGraphEvidenceStorage(indexes.graphEvidence),
    ...inspectSpecificationDivergenceStorage(indexes.specificationDivergence),
    ...inspectReadFreshnessEvidenceStorage(indexes.readFreshnessEvidence),
    ...inspectStopRequestDispositionStorage(indexes.stopRequestDisposition),
    ...inspectRetainedExecutorResponsibilityStorage(indexes.retainedExecutorResponsibilitySubjects),
    ...inspectSettledCompletionClaimReplacementStorage(indexes.settledCompletionClaimReplacements),
    ...inspectWorkflowFinalityPremiseChangesStorage(indexes.workflowFinalityPremiseChanges)
  ]
}
