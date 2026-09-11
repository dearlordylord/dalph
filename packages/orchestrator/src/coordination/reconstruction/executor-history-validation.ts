/* eslint-disable functional/immutable-data, max-lines -- Executor chronology validation updates private persistent fold indexes. */
import {
  plannedTaskAttemptEquivalence,
  samePlannedAttemptExecutorReport,
  type AttemptId,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import { HashMap, HashSet } from "effect"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { plannedAttemptExecutorCommandIntendedRecordKey } from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordCountForAttemptCommandKind,
  journalRecordsForAttemptKind,
  journalRecordByKey,
  lastJournalRecordForAttemptKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import { evaluatePlannedAttemptResumeRedeliveryProof } from "../../workflow/protocols/planned-attempt-continuation/resume-redelivery-authorization.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { defaultPlannedAttemptExecutorSuspensionLimit } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { appliedTerminalChoiceFor } from "../../workflow/protocols/attempt-choice/terminal-choice-authority.js"
import { plannedAttemptExecutorLifecycleTransitionError } from "../../workflow/protocols/planned-attempt-executor-work/report-acceptance.js"
import { acceptedFreshAttemptLineage } from "../admission/fresh-attempt-lineage.js"
import {
  type FoldIndexes,
  identityIssue,
  mapGet,
  semanticIssue,
  type WorkflowJournalHistoryIssueReporter
} from "./history-kernel-state.js"
import { duplicateUnfinishedTaskAttemptIssue } from "./history-result.js"

type ExecutorCommandIntentEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "PlannedAttemptExecutorCommandIntended" }
>

const historyBefore = (records: JournalHistorySource, position: JournalPosition): JournalHistorySource =>
  isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, position)
    : records.filter((candidate) => candidate.position < position)

const historyThrough = (records: JournalHistorySource, position: JournalPosition): JournalHistorySource =>
  isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, JournalPosition.make(position + 1))
    : records.filter((candidate) => candidate.position <= position)

const latestRecord = (records: ReadonlyArray<JournalRecord | undefined>): JournalRecord | undefined =>
  records.reduce<JournalRecord | undefined>(
    (latest, candidate) =>
      candidate !== undefined && (latest === undefined || candidate.position > latest.position) ? candidate : latest,
    undefined
  )

const validateExecutorCommandIdentityAndOrdinal = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
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
  issues: WorkflowJournalHistoryIssueReporter
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

