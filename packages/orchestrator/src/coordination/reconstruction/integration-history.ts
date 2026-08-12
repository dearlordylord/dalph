import {
  plannedTaskAttemptEquivalence,
  evidenceReferenceEquals,
  type AcceptedResult,
  type AttemptId,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import {
  acceptedResultEquivalence,
  integrationResponsibilityEquivalence
} from "../../workflow/protocols/integration-admission/responsibility.js"
import {
  integrationCandidateCorrelationEquals,
  integrationCandidateHasExactParents,
  type IntegrationCandidateCorrelation
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import {
  targetVerificationCorrelationEquals,
  targetVerificationRequestIdForCandidate,
  type TargetVerificationRequestId
} from "../../workflow/protocols/target-verification/events.js"
import {
  invalidTargetPromotionHistory,
  rememberPassedTargetVerification,
  type TargetPromotionHistoryIndexes
} from "./target-promotion-history.js"

export interface IntegrationHistoryIndexes {
  readonly acceptedExecutorResults: Map<AttemptId, AcceptedResult>
  readonly acceptedExecutorResultPositions: Map<AttemptId, JournalPosition>
  readonly executorResponsibilitiesBegan: ReadonlyMap<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly integrationResponsibilitiesBegan: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>
  >
  readonly integrationStarted: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>
  >
  readonly restartChoicesAppliedAt: Map<AttemptId, JournalPosition>
  readonly integrationCandidateIntents: Map<
    string,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateConstructionIntended" }>
  >
  readonly integrationCandidateIntentsByStartedAt: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateConstructionIntended" }>
  >
  readonly integrationCandidateSubmissions: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateAgentReported" }>
  >
  readonly integrationCandidateGitObservations: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateGitObserved" }>
  >
  readonly integrationCandidatesConstructed: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateConstructed" }>
  >
  readonly targetVerificationIntents: Map<
    TargetVerificationRequestId,
    Extract<WorkflowJournalEvent, { readonly _tag: "TargetVerificationIntended" }>
  >
  readonly targetVerificationTerminals: Set<TargetVerificationRequestId>
  readonly targetPromotionHistory: TargetPromotionHistoryIndexes
}

const candidateKey = (correlation: IntegrationCandidateCorrelation): string =>
  JSON.stringify([correlation.runId, correlation.candidateId])
const candidateCorrelatedEventTags: ReadonlySet<string> = new Set([
  "IntegrationCandidateGitObserved",
  "IntegrationCandidateGitValidationFailed",
  "IntegrationCandidateConstructed",
  "IntegrationCandidateCorrectionLimitReached",
  "IntegrationCandidateContinuationLimitReached"
])

const invalidResponsibilityBeginning = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const accepted = indexes.acceptedExecutorResults.get(event.plannedAttempt.attemptId)
  const acceptedAt = indexes.acceptedExecutorResultPositions.get(event.plannedAttempt.attemptId)
  const restartAt = indexes.restartChoicesAppliedAt.get(event.plannedAttempt.attemptId)
  const executorResponsibility = indexes.executorResponsibilitiesBegan.get(event.plannedAttempt.attemptId)
  return restartAt !== undefined && acceptedAt !== undefined && restartAt < acceptedAt
    ? `integration responsibility for attempt ${event.plannedAttempt.attemptId} follows an Accepted result suppressed by prior Restart`
    : accepted === undefined ||
        !acceptedResultEquivalence(accepted, event.acceptedResult) ||
        executorResponsibility === undefined ||
        !plannedTaskAttemptEquivalence(executorResponsibility.plannedAttempt, event.plannedAttempt)
      ? `integration responsibility for attempt ${event.plannedAttempt.attemptId} has no prior matching accepted terminal result`
      : undefined
}

const invalidIntegrationStart = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>,
  position: JournalPosition,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const began = indexes.integrationResponsibilitiesBegan.get(event.responsibilityBeganAt)
  return began === undefined ||
    event.responsibilityBeganAt >= position ||
    !integrationResponsibilityEquivalence(began, event)
    ? `integration start for attempt ${event.plannedAttempt.attemptId} has no exact earlier responsibility at ${event.responsibilityBeganAt}`
    : undefined
}

