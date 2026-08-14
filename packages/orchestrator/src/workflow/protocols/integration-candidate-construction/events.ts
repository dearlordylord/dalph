import { Schema } from "effect"
import {
  AttemptId,
  EvidenceReference,
  evidenceReferenceEquals,
  GitCommitSha,
  IntegrationTarget,
  PlannedTaskAttempt,
  RunId
} from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Identifies one resumable integration-agent session for one started responsibility. */
export const IntegrationSessionId = Schema.NonEmptyString.pipe(Schema.brand("IntegrationSessionId"))
export type IntegrationSessionId = typeof IntegrationSessionId.Type

/** Identifies the one candidate whose first valid submission fixes its commit. */
export const IntegrationCandidateId = Schema.NonEmptyString.pipe(Schema.brand("IntegrationCandidateId"))
export type IntegrationCandidateId = typeof IntegrationCandidateId.Type

/** Locates the isolated Git resource where one candidate session may edit and commit. */
export const IntegrationCandidateResourceLocator = Schema.NonEmptyString.pipe(
  Schema.brand("IntegrationCandidateResourceLocator")
)
export type IntegrationCandidateResourceLocator = typeof IntegrationCandidateResourceLocator.Type

/** Intrinsically binds an agent report to the exact candidate construction responsibility. */
export const IntegrationCandidateCorrelation = Schema.Struct({
  acceptanceManifest: EvidenceReference,
  acceptedResultCommit: GitCommitSha,
  attemptId: AttemptId,
  candidateId: IntegrationCandidateId,
  candidateResource: IntegrationCandidateResourceLocator,
  expectedTargetHead: GitCommitSha,
  integrationSessionId: IntegrationSessionId,
  integrationTarget: IntegrationTarget,
  runId: RunId
})
export type IntegrationCandidateCorrelation = typeof IntegrationCandidateCorrelation.Type

/** The integration agent's typed report; only Submitted names a candidate commit. */
export const IntegrationCandidateAgentReport = Schema.TaggedUnion({
  Conflict: { correlation: IntegrationCandidateCorrelation },
  ExitedWithoutCandidate: { correlation: IntegrationCandidateCorrelation },
  Submitted: {
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    reviewManifest: EvidenceReference
  },
  Working: { correlation: IntegrationCandidateCorrelation }
})
export type IntegrationCandidateAgentReport = typeof IntegrationCandidateAgentReport.Type

/** Immutable integration-agent proof that one exact candidate passed its review. */
export const IntegrationReviewManifest = Schema.Struct({
  candidateCommit: GitCommitSha,
  correlation: IntegrationCandidateCorrelation,
  formatVersion: Schema.Literal(1),
  outcome: Schema.Literal("Passed"),
  /** The review envelope must name the exact sealed acceptance envelope it follows. */
  predecessor: EvidenceReference
})
export type IntegrationReviewManifest = typeof IntegrationReviewManifest.Type

export const IntegrationCandidateAgentReportOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("IntegrationCandidateAgentReportOrdinal")
)
export type IntegrationCandidateAgentReportOrdinal = typeof IntegrationCandidateAgentReportOrdinal.Type

/** A separately selected positive bound on same-session correction attempts. */
export const CandidateCorrectionLimit = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CandidateCorrectionLimit")
)
export type CandidateCorrectionLimit = typeof CandidateCorrectionLimit.Type

/** A separately selected positive bound on automatic same-session agent continuations. */
export const CandidateContinuationLimit = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CandidateContinuationLimit")
)
export type CandidateContinuationLimit = typeof CandidateContinuationLimit.Type

export const IntegrationCandidateGitValidationAttemptOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("IntegrationCandidateGitValidationAttemptOrdinal")
)
export type IntegrationCandidateGitValidationAttemptOrdinal =
  typeof IntegrationCandidateGitValidationAttemptOrdinal.Type

/** Git's readable, definitive fact about one explicitly submitted object name. */
export const IntegrationCandidateGitObservation = Schema.TaggedUnion({
  Commit: { directParents: Schema.Array(GitCommitSha) },
  Missing: {},
  NonCommit: { objectType: Schema.String }
})
export type IntegrationCandidateGitObservation = typeof IntegrationCandidateGitObservation.Type

