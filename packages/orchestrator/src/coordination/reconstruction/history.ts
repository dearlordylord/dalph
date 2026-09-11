/* eslint-disable functional/immutable-data, max-lines -- The chronological validator owns its local indexes and cross-event invariants. */
import {
  plannedTaskAttemptEquivalence,
  samePlannedAttemptExecutorReport,
  type AttemptId,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import { type JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import { rememberValidatedJournalPrefixSuccessor } from "../../workflow-journal/prefix-lineage.js"
import {
  acceptedJournalPrefixFromValidatedHistory,
  appendValidatedJournalRecord,
  type AcceptedJournalPrefix
} from "../../workflow-journal/accepted-prefix.js"
import { type OperationId } from "../../workflow/identity.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import { HashMap, HashSet, Option } from "effect"
import {
  duplicateUnfinishedTaskAttemptIssue,
  type InvalidWorkflowJournalHistory,
  WorkflowJournalHistoryIdentityIssue,
  type WorkflowJournalHistoryIssue,
  WorkflowJournalHistorySemanticIssue,
  type ValidWorkflowJournalHistory
} from "./history-result.js"
import { advanceReconstructedRunState, reconstructValidatedRunState } from "./reduce.js"
import type { ReconstructedRunState } from "./state.js"
import { runGraphTaskFactsOutcome } from "../frontier/run-finality.js"
import {
  invalidTaskTrackerReconfirmationReference,
  makeTaskTrackerReconfirmationIndex,
  type TaskTrackerReconfirmationIndex
} from "../../workflow/task-tracker-facts/reconfirmation.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { validateRunPolicyHistory } from "./run-policy-history.js"
import type { IntegrationHistoryIndexes } from "./integration-history.js"
import { validateIntegrationHistoryRecord } from "./integration-history-validation.js"
import type { TargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import { validateTaskClaimRelease } from "./claim-release-history.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { ActiveTaskClaim, isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { evaluatePlannedAttemptResumeRedeliveryProof } from "../../workflow/protocols/planned-attempt-continuation/resume-redelivery-authorization.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { defaultPlannedAttemptExecutorSuspensionLimit } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  validateIntegrationFinalityHistoryRecord,
  type IntegrationFinalityHistoryIndexes
} from "../../workflow/protocols/integration-finality/history.js"
import { hasLaterCompleteObservation } from "../../workflow-journal/run-termination-freshness.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { validateCancelledAttemptHistory } from "./cancelled-attempt-history.js"
import { appliedTerminalChoiceFor } from "../../workflow/protocols/attempt-choice/terminal-choice-authority.js"
import { plannedAttemptExecutorLifecycleTransitionError } from "../../workflow/protocols/planned-attempt-executor-work/report-acceptance.js"
import { acceptedFreshAttemptLineage } from "../admission/fresh-attempt-lineage.js"
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

const identityIssue = (
  issues: Array<WorkflowJournalHistoryIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  issues.push(new WorkflowJournalHistoryIdentityIssue({ detail, position, runId }))
}

const semanticIssue = (
  issues: Array<WorkflowJournalHistoryIssue> | Array<WorkflowJournalHistorySemanticIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  issues.push(new WorkflowJournalHistorySemanticIssue({ detail, position, runId }))
}

interface FoldIndexes extends IntegrationHistoryIndexes {
  readonly abandonedExecutorAttempts: HashSet.HashSet<AttemptId>
  readonly integrationFinalityHistory: IntegrationFinalityHistoryIndexes
  readonly attemptChoiceSubjects: HashSet.HashSet<string>
  readonly latestControlDirectionOrdinal: number
  readonly executorCommandOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorCommandCountsSinceSafeSuspension: HashMap.HashMap<string, number>
  readonly executorCommandProjectionOrdinals: HashMap.HashMap<string, number>
  readonly executorReportOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorStateObservationOrdinals: HashMap.HashMap<AttemptId, number>
  readonly executorResponsibilitiesBegan: HashMap.HashMap<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly plans: HashMap.HashMap<AttemptId, PlannedTaskAttempt>
  readonly gitReadIntents: HashMap.HashMap<
    OperationId,
    Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" | "ReadTaskWorktree" }>
  >
  readonly latestRunPolicyRevision: number | undefined
  readonly seenEventKindsByOperation: HashMap.HashMap<OperationId, HashSet.HashSet<WorkflowJournalEvent["_tag"]>>
  readonly seenKeys: HashSet.HashSet<JournalRecordKey>
  readonly seenOperationIds: HashSet.HashSet<OperationId>
  readonly terminalExecutorAttempts: HashSet.HashSet<AttemptId>
  readonly supersededExecutorAttempts: HashSet.HashSet<AttemptId>
  readonly unsettledExecutorCommands: HashMap.HashMap<AttemptId, number>
  readonly trackerReconfirmations: TaskTrackerReconfirmationIndex
}

const emptyTargetPromotionHistoryIndexes = (): TargetPromotionHistoryIndexes => ({
  attempts: HashMap.empty(),
  deferrals: HashMap.empty(),
  intents: HashMap.empty(),
  terminals: HashSet.empty()
})

const emptyIntegrationFinalityHistoryIndexes = (): IntegrationFinalityHistoryIndexes => ({
  deletionAttempts: HashMap.empty(),
  deletionIntents: HashMap.empty(),
  deletionTerminals: HashSet.empty(),
  replacementAttempts: HashMap.empty(),
  replacementIntents: HashMap.empty(),
  replacementTerminals: HashMap.empty(),
  settlements: HashSet.empty()
})

const emptyIndexes = (): FoldIndexes => ({
  acceptedExecutorResults: HashMap.empty(),
  abandonedExecutorAttempts: HashSet.empty(),
  attemptChoiceSubjects: HashSet.empty(),
  executorCommandOrdinals: HashMap.empty(),
  executorCommandCountsSinceSafeSuspension: HashMap.empty(),
  executorCommandProjectionOrdinals: HashMap.empty(),
  executorReportOrdinals: HashMap.empty(),
  executorStateObservationOrdinals: HashMap.empty(),
  executorResponsibilitiesBegan: HashMap.empty(),
  integrationResponsibilitiesBegan: HashMap.empty(),
  integrationStarted: HashMap.empty(),
  targetLineageReadIntents: HashMap.empty(),
  targetLineageObservations: HashMap.empty(),
  integratorSessionFixed: HashMap.empty(),
  integratorSessionsByStartedAt: HashMap.empty(),
  integratorSessionsBySessionId: HashMap.empty(),
  integratorSessionsByCandidateResource: HashMap.empty(),
  integratorSuccessorSessionFixed: HashMap.empty(),
  integratorSuccessorSessionsByPredecessor: HashMap.empty(),
  integratorRunStarted: HashMap.empty(),
  integratorRunResults: HashMap.empty(),
  integratorRunCandidateGitReadIntents: HashMap.empty(),
  integratorRunCandidateGitObservations: HashMap.empty(),
  targetPromotionHistory: emptyTargetPromotionHistoryIndexes(),
  integrationFinalityHistory: emptyIntegrationFinalityHistoryIndexes(),
  latestControlDirectionOrdinal: 0,
  plans: HashMap.empty(),
  gitReadIntents: HashMap.empty(),
  latestRunPolicyRevision: undefined,
  seenEventKindsByOperation: HashMap.empty(),
  seenKeys: HashSet.empty(),
  seenOperationIds: HashSet.empty(),
  terminalExecutorAttempts: HashSet.empty(),
  supersededExecutorAttempts: HashSet.empty(),
  unsettledExecutorCommands: HashMap.empty(),
  trackerReconfirmations: makeTaskTrackerReconfirmationIndex()
})

const foldIndexesByHistory = new WeakMap<ValidWorkflowJournalHistory, FoldIndexes>()
type WorkflowJournalHistoryReduction = ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory

/**
 * Process-local reduction results keyed by the exact immutable record-array
 * object. A restart receives freshly decoded records and therefore cannot use
 * this cache; durable journal records remain the only recovery authority.
 */
const reductionsByPrefix = new WeakMap<ReadonlyArray<JournalRecord>, Map<RunId, WorkflowJournalHistoryReduction>>()

const cachedReductionFor = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): WorkflowJournalHistoryReduction | undefined => reductionsByPrefix.get(records)?.get(runId)

const rememberReduction = (reduction: WorkflowJournalHistoryReduction): WorkflowJournalHistoryReduction => {
  const byRun = reductionsByPrefix.get(reduction.records) ?? new Map<RunId, WorkflowJournalHistoryReduction>()
  byRun.set(reduction.runId, reduction)
  reductionsByPrefix.set(reduction.records, byRun)
  return reduction
}

const mapGet = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

const validateRecordEnvelope = (
  record: JournalRecord,
  index: number,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
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
  issues: Array<WorkflowJournalHistoryIssue>
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
  issues: Array<WorkflowJournalHistoryIssue>
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
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "TaskClaimAcquired") return
  const acquired = record.event.claim
  const intent = records.find(
    ({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.operationId === acquired.operationId
  )?.event
  const intended = intent?._tag === "TaskClaimAcquisitionIntended" ? intent.operation.acquisition : undefined
  if (intended === undefined || !acquiredClaimMatchesIntent(acquired, intended)) {
    identityIssue(issues, runId, record.position, `acquired task claim contradicts operation ${acquired.operationId}`)
  }
}

const validateClaimRejection = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "TaskClaimAcquisitionRejected") return
  const rejected = record.event
  const intent = records.find(
    ({ event, position }) =>
      position < record.position &&
      event._tag === "TaskClaimAcquisitionIntended" &&
      event.operation.acquisition.operationId === rejected.operationId
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

const matchingReacquisitionDirection = (record: JournalRecord, runId: RunId, records: ReadonlyArray<JournalRecord>) => {
  /* v8 ignore next -- @preserve The caller invokes this helper only for an explicit acquisition intent. */
  if (record.event._tag !== "TaskClaimAcquisitionIntended") return undefined
  const { acquisition } = record.event.operation
  const expectedClaim = records.findLast(
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
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
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
  records: ReadonlyArray<JournalRecord>,
  observedEvent: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>,
  observedAt: JournalPosition
) =>
  records.find(
    ({ event, position }) =>
      position < observedAt &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation.operationId === observedEvent.operationId
  )?.event

const validateReconfirmationReference = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const validation = invalidTaskTrackerReconfirmationReference(record, runId, indexes.trackerReconfirmations)
  if (validation.detail !== undefined) semanticIssue(issues, runId, record.position, validation.detail)
  return { ...indexes, trackerReconfirmations: validation.index }
}

const validateTrackerObservation = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
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

type ExecutorCommandIntentEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "PlannedAttemptExecutorCommandIntended" }
>

const validateExecutorCommandIdentityAndOrdinal = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const attemptId = event.plannedAttempt.attemptId
  const responsibility = mapGet(indexes.executorResponsibilitiesBegan, attemptId)
  if (
    responsibility === undefined ||
    !plannedTaskAttemptEquivalence(responsibility.plannedAttempt, event.plannedAttempt)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor command for attempt ${attemptId} has no prior matching executor-work responsibility`
    )
  }
  const expectedOrdinal = (mapGet(indexes.executorCommandOrdinals, attemptId) ?? 0) + 1
  if (event.ordinal !== expectedOrdinal) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor command for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.ordinal}`
    )
  }
  return { ...indexes, executorCommandOrdinals: HashMap.set(indexes.executorCommandOrdinals, attemptId, event.ordinal) }
}

