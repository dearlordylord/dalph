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
import { plannedAttemptWorktreeObservationMatchesPlan } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import { evaluatePlannedAttemptContinuationAuthorization } from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand,
  plannedAttemptExecutorEvidence
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { defaultPlannedAttemptExecutorSuspensionLimit } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { authorizedClaimForAttempt } from "../../workflow/claim-authority-history.js"
import {
  validateIntegrationFinalityHistoryRecord,
  type IntegrationFinalityHistoryIndexes
} from "../../workflow/protocols/integration-finality/history.js"
import {
  attemptChoiceSubjectKey,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "../../workflow/protocols/attempt-choice/events.js"
import { reconstructedTaskGraphFromEvents } from "./graph-knowledge.js"
import { claimReadMatchesTarget, exactWorkflowRunTargetFor } from "../../workflow-journal/run-target.js"
import { hasLaterCompleteObservation } from "../../workflow-journal/run-termination-freshness.js"
import { recordedTaskAttemptPlanFor } from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { restartAuthorityReadOperationMatches } from "../../workflow/protocols/attempt-choice/replacement-events.js"
import {
  restartChoiceWasInvalidatedByLaterSpecification,
  restartClaimAuthorityAtApplication,
  type RestartApplicationRecord
} from "../../workflow/protocols/attempt-choice/restart-authority.js"
import { validateCancelledAttemptHistory } from "./cancelled-attempt-history.js"
import { appliedTerminalChoiceFor } from "../../workflow/protocols/attempt-choice/terminal-choice-authority.js"
import { plannedAttemptExecutorLifecycleTransitionError } from "../../workflow/protocols/planned-attempt-executor-work/report-acceptance.js"

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

type AttemptChoiceRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>
}

const validateAttemptChoiceAuthority = (
  record: AttemptChoiceRecord,
  runId: RunId,
  prior: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const { subject } = record.event
  const bindsRun = () => record.event.requestId.runId === runId && subject.plannedAttempt.runId === runId
  if (!bindsRun()) {
    identityIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} binds run ${subject.plannedAttempt.runId}`
    )
  }
  if (recordedTaskAttemptPlanFor(prior, subject.plannedAttempt) === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} has no prior matching planned attempt`
    )
  }
  if (currentUnconsumedAcceptedSafeEvidence(prior, subject.plannedAttempt) === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} requires the latest accepted safely-suspended executor report`
    )
  }
  const immutableRunTarget = exactWorkflowRunTargetFor(prior)
  const latestSpecification = prior.findLast(
    ({ event }) =>
      immutableRunTarget !== undefined &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === subject.plannedAttempt.taskId &&
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(immutableRunTarget)
  )?.event
  const specificationMatches = () =>
    latestSpecification?._tag === "TaskTrackerFactsObserved" &&
    latestSpecification.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
    latestSpecification.observation.factFamily.fingerprint === subject.observedTaskRevision
  if (!specificationMatches()) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} does not name the latest observed task fingerprint`
    )
  }
}

/** Rejects a direction that was not exposed by the exact prior plan, changed specification, and safe report. */
const validateAttemptChoice = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "AttemptChoiceApplied") return indexes
  const { subject } = record.event
  const prior = records.filter(({ position }) => position < record.position)
  validateAttemptChoiceAuthority({ ...record, event: record.event }, runId, prior, issues)
  if (
    prior.some(
      ({ event }) =>
        event._tag === "PlannedAttemptReplaced" &&
        plannedTaskAttemptEquivalence(event.subject.plannedAttempt, subject.plannedAttempt)
    )
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the atomic replacement of the same attempt`
    )
  }
  if (
    prior.some(
      ({ event }) =>
        event._tag === "IntegrationStarted" &&
        event.plannedAttempt.runId === subject.plannedAttempt.runId &&
        event.plannedAttempt.attemptId === subject.plannedAttempt.attemptId
    )
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the exact integration-start cutoff`
    )
  }
  const priorStop = prior.find(
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "StopTaskImplementation" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, subject.plannedAttempt)
  )
  if (priorStop !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the terminal Stop direction for the same attempt`
    )
  }
  const priorRestart = prior.find(
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "RestartTaskImplementation" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, subject.plannedAttempt)
  )
  if (record.event.choice === "ContinueExistingAttempt" && priorRestart !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `Continue request ${record.event.requestId.nonce} follows the terminal Restart direction for the same attempt`
    )
  }
  const subjectKey = attemptChoiceSubjectKey(subject)
  if (HashSet.has(indexes.attemptChoiceSubjects, subjectKey)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the winning direction for the same fingerprint pair`
    )
  }
  return { ...indexes, attemptChoiceSubjects: HashSet.add(indexes.attemptChoiceSubjects, subjectKey) }
}

const matchingAppliedStop = (
  prior: ReadonlyArray<JournalRecord>,
  event: Extract<
    WorkflowJournalEvent,
    {
      readonly _tag:
        | "AttemptImplementationAbandoned"
        | "AttemptStoppageIntended"
        | "StoppedAttemptClaimNoReleaseObserved"
    }
  >
) =>
  prior.find(
    (candidate) =>
      candidate.event._tag === "AttemptChoiceApplied" &&
      candidate.event.choice === "StopTaskImplementation" &&
      sameAttemptChoiceRequestId(candidate.event.requestId, event.requestId) &&
      sameAttemptChoiceSubject(candidate.event.subject, event.subject)
  )

const matchingAbandonment = (
  prior: ReadonlyArray<JournalRecord>,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>
) =>
  prior.findLast(
    (candidate): candidate is AbandonmentJournalRecord =>
      candidate.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(candidate.event.requestId, event.requestId) &&
      sameAttemptChoiceSubject(candidate.event.subject, event.subject)
  )

const matchingAppliedStopByRequest = (
  prior: ReadonlyArray<JournalRecord>,
  requestId: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>["requestId"]
) =>
  prior.find(
    (record): record is AttemptChoiceRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "StopTaskImplementation" &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId)
  )

type AbandonmentJournalRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptImplementationAbandoned" }>
}

