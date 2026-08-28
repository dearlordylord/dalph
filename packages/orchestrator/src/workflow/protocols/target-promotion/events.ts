import { Context, type Effect, Schema } from "effect"
import { GitCommitSha, IntegrationTarget } from "@dalph/contracts"
import type { CoordinatorOwnershipError } from "../../../authorities/coordinator-ownership/ownership.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegratorRunQualifiedCandidate } from "../integrator/events.js"

/** Identifies one immutable compare-and-set request for one qualified Integrator candidate. */
export const TargetPromotionRequestId = Schema.NonEmptyString.pipe(Schema.brand("TargetPromotionRequestId"))
export type TargetPromotionRequestId = typeof TargetPromotionRequestId.Type

/** Positive ordinal of one compare-and-set request for this exact promotion. */
export const TargetPromotionAttemptOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("TargetPromotionAttemptOrdinal")
)
export type TargetPromotionAttemptOrdinal = typeof TargetPromotionAttemptOrdinal.Type

/** Runtime value of the bounded compare-and-set limit. */
export const targetPromotionAttemptLimit = 3 as const // eslint-disable-line no-magic-numbers

/** The accepted automatic compare-and-set limit. */
export const TargetPromotionAttemptLimit = Schema.Literal(targetPromotionAttemptLimit)
export type TargetPromotionAttemptLimit = typeof TargetPromotionAttemptLimit.Type

/** Stable identity for one Integrator-qualified candidate promotion. */
export const targetPromotionRequestIdForCandidate = (
  candidate: IntegratorRunQualifiedCandidate
): TargetPromotionRequestId =>
  TargetPromotionRequestId.make(
    `target-promotion:${candidate.run.session.sessionId}:${candidate.run.ordinal}:${candidate.candidateCommit}`
  )

/**
 * The exact outer promotion identity. The nested qualified candidate binds the
 * Integrator run, fixed target head H, accepted result C, reported text,
 * canonical commit M, target, and ordered parents [H, C].
 */
export const TargetPromotionCorrelation = Schema.Struct({
  qualifiedCandidate: IntegratorRunQualifiedCandidate,
  requestId: TargetPromotionRequestId
}).check(
  Schema.makeFilter((correlation) =>
    correlation.requestId === targetPromotionRequestIdForCandidate(correlation.qualifiedCandidate)
      ? undefined
      : "promotion request identity must derive from the exact Integrator run and canonical candidate"
  )
)
export type TargetPromotionCorrelation = typeof TargetPromotionCorrelation.Type

/** Constructs the exact outer promotion identity from a Git-qualified Integrator result. */
export const targetPromotionCorrelationFor = (candidate: IntegratorRunQualifiedCandidate): TargetPromotionCorrelation =>
  TargetPromotionCorrelation.make({
    qualifiedCandidate: candidate,
    requestId: targetPromotionRequestIdForCandidate(candidate)
  })

/** The full durable promotion request P; it is the exact correlation carried by every event. */
export const TargetPromotionRequest = TargetPromotionCorrelation
export type TargetPromotionRequest = TargetPromotionCorrelation

/** Exact Git fields projected from the immutable outer request at the mutation boundary. */
export const TargetPromotionGitRequest = Schema.Struct({
  candidateCommit: GitCommitSha,
  expectedTargetHead: GitCommitSha,
  integrationTarget: IntegrationTarget
})
export type TargetPromotionGitRequest = typeof TargetPromotionGitRequest.Type

export const targetPromotionGitRequestFor = (correlation: TargetPromotionCorrelation): TargetPromotionGitRequest =>
  TargetPromotionGitRequest.make({
    candidateCommit: correlation.qualifiedCandidate.candidateCommit,
    expectedTargetHead: correlation.qualifiedCandidate.run.session.expectedTargetHead,
    integrationTarget: correlation.qualifiedCandidate.run.session.integrationTarget
  })

/** A retry is either the first request or follows one recorded exact-H read. */
export const TargetPromotionAttemptReason = Schema.TaggedUnion({
  Initial: { observedHeadSha: GitCommitSha },
  ReconciledExpectedHead: { observedHeadSha: GitCommitSha, previousAttemptOrdinal: TargetPromotionAttemptOrdinal }
})
export type TargetPromotionAttemptReason = typeof TargetPromotionAttemptReason.Type

