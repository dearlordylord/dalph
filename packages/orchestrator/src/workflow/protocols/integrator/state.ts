import { Schema } from "effect"
import { PlannedTaskAttempt } from "@dalph/contracts"
import type { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  integratorCandidateGitObservedRecordKey,
  integratorCandidateGitReadIntendedRecordKey,
  integratorResultRecordedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import {
  integratorCandidateHasExactParents,
  IntegratorResponsibilityFacts,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorRunState,
  IntegratorState
} from "./events.js"
import type { IntegratorCandidateText, IntegratorCorrelation, IntegratorResult } from "./events.js"
import { deriveIntegratorRunStateFromHistory } from "./run-state.js"

const responsibilityFactsEquivalence = Schema.toEquivalence(IntegratorResponsibilityFacts)
const plannedAttemptEquivalence = Schema.toEquivalence(PlannedTaskAttempt)

export const integratorResponsibilityFactsFor = (
  responsibility: StartedIntegrationResponsibility
): IntegratorResponsibilityFacts => ({
  acceptedResult: responsibility.acceptedResult,
  integrationTarget: responsibility.integrationTarget,
  plannedAttempt: responsibility.plannedAttempt,
  queuedAt: responsibility.queuedAt,
  startedAt: responsibility.startedAt
})

export const integratorResponsibilityFactsFromCorrelation = (
  correlation: IntegratorCorrelation
): IntegratorResponsibilityFacts => ({
  acceptedResult: correlation.acceptedResult,
  integrationTarget: correlation.integrationTarget,
  plannedAttempt: correlation.plannedAttempt,
  queuedAt: correlation.queuedAt,
  startedAt: correlation.startedAt
})

export const integratorResponsibilityFactsEqual = responsibilityFactsEquivalence

export const integratorCorrelationsEqual = (left: IntegratorCorrelation, right: IntegratorCorrelation): boolean =>
  left.candidateResource === right.candidateResource &&
  left.expectedTargetHead === right.expectedTargetHead &&
  left.sessionId === right.sessionId &&
  left.targetLineageObservedAt === right.targetLineageObservedAt &&
  integratorResponsibilityFactsEqual(
    integratorResponsibilityFactsFromCorrelation(left),
    integratorResponsibilityFactsFromCorrelation(right)
  )

const integratorEventCorrelation = (event: WorkflowJournalEvent): IntegratorCorrelation | undefined => {
  if (event._tag === "IntegratorSessionFixed") return event.correlation
  if (event._tag === "IntegratorResultRecorded") return event.result.correlation
  if (event._tag === "IntegratorCandidateGitReadIntended") return event.correlation
  if (event._tag === "IntegratorCandidateGitObserved") return event.correlation
  return undefined
}

export const integratorFindEventAtKey = (
  records: ReadonlyArray<JournalRecord>,
  key: JournalRecord["key"]
): JournalRecord | undefined => records.find((record) => record.key === key)

const contradictionState = (detail: string): IntegratorState => IntegratorState.cases.Contradiction.make({ detail })

const eventMatchesResponsibility = (event: WorkflowJournalEvent, facts: IntegratorResponsibilityFacts): boolean => {
  const correlation = integratorEventCorrelation(event)
  return (
    correlation !== undefined &&
    integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(correlation), facts)
  )
}

const lineageMatchesCorrelation = (record: JournalRecord | undefined, correlation: IntegratorCorrelation): boolean =>
  record?.event._tag === "TargetLineageObserved" &&
  record.event.observation.targetHeadSha === correlation.expectedTargetHead &&
  record.event.observation.plannedBaseSha === correlation.plannedAttempt.baseSha &&
  record.event.observation.plannedBaseIsAncestorOfTargetHead &&
  plannedAttemptEquivalence(record.event.plannedAttempt, correlation.plannedAttempt)

const gitFactsBindCandidate = (
  records: ReadonlyArray<JournalRecord>,
  correlation: IntegratorCorrelation,
  candidateText: IntegratorCandidateText
): boolean =>
  records.every(({ event }) => {
    if (event._tag !== "IntegratorCandidateGitReadIntended" && event._tag !== "IntegratorCandidateGitObserved") {
      return true
    }
    return integratorCorrelationsEqual(event.correlation, correlation) && event.candidateText === candidateText
  })