const recordExecutorCommandCount = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const attemptId = event.plannedAttempt.attemptId
  const commandCountKey = `${attemptId}:${event.command}`
  const commandCount = (mapGet(indexes.executorCommandCountsSinceSafeSuspension, commandCountKey) ?? 0) + 1
  if (event.command === "Suspend" && commandCount > defaultPlannedAttemptExecutorSuspensionLimit) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor ${event.command} command for attempt ${attemptId} exceeds durable limit ${defaultPlannedAttemptExecutorSuspensionLimit}`
    )
  }
  return {
    ...indexes,
    executorCommandCountsSinceSafeSuspension: HashMap.set(
      indexes.executorCommandCountsSinceSafeSuspension,
      commandCountKey,
      commandCount
    )
  }
}

const priorExecutorCommands = (
  records: ReadonlyArray<JournalRecord>,
  event: ExecutorCommandIntentEvent,
  before: JournalPosition
) =>
  records.filter(
    (candidate) =>
      candidate.position < before &&
      candidate.event._tag === "PlannedAttemptExecutorCommandIntended" &&
      candidate.event.plannedAttempt.attemptId === event.plannedAttempt.attemptId
  )

const validateExecutorBeginUniqueness = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  priorCommands: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (event.command !== "Begin") return
  const began = priorCommands.some(
    (candidate) =>
      candidate.event._tag === "PlannedAttemptExecutorCommandIntended" && candidate.event.command === "Begin"
  )
  if (began) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor begin for attempt ${event.plannedAttempt.attemptId} follows a prior begin intent`
    )
  }
}

