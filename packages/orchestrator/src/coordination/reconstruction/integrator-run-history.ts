import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { HashMap, Option } from "effect"
import {
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunCandidateRecordKeyPrefix,
  integratorRunRecordKeyPrefix,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey
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

type IntegratorSessionFixed = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorSessionFixed" | "IntegratorSuccessorSessionFixed" }
>
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
  readonly integratorRunStarted: HashMap.HashMap<string, PositionedIntegratorEvent<IntegratorRunStarted>>
  readonly integratorRunResults: HashMap.HashMap<string, PositionedIntegratorEvent<IntegratorRunResultRecorded>>
  readonly integratorRunCandidateGitReadIntents: HashMap.HashMap<
    string,
    PositionedIntegratorEvent<IntegratorRunCandidateGitReadIntended>
  >
  readonly integratorRunCandidateGitObservations: HashMap.HashMap<
    string,
    PositionedIntegratorEvent<IntegratorRunCandidateGitObserved>
  >
}

interface IntegratorRunHistoryValidationIndexes extends IntegratorRunHistoryIndexes {
  readonly integratorSessionFixed: HashMap.HashMap<JournalPosition, IntegratorSessionFixed>
  readonly integratorSessionsByStartedAt: HashMap.HashMap<JournalPosition, JournalPosition>
  readonly integratorSessionsBySessionId: HashMap.HashMap<string, JournalPosition>
}

const mapGet = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

interface IntegratorRunHistoryValidation<Indexes extends IntegratorRunHistoryIndexes> {
  readonly indexes: Indexes
  readonly detail: string | undefined
}

const integratorRunKey = integratorRunRecordKeyPrefix

const exactSessionForCorrelation = (
  correlation: IntegratorRunCorrelation["session"],
  record: JournalRecord,
  indexes: IntegratorRunHistoryValidationIndexes
): boolean => {
  const sessionPosition = mapGet(indexes.integratorSessionsBySessionId, correlation.sessionId)
  const session = sessionPosition === undefined ? undefined : mapGet(indexes.integratorSessionFixed, sessionPosition)
  const sessionCorrelation =
    session === undefined
      ? undefined
      : session._tag === "IntegratorSessionFixed"
        ? session.correlation
        : session.successor
  return (
    sessionPosition !== undefined &&
    session !== undefined &&
    sessionPosition < record.position &&
    sessionCorrelation !== undefined &&
    integratorCorrelationsEqual(sessionCorrelation, correlation)
  )
}

const previousIntegratorRun = (run: IntegratorRunCorrelation): IntegratorRunCorrelation | undefined =>
  run.ordinal === 1
    ? undefined
    : IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(Number(run.ordinal) - 1),
        session: run.session
      })

const runRecordsAreConclusive = (
  previous: IntegratorRunCorrelation,
  record: JournalRecord,
  indexes: IntegratorRunHistoryValidationIndexes
): boolean => {
  const previousStart = mapGet(indexes.integratorRunStarted, integratorRunKey(previous))
  const previousResult = mapGet(indexes.integratorRunResults, integratorRunKey(previous))
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
): boolean => previous === undefined || runRecordsAreConclusive(previous, record, indexes)

const integratorRunAuthorizationIssue = (
  event: IntegratorRunStarted,
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord
): string | undefined =>
  event.run.ordinal === 1
    ? undefined
    : event.run.ordinal === integratorRetryRunOrdinal
      ? integratorRunTwoAuthorizationIssue(records, event.run, { beforePosition: record.position })
      : `Integrator run ordinal ${event.run.ordinal} exceeds Retry bound`

const invalidIntegratorRunStartedRecord = (
  record: JournalRecord,
  event: IntegratorRunStarted,
  existing: PositionedIntegratorEvent<IntegratorRunStarted> | undefined,
  session: boolean,
  authorizationIssue: string | undefined,
  previousConclusive: boolean
): string | undefined => {
  if (existing !== undefined) return `Integrator run repeats exact session ordinal ${event.run.ordinal}`
  if (record.key !== integratorRunStartedRecordKey(event.run)) {
    return `Integrator run start has a foreign key for session ordinal ${event.run.ordinal}`
  }
  if (!session) return `Integrator run has no exact earlier fixed session at ${event.run.session.startedAt}`
  if (authorizationIssue !== undefined) return authorizationIssue
  /* v8 ignore next -- @preserve ordinal one has no previous run, so previousConclusive is always true on this arm. */
  if (event.run.ordinal === 1 && !previousConclusive) {
    return `Integrator run ordinal ${event.run.ordinal} has no exact conclusive predecessor run`
  }
  return undefined
}