/** Git's complete read after an ambiguous compare-and-set response. */
export const TargetPromotionGitReadObservation = Schema.TaggedUnion({
  CandidateAncestor: { currentHeadSha: GitCommitSha },
  CandidateCurrent: { currentHeadSha: GitCommitSha },
  CandidateNotInAncestry: { currentHeadSha: GitCommitSha }
})
export type TargetPromotionGitReadObservation = typeof TargetPromotionGitReadObservation.Type

/** Git's result when replacing H with M under compare-and-set. */
export const TargetPromotionCompareAndSetResult = Schema.TaggedUnion({
  Applied: { newHeadSha: GitCommitSha },
  RejectedExpectedHead: { observedHeadSha: GitCommitSha }
})
export type TargetPromotionCompareAndSetResult = typeof TargetPromotionCompareAndSetResult.Type

/** Git returned a complete current head and candidate ancestry fact. */
export class TargetPromotionGitReadFailure extends Schema.TaggedError<TargetPromotionGitReadFailure>()(
  "TargetPromotionGitReadFailure",
  { candidateCommit: GitCommitSha, detail: Schema.String, target: IntegrationTarget }
) {}

/** Git could not return an unambiguous compare-and-set response. */
export class TargetPromotionCompareAndSetFailure extends Schema.TaggedError<TargetPromotionCompareAndSetFailure>()(
  "TargetPromotionCompareAndSetFailure",
  { candidateCommit: GitCommitSha, detail: Schema.String, expectedHead: GitCommitSha, target: IntegrationTarget }
) {}

/** Provider-neutral target Git boundary used by the bounded promotion protocol. */
export interface TargetPromotionGitService {
  readonly compareAndSet: (
    request: TargetPromotionGitRequest
  ) => Effect.Effect<
    TargetPromotionCompareAndSetResult,
    TargetPromotionCompareAndSetFailure | CoordinatorOwnershipError
  >
  readonly read: (
    request: TargetPromotionGitRequest
  ) => Effect.Effect<TargetPromotionGitReadObservation, TargetPromotionGitReadFailure>
}

export class TargetPromotionGit extends Context.Service<TargetPromotionGit, TargetPromotionGitService>()(
  "@dalph/TargetPromotionGit"
) {}

/** Success proof records whether Git showed M current or later in its ancestry. */
export const TargetPromotionSuccessObservation = Schema.TaggedUnion({
  CompareAndSetApplied: { candidateAncestry: Schema.Literal("Current"), targetHeadSha: GitCommitSha },
  ReconciledCandidateAncestor: { candidateAncestry: Schema.Literal("Ancestor"), targetHeadSha: GitCommitSha },
  ReconciledCandidateCurrent: { candidateAncestry: Schema.Literal("Current"), targetHeadSha: GitCommitSha }
})
export type TargetPromotionSuccessObservation = typeof TargetPromotionSuccessObservation.Type

/** Stale proof distinguishes an atomic H mismatch from a read proving no M ancestry. */
export const TargetPromotionStaleObservation = Schema.TaggedUnion({
  CompareAndSetRejected: { observedHeadSha: GitCommitSha },
  ReconciledCandidateNotInAncestry: { observedHeadSha: GitCommitSha }
})
export type TargetPromotionStaleObservation = typeof TargetPromotionStaleObservation.Type

/** The final read fact retained when three ambiguous attempts cannot converge. */
export const TargetPromotionNonConvergenceObservation = Schema.TaggedUnion({
  ExpectedHeadStillObserved: { observedHeadSha: GitCommitSha },
  TargetReadFailed: { detail: Schema.String }
})
export type TargetPromotionNonConvergenceObservation = typeof TargetPromotionNonConvergenceObservation.Type

/** Identifies whether a terminal read settled before any request or after a numbered request. */
export const TargetPromotionTerminalBasis = Schema.TaggedUnion({
  BeforeFirstAttempt: {},
  AfterAttempt: { attemptOrdinal: TargetPromotionAttemptOrdinal }
})
export type TargetPromotionTerminalBasis = typeof TargetPromotionTerminalBasis.Type