// eslint-disable-next-line complexity -- One intent must uniquely match every identity and position fixed by its earlier integration start.
const invalidCandidateIntent = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateConstructionIntended" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const started = indexes.integrationStarted.get(event.startedAt)
  const existingIntent = indexes.integrationCandidateIntentsByStartedAt.get(event.startedAt)
  const reusesOpaqueIdentity = [...indexes.integrationCandidateIntents.values()].some(
    (intent) =>
      intent.correlation.candidateId === event.correlation.candidateId ||
      intent.correlation.integrationSessionId === event.correlation.integrationSessionId ||
      intent.correlation.candidateResource === event.correlation.candidateResource
  )
  indexes.integrationCandidateIntents.set(candidateKey(event.correlation), event)
  indexes.integrationCandidateIntentsByStartedAt.set(event.startedAt, event)
  return existingIntent !== undefined ||
    reusesOpaqueIdentity ||
    started === undefined ||
    event.correlation.runId !== event.plannedAttempt.runId ||
    event.correlation.attemptId !== event.plannedAttempt.attemptId ||
    !plannedTaskAttemptEquivalence(started.plannedAttempt, event.plannedAttempt) ||
    started.acceptedResult.commit !== event.correlation.acceptedResultCommit ||
    !evidenceReferenceEquals(started.acceptedResult.evidenceManifest, event.correlation.acceptanceManifest) ||
    JSON.stringify(started.integrationTarget) !== JSON.stringify(event.correlation.integrationTarget) ||
    started.responsibilityBeganAt !== event.responsibilityBeganAt
    ? `candidate intent for attempt ${event.correlation.attemptId} has no exact earlier integration start at ${event.startedAt}`
    : undefined
}

const invalidCandidateAgentReport = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateAgentReported" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const intent = indexes.integrationCandidateIntents.get(candidateKey(event.expectedCorrelation))
  if (intent === undefined || !integrationCandidateCorrelationEquals(intent.correlation, event.expectedCorrelation)) {
    return `candidate agent report has no exact earlier intent for candidate ${event.expectedCorrelation.candidateId}`
  }
  indexes.integrationCandidateSubmissions.set(record.position, event)
  return undefined
}

const invalidCandidateGitResult = (
  record: JournalRecord,
  event: Extract<
    WorkflowJournalEvent,
    { readonly _tag: "IntegrationCandidateGitObserved" | "IntegrationCandidateGitValidationFailed" }
  >,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const submitted = indexes.integrationCandidateSubmissions.get(event.submissionAt)
  const valid =
    submitted?.report._tag === "Submitted" &&
    integrationCandidateCorrelationEquals(submitted.expectedCorrelation, event.correlation) &&
    integrationCandidateCorrelationEquals(submitted.report.correlation, event.correlation) &&
    submitted.report.candidateCommit === event.candidateCommit
  if (event._tag === "IntegrationCandidateGitObserved") {
    indexes.integrationCandidateGitObservations.set(record.position, event)
  }
  return valid ? undefined : `candidate Git result has no exact submitted candidate at ${event.submissionAt}`
}

type ConstructedCandidateEvent = Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateConstructed" }>
type CandidateGitObservationEvent = Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateGitObserved" }>
type CandidateAgentReportEvent = Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateAgentReported" }>

const isExactConstructedCandidateObservation = (
  observed: CandidateGitObservationEvent | undefined,
  event: ConstructedCandidateEvent
): boolean =>
  observed !== undefined &&
  observed.observation._tag === "Commit" &&
  observed.candidateCommit === event.candidateCommit &&
  integrationCandidateCorrelationEquals(observed.correlation, event.correlation) &&
  integrationCandidateHasExactParents(observed.observation, event.correlation)

const isExactConstructedCandidateSubmission = (
  submitted: CandidateAgentReportEvent | undefined,
  event: ConstructedCandidateEvent
): boolean =>
  submitted !== undefined &&
  submitted.report._tag === "Submitted" &&
  evidenceReferenceEquals(submitted.report.reviewManifest, event.reviewManifest)

const invalidConstructedCandidate = (
  position: JournalPosition,
  event: ConstructedCandidateEvent,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const observed = indexes.integrationCandidateGitObservations.get(event.gitObservationAt)
  const submitted =
    observed === undefined ? undefined : indexes.integrationCandidateSubmissions.get(observed.submissionAt)
  const exact =
    isExactConstructedCandidateObservation(observed, event) && isExactConstructedCandidateSubmission(submitted, event)
  indexes.integrationCandidatesConstructed.set(position, event)
  return exact ? undefined : `constructed candidate has no exact Git observation at ${event.gitObservationAt}`
}

const invalidTargetVerificationIntent = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetVerificationIntended" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const correlation = event.correlation
  const constructed = indexes.integrationCandidatesConstructed.get(correlation.candidateConstructedAt)
  const existing = indexes.targetVerificationIntents.get(correlation.requestId)
  indexes.targetVerificationIntents.set(correlation.requestId, event)
  const exact =
    constructed !== undefined &&
    correlation.candidateConstructedAt < record.position &&
    constructed.candidateCommit === correlation.candidateCommit &&
    integrationCandidateCorrelationEquals(constructed.correlation, correlation.candidateCorrelation) &&
    correlation.requestId === targetVerificationRequestIdForCandidate(constructed.correlation.candidateId) &&
    (existing === undefined || targetVerificationCorrelationEquals(existing.correlation, correlation))
  return exact
    ? undefined
    : `target verification intent has no exact constructed candidate at ${correlation.candidateConstructedAt}`
}