const matchingAbandonmentForAppliedStop = (
  prior: ReadonlyArray<JournalRecord>,
  appliedStop: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>
) =>
  prior.findLast(
    (record): record is AbandonmentJournalRecord =>
      record.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(record.event.requestId, appliedStop.requestId) &&
      sameAttemptChoiceSubject(record.event.subject, appliedStop.subject)
  )

const latestFocusedClaimObservationAfter = (
  prior: ReadonlyArray<JournalRecord>,
  baselinePosition: JournalPosition,
  taskId: TaskId,
  immutableRunTarget: ReturnType<typeof exactWorkflowRunTargetFor>
) =>
  prior.findLast(
    ({ event, position }) =>
      position > baselinePosition &&
      immutableRunTarget !== undefined &&
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "FocusedTaskClaimFacts" ||
        event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      event.observation.coverage.taskId === taskId &&
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(immutableRunTarget)
  )

const matchingFocusedClaimReadIntentAfter = (
  prior: ReadonlyArray<JournalRecord>,
  baselinePosition: JournalPosition,
  observationOperationId: OperationId,
  observationPosition: JournalPosition,
  taskId: TaskId
) =>
  prior.find(
    ({ event, position }) =>
      position > baselinePosition &&
      position < observationPosition &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.operationId === observationOperationId &&
      event.operation.taskId === taskId
  )?.event

const releaseIntentForOutcome = (
  prior: ReadonlyArray<JournalRecord>,
  released: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleased" }>
) =>
  prior.findLast(
    ({ event }) =>
      event._tag === "TaskClaimReleaseIntended" && event.operation.release.operationId === released.release.operationId
  )

const stoppedReleaseAuthorityForOutcome = (
  prior: ReadonlyArray<JournalRecord>,
  released: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleased" }>
) => {
  const intent = releaseIntentForOutcome(prior, released)?.event
  return intent?._tag === "TaskClaimReleaseIntended" &&
    intent.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"
    ? intent.operation.authority
    : undefined
}

const stoppedReleaseOutcomeMatchesRequest = (
  prior: ReadonlyArray<JournalRecord>,
  released: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleased" }>,
  requestId: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }>["requestId"]
): boolean => {
  const authority = stoppedReleaseAuthorityForOutcome(prior, released)
  return authority !== undefined && sameAttemptChoiceRequestId(authority.requestId, requestId)
}

const proofEvidenceFor = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  proof: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptImplementationAbandoned" }>["proof"]
) =>
  plannedAttemptExecutorEvidence(prior, plannedAttempt).find(
    (evidence) => evidence.source._tag === "AcceptedReport" && evidence.source.ordinal === proof.reportOrdinal
  )