/** Durable promotion intent is appended before the first Git mutation request. */
export const TargetPromotionIntendedEvent = Schema.TaggedStruct("TargetPromotionIntended", {
  correlation: TargetPromotionCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetPromotionIntendedEvent = typeof TargetPromotionIntendedEvent.Type

/** Durable intent for one numbered compare-and-set, written before the request may cross Git. */
export const TargetPromotionAttemptIntendedEvent = Schema.TaggedStruct("TargetPromotionAttemptIntended", {
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  reason: TargetPromotionAttemptReason,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetPromotionAttemptIntendedEvent = typeof TargetPromotionAttemptIntendedEvent.Type

/**
 * Why one read-only reconciliation stopped after its single Git read. This
 * durable fact suppresses reacquisition until current tracker membership and
 * the exact claim authorize the existing retry protocol.
 */
export const TargetPromotionReconciliationDeferral = Schema.TaggedUnion({
  RetryAuthorityRequired: { observedHeadSha: GitCommitSha },
  TargetReadFailed: { detail: Schema.String }
})
export type TargetPromotionReconciliationDeferral = typeof TargetPromotionReconciliationDeferral.Type

/** Durable fail-closed outcome of reconciling one exact ambiguous promotion attempt. */
export const TargetPromotionReconciliationDeferredEvent = Schema.TaggedStruct("TargetPromotionReconciliationDeferred", {
  afterAttemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  deferral: TargetPromotionReconciliationDeferral,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetPromotionReconciliationDeferredEvent = typeof TargetPromotionReconciliationDeferredEvent.Type

/** Durable proof that M was accepted or discovered in the target's exact ancestry. */
export const TargetPromotionObservedSuccessEvent = Schema.TaggedStruct("TargetPromotionObservedSuccess", {
  basis: TargetPromotionTerminalBasis,
  correlation: TargetPromotionCorrelation,
  observation: TargetPromotionSuccessObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetPromotionObservedSuccessEvent = typeof TargetPromotionObservedSuccessEvent.Type

/** Durable proof that the target moved away from the exact expected H. */
export const TargetPromotionStaleEvent = Schema.TaggedStruct("TargetPromotionStale", {
  basis: TargetPromotionTerminalBasis,
  correlation: TargetPromotionCorrelation,
  observation: TargetPromotionStaleObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetPromotionStaleEvent = typeof TargetPromotionStaleEvent.Type

/** Durable terminal disposition after three unresolved compare-and-set attempts. */
export const TargetPromotionNonConvergenceEvent = Schema.TaggedStruct("TargetPromotionNonConvergence", {
  attemptLimit: TargetPromotionAttemptLimit,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  correlation: TargetPromotionCorrelation,
  lastObservation: TargetPromotionNonConvergenceObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetPromotionNonConvergenceEvent = typeof TargetPromotionNonConvergenceEvent.Type

/** Closed target-promotion vocabulary accepted by the workflow journal. */
export const TargetPromotionJournalEvent = Schema.Union([
  TargetPromotionIntendedEvent,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionReconciliationDeferredEvent,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionStaleEvent,
  TargetPromotionNonConvergenceEvent
])
export type TargetPromotionJournalEvent = typeof TargetPromotionJournalEvent.Type

/** Compares the exact nested Integrator-qualified candidate and deterministic request identity. */
const qualifiedCandidateEquivalence = Schema.toEquivalence(IntegratorRunQualifiedCandidate)
export const targetPromotionCorrelationEquals = (
  left: TargetPromotionCorrelation,
  right: TargetPromotionCorrelation
): boolean =>
  left.requestId === right.requestId && qualifiedCandidateEquivalence(left.qualifiedCandidate, right.qualifiedCandidate)

/** Returns the fixed H bound by one promotion correlation. */
export const targetPromotionExpectedHeadOf = (correlation: TargetPromotionCorrelation): GitCommitSha =>
  correlation.qualifiedCandidate.run.session.expectedTargetHead

/** Returns the canonical M bound by one promotion correlation. */
export const targetPromotionCandidateCommitOf = (correlation: TargetPromotionCorrelation): GitCommitSha =>
  correlation.qualifiedCandidate.candidateCommit

/** Returns the run owning one promotion correlation. */
export const targetPromotionRunIdOf = (correlation: TargetPromotionCorrelation) =>
  correlation.qualifiedCandidate.run.session.plannedAttempt.runId

/** Returns the exact planned task attempt bound by one promotion correlation. */
export const targetPromotionPlannedAttemptOf = (correlation: TargetPromotionCorrelation) =>
  correlation.qualifiedCandidate.run.session.plannedAttempt

/** Returns the accepted task result bound by one promotion correlation. */
export const targetPromotionAcceptedResultOf = (correlation: TargetPromotionCorrelation) =>
  correlation.qualifiedCandidate.run.session.acceptedResult
