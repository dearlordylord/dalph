import { AcceptedResult, GitCommitSha, IntegrationTarget, PlannedTaskAttempt } from "@dalph/contracts"
import { Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Identifies the one opaque outer-integrator session fixed for a responsibility and target head. */
export const IntegratorSessionId = Schema.NonEmptyString.pipe(Schema.brand("IntegratorSessionId"))
export type IntegratorSessionId = typeof IntegratorSessionId.Type

/** Locates the private resource handed to one outer-integrator session. Dalph never reads its head. */
export const IntegratorCandidateResourceLocator = Schema.NonEmptyString.pipe(
  Schema.brand("IntegratorCandidateResourceLocator")
)
export type IntegratorCandidateResourceLocator = typeof IntegratorCandidateResourceLocator.Type

/** Raw provider text naming a candidate; it is not a Git object identity until Git canonicalizes it. */
export const IntegratorCandidateText = Schema.NonEmptyString.pipe(Schema.brand("IntegratorCandidateText"))
export type IntegratorCandidateText = typeof IntegratorCandidateText.Type

/** Retained conclusive detail for later quarantine without exposing provider-private stages. */
export const IntegratorNotPreparedDetail = Schema.NonEmptyString.pipe(Schema.brand("IntegratorNotPreparedDetail"))
export type IntegratorNotPreparedDetail = typeof IntegratorNotPreparedDetail.Type

/** Exact facts that identify one outer-integrator call and its durable replay identity. */
export const IntegratorCorrelation = Schema.Struct({
  acceptedResult: AcceptedResult,
  candidateResource: IntegratorCandidateResourceLocator,
  expectedTargetHead: GitCommitSha,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  queuedAt: JournalPosition,
  sessionId: IntegratorSessionId,
  startedAt: JournalPosition,
  /** Position of the durable TargetLineageObserved fact that supplied H. */
  targetLineageObservedAt: JournalPosition
})
export type IntegratorCorrelation = typeof IntegratorCorrelation.Type

/** Responsibility facts flattened into the correlation without importing admission protocol code. */
export const IntegratorResponsibilityFacts = Schema.Struct({
  acceptedResult: AcceptedResult,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  queuedAt: JournalPosition,
  startedAt: JournalPosition
})
export type IntegratorResponsibilityFacts = typeof IntegratorResponsibilityFacts.Type

/** The only request crossing Dalph's generic boundary: exact responsibility facts plus one fixed session. */
export const IntegratorRequest = Schema.Struct({ correlation: IntegratorCorrelation })
export type IntegratorRequest = typeof IntegratorRequest.Type

/** Git facts used for the final candidate qualification; no resource-head or process-success inference is allowed. */
export const IntegratorGitObservation = Schema.TaggedUnion({
  Commit: { candidateText: IntegratorCandidateText, commit: GitCommitSha, directParents: Schema.Array(GitCommitSha) },
  Missing: { candidateText: IntegratorCandidateText },
  NonCommit: { candidateText: IntegratorCandidateText, objectType: Schema.NonEmptyString }
})
export type IntegratorGitObservation = typeof IntegratorGitObservation.Type
type IntegratorExactCommitObservation = Extract<IntegratorGitObservation, { readonly _tag: "Commit" }> & {
  readonly directParents: readonly [GitCommitSha, GitCommitSha]
}

/** The generic Integrator's public outer result; provider-private stages and retry history remain inside the service. */
export const IntegratorResult = Schema.TaggedUnion({
  NotPrepared: { correlation: IntegratorCorrelation, detail: IntegratorNotPreparedDetail },
  PreparedCandidate: { candidateText: IntegratorCandidateText, correlation: IntegratorCorrelation }
})
export type IntegratorResult = typeof IntegratorResult.Type

/** The protocol's result after it combines the outer result with explicit Git object and parent facts. */
export const IntegratorProtocolResult = Schema.TaggedUnion({
  CandidateRejected: {
    candidateText: IntegratorCandidateText,
    correlation: IntegratorCorrelation,
    observation: IntegratorGitObservation
  },
  NotPrepared: { correlation: IntegratorCorrelation, detail: IntegratorNotPreparedDetail },
  PreparedCandidate: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    correlation: IntegratorCorrelation,
    observation: Schema.Struct({ directParents: Schema.Tuple([GitCommitSha, GitCommitSha]) })
  }
})
export type IntegratorProtocolResult = typeof IntegratorProtocolResult.Type

/** Closed reconstruction states for one responsibility's local Integrator history. */
export const IntegratorState = Schema.TaggedUnion({
  Absent: { responsibility: IntegratorResponsibilityFacts },
  CandidateRejected: {
    candidateText: IntegratorCandidateText,
    correlation: IntegratorCorrelation,
    observation: IntegratorGitObservation
  },
  Contradiction: { detail: Schema.String },
  GitQualifiedPrepared: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    correlation: IntegratorCorrelation,
    observation: Schema.Struct({ directParents: Schema.Tuple([GitCommitSha, GitCommitSha]) })
  },
  NotPrepared: { correlation: IntegratorCorrelation, detail: IntegratorNotPreparedDetail },
  PreparedAwaitingGit: { candidateText: IntegratorCandidateText, correlation: IntegratorCorrelation },
  SessionUnfinished: { correlation: IntegratorCorrelation }
})
export type IntegratorState = typeof IntegratorState.Type

/** Durable intent proving that one exact session/resource was fixed before any opaque call. */
export const IntegratorSessionFixedEvent = Schema.TaggedStruct("IntegratorSessionFixed", {
  correlation: IntegratorCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable outer result; replay must reuse this fact and never call the Integrator again. */
export const IntegratorResultRecordedEvent = Schema.TaggedStruct("IntegratorResultRecorded", {
  result: IntegratorResult,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable intent proving that Git was about to read the explicitly reported candidate text. */
export const IntegratorCandidateGitReadIntendedEvent = Schema.TaggedStruct("IntegratorCandidateGitReadIntended", {
  candidateText: IntegratorCandidateText,
  correlation: IntegratorCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable Git observation used to make candidate qualification replayable without rerunning the Integrator. */
export const IntegratorCandidateGitObservedEvent = Schema.TaggedStruct("IntegratorCandidateGitObserved", {
  candidateText: IntegratorCandidateText,
  correlation: IntegratorCorrelation,
  observation: IntegratorGitObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const IntegratorJournalEvent = Schema.Union([
  IntegratorSessionFixedEvent,
  IntegratorResultRecordedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorCandidateGitObservedEvent
])
export type IntegratorJournalEvent = typeof IntegratorJournalEvent.Type

/** Exact parent order required for a candidate M to be eligible for later CAS promotion. */
const exactParentCount = 2

export const integratorCandidateHasExactParents = (
  observation: IntegratorGitObservation,
  expectedTargetHead: GitCommitSha,
  acceptedResultCommit: GitCommitSha
): observation is IntegratorExactCommitObservation =>
  observation._tag === "Commit" &&
  observation.directParents.length === exactParentCount &&
  observation.directParents[0] === expectedTargetHead &&
  observation.directParents[1] === acceptedResultCommit
