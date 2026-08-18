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

/** Exact facts that identify one outer-integrator session and its durable replay identity. */
export const IntegratorSessionCorrelation = Schema.Struct({
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
export type IntegratorSessionCorrelation = typeof IntegratorSessionCorrelation.Type

/**
 * Compatibility name for the session-only correlation used by the original
 * initial-run journal vocabulary. New retry/recovery records use the explicit
 * IntegratorRunCorrelation below; a session correlation remains valid only
 * where the journal event's domain is the fixed session itself.
 */
export const IntegratorCorrelation = IntegratorSessionCorrelation
export type IntegratorCorrelation = IntegratorSessionCorrelation

/** One-based ordinal identifying one opaque outer-Integrator run within a session. */
export const IntegratorRunOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("IntegratorRunOrdinal"))
export type IntegratorRunOrdinal = typeof IntegratorRunOrdinal.Type

/** Exact identity of one outer-Integrator run, including its owning session. */
export const IntegratorRunCorrelation = Schema.Struct({
  ordinal: IntegratorRunOrdinal,
  session: IntegratorSessionCorrelation
})
export type IntegratorRunCorrelation = typeof IntegratorRunCorrelation.Type

const integratorSessionCorrelationEquivalence = Schema.toEquivalence(IntegratorSessionCorrelation)
const integratorRunCorrelationEquivalence = Schema.toEquivalence(IntegratorRunCorrelation)

export const integratorSessionCorrelationsEqual = integratorSessionCorrelationEquivalence
export const integratorRunCorrelationsEqual = integratorRunCorrelationEquivalence

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

/** Protocol result whose candidate, rejection, or conclusive detail is bound to one exact run. */
export const IntegratorRunProtocolResult = Schema.TaggedUnion({
  CandidateRejected: {
    candidateText: IntegratorCandidateText,
    observation: IntegratorGitObservation,
    run: IntegratorRunCorrelation
  },
  NotPrepared: { detail: IntegratorNotPreparedDetail, run: IntegratorRunCorrelation },
  PreparedCandidate: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    observation: Schema.Struct({ directParents: Schema.Tuple([GitCommitSha, GitCommitSha]) }),
    run: IntegratorRunCorrelation
  }
})
export type IntegratorRunProtocolResult = typeof IntegratorRunProtocolResult.Type

/**
 * The exact candidate explicitly reported by one outer Integrator session and
 * subsequently qualified by Git as the ordered merge commit [H, C].
 */
export const IntegratorQualifiedCandidate = Schema.Struct({
  candidateCommit: GitCommitSha,
  candidateText: IntegratorCandidateText,
  correlation: IntegratorCorrelation,
  directParents: Schema.Tuple([GitCommitSha, GitCommitSha]),
  qualifiedAt: JournalPosition
}).check(
  Schema.makeFilter((candidate) =>
    candidate.directParents[0] === candidate.correlation.expectedTargetHead &&
    candidate.directParents[1] === candidate.correlation.acceptedResult.commit &&
    candidate.qualifiedAt > candidate.correlation.targetLineageObservedAt
      ? undefined
      : "qualified Integrator candidate must bind the durable Git observation to exact ordered parents [H, C]"
  )
)
export type IntegratorQualifiedCandidate = typeof IntegratorQualifiedCandidate.Type

/**
 * Promotion evidence qualified for one exact outer-Integrator run. The legacy
 * IntegratorQualifiedCandidate remains valid for the original session-only
 * vocabulary; this value is required once a session has multiple runs.
 */
export const IntegratorRunQualifiedCandidate = Schema.Struct({
  candidateCommit: GitCommitSha,
  candidateText: IntegratorCandidateText,
  directParents: Schema.Tuple([GitCommitSha, GitCommitSha]),
  qualifiedAt: JournalPosition,
  run: IntegratorRunCorrelation
}).check(
  Schema.makeFilter((candidate) =>
    candidate.directParents[0] === candidate.run.session.expectedTargetHead &&
    candidate.directParents[1] === candidate.run.session.acceptedResult.commit &&
    candidate.qualifiedAt > candidate.run.session.targetLineageObservedAt
      ? undefined
      : "qualified Integrator candidate must bind the durable Git observation to exact ordered parents [H, C] and run"
  )
)
export type IntegratorRunQualifiedCandidate = typeof IntegratorRunQualifiedCandidate.Type

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
    observation: Schema.Struct({ directParents: Schema.Tuple([GitCommitSha, GitCommitSha]) }),
    qualifiedAt: JournalPosition
  },
  NotPrepared: { correlation: IntegratorCorrelation, detail: IntegratorNotPreparedDetail },
  PreparedAwaitingGit: { candidateText: IntegratorCandidateText, correlation: IntegratorCorrelation },
  SessionUnfinished: { correlation: IntegratorCorrelation }
})
export type IntegratorState = typeof IntegratorState.Type

