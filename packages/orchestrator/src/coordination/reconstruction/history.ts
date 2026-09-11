/* eslint-disable functional/immutable-data, max-lines -- The chronological validator owns its local indexes and cross-event invariants. */
import { type AttemptId, type PlannedTaskAttempt, type RunId, type TaskId } from "@dalph/contracts"
import { type JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import {
  acceptedJournalPrefixFromValidatedHistory,
  acceptedJournalPrefixFromValidatedEvidence,
  appendValidatedJournalRecord,
  type AcceptedJournalPrefix
} from "../../workflow-journal/accepted-prefix.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { Effect, HashMap, HashSet, Iterable, Option, Schema } from "effect"
import {
  firstJournalRecordOfKind,
  lastJournalRecordOfKind,
  journalRecordByPosition,
  journalRecordByKey,
  journalRecordsOfKind,
  lastJournalRecordForTaskKind,
  journalEvidenceBefore,
  appendJournalEvidence,
  emptyJournalEvidence,
  isJournalRecordEvidence,
  type JournalHistorySource,
  type JournalRecordEvidence
} from "../../workflow-journal/record-evidence.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { journalRecordAt, materializeJournalRecords } from "../../workflow-journal/record-sequence.js"
import {
  duplicateUnfinishedTaskAttemptIssue,
  type InvalidWorkflowJournalHistory,
  type InvalidWorkflowJournalSuccessor,
  type WorkflowJournalHistoryIssue,
  type WorkflowJournalHistorySemanticIssue,
  type ValidWorkflowJournalHistory
} from "./history-result.js"
import { advanceReconstructedRunState, reconstructValidatedRunState } from "./reduce.js"
import type { AcceptedReconstructedRunState, AcceptedReconstructedWorkflowHistory } from "./state.js"
import { runGraphTaskFactsOutcome } from "../frontier/run-finality.js"
import { invalidTaskTrackerReconfirmationReference } from "../../workflow/task-tracker-facts/reconfirmation.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { validateRunPolicyHistory } from "./run-policy-history.js"
import { validateIntegrationHistoryRecord } from "./integration-history-validation.js"
import { validateTaskClaimRelease } from "./claim-release-history.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { ActiveTaskClaim, isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { validateIntegrationFinalityHistoryRecord } from "../../workflow/protocols/integration-finality/history.js"
import { hasLaterCompleteObservation } from "../../workflow-journal/run-termination-freshness.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { validateCancelledAttemptHistory } from "./cancelled-attempt-history.js"
import {
  emptyIndexes,
  identityIssue,
  makeWorkflowJournalHistoryIssueCollector,
  mapGet,
  semanticIssue,
  type FoldIndexes,
  type WorkflowJournalHistoryIssueCollector,
  type WorkflowJournalHistoryIssueReporter
} from "./history-kernel-state.js"
import { validateExecutorEvent } from "./executor-history-validation.js"
import {
  validateAttemptChoice,
  validateAttemptStop,
  validateAttemptRestartAuthorityReadFailure,
  validateContinuationAuthorization,
  validateOperationEvent,
  validatePlannedAttemptReplacement,
  validatePlan
} from "./attempt-validation.js"
export {
  replacementFollowsIntegrationCutoff,
  replacementProofIsAcceptedSafe,
  replacementResourceConflict,
  validateAttemptStopHistory
} from "./attempt-validation.js"

const finalArrayElementOffset = -1
const currentRecordExclusivePositionOffset = 2

/** Cold malformed envelopes retain their original predicate search; live evidence uses the exact key. */
const keyedCandidates = (records: JournalHistorySource, key: JournalRecordKey): Iterable<JournalRecord> => {
  if (!isJournalRecordEvidence(records)) return records
  const record = journalRecordByKey(records, key)
  return record === undefined ? [] : [record]
}

const validationPathByHistory = new WeakMap<
  object,
  "IndexedCold" | "RawDiagnostic" | "IndexedSuccessor" | "IndexedSuccessorRejected"
>()

/** Test-only path evidence: valid canonical histories must not take raw diagnostic replay. */
export const inspectWorkflowJournalHistoryValidationPath = (history: object) => validationPathByHistory.get(history)

let validationStepObserver: (() => void) | undefined

/** Test-only synchronous kernel counter; cleanup restores any enclosing observer. */
export const observeWorkflowJournalValidationSteps = (observer: () => void): (() => void) => {
  const prior = validationStepObserver
  validationStepObserver = observer
  return () => {
    validationStepObserver = prior
  }
}

type UnfinishedAttempt = { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
const ValidatedKernelStateTypeId: unique symbol = Symbol("ValidatedKernelState")
interface ValidatedKernelState {
  readonly indexes: FoldIndexes
  readonly unfinished: HashMap.HashMap<TaskId, UnfinishedAttempt>
}
/** Accepted history and its immutable chronological kernel state are one nominal in-process value; decoded objects cannot impersonate it. */
export interface KernelValidatedWorkflowJournalHistory {
  readonly [ValidatedKernelStateTypeId]: ValidatedKernelState
  readonly _tag: "ValidWorkflowJournalHistory"
  readonly runState: AcceptedReconstructedRunState
  readonly runId: RunId
  readonly prefix: AcceptedJournalPrefix
}
/** An internal caller bypassed nominal construction; replay must not conceal the programming defect. */
class JournalKernelInvariantDefect extends Schema.TaggedError<JournalKernelInvariantDefect>()(
  "JournalKernelInvariantDefect",
  { detail: Schema.String }
) {
  override get message(): string {
    return this.detail
  }
}

const acceptedWorkflowHistory = (prefix: AcceptedJournalPrefix): AcceptedReconstructedWorkflowHistory => ({
  evidence: prefix
})

const acceptedHistoryResult = (
  prefix: AcceptedJournalPrefix,
  runState: AcceptedReconstructedRunState,
  kernel: ValidatedKernelState
): ValidWorkflowJournalHistory => ({
  [ValidatedKernelStateTypeId]: kernel,
  _tag: "ValidWorkflowJournalHistory",
  prefix,
  runId: prefix.runId,
  runState
})

const attemptIsFinished = (indexes: FoldIndexes, attemptId: AttemptId): boolean =>
  HashSet.has(indexes.terminalExecutorAttempts, attemptId) ||
  HashSet.has(indexes.abandonedExecutorAttempts, attemptId) ||
  HashSet.has(indexes.supersededExecutorAttempts, attemptId)

const unfinishedTasksFrom = (indexes: FoldIndexes): HashMap.HashMap<TaskId, UnfinishedAttempt> => {
  let unfinished: HashMap.HashMap<TaskId, UnfinishedAttempt> = HashMap.empty()
  for (const [attemptId, responsibility] of indexes.executorResponsibilitiesBegan) {
    if (!attemptIsFinished(indexes, attemptId))
      unfinished = HashMap.set(unfinished, responsibility.plannedAttempt.taskId, responsibility)
  }
  return unfinished
}

/** Only responsibility acquisition or exact terminal/supersession changes can affect this invariant. */
const advanceUnfinishedTasks = (
  prior: HashMap.HashMap<TaskId, UnfinishedAttempt>,
  indexes: FoldIndexes,
  record: JournalRecord
): HashMap.HashMap<TaskId, UnfinishedAttempt> | undefined => {
  const event = record.event
  const attemptId =
    event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      ? event.plannedAttempt.attemptId
      : event._tag === "PlannedAttemptExecutorWorkReported"
        ? event.report.correlation.attemptId
        : event._tag === "AttemptImplementationAbandoned" || event._tag === "PlannedAttemptReplaced"
          ? event.subject.plannedAttempt.attemptId
          : undefined
  if (attemptId === undefined) return prior
  const responsibility = mapGet(indexes.executorResponsibilitiesBegan, attemptId)
  if (responsibility === undefined) return prior
  const taskId = responsibility.plannedAttempt.taskId
  const existing = mapGet(prior, taskId)
  if (attemptIsFinished(indexes, attemptId))
    return existing?.plannedAttempt.attemptId === attemptId ? HashMap.remove(prior, taskId) : prior
  if (existing !== undefined && existing.plannedAttempt.attemptId !== attemptId) return undefined
  return HashMap.set(prior, taskId, responsibility)
}

const validateRecordEnvelope = (
  record: JournalRecord,
  index: number,
  runId: RunId,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): { readonly unique: boolean; readonly indexes: FoldIndexes } => {
  const expectedPosition = index + 1
  if (record.position !== expectedPosition) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `expected canonical position ${expectedPosition}, found ${record.position}`
    )
  }
  if (record.runId !== runId) {
    identityIssue(issues, runId, record.position, `record belongs to run ${record.runId}`)
  }
  const descriptor = describeJournalEvent(record.event)
  if (record.key !== descriptor.expectedKey) {
    identityIssue(
      issues,
      runId,
      record.position,
      `event ${record.event._tag} requires record key ${descriptor.expectedKey}, found ${record.key}`
    )
  }
  if (HashSet.has(indexes.seenKeys, record.key)) {
    semanticIssue(issues, runId, record.position, `duplicate journal record key ${record.key}`)
    return { unique: false, indexes }
  }
  return { unique: true, indexes: { ...indexes, seenKeys: HashSet.add(indexes.seenKeys, record.key) } }
}