const validateExecutorBeginUniqueness = (
  event: ExecutorCommandIntentEvent,
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (event.command !== "Begin") return
  // Raw cold diagnostics retain malformed duplicate-key candidates that are intentionally absent from accepted indexes.
  const priorBeginExists = isJournalRecordEvidence(records)
    ? (mapGet(indexes.executorCommandCountsSinceSafeSuspension, `${event.plannedAttempt.attemptId}:Begin`) ?? 0) > 0
    : records.some(
        (candidate) =>
          candidate.position < record.position &&
          candidate.event._tag === "PlannedAttemptExecutorCommandIntended" &&
          candidate.event.command === "Begin" &&
          candidate.event.plannedAttempt.attemptId === event.plannedAttempt.attemptId
      )
  if (priorBeginExists) {
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
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (event.command !== "Resume") return
  const attemptId = event.plannedAttempt.attemptId
  const priorTerminalChoice = appliedTerminalChoiceFor(historyBefore(records, record.position), event.plannedAttempt)
  if (priorTerminalChoice !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor resume for attempt ${attemptId} follows terminal choice ${priorTerminalChoice.event.requestId.nonce}`
    )
  }
  const priorRecords = historyBefore(records, record.position)
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
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (event.command !== "Suspend") return
  const priorRecords = historyBefore(records, record.position)
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
  issues: WorkflowJournalHistoryIssueReporter
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
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): FoldIndexes => {
  if (record.event._tag !== "PlannedAttemptExecutorCommandIntended") return indexes
  const event = record.event
  const withIdentity = validateExecutorCommandIdentityAndOrdinal(event, record, runId, indexes, issues)
  const withCount = recordExecutorCommandCount(event, record, runId, withIdentity, issues)
  validateExecutorBeginUniqueness(event, record, runId, records, indexes, issues)
  validateExecutorResumeAuthority(event, record, runId, records, issues)
  validateExecutorSuspendAuthority(event, record, runId, records, issues)
  return recordUnsettledExecutorCommand(event, record, runId, withCount, issues)
}

const validateExecutorResumeRedeliveryIntent = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): FoldIndexes => {
  const event = record.event
  if (event._tag !== "PlannedAttemptExecutorResumeRedeliveryIntended") return indexes
  const prior = historyBefore(records, record.position)
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
    journalRecordCountForAttemptCommandKind(
      prior,
      event.plannedAttempt.attemptId,
      event.commandOrdinal,
      "PlannedAttemptExecutorResumeRedeliveryIntended"
    ) + 1
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
  issues: WorkflowJournalHistoryIssueReporter
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
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  const latestAccepted = lastJournalRecordForAttemptKind(
    historyBefore(records, record.position),
    event.plannedAttempt.attemptId,
    "PlannedAttemptExecutorWorkReported"
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
  issues: WorkflowJournalHistoryIssueReporter
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
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
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
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
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
  const priorRecords = historyBefore(records, record.position)
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
  records: JournalHistorySource,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (event.observation._tag !== "ExactExecutorReport") return
  const priorRecords = historyBefore(records, record.position)
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
  records: JournalHistorySource,
  record: JournalRecord,
  priorAcceptedPosition: JournalPosition | undefined,
  attemptId: AttemptId
): JournalRecord | undefined => {
  const prior = historyBefore(records, record.position)
  const candidate = latestRecord([
    lastJournalRecordForAttemptKind(prior, attemptId, "PlannedAttemptExecutorCommandResponseObserved"),
    lastJournalRecordForAttemptKind(prior, attemptId, "PlannedAttemptExecutorCommandResponseContradicted"),
    lastJournalRecordForAttemptKind(prior, attemptId, "PlannedAttemptExecutorCommandProjectionObserved"),
    lastJournalRecordForAttemptKind(prior, attemptId, "PlannedAttemptExecutorStateObserved")
  ])
  if (candidate === undefined) return undefined
  if (priorAcceptedPosition !== undefined && candidate.position <= priorAcceptedPosition) return undefined
  return candidate
}

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
  issues: WorkflowJournalHistoryIssueReporter
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
  issues: WorkflowJournalHistoryIssueReporter
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
  records: JournalHistorySource,
  priorAccepted: JournalRecord | undefined,
  latestUnacceptedEvidence: JournalRecord | undefined,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (!isSafeToExecutingTransition(priorAccepted, event)) return
  const commandOrdinal = causalExecutorCommandOrdinal(latestUnacceptedEvidence)
  const evidencePosition = latestUnacceptedEvidence?.position ?? record.position
  // Accepted evidence has unique keys; raw cold diagnostics must still select the last malformed duplicate.
  const resumeCommand =
    commandOrdinal === undefined
      ? undefined
      : isJournalRecordEvidence(records)
        ? journalRecordByKey(
            records,
            plannedAttemptExecutorCommandIntendedRecordKey(event.report.correlation.attemptId, commandOrdinal)
          )
        : records.findLast((candidate) =>
            isMatchingCausalResume(candidate, evidencePosition, priorAccepted.position, event, commandOrdinal)
          )
  const matchingResume =
    commandOrdinal !== undefined &&
    resumeCommand !== undefined &&
    isMatchingCausalResume(resumeCommand, evidencePosition, priorAccepted.position, event, commandOrdinal)
  if (!matchingResume) {
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
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt | undefined,
  issues: WorkflowJournalHistoryIssueReporter
): void => {
  if (plannedAttempt === undefined) return
  const priorRecords = historyBefore(records, record.position)
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
  issues: WorkflowJournalHistoryIssueReporter
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
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
): FoldIndexes => {
  if (record.event._tag !== "PlannedAttemptExecutorWorkReported") return indexes
  const event = record.event
  const attemptId = event.report.correlation.attemptId
  const responsibility = mapGet(indexes.executorResponsibilitiesBegan, attemptId)
  const withOrdinal = validateExecutorWorkReportIdentityAndOrdinal(event, record, runId, indexes, issues)
  const priorAccepted = lastJournalRecordForAttemptKind(
    historyBefore(records, record.position),
    attemptId,
    "PlannedAttemptExecutorWorkReported"
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

export const validateExecutorEvent = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  indexes: FoldIndexes,
  issues: WorkflowJournalHistoryIssueReporter
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
      const ordinaryPlanWasAccepted = Array.from(
        journalRecordsForAttemptKind(historyBefore(records, record.position), attemptId, "TaskAttemptPlanned")
      ).some(
        (candidate) =>
          candidate.runId === runId &&
          candidate.event._tag === "TaskAttemptPlanned" &&
          plannedTaskAttemptEquivalence(candidate.event.operation.plannedAttempt, event.plannedAttempt)
      )
      if (
        ordinaryPlanWasAccepted &&
        acceptedFreshAttemptLineage(historyThrough(records, record.position), event.plannedAttempt, "WorktreeReady") ===
          undefined
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
        issues(
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
        const prior = historyBefore(records, record.position)
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
