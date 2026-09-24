import { HashSet, Schema } from "effect"
import type { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { integratorRunStartedRecordKey, integratorSessionFixedRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  journalRecordByKey,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import { exactTargetLineageRecord } from "../integration-quarantine/canonical-lineage.js"
import {
  IntegratorResponsibilityFacts,
  integratorSessionCorrelationsEqual,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  type IntegratorRunState,
  type IntegratorSessionCorrelation,
  integratorRetryRunOrdinal,
  maximumIntegratorSessionsPerResponsibility
} from "./events.js"
import { deriveIntegratorRunStateFromHistory } from "./run-state.js"
import { integratorRunTwoAuthorizationIssue } from "./retry-authorization.js"
import { evaluateIntegratorFullRerunSuccessor } from "./successor-history.js"
import { validateAutomaticSuccessorSessionFixedRecord } from "./automatic-successor-session.js"

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

export const integratorCorrelationsEqual = integratorSessionCorrelationsEqual

export const integratorFindEventAtKey = journalRecordByKey

/** Reconstructs run-bound state without upcasting any session-only history. */
export const deriveIntegratorRunState = (
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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

const runStartOrdinalIssue = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  ordinals: HashSet.HashSet<number>
): string | undefined => {
  if (run.ordinal > integratorRetryRunOrdinal || record.key !== integratorRunStartedRecordKey(run))
    return "Integrator run start has a foreign key or exceeds the Retry bound"
  return HashSet.has(ordinals, run.ordinal) ? "Integrator run start repeats one exact session ordinal" : undefined
}

const latestStartedRunFor = (
  records: JournalHistorySource,
  session: IntegratorSessionCorrelation
):
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly run: IntegratorRunCorrelation; readonly position: JournalRecord["position"] } => {
  let ordinals = HashSet.empty<number>()
  let latest: { readonly run: IntegratorRunCorrelation; readonly position: JournalRecord["position"] } | undefined
  for (const record of journalRecordsOfKind(records, "IntegratorRunStarted")) {
    const { event } = record
    if (event._tag !== "IntegratorRunStarted" || !integratorCorrelationsEqual(event.run.session, session)) continue
    const issue = runStartOrdinalIssue(record, event.run, ordinals)
    if (issue !== undefined) return { _tag: "Invalid", detail: issue }
    ordinals = HashSet.add(ordinals, event.run.ordinal)
    /* v8 ignore next -- @preserve validated Journal order records a lower ordinal before its authorized successor. */
    if (latest === undefined || event.run.ordinal > latest.run.ordinal) {
      latest = { run: event.run, position: record.position }
    }
  }
  return latest === undefined ? { _tag: "Absent" } : { _tag: "Valid", ...latest }
}

const activeSuccessorFor = (
  records: JournalHistorySource,
  predecessor: IntegratorSessionCorrelation
):
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Invalid"; readonly detail: string }
  | {
      readonly _tag: "Valid"
      readonly successor: IntegratorSessionCorrelation
      readonly relation: "Automatic" | "FullRerun"
    } => {
  let active = predecessor
  let relation: "Automatic" | "FullRerun" = "FullRerun"
  let successorCount = 0
  let advanced = false
  const visited = new Set<string>()
  for (;;) {
    if (visited.has(active.sessionId)) {
      return { _tag: "Invalid", detail: "Integrator successor relations contain a session cycle" }
    }
    visited.add(active.sessionId)
    const related = [
      ...journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed"),
      ...journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")
    ].filter(
      ({ event }) =>
        (event._tag === "IntegratorSuccessorSessionFixed" ||
          event._tag === "IntegratorAutomaticSuccessorSessionFixed") &&
        event.predecessor.sessionId === active.sessionId
    )
    if (related.length === 0) {
      return advanced ? { _tag: "Valid", successor: active, relation } : { _tag: "Absent" }
    }
    if (related.length !== 1) {
      const fullRerunRelations = related.filter(({ event }) => event._tag === "IntegratorSuccessorSessionFixed").length
      return {
        _tag: "Invalid",
        detail:
          fullRerunRelations > 1
            ? "multiple FullRerun successors describe one Integrator predecessor"
            : "multiple successor relations describe one Integrator predecessor"
      }
    }
    const record = related[0]
    if (record === undefined) return { _tag: "Invalid", detail: "successor relation disappeared during reconstruction" }
    if (record.event._tag === "IntegratorSuccessorSessionFixed") {
      const validated = evaluateIntegratorFullRerunSuccessor(records, record, active)
      if (validated._tag !== "Valid") return validated
      active = validated.successor
      relation = "FullRerun"
    } else if (record.event._tag === "IntegratorAutomaticSuccessorSessionFixed") {
      const validated = validateAutomaticSuccessorSessionFixedRecord(records, record, active)
      if (validated._tag !== "Valid") return validated
      active = record.event.successor
      relation = "Automatic"
    } else {
      return { _tag: "Invalid", detail: "successor relation has an unexpected event kind" }
    }
    advanced = true
    successorCount += 1
    if (successorCount + 1 >= maximumIntegratorSessionsPerResponsibility && visited.has(active.sessionId)) {
      return { _tag: "Invalid", detail: "Integrator successor relations exceed the three-session bound" }
    }
    if (successorCount + 1 > maximumIntegratorSessionsPerResponsibility) {
      return { _tag: "Invalid", detail: "Integrator successor relations exceed the three-session bound" }
    }
  }
}

/**
 * Validates the durable S1 -> S2 relation before a consumer treats the
 * predecessor as transferred.  Cleanup uses this instead of accepting a
 * caller-supplied pair of distinct session identifiers.
 */
export const validateIntegratorSuccessorSessionFixed = (
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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

const hasCompetingFixedSession = (
  records: JournalHistorySource,
  facts: IntegratorResponsibilityFacts,
  predecessor: IntegratorSessionCorrelation
): boolean => {
  for (const { event } of journalRecordsOfKind(records, "IntegratorSessionFixed")) {
    if (
      event._tag === "IntegratorSessionFixed" &&
      integratorResponsibilityFactsEqual(integratorResponsibilityFactsFromCorrelation(event.correlation), facts) &&
      !integratorCorrelationsEqual(event.correlation, predecessor)
    )
      return true
  }
  return false
}

const validateCurrentFixedSession = (
  records: JournalHistorySource,
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
  return hasCompetingFixedSession(records, facts, predecessor)
    ? { _tag: "Invalid", detail: "multiple target heads were recorded for one responsibility" }
    : { _tag: "Valid", record: sessionRecord }
}

type CurrentRunValidation =
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly run: IntegratorRunCorrelation }

const currentRunFor = (
  records: JournalHistorySource,
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
    if (activeSuccessor.relation !== "Automatic" || startedRun.run.ordinal !== integratorRetryRunOrdinal) {
      return { _tag: "Invalid", detail: "FullRerun successor permits only its initial Integrator run" }
    }
    const authorizationIssue = integratorRunTwoAuthorizationIssue(records, startedRun.run, {
      beforePosition: startedRun.position
    })
    if (authorizationIssue !== undefined) return { _tag: "Invalid", detail: authorizationIssue }
  }
  const run =
    startedRun._tag === "Valid"
      ? startedRun.run
      : IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  return { _tag: "Valid", run }
}

/** Reconstructs the latest explicit run; old session-only event tags remain unknown and cannot be upcast. */
export const deriveCurrentIntegratorState = (
  records: JournalHistorySource,
  responsibility: StartedIntegrationResponsibility
): CurrentIntegratorState => {
  const facts = integratorResponsibilityFactsFor(responsibility)
  const sessionRecord = fixedSessionFor(records, facts)
  if (sessionRecord === undefined) {
    for (const tag of [
      "IntegratorRunStarted",
      "IntegratorRunResultRecorded",
      "IntegratorRunCandidateGitReadIntended",
      "IntegratorRunCandidateGitObserved"
    ] as const) {
      for (const { event } of journalRecordsOfKind(records, tag)) {
        if (runEventMatchesResponsibility(event, facts)) {
          return contradictionState("an Integrator run record exists without a fixed session")
        }
      }
    }
    return { _tag: "Absent", responsibility: facts }
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
