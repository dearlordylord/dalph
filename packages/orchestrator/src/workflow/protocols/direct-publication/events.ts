import { GitCommitSha, RemotePublicationTarget, RunId, type RemotePublicationBranchRef } from "@dalph/contracts"
import { Context, type Effect, Schema } from "effect"
import type { CoordinatorOwnershipError } from "../../../authorities/coordinator-ownership/ownership.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import { WorkflowActor } from "../../registry/actor.js"

/** Stable identity for publication of one exact Integrator-qualified candidate. */
export const RemotePublicationRequestId = Schema.NonEmptyString.pipe(Schema.brand("RemotePublicationRequestId"))
export type RemotePublicationRequestId = typeof RemotePublicationRequestId.Type

/** Exact ordinary non-force push refspec derived from the candidate and pinned branch. */
export const RemotePublicationRefspec = Schema.NonEmptyString.pipe(Schema.brand("RemotePublicationRefspec"))
export type RemotePublicationRefspec = typeof RemotePublicationRefspec.Type

export const remotePublicationRefspecFor = (
  candidateCommit: GitCommitSha,
  branch: RemotePublicationBranchRef
): RemotePublicationRefspec => RemotePublicationRefspec.make(`${candidateCommit}:${branch}`)

/** Positive ordinal consumed by one exact candidate publication intent. */
export const RemotePublicationAttemptOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("RemotePublicationAttemptOrdinal")
)
export type RemotePublicationAttemptOrdinal = typeof RemotePublicationAttemptOrdinal.Type

export const remotePublicationAttemptLimit = 3 as const // eslint-disable-line no-magic-numbers -- accepted #384 bound
export const RemotePublicationAttemptLimit = Schema.Literal(remotePublicationAttemptLimit)
export type RemotePublicationAttemptLimit = typeof RemotePublicationAttemptLimit.Type

/** Stable identity for the Run's one preclaim destination admission read. */
export const RemotePublicationAdmissionId = Schema.NonEmptyString.pipe(Schema.brand("RemotePublicationAdmissionId"))
export type RemotePublicationAdmissionId = typeof RemotePublicationAdmissionId.Type

export const remotePublicationAdmissionIdFor = (
  runId: RunId,
  target: RemotePublicationTarget
): RemotePublicationAdmissionId =>
  RemotePublicationAdmissionId.make(`remote-publication-admission:${runId}:${target.endpoint}\u0000${target.branch}`)

export const RemotePublicationAdmissionObservation = Schema.TaggedUnion({
  ExistingBranch: { remoteHead: GitCommitSha },
  TargetMissing: {}
})
export type RemotePublicationAdmissionObservation = typeof RemotePublicationAdmissionObservation.Type