const validateExecutorResumeAuthority = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (event.command !== "Resume") return
  const attemptId = event.plannedAttempt.attemptId
  const priorTerminalChoice = appliedTerminalChoiceFor(
    records.filter(({ position }) => position < record.position),
    event.plannedAttempt
  )
  if (priorTerminalChoice !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor resume for attempt ${attemptId} follows terminal choice ${priorTerminalChoice.event.requestId.nonce}`
    )
  }
  const priorRecords = records.filter(({ position }) => position < record.position)
  if (currentUnconsumedAcceptedSafeEvidence(priorRecords, event.plannedAttempt) === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor resume for attempt ${attemptId} lacks an unconsumed accepted safe suspension`
    )
  }
}

const validateExecutorSuspendAuthority = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (event.command !== "Suspend") return
  const priorRecords = records.filter(({ position }) => position < record.position)
  const latestEvidence = latestPlannedAttemptExecutorEvidence(priorRecords, event.plannedAttempt)
  if (latestEvidence?.source._tag === "AcceptedReport" && latestEvidence.report._tag === "ExecutorWorkExecuting") {
    return
  }
  semanticIssue(
    issues,
    runId,
    record.position,
    `executor Suspend for attempt ${event.plannedAttempt.attemptId} lacks latest accepted executing-work authority`
  )
}

const recordUnsettledExecutorCommand = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const attemptId = event.plannedAttempt.attemptId
  if (HashMap.has(indexes.unsettledExecutorCommands, attemptId)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor command for attempt ${attemptId} follows an unmatched prior command intent`
    )
  }
  if (HashSet.has(indexes.terminalExecutorAttempts, attemptId)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor command follows the terminal result for attempt ${attemptId}`
    )
  }
  return {
    ...indexes,
    unsettledExecutorCommands: HashMap.set(indexes.unsettledExecutorCommands, attemptId, event.ordinal)
  }
}

const validateExecutorCommandIntent = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "PlannedAttemptExecutorCommandIntended") return indexes
  const event = record.event
  const priorCommands = priorExecutorCommands(records, event, record.position)
  const withIdentity = validateExecutorCommandIdentityAndOrdinal(event, record, runId, indexes, issues)
  const withCount = recordExecutorCommandCount(event, record, runId, withIdentity, issues)
  validateExecutorBeginUniqueness(event, record, runId, priorCommands, issues)
  validateExecutorResumeAuthority(event, record, runId, records, issues)
  validateExecutorSuspendAuthority(event, record, runId, records, issues)
  return recordUnsettledExecutorCommand(event, record, runId, withCount, issues)
}

const validateExecutorResumeRedeliveryIntent = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const event = record.event
  if (event._tag !== "PlannedAttemptExecutorResumeRedeliveryIntended") return indexes
  const prior = records.filter(({ position }) => position < record.position)
  const proof = evaluatePlannedAttemptResumeRedeliveryProof(
    prior,
    event.plannedAttempt,
    {
      _tag: "ReconciledResumeStillSafe",
      observedAt: event.authorization.safeProjectionObservedAt,
      projectionOrdinal: event.projectionOrdinal,
      resumeCommandOrdinal: event.commandOrdinal
    },
    event.authorization.witness
  )
  if (proof._tag === "Rejected") {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor Resume redelivery lacks exact authorization: ${proof.detail}`
    )
  }
  const expectedOrdinal =
    prior.filter(
      ({ event: candidate }) =>
        candidate._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" &&
        plannedTaskAttemptEquivalence(candidate.plannedAttempt, event.plannedAttempt) &&
        candidate.commandOrdinal === event.commandOrdinal
    ).length + 1
  if (event.redeliveryOrdinal !== expectedOrdinal) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor Resume redelivery expected ordinal ${expectedOrdinal}, found ${event.redeliveryOrdinal}`
    )
  }
  return {
    ...indexes,
    unsettledExecutorCommands: HashMap.set(
      indexes.unsettledExecutorCommands,
      event.plannedAttempt.attemptId,
      event.commandOrdinal
    )
  }
}

type ExecutorStateObservedEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "PlannedAttemptExecutorStateObserved" }
>
type ExecutorLifecycleTransitionObservation = Extract<
  ExecutorStateObservedEvent["observation"],
  { readonly _tag: "ExecutorLifecycleTransitionContradiction" }
>

const executorReportMatchesAttempt = (
  report: ExecutorLifecycleTransitionObservation["accepted"],
  event: ExecutorStateObservedEvent
): boolean =>
  report.correlation.runId === event.plannedAttempt.runId &&
  report.correlation.attemptId === event.plannedAttempt.attemptId