const invalidIntegratorRunStarted = (
  record: JournalRecord,
  event: IntegratorRunStarted,
  indexes: IntegratorRunHistoryValidationIndexes,
  records: ReadonlyArray<JournalRecord>
): IntegratorRunHistoryValidation<IntegratorRunHistoryValidationIndexes> => {
  const key = integratorRunKey(event.run)
  const existing = mapGet(indexes.integratorRunStarted, key)
  const session = exactSessionForCorrelation(event.run.session, record, indexes)
  const previous = previousIntegratorRun(event.run)
  const previousConclusive = previousRunIsConclusive(previous, record, indexes)
  const authorizationIssue = integratorRunAuthorizationIssue(event, records, record)
  return {
    detail: invalidIntegratorRunStartedRecord(record, event, existing, session, authorizationIssue, previousConclusive),
    indexes: {
      ...indexes,
      integratorRunStarted: setMapValue(indexes.integratorRunStarted, key, { event, position: record.position })
    }
  }
}

const exactIntegratorRunStart = (
  run: IntegratorRunCorrelation,
  record: JournalRecord,
  indexes: IntegratorRunHistoryIndexes
): PositionedIntegratorEvent<IntegratorRunStarted> | undefined => {
  const started = mapGet(indexes.integratorRunStarted, integratorRunKey(run))
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
): IntegratorRunHistoryValidation<IntegratorRunHistoryValidationIndexes> => {
  const key = integratorRunKey(event.run)
  const existing = mapGet(indexes.integratorRunResults, key)
  const started = exactIntegratorRunStart(event.run, record, indexes)
  const matchingSession = integratorRunCorrelationsEqual(event.result.correlation, event.run)
  return {
    detail:
      existing !== undefined
        ? `Integrator run result repeats exact session ordinal ${event.run.ordinal}`
        : record.key !== integratorRunResultRecordedRecordKey(event.run)
          ? `Integrator run result has a foreign key for session ordinal ${event.run.ordinal}`
          : started === undefined || !matchingSession
            ? `Integrator run result has no exact earlier run start and matching session`
            : undefined,
    indexes: {
      ...indexes,
      integratorRunResults: setMapValue(indexes.integratorRunResults, key, { event, position: record.position })
    }
  }
}

const exactPreparedIntegratorRunResultFor = (
  run: IntegratorRunCorrelation,
  candidateText: string,
  record: JournalRecord,
  indexes: IntegratorRunHistoryIndexes
): PositionedIntegratorEvent<IntegratorRunResultRecorded> | undefined => {
  const result = mapGet(indexes.integratorRunResults, integratorRunKey(run))
  return result !== undefined &&
    result.position < record.position &&
    result.event.result._tag === "PreparedCandidate" &&
    integratorRunCorrelationsEqual(result.event.run, run) &&
    integratorRunCorrelationsEqual(result.event.result.correlation, run) &&
    result.event.result.candidateText === candidateText
    ? result
    : undefined
}

const exactEarlierIntegratorRunCandidateIntent = (
  intent: PositionedIntegratorEvent<IntegratorRunCandidateGitReadIntended> | undefined,
  record: JournalRecord,
  event: IntegratorRunCandidateGitObserved
): boolean =>
  intent !== undefined &&
  intent.position < record.position &&
  intent.event.candidateText === event.candidateText &&
  integratorRunCorrelationsEqual(intent.event.run, event.run)

const invalidIntegratorRunCandidateGitObservationRecord = (
  record: JournalRecord,
  event: IntegratorRunCandidateGitObserved,
  existing: PositionedIntegratorEvent<IntegratorRunCandidateGitObserved> | undefined,
  exactEarlierIntent: boolean,
  result: PositionedIntegratorEvent<IntegratorRunResultRecorded> | undefined,
  matchingCandidateText: boolean
): string | undefined => {
  if (existing !== undefined) {
    return `Integrator run candidate Git observation repeats candidate text ${event.candidateText}`
  }
  if (record.key !== integratorRunCandidateGitObservedRecordKey(event.run, event.candidateText)) {
    return `Integrator run candidate Git observation has a foreign key`
  }
  if (!exactEarlierIntent || result === undefined || !matchingCandidateText) {
    return `Integrator run candidate Git observation has no exact earlier intent, result, and candidate text`
  }
  return undefined
}

