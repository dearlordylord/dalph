import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import {
  integratorRunCandidateRecordKeyPrefix,
  integratorRunRecordKeyPrefix
} from "../../workflow-journal/record-key.js"
import {
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  integratorRetryRunOrdinal,
  integratorRunCorrelationsEqual
} from "../../workflow/protocols/integrator/events.js"
import { integratorCorrelationsEqual } from "../../workflow/protocols/integrator/state.js"
import { integratorRunTwoAuthorizationIssue } from "../../workflow/protocols/integrator/retry-authorization.js"
import { setMapValue } from "./integration-history-run-binding.js"

type IntegratorSessionFixed = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorSessionFixed" }>
type IntegratorResultRecorded = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorResultRecorded" }>
type IntegratorRunStarted = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorRunStarted" }>
type IntegratorRunResultRecorded = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorRunResultRecorded" }>
type IntegratorRunCandidateGitReadIntended = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorRunCandidateGitReadIntended" }
>
type IntegratorRunCandidateGitObserved = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorRunCandidateGitObserved" }
>
type PositionedIntegratorEvent<Event> = { readonly event: Event; readonly position: JournalPosition }

/** Causal indexes for run-bound Integrator events. */
export interface IntegratorRunHistoryIndexes {
  readonly integratorRunStarted: Map<string, PositionedIntegratorEvent<IntegratorRunStarted>>
  readonly integratorRunResults: Map<string, PositionedIntegratorEvent<IntegratorRunResultRecorded>>
  readonly integratorRunCandidateGitReadIntents: Map<
    string,
    PositionedIntegratorEvent<IntegratorRunCandidateGitReadIntended>
  >
  readonly integratorRunCandidateGitObservations: Map<
    string,
    PositionedIntegratorEvent<IntegratorRunCandidateGitObserved>
  >
}

interface IntegratorRunHistoryValidationIndexes extends IntegratorRunHistoryIndexes {
  readonly integratorSessionFixed: Map<JournalPosition, IntegratorSessionFixed>
  readonly integratorSessionsByStartedAt: Map<JournalPosition, JournalPosition>
  readonly integratorResultsByStartedAt: Map<JournalPosition, PositionedIntegratorEvent<IntegratorResultRecorded>>
}

const integratorRunKey = integratorRunRecordKeyPrefix

const exactSessionForCorrelation = (
  correlation: IntegratorRunCorrelation["session"],
  record: JournalRecord,
  indexes: IntegratorRunHistoryValidationIndexes
): boolean => {
  const sessionPosition = indexes.integratorSessionsByStartedAt.get(correlation.startedAt)
  const session = sessionPosition === undefined ? undefined : indexes.integratorSessionFixed.get(sessionPosition)
  return (
    sessionPosition !== undefined &&
    session !== undefined &&
    sessionPosition < record.position &&
    integratorCorrelationsEqual(session.correlation, correlation)
  )
}

const previousIntegratorRun = (run: IntegratorRunCorrelation): IntegratorRunCorrelation | undefined =>
  run.ordinal === 1
    ? undefined
    : IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(Number(run.ordinal) - 1),
        session: run.session
      })

const legacyInitialResultForRun = (
  run: IntegratorRunCorrelation,
  indexes: IntegratorRunHistoryValidationIndexes,
  record: JournalRecord
): boolean => {
  if (run.ordinal !== 1) return false
  const result = indexes.integratorResultsByStartedAt.get(run.session.startedAt)
  return (
    result !== undefined &&
    result.position < record.position &&
    integratorCorrelationsEqual(result.event.result.correlation, run.session)
  )
}

const runRecordsAreConclusive = (
  previous: IntegratorRunCorrelation,
  record: JournalRecord,
  indexes: IntegratorRunHistoryValidationIndexes
): boolean => {
  const previousStart = indexes.integratorRunStarted.get(integratorRunKey(previous))
  const previousResult = indexes.integratorRunResults.get(integratorRunKey(previous))
  return (
    previousStart !== undefined &&
    previousResult !== undefined &&
    previousStart.position < record.position &&
    previousResult.position < record.position &&
    integratorRunCorrelationsEqual(previousStart.event.run, previous) &&
    integratorRunCorrelationsEqual(previousResult.event.run, previous)
  )
}

const previousRunIsConclusive = (
  previous: IntegratorRunCorrelation | undefined,
  record: JournalRecord,
  indexes: IntegratorRunHistoryValidationIndexes
): boolean =>
  previous === undefined ||
  runRecordsAreConclusive(previous, record, indexes) ||
  legacyInitialResultForRun(previous, indexes, record)

const invalidIntegratorRunStarted = (
  record: JournalRecord,
  event: IntegratorRunStarted,
  indexes: IntegratorRunHistoryValidationIndexes,
  records: ReadonlyArray<JournalRecord>
): string | undefined => {
  const key = integratorRunKey(event.run)
  const existing = indexes.integratorRunStarted.get(key)
  const session = exactSessionForCorrelation(event.run.session, record, indexes)
  const previous = previousIntegratorRun(event.run)
  const previousConclusive = previousRunIsConclusive(previous, record, indexes)
  const authorizationIssue =
    event.run.ordinal === 1
      ? undefined
      : event.run.ordinal === integratorRetryRunOrdinal
        ? integratorRunTwoAuthorizationIssue(records, event.run, { beforePosition: record.position })
        : `Integrator run ordinal ${event.run.ordinal} exceeds Retry bound`
  setMapValue(indexes.integratorRunStarted, key, { event, position: record.position })
  return existing !== undefined
    ? `Integrator run repeats exact session ordinal ${event.run.ordinal}`
    : !session
      ? `Integrator run has no exact earlier fixed session at ${event.run.session.startedAt}`
      : authorizationIssue !== undefined
        ? authorizationIssue
        : event.run.ordinal === 1 && !previousConclusive
          ? `Integrator run ordinal ${event.run.ordinal} has no exact conclusive predecessor run`
          : undefined
}