const exactIntegrationCandidateParentCount = 2

/** Compares the complete durable binding carried by candidate boundary messages. */
export const integrationCandidateCorrelationEquals = (
  left: IntegrationCandidateCorrelation,
  right: IntegrationCandidateCorrelation
): boolean => JSON.stringify(left) === JSON.stringify(right)

/** True only for a commit whose complete ordered direct-parent list is [H, C]. */
export const integrationCandidateHasExactParents = (
  observation: IntegrationCandidateGitObservation,
  correlation: IntegrationCandidateCorrelation
): boolean =>
  observation._tag === "Commit" &&
  observation.directParents.length === exactIntegrationCandidateParentCount &&
  observation.directParents[0] === correlation.expectedTargetHead &&
  observation.directParents[1] === correlation.acceptedResultCommit

interface CandidateSessionSupersessionFields {
  readonly observedTargetHead: GitCommitSha
  readonly priorCorrelation: IntegrationCandidateCorrelation
  readonly successorCorrelation: IntegrationCandidateCorrelation
}

const candidateSessionSupersessionScopeIssue = (event: CandidateSessionSupersessionFields): string | undefined => {
  if (event.priorCorrelation.runId !== event.successorCorrelation.runId) {
    return "candidate session supersession must stay within one run"
  }
  if (event.priorCorrelation.attemptId !== event.successorCorrelation.attemptId) {
    return "candidate session supersession must stay within one attempt"
  }
  if (event.priorCorrelation.integrationTarget.ref !== event.successorCorrelation.integrationTarget.ref) {
    return "candidate session supersession must stay on one integration ref"
  }
  return event.priorCorrelation.integrationTarget.repository !== event.successorCorrelation.integrationTarget.repository
    ? "candidate session supersession must stay on one integration repository"
    : undefined
}

const candidateSessionSupersessionIdentityIssue = (event: CandidateSessionSupersessionFields): string | undefined => {
  if (event.priorCorrelation.candidateResource === event.successorCorrelation.candidateResource) {
    return "candidate session supersession must use a distinct candidate resource"
  }
  if (event.priorCorrelation.acceptedResultCommit !== event.successorCorrelation.acceptedResultCommit) {
    return "candidate session supersession must preserve the accepted result commit"
  }
  if (
    !evidenceReferenceEquals(event.priorCorrelation.acceptanceManifest, event.successorCorrelation.acceptanceManifest)
  ) {
    return "candidate session supersession must preserve the accepted result evidence"
  }
  if (event.priorCorrelation.candidateId === event.successorCorrelation.candidateId) {
    return "candidate session supersession must use a new candidate identity"
  }
  return event.priorCorrelation.integrationSessionId === event.successorCorrelation.integrationSessionId
    ? "candidate session supersession must use a new session identity"
    : undefined
}

const candidateSessionSupersessionTargetHeadIssue = (event: CandidateSessionSupersessionFields): string | undefined =>
  event.successorCorrelation.expectedTargetHead === event.observedTargetHead
    ? undefined
    : "candidate successor must bind the freshly observed target head"