const validateControlDirection = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): FoldIndexes => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag !== "ControlDirectionEventDescriptor") return indexes
  if (descriptor.runId !== runId) {
    identityIssue(
      issues,
      runId,
      record.position,
      `control direction ${descriptor.ordinal} binds run ${descriptor.runId}`
    )
  }
  const expectedOrdinal = indexes.latestControlDirectionOrdinal + 1
  if (descriptor.ordinal !== expectedOrdinal) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `control direction expected ordinal ${expectedOrdinal}, found ${descriptor.ordinal}`
    )
  }
  return { ...indexes, latestControlDirectionOrdinal: descriptor.ordinal }
}

const validateTaskClaimReacquisitionDirection = (
  record: JournalRecord,
  runId: RunId,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag === "TaskClaimReacquisitionDirectionEventDescriptor" && descriptor.runId !== runId) {
    identityIssue(
      issues,
      runId,
      record.position,
      `task-claim reacquisition request ${descriptor.requestId} binds run ${descriptor.runId}`
    )
  }
}

const acquiredClaimMatchesIntent = (
  acquired: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"],
  intended: Extract<
    JournalRecord["event"],
    { readonly _tag: "TaskClaimAcquisitionIntended" }
  >["operation"]["acquisition"]
): boolean =>
  acquired.operationId === intended.operationId &&
  acquired.owner === intended.owner &&
  acquired.taskId === intended.taskId &&
  acquired.token === intended.token