const isRecognizedExecutorLifecycleContradiction = (observation: ExecutorLifecycleTransitionObservation): boolean =>
  !samePlannedAttemptExecutorReport(observation.accepted, observation.observed) &&
  (observation.accepted._tag === "ExecutorWorkTerminal" ||
    (observation.accepted._tag === "ExecutorWorkExecuting" &&
      observation.observed._tag === "ExecutorWorkSafelySuspended") ||
    (observation.accepted._tag === "ExecutorWorkSafelySuspended" &&
      observation.observed._tag === "ExecutorWorkExecuting"))

const validateExecutorLifecycleContradictionCorrelations = (
  observation: ExecutorLifecycleTransitionObservation,
  event: ExecutorStateObservedEvent,
  record: JournalRecord,
  runId: RunId,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (
    executorReportMatchesAttempt(observation.accepted, event) &&
    executorReportMatchesAttempt(observation.observed, event)
  ) {
    return
  }
  identityIssue(
    issues,
    runId,
    record.position,
    `executor lifecycle transition contradiction for attempt ${event.plannedAttempt.attemptId} contains a contradictory correlation`
  )
}

const validateExecutorLifecycleContradictionLatestAccepted = (
  observation: ExecutorLifecycleTransitionObservation,
  event: ExecutorStateObservedEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const latestAccepted = records.findLast(
    (candidate) =>
      candidate.position < record.position &&
      candidate.event._tag === "PlannedAttemptExecutorWorkReported" &&
      candidate.event.report.correlation.runId === event.plannedAttempt.runId &&
      candidate.event.report.correlation.attemptId === event.plannedAttempt.attemptId
  )?.event
  if (
    latestAccepted?._tag === "PlannedAttemptExecutorWorkReported" &&
    samePlannedAttemptExecutorReport(latestAccepted.report, observation.accepted)
  ) {
    return
  }
  semanticIssue(
    issues,
    runId,
    record.position,
    `executor lifecycle transition contradiction for attempt ${event.plannedAttempt.attemptId} does not name its latest accepted report`
  )
}

const validateExecutorLifecycleContradictionShape = (
  observation: ExecutorLifecycleTransitionObservation,
  event: ExecutorStateObservedEvent,
  record: JournalRecord,
  runId: RunId,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (isRecognizedExecutorLifecycleContradiction(observation)) return
  semanticIssue(
    issues,
    runId,
    record.position,
    `executor lifecycle transition contradiction for attempt ${event.plannedAttempt.attemptId} does not contain a contradictory lifecycle transition`
  )
}

const validateExecutorLifecycleTransitionContradiction = (
  event: ExecutorStateObservedEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (event.observation._tag !== "ExecutorLifecycleTransitionContradiction") return
  const observation = event.observation
  validateExecutorLifecycleContradictionCorrelations(observation, event, record, runId, issues)
  validateExecutorLifecycleContradictionLatestAccepted(observation, event, record, runId, records, issues)
  validateExecutorLifecycleContradictionShape(observation, event, record, runId, issues)
}

const validateExecutorInitialReportCausalityContradiction = (
  event: ExecutorStateObservedEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (event.observation._tag !== "ExecutorInitialReportCausalityContradiction") return
  const observation = event.observation
  if (!executorReportMatchesAttempt(observation.observed, event)) {
    identityIssue(
      issues,
      runId,
      record.position,
      `executor initial-report causality contradiction for attempt ${event.plannedAttempt.attemptId} contains a contradictory correlation`
    )
    return
  }
  const priorRecords = records.filter(({ position }) => position < record.position)
  if (
    plannedAttemptExecutorLifecycleTransitionError(priorRecords, event.plannedAttempt, observation.observed)?._tag ===
    "PlannedAttemptExecutorInitialReportCausalityContradiction"
  ) {
    return
  }
  semanticIssue(
    issues,
    runId,
    record.position,
    `executor initial-report causality contradiction for attempt ${event.plannedAttempt.attemptId} does not describe a missing exact Begin settlement`
  )
}

const validateExactExecutorStateObservation = (
  event: ExecutorStateObservedEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (event.observation._tag !== "ExactExecutorReport") return
  const priorRecords = records.filter(({ position }) => position < record.position)
  const contradiction = plannedAttemptExecutorLifecycleTransitionError(
    priorRecords,
    event.plannedAttempt,
    event.observation.report
  )
  if (contradiction === undefined) return
  semanticIssue(
    issues,
    runId,
    record.position,
    `exact executor state observation for attempt ${event.plannedAttempt.attemptId} violates ${contradiction._tag}`
  )
}

type ExecutorWorkReportedEvent = Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptExecutorWorkReported" }>

const latestUnacceptedExecutorEvidenceFor = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord,
  priorAcceptedPosition: JournalPosition | undefined,
  attemptId: AttemptId
): JournalRecord | undefined =>
  records.findLast((candidate) => {
    if (
      candidate.position >= record.position ||
      (priorAcceptedPosition !== undefined && candidate.position <= priorAcceptedPosition)
    ) {
      return false
    }
    const event = candidate.event
    return (
      (event._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
        event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
        event._tag === "PlannedAttemptExecutorStateObserved") &&
      event.plannedAttempt.attemptId === attemptId
    )
  })

const executorReportFromEvidenceRecord = (record: JournalRecord | undefined) => {
  if (record === undefined) return undefined
  const event = record.event
  if (event._tag === "PlannedAttemptExecutorCommandResponseObserved") return event.report
  if (event._tag === "PlannedAttemptExecutorCommandProjectionObserved") {
    return event.observation._tag === "ExactExecutorReport" ? event.observation.report : undefined
  }
  if (event._tag === "PlannedAttemptExecutorStateObserved") {
    return event.observation._tag === "ExactExecutorReport" ? event.observation.report : undefined
  }
  return undefined
}