const sameClaimObservation = (
  left: Extract<WorkflowJournalEvent, { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>["observation"],
  right: Extract<WorkflowJournalEvent, { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>["observation"]
): boolean =>
  left._tag === "ActiveTaskClaim" && right._tag === "ActiveTaskClaim"
    ? isExactTaskClaim(left, right)
    : left._tag === "UnclaimedTask" && right._tag === "UnclaimedTask" && left.taskId === right.taskId

/** Validates Stop chronology and every exact executor/claim authority reference. */
const validateAttemptStop = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const event = record.event
  const prior = records.filter(({ position }) => position < record.position)
  const immutableRunTarget = exactWorkflowRunTargetFor(prior)
  const validateStopEventAuthority = () => {
    if (
      event._tag === "AttemptStoppageIntended" ||
      event._tag === "AttemptImplementationAbandoned" ||
      event._tag === "StoppedAttemptClaimNoReleaseObserved"
    ) {
      if (event.requestId.runId !== runId || event.subject.plannedAttempt.runId !== runId) {
        identityIssue(issues, runId, record.position, `attempt Stop request ${event.requestId.nonce} binds another Run`)
      }
      if (matchingAppliedStop(prior, event) === undefined) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt Stop event ${event._tag} requires its exact prior applied Stop choice`
        )
      }
    }
  }
  const validateAbandonment = () => {
    if (event._tag === "AttemptImplementationAbandoned") {
      const evidence = proofEvidenceFor(prior, event.subject.plannedAttempt, event.proof)
      const currentEvidence = latestPlannedAttemptExecutorEvidence(prior, event.subject.plannedAttempt)
      const evidenceProvesQuiescence = () =>
        evidence !== undefined &&
        currentEvidence?.observedAt === evidence.observedAt &&
        evidence.report._tag === "ExecutorWorkSafelySuspended"
      if (!evidenceProvesQuiescence()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt abandonment for ${event.subject.plannedAttempt.attemptId} requires its exact accepted Safe executor proof`
        )
      } else if (latestUnsettledPlannedAttemptExecutorCommand(prior, event.subject.plannedAttempt) !== undefined) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt abandonment for ${event.subject.plannedAttempt.attemptId} follows a later executor command`
        )
      }
      const authorizedClaim = authorizedClaimForAttempt(prior, event.subject.plannedAttempt)?.claim
      const claimMatches = () => authorizedClaim !== undefined && isExactTaskClaim(authorizedClaim, event.expectedClaim)
      if (!claimMatches()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt abandonment for ${event.subject.plannedAttempt.attemptId} requires its exact authorized claim`
        )
      }
    }
  }
  const validateNoRelease = () => {
    if (event._tag === "StoppedAttemptClaimNoReleaseObserved") {
      const abandonment = matchingAbandonment(prior, event)
      const abandonmentMatches = () =>
        abandonment?.event._tag === "AttemptImplementationAbandoned" &&
        isExactTaskClaim(abandonment.event.expectedClaim, event.expectedClaim)
      if (!abandonmentMatches() || abandonment === undefined) {
        semanticIssue(issues, runId, record.position, "stopped-attempt no-release requires its exact prior abandonment")
        return
      }
      const validateNoReleaseObservation = () => {
        const latestReleaseIntent = prior.findLast(
          ({ event: priorEvent, position }) =>
            position > abandonment.position &&
            priorEvent._tag === "TaskClaimReleaseIntended" &&
            priorEvent.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority" &&
            sameAttemptChoiceRequestId(priorEvent.operation.authority.requestId, event.requestId)
        )
        const baselinePosition = latestReleaseIntent?.position ?? abandonment.position
        const observationRecord = latestFocusedClaimObservationAfter(
          prior,
          baselinePosition,
          event.subject.plannedAttempt.taskId,
          immutableRunTarget
        )
        const observation = observationRecord?.event
        const findObservationIntent = () =>
          observationRecord?.event._tag === "TaskTrackerFactsObserved"
            ? matchingFocusedClaimReadIntentAfter(
                prior,
                baselinePosition,
                observationRecord.event.operationId,
                observationRecord.position,
                event.subject.plannedAttempt.taskId
              )
            : undefined
        const observationIntent = findObservationIntent()
        const observationReadMatchesRunTarget =
          observationRecord !== undefined &&
          claimReadMatchesTarget(
            prior,
            event.observationOperationId,
            event.subject.plannedAttempt.taskId,
            baselinePosition,
            observationRecord.position,
            immutableRunTarget
          )
        const observationMatches = () =>
          observation?._tag !== "TaskTrackerFactsObserved" ||
          observation.observation._tag !== "FocusedTaskClaimFacts" ||
          observation.operationId !== event.observationOperationId ||
          observationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
          !observationReadMatchesRunTarget ||
          !sameClaimObservation(observation.observation.observation, event.observation)
        if (observationMatches()) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt no-release requires the latest exact post-baseline claim read"
          )
        }
        const preservesExactClaim = () =>
          event.observation._tag === "ActiveTaskClaim" && isExactTaskClaim(event.observation, event.expectedClaim)
        if (preservesExactClaim()) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt no-release cannot preserve the exact owned claim"
          )
        }
      }
      validateNoReleaseObservation()
      const priorTerminalDisposition = prior.find(
        ({ event: priorEvent, position }) =>
          position > abandonment.position &&
          ((priorEvent._tag === "StoppedAttemptClaimNoReleaseObserved" &&
            sameAttemptChoiceRequestId(priorEvent.requestId, event.requestId) &&
            sameAttemptChoiceSubject(priorEvent.subject, event.subject)) ||
            (priorEvent._tag === "TaskClaimReleased" &&
              stoppedReleaseOutcomeMatchesRequest(prior, priorEvent, event.requestId)))
      )
      if (priorTerminalDisposition !== undefined) {
        semanticIssue(issues, runId, record.position, "stopped-attempt claim disposition is already terminal")
      }
    }
  }
  const validateReleaseIntent = () => {
    if (event._tag === "TaskClaimReleaseIntended") {
      const authority = event.operation.authority
      if (authority._tag === "StoppedAttemptClaimReleaseAuthority") {
        const appliedStop = matchingAppliedStopByRequest(prior, authority.requestId)
        if (appliedStop === undefined) {
          semanticIssue(issues, runId, record.position, "stopped-attempt claim release requires its exact applied Stop")
          return
        }
        const abandonment = matchingAbandonmentForAppliedStop(prior, appliedStop.event)
        if (abandonment === undefined) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt claim release precedes implementation abandonment"
          )
          return
        }
        if (!isExactTaskClaim(event.operation.release.claim, abandonment.event.expectedClaim)) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "stopped-attempt claim release contradicts its authorized claim"
          )
        }
        const validateReleaseUniqueness = () => {
          if (
            prior.some(
              ({ event: priorEvent, position }) =>
                position > abandonment.position &&
                priorEvent._tag === "TaskClaimReleaseIntended" &&
                priorEvent.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority" &&
                sameAttemptChoiceRequestId(priorEvent.operation.authority.requestId, authority.requestId)
            )
          ) {
            semanticIssue(
              issues,
              runId,
              record.position,
              "stopped-attempt claim release already has one durable intent"
            )
          }
          if (
            prior.some(
              ({ event: priorEvent, position }) =>
                position > abandonment.position &&
                ((priorEvent._tag === "StoppedAttemptClaimNoReleaseObserved" &&
                  sameAttemptChoiceRequestId(priorEvent.requestId, authority.requestId)) ||
                  (priorEvent._tag === "TaskClaimReleased" &&
                    stoppedReleaseOutcomeMatchesRequest(prior, priorEvent, authority.requestId)))
            )
          ) {
            semanticIssue(issues, runId, record.position, "stopped-attempt claim disposition is already terminal")
          }
        }
        validateReleaseUniqueness()
        const validateReleaseObservation = () => {
          const observationRecord = latestFocusedClaimObservationAfter(
            prior,
            abandonment.position,
            appliedStop.event.subject.plannedAttempt.taskId,
            immutableRunTarget
          )
          const observation = observationRecord?.event
          const findObservationIntent = () =>
            observationRecord?.event._tag === "TaskTrackerFactsObserved"
              ? claimReadMatchesTarget(
                  prior,
                  authority.observationOperationId,
                  appliedStop.event.subject.plannedAttempt.taskId,
                  abandonment.position,
                  observationRecord.position,
                  immutableRunTarget
                )
                ? matchingFocusedClaimReadIntentAfter(
                    prior,
                    abandonment.position,
                    observationRecord.event.operationId,
                    observationRecord.position,
                    appliedStop.event.subject.plannedAttempt.taskId
                  )
                : undefined
              : undefined
          const observationIntent = findObservationIntent()
          const observationContradicts = () =>
            observation?._tag !== "TaskTrackerFactsObserved" ||
            observation.observation._tag !== "FocusedTaskClaimFacts" ||
            observation.operationId !== authority.observationOperationId ||
            observationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
            observation.observation.observation._tag !== "ActiveTaskClaim" ||
            !isExactTaskClaim(observation.observation.observation, abandonment.event.expectedClaim)
          if (observationContradicts()) {
            semanticIssue(
              issues,
              runId,
              record.position,
              "stopped-attempt claim release requires its latest exact post-abandonment claim read"
            )
          }
        }
        validateReleaseObservation()
      } else {
        const abandonedClaim = prior.findLast(
          ({ event: priorEvent }) =>
            priorEvent._tag === "AttemptImplementationAbandoned" &&
            isExactTaskClaim(priorEvent.expectedClaim, event.operation.release.claim)
        )
        if (abandonedClaim !== undefined) {
          semanticIssue(
            issues,
            runId,
            record.position,
            "an abandoned attempt claim release requires explicit stopped-attempt authority"
          )
        }
      }
    }
  }
  const validateReleaseOutcome = () => {
    if (event._tag === "TaskClaimReleased") {
      const releaseIntent = releaseIntentForOutcome(prior, event)
      const releaseAuthority = () =>
        releaseIntent?.event._tag === "TaskClaimReleaseIntended" ? releaseIntent.event.operation.authority : undefined
      const authority = releaseAuthority()
      if (authority?._tag === "StoppedAttemptClaimReleaseAuthority") {
        const appliedStop = matchingAppliedStopByRequest(prior, authority.requestId)
        const appliedStopEvent = appliedStop?.event
        const findAbandonment = () =>
          appliedStopEvent?._tag === "AttemptChoiceApplied"
            ? matchingAbandonmentForAppliedStop(prior, appliedStopEvent)
            : undefined
        const abandonment = findAbandonment()
        if (abandonment === undefined) {
          semanticIssue(issues, runId, record.position, "stopped-attempt claim release has no exact prior abandonment")
          return
        }
        const priorTerminalDisposition = prior.find(
          ({ event: priorEvent, position }) =>
            position > abandonment.position &&
            ((priorEvent._tag === "StoppedAttemptClaimNoReleaseObserved" &&
              sameAttemptChoiceRequestId(priorEvent.requestId, authority.requestId)) ||
              (priorEvent._tag === "TaskClaimReleased" &&
                stoppedReleaseOutcomeMatchesRequest(prior, priorEvent, authority.requestId)))
        )
        if (priorTerminalDisposition !== undefined) {
          semanticIssue(issues, runId, record.position, "stopped-attempt claim disposition is already terminal")
        }
      }
    }
  }
  validateStopEventAuthority()
  validateAbandonment()
  validateNoRelease()
  validateReleaseIntent()
  validateReleaseOutcome()
  return event._tag === "AttemptImplementationAbandoned"
    ? {
        ...indexes,
        abandonedExecutorAttempts: HashSet.add(
          indexes.abandonedExecutorAttempts,
          event.subject.plannedAttempt.attemptId
        )
      }
    : indexes
}