const validateClaim = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (record.event._tag !== "TaskClaimAcquired") return
  const acquired = record.event.claim
  const intent = Option.getOrUndefined(
    Iterable.findFirst(
      keyedCandidates(records, intentRecordKey(acquired.operationId)),
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" &&
        event.operation.acquisition.operationId === acquired.operationId
    )
  )?.event
  const intended = intent?._tag === "TaskClaimAcquisitionIntended" ? intent.operation.acquisition : undefined
  if (intended === undefined || !acquiredClaimMatchesIntent(acquired, intended)) {
    identityIssue(issues, runId, record.position, `acquired task claim contradicts operation ${acquired.operationId}`)
  }
}

const validateClaimRejection = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (record.event._tag !== "TaskClaimAcquisitionRejected") return
  const rejected = record.event
  const intent = Option.getOrUndefined(
    Iterable.findFirst(
      keyedCandidates(records, intentRecordKey(rejected.operationId)),
      ({ event, position }) =>
        position < record.position &&
        event._tag === "TaskClaimAcquisitionIntended" &&
        event.operation.acquisition.operationId === rejected.operationId
    )
  )?.event
  /* v8 ignore next -- @preserve The event descriptor separately reports a rejection without its required intent. */
  if (intent?._tag !== "TaskClaimAcquisitionIntended") return
  const attempted = ActiveTaskClaim.make(intent.operation.acquisition)
  if (rejected.observed.taskId !== attempted.taskId || isExactTaskClaim(rejected.observed, attempted)) {
    identityIssue(
      issues,
      runId,
      record.position,
      `rejected task claim ${rejected.operationId} does not prove a foreign claim for ${attempted.taskId}`
    )
  }
}

const matchingReacquisitionDirection = (record: JournalRecord, runId: RunId, records: JournalHistorySource) => {
  /* v8 ignore next -- @preserve The caller invokes this helper only for an explicit acquisition intent. */
  if (record.event._tag !== "TaskClaimAcquisitionIntended") return undefined
  const { acquisition } = record.event.operation
  const expectedClaim = isJournalRecordEvidence(records)
    ? lastJournalRecordForTaskKind(
        journalEvidenceBefore(records, record.position),
        acquisition.taskId,
        "TaskClaimAcquired"
      )?.event
    : records.findLast(
        ({ event, position }) =>
          position < record.position && event._tag === "TaskClaimAcquired" && event.claim.taskId === acquisition.taskId
      )?.event
  /* v8 ignore start -- @preserve Missing prior acquisition authority is rejected by the caller's undefined direction result. */
  const direction =
    expectedClaim?._tag === "TaskClaimAcquired"
      ? latestTaskClaimReacquisitionDirection(records, runId, acquisition.taskId, expectedClaim.claim, record.position)
      : undefined
  /* v8 ignore stop -- @preserve */
  return direction?._tag === "TaskClaimReacquisitionDirected" ? direction : undefined
}

const validateClaimReacquisitionIntent = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (record.event._tag !== "TaskClaimAcquisitionIntended") return
  const { acquisition, authority } = record.event.operation
  if (authority._tag !== "ExplicitTaskClaimReacquisitionAuthority") return
  const direction = matchingReacquisitionDirection(record, runId, records)
  const matchesAuthority =
    direction?.requestId === authority.requestId &&
    taskClaimReacquisitionOperationId(direction.requestId) === acquisition.operationId
  if (!matchesAuthority) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `task-claim reacquisition ${acquisition.operationId} has no prior matching applied Operator direction`
    )
  }
}

const findTrackerReadIntent = (
  records: JournalHistorySource,
  observedEvent: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>,
  observedAt: JournalPosition
) =>
  Option.getOrUndefined(
    Iterable.findFirst(
      keyedCandidates(records, intentRecordKey(observedEvent.operationId)),
      ({ event, position }) =>
        position < observedAt &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation.operationId === observedEvent.operationId
    )
  )?.event

const validateReconfirmationReference = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): FoldIndexes => {
  const validation = invalidTaskTrackerReconfirmationReference(record, runId, indexes.trackerReconfirmations)
  if (validation.detail !== undefined) semanticIssue(issues, runId, record.position, validation.detail)
  return { ...indexes, trackerReconfirmations: validation.index }
}

const validateTrackerObservation = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return
  const observedEvent = record.event
  const intent = findTrackerReadIntent(records, observedEvent, record.position)
  if (
    intent?._tag === "TaskTrackerReadIntentRecorded" &&
    !taskTrackerObservationMatchesRead(observedEvent.observation, intent.operation)
  ) {
    identityIssue(
      issues,
      runId,
      record.position,
      `task-tracker facts contradict initiating read ${observedEvent.operationId}`
    )
  }
}