const validateExecutorWorkReportIdentityAndOrdinal = (
  event: ExecutorWorkReportedEvent,
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const attemptId = event.report.correlation.attemptId
  const responsibility = mapGet(indexes.executorResponsibilitiesBegan, attemptId)
  if (responsibility === undefined || event.report.correlation.runId !== responsibility.plannedAttempt.runId) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report for attempt ${attemptId} has no prior matching executor-work responsibility`
    )
  }
  const expectedOrdinal = (mapGet(indexes.executorReportOrdinals, attemptId) ?? 0) + 1
  if (event.ordinal !== expectedOrdinal) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.ordinal}`
    )
  }
  return { ...indexes, executorReportOrdinals: HashMap.set(indexes.executorReportOrdinals, attemptId, event.ordinal) }
}

const validateExecutorWorkReportEvidence = (
  event: ExecutorWorkReportedEvent,
  record: JournalRecord,
  runId: RunId,
  latestUnacceptedEvidence: JournalRecord | undefined,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const evidenceReport = executorReportFromEvidenceRecord(latestUnacceptedEvidence)
  if (evidenceReport === undefined || !samePlannedAttemptExecutorReport(evidenceReport, event.report)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report for attempt ${event.report.correlation.attemptId} lacks a matching unaccepted command response or observation`
    )
  }
}

const causalExecutorCommandOrdinal = (record: JournalRecord | undefined) => {
  const event = record?.event
  return event?._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
    event?._tag === "PlannedAttemptExecutorCommandProjectionObserved"
    ? event.commandOrdinal
    : undefined
}

const isMatchingCausalResume = (
  candidate: JournalRecord,
  evidencePosition: JournalPosition,
  priorAcceptedPosition: JournalPosition,
  event: ExecutorWorkReportedEvent,
  commandOrdinal: number
): boolean =>
  candidate.position < evidencePosition &&
  candidate.position > priorAcceptedPosition &&
  candidate.event._tag === "PlannedAttemptExecutorCommandIntended" &&
  candidate.event.command === "Resume" &&
  candidate.event.ordinal === commandOrdinal &&
  candidate.event.plannedAttempt.runId === event.report.correlation.runId &&
  candidate.event.plannedAttempt.attemptId === event.report.correlation.attemptId

const isSafeToExecutingTransition = (
  priorAccepted: JournalRecord | undefined,
  event: ExecutorWorkReportedEvent
): priorAccepted is JournalRecord & { readonly event: ExecutorWorkReportedEvent } =>
  priorAccepted?.event._tag === "PlannedAttemptExecutorWorkReported" &&
  priorAccepted.event.report._tag === "ExecutorWorkSafelySuspended" &&
  event.report._tag === "ExecutorWorkExecuting"

const validateSafeToExecutingCausality = (
  event: ExecutorWorkReportedEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  priorAccepted: JournalRecord | undefined,
  latestUnacceptedEvidence: JournalRecord | undefined,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (!isSafeToExecutingTransition(priorAccepted, event)) return
  const commandOrdinal = causalExecutorCommandOrdinal(latestUnacceptedEvidence)
  const evidencePosition = latestUnacceptedEvidence?.position ?? record.position
  const resumeCommand =
    commandOrdinal === undefined
      ? undefined
      : records.findLast((candidate) =>
          isMatchingCausalResume(candidate, evidencePosition, priorAccepted.position, event, commandOrdinal)
        )
  if (resumeCommand === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor lifecycle transition from accepted safe suspension to executing for attempt ${event.report.correlation.attemptId} requires its matching Resume command response or projection`
    )
  }
}

const validateExecutorLifecycleAcceptance = (
  event: ExecutorWorkReportedEvent,
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt | undefined,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (plannedAttempt === undefined) return
  const priorRecords = records.filter(({ position }) => position < record.position)
  const contradiction = plannedAttemptExecutorLifecycleTransitionError(priorRecords, plannedAttempt, event.report)
  if (contradiction === undefined) return
  semanticIssue(
    issues,
    runId,
    record.position,
    `executor lifecycle report for attempt ${event.report.correlation.attemptId} violates ${contradiction._tag}`
  )
}

const validateExecutorReportFinality = (
  event: ExecutorWorkReportedEvent,
  record: JournalRecord,
  runId: RunId,
  priorAccepted: JournalRecord | undefined,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const attemptId = event.report.correlation.attemptId
  if (
    priorAccepted?.event._tag === "PlannedAttemptExecutorWorkReported" &&
    samePlannedAttemptExecutorReport(priorAccepted.event.report, event.report)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report for attempt ${attemptId} repeats an unchanged lifecycle report`
    )
  }
  if (HashSet.has(indexes.terminalExecutorAttempts, attemptId)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report follows the terminal result for attempt ${attemptId}`
    )
  }
}

const recordExecutorWorkReportOutcome = (event: ExecutorWorkReportedEvent, indexes: FoldIndexes): FoldIndexes => {
  const attemptId = event.report.correlation.attemptId
  if (event.report._tag === "ExecutorWorkTerminal") {
    const terminal = { ...indexes, terminalExecutorAttempts: HashSet.add(indexes.terminalExecutorAttempts, attemptId) }
    return event.report.result._tag === "Accepted"
      ? {
          ...terminal,
          acceptedExecutorResults: HashMap.set(
            terminal.acceptedExecutorResults,
            attemptId,
            event.report.result.acceptedResult
          )
        }
      : terminal
  }
  return event.report._tag === "ExecutorWorkSafelySuspended"
    ? {
        ...indexes,
        executorCommandCountsSinceSafeSuspension: HashMap.remove(
          indexes.executorCommandCountsSinceSafeSuspension,
          `${attemptId}:Suspend`
        )
      }
    : indexes
}