/** Closed reconstruction states for one explicitly identified Integrator run. */
export const IntegratorRunState = Schema.TaggedUnion({
  Absent: { run: IntegratorRunCorrelation },
  CandidateRejected: {
    candidateText: IntegratorCandidateText,
    observation: IntegratorGitObservation,
    run: IntegratorRunCorrelation
  },
  Contradiction: { detail: Schema.String },
  GitQualifiedPrepared: {
    candidateCommit: GitCommitSha,
    candidateText: IntegratorCandidateText,
    observation: Schema.Struct({ directParents: Schema.Tuple([GitCommitSha, GitCommitSha]) }),
    qualifiedAt: JournalPosition,
    run: IntegratorRunCorrelation
  },
  NotPrepared: { detail: IntegratorNotPreparedDetail, run: IntegratorRunCorrelation },
  PreparedAwaitingGit: { candidateText: IntegratorCandidateText, run: IntegratorRunCorrelation },
  RunUnfinished: { run: IntegratorRunCorrelation }
})
export type IntegratorRunState = typeof IntegratorRunState.Type

/**
 * Materializes the promotion-eligible value proved by reconstructed Integrator
 * history. Its Journal position lets promotion validation prove that the Git
 * qualification occurred before the promotion intent.
 */
export const integratorQualifiedCandidateFromState = (
  state: Extract<IntegratorState, { readonly _tag: "GitQualifiedPrepared" }>
): IntegratorQualifiedCandidate =>
  IntegratorQualifiedCandidate.make({
    candidateCommit: state.candidateCommit,
    candidateText: state.candidateText,
    correlation: state.correlation,
    directParents: state.observation.directParents,
    qualifiedAt: state.qualifiedAt
  })

/** Durable intent proving that one exact session/resource was fixed before any opaque call. */
export const IntegratorSessionFixedEvent = Schema.TaggedStruct("IntegratorSessionFixed", {
  correlation: IntegratorCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable intent written before each opaque call for one exact run ordinal. */
export const IntegratorRunStartedEvent = Schema.TaggedStruct("IntegratorRunStarted", {
  run: IntegratorRunCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable outer result; replay must reuse this fact and never call the Integrator again. */
export const IntegratorResultRecordedEvent = Schema.TaggedStruct("IntegratorResultRecorded", {
  result: IntegratorResult,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable outer result bound to the exact run that crossed the provider boundary. */
export const IntegratorRunResultRecordedEvent = Schema.TaggedStruct("IntegratorRunResultRecorded", {
  result: IntegratorResult,
  run: IntegratorRunCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable intent proving that Git was about to read the explicitly reported candidate text. */
export const IntegratorCandidateGitReadIntendedEvent = Schema.TaggedStruct("IntegratorCandidateGitReadIntended", {
  candidateText: IntegratorCandidateText,
  correlation: IntegratorCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable intent proving Git was about to read a candidate for one exact run. */
export const IntegratorRunCandidateGitReadIntendedEvent = Schema.TaggedStruct("IntegratorRunCandidateGitReadIntended", {
  candidateText: IntegratorCandidateText,
  run: IntegratorRunCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable Git observation used to make candidate qualification replayable without rerunning the Integrator. */
export const IntegratorCandidateGitObservedEvent = Schema.TaggedStruct("IntegratorCandidateGitObserved", {
  candidateText: IntegratorCandidateText,
  correlation: IntegratorCorrelation,
  observation: IntegratorGitObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable Git observation bound to the exact run and explicitly reported candidate. */
export const IntegratorRunCandidateGitObservedEvent = Schema.TaggedStruct("IntegratorRunCandidateGitObserved", {
  candidateText: IntegratorCandidateText,
  observation: IntegratorGitObservation,
  run: IntegratorRunCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const IntegratorJournalEvent = Schema.Union([
  IntegratorSessionFixedEvent,
  IntegratorRunStartedEvent,
  IntegratorResultRecordedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorCandidateGitObservedEvent,
  IntegratorRunCandidateGitObservedEvent
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
