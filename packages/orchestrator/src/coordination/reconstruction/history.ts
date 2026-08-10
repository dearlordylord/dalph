/* eslint-disable functional/immutable-data, max-lines -- The chronological validator owns its local indexes and cross-event invariants. */
import { type AttemptId, type PlannedTaskAttempt, type RunId, type TaskId } from "@dalph/contracts"
import { type JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import { type OperationId } from "../../workflow/identity.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import {
  duplicateUnfinishedTaskAttemptIssue,
  type InvalidWorkflowJournalHistory,
  WorkflowJournalHistoryIdentityIssue,
  type WorkflowJournalHistoryIssue,
  WorkflowJournalHistorySemanticIssue,
  type ValidWorkflowJournalHistory
} from "./history-result.js"
import { deriveRunRecoveryFrontier } from "../frontier/recovery-frontier.js"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { reconstructValidatedRunState } from "./reduce.js"
import {
  invalidTaskTrackerReconfirmationReference,
  makeTaskTrackerReconfirmationIndex,
  type TaskTrackerReconfirmationIndex
} from "../../workflow/task-tracker-facts/reconfirmation.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { validateRunPolicyHistory } from "./run-policy-history.js"
import { type IntegrationHistoryIndexes, validateIntegrationHistoryRecord } from "./integration-history.js"
import { makeTargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import { validateTaskClaimRelease } from "./claim-release-history.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { ActiveTaskClaim, isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import { evaluatePlannedAttemptContinuationAuthorization } from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand,
  plannedAttemptExecutorEvidence
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import {
  defaultPlannedAttemptExecutorContinuationLimit,
  defaultPlannedAttemptExecutorSuspensionLimit
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { authorizedClaimForAttempt } from "../../workflow/claim-authority-history.js"
import {
  makeIntegrationFinalityHistoryIndexes,
  validateIntegrationFinalityHistoryRecord,
  type IntegrationFinalityHistoryIndexes
} from "../../workflow/protocols/integration-finality/history.js"
import {
  attemptChoiceSubjectKey,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "../../workflow/protocols/attempt-choice/events.js"

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
  issues: Array<WorkflowJournalHistoryIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  issues.push(new WorkflowJournalHistorySemanticIssue({ detail, position, runId }))
}

interface FoldIndexes extends IntegrationHistoryIndexes {
  readonly abandonedExecutorAttempts: Set<AttemptId>
  readonly integrationFinalityHistory: IntegrationFinalityHistoryIndexes
  readonly attemptChoiceSubjects: Set<string>
  latestControlDirectionOrdinal: number
  readonly executorCommandOrdinals: Map<AttemptId, number>
  readonly executorCommandCountsSinceSafeSuspension: Map<string, number>
  readonly executorCommandProjectionOrdinals: Map<string, number>
  readonly executorReportOrdinals: Map<AttemptId, number>
  readonly executorStateObservationOrdinals: Map<AttemptId, number>
  readonly executorResponsibilitiesBegan: Map<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly plans: Map<AttemptId, PlannedTaskAttempt>
  readonly gitReadIntents: Map<
    OperationId,
    Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" | "ReadTaskWorktree" }>
  >
  latestRunPolicyRevision: number | undefined
  readonly seenEventKindsByOperation: Map<OperationId, ReadonlySet<WorkflowJournalEvent["_tag"]>>
  readonly seenKeys: Set<JournalRecordKey>
  readonly seenOperationIds: Set<OperationId>
  readonly terminalExecutorAttempts: Set<AttemptId>
  readonly unsettledExecutorCommands: Map<AttemptId, number>
  readonly trackerReconfirmations: TaskTrackerReconfirmationIndex
}

const emptyIndexes = (): FoldIndexes => ({
  acceptedExecutorResults: new Map(),
  abandonedExecutorAttempts: new Set(),
  attemptChoiceSubjects: new Set(),
  executorCommandOrdinals: new Map(),
  executorCommandCountsSinceSafeSuspension: new Map(),
  executorCommandProjectionOrdinals: new Map(),
  executorReportOrdinals: new Map(),
  executorStateObservationOrdinals: new Map(),
  executorResponsibilitiesBegan: new Map(),
  integrationResponsibilitiesBegan: new Map(),
  integrationStarted: new Map(),
  integrationCandidateIntents: new Map(),
  integrationCandidateIntentsByStartedAt: new Map(),
  integrationCandidatesConstructed: new Map(),
  targetVerificationIntents: new Map(),
  targetVerificationTerminals: new Set(),
  targetPromotionHistory: makeTargetPromotionHistoryIndexes(),
  integrationCandidateSubmissions: new Map(),
  integrationFinalityHistory: makeIntegrationFinalityHistoryIndexes(),
  integrationCandidateGitObservations: new Map(),
  latestControlDirectionOrdinal: 0,
  plans: new Map(),
  gitReadIntents: new Map(),
  latestRunPolicyRevision: undefined,
  seenEventKindsByOperation: new Map(),
  seenKeys: new Set(),
  seenOperationIds: new Set(),
  terminalExecutorAttempts: new Set(),
  unsettledExecutorCommands: new Map(),
  trackerReconfirmations: makeTaskTrackerReconfirmationIndex()
})

const validateRecordEnvelope = (
  record: JournalRecord,
  index: number,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): boolean => {
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
  if (indexes.seenKeys.has(record.key)) {
    semanticIssue(issues, runId, record.position, `duplicate journal record key ${record.key}`)
    return false
  }
  indexes.seenKeys.add(record.key)
  return true
}

const validateControlDirection = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag !== "ControlDirectionEventDescriptor") return
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
  indexes.latestControlDirectionOrdinal = descriptor.ordinal
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
  const plan = prior.find(
    ({ event }) =>
      event._tag === "TaskAttemptPlanned" &&
      event.operation.plannedAttempt.attemptId === subject.plannedAttempt.attemptId
  )?.event
  const planMatches = () =>
    plan?._tag === "TaskAttemptPlanned" &&
    plannedTaskAttemptEquivalence(plan.operation.plannedAttempt, subject.plannedAttempt)
  if (!planMatches()) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} has no prior matching planned attempt`
    )
  }
  const latestReport = latestPlannedAttemptExecutorEvidence(prior, subject.plannedAttempt)
  const executorIsSafelySuspended = () =>
    latestReport?.report._tag === "SafelySuspended" &&
    latestUnsettledPlannedAttemptExecutorCommand(prior, subject.plannedAttempt) === undefined
  if (!executorIsSafelySuspended()) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} requires a latest exact safely-suspended executor report`
    )
  }
  const latestSpecification = prior.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === subject.plannedAttempt.taskId
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
): void => {
  if (record.event._tag !== "AttemptChoiceApplied") return
  const { subject } = record.event
  const prior = records.filter(({ position }) => position < record.position)
  validateAttemptChoiceAuthority({ ...record, event: record.event }, runId, prior, issues)
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
  const subjectKey = attemptChoiceSubjectKey(subject)
  if (indexes.attemptChoiceSubjects.has(subjectKey)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `attempt-choice request ${record.event.requestId.nonce} follows the winning direction for the same fingerprint pair`
    )
  }
  indexes.attemptChoiceSubjects.add(subjectKey)
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
  taskId: TaskId
) =>
  prior.findLast(
    ({ event, position }) =>
      position > baselinePosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskClaimFacts" &&
      event.observation.coverage.taskId === taskId
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
  event: Extract<WorkflowJournalEvent, { readonly _tag: "AttemptImplementationAbandoned" }>
) =>
  plannedAttemptExecutorEvidence(prior, event.subject.plannedAttempt).find((evidence) => {
    switch (event.proof._tag) {
      case "CommandResponse":
        return evidence.source._tag === "CommandResponse" && evidence.source.ordinal === event.proof.reportOrdinal
      case "CommandProjection":
        return (
          evidence.source._tag === "CommandProjection" &&
          evidence.source.commandOrdinal === event.proof.commandOrdinal &&
          evidence.source.projectionOrdinal === event.proof.projectionOrdinal
        )
      case "StateProjection":
        return evidence.source._tag === "StateProjection" && evidence.source.ordinal === event.proof.observationOrdinal
    }
  })

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
): void => {
  const event = record.event
  const prior = records.filter(({ position }) => position < record.position)
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
      const evidence = proofEvidenceFor(prior, event)
      const evidenceProvesQuiescence = () =>
        evidence !== undefined && (evidence.report._tag === "SafelySuspended" || evidence.report._tag === "Terminal")
      if (!evidenceProvesQuiescence()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `attempt abandonment for ${event.subject.plannedAttempt.attemptId} requires its exact safe or terminal executor proof`
        )
      } else if (
        evidence !== undefined &&
        prior.some(
          ({ event: priorEvent, position }) =>
            position > evidence.observedAt &&
            priorEvent._tag === "PlannedAttemptExecutorCommandIntended" &&
            priorEvent.plannedAttempt.runId === event.subject.plannedAttempt.runId &&
            priorEvent.plannedAttempt.attemptId === event.subject.plannedAttempt.attemptId
        )
      ) {
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
      indexes.abandonedExecutorAttempts.add(event.subject.plannedAttempt.attemptId)
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
          event.subject.plannedAttempt.taskId
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
        const observationMatches = () =>
          observation?._tag !== "TaskTrackerFactsObserved" ||
          observation.observation._tag !== "FocusedTaskClaimFacts" ||
          observation.operationId !== event.observationOperationId ||
          observationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
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
            appliedStop.event.subject.plannedAttempt.taskId
          )
          const observation = observationRecord?.event
          const findObservationIntent = () =>
            observationRecord?.event._tag === "TaskTrackerFactsObserved"
              ? matchingFocusedClaimReadIntentAfter(
                  prior,
                  abandonment.position,
                  observationRecord.event.operationId,
                  observationRecord.position,
                  appliedStop.event.subject.plannedAttempt.taskId
                )
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
}

const validateOperationEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  validateGitReadEvent(record, runId, indexes, issues)
  validateOperationDescriptor(record, runId, indexes, issues)
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
const validateGitReadEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag === "GitReadIntentRecorded") {
    indexes.gitReadIntents.set(record.event.operation.operationId, record.event.operation)
  }
  if (record.event._tag === "PlannedAttemptWorktreeObserved") {
    const intent = indexes.gitReadIntents.get(record.event.operationId)
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
  if (record.event._tag === "TargetLineageObserved") {
    const intent = indexes.gitReadIntents.get(record.event.operationId)
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

const validateOperationDescriptor = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag !== "OperationEventDescriptor") return
  validateRequiredOperationIds(record, runId, indexes, issues, descriptor)
  validateRequiredPredecessorKinds(record, runId, indexes, issues, descriptor)
  validateRequiredRecordPredecessor(record, runId, indexes, issues, descriptor)
  indexes.seenOperationIds.add(descriptor.operationId)
  indexes.seenEventKindsByOperation.set(
    descriptor.operationId,
    new Set([...(indexes.seenEventKindsByOperation.get(descriptor.operationId) ?? []), record.event._tag])
  )
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
    if (!indexes.seenOperationIds.has(requiredOperationId)) {
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
    const kinds = indexes.seenEventKindsByOperation.get(descriptor.operationId)
    if (!kinds?.has(requiredKind)) {
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
    !indexes.seenKeys.has(descriptor.recordPredecessor.key)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `event ${record.event._tag} has no prior record ${descriptor.recordPredecessor.key}`
    )
  }
}