const validateOneUnfinishedAttemptPerTask = (
  runId: RunId,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  const unfinishedByTask = new Map<
    TaskId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >()
  const responsibilities = [...indexes.executorResponsibilitiesBegan].sort(
    ([, left], [, right]) => Number(left.position) - Number(right.position)
  )
  for (const [attemptId, responsibility] of responsibilities) {
    if (
      HashSet.has(indexes.terminalExecutorAttempts, attemptId) ||
      HashSet.has(indexes.abandonedExecutorAttempts, attemptId) ||
      HashSet.has(indexes.supersededExecutorAttempts, attemptId)
    )
      continue
    const taskId = responsibility.plannedAttempt.taskId
    const prior = unfinishedByTask.get(taskId)
    if (prior === undefined) {
      unfinishedByTask.set(taskId, { plannedAttempt: responsibility.plannedAttempt, position: responsibility.position })
      continue
    }
    issues(
      duplicateUnfinishedTaskAttemptIssue(
        runId,
        prior.plannedAttempt,
        prior.position,
        responsibility.plannedAttempt,
        responsibility.position
      )
    )
  }
}

const validateLifecycleBoundaries = (
  runId: RunId,
  records: JournalHistorySource,
  began: JournalRecord | undefined,
  terminated: JournalRecord | undefined,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (began !== undefined && began.position !== 1) {
    semanticIssue(issues, runId, began.position, "WorkflowRunBegan must be the first record")
  }
  if (terminated !== undefined && began === undefined) {
    semanticIssue(issues, runId, terminated.position, "WorkflowRunTerminated requires prior WorkflowRunBegan")
  }
  const lastRecord = isJournalRecordEvidence(records)
    ? journalRecordAt(records.records, finalArrayElementOffset)
    : records.at(finalArrayElementOffset)
  if (terminated !== undefined && terminated !== lastRecord) {
    semanticIssue(issues, runId, terminated.position, "WorkflowRunTerminated must be the final record")
  }
}

const validateCancellationMultiplicity = (
  runId: RunId,
  cancellations: ReadonlyArray<JournalRecord>,
  issues: WorkflowJournalHistoryIssueReporter<WorkflowJournalHistorySemanticIssue>
): void => {
  if (cancellations.length > 1) {
    for (const duplicate of cancellations.slice(1)) {
      semanticIssue(issues, runId, duplicate.position, "RunCancellationApplied may occur only once")
    }
  }
}

/** Reuses the canonical one-cancellation rule at a presentation boundary. */
export const validateCancellationMultiplicityHistory = (
  runId: RunId,
  records: JournalHistorySource
): ReadonlyArray<WorkflowJournalHistorySemanticIssue> => {
  const collector = makeWorkflowJournalHistoryIssueCollector<WorkflowJournalHistorySemanticIssue>()
  validateCancellationMultiplicity(
    runId,
    Array.from(journalRecordsOfKind(records, "RunCancellationApplied")),
    collector.report
  )
  return collector.toReadonlyArray()
}

const validateCancellationBeginning = (
  runId: RunId,
  began: JournalRecord | undefined,
  cancellations: ReadonlyArray<JournalRecord>,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  const firstInvalid = cancellations.find(({ position }) => began === undefined || position <= began.position)
  if (firstInvalid !== undefined) {
    semanticIssue(issues, runId, firstInvalid.position, "RunCancellationApplied requires prior WorkflowRunBegan")
  }
}

const validateRunLifecycle = (
  runId: RunId,
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  const began = firstJournalRecordOfKind(records, "WorkflowRunBegan")
  const terminated = firstJournalRecordOfKind(records, "WorkflowRunTerminated")
  const cancellations = Array.from(journalRecordsOfKind(records, "RunCancellationApplied"))
  validateLifecycleBoundaries(runId, records, began, terminated, issues)
  validateCancellationMultiplicity(runId, cancellations, issues)
  validateCancellationBeginning(runId, began, cancellations, issues)
  if (terminated?.event._tag === "WorkflowRunTerminated") {
    validateTerminationEvidence(
      runId,
      records,
      began,
      terminated.position,
      terminated.event,
      cancellations.length > 0,
      issues
    )
  }
}

type TaskTrackerFactsObservedEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
type TerminationTrackerObservation = Extract<
  TaskTrackerFactsObservedEvent["observation"],
  { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
>
type CompleteTrackerObservation = Extract<
  TaskTrackerFactsObservedEvent["observation"],
  { readonly _tag: "CompleteTaskTrackerFacts" }
>
const prerequisitesFactFamilyIndex = 2
const groupingsFactFamilyIndex = 3
type TerminationTrackerRecord = Omit<JournalRecord, "event"> & {
  readonly event: TaskTrackerFactsObservedEvent & { readonly observation: TerminationTrackerObservation }
}

const isTerminationTrackerRecord = (
  record: JournalRecord | undefined,
  terminatedAt: JournalPosition
): record is TerminationTrackerRecord => {
  if (record === undefined) return false
  if (record.position >= terminatedAt) return false
  const { event } = record
  if (event._tag !== "TaskTrackerFactsObserved") return false
  return (
    event.observation._tag === "CompleteTaskTrackerFacts" ||
    event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
  )
}

const terminationObservationsFor = (
  records: JournalHistorySource,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  terminatedAt: JournalPosition,
  reject: (detail: string) => void
): { readonly fresh: TerminationTrackerObservation; readonly complete: CompleteTrackerObservation } | undefined => {
  const observed = journalRecordByPosition(records, evidence.observedAt)
  if (!isTerminationTrackerRecord(observed, terminatedAt)) {
    reject("termination evidence must name one earlier complete or unchanged tracker observation position")
    return undefined
  }
  const fresh = observed.event.observation
  const completeObservationRecord =
    fresh._tag === "CompleteTaskTrackerFacts"
      ? observed
      : Option.getOrUndefined(
          Iterable.findFirst(
            keyedCandidates(records, outcomeRecordKey(fresh.priorFullObservationOperationId)),
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" &&
              event.operationId === fresh.priorFullObservationOperationId &&
              event.observation._tag === "CompleteTaskTrackerFacts"
          )
        )
  if (
    completeObservationRecord?.event._tag !== "TaskTrackerFactsObserved" ||
    completeObservationRecord.event.observation._tag !== "CompleteTaskTrackerFacts"
  ) {
    reject("unchanged termination evidence must link to its earlier complete tracker observation")
    return undefined
  }
  return { fresh, complete: completeObservationRecord.event.observation }
}

const validateTerminationIntent = (
  records: JournalHistorySource,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): void => {
  const intent = Option.getOrUndefined(
    Iterable.findFirst(
      keyedCandidates(records, intentRecordKey(evidence.operationId)),
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === evidence.operationId
    )
  )
  if (intent?.event._tag !== "TaskTrackerReadIntentRecorded" || intent.event.operation._tag !== "ReadTrackerGraph") {
    reject("termination evidence must name the exact complete graph-read intent")
  } else if (
    taskTrackerTargetKey(intent.event.operation.target) !== taskTrackerTargetKey(evidence.target) ||
    exactTaskIdSetKey(intent.event.operation.readShape.explicitlyCoveredTaskIds) !==
      exactTaskIdSetKey(evidence.readShape.explicitlyCoveredTaskIds)
  ) {
    reject("termination evidence read shape or target does not match its graph-read intent")
  }
}

const validateTerminationFreshObservation = (
  observation: TerminationTrackerObservation,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): void => {
  if (
    observation.operationId !== evidence.operationId ||
    taskTrackerTargetKey(observation.target) !== taskTrackerTargetKey(evidence.target)
  ) {
    reject("termination evidence operation or target does not match the observed graph")
  }
  if (
    observation.factFamilies.some(
      ({ contentIdentity, coverage }) =>
        contentIdentity !== evidence.contentIdentity ||
        taskTrackerTargetKey(coverage.target) !== taskTrackerTargetKey(evidence.target) ||
        exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds) !==
          exactTaskIdSetKey(evidence.coverage.explicitlyCoveredTaskIds)
    )
  ) {
    reject("termination evidence does not match the fresh observation's identity and coverage")
  }
}

const validateTerminationFactFamilies = (
  observation: CompleteTrackerObservation,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): {
  readonly identities: (typeof observation.factFamilies)[0]
  readonly lifecycles: (typeof observation.factFamilies)[1]
  readonly prerequisites: (typeof observation.factFamilies)[typeof prerequisitesFactFamilyIndex]
  readonly groupings: (typeof observation.factFamilies)[typeof groupingsFactFamilyIndex]
} => {
  const [identities, lifecycles, prerequisites, groupings] = observation.factFamilies
  const observedFamilyTags = observation.factFamilies.map(({ _tag }) => _tag)
  if (evidence.requiredFactFamilies.some((family, index) => family !== observedFamilyTags[index])) {
    reject("termination evidence must retain every required graph fact family in order")
  }
  // An unchanged read may use a different explicit closure while linking to
  // an earlier complete observation. The fresh observation above owns exact
  // target and coverage validation; these retained fact families own content.
  if (evidence.rootTaskId !== observation.rootTaskId) {
    reject("termination evidence must retain the exact tracker-selected Run root")
  }
  if (!groupings.groupings.some(({ taskId }) => taskId === evidence.rootTaskId)) {
    reject("termination evidence Run root must belong to the complete grouping facts")
  }
  return { identities, lifecycles, prerequisites, groupings }
}

const terminationGraphFactsFor = (
  lifecycles: CompleteTrackerObservation["factFamilies"][1],
  prerequisites: CompleteTrackerObservation["factFamilies"][typeof prerequisitesFactFamilyIndex]
): {
  readonly terminalTaskIds: ReadonlyArray<TaskId>
  readonly blockedTaskIds: ReadonlySet<TaskId>
  readonly graphOutcome: "AllTasksSucceeded" | "Blocked" | "Unsettled"
} => {
  const prerequisitesByTask = new Map(
    prerequisites.prerequisites.map(({ prerequisiteTaskIds, taskId }) => [taskId, prerequisiteTaskIds] as const)
  )
  const graphFacts = runGraphTaskFactsOutcome(
    lifecycles.lifecycles.map(({ lifecycle, taskId }) => ({
      id: taskId,
      lifecycle,
      /* v8 ignore next -- @preserve CompleteTaskTrackerFactsObserved rejects any missing prerequisite row for a lifecycle task before this typed fact family reaches terminationGraphFactsFor. */
      prerequisiteIds: prerequisitesByTask.get(taskId) ?? []
    }))
  )
  return { ...graphFacts, blockedTaskIds: new Set(graphFacts.blockedTaskIds) }
}