const invalidIntegratorRunCandidateGitReadIntent = (
  record: JournalRecord,
  event: IntegratorRunCandidateGitReadIntended,
  indexes: IntegratorRunHistoryIndexes
): IntegratorRunHistoryValidation<IntegratorRunHistoryIndexes> => {
  const key = integratorRunCandidateRecordKeyPrefix(event.run, event.candidateText)
  const existing = mapGet(indexes.integratorRunCandidateGitReadIntents, key)
  const result = exactPreparedIntegratorRunResultFor(event.run, event.candidateText, record, indexes)
  return {
    detail:
      existing !== undefined
        ? `Integrator run candidate Git-read intent repeats candidate text ${event.candidateText}`
        : record.key !== integratorRunCandidateGitReadIntendedRecordKey(event.run, event.candidateText)
          ? `Integrator run candidate Git-read intent has a foreign key`
          : result === undefined
            ? `Integrator run candidate Git-read intent has no exact earlier PreparedCandidate result`
            : undefined,
    indexes: {
      ...indexes,
      integratorRunCandidateGitReadIntents: setMapValue(indexes.integratorRunCandidateGitReadIntents, key, {
        event,
        position: record.position
      })
    }
  }
}

const invalidIntegratorRunCandidateGitObservation = (
  record: JournalRecord,
  event: IntegratorRunCandidateGitObserved,
  indexes: IntegratorRunHistoryIndexes
): IntegratorRunHistoryValidation<IntegratorRunHistoryIndexes> => {
  const key = integratorRunCandidateRecordKeyPrefix(event.run, event.candidateText)
  const existing = mapGet(indexes.integratorRunCandidateGitObservations, key)
  const intent = mapGet(indexes.integratorRunCandidateGitReadIntents, key)
  const result = exactPreparedIntegratorRunResultFor(event.run, event.candidateText, record, indexes)
  const exactEarlierIntent = exactEarlierIntegratorRunCandidateIntent(intent, record, event)
  const matchingCandidateText = event.observation.candidateText === event.candidateText
  return {
    detail: invalidIntegratorRunCandidateGitObservationRecord(
      record,
      event,
      existing,
      exactEarlierIntent,
      result,
      matchingCandidateText
    ),
    indexes: {
      ...indexes,
      integratorRunCandidateGitObservations: setMapValue(indexes.integratorRunCandidateGitObservations, key, {
        event,
        position: record.position
      })
    }
  }
}

/** Validates and indexes the run-bound events owned by the outer Integrator protocol. */
export const validateIntegratorRunHistoryEvent = <Indexes extends IntegratorRunHistoryValidationIndexes>(
  record: JournalRecord,
  indexes: Indexes,
  records: ReadonlyArray<JournalRecord> = [record]
):
  | { readonly handled: true; readonly issue: string | undefined; readonly indexes: Indexes }
  | { readonly handled: false; readonly indexes: Indexes } => {
  const event = record.event
  if (event._tag === "IntegratorRunStarted") {
    const validation = invalidIntegratorRunStarted(record, event, indexes, records)
    return { handled: true, issue: validation.detail, indexes: { ...indexes, ...validation.indexes } }
  }
  if (event._tag === "IntegratorRunResultRecorded") {
    const validation = invalidIntegratorRunResult(record, event, indexes)
    return { handled: true, issue: validation.detail, indexes: { ...indexes, ...validation.indexes } }
  }
  if (event._tag === "IntegratorRunCandidateGitReadIntended") {
    const validation = invalidIntegratorRunCandidateGitReadIntent(record, event, indexes)
    return { handled: true, issue: validation.detail, indexes: { ...indexes, ...validation.indexes } }
  }
  if (event._tag === "IntegratorRunCandidateGitObserved") {
    const validation = invalidIntegratorRunCandidateGitObservation(record, event, indexes)
    return { handled: true, issue: validation.detail, indexes: { ...indexes, ...validation.indexes } }
  }
  return { handled: false, indexes }
}