const intentMatchesCandidate = (
  record: JournalRecord | undefined,
  correlation: IntegratorCorrelation,
  candidateText: IntegratorCandidateText
): boolean =>
  record === undefined ||
  (record.event._tag === "IntegratorCandidateGitReadIntended" &&
    record.event.candidateText === candidateText &&
    integratorCorrelationsEqual(record.event.correlation, correlation))

const observationMatchesCandidate = (
  record: JournalRecord,
  correlation: IntegratorCorrelation,
  candidateText: IntegratorCandidateText
): record is JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorCandidateGitObserved" }>
} =>
  record.event._tag === "IntegratorCandidateGitObserved" &&
  record.event.candidateText === candidateText &&
  integratorCorrelationsEqual(record.event.correlation, correlation) &&
  record.event.observation.candidateText === candidateText

const stateForPreparedCandidate = (
  records: ReadonlyArray<JournalRecord>,
  related: ReadonlyArray<JournalRecord>,
  correlation: IntegratorCorrelation,
  result: Extract<IntegratorResult, { readonly _tag: "PreparedCandidate" }>
): IntegratorState => {
  const { candidateText } = result
  if (!gitFactsBindCandidate(related, correlation, candidateText)) {
    return contradictionState("Git facts do not bind the recorded candidate")
  }
  const intent = integratorFindEventAtKey(
    records,
    integratorCandidateGitReadIntendedRecordKey(correlation, candidateText)
  )
  if (!intentMatchesCandidate(intent, correlation, candidateText)) {
    return contradictionState("the Git-read intent has a foreign correlation or candidate")
  }
  const observed = integratorFindEventAtKey(
    records,
    integratorCandidateGitObservedRecordKey(correlation, candidateText)
  )
  if (observed === undefined) return IntegratorState.cases.PreparedAwaitingGit.make({ candidateText, correlation })
  if (intent === undefined) return contradictionState("Git observation exists without a read intent")
  if (!observationMatchesCandidate(observed, correlation, candidateText)) {
    return contradictionState("Git observation does not bind the reported candidate")
  }
  const observation = observed.event.observation
  if (
    !integratorCandidateHasExactParents(observation, correlation.expectedTargetHead, correlation.acceptedResult.commit)
  ) {
    return IntegratorState.cases.CandidateRejected.make({ candidateText, correlation, observation })
  }
  return IntegratorState.cases.GitQualifiedPrepared.make({
    candidateCommit: observation.commit,
    candidateText,
    correlation,
    observation: { directParents: [observation.directParents[0], observation.directParents[1]] },
    qualifiedAt: observed.position
  })
}

const stateAfterSession = (
  records: ReadonlyArray<JournalRecord>,
  related: ReadonlyArray<JournalRecord>,
  correlation: IntegratorCorrelation
): IntegratorState => {
  const resultRecord = integratorFindEventAtKey(records, integratorResultRecordedRecordKey(correlation))
  if (resultRecord === undefined) {
    const hasResultOrGit = related.some(({ event }) => event._tag !== "IntegratorSessionFixed")
    return hasResultOrGit
      ? contradictionState("an outer result exists at a foreign result key")
      : IntegratorState.cases.SessionUnfinished.make({ correlation })
  }
  if (resultRecord.event._tag !== "IntegratorResultRecorded") {
    return contradictionState("the result key contains a non-result event")
  }
  const { result } = resultRecord.event
  if (!integratorCorrelationsEqual(result.correlation, correlation)) {
    return contradictionState("the recorded outer result has a foreign correlation")
  }
  const foreignResult = related.some(
    ({ event }) =>
      event._tag === "IntegratorResultRecorded" && !integratorCorrelationsEqual(event.result.correlation, correlation)
  )
  if (foreignResult) return contradictionState("multiple outer results exist for one responsibility")
  if (result._tag === "PreparedCandidate") return stateForPreparedCandidate(records, related, correlation, result)
  const hasGitFacts = related.some(
    ({ event }) =>
      event._tag === "IntegratorCandidateGitReadIntended" || event._tag === "IntegratorCandidateGitObserved"
  )
  return hasGitFacts
    ? contradictionState("NotPrepared cannot have a candidate Git observation")
    : IntegratorState.cases.NotPrepared.make({ correlation, detail: result.detail })
}