export const IntegrationCandidateConstructionIntendedEvent = Schema.TaggedStruct(
  "IntegrationCandidateConstructionIntended",
  {
    correlation: IntegrationCandidateCorrelation,
    correctionLimit: CandidateCorrectionLimit,
    continuationLimit: CandidateContinuationLimit,
    plannedAttempt: PlannedTaskAttempt,
    responsibilityBeganAt: JournalPosition,
    startedAt: JournalPosition,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/**
 * Immutable proof that a constructed candidate remains historical evidence
 * after a fresh compatible target read made its session stale. The successor
 * must be intended only after this fact is recorded.
 */
export const IntegrationCandidateSessionSupersededEvent = Schema.TaggedStruct("IntegrationCandidateSessionSuperseded", {
  observedTargetHead: GitCommitSha,
  priorCandidateCommit: GitCommitSha,
  priorCorrelation: IntegrationCandidateCorrelation,
  responsibilityBeganAt: JournalPosition,
  startedAt: JournalPosition,
  successorCorrelation: IntegrationCandidateCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) => {
    const scopeIssue = candidateSessionSupersessionScopeIssue(event)
    if (scopeIssue !== undefined) return scopeIssue
    return candidateSessionSupersessionIdentityIssue(event) ?? candidateSessionSupersessionTargetHeadIssue(event)
  })
)
export type IntegrationCandidateSessionSupersededEvent = typeof IntegrationCandidateSessionSupersededEvent.Type

/** Automatic agent continuation stopped without discarding the isolated candidate work. */
export const IntegrationCandidateContinuationLimitReachedEvent = Schema.TaggedStruct(
  "IntegrationCandidateContinuationLimitReached",
  {
    continuationCount: Schema.Int.check(Schema.isGreaterThan(0)),
    continuationLimit: CandidateContinuationLimit,
    correlation: IntegrationCandidateCorrelation,
    lastReportAt: JournalPosition,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

export const IntegrationCandidateAgentReportedEvent = Schema.TaggedStruct("IntegrationCandidateAgentReported", {
  expectedCorrelation: IntegrationCandidateCorrelation,
  ordinal: IntegrationCandidateAgentReportOrdinal,
  report: IntegrationCandidateAgentReport,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const IntegrationCandidateGitObservedEvent = Schema.TaggedStruct("IntegrationCandidateGitObserved", {
  candidateCommit: GitCommitSha,
  correlation: IntegrationCandidateCorrelation,
  observation: IntegrationCandidateGitObservation,
  submissionAt: JournalPosition,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Git did not return a readable validation fact; the exact submission remains pending. */
export const IntegrationCandidateGitValidationFailedEvent = Schema.TaggedStruct(
  "IntegrationCandidateGitValidationFailed",
  {
    attemptOrdinal: IntegrationCandidateGitValidationAttemptOrdinal,
    candidateCommit: GitCommitSha,
    correlation: IntegrationCandidateCorrelation,
    detail: Schema.String,
    submissionAt: JournalPosition,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** The bounded same-session correction policy ended without fixing a candidate commit. */
export const IntegrationCandidateCorrectionLimitReachedEvent = Schema.TaggedStruct(
  "IntegrationCandidateCorrectionLimitReached",
  {
    correctionCount: Schema.Int.check(Schema.isGreaterThan(0)),
    correctionLimit: CandidateCorrectionLimit,
    correlation: IntegrationCandidateCorrelation,
    invalidObservationAt: JournalPosition,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Git proved the first valid explicit submission has ordered direct parents [H, C]. */
export const IntegrationCandidateConstructedEvent = Schema.TaggedStruct("IntegrationCandidateConstructed", {
  candidateCommit: GitCommitSha,
  correlation: IntegrationCandidateCorrelation,
  gitObservationAt: JournalPosition,
  reviewManifest: EvidenceReference,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** The exact durable candidate occurrence established by one constructed event. */
export const ConstructedIntegrationCandidateOccurrence = Schema.Struct({
  candidateCommit: GitCommitSha,
  constructedAt: JournalPosition,
  correlation: IntegrationCandidateCorrelation,
  reviewManifest: EvidenceReference
})
export type ConstructedIntegrationCandidateOccurrence = typeof ConstructedIntegrationCandidateOccurrence.Type

export const IntegrationCandidateConstructionJournalEvent = Schema.Union([
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateSessionSupersededEvent,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateConstructedEvent
])
export type IntegrationCandidateConstructionJournalEvent = typeof IntegrationCandidateConstructionJournalEvent.Type

/** Returns the complete durable correlation carried by every candidate-construction fact. */
export const integrationCandidateConstructionEventCorrelation = (
  event: IntegrationCandidateConstructionJournalEvent
): IntegrationCandidateCorrelation =>
  event._tag === "IntegrationCandidateAgentReported"
    ? event.expectedCorrelation
    : event._tag === "IntegrationCandidateSessionSuperseded"
      ? event.successorCorrelation
      : event.correlation