/**
 * Reuses the canonical Stop/abandonment/claim-disposition validator for a
 * presentation prefix without reconstructing the complete run state. The
 * production reducer remains the owner of these chronology rules; trace
 * readers only need its exact issues before projecting a facet.
 */
export const validateAttemptStopHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<WorkflowJournalHistorySemanticIssue> => {
  const issues = new Array<WorkflowJournalHistorySemanticIssue>()
  let indexes = emptyIndexes()
  for (const record of records) {
    indexes = validateAttemptStop(record, runId, records, indexes, issues)
  }
  return issues
}

const validateOperationEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const next = recordGitReadIntent(record, indexes)
  validateWorktreeObservationIntent(record, runId, indexes, issues)
  validateTargetLineageObservationIntent(record, runId, indexes, issues)
  return validateOperationDescriptor(record, runId, next, issues)
}

/** Validates the generic authorization's causal current-fact witnesses before reconstruction. */
const validateContinuationAuthorization = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "PlannedAttemptContinuationAuthorized") return
  const event = record.event
  if (event.plannedAttempt.runId !== runId) {
    identityIssue(issues, runId, record.position, "continuation authorization binds another Run")
  }
  const prior = records.filter(({ position }) => position < record.position)
  const evaluation = evaluatePlannedAttemptContinuationAuthorization(prior, event.plannedAttempt, event.witness)
  if (evaluation._tag === "Rejected") {
    semanticIssue(issues, runId, record.position, evaluation.detail)
  }
}
const recordGitReadIntent = (record: JournalRecord, indexes: FoldIndexes): FoldIndexes => {
  if (record.event._tag !== "GitReadIntentRecorded") return indexes
  return {
    ...indexes,
    gitReadIntents: HashMap.set(indexes.gitReadIntents, record.event.operation.operationId, record.event.operation)
  }
}

const validateWorktreeObservationIntent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag === "PlannedAttemptWorktreeObserved") {
    const intent = mapGet(indexes.gitReadIntents, record.event.operationId)
    if (
      intent?._tag !== "ReadTaskWorktree" ||
      !plannedAttemptWorktreeObservationMatchesPlan(record.event.observation, intent.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `worktree observation ${record.event.operationId} requires its exact prior worktree-read intent and planned attempt`
      )
    }
  }
}

const validateTargetLineageObservationIntent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag === "TargetLineageObserved") {
    const intent = mapGet(indexes.gitReadIntents, record.event.operationId)
    if (
      intent?._tag !== "ReadTargetLineage" ||
      !plannedTaskAttemptEquivalence(intent.plannedAttempt, record.event.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `target-lineage observation ${record.event.operationId} requires its exact prior target-lineage-read intent and planned attempt`
      )
    }
  }
}

type RestartAuthorityReadFailureEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "AttemptRestartAuthorityReadFailed" }
>

const restartFailureIntentIsExact = (event: RestartAuthorityReadFailureEvent, intent: JournalRecord | undefined) => {
  const operation =
    /* v8 ignore next -- @preserve Restart authority failure validation accepts only the task-tracker or Git intent selected by its failure tag. */
    intent?.event._tag === "TaskTrackerReadIntentRecorded" || intent?.event._tag === "GitReadIntentRecorded"
      ? intent.event.operation
      : undefined
  return operation !== undefined && restartAuthorityReadOperationMatches(operation, event.failure, event.subject)
}

