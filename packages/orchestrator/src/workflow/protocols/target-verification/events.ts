import { Context, type Effect, Schema } from "effect"
import { evidenceReferenceEquals, GitCommitSha, IntegrationTarget } from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  ConstructedIntegrationCandidateOccurrence,
  IntegrationCandidateCorrelation,
  type IntegrationCandidateId,
  integrationCandidateCorrelationEquals
} from "../integration-candidate-construction/events.js"
import { EvidenceReference } from "./evidence-store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Identifies the one initial verification request derived from a candidate. */
export const TargetVerificationRequestId = Schema.NonEmptyString.pipe(Schema.brand("TargetVerificationRequestId"))
export type TargetVerificationRequestId = typeof TargetVerificationRequestId.Type

/** Opaque configuration identity for one repository-selected verification plan. */
export const TargetVerificationPlanId = Schema.NonEmptyString.pipe(Schema.brand("TargetVerificationPlanId"))
export type TargetVerificationPlanId = typeof TargetVerificationPlanId.Type

/** One opaque plan selected for one exact repository/ref target. */
export const TargetVerificationPlan = Schema.Struct({ planId: TargetVerificationPlanId, target: IntegrationTarget })
export type TargetVerificationPlan = typeof TargetVerificationPlan.Type

/** Names one byte object returned by the repository's public verification wrapper. */
export const TargetVerificationArtifactName = Schema.NonEmptyString.pipe(Schema.brand("TargetVerificationArtifactName"))
export type TargetVerificationArtifactName = typeof TargetVerificationArtifactName.Type

/** The candidate and exact journal occurrence that verification is allowed to authorize. */
export const TargetVerificationCandidate = ConstructedIntegrationCandidateOccurrence
export type TargetVerificationCandidate = typeof TargetVerificationCandidate.Type

/** Full immutable binding carried by every verification request and result. */
export const TargetVerificationCorrelation = Schema.Struct({
  candidateCommit: GitCommitSha,
  candidateCorrelation: IntegrationCandidateCorrelation,
  candidateConstructedAt: JournalPosition,
  planId: TargetVerificationPlanId,
  requestId: TargetVerificationRequestId,
  /** Carries the exact review envelope that verification is allowed to follow. */
  reviewManifest: EvidenceReference
})
export type TargetVerificationCorrelation = typeof TargetVerificationCorrelation.Type

/** The public wrapper receives the full correlation; it receives no lock operation. */
export const TargetVerificationRequest = TargetVerificationCorrelation
export type TargetVerificationRequest = TargetVerificationCorrelation

/** One complete or diagnostic object emitted by the verification boundary. */
export const TargetVerificationArtifact = Schema.Struct({
  bytes: Schema.Uint8Array,
  name: TargetVerificationArtifactName
})
export type TargetVerificationArtifact = typeof TargetVerificationArtifact.Type

/** Distinguishes every terminal wrapper result that can be observed by Dalph. */
export const TargetVerificationTerminal = Schema.TaggedUnion({
  Failed: { artifacts: Schema.Array(TargetVerificationArtifact), correlation: TargetVerificationCorrelation },
  Killed: { artifacts: Schema.Array(TargetVerificationArtifact), correlation: TargetVerificationCorrelation },
  Partial: { artifacts: Schema.Array(TargetVerificationArtifact), correlation: TargetVerificationCorrelation },
  Passed: { artifacts: Schema.NonEmptyArray(TargetVerificationArtifact), correlation: TargetVerificationCorrelation },
  TimedOut: { artifacts: Schema.Array(TargetVerificationArtifact), correlation: TargetVerificationCorrelation }
})
export type TargetVerificationTerminal = typeof TargetVerificationTerminal.Type

/** The public wrapper result is deliberately terminal-only; waiting and lock ownership stay inside that wrapper. */
export const TargetVerificationBoundaryReport = TargetVerificationTerminal
export type TargetVerificationBoundaryReport = TargetVerificationTerminal