const terminalExpectedCorrelation = (
  event: Extract<
    WorkflowJournalEvent,
    { readonly _tag: "TargetVerificationCorrelationContradicted" | "TargetVerificationEvidenceSealed" }
  >
) => (event._tag === "TargetVerificationEvidenceSealed" ? event.correlation : event.expected)

const isGenuineVerificationContradiction = (
  event: Extract<
    WorkflowJournalEvent,
    { readonly _tag: "TargetVerificationCorrelationContradicted" | "TargetVerificationEvidenceSealed" }
  >
): boolean =>
  event._tag !== "TargetVerificationCorrelationContradicted" ||
  !targetVerificationCorrelationEquals(event.expected, event.received)

const invalidTargetVerificationTerminal = (
  record: JournalRecord,
  event: Extract<
    WorkflowJournalEvent,
    { readonly _tag: "TargetVerificationCorrelationContradicted" | "TargetVerificationEvidenceSealed" }
  >,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const expected = terminalExpectedCorrelation(event)
  const intent = indexes.targetVerificationIntents.get(expected.requestId)
  const alreadyTerminal = indexes.targetVerificationTerminals.has(expected.requestId)
  indexes.targetVerificationTerminals.add(expected.requestId)
  const exactIntent = intent !== undefined && targetVerificationCorrelationEquals(intent.correlation, expected)
  const valid = exactIntent && !alreadyTerminal && isGenuineVerificationContradiction(event)
  if (valid && event._tag === "TargetVerificationEvidenceSealed" && event.terminal === "Passed") {
    rememberPassedTargetVerification(indexes.targetPromotionHistory, record, event)
  }
  return valid
    ? undefined
    : `target verification terminal has no one exact earlier intent for request ${expected.requestId}`
}

const invalidCorrectionLimitReachedCandidate = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateCorrectionLimitReached" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const intent = indexes.integrationCandidateIntents.get(candidateKey(event.correlation))
  const observed = indexes.integrationCandidateGitObservations.get(event.invalidObservationAt)
  const invalidObservationCount = [...indexes.integrationCandidateGitObservations.values()].filter(
    (candidate) =>
      integrationCandidateCorrelationEquals(candidate.correlation, event.correlation) &&
      !integrationCandidateHasExactParents(candidate.observation, event.correlation)
  ).length
  const causalCorrectionCount = Math.max(0, invalidObservationCount - 1)
  return observed !== undefined &&
    integrationCandidateCorrelationEquals(observed.correlation, event.correlation) &&
    !integrationCandidateHasExactParents(observed.observation, event.correlation) &&
    event.correctionLimit === intent?.correctionLimit &&
    event.correctionCount === event.correctionLimit &&
    event.correctionCount === causalCorrectionCount
    ? undefined
    : `non-convergent candidate has no limit-reaching invalid Git observation at ${event.invalidObservationAt}`
}

// eslint-disable-next-line complexity -- The terminal is valid only when every persisted intent, correlation, report, count, and limit link agrees.
const invalidContinuationLimitReachedCandidate = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateContinuationLimitReached" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const intent = indexes.integrationCandidateIntents.get(candidateKey(event.correlation))
  const lastReport = indexes.integrationCandidateSubmissions.get(event.lastReportAt)
  const continuationCount = [...indexes.integrationCandidateSubmissions.values()].filter(
    (candidate) =>
      integrationCandidateCorrelationEquals(candidate.expectedCorrelation, event.correlation) &&
      integrationCandidateCorrelationEquals(candidate.report.correlation, event.correlation) &&
      candidate.report._tag !== "Submitted"
  ).length
  return lastReport !== undefined &&
    lastReport.report._tag !== "Submitted" &&
    integrationCandidateCorrelationEquals(lastReport.expectedCorrelation, event.correlation) &&
    integrationCandidateCorrelationEquals(lastReport.report.correlation, event.correlation) &&
    event.continuationLimit === intent?.continuationLimit &&
    event.continuationCount === event.continuationLimit &&
    event.continuationCount === continuationCount
    ? undefined
    : `candidate continuation limit has no exact final non-submitting report at ${event.lastReportAt}`
}