/** Rejects a forged failure that is not the result of this exact applied Restart read. */
const validateAttemptRestartAuthorityReadFailure = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "AttemptRestartAuthorityReadFailed") return
  const event = record.event
  const prior = records.filter(({ position }) => position < record.position)
  const applied = prior.findLast(
    ({ event: candidate }) =>
      candidate._tag === "AttemptChoiceApplied" &&
      candidate.choice === "RestartTaskImplementation" &&
      sameAttemptChoiceRequestId(candidate.requestId, event.requestId) &&
      sameAttemptChoiceSubject(candidate.subject, event.subject)
  )
  if (event.subject.plannedAttempt.runId !== runId || applied === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "Restart authority read failure requires its exact prior applied Restart"
    )
  }
  const intent = prior.findLast(
    ({ event: candidate }) =>
      (candidate._tag === "TaskTrackerReadIntentRecorded" || candidate._tag === "GitReadIntentRecorded") &&
      candidate.operation.operationId === event.operationId
  )
  if (
    applied === undefined ||
    intent === undefined ||
    intent.position <= applied.position ||
    !restartFailureIntentIsExact(event, intent)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `Restart authority read failure ${event.operationId} requires its exact prior task or Git read intent`
    )
  }
}

const validateOperationDescriptor = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag !== "OperationEventDescriptor") return indexes
  validateRequiredOperationIds(record, runId, indexes, issues, descriptor)
  validateRequiredPredecessorKinds(record, runId, indexes, issues, descriptor)
  validateRequiredRecordPredecessor(record, runId, indexes, issues, descriptor)
  const previousKinds = mapGet(indexes.seenEventKindsByOperation, descriptor.operationId) ?? HashSet.empty()
  return {
    ...indexes,
    seenOperationIds: HashSet.add(indexes.seenOperationIds, descriptor.operationId),
    seenEventKindsByOperation: HashMap.set(
      indexes.seenEventKindsByOperation,
      descriptor.operationId,
      HashSet.add(previousKinds, record.event._tag)
    )
  }
}

type OperationEventDescriptor = Extract<
  ReturnType<typeof describeJournalEvent>,
  { readonly _tag: "OperationEventDescriptor" }
>

const validateRequiredOperationIds = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>,
  descriptor: OperationEventDescriptor
): void => {
  for (const requiredOperationId of descriptor.requiredOperationIds) {
    if (!HashSet.has(indexes.seenOperationIds, requiredOperationId)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `event ${record.event._tag} requires prior operation ${requiredOperationId}`
      )
    }
  }
}

const validateRequiredPredecessorKinds = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>,
  descriptor: OperationEventDescriptor
): void => {
  for (const requiredKind of descriptor.requiredPredecessorKinds) {
    const kinds = mapGet(indexes.seenEventKindsByOperation, descriptor.operationId)
    if (kinds === undefined || !HashSet.has(kinds, requiredKind)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `event ${record.event._tag} requires prior ${requiredKind} for operation ${descriptor.operationId}`
      )
    }
  }
}

const validateRequiredRecordPredecessor = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>,
  descriptor: OperationEventDescriptor
): void => {
  if (
    descriptor.recordPredecessor._tag === "RequiredRecordPredecessor" &&
    !HashSet.has(indexes.seenKeys, descriptor.recordPredecessor.key)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `event ${record.event._tag} has no prior record ${descriptor.recordPredecessor.key}`
    )
  }
}

type PlannedAttemptReplacementRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptReplaced" }>
}

type TaskTrackerFactsEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
type ReplacementGraphFacts = Extract<
  TaskTrackerFactsEvent["observation"],
  { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
>
type ReplacementSpecificationFacts = Extract<
  TaskTrackerFactsEvent["observation"],
  { readonly _tag: "FocusedTaskWorkSpecificationFacts" }
>
type ReplacementClaimFacts = Extract<TaskTrackerFactsEvent["observation"], { readonly _tag: "FocusedTaskClaimFacts" }>
type TaskTrackerFactsRecord<Observation extends TaskTrackerFactsEvent["observation"]> = Omit<JournalRecord, "event"> & {
  readonly event: TaskTrackerFactsEvent & { readonly observation: Observation }
}
type ReplacementWorktreeRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptWorktreeObserved" }>
}
type ReplacementTargetRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }>
}
type ReplacementTrackerReadIntent = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }>
}
type ReplacementGitReadIntent = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "GitReadIntentRecorded" }>
}

const freshReplacementTrackerReadIntent = (
  prior: ReadonlyArray<JournalRecord>,
  operationId: OperationId,
  applicationPosition: JournalPosition
): ReplacementTrackerReadIntent | undefined =>
  prior.findLast(
    (record): record is ReplacementTrackerReadIntent =>
      record.position > applicationPosition &&
      record.event._tag === "TaskTrackerReadIntentRecorded" &&
      record.event.operation.operationId === operationId
  )

const freshReplacementGitReadIntent = (
  prior: ReadonlyArray<JournalRecord>,
  operationId: OperationId,
  applicationPosition: JournalPosition
): ReplacementGitReadIntent | undefined =>
  prior.findLast(
    (record): record is ReplacementGitReadIntent =>
      record.position > applicationPosition &&
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation.operationId === operationId
  )

const replacementGraphIntentIsExact = (
  intent: ReplacementTrackerReadIntent | undefined,
  taskId: TaskId,
  trackerTarget: string
): boolean => {
  const operation = intent?.event.operation
  return (
    operation?._tag === "ReadTrackerGraph" &&
    taskTrackerTargetKey(operation.target) === trackerTarget &&
    operation.readShape.explicitlyCoveredTaskIds.includes(taskId)
  )
}

const replacementFocusedIntentIsExact = (
  intent: ReplacementTrackerReadIntent | undefined,
  expectedTag: "ReadTaskClaim" | "ReadTaskWorkSpecification",
  taskId: TaskId,
  trackerTarget: string
): boolean => {
  const operation = intent?.event.operation
  return (
    operation?._tag === expectedTag &&
    taskTrackerTargetKey(operation.target) === trackerTarget &&
    operation.taskId === taskId
  )
}