/**
 * Reconstructs only states proved by this module's local records. Foreign or
 * incomplete relationships become Contradiction rather than a guessed state.
 */
export const deriveIntegratorState = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): IntegratorState => {
  const facts = integratorResponsibilityFactsFor(responsibility)
  const session = integratorFindEventAtKey(records, integratorSessionFixedRecordKey(facts))
  const related = records.filter(({ event }) => eventMatchesResponsibility(event, facts))
  if (session === undefined) {
    return related.length === 0
      ? IntegratorState.cases.Absent.make({ responsibility: facts })
      : contradictionState("a result or Git record exists without a fixed session")
  }
  if (session.event._tag !== "IntegratorSessionFixed") {
    return contradictionState("the session key contains a non-session event")
  }
  const correlation = session.event.correlation
  if (!integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(correlation), facts)) {
    return contradictionState("the fixed session does not bind the requested responsibility")
  }
  const lineageRecord = records.find(({ position }) => position === correlation.targetLineageObservedAt)
  if (!lineageMatchesCorrelation(lineageRecord, correlation)) {
    return contradictionState("the fixed session does not follow its durable target-lineage observation")
  }

  const foreignRelatedSession = related.some(
    ({ event }) =>
      event._tag === "IntegratorSessionFixed" && !integratorCorrelationsEqual(event.correlation, correlation)
  )
  if (foreignRelatedSession) return contradictionState("multiple target heads were recorded for one responsibility")
  return stateAfterSession(records, related, correlation)
}

/** Reconstructs run-bound state while keeping the public state module surface stable. */
export const deriveIntegratorRunState = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  run: IntegratorRunCorrelation
): IntegratorRunState =>
  deriveIntegratorRunStateFromHistory(records, responsibility, run, {
    deriveLegacyState: deriveIntegratorState,
    findEventAtKey: integratorFindEventAtKey,
    responsibilityFactsFromCorrelation: integratorResponsibilityFactsFromCorrelation,
    responsibilityFactsEqual: integratorResponsibilityFactsEqual,
    correlationsEqual: integratorCorrelationsEqual
  })

/**
 * The latest exact run state for one fixed Integrator session. Before a
 * session exists, reconstruction retains the responsibility-bound Absent or
 * Contradiction state because no run identity can yet be constructed.
 */
export type CurrentIntegratorState =
  | Extract<IntegratorState, { readonly _tag: "Absent" | "Contradiction" }>
  | IntegratorRunState

const latestStartedRunFor = (
  records: ReadonlyArray<JournalRecord>,
  session: IntegratorCorrelation
): IntegratorRunCorrelation | undefined =>
  records.reduce<IntegratorRunCorrelation | undefined>((latest, { event }) => {
    if (event._tag !== "IntegratorRunStarted" || !integratorCorrelationsEqual(event.run.session, session)) {
      return latest
    }
    return latest === undefined || event.run.ordinal > latest.ordinal ? event.run : latest
  }, undefined)

/** Reconstructs the latest exact Integrator run, including the initial legacy-history migration. */
export const deriveCurrentIntegratorState = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): CurrentIntegratorState => {
  const sessionState = deriveIntegratorState(records, responsibility)
  if (sessionState._tag === "Absent" || sessionState._tag === "Contradiction") return sessionState
  const session = sessionState.correlation
  const startedRun = latestStartedRunFor(records, session)
  if (startedRun === undefined && sessionState._tag !== "SessionUnfinished") {
    return IntegratorRunState.cases.Contradiction.make({
      detail: "session-only terminal Integrator history cannot authorize run-bound promotion"
    })
  }
  const run = startedRun ?? IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  return deriveIntegratorRunState(records, responsibility, run)
}

/** Materializes exact-run promotion evidence from reconstructed run state. */
export const integratorRunQualifiedCandidateFromState = (
  state: Extract<IntegratorRunState, { readonly _tag: "GitQualifiedPrepared" }>
) =>
  IntegratorRunQualifiedCandidate.make({
    candidateCommit: state.candidateCommit,
    candidateText: state.candidateText,
    directParents: state.observation.directParents,
    qualifiedAt: state.qualifiedAt,
    run: state.run
  })