/** The repository wrapper could not provide a truthful result for this request. */
export class TargetVerificationBoundaryFailure extends Schema.TaggedError<TargetVerificationBoundaryFailure>()(
  "TargetVerificationBoundaryFailure",
  { detail: Schema.String, requestId: TargetVerificationRequestId }
) {}

/** Public verification boundary; Dalph has no separate heavy-lock operation. */
export interface TargetVerificationBoundaryService {
  readonly runOrResume: (
    request: TargetVerificationRequest
  ) => Effect.Effect<TargetVerificationBoundaryReport, TargetVerificationBoundaryFailure>
}

export class TargetVerificationBoundary extends Context.Service<
  TargetVerificationBoundary,
  TargetVerificationBoundaryService
>()("@dalph/TargetVerificationBoundary") {}

/** Terminal labels persisted in a deterministic verification manifest. */
export const TargetVerificationOutcome = Schema.Literals(["Failed", "Killed", "Partial", "Passed", "TimedOut"])
export type TargetVerificationOutcome = typeof TargetVerificationOutcome.Type

/** Dalph records the selected plan before crossing the repository wrapper boundary. */
export const TargetVerificationIntendedEvent = Schema.TaggedStruct("TargetVerificationIntended", {
  correlation: TargetVerificationCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetVerificationIntendedEvent = typeof TargetVerificationIntendedEvent.Type

/** Dalph records a terminal result only after all referenced bytes were reread. */
export const TargetVerificationEvidenceSealedEvent = Schema.TaggedStruct("TargetVerificationEvidenceSealed", {
  correlation: TargetVerificationCorrelation,
  manifest: EvidenceReference,
  terminal: TargetVerificationOutcome,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TargetVerificationEvidenceSealedEvent = typeof TargetVerificationEvidenceSealedEvent.Type

/** A foreign result or a second candidate binding is durably stopped before promotion. */
export const TargetVerificationCorrelationContradictedEvent = Schema.TaggedStruct(
  "TargetVerificationCorrelationContradicted",
  {
    expected: TargetVerificationCorrelation,
    received: TargetVerificationCorrelation,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type TargetVerificationCorrelationContradictedEvent = typeof TargetVerificationCorrelationContradictedEvent.Type

/** Closed target-verification event vocabulary embedded by the workflow journal registry. */
export const TargetVerificationJournalEvent = Schema.Union([
  TargetVerificationIntendedEvent,
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationCorrelationContradictedEvent
])
export type TargetVerificationJournalEvent = typeof TargetVerificationJournalEvent.Type

/** Compares every field, including target, plan, candidate binding, and position. */
export const targetVerificationCorrelationEquals = (
  left: TargetVerificationCorrelation,
  right: TargetVerificationCorrelation
): boolean =>
  left.requestId === right.requestId &&
  left.candidateCommit === right.candidateCommit &&
  left.candidateConstructedAt === right.candidateConstructedAt &&
  left.planId === right.planId &&
  evidenceReferenceEquals(left.reviewManifest, right.reviewManifest) &&
  integrationCandidateCorrelationEquals(left.candidateCorrelation, right.candidateCorrelation)

/** One initial request identity is deterministic and cannot be replaced after ambiguity. */
export const targetVerificationRequestIdForCandidate = (
  candidateId: IntegrationCandidateId
): TargetVerificationRequestId => TargetVerificationRequestId.make(`target-verification:${candidateId}`)

/** Constructs the exact request binding from one durable candidate occurrence and one selected plan. */
export const targetVerificationCorrelationFor = (
  candidate: TargetVerificationCandidate,
  planId: TargetVerificationPlanId
): TargetVerificationCorrelation =>
  TargetVerificationCorrelation.make({
    candidateCommit: candidate.candidateCommit,
    candidateCorrelation: candidate.correlation,
    candidateConstructedAt: candidate.constructedAt,
    planId,
    requestId: targetVerificationRequestIdForCandidate(candidate.correlation.candidateId),
    reviewManifest: candidate.reviewManifest
  })

/** Converts a boundary terminal into its persisted manifest outcome. */
export const targetVerificationOutcomeFor = (terminal: TargetVerificationTerminal): TargetVerificationOutcome =>
  terminal._tag