const replacementGitIntentIsExact = (
  intent: ReplacementGitReadIntent | undefined,
  expectedTag: "ReadTargetLineage" | "ReadTaskWorktree",
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const operation = intent?.event.operation
  return operation?._tag === expectedTag && plannedTaskAttemptEquivalence(operation.plannedAttempt, plannedAttempt)
}

const replacementReadIntentPredecessorsAreExact = (
  graph: ReplacementTrackerReadIntent | undefined,
  specification: ReplacementTrackerReadIntent | undefined,
  claim: ReplacementTrackerReadIntent | undefined,
  worktree: ReplacementGitReadIntent | undefined,
  target: ReplacementGitReadIntent | undefined,
  witness: PlannedAttemptReplacementRecord["event"]["witness"]
): boolean =>
  [
    specification?.event.operation.predecessorOperationIds.includes(witness.graphObservationOperationId) === true,
    claim?.event.operation.predecessorOperationIds.includes(witness.graphObservationOperationId) === true,
    claim?.event.operation.predecessorOperationIds.includes(witness.specificationObservationOperationId) === true,
    worktree?.event.operation.predecessorOperationIds.includes(witness.graphObservationOperationId) === true,
    worktree?.event.operation.predecessorOperationIds.includes(witness.specificationObservationOperationId) === true,
    worktree?.event.operation.predecessorOperationIds.includes(witness.claimObservationOperationId) === true,
    target?.event.operation.predecessorOperationIds.includes(witness.oldWorktreeObservationOperationId) === true,
    graph !== undefined
  ].every(Boolean)

const replacementReadIntentsAreFreshAndExact = (
  prior: ReadonlyArray<JournalRecord>,
  event: PlannedAttemptReplacementRecord["event"],
  applicationPosition: JournalPosition
): boolean => {
  const { plannedAttempt } = event.subject
  const { witness } = event
  const graph = freshReplacementTrackerReadIntent(prior, witness.graphObservationOperationId, applicationPosition)
  const specification = freshReplacementTrackerReadIntent(
    prior,
    witness.specificationObservationOperationId,
    applicationPosition
  )
  const claim = freshReplacementTrackerReadIntent(prior, witness.claimObservationOperationId, applicationPosition)
  const worktree = freshReplacementGitReadIntent(prior, witness.oldWorktreeObservationOperationId, applicationPosition)
  const target = freshReplacementGitReadIntent(prior, witness.targetLineageObservationOperationId, applicationPosition)
  const began = prior.find(({ event: candidate }) => candidate._tag === "WorkflowRunBegan")?.event
  if (began?._tag !== "WorkflowRunBegan") return false
  const trackerTarget = taskTrackerTargetKey(began.target)
  return [
    replacementGraphIntentIsExact(graph, plannedAttempt.taskId, trackerTarget),
    replacementFocusedIntentIsExact(specification, "ReadTaskWorkSpecification", plannedAttempt.taskId, trackerTarget),
    replacementFocusedIntentIsExact(claim, "ReadTaskClaim", plannedAttempt.taskId, trackerTarget),
    replacementGitIntentIsExact(worktree, "ReadTaskWorktree", plannedAttempt),
    replacementGitIntentIsExact(target, "ReadTargetLineage", plannedAttempt),
    replacementReadIntentPredecessorsAreExact(graph, specification, claim, worktree, target, witness)
  ].every(Boolean)
}

const isReplacementGraphFacts = (
  observation: TaskTrackerFactsEvent["observation"]
): observation is ReplacementGraphFacts =>
  observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"

const isReplacementGraphRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is TaskTrackerFactsRecord<ReplacementGraphFacts> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return false
  return record.event.operationId === operationId && isReplacementGraphFacts(record.event.observation)
}

const isReplacementSpecificationRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is TaskTrackerFactsRecord<ReplacementSpecificationFacts> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return false
  return (
    record.event.operationId === operationId && record.event.observation._tag === "FocusedTaskWorkSpecificationFacts"
  )
}

const isReplacementClaimRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is TaskTrackerFactsRecord<ReplacementClaimFacts> => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return false
  return record.event.operationId === operationId && record.event.observation._tag === "FocusedTaskClaimFacts"
}

const isReplacementWorktreeRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is ReplacementWorktreeRecord =>
  record.event._tag === "PlannedAttemptWorktreeObserved" && record.event.operationId === operationId

const isReplacementTargetRecord = (
  record: JournalRecord,
  operationId: OperationId
): record is ReplacementTargetRecord =>
  record.event._tag === "TargetLineageObserved" && record.event.operationId === operationId

const replacementGraphIsExact = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  operationId: OperationId,
  applicationPosition: JournalPosition
): boolean => {
  const record = prior.findLast((candidate) => isReplacementGraphRecord(candidate, operationId))
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  if (
    prior.some(
      ({ event, position }) =>
        position > record.position &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTrackerGraph" &&
        event.operation.readShape.explicitlyCoveredTaskIds.includes(plannedAttempt.taskId) &&
        taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(record.event.observation.target)
    )
  ) {
    return false
  }
  const graphState = reconstructedTaskGraphFromEvents(
    prior.filter(({ position }) => position <= record.position).map(({ event }) => event),
    record.event.observation.target
  )
  return Option.exists(graphState, (snapshot) =>
    snapshot.eligibleTasks().some(({ id }) => id === plannedAttempt.taskId)
  )
}

const replacementSpecificationIsExact = (
  prior: ReadonlyArray<JournalRecord>,
  subject: PlannedAttemptReplacementRecord["event"]["subject"],
  operationId: OperationId,
  applicationPosition: JournalPosition
): boolean => {
  const record = prior.findLast((candidate) => isReplacementSpecificationRecord(candidate, operationId))
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  const intent = freshReplacementTrackerReadIntent(prior, operationId, applicationPosition)
  if (intent?.event.operation._tag !== "ReadTaskWorkSpecification") return false
  if (
    prior.some(
      ({ event, position }) =>
        position > record.position &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorkSpecification" &&
        event.operation.taskId === subject.plannedAttempt.taskId &&
        taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(intent.event.operation.target)
    )
  ) {
    return false
  }
  return [
    record.event.observation.factFamily.taskId === subject.plannedAttempt.taskId,
    record.event.observation.factFamily.fingerprint === subject.observedTaskRevision
  ].every(Boolean)
}