const validateExecutorWorkReport = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "PlannedAttemptExecutorWorkReported") return indexes
  const event = record.event
  const attemptId = event.report.correlation.attemptId
  const responsibility = mapGet(indexes.executorResponsibilitiesBegan, attemptId)
  const withOrdinal = validateExecutorWorkReportIdentityAndOrdinal(event, record, runId, indexes, issues)
  const priorAccepted = records.findLast(
    (candidate) =>
      candidate.position < record.position &&
      candidate.event._tag === "PlannedAttemptExecutorWorkReported" &&
      candidate.event.report.correlation.attemptId === attemptId
  )
  const latestUnacceptedEvidence = latestUnacceptedExecutorEvidenceFor(
    records,
    record,
    priorAccepted?.position,
    attemptId
  )
  validateExecutorWorkReportEvidence(event, record, runId, latestUnacceptedEvidence, issues)
  validateExecutorLifecycleAcceptance(event, record, runId, records, responsibility?.plannedAttempt, issues)
  validateSafeToExecutingCausality(event, record, runId, records, priorAccepted, latestUnacceptedEvidence, issues)
  validateExecutorReportFinality(event, record, runId, priorAccepted, withOrdinal, issues)
  return recordExecutorWorkReportOutcome(event, withOrdinal)
}