const validateTerminationGraphFacts = (
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  identities: CompleteTrackerObservation["factFamilies"][0],
  graphFacts: ReturnType<typeof terminationGraphFactsFor>,
  reject: (detail: string) => void
): void => {
  if (evidence.contentIdentity !== identities.contentIdentity || evidence.graphOutcome !== graphFacts.graphOutcome) {
    reject("termination evidence revision or graph outcome is not current")
  }
  if (exactTaskIdSetKey(evidence.terminalTaskIds) !== exactTaskIdSetKey(graphFacts.terminalTaskIds)) {
    reject("termination evidence terminal task facts do not match the graph")
  }
  if (exactTaskIdSetKey(evidence.blockedTaskIds) !== exactTaskIdSetKey([...graphFacts.blockedTaskIds])) {
    reject("termination evidence dependency blockage facts do not match the graph")
  }
}

const terminationDispositionIsValid = (
  termination: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>,
  graphOutcome: "AllTasksSucceeded" | "Blocked" | "Unsettled",
  cancellationApplied: boolean
): boolean => {
  const expectedDisposition = cancellationApplied
    ? graphOutcome === "AllTasksSucceeded"
      ? "Completed"
      : "Cancelled"
    : graphOutcome === "AllTasksSucceeded"
      ? "Completed"
      : graphOutcome === "Blocked"
        ? "Blocked"
        : undefined
  return expectedDisposition !== undefined && termination.disposition === expectedDisposition
}

const validateTerminationDisposition = (
  termination: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>,
  graphOutcome: "AllTasksSucceeded" | "Blocked" | "Unsettled",
  cancellationApplied: boolean,
  reject: (detail: string) => void
): void => {
  if (!terminationDispositionIsValid(termination, graphOutcome, cancellationApplied)) {
    reject("termination disposition does not follow graph evidence and cancellation precedence")
  }
}

const validateLatestTerminationObservation = (
  records: JournalHistorySource,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  terminatedAt: JournalPosition,
  reject: (detail: string) => void
): void => {
  if (hasLaterCompleteObservation(records, evidence, terminatedAt)) {
    reject("termination evidence must use the latest complete graph observation")
  }
}

const validateCancellationTerminationObservation = (
  records: JournalHistorySource,
  termination: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>,
  reject: (detail: string) => void
): void => {
  const cancellation = lastJournalRecordOfKind(records, "RunCancellationApplied")
  if (cancellation !== undefined && termination.evidence.observedAt <= cancellation.position) {
    reject("cancellation terminal evidence must use a graph observation after RunCancellationApplied")
  }
}

type WorkflowRunBeganRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunBegan" }>
}

const isWorkflowRunBeganRecord = (record: JournalRecord | undefined): record is WorkflowRunBeganRecord =>
  record?.event._tag === "WorkflowRunBegan"

const terminationBeginningOf = (
  runId: RunId,
  began: JournalRecord | undefined,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): WorkflowRunBeganRecord | undefined => {
  if (evidence.runId !== runId) reject("termination evidence must name the journal Run")
  if (!isWorkflowRunBeganRecord(began)) {
    reject("termination evidence requires the exact WorkflowRunBegan target")
    return undefined
  }
  if (taskTrackerTargetKey(evidence.target) !== taskTrackerTargetKey(began.event.target)) {
    reject("termination evidence must name the beginning target")
  }
  return began
}

const validateTerminationCompleteness = (
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): void => {
  if (!evidence.complete || evidence.rootTaskId.length === 0) {
    reject("termination evidence must prove complete root coverage")
  }
}

const isCompleteGraphObservationForTarget = (
  record: JournalRecord,
  target: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"]["target"]
): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  record.event.observation._tag === "CompleteTaskTrackerFacts" &&
  taskTrackerTargetKey(record.event.observation.target) === taskTrackerTargetKey(target)

const firstTrackerRootOf = (
  records: JournalHistorySource,
  target: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"]["target"]
): TaskId | undefined => {
  const firstRootObservation = Option.getOrUndefined(
    Iterable.findFirst(journalRecordsOfKind(records, "TaskTrackerFactsObserved"), (record) =>
      isCompleteGraphObservationForTarget(record, target)
    )
  )
  return firstRootObservation?.event._tag === "TaskTrackerFactsObserved" &&
    firstRootObservation.event.observation._tag === "CompleteTaskTrackerFacts"
    ? firstRootObservation.event.observation.rootTaskId
    : undefined
}

const validateFirstTrackerRoot = (
  records: JournalHistorySource,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): void => {
  if (firstTrackerRootOf(records, evidence.target) !== evidence.rootTaskId) {
    reject("termination evidence must retain the first tracker-selected Run root")
  }
}

