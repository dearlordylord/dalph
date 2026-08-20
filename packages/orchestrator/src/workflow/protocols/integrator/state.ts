import { Schema } from "effect"
import type { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { integratorRunStartedRecordKey, integratorSessionFixedRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import { exactTargetLineageRecord } from "../integration-quarantine/canonical-lineage.js"
import {
  IntegratorResponsibilityFacts,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  integratorRetryRunOrdinal
} from "./events.js"
import type { IntegratorSessionCorrelation, IntegratorRunState } from "./events.js"
import { deriveIntegratorRunStateFromHistory } from "./run-state.js"
import { evaluateIntegratorFullRerunSuccessor } from "./successor-history.js"

const responsibilityFactsEquivalence = Schema.toEquivalence(IntegratorResponsibilityFacts)

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
  correlation: IntegratorSessionCorrelation
): IntegratorResponsibilityFacts => ({
  acceptedResult: correlation.acceptedResult,
  integrationTarget: correlation.integrationTarget,
  plannedAttempt: correlation.plannedAttempt,
  queuedAt: correlation.queuedAt,
  startedAt: correlation.startedAt
})

export const integratorResponsibilityFactsEqual = responsibilityFactsEquivalence

export const integratorCorrelationsEqual = (
  left: IntegratorSessionCorrelation,
  right: IntegratorSessionCorrelation
): boolean =>
  left.candidateResource === right.candidateResource &&
  left.expectedTargetHead === right.expectedTargetHead &&
  left.sessionId === right.sessionId &&
  left.targetLineageObservedAt === right.targetLineageObservedAt &&
  integratorResponsibilityFactsEqual(
    integratorResponsibilityFactsFromCorrelation(left),
    integratorResponsibilityFactsFromCorrelation(right)
  )

export const integratorFindEventAtKey = (
  records: ReadonlyArray<JournalRecord>,
  key: JournalRecord["key"]
): JournalRecord | undefined => records.find((record) => record.key === key)

/** Reconstructs run-bound state without upcasting any session-only history. */
export const deriveIntegratorRunState = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  run: IntegratorRunCorrelation
): IntegratorRunState =>
  deriveIntegratorRunStateFromHistory(records, responsibility, run, {
    findEventAtKey: integratorFindEventAtKey,
    responsibilityFactsFromCorrelation: integratorResponsibilityFactsFromCorrelation,
    responsibilityFactsEqual: integratorResponsibilityFactsEqual,
    correlationsEqual: integratorCorrelationsEqual
  })

type IntegratorCurrentAbsent = { readonly _tag: "Absent"; readonly responsibility: IntegratorResponsibilityFacts }

type IntegratorCurrentContradiction = { readonly _tag: "Contradiction"; readonly detail: string }

/** The latest exact run state, or the responsibility-bound absence/contradiction before a session exists. */
export type CurrentIntegratorState = IntegratorCurrentAbsent | IntegratorCurrentContradiction | IntegratorRunState

const contradictionState = (detail: string): IntegratorCurrentContradiction => ({ _tag: "Contradiction", detail })

const runEventMatchesResponsibility = (event: WorkflowJournalEvent, facts: IntegratorResponsibilityFacts): boolean => {
  if (event._tag === "IntegratorRunStarted") {
    return integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(event.run.session), facts)
  }
  if (event._tag === "IntegratorRunResultRecorded") {
    return integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(event.run.session), facts)
  }
  if (event._tag === "IntegratorRunCandidateGitReadIntended") {
    return integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(event.run.session), facts)
  }
  if (event._tag === "IntegratorRunCandidateGitObserved") {
    return integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(event.run.session), facts)
  }
  return false
}

const lineageMatchesCorrelation = (
  records: ReadonlyArray<JournalRecord>,
  correlation: IntegratorSessionCorrelation,
  beforePosition: JournalRecord["position"]
): boolean =>
  exactTargetLineageRecord(
    records,
    {
      expectedTargetHead: correlation.expectedTargetHead,
      integrationTarget: correlation.integrationTarget,
      plannedAttempt: correlation.plannedAttempt,
      targetLineageObservedAt: correlation.targetLineageObservedAt
    },
    { beforePosition }
  ) !== undefined

const latestStartedRunFor = (
  records: ReadonlyArray<JournalRecord>,
  session: IntegratorSessionCorrelation
):
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly run: IntegratorRunCorrelation } => {
  const related = records.filter(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorRunStarted" }>
    } => record.event._tag === "IntegratorRunStarted" && integratorCorrelationsEqual(record.event.run.session, session)
  )
  if (
    related.some(
      (record) =>
        record.event.run.ordinal > integratorRetryRunOrdinal ||
        record.key !== integratorRunStartedRecordKey(record.event.run)
    )
  ) {
    return { _tag: "Invalid", detail: "Integrator run start has a foreign key or exceeds the Retry bound" }
  }
  const ordinals = related.map(({ event }) => event.run.ordinal)
  if (new Set(ordinals).size !== ordinals.length) {
    return { _tag: "Invalid", detail: "Integrator run start repeats one exact session ordinal" }
  }
  const latest = related.reduce<IntegratorRunCorrelation | undefined>((current, { event }) => {
    /* v8 ignore next -- @preserve validated Journal order records a lower ordinal before its authorized successor. */
    return current === undefined || event.run.ordinal > current.ordinal ? event.run : current
  }, undefined)
  return latest === undefined ? { _tag: "Absent" } : { _tag: "Valid", run: latest }
}

