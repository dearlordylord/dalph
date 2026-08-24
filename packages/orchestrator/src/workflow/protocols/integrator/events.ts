import {
  AcceptedResult,
  GitCommitSha,
  IntegrationTarget,
  PlannedTaskAttempt,
  plannedTaskAttemptEquivalence
} from "@dalph/contracts"
import { Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { acceptedResultEquivalence } from "../integration-admission/responsibility.js"

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

/** One-based ordinal identifying one opaque outer-Integrator run within a session. */
export const IntegratorRunOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("IntegratorRunOrdinal"))
export type IntegratorRunOrdinal = typeof IntegratorRunOrdinal.Type

/** The only successor ordinal admitted by one operator-authorized Retry. */
export const integratorRetryRunOrdinal = IntegratorRunOrdinal.make(Number(IntegratorRunOrdinal.make(1)) + 1)

/** Exact identity of one outer-Integrator run, including its owning session. */
export const IntegratorRunCorrelation = Schema.Struct({
  ordinal: IntegratorRunOrdinal,
  session: IntegratorSessionCorrelation
})
export type IntegratorRunCorrelation = typeof IntegratorRunCorrelation.Type

const integratorRunCorrelationEquivalence = Schema.toEquivalence(IntegratorRunCorrelation)

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

/** The only request crossing Dalph's generic boundary: one exact session run. */
export const IntegratorRequest = Schema.Struct({ correlation: IntegratorRunCorrelation })
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
  NotPrepared: { correlation: IntegratorRunCorrelation, detail: IntegratorNotPreparedDetail },
  PreparedCandidate: { candidateText: IntegratorCandidateText, correlation: IntegratorRunCorrelation }
})
export type IntegratorResult = typeof IntegratorResult.Type

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
 * Promotion evidence qualified for one exact outer-Integrator run. The
 * candidate is always bound to the run that crossed the provider boundary.
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

/** Durable intent proving that one exact session/resource was fixed before any opaque call. */
export const IntegratorSessionFixedEvent = Schema.TaggedStruct("IntegratorSessionFixed", {
  correlation: IntegratorSessionCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** One FullRerun may replace a quarantined predecessor with one fresh session. */
export const firstFullRerunSuccessorGeneration = 2
export const IntegratorSuccessorGeneration = Schema.Literal(firstFullRerunSuccessorGeneration)

/** FullRerun successors retain every responsibility fact; only session/resource
 * identities and the fresh lineage observation move forward. */
export const integratorSuccessorResponsibilityMatches = (
  predecessor: IntegratorSessionCorrelation,
  successor: IntegratorSessionCorrelation
): boolean =>
  plannedTaskAttemptEquivalence(predecessor.plannedAttempt, successor.plannedAttempt) &&
  acceptedResultEquivalence(predecessor.acceptedResult, successor.acceptedResult) &&
  predecessor.integrationTarget.repository === successor.integrationTarget.repository &&
  predecessor.integrationTarget.ref === successor.integrationTarget.ref &&
  predecessor.queuedAt === successor.queuedAt &&
  predecessor.startedAt === successor.startedAt

export const integratorSuccessorIdentitiesAreDistinct = (
  predecessor: IntegratorSessionCorrelation,
  successor: IntegratorSessionCorrelation
): boolean =>
  predecessor.sessionId !== successor.sessionId && predecessor.candidateResource !== successor.candidateResource

export const integratorSuccessorChronologyIsValid = (event: {
  readonly predecessor: IntegratorSessionCorrelation
  readonly quarantineAt: JournalPosition
  readonly directionAppliedAt: JournalPosition
  readonly successor: IntegratorSessionCorrelation
}): boolean =>
  event.predecessor.targetLineageObservedAt < event.quarantineAt &&
  event.quarantineAt < event.directionAppliedAt &&
  event.directionAppliedAt < event.successor.targetLineageObservedAt

const successorSessionFixedEventIssue = (event: {
  readonly predecessor: IntegratorSessionCorrelation
  readonly quarantineAt: JournalPosition
  readonly directionAppliedAt: JournalPosition
  readonly successor: IntegratorSessionCorrelation
}): string | undefined => {
  const sameResponsibility = integratorSuccessorResponsibilityMatches(event.predecessor, event.successor)
  return integratorSuccessorIdentitiesAreDistinct(event.predecessor, event.successor) &&
    sameResponsibility &&
    integratorSuccessorChronologyIsValid(event)
    ? undefined
    : "FullRerun successor must preserve responsibility, use distinct identities, and follow Q < D < fresh L"
}

/**
 * Durable relation preserving a quarantined Integrator session while fixing
 * its one fresh-head successor. The predecessor remains cleanup evidence; the
 * successor is the only session eligible for the following ordinary run.
 */
export const IntegratorSuccessorSessionFixedEvent = Schema.TaggedStruct("IntegratorSuccessorSessionFixed", {
  direction: Schema.Literal("FullRerun"),
  directionAppliedAt: JournalPosition,
  predecessor: IntegratorSessionCorrelation,
  quarantineAt: JournalPosition,
  successor: IntegratorSessionCorrelation,
  successorGeneration: IntegratorSuccessorGeneration,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(Schema.makeFilter(successorSessionFixedEventIssue))
export type IntegratorSuccessorSessionFixedEvent = typeof IntegratorSuccessorSessionFixedEvent.Type

/** Durable intent written before each opaque call for one exact run ordinal. */
export const IntegratorRunStartedEvent = Schema.TaggedStruct("IntegratorRunStarted", {
  run: IntegratorRunCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable outer result bound to the exact run that crossed the provider boundary. */
export const IntegratorRunResultRecordedEvent = Schema.TaggedStruct("IntegratorRunResultRecorded", {
  result: IntegratorResult,
  run: IntegratorRunCorrelation,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Durable intent proving Git was about to read a candidate for one exact run. */
export const IntegratorRunCandidateGitReadIntendedEvent = Schema.TaggedStruct("IntegratorRunCandidateGitReadIntended", {
  candidateText: IntegratorCandidateText,
  run: IntegratorRunCorrelation,
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
  IntegratorSuccessorSessionFixedEvent,
  IntegratorRunStartedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
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