const validateTerminationEvidence = (
  runId: RunId,
  records: JournalHistorySource,
  began: JournalRecord | undefined,
  terminatedAt: JournalPosition,
  termination: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>,
  cancellationApplied: boolean,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  const evidence = termination.evidence
  const reject = (detail: string) => semanticIssue(issues, runId, terminatedAt, detail)
  if (terminationBeginningOf(runId, began, evidence, reject) === undefined) return
  validateTerminationCompleteness(evidence, reject)
  validateCancellationTerminationObservation(records, termination, reject)
  const observations = terminationObservationsFor(records, evidence, terminatedAt, reject)
  if (observations === undefined) return
  validateFirstTrackerRoot(records, evidence, reject)
  validateTerminationIntent(records, evidence, reject)
  validateTerminationFreshObservation(observations.fresh, evidence, reject)
  const { identities, lifecycles, prerequisites } = validateTerminationFactFamilies(
    observations.complete,
    evidence,
    reject
  )
  const graphFacts = terminationGraphFactsFor(lifecycles, prerequisites)
  validateTerminationGraphFacts(evidence, identities, graphFacts, reject)
  validateTerminationDisposition(termination, graphFacts.graphOutcome, cancellationApplied, reject)
  validateLatestTerminationObservation(records, evidence, terminatedAt, reject)
}

/**
 * Validates all decoded records before reconstruction or any outside call.
 * The fold retains every issue it can establish from the immutable history.
 */
const validateRecord = (
  record: JournalRecord,
  index: number,
  runId: RunId,
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): FoldIndexes => {
  validationStepObserver?.()
  const envelope = validateRecordEnvelope(record, index, runId, indexes, issues)
  let next = envelope.indexes
  const descriptor = describeJournalEvent(record.event)
  next = validateControlDirection(record, runId, next, issues)
  next = validateAttemptChoice(record, runId, records, next, issues)
  next = validateAttemptStop(record, runId, records, next, issues)
  validateCancelledAttemptHistory(record, runId, records, (detail) =>
    semanticIssue(issues, runId, record.position, detail)
  )
  validateTaskClaimReacquisitionDirection(record, runId, issues)
  if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor" && descriptor.correlation.runId !== runId) {
    identityIssue(
      issues,
      runId,
      record.position,
      `executor work for attempt ${descriptor.correlation.attemptId} binds run ${descriptor.correlation.runId}`
    )
  }
  if (!envelope.unique) {
    if (record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
      next = validateExecutorEvent(record, runId, records, next, issues)
    }
    return next
  }
  next = validateOperationEvent(record, runId, next, issues)
  validateAttemptRestartAuthorityReadFailure(record, runId, records, issues)
  next = validatePlannedAttemptReplacement(record, runId, records, next, issues)
  validateContinuationAuthorization(record, runId, records, issues)
  const recordsThroughCurrent = isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, index + currentRecordExclusivePositionOffset)
    : records.slice(0, index + 1)
  next = validatePlan(record, runId, recordsThroughCurrent, next, issues)
  validateClaimReacquisitionIntent(record, runId, records, issues)
  validateClaim(record, runId, records, issues)
  validateClaimRejection(record, runId, records, issues)
  validateTaskClaimRelease(record, records, (detail) => identityIssue(issues, runId, record.position, detail))
  validateTrackerObservation(record, runId, records, issues)
  next = validateReconfirmationReference(record, runId, next, issues)
  next = validateExecutorEvent(record, runId, records, next, issues)
  next = validateIntegrationHistoryRecord(
    record,
    runId,
    next,
    (detail) => identityIssue(issues, runId, record.position, detail),
    (detail) => semanticIssue(issues, runId, record.position, detail),
    recordsThroughCurrent
  )
  next = {
    ...next,
    integrationFinalityHistory: validateIntegrationFinalityHistoryRecord(
      record,
      runId,
      records,
      next.integrationFinalityHistory,
      (detail) => identityIssue(issues, runId, record.position, detail),
      (detail) => semanticIssue(issues, runId, record.position, detail)
    )
  }
  const policyValidation = validateRunPolicyHistory(record, next)
  next = { ...next, latestRunPolicyRevision: policyValidation.latestRunPolicyRevision }
  for (const detail of policyValidation.details) {
    semanticIssue(issues, runId, record.position, detail)
  }
  return next
}

const finishValidation = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  collector: WorkflowJournalHistoryIssueCollector,
  evidence?: JournalRecordEvidence
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  validateOneUnfinishedAttemptPerTask(runId, indexes, collector.report)
  validateRunLifecycle(runId, evidence ?? records, collector.report)
  if (!collector.isEmpty()) {
    if (evidence !== undefined) return reduceRawDiagnosticHistory(runId, records)
    const invalid: InvalidWorkflowJournalHistory = {
      _tag: "InvalidWorkflowJournalHistory",
      issues: collector.toReadonlyArray(),
      records,
      runId
    }
    validationPathByHistory.set(invalid, "RawDiagnostic")
    return invalid
  }
  const prefix =
    evidence === undefined
      ? acceptedJournalPrefixFromValidatedHistory(runId, records)
      : acceptedJournalPrefixFromValidatedEvidence(runId, evidence)
  const state = reconstructValidatedRunState(runId, records, prefix)
  const valid: ValidWorkflowJournalHistory = {
    [ValidatedKernelStateTypeId]: { indexes, unfinished: unfinishedTasksFrom(indexes) },
    _tag: "ValidWorkflowJournalHistory",
    runState: state,
    runId,
    prefix
  }
  validationPathByHistory.set(valid, evidence === undefined ? "RawDiagnostic" : "IndexedCold")
  return valid
}