const exactIntegratorRunStart = (
  run: IntegratorRunCorrelation,
  record: JournalRecord,
  indexes: IntegratorRunHistoryIndexes
): PositionedIntegratorEvent<IntegratorRunStarted> | undefined => {
  const started = indexes.integratorRunStarted.get(integratorRunKey(run))
  return started !== undefined &&
    started.position < record.position &&
    integratorRunCorrelationsEqual(started.event.run, run)
    ? started
    : undefined
}

const invalidIntegratorRunResult = (
  record: JournalRecord,
  event: IntegratorRunResultRecorded,
  indexes: IntegratorRunHistoryValidationIndexes
): string | undefined => {
  const key = integratorRunKey(event.run)
  const existing = indexes.integratorRunResults.get(key)
  const started = exactIntegratorRunStart(event.run, record, indexes)
  const matchingSession = integratorCorrelationsEqual(event.result.correlation, event.run.session)
  setMapValue(indexes.integratorRunResults, key, { event, position: record.position })
  return existing !== undefined
    ? `Integrator run result repeats exact session ordinal ${event.run.ordinal}`
    : started === undefined || !matchingSession
      ? `Integrator run result has no exact earlier run start and matching session`
      : undefined
}

const exactPreparedIntegratorRunResultFor = (
  run: IntegratorRunCorrelation,
  candidateText: string,
  record: JournalRecord,
  indexes: IntegratorRunHistoryIndexes
): PositionedIntegratorEvent<IntegratorRunResultRecorded> | undefined => {
  const result = indexes.integratorRunResults.get(integratorRunKey(run))
  return result !== undefined &&
    result.position < record.position &&
    result.event.result._tag === "PreparedCandidate" &&
    integratorRunCorrelationsEqual(result.event.run, run) &&
    integratorCorrelationsEqual(result.event.result.correlation, run.session) &&
    result.event.result.candidateText === candidateText
    ? result
    : undefined
}

const invalidIntegratorRunCandidateGitReadIntent = (
  record: JournalRecord,
  event: IntegratorRunCandidateGitReadIntended,
  indexes: IntegratorRunHistoryIndexes
): string | undefined => {
  const key = integratorRunCandidateRecordKeyPrefix(event.run, event.candidateText)
  const existing = indexes.integratorRunCandidateGitReadIntents.get(key)
  const result = exactPreparedIntegratorRunResultFor(event.run, event.candidateText, record, indexes)
  setMapValue(indexes.integratorRunCandidateGitReadIntents, key, { event, position: record.position })
  return existing !== undefined
    ? `Integrator run candidate Git-read intent repeats candidate text ${event.candidateText}`
    : result === undefined
      ? `Integrator run candidate Git-read intent has no exact earlier PreparedCandidate result`
      : undefined
}

const invalidIntegratorRunCandidateGitObservation = (
  record: JournalRecord,
  event: IntegratorRunCandidateGitObserved,
  indexes: IntegratorRunHistoryIndexes
): string | undefined => {
  const key = integratorRunCandidateRecordKeyPrefix(event.run, event.candidateText)
  const existing = indexes.integratorRunCandidateGitObservations.get(key)
  const intent = indexes.integratorRunCandidateGitReadIntents.get(key)
  const result = exactPreparedIntegratorRunResultFor(event.run, event.candidateText, record, indexes)
  const exactEarlierIntent =
    intent !== undefined &&
    intent.position < record.position &&
    intent.event.candidateText === event.candidateText &&
    integratorRunCorrelationsEqual(intent.event.run, event.run)
  const matchingCandidateText = event.observation.candidateText === event.candidateText
  setMapValue(indexes.integratorRunCandidateGitObservations, key, { event, position: record.position })
  return existing !== undefined
    ? `Integrator run candidate Git observation repeats candidate text ${event.candidateText}`
    : !exactEarlierIntent || result === undefined || !matchingCandidateText
      ? `Integrator run candidate Git observation has no exact earlier intent, result, and candidate text`
      : undefined
}

/** Validates and indexes the run-bound events owned by the outer Integrator protocol. */
export const validateIntegratorRunHistoryEvent = (
  record: JournalRecord,
  indexes: IntegratorRunHistoryValidationIndexes,
  records: ReadonlyArray<JournalRecord> = [record]
): { readonly handled: true; readonly issue: string | undefined } | { readonly handled: false } => {
  const event = record.event
  if (event._tag === "IntegratorRunStarted") {
    return { handled: true, issue: invalidIntegratorRunStarted(record, event, indexes, records) }
  }
  if (event._tag === "IntegratorRunResultRecorded") {
    return { handled: true, issue: invalidIntegratorRunResult(record, event, indexes) }
  }
  if (event._tag === "IntegratorRunCandidateGitReadIntended") {
    return { handled: true, issue: invalidIntegratorRunCandidateGitReadIntent(record, event, indexes) }
  }
  if (event._tag === "IntegratorRunCandidateGitObserved") {
    return { handled: true, issue: invalidIntegratorRunCandidateGitObservation(record, event, indexes) }
  }
  return { handled: false }
}
