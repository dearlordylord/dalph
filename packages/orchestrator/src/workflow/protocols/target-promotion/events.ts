import { Context, type Effect, Schema } from "effect"
import { GitCommitSha, IntegrationTarget } from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  type ConstructedIntegrationCandidateOccurrence,
  IntegrationCandidateCorrelation,
  integrationCandidateCorrelationEquals,
  type IntegrationCandidateId
} from "../integration-candidate-construction/events.js"
import { EvidenceReference } from "../target-verification/evidence-store.js"
import { TargetVerificationCorrelation, targetVerificationCorrelationEquals } from "../target-verification/events.js"

/** Identifies one immutable compare-and-set request for one constructed candidate. */
export const TargetPromotionRequestId = Schema.NonEmptyString.pipe(Schema.brand("TargetPromotionRequestId"))
export type TargetPromotionRequestId = typeof TargetPromotionRequestId.Type

/** Positive ordinal of one compare-and-set request for this exact promotion. */
export const TargetPromotionAttemptOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("TargetPromotionAttemptOrdinal")
)
export type TargetPromotionAttemptOrdinal = typeof TargetPromotionAttemptOrdinal.Type

/** Runtime value of the fixed issue-60 automatic compare-and-set limit. */
export const targetPromotionAttemptLimit = 3 as const // eslint-disable-line no-magic-numbers

/** The accepted issue-60 automatic compare-and-set limit. */
export const TargetPromotionAttemptLimit = Schema.Literal(targetPromotionAttemptLimit)
export type TargetPromotionAttemptLimit = typeof TargetPromotionAttemptLimit.Type

/** The exact sealed passing verification identity carried into promotion. */
export const TargetPromotionVerification = Schema.Struct({
  correlation: TargetVerificationCorrelation,
  manifest: EvidenceReference
})
export type TargetPromotionVerification = typeof TargetPromotionVerification.Type

/** Full immutable identity shared by every promotion request and outcome. */
export const TargetPromotionCorrelation = Schema.Struct({
  candidateCommit: GitCommitSha,
  candidateConstructedAt: JournalPosition,
  candidateCorrelation: IntegrationCandidateCorrelation,
  expectedTargetHead: GitCommitSha,
  integrationTarget: IntegrationTarget,
  requestId: TargetPromotionRequestId,
  verificationCorrelation: TargetVerificationCorrelation,
  verificationManifest: EvidenceReference
}).check(
  Schema.makeFilter((correlation) => {
    const candidate = correlation.candidateCorrelation
    const verification = correlation.verificationCorrelation
    const isConsistent =
      correlation.candidateCommit === verification.candidateCommit &&
      correlation.candidateConstructedAt === verification.candidateConstructedAt &&
      correlation.expectedTargetHead === candidate.expectedTargetHead &&
      correlation.integrationTarget.repository === candidate.integrationTarget.repository &&
      correlation.integrationTarget.ref === candidate.integrationTarget.ref &&
      correlation.requestId === `target-promotion:${candidate.candidateId}` &&
      integrationCandidateCorrelationEquals(candidate, verification.candidateCorrelation)
    return isConsistent ? undefined : "promotion correlation must describe one exact candidate and verification"
  })
)
export type TargetPromotionCorrelation = typeof TargetPromotionCorrelation.Type

/** The one Git request derived from an exact constructed candidate and Passed manifest. */
export const TargetPromotionRequest = TargetPromotionCorrelation
export type TargetPromotionRequest = TargetPromotionCorrelation

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
export class TargetPromotionGitReadFailure extends Schema.TaggedErrorClass<TargetPromotionGitReadFailure>()(
  "TargetPromotionGitReadFailure",
  { candidateCommit: GitCommitSha, detail: Schema.String, target: IntegrationTarget }
) {}

/** Git could not return an unambiguous compare-and-set response. */
export class TargetPromotionCompareAndSetFailure extends Schema.TaggedErrorClass<TargetPromotionCompareAndSetFailure>()(
  "TargetPromotionCompareAndSetFailure",
  { candidateCommit: GitCommitSha, detail: Schema.String, expectedHead: GitCommitSha, target: IntegrationTarget }
) {}

/** Provider-neutral target Git boundary used by the protocol. */
export interface TargetPromotionGitService {
  readonly compareAndSet: (
    request: TargetPromotionRequest
  ) => Effect.Effect<TargetPromotionCompareAndSetResult, TargetPromotionCompareAndSetFailure>
  readonly read: (
    request: TargetPromotionRequest
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

/** Closed target-promotion vocabulary added to the workflow journal registry by integration wiring. */
export const TargetPromotionJournalEvent = Schema.Union([
  TargetPromotionIntendedEvent,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionStaleEvent,
  TargetPromotionNonConvergenceEvent
])
export type TargetPromotionJournalEvent = typeof TargetPromotionJournalEvent.Type

/** Compares all request identity, candidate, target, and sealed-evidence fields. */
export const targetPromotionCorrelationEquals = (
  left: TargetPromotionCorrelation,
  right: TargetPromotionCorrelation
): boolean =>
  [
    left.requestId === right.requestId,
    left.candidateCommit === right.candidateCommit,
    left.candidateConstructedAt === right.candidateConstructedAt,
    left.expectedTargetHead === right.expectedTargetHead,
    left.integrationTarget.repository === right.integrationTarget.repository,
    left.integrationTarget.ref === right.integrationTarget.ref,
    left.verificationManifest.digest === right.verificationManifest.digest,
    left.verificationManifest.byteLength === right.verificationManifest.byteLength,
    integrationCandidateCorrelationEquals(left.candidateCorrelation, right.candidateCorrelation),
    targetVerificationCorrelationEquals(left.verificationCorrelation, right.verificationCorrelation)
  ].every(Boolean)

/** Derives the one stable promotion identity from the candidate's identity. */
export const targetPromotionRequestIdForCandidate = (candidateId: IntegrationCandidateId): TargetPromotionRequestId =>
  TargetPromotionRequestId.make(`target-promotion:${candidateId}`)

/** Constructs the complete immutable request binding from candidate and sealed verification facts. */
export const targetPromotionRequestFor = (
  candidate: ConstructedIntegrationCandidateOccurrence,
  verification: TargetPromotionVerification
): TargetPromotionRequest =>
  TargetPromotionRequest.make({
    candidateCommit: candidate.candidateCommit,
    candidateConstructedAt: candidate.constructedAt,
    candidateCorrelation: candidate.correlation,
    expectedTargetHead: candidate.correlation.expectedTargetHead,
    integrationTarget: candidate.correlation.integrationTarget,
    requestId: targetPromotionRequestIdForCandidate(candidate.correlation.candidateId),
    verificationCorrelation: verification.correlation,
    verificationManifest: verification.manifest
  })