/** Diagnostic replay preserves the original complete-array ordering for malformed histories. */
const reduceRawDiagnosticHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  const collector = makeWorkflowJournalHistoryIssueCollector<WorkflowJournalHistoryIssue>()
  let indexes = emptyIndexes()
  records.forEach((record, index) => {
    indexes = validateRecord(record, index, runId, records, indexes, collector.report)
  })
  return finishValidation(runId, records, indexes, collector)
}

/** Test-only reference query mode for comparing indexed acceptance and exact ordered issues. */
export const reduceUnindexedWorkflowJournalHistoryForTesting = (runId: RunId, records: ReadonlyArray<JournalRecord>) =>
  reduceRawDiagnosticHistory(runId, [...records])

/** Cold recovery and live append execute the same indexed chronological record kernel. */
export const reduceWorkflowJournalHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  let indexes = emptyIndexes()
  let evidence = emptyJournalEvidence()
  const collector = makeWorkflowJournalHistoryIssueCollector<WorkflowJournalHistoryIssue>()
  for (const [index, record] of records.entries()) {
    // Decoded evidence is indexed only after its envelope is canonical. Raw
    // fallback retains duplicate positions/keys and contradictory Run identity.
    if (
      record.position !== index + 1 ||
      record.runId !== runId ||
      record.key !== describeJournalEvent(record.event).expectedKey ||
      HashSet.has(indexes.seenKeys, record.key)
    )
      return reduceRawDiagnosticHistory(runId, records)
    evidence = appendJournalEvidence(evidence, record)
    indexes = validateRecord(record, index, runId, evidence, indexes, collector.report)
    if (!collector.isEmpty()) return reduceRawDiagnosticHistory(runId, records)
  }
  return finishValidation(runId, records, indexes, collector, evidence)
}

/**
 * Validates and advances one exact successor of an already accepted immutable prefix.
 * Only nominal kernel-produced histories can advance. Persisted input enters the cold reducer explicitly.
 */
export const advanceWorkflowJournalHistory = (
  prior: ValidWorkflowJournalHistory,
  record: JournalRecord
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory | InvalidWorkflowJournalSuccessor => {
  const kernel = Option.getOrElse(Option.fromUndefinedOr(prior[ValidatedKernelStateTypeId]), () =>
    Effect.runSync(
      Effect.die(
        new JournalKernelInvariantDefect({ detail: "validated journal history lacks its private kernel state" })
      )
    )
  )
  const { indexes, unfinished } = kernel
  // Direct callers may deliberately supply nonchronological raw envelopes. Their
  // array-order diagnostics belong to the explicit raw boundary, not live append.
  // Journal publication has already checked the exact next-position envelope.
  if (
    record.position !== prior.prefix.records.length + 1 ||
    record.runId !== prior.runId ||
    record.key !== describeJournalEvent(record.event).expectedKey ||
    HashSet.has(indexes.seenKeys, record.key)
  ) {
    return reduceRawDiagnosticHistory(prior.runId, [...materializeJournalRecords(prior.prefix.records), record])
  }

  /*
   * Fork the immutable index roots for this successor. Effect HashMap and
   * HashSet updates share unchanged HAMT nodes, while the accepted prefix
   * keeps its exact roots for later branches or retries.
   */
  const collector = makeWorkflowJournalHistoryIssueCollector<WorkflowJournalHistoryIssue>()
  const issues = collector.report
  const candidate = appendJournalEvidence(prior.prefix, record)
  const advancedIndexes = validateRecord(record, prior.prefix.records.length, prior.runId, candidate, indexes, issues)
  const advancedUnfinished = advanceUnfinishedTasks(unfinished, advancedIndexes, record)
  if (advancedUnfinished === undefined && record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    const existing = mapGet(unfinished, record.event.plannedAttempt.taskId)
    if (existing !== undefined) {
      issues(
        duplicateUnfinishedTaskAttemptIssue(
          prior.runId,
          existing.plannedAttempt,
          existing.position,
          record.event.plannedAttempt,
          record.position
        )
      )
    }
  }
  validateRunLifecycle(prior.runId, candidate, issues)
  if (!collector.isEmpty()) {
    const rejected: InvalidWorkflowJournalSuccessor = {
      _tag: "InvalidWorkflowJournalHistory",
      issues: collector.toReadonlyArray(),
      prior: prior.prefix,
      record,
      runId: prior.runId
    }
    validationPathByHistory.set(rejected, "IndexedSuccessorRejected")
    return rejected
  }
  if (advancedUnfinished === undefined) {
    return Effect.runSync(
      Effect.die(
        new JournalKernelInvariantDefect({
          detail: "successor changed unfinished responsibility without its acquisition occurrence"
        })
      )
    )
  }
  const prefix = appendValidatedJournalRecord(prior.prefix, record)
  const history = acceptedWorkflowHistory(prefix)
  const advanced = acceptedHistoryResult(prefix, advanceReconstructedRunState(prior.runState, record, history), {
    indexes: advancedIndexes,
    unfinished: advancedUnfinished
  })
  validationPathByHistory.set(advanced, "IndexedSuccessor")
  return advanced
}