const invalidTargetVerificationHistory = (
  record: JournalRecord,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const event = record.event
  if (event._tag === "TargetVerificationIntended") {
    return invalidTargetVerificationIntent(record, event, indexes)
  }
  return event._tag === "TargetVerificationEvidenceSealed" || event._tag === "TargetVerificationCorrelationContradicted"
    ? invalidTargetVerificationTerminal(record, event, indexes)
    : invalidTargetPromotionHistory(record, indexes.targetPromotionHistory, indexes.integrationCandidatesConstructed)
}

const invalidCandidateHistory = (record: JournalRecord, indexes: IntegrationHistoryIndexes): string | undefined => {
  const event = record.event
  if (event._tag === "IntegrationCandidateConstructionIntended") {
    return invalidCandidateIntent(event, indexes)
  }
  if (event._tag === "IntegrationCandidateAgentReported") {
    return invalidCandidateAgentReport(record, event, indexes)
  }
  if (event._tag === "IntegrationCandidateGitObserved" || event._tag === "IntegrationCandidateGitValidationFailed") {
    return invalidCandidateGitResult(record, event, indexes)
  }
  if (event._tag === "IntegrationCandidateConstructed") {
    return invalidConstructedCandidate(record.position, event, indexes)
  }
  if (event._tag === "IntegrationCandidateCorrectionLimitReached") {
    return invalidCorrectionLimitReachedCandidate(event, indexes)
  }
  if (event._tag === "IntegrationCandidateContinuationLimitReached") {
    return invalidContinuationLimitReachedCandidate(event, indexes)
  }
  return invalidTargetVerificationHistory(record, indexes)
}

/** Validates causal integration links while advancing the fold's private index. */
export const invalidIntegrationHistoryEvent = (
  record: JournalRecord,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const event = record.event
  if (event._tag === "IntegrationResponsibilityBegan") {
    const issue = invalidResponsibilityBeginning(event, indexes)
    indexes.integrationResponsibilitiesBegan.set(record.position, event)
    return issue
  }
  if (event._tag === "IntegrationStarted") {
    const issue = invalidIntegrationStart(event, record.position, indexes)
    indexes.integrationStarted.set(record.position, event)
    return issue
  }
  return invalidCandidateHistory(record, indexes)
}

// eslint-disable-next-line complexity -- Each closed candidate event variant carries its run binding in a deliberately distinct shape.
const invalidCandidateRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (
    event._tag === "TargetPromotionIntended" ||
    event._tag === "TargetPromotionAttemptIntended" ||
    event._tag === "TargetPromotionObservedSuccess" ||
    event._tag === "TargetPromotionStale" ||
    event._tag === "TargetPromotionNonConvergence"
  ) {
    return event.correlation.candidateCorrelation.runId === runId &&
      event.correlation.verificationCorrelation.candidateCorrelation.runId === runId
      ? undefined
      : `target promotion binds run ${event.correlation.candidateCorrelation.runId}`
  }
  if (event._tag === "TargetVerificationCorrelationContradicted") {
    return event.expected.candidateCorrelation.runId === runId
      ? undefined
      : "target verification contradiction expectation binds a foreign run"
  }
  if (event._tag === "TargetVerificationIntended" || event._tag === "TargetVerificationEvidenceSealed") {
    return event.correlation.candidateCorrelation.runId === runId
      ? undefined
      : `target verification binds run ${event.correlation.candidateCorrelation.runId}`
  }
  if (event._tag === "IntegrationCandidateConstructionIntended") {
    return event.plannedAttempt.runId === runId && event.correlation.runId === runId
      ? undefined
      : `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
  }
  if (event._tag === "IntegrationCandidateAgentReported") {
    return event.expectedCorrelation.runId === runId
      ? undefined
      : `candidate report expectation binds run ${event.expectedCorrelation.runId}`
  }
  if (candidateCorrelatedEventTags.has(event._tag) && "correlation" in event)
    return event.correlation.runId === runId ? undefined : `candidate event binds run ${event.correlation.runId}`
  return undefined
}

export const invalidIntegrationRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted") {
    return event.plannedAttempt.runId === runId
      ? undefined
      : `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
  }
  return invalidCandidateRunBinding(event, runId)
}

export const validateIntegrationHistoryRecord = (
  record: JournalRecord,
  runId: RunId,
  indexes: IntegrationHistoryIndexes,
  recordIdentityIssue: (detail: string) => void,
  recordSemanticIssue: (detail: string) => void
): void => {
  const bindingIssue = invalidIntegrationRunBinding(record.event, runId)
  if (bindingIssue !== undefined) recordIdentityIssue(bindingIssue)
  const historyIssue = invalidIntegrationHistoryEvent(record, indexes)
  if (historyIssue !== undefined) recordSemanticIssue(historyIssue)
}