/** Durable intent before Git checks the pinned destination branch. */
export const RemotePublicationAdmissionReadIntendedEvent = Schema.TaggedStruct(
  "RemotePublicationAdmissionReadIntended",
  {
    admissionId: RemotePublicationAdmissionId,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    runId: RunId,
    target: RemotePublicationTarget,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type RemotePublicationAdmissionReadIntendedEvent = typeof RemotePublicationAdmissionReadIntendedEvent.Type

/** Complete receiving-branch fact observed before task claim or provider work. */
export const RemotePublicationAdmissionObservedEvent = Schema.TaggedStruct("RemotePublicationAdmissionObserved", {
  admissionId: RemotePublicationAdmissionId,
  observation: RemotePublicationAdmissionObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  runId: RunId,
  target: RemotePublicationTarget,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type RemotePublicationAdmissionObservedEvent = typeof RemotePublicationAdmissionObservedEvent.Type

const targetKey = (target: RemotePublicationTarget): string => `${target.endpoint}\u0000${target.branch}`

/** Deterministically binds S, H, C, M and the Run-pinned remote destination. */
export const remotePublicationRequestIdFor = (
  candidate: IntegratorRunQualifiedCandidate,
  target: RemotePublicationTarget
): RemotePublicationRequestId =>
  RemotePublicationRequestId.make(
    `direct-publication:${candidate.run.session.sessionId}:${candidate.run.ordinal}:${candidate.candidateCommit}:${targetKey(target)}`
  )

export const RemotePublicationCorrelation = Schema.Struct({
  qualifiedCandidate: IntegratorRunQualifiedCandidate,
  requestId: RemotePublicationRequestId,
  target: RemotePublicationTarget
}).check(
  Schema.makeFilter((correlation) =>
    correlation.requestId === remotePublicationRequestIdFor(correlation.qualifiedCandidate, correlation.target)
      ? undefined
      : "publication request identity must derive from the exact candidate and pinned destination"
  )
)
export type RemotePublicationCorrelation = typeof RemotePublicationCorrelation.Type

export const remotePublicationCorrelationFor = (
  candidate: IntegratorRunQualifiedCandidate,
  target: RemotePublicationTarget
): RemotePublicationCorrelation =>
  RemotePublicationCorrelation.make({
    qualifiedCandidate: candidate,
    requestId: remotePublicationRequestIdFor(candidate, target),
    target
  })

/** The exact mutation request sent to the provider-neutral Git boundary. */
export const RemotePublicationGitRequest = Schema.Struct({
  candidateCommit: GitCommitSha,
  refspec: RemotePublicationRefspec,
  requestId: RemotePublicationRequestId,
  target: RemotePublicationTarget
}).check(
  Schema.makeFilter((request) =>
    request.refspec === remotePublicationRefspecFor(request.candidateCommit, request.target.branch)
      ? undefined
      : "publication refspec must derive from the exact candidate and pinned branch"
  )
)
export type RemotePublicationGitRequest = typeof RemotePublicationGitRequest.Type

export const remotePublicationGitRequestFor = (
  correlation: RemotePublicationCorrelation
): RemotePublicationGitRequest =>
  RemotePublicationGitRequest.make({
    candidateCommit: correlation.qualifiedCandidate.candidateCommit,
    refspec: remotePublicationRefspecFor(correlation.qualifiedCandidate.candidateCommit, correlation.target.branch),
    requestId: correlation.requestId,
    target: correlation.target
  })

/** Complete same-endpoint ancestry evidence used to reconcile a publication. */
export const RemotePublicationGitObservation = Schema.TaggedUnion({
  CandidateAncestor: { remoteHead: GitCommitSha },
  CandidateCurrent: { remoteHead: GitCommitSha },
  CompatibleCompetingHead: { mergeBase: GitCommitSha, remoteHead: GitCommitSha },
  IncompatibleLineage: { remoteHead: GitCommitSha },
  RemoteAncestorOfCandidate: { remoteHead: GitCommitSha },
  TargetMissing: {}
})
export type RemotePublicationGitObservation = typeof RemotePublicationGitObservation.Type

/** Safe, redacted reasons that a receiving server conclusively denied the exact ref update. */
export const RemotePublicationDenialCause = Schema.Literals(["Authentication", "Policy", "Other"])
export type RemotePublicationDenialCause = typeof RemotePublicationDenialCause.Type

/** Correlated per-ref result from one ordinary non-force exact-SHA push. */
export const RemotePublicationPushResult = Schema.TaggedUnion({
  Applied: { remoteHead: GitCommitSha },
  RejectedDefinite: { cause: RemotePublicationDenialCause },
  RejectedNonFastForward: {},
  Throttled: {},
  UpToDate: { remoteHead: GitCommitSha }
})
export type RemotePublicationPushResult = typeof RemotePublicationPushResult.Type

export const RemotePublicationObservationFailureReason = Schema.Literals([
  "AncestryUnavailable",
  "EndpointMappingChanged",
  "ResponseDeadline",
  "SenderStopUnproven",
  "TargetUnreadable"
])
export type RemotePublicationObservationFailureReason = typeof RemotePublicationObservationFailureReason.Type

export class RemotePublicationObservationFailure extends Schema.TaggedError<RemotePublicationObservationFailure>()(
  "RemotePublicationObservationFailure",
  { reason: RemotePublicationObservationFailureReason, target: RemotePublicationTarget }
) {}

export const RemotePublicationPushFailureReason = Schema.Literals([
  "EndpointMappingChanged",
  "ResponseDeadline",
  "SenderStopUnproven",
  "TransportUnavailable"
])
export type RemotePublicationPushFailureReason = typeof RemotePublicationPushFailureReason.Type

export class RemotePublicationPushFailure extends Schema.TaggedError<RemotePublicationPushFailure>()(
  "RemotePublicationPushFailure",
  { reason: RemotePublicationPushFailureReason, target: RemotePublicationTarget }
) {}

/** Git owns remote observation and exact ref update; implementations never expose raw provider diagnostics. */
export interface RemotePublicationGitService {
  readonly admit: (
    target: RemotePublicationTarget
  ) => Effect.Effect<RemotePublicationAdmissionObservation, RemotePublicationObservationFailure>
  readonly observe: (
    request: RemotePublicationGitRequest
  ) => Effect.Effect<RemotePublicationGitObservation, RemotePublicationObservationFailure>
  readonly prepareSenderCustody: (
    request: RemotePublicationGitRequest,
    attemptOrdinal: RemotePublicationAttemptOrdinal
  ) => Effect.Effect<void, RemotePublicationPushFailure>
  readonly reconcileSenderCustody: (
    request: RemotePublicationGitRequest,
    attemptOrdinal: RemotePublicationAttemptOrdinal
  ) => Effect.Effect<void, RemotePublicationPushFailure>
  readonly push: (
    request: RemotePublicationGitRequest,
    attemptOrdinal: RemotePublicationAttemptOrdinal
  ) => Effect.Effect<RemotePublicationPushResult, RemotePublicationPushFailure | CoordinatorOwnershipError>
}

export class RemotePublicationGit extends Context.Service<RemotePublicationGit, RemotePublicationGitService>()(
  "@dalph/RemotePublicationGit"
) {}

/** Durable outer intent fixes the candidate and destination before any numbered push intent. */
export const RemotePublicationIntendedEvent = Schema.TaggedStruct("RemotePublicationIntended", {
  correlation: RemotePublicationCorrelation,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type RemotePublicationIntendedEvent = typeof RemotePublicationIntendedEvent.Type

/** Durable numbered intent is appended before an exact push may cross Git. */
export const RemotePublicationAttemptIntendedEvent = Schema.TaggedStruct("RemotePublicationAttemptIntended", {
  attemptOrdinal: RemotePublicationAttemptOrdinal,
  correlation: RemotePublicationCorrelation,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  refspec: RemotePublicationRefspec,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) =>
    event.refspec ===
    remotePublicationRefspecFor(event.correlation.qualifiedCandidate.candidateCommit, event.correlation.target.branch)
      ? undefined
      : "publication refspec must derive from the exact candidate and pinned branch"
  )
)
export type RemotePublicationAttemptIntendedEvent = typeof RemotePublicationAttemptIntendedEvent.Type

export const RemotePublicationProofBasis = Schema.TaggedUnion({
  PushApplied: { attemptOrdinal: RemotePublicationAttemptOrdinal, remoteHead: GitCommitSha },
  PushUpToDate: { attemptOrdinal: RemotePublicationAttemptOrdinal, remoteHead: GitCommitSha },
  ReconciledCandidateAncestor: { attemptOrdinal: RemotePublicationAttemptOrdinal, remoteHead: GitCommitSha },
  ReconciledCandidateCurrent: { attemptOrdinal: RemotePublicationAttemptOrdinal, remoteHead: GitCommitSha }
})
export type RemotePublicationProofBasis = typeof RemotePublicationProofBasis.Type

/** Durable exact proof that the pinned receiving branch contains M. */
export const RemotePublicationSucceededEvent = Schema.TaggedStruct("RemotePublicationSucceeded", {
  correlation: RemotePublicationCorrelation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  proof: RemotePublicationProofBasis,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type RemotePublicationSucceededEvent = typeof RemotePublicationSucceededEvent.Type

/** A conclusive publication constraint that preserves M and its responsibility for later authorized work. */
export const RemotePublicationRetainedCause = Schema.TaggedUnion({
  AttemptsExhausted: {},
  AuthenticationDenied: {},
  CompatibleCompetingHead: { mergeBase: GitCommitSha, remoteHead: GitCommitSha },
  IncompatibleLineage: { remoteHead: GitCommitSha },
  ObservationUnavailable: { reason: RemotePublicationObservationFailureReason },
  PolicyDenied: {},
  PushCustodyUnproven: {},
  PushEndpointMappingChanged: {},
  RemoteDenied: {},
  TargetMissing: {},
  Throttled: {}
})
export type RemotePublicationRetainedCause = typeof RemotePublicationRetainedCause.Type

/** Durable wait after a conclusive read or push result; no retry follows without a later owner event. */
export const RemotePublicationRetainedEvent = Schema.TaggedStruct("RemotePublicationRetained", {
  cause: RemotePublicationRetainedCause,
  correlation: RemotePublicationCorrelation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type RemotePublicationRetainedEvent = typeof RemotePublicationRetainedEvent.Type

/** Exact qualified candidate paired with its durable receiving-branch proof. */
export const PublishedIntegratorRunQualifiedCandidate = Schema.Struct({
  candidate: IntegratorRunQualifiedCandidate,
  publication: RemotePublicationSucceededEvent
}).check(
  Schema.makeFilter(({ candidate, publication }) =>
    publication.correlation.qualifiedCandidate.candidateCommit === candidate.candidateCommit &&
    remotePublicationCorrelationEquals(
      publication.correlation,
      remotePublicationCorrelationFor(candidate, publication.correlation.target)
    )
      ? undefined
      : "publication proof must belong to the exact qualified candidate"
  )
)
export type PublishedIntegratorRunQualifiedCandidate = typeof PublishedIntegratorRunQualifiedCandidate.Type

export const RemotePublicationJournalEvent = Schema.Union([
  RemotePublicationAdmissionReadIntendedEvent,
  RemotePublicationAdmissionObservedEvent,
  RemotePublicationIntendedEvent,
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationSucceededEvent,
  RemotePublicationRetainedEvent
])
export type RemotePublicationJournalEvent = typeof RemotePublicationJournalEvent.Type

export const remotePublicationRunIdOf = (correlation: RemotePublicationCorrelation): RunId =>
  correlation.qualifiedCandidate.run.session.plannedAttempt.runId

const correlationEquivalence = Schema.toEquivalence(RemotePublicationCorrelation)
export const remotePublicationCorrelationEquals = (
  left: RemotePublicationCorrelation,
  right: RemotePublicationCorrelation
): boolean => correlationEquivalence(left, right)