const validateExecutorEvent = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  let next = indexes
  const event = record.event
  const descriptor = describeJournalEvent(event)
  const executorAttemptId =
    descriptor._tag === "PlannedAttemptExecutorEventDescriptor" ? descriptor.correlation.attemptId : undefined
  if (executorAttemptId !== undefined && HashSet.has(next.abandonedExecutorAttempts, executorAttemptId)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor event ${event._tag} follows abandonment of attempt ${executorAttemptId}`
    )
  }
  if (executorAttemptId !== undefined && HashSet.has(next.supersededExecutorAttempts, executorAttemptId)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor event ${event._tag} follows replacement of attempt ${executorAttemptId}`
    )
  }
  const validateResponsibilityBegan = () => {
    if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
      const attemptId = event.plannedAttempt.attemptId
      const plan = mapGet(next.plans, attemptId)
      if (plan === undefined || !plannedTaskAttemptEquivalence(plan, event.plannedAttempt)) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor work for attempt ${attemptId} has no prior matching planned task attempt`
        )
      }
      const ordinaryPlanWasAccepted = records.some(
        (candidate) =>
          candidate.runId === runId &&
          candidate.position < record.position &&
          candidate.event._tag === "TaskAttemptPlanned" &&
          plannedTaskAttemptEquivalence(candidate.event.operation.plannedAttempt, event.plannedAttempt)
      )
      if (
        ordinaryPlanWasAccepted &&
        acceptedFreshAttemptLineage(
          records.filter((candidate) => candidate.runId === runId && candidate.position <= record.position),
          event.plannedAttempt,
          "WorktreeReady"
        ) === undefined
      ) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor work for attempt ${attemptId} requires its exact accepted worktree-ready lineage`
        )
      }
      const priorResponsibility = mapGet(next.executorResponsibilitiesBegan, attemptId)
      if (priorResponsibility !== undefined) {
        issues.push(
          duplicateUnfinishedTaskAttemptIssue(
            runId,
            priorResponsibility.plannedAttempt,
            priorResponsibility.position,
            event.plannedAttempt,
            record.position
          )
        )
      } else {
        next = {
          ...next,
          executorResponsibilitiesBegan: HashMap.set(next.executorResponsibilitiesBegan, attemptId, {
            plannedAttempt: event.plannedAttempt,
            position: record.position
          })
        }
      }
    }
  }
  const validateCommandProjection = () => {
    if (event._tag === "PlannedAttemptExecutorCommandProjectionObserved") {
      const attemptId = event.plannedAttempt.attemptId
      const responsibility = mapGet(next.executorResponsibilitiesBegan, attemptId)
      const responsibilityMatches = () =>
        responsibility !== undefined &&
        plannedTaskAttemptEquivalence(responsibility.plannedAttempt, event.plannedAttempt)
      if (!responsibilityMatches()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor command projection for attempt ${attemptId} has no prior matching executor-work responsibility`
        )
      }
      if (mapGet(next.unsettledExecutorCommands, attemptId) !== event.commandOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor projection for attempt ${attemptId} does not name its unmatched command intent`
        )
      }
      const projectionKey = `${attemptId}:${event.commandOrdinal}`
      const expectedProjectionOrdinal = () => (mapGet(next.executorCommandProjectionOrdinals, projectionKey) ?? 0) + 1
      const expectedOrdinal = expectedProjectionOrdinal()
      if (event.projectionOrdinal !== expectedOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor projection for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.projectionOrdinal}`
        )
      }
      next = {
        ...next,
        executorCommandProjectionOrdinals: HashMap.set(
          next.executorCommandProjectionOrdinals,
          projectionKey,
          event.projectionOrdinal
        )
      }
      const validateExactObservation = () => {
        if (event.observation._tag !== "ExactExecutorReport") return
        const report = event.observation.report
        const correlationMatches =
          report.correlation.runId === event.plannedAttempt.runId && report.correlation.attemptId === attemptId
        if (!correlationMatches) {
          identityIssue(
            issues,
            runId,
            record.position,
            `executor command projection for attempt ${attemptId} returned a contradictory correlation`
          )
          return
        }
        next = { ...next, unsettledExecutorCommands: HashMap.remove(next.unsettledExecutorCommands, attemptId) }
      }
      const validateContradictoryObservation = () => {
        if (event.observation._tag !== "ExecutorReportContradiction") return
        const correlation = event.observation.observed.correlation
        if (correlation.runId !== event.plannedAttempt.runId || correlation.attemptId !== attemptId) return
        identityIssue(
          issues,
          runId,
          record.position,
          `executor command projection contradiction for attempt ${attemptId} contains the expected correlation`
        )
      }
      const validateBeginNotCrossedObservation = () => {
        if (event.observation._tag !== "ExecutorBeginNotCrossed") return
        const prior = records.filter(({ position }) => position < record.position)
        const intended = latestUnsettledPlannedAttemptExecutorCommand(prior, event.plannedAttempt)
        if (intended?.command === "Begin" && intended.ordinal === event.commandOrdinal) return
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor Begin-not-crossed projection for attempt ${attemptId} requires its exact unsettled Begin intent`
        )
      }
      validateExactObservation()
      validateContradictoryObservation()
      validateBeginNotCrossedObservation()
    }
  }
  const validateCommandResponseContradiction = () => {
    if (event._tag === "PlannedAttemptExecutorCommandResponseContradicted") {
      const attemptId = event.plannedAttempt.attemptId
      const responsibility = mapGet(next.executorResponsibilitiesBegan, attemptId)
      if (
        responsibility === undefined ||
        !plannedTaskAttemptEquivalence(responsibility.plannedAttempt, event.plannedAttempt)
      ) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `contradictory executor response for attempt ${attemptId} has no prior matching executor-work responsibility`
        )
      }
      if (mapGet(next.unsettledExecutorCommands, attemptId) !== event.commandOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `contradictory executor response for attempt ${attemptId} does not name its unmatched command intent`
        )
      }
      if (
        event.observed.correlation.runId === event.plannedAttempt.runId &&
        event.observed.correlation.attemptId === attemptId
      ) {
        identityIssue(
          issues,
          runId,
          record.position,
          `contradictory executor response for attempt ${attemptId} contains the expected correlation`
        )
      }
    }
  }
  const validateCommandResponse = () => {
    if (event._tag !== "PlannedAttemptExecutorCommandResponseObserved") return
    const attemptId = event.plannedAttempt.attemptId
    const responsibility = mapGet(next.executorResponsibilitiesBegan, attemptId)
    if (
      responsibility === undefined ||
      !plannedTaskAttemptEquivalence(responsibility.plannedAttempt, event.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor command response for attempt ${attemptId} has no prior matching executor-work responsibility`
      )
    }
    if (mapGet(next.unsettledExecutorCommands, attemptId) !== event.commandOrdinal) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor command response for attempt ${attemptId} does not name its unmatched command intent`
      )
    }
    if (
      event.report.correlation.runId !== event.plannedAttempt.runId ||
      event.report.correlation.attemptId !== attemptId
    ) {
      identityIssue(issues, runId, record.position, `executor command response for attempt ${attemptId} is foreign`)
      return
    }
    next = { ...next, unsettledExecutorCommands: HashMap.remove(next.unsettledExecutorCommands, attemptId) }
  }
  const validateStateObservation = () => {
    if (event._tag === "PlannedAttemptExecutorStateObserved") {
      const attemptId = event.plannedAttempt.attemptId
      const responsibility = mapGet(next.executorResponsibilitiesBegan, attemptId)
      const responsibilityMatches = () =>
        responsibility !== undefined &&
        plannedTaskAttemptEquivalence(responsibility.plannedAttempt, event.plannedAttempt)
      if (!responsibilityMatches()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor state observation for attempt ${attemptId} has no prior matching executor-work responsibility`
        )
      }
      if (HashMap.has(next.unsettledExecutorCommands, attemptId)) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor state observation for attempt ${attemptId} bypasses its unmatched command intent`
        )
      }
      const expectedStateOrdinal = () => (mapGet(next.executorStateObservationOrdinals, attemptId) ?? 0) + 1
      const expectedOrdinal = expectedStateOrdinal()
      if (event.ordinal !== expectedOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor state observation for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.ordinal}`
        )
      }
      next = {
        ...next,
        executorStateObservationOrdinals: HashMap.set(next.executorStateObservationOrdinals, attemptId, event.ordinal)
      }
      const validateExactObservationCorrelation = () => {
        if (event.observation._tag !== "ExactExecutorReport") return
        const correlation = event.observation.report.correlation
        if (correlation.runId !== event.plannedAttempt.runId || correlation.attemptId !== attemptId) {
          identityIssue(
            issues,
            runId,
            record.position,
            `executor state observation for attempt ${attemptId} returned a contradictory correlation`
          )
        }
      }
      const validateContradictoryObservationCorrelation = () => {
        if (event.observation._tag !== "ExecutorReportContradiction") return
        const correlation = event.observation.observed.correlation
        /* v8 ignore next -- @preserve ExecutorReportContradiction is constructed only after exact-correlation equality has failed. */
        if (correlation.runId === event.plannedAttempt.runId && correlation.attemptId === attemptId) {
          identityIssue(
            issues,
            runId,
            record.position,
            `executor state observation contradiction for attempt ${attemptId} contains the expected correlation`
          )
        }
      }
      validateExactObservationCorrelation()
      validateContradictoryObservationCorrelation()
      validateExactExecutorStateObservation(event, record, runId, records, issues)
      validateExecutorInitialReportCausalityContradiction(event, record, runId, records, issues)
      validateExecutorLifecycleTransitionContradiction(event, record, runId, records, issues)
    }
  }
  validateResponsibilityBegan()
  next = validateExecutorCommandIntent(record, runId, records, next, issues)
  next = validateExecutorResumeRedeliveryIntent(record, runId, records, next, issues)
  validateCommandProjection()
  validateCommandResponse()
  validateCommandResponseContradiction()
  validateStateObservation()
  next = validateExecutorWorkReport(record, runId, records, next, issues)
  return next
}

const validateOneUnfinishedAttemptPerTask = (
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
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
    issues.push(
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
  records: ReadonlyArray<JournalRecord>,
  began: JournalRecord | undefined,
  terminated: JournalRecord | undefined,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (began !== undefined && began.position !== 1) {
    semanticIssue(issues, runId, began.position, "WorkflowRunBegan must be the first record")
  }
  if (terminated !== undefined && began === undefined) {
    semanticIssue(issues, runId, terminated.position, "WorkflowRunTerminated requires prior WorkflowRunBegan")
  }
  if (terminated !== undefined && terminated !== records.at(finalArrayElementOffset)) {
    semanticIssue(issues, runId, terminated.position, "WorkflowRunTerminated must be the final record")
  }
}

const validateCancellationMultiplicity = (
  runId: RunId,
  cancellations: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
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
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<WorkflowJournalHistorySemanticIssue> => {
  const issues = new Array<WorkflowJournalHistorySemanticIssue>()
  validateCancellationMultiplicity(
    runId,
    records.filter(({ event }) => event._tag === "RunCancellationApplied"),
    issues
  )
  return issues
}

const validateCancellationBeginning = (
  runId: RunId,
  began: JournalRecord | undefined,
  cancellations: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const firstInvalid = cancellations.find(({ position }) => began === undefined || position <= began.position)
  if (firstInvalid !== undefined) {
    semanticIssue(issues, runId, firstInvalid.position, "RunCancellationApplied requires prior WorkflowRunBegan")
  }
}

const validateRunLifecycle = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
  const cancellations = records.filter(({ event }) => event._tag === "RunCancellationApplied")
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
  records: ReadonlyArray<JournalRecord>,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  terminatedAt: JournalPosition,
  reject: (detail: string) => void
): { readonly fresh: TerminationTrackerObservation; readonly complete: CompleteTrackerObservation } | undefined => {
  const observed = records.find(({ position }) => position === evidence.observedAt)
  if (!isTerminationTrackerRecord(observed, terminatedAt)) {
    reject("termination evidence must name one earlier complete or unchanged tracker observation position")
    return undefined
  }
  const fresh = observed.event.observation
  const completeObservationRecord =
    fresh._tag === "CompleteTaskTrackerFacts"
      ? observed
      : records.find(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            event.operationId === fresh.priorFullObservationOperationId &&
            event.observation._tag === "CompleteTaskTrackerFacts"
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
  records: ReadonlyArray<JournalRecord>,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): void => {
  const intent = records.find(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === evidence.operationId
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
  records: ReadonlyArray<JournalRecord>,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  terminatedAt: JournalPosition,
  reject: (detail: string) => void
): void => {
  if (hasLaterCompleteObservation(records, evidence, terminatedAt)) {
    reject("termination evidence must use the latest complete graph observation")
  }
}

const validateCancellationTerminationObservation = (
  records: ReadonlyArray<JournalRecord>,
  termination: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>,
  reject: (detail: string) => void
): void => {
  const cancellation = records.findLast(({ event }) => event._tag === "RunCancellationApplied")
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
  records: ReadonlyArray<JournalRecord>,
  target: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"]["target"]
): TaskId | undefined => {
  const firstRootObservation = records.find((record) => isCompleteGraphObservationForTarget(record, target))
  return firstRootObservation?.event._tag === "TaskTrackerFactsObserved" &&
    firstRootObservation.event.observation._tag === "CompleteTaskTrackerFacts"
    ? firstRootObservation.event.observation.rootTaskId
    : undefined
}

const validateFirstTrackerRoot = (
  records: ReadonlyArray<JournalRecord>,
  evidence: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>["evidence"],
  reject: (detail: string) => void
): void => {
  if (firstTrackerRootOf(records, evidence.target) !== evidence.rootTaskId) {
    reject("termination evidence must retain the first tracker-selected Run root")
  }
}

const validateTerminationEvidence = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  began: JournalRecord | undefined,
  terminatedAt: JournalPosition,
  termination: Extract<WorkflowJournalEvent, { readonly _tag: "WorkflowRunTerminated" }>,
  cancellationApplied: boolean,
  issues: Array<WorkflowJournalHistoryIssue>
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
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
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
  next = validatePlan(record, runId, records.slice(0, index + 1), next, issues)
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
    records.slice(0, index + 1)
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
  issues: Array<WorkflowJournalHistoryIssue>,
  reconstructRunState: () => ReconstructedRunState = () => reconstructValidatedRunState(runId, records),
  acceptedPrefix?: () => AcceptedJournalPrefix
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  validateOneUnfinishedAttemptPerTask(runId, indexes, issues)
  validateRunLifecycle(runId, records, issues)
  if (issues.length > 0) {
    return rememberReduction({ _tag: "InvalidWorkflowJournalHistory", issues, records, runId })
  }
  const prefix = acceptedPrefix?.() ?? acceptedJournalPrefixFromValidatedHistory(runId, records)
  const state = reconstructRunState()
  const valid: ValidWorkflowJournalHistory = {
    _tag: "ValidWorkflowJournalHistory",
    runState: { ...state, workflowHistory: { ...state.workflowHistory, prefix } },
    records,
    runId,
    prefix
  }
  foldIndexesByHistory.set(valid, indexes)
  return rememberReduction(valid)
}

export const reduceWorkflowJournalHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  const cached = cachedReductionFor(runId, records)
  if (cached !== undefined) return cached
  const issues = new Array<WorkflowJournalHistoryIssue>()
  let indexes = emptyIndexes()
  records.forEach((record, index) => {
    indexes = validateRecord(record, index, runId, records, indexes, issues)
  })
  return finishValidation(runId, records, indexes, issues)
}

/**
 * Validates and advances one exact successor of an already accepted immutable prefix.
 * Prefixes not produced in this process fall back to the complete restart reducer.
 */
export const advanceWorkflowJournalHistory = (
  prior: ValidWorkflowJournalHistory,
  record: JournalRecord
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  const records = [...prior.records, record]
  const cached = foldIndexesByHistory.get(prior)
  if (cached === undefined) return reduceWorkflowJournalHistory(prior.runId, records)

  /*
   * Fork the immutable index roots for this successor. Effect HashMap and
   * HashSet updates share unchanged HAMT nodes, while the accepted prefix
   * keeps its exact roots for later branches or retries.
   */
  const indexes = cached
  const issues = new Array<WorkflowJournalHistoryIssue>()
  const advancedIndexes = validateRecord(record, prior.records.length, prior.runId, records, indexes, issues)
  const advanced = finishValidation(
    prior.runId,
    records,
    advancedIndexes,
    issues,
    () => advanceReconstructedRunState(prior.runState, record, records),
    () => appendValidatedJournalRecord(prior.prefix, record)
  )
  if (advanced._tag === "ValidWorkflowJournalHistory") {
    rememberValidatedJournalPrefixSuccessor(prior, advanced, record)
    return advanced
  }

  return advanced
}