const validatePlan = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "TaskAttemptPlanned") return
  const plannedAttempt = record.event.operation.plannedAttempt
  const prior = indexes.plans.get(plannedAttempt.attemptId)
  if (prior !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      plannedTaskAttemptEquivalence(prior, plannedAttempt)
        ? `duplicate planned task attempt for attempt ${plannedAttempt.attemptId}`
        : `contradictory planned task attempts for attempt ${plannedAttempt.attemptId}`
    )
    return
  }
  indexes.plans.set(plannedAttempt.attemptId, plannedAttempt)
}

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
  if (
    intended === undefined ||
    acquired.operationId !== intended.operationId ||
    acquired.owner !== intended.owner ||
    acquired.taskId !== intended.taskId ||
    acquired.token !== intended.token
  ) {
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
): void => {
  const detail = invalidTaskTrackerReconfirmationReference(record, runId, indexes.trackerReconfirmations)
  if (detail !== undefined) semanticIssue(issues, runId, record.position, detail)
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

const validateExecutorEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const event = record.event
  const descriptor = describeJournalEvent(event)
  const executorAttemptId =
    descriptor._tag === "PlannedAttemptExecutorEventDescriptor" ? descriptor.correlation.attemptId : undefined
  if (executorAttemptId !== undefined && indexes.abandonedExecutorAttempts.has(executorAttemptId)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor event ${event._tag} follows abandonment of attempt ${executorAttemptId}`
    )
  }
  const validateResponsibilityBegan = () => {
    if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
      const attemptId = event.plannedAttempt.attemptId
      const plan = indexes.plans.get(attemptId)
      if (plan === undefined || !plannedTaskAttemptEquivalence(plan, event.plannedAttempt)) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor work for attempt ${attemptId} has no prior matching planned task attempt`
        )
      }
      const priorResponsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
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
        indexes.executorResponsibilitiesBegan.set(attemptId, {
          plannedAttempt: event.plannedAttempt,
          position: record.position
        })
      }
    }
  }
  const validateCommandIntent = () => {
    if (event._tag === "PlannedAttemptExecutorCommandIntended") {
      const attemptId = event.plannedAttempt.attemptId
      const responsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
      const responsibilityMatches = () =>
        responsibility !== undefined &&
        plannedTaskAttemptEquivalence(responsibility.plannedAttempt, event.plannedAttempt)
      if (!responsibilityMatches()) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor command for attempt ${attemptId} has no prior matching executor-work responsibility`
        )
      }
      const expectedCommandOrdinal = () => (indexes.executorCommandOrdinals.get(attemptId) ?? 0) + 1
      const expectedOrdinal = expectedCommandOrdinal()
      if (event.ordinal !== expectedOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor command for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.ordinal}`
        )
      }
      indexes.executorCommandOrdinals.set(attemptId, event.ordinal)
      const commandCountKey = `${attemptId}:${event.command}`
      const nextCommandCount = () => (indexes.executorCommandCountsSinceSafeSuspension.get(commandCountKey) ?? 0) + 1
      const commandCount = nextCommandCount()
      indexes.executorCommandCountsSinceSafeSuspension.set(commandCountKey, commandCount)
      const commandLimitFor = () =>
        event.command === "StartOrContinue"
          ? defaultPlannedAttemptExecutorContinuationLimit
          : defaultPlannedAttemptExecutorSuspensionLimit
      const commandLimit = commandLimitFor()
      if (commandCount > commandLimit) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor ${event.command} command for attempt ${attemptId} exceeds durable limit ${commandLimit}`
        )
      }
      if (indexes.unsettledExecutorCommands.has(attemptId)) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor command for attempt ${attemptId} follows an unmatched prior command intent`
        )
      }
      indexes.unsettledExecutorCommands.set(attemptId, event.ordinal)
      if (indexes.terminalExecutorAttempts.has(attemptId)) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor command follows the terminal result for attempt ${attemptId}`
        )
      }
    }
  }
  const validateCommandProjection = () => {
    if (event._tag === "PlannedAttemptExecutorCommandProjectionObserved") {
      const attemptId = event.plannedAttempt.attemptId
      const responsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
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
      if (indexes.unsettledExecutorCommands.get(attemptId) !== event.commandOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor projection for attempt ${attemptId} does not name its unmatched command intent`
        )
      }
      const projectionKey = `${attemptId}:${event.commandOrdinal}`
      const expectedProjectionOrdinal = () => (indexes.executorCommandProjectionOrdinals.get(projectionKey) ?? 0) + 1
      const expectedOrdinal = expectedProjectionOrdinal()
      if (event.projectionOrdinal !== expectedOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor projection for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.projectionOrdinal}`
        )
      }
      indexes.executorCommandProjectionOrdinals.set(projectionKey, event.projectionOrdinal)
      if (event.observation._tag === "ExactExecutorReport") {
        const correlation = event.observation.report.correlation
        const correlationMatches = () =>
          correlation.runId === event.plannedAttempt.runId && correlation.attemptId === attemptId
        if (!correlationMatches()) {
          identityIssue(
            issues,
            runId,
            record.position,
            `executor command projection for attempt ${attemptId} returned a contradictory correlation`
          )
        } else {
          indexes.unsettledExecutorCommands.delete(attemptId)
          if (event.observation.report._tag === "SafelySuspended") {
            indexes.executorCommandCountsSinceSafeSuspension.delete(`${attemptId}:StartOrContinue`)
            indexes.executorCommandCountsSinceSafeSuspension.delete(`${attemptId}:Suspend`)
          }
        }
      }
    }
  }
  const validateCommandResponseContradiction = () => {
    if (event._tag === "PlannedAttemptExecutorCommandResponseContradicted") {
      const attemptId = event.plannedAttempt.attemptId
      const responsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
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
      if (indexes.unsettledExecutorCommands.get(attemptId) !== event.commandOrdinal) {
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
  const validateStateObservation = () => {
    if (event._tag === "PlannedAttemptExecutorStateObserved") {
      const attemptId = event.plannedAttempt.attemptId
      const responsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
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
      if (indexes.unsettledExecutorCommands.has(attemptId)) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor state observation for attempt ${attemptId} bypasses its unmatched command intent`
        )
      }
      const expectedStateOrdinal = () => (indexes.executorStateObservationOrdinals.get(attemptId) ?? 0) + 1
      const expectedOrdinal = expectedStateOrdinal()
      if (event.ordinal !== expectedOrdinal) {
        semanticIssue(
          issues,
          runId,
          record.position,
          `executor state observation for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.ordinal}`
        )
      }
      indexes.executorStateObservationOrdinals.set(attemptId, event.ordinal)
      const correlationContradicts = () =>
        event.observation._tag === "ExactExecutorReport" &&
        (event.observation.report.correlation.runId !== event.plannedAttempt.runId ||
          event.observation.report.correlation.attemptId !== attemptId)
      if (correlationContradicts()) {
        identityIssue(
          issues,
          runId,
          record.position,
          `executor state observation for attempt ${attemptId} returned a contradictory correlation`
        )
      }
      const observedSafeSuspension = () =>
        event.observation._tag === "ExactExecutorReport" && event.observation.report._tag === "SafelySuspended"
      if (observedSafeSuspension()) {
        indexes.executorCommandCountsSinceSafeSuspension.delete(`${attemptId}:StartOrContinue`)
        indexes.executorCommandCountsSinceSafeSuspension.delete(`${attemptId}:Suspend`)
      }
    }
  }
  const validateWorkReport = () => {
    if (event._tag !== "PlannedAttemptExecutorWorkReported") return
    const attemptId = event.report.correlation.attemptId
    const responsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
    if (responsibility === undefined || event.report.correlation.runId !== responsibility.plannedAttempt.runId) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor report for attempt ${attemptId} has no prior matching executor-work responsibility`
      )
    }
    const expectedOrdinal = (indexes.executorReportOrdinals.get(attemptId) ?? 0) + 1
    if (event.ordinal !== expectedOrdinal) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor report for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.ordinal}`
      )
    }
    indexes.executorReportOrdinals.set(attemptId, event.ordinal)
    if (!indexes.unsettledExecutorCommands.has(attemptId)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor report for attempt ${attemptId} has no outstanding command intent`
      )
    } else {
      indexes.unsettledExecutorCommands.delete(attemptId)
    }
    if (indexes.terminalExecutorAttempts.has(attemptId)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor report follows the terminal result for attempt ${attemptId}`
      )
    }
    if (event.report._tag === "Terminal") {
      indexes.terminalExecutorAttempts.add(attemptId)
      if (event.report.result._tag === "Accepted") {
        indexes.acceptedExecutorResults.set(attemptId, event.report.result.acceptedResult)
      }
    }
    if (event.report._tag === "SafelySuspended") {
      indexes.executorCommandCountsSinceSafeSuspension.delete(`${attemptId}:StartOrContinue`)
      indexes.executorCommandCountsSinceSafeSuspension.delete(`${attemptId}:Suspend`)
    }
  }
  validateResponsibilityBegan()
  validateCommandIntent()
  validateCommandProjection()
  validateCommandResponseContradiction()
  validateStateObservation()
  validateWorkReport()
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
  for (const [attemptId, responsibility] of indexes.executorResponsibilitiesBegan) {
    if (indexes.terminalExecutorAttempts.has(attemptId) || indexes.abandonedExecutorAttempts.has(attemptId)) continue
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

const validateRunLifecycle = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
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

/**
 * Validates all decoded records before reconstruction or any outside call.
 * The fold retains every issue it can establish from the immutable history.
 */
export const reduceWorkflowJournalHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  const issues = new Array<WorkflowJournalHistoryIssue>()
  const indexes = emptyIndexes()
  records.forEach((record, index) => {
    const unique = validateRecordEnvelope(record, index, runId, indexes, issues)
    const descriptor = describeJournalEvent(record.event)
    validateControlDirection(record, runId, indexes, issues)
    validateAttemptChoice(record, runId, records, indexes, issues)
    validateAttemptStop(record, runId, records, indexes, issues)
    validateTaskClaimReacquisitionDirection(record, runId, issues)
    if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor" && descriptor.correlation.runId !== runId) {
      identityIssue(
        issues,
        runId,
        record.position,
        `executor work for attempt ${descriptor.correlation.attemptId} binds run ${descriptor.correlation.runId}`
      )
    }
    if (!unique) {
      if (record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
        validateExecutorEvent(record, runId, indexes, issues)
      }
      return
    }
    validateOperationEvent(record, runId, indexes, issues)
    validateContinuationAuthorization(record, runId, records, issues)
    validatePlan(record, runId, indexes, issues)
    validateClaimReacquisitionIntent(record, runId, records, issues)
    validateClaim(record, runId, records, issues)
    validateClaimRejection(record, runId, records, issues)
    validateTaskClaimRelease(record, records, (detail) => identityIssue(issues, runId, record.position, detail))
    validateTrackerObservation(record, runId, records, issues)
    validateReconfirmationReference(record, runId, indexes, issues)
    validateExecutorEvent(record, runId, indexes, issues)
    validateIntegrationHistoryRecord(
      record,
      runId,
      indexes,
      (detail) => identityIssue(issues, runId, record.position, detail),
      (detail) => semanticIssue(issues, runId, record.position, detail)
    )
    validateIntegrationFinalityHistoryRecord(
      record,
      runId,
      records,
      indexes.integrationFinalityHistory,
      (detail) => identityIssue(issues, runId, record.position, detail),
      (detail) => semanticIssue(issues, runId, record.position, detail)
    )
    const policyValidation = validateRunPolicyHistory(record, indexes)
    indexes.latestRunPolicyRevision = policyValidation.latestRunPolicyRevision
    for (const detail of policyValidation.details) {
      semanticIssue(issues, runId, record.position, detail)
    }
  })
  validateOneUnfinishedAttemptPerTask(runId, indexes, issues)
  validateRunLifecycle(runId, records, issues)
  if (issues.length > 0) {
    return { _tag: "InvalidWorkflowJournalHistory", issues, records, runId }
  }
  return {
    _tag: "ValidWorkflowJournalHistory",
    runState: reconstructValidatedRunState(runId, records),
    records,
    recoveryFrontier: deriveRunRecoveryFrontier(records),
    runId
  }
}