const replacementClaimIsExact = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  application: RestartApplicationRecord
): boolean => {
  const record = prior.findLast((candidate) => isReplacementClaimRecord(candidate, witness.claimObservationOperationId))
  if (record === undefined) return false
  if (record.position <= application.position) return false
  const intent = freshReplacementTrackerReadIntent(prior, witness.claimObservationOperationId, application.position)
  if (intent?.event.operation._tag !== "ReadTaskClaim") return false
  if (
    prior.some(
      ({ event, position }) =>
        position > record.position &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTaskClaim" &&
        event.operation.taskId === plannedAttempt.taskId &&
        taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(intent.event.operation.target)
    )
  ) {
    return false
  }
  const observation = record.event.observation.observation
  if (observation._tag !== "ActiveTaskClaim") return false
  const authorizedClaim = restartClaimAuthorityAtApplication(prior, application)
  if (authorizedClaim === undefined) return false
  return [
    isExactTaskClaim(observation, witness.expectedClaim),
    isExactTaskClaim(authorizedClaim.claim, witness.expectedClaim)
  ].every(Boolean)
}

export const replacementResourceConflict = (
  event: WorkflowJournalEvent,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"]
): boolean => {
  if (event._tag === "TaskClaimReacquisitionDirected") {
    return event.subject.runId === plannedAttempt.runId && event.subject.taskId === plannedAttempt.taskId
  }
  if (event._tag === "TaskClaimAcquisitionIntended") {
    return event.operation.acquisition.taskId === plannedAttempt.taskId
  }
  if (event._tag === "TaskClaimReleaseIntended") {
    return isExactTaskClaim(event.operation.release.claim, witness.expectedClaim)
  }
  if (event._tag === "TaskClaimReleased") {
    return isExactTaskClaim(event.release.claim, witness.expectedClaim)
  }
  return (
    event._tag === "TaskWorktreeReconciliationIntended" &&
    plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt)
  )
}

const replacementPreservesPriorResources = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  applicationPosition: JournalPosition
): boolean =>
  !prior.some(({ event, position }) => {
    if (position <= applicationPosition) return false
    return replacementResourceConflict(event, plannedAttempt, witness)
  })

const replacementWorktreeIsExact = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  applicationPosition: JournalPosition
): boolean => {
  const record = prior.findLast((candidate) =>
    isReplacementWorktreeRecord(candidate, witness.oldWorktreeObservationOperationId)
  )
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  if (
    prior.some(
      ({ event, position }) =>
        position > record.position &&
        event._tag === "GitReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorktree" &&
        plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt)
    )
  ) {
    return false
  }
  if (record.event.observation._tag !== "PlannedWorktreeReady") return false
  return [
    record.event.observation.baseSha === witness.oldWorktreeProof.baseSha,
    record.event.observation.branch === witness.oldWorktreeProof.branch,
    record.event.observation.headSha === witness.oldWorktreeProof.headSha,
    record.event.observation.worktree === witness.oldWorktreeProof.worktree
  ].every(Boolean)
}

type IntegrationTargetAuthority = Extract<
  WorkflowOperation,
  { readonly _tag: "ReadTargetLineage" }
>["integrationTarget"]

const sameIntegrationTarget = (left: IntegrationTargetAuthority, right: IntegrationTargetAuthority): boolean =>
  left.repository === right.repository && left.ref === right.ref

const isLaterTargetLineageRead = (
  event: WorkflowJournalEvent,
  target: IntegrationTargetAuthority,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  event._tag === "GitReadIntentRecorded" &&
  event.operation._tag === "ReadTargetLineage" &&
  plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt) &&
  sameIntegrationTarget(event.operation.integrationTarget, target)

const isLaterTargetAuthority =
  (baselinePosition: JournalPosition, target: IntegrationTargetAuthority, plannedAttempt: PlannedTaskAttempt) =>
  ({ event, position }: JournalRecord): boolean =>
    position > baselinePosition && isLaterTargetLineageRead(event, target, plannedAttempt)

const replacementTargetIsExact = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptReplacementRecord["event"]["witness"],
  applicationPosition: JournalPosition
): boolean => {
  const record = prior.findLast((candidate) =>
    isReplacementTargetRecord(candidate, witness.targetLineageObservationOperationId)
  )
  if (record === undefined) return false
  if (record.position <= applicationPosition) return false
  const intent = freshReplacementGitReadIntent(prior, witness.targetLineageObservationOperationId, applicationPosition)
  if (intent?.event.operation._tag !== "ReadTargetLineage") return false
  const currentTarget = intent.event.operation.integrationTarget
  if (prior.some(isLaterTargetAuthority(record.position, currentTarget, plannedAttempt))) {
    return false
  }
  return [
    plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt),
    record.event.observation.targetHeadSha === witness.targetHeadSha
  ].every(Boolean)
}

const plannedAttemptReplacementFactsAreExact = (
  record: PlannedAttemptReplacementRecord,
  prior: ReadonlyArray<JournalRecord>,
  application: AppliedRestartRecord
): boolean => {
  const event = record.event
  const { plannedAttempt } = event.subject
  const { witness } = event
  const immutableRunTarget = exactWorkflowRunTargetFor(prior)
  if (immutableRunTarget === undefined) return false
  return [
    !restartChoiceWasInvalidatedByLaterSpecification(prior, application.position, event.subject, immutableRunTarget),
    replacementPreservesPriorResources(prior, plannedAttempt, witness, application.position),
    replacementReadIntentsAreFreshAndExact(prior, event, application.position),
    replacementGraphIsExact(prior, plannedAttempt, witness.graphObservationOperationId, application.position),
    replacementSpecificationIsExact(
      prior,
      event.subject,
      witness.specificationObservationOperationId,
      application.position
    ),
    replacementClaimIsExact(prior, plannedAttempt, witness, application),
    replacementWorktreeIsExact(prior, plannedAttempt, witness, application.position),
    replacementTargetIsExact(prior, plannedAttempt, witness, application.position)
  ].every(Boolean)
}

type AppliedRestartRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation"
  }
}

const appliedRestartForReplacement = (
  prior: ReadonlyArray<JournalRecord>,
  event: PlannedAttemptReplacementRecord["event"]
): AppliedRestartRecord | undefined =>
  prior.findLast((record): record is AppliedRestartRecord => {
    if (record.event._tag !== "AttemptChoiceApplied") return false
    return [
      record.event.choice === "RestartTaskImplementation",
      sameAttemptChoiceRequestId(record.event.requestId, event.requestId),
      sameAttemptChoiceSubject(record.event.subject, event.subject)
    ].every(Boolean)
  })

const replacementBindsRun = (event: PlannedAttemptReplacementRecord["event"], runId: RunId): boolean =>
  [event.requestId.runId === runId, event.subject.plannedAttempt.runId === runId].every(Boolean)

export const replacementFollowsIntegrationCutoff = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  prior.some(({ event }) => {
    if (event._tag !== "IntegrationStarted") return false
    return [
      event.plannedAttempt.runId === plannedAttempt.runId,
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ].every(Boolean)
  })

type ReplacementQuiescenceEvidence = NonNullable<ReturnType<typeof proofEvidenceFor>>

export const replacementProofIsAcceptedSafe = (proof: ReplacementQuiescenceEvidence): boolean =>
  proof.report._tag === "ExecutorWorkSafelySuspended"

const replacementHasNoUnsettledCommand = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): boolean => latestUnsettledPlannedAttemptExecutorCommand(prior, plannedAttempt) === undefined

const replacementQuiescenceIsCurrent = (
  prior: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  quiescenceProof: PlannedAttemptReplacementRecord["event"]["witness"]["quiescenceProof"]
): boolean => {
  const proof = proofEvidenceFor(prior, plannedAttempt, quiescenceProof)
  if (proof === undefined) return false
  const latestEvidence = latestPlannedAttemptExecutorEvidence(prior, plannedAttempt)
  return [
    latestEvidence?.observedAt === proof.observedAt,
    replacementHasNoUnsettledCommand(prior, plannedAttempt),
    replacementProofIsAcceptedSafe(proof)
  ].every(Boolean)
}

/** Validates the one atomic P1-supersession/P2-plan chronology and its fresh authorities. */
const validatePlannedAttemptReplacement = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "PlannedAttemptReplaced") return indexes
  const event = record.event
  const prior = records.filter(({ position }) => position < record.position)
  if (!replacementBindsRun(event, runId)) {
    identityIssue(
      issues,
      runId,
      record.position,
      `planned-attempt replacement ${event.requestId.nonce} binds another Run`
    )
  }
  const applied = appliedRestartForReplacement(prior, event)
  if (applied === undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "PlannedAttemptReplaced requires its exact prior applied Restart choice"
    )
    return indexes
  }
  const priorAttempt = event.subject.plannedAttempt
  /* v8 ignore next -- @preserve Journal record-key uniqueness rejects a second successor before semantic replacement validation. */
  if (HashSet.has(indexes.supersededExecutorAttempts, priorAttempt.attemptId)) {
    semanticIssue(issues, runId, record.position, `attempt ${priorAttempt.attemptId} already has a recorded successor`)
  }
  /* v8 ignore next -- @preserve The integration-start record owns this exact attempt and prevents its Restart controller from allocating a successor. */
  if (replacementFollowsIntegrationCutoff(prior, priorAttempt)) {
    semanticIssue(issues, runId, record.position, "PlannedAttemptReplaced follows the exact integration-start cutoff")
  }
  if (!replacementQuiescenceIsCurrent(prior, priorAttempt, event.witness.quiescenceProof)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "PlannedAttemptReplaced requires current unbroken accepted Safe suspension"
    )
  }
  if (!plannedAttemptReplacementFactsAreExact({ ...record, event }, prior, applied)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      "PlannedAttemptReplaced lacks exact fresh F2, K1, W1, or H2 authority"
    )
  }
  return {
    ...indexes,
    supersededExecutorAttempts: HashSet.add(indexes.supersededExecutorAttempts, priorAttempt.attemptId)
  }
}

const validatePlan = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): FoldIndexes => {
  if (record.event._tag !== "TaskAttemptPlanned" && record.event._tag !== "PlannedAttemptReplaced") return indexes
  const plannedAttempt =
    record.event._tag === "TaskAttemptPlanned"
      ? record.event.operation.plannedAttempt
      : record.event.successorPlan.plannedAttempt
  const prior = mapGet(indexes.plans, plannedAttempt.attemptId)
  if (prior !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      plannedTaskAttemptEquivalence(prior, plannedAttempt)
        ? `duplicate planned task attempt for attempt ${plannedAttempt.attemptId}`
        : `contradictory planned task attempts for attempt ${plannedAttempt.attemptId}`
    )
    return indexes
  }
  return { ...indexes, plans: HashMap.set(indexes.plans, plannedAttempt.attemptId, plannedAttempt) }
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
      validateExactObservation()
      validateContradictoryObservation()
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
  next = validatePlan(record, runId, next, issues)
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
  reconstructRunState: () => ReconstructedRunState = () => reconstructValidatedRunState(runId, records)
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  validateOneUnfinishedAttemptPerTask(runId, indexes, issues)
  validateRunLifecycle(runId, records, issues)
  if (issues.length > 0) {
    return rememberReduction({ _tag: "InvalidWorkflowJournalHistory", issues, records, runId })
  }
  const valid: ValidWorkflowJournalHistory = {
    _tag: "ValidWorkflowJournalHistory",
    runState: reconstructRunState(),
    records,
    runId
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
  const advanced = finishValidation(prior.runId, records, advancedIndexes, issues, () =>
    advanceReconstructedRunState(prior.runState, record, records)
  )
  if (advanced._tag === "ValidWorkflowJournalHistory") {
    rememberValidatedJournalPrefixSuccessor(prior, advanced, record)
    return advanced
  }

  return advanced
}