const activeSuccessorFor = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation
):
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly successor: IntegratorSessionCorrelation } => {
  const related = records.filter(
    ({ event }) =>
      event._tag === "IntegratorSuccessorSessionFixed" && event.predecessor.sessionId === predecessor.sessionId
  )
  if (related.length > 1) {
    return { _tag: "Invalid", detail: "multiple FullRerun successors describe one Integrator predecessor" }
  }
  const record = related[0]
  if (record === undefined || record.event._tag !== "IntegratorSuccessorSessionFixed") return { _tag: "Absent" }
  return evaluateIntegratorFullRerunSuccessor(records, record, predecessor)
}

/**
 * Validates the durable S1 -> S2 relation before a consumer treats the
 * predecessor as transferred.  Cleanup uses this instead of accepting a
 * caller-supplied pair of distinct session identifiers.
 */
export const validateIntegratorSuccessorSessionFixed = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation,
  expectedSuccessor: IntegratorSessionCorrelation
): { readonly _tag: "Valid" } | { readonly _tag: "Invalid"; readonly detail: string } => {
  const active = activeSuccessorFor(records, predecessor)
  if (active._tag === "Invalid") return active
  if (active._tag === "Absent") return { _tag: "Invalid", detail: "FullRerun successor evidence is missing" }
  return integratorCorrelationsEqual(active.successor, expectedSuccessor)
    ? { _tag: "Valid" }
    : { _tag: "Invalid", detail: "FullRerun successor evidence names a foreign successor" }
}

const fixedSessionFor = (
  records: ReadonlyArray<JournalRecord>,
  facts: IntegratorResponsibilityFacts
): JournalRecord | undefined => integratorFindEventAtKey(records, integratorSessionFixedRecordKey(facts))

type IntegratorFixedSessionRecord = JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorSessionFixed" }>
}

const isIntegratorFixedSessionRecord = (record: JournalRecord): record is IntegratorFixedSessionRecord =>
  record.event._tag === "IntegratorSessionFixed"

type CurrentSessionValidation =
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly record: IntegratorFixedSessionRecord }

const validateCurrentFixedSession = (
  records: ReadonlyArray<JournalRecord>,
  facts: IntegratorResponsibilityFacts,
  sessionRecord: JournalRecord
): CurrentSessionValidation => {
  if (!isIntegratorFixedSessionRecord(sessionRecord)) {
    return { _tag: "Invalid", detail: "the session key contains a non-session event" }
  }
  const predecessor = sessionRecord.event.correlation
  if (!integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(predecessor), facts)) {
    return { _tag: "Invalid", detail: "the fixed session does not bind the requested responsibility" }
  }
  if (!lineageMatchesCorrelation(records, predecessor, sessionRecord.position)) {
    return { _tag: "Invalid", detail: "the fixed session does not follow its durable target-lineage observation" }
  }
  const foreignSession = records.some(
    ({ event }) =>
      event._tag === "IntegratorSessionFixed" &&
      integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(event.correlation), facts) &&
      !integratorCorrelationsEqual(event.correlation, predecessor)
  )
  return foreignSession
    ? { _tag: "Invalid", detail: "multiple target heads were recorded for one responsibility" }
    : { _tag: "Valid", record: sessionRecord }
}

type CurrentRunValidation =
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly run: IntegratorRunCorrelation }

const currentRunFor = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation
): CurrentRunValidation => {
  const activeSuccessor = activeSuccessorFor(records, predecessor)
  if (activeSuccessor._tag === "Invalid") return activeSuccessor
  const session = activeSuccessor._tag === "Valid" ? activeSuccessor.successor : predecessor
  const startedRun = latestStartedRunFor(records, session)
  if (startedRun._tag === "Invalid") return startedRun
  if (
    activeSuccessor._tag === "Valid" &&
    startedRun._tag === "Valid" &&
    startedRun.run.ordinal !== IntegratorRunOrdinal.make(1)
  ) {
    return { _tag: "Invalid", detail: "FullRerun successor permits only its initial Integrator run" }
  }
  const run =
    startedRun._tag === "Valid"
      ? startedRun.run
      : IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  return { _tag: "Valid", run }
}

/** Reconstructs the latest explicit run; old session-only event tags remain unknown and cannot be upcast. */
export const deriveCurrentIntegratorState = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): CurrentIntegratorState => {
  const facts = integratorResponsibilityFactsFor(responsibility)
  const sessionRecord = fixedSessionFor(records, facts)
  if (sessionRecord === undefined) {
    return records.some(({ event }) => runEventMatchesResponsibility(event, facts))
      ? contradictionState("an Integrator run record exists without a fixed session")
      : { _tag: "Absent", responsibility: facts }
  }
  const sessionValidation = validateCurrentFixedSession(records, facts, sessionRecord)
  if (sessionValidation._tag === "Invalid") return contradictionState(sessionValidation.detail)
  const runValidation = currentRunFor(records, sessionValidation.record.event.correlation)
  if (runValidation._tag === "Invalid") return contradictionState(runValidation.detail)
  return deriveIntegratorRunState(records, responsibility, runValidation.run)
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
