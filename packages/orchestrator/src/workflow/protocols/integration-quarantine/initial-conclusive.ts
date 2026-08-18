import { Effect, Schema } from "effect"
import {
  integrationQuarantinedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "./events.js"
import {
  IntegratorGitObservation,
  integratorCandidateHasExactParents,
  integratorRunCorrelationsEqual
} from "../integrator/events.js"
import type { IntegratorRunCorrelation, IntegratorRunProtocolResult } from "../integrator/events.js"
import { IntegratorJournalContradiction } from "../integrator/errors.js"
import { integratorCorrelationsEqual, integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"

type NotPreparedInput = Extract<IntegratorRunProtocolResult, { readonly _tag: "NotPrepared" }>
type CandidateRejectedInput = Extract<IntegratorRunProtocolResult, { readonly _tag: "CandidateRejected" }>

/** The only initial-run results that are conclusive enough to create Q. */
export type InitialConclusiveIntegrationQuarantineInput = NotPreparedInput | CandidateRejectedInput
type CandidateText = CandidateRejectedInput["candidateText"]

type RunStartedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunStarted" }>
}
type RunResultRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunResultRecorded" }>
}
type CandidateReadIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunCandidateGitReadIntended" }>
}
type CandidateObservationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunCandidateGitObserved" }>
}

const quarantineEventEquivalence = Schema.toEquivalence(IntegrationQuarantinedEvent)
const gitObservationEquivalence = Schema.toEquivalence(IntegratorGitObservation)

const runIdFor = (run: IntegratorRunCorrelation) => run.session.plannedAttempt.runId

const reject = (run: IntegratorRunCorrelation, detail: string): Effect.Effect<never, IntegratorJournalContradiction> =>
  Effect.fail(new IntegratorJournalContradiction({ detail, runId: runIdFor(run) }))

const runResultMatches = (record: JournalRecord, run: IntegratorRunCorrelation): record is RunResultRecord =>
  record.event._tag === "IntegratorRunResultRecorded" &&
  record.runId === runIdFor(run) &&
  record.key === integratorRunResultRecordedRecordKey(run) &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  integratorCorrelationsEqual(record.event.result.correlation, run.session)

const readIntentMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  candidateText: CandidateText
): record is CandidateReadIntentRecord =>
  record.event._tag === "IntegratorRunCandidateGitReadIntended" &&
  record.runId === runIdFor(run) &&
  record.key === integratorRunCandidateGitReadIntendedRecordKey(run, candidateText) &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  record.event.candidateText === candidateText

const observationMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  candidateText: CandidateText
): record is CandidateObservationRecord =>
  record.event._tag === "IntegratorRunCandidateGitObserved" &&
  record.runId === runIdFor(run) &&
  record.key === integratorRunCandidateGitObservedRecordKey(run, candidateText) &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  record.event.candidateText === candidateText &&
  record.event.observation.candidateText === candidateText

const exactRecordAt = (
  records: ReadonlyArray<JournalRecord>,
  key: JournalRecord["key"]
): JournalRecord | string | undefined => {
  const matches = records.filter((record) => record.key === key)
  return matches.length > 1 ? "Journal history contains duplicate records for one exact key" : matches[0]
}

const sameRunCandidateEvent = (record: JournalRecord, run: IntegratorRunCorrelation): boolean =>
  (record.event._tag === "IntegratorRunCandidateGitReadIntended" ||
    record.event._tag === "IntegratorRunCandidateGitObserved") &&
  record.runId === runIdFor(run) &&
  integratorRunCorrelationsEqual(record.event.run, run)

const hasLegacySessionEvidence = (records: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean =>
  records.some(({ event }) => {
    if (event._tag === "IntegratorResultRecorded") {
      return integratorCorrelationsEqual(event.result.correlation, run.session)
    }
    if (event._tag === "IntegratorCandidateGitReadIntended" || event._tag === "IntegratorCandidateGitObserved") {
      return integratorCorrelationsEqual(event.correlation, run.session)
    }
    return false
  })

const sameExpectedQuarantine = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  key: JournalRecord["key"],
  expected: IntegrationQuarantinedEvent
): record is JournalRecord & { readonly event: IntegrationQuarantinedEvent } =>
  record.runId === runIdFor(run) &&
  record.key === key &&
  record.event._tag === "IntegrationQuarantined" &&
  quarantineEventEquivalence(record.event, expected)

const conclusiveBasisFor = (
  result: InitialConclusiveIntegrationQuarantineInput,
  resultRecordedAt: JournalPosition,
  candidateObservationAt?: JournalPosition
): Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }> =>
  IntegrationQuarantineBasis.cases.ConclusiveResult.make({
    cause:
      result._tag === "NotPrepared"
        ? IntegrationQuarantineCause.cases.NotPrepared.make({ detail: result.detail })
        : IntegrationQuarantineCause.cases.InvalidCandidate.make({
            candidateText: result.candidateText,
            observation: result.observation
          }),
    evidence: IntegrationQuarantineResultEvidence.make({
      ...(candidateObservationAt === undefined ? {} : { candidateObservationAt }),
      resultRecordedAt
    })
  })

type ConclusiveBasis = Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>
type EvidenceValidation<Value> =
  | { readonly _tag: "Valid"; readonly value: Value }
  | { readonly _tag: "Invalid"; readonly detail: string }
type FixedSessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSessionFixed" }>
}

const invalidEvidence = (detail: string): EvidenceValidation<never> => ({ _tag: "Invalid", detail })
const validEvidence = <Value>(value: Value): EvidenceValidation<Value> => ({ _tag: "Valid", value })

const fixedSessionRecordMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation
): record is FixedSessionRecord =>
  record.event._tag === "IntegratorSessionFixed" &&
  record.runId === runIdFor(run) &&
  integratorCorrelationsEqual(record.event.correlation, run.session) &&
  record.position > run.session.targetLineageObservedAt

const validateFixedSession = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): EvidenceValidation<FixedSessionRecord> => {
  const key = integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(run.session))
  const matching = records.filter(
    (record) =>
      record.event._tag === "IntegratorSessionFixed" &&
      record.runId === runIdFor(run) &&
      integratorCorrelationsEqual(record.event.correlation, run.session)
  )
  if (matching.some((record) => record.key !== key)) {
    return invalidEvidence("fixed Integrator session evidence appears under a foreign key")
  }
  const record = exactRecordAt(records, key)
  if (typeof record === "string") return invalidEvidence(record)
  return record !== undefined && fixedSessionRecordMatches(record, run)
    ? validEvidence(record)
    : invalidEvidence("initial conclusive quarantine lacks the exact fixed session predecessor")
}

const validateRunStart = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  session: FixedSessionRecord
): EvidenceValidation<RunStartedRecord> => {
  const key = integratorRunStartedRecordKey(run)
  const matching = records.filter(
    (record): record is RunStartedRecord =>
      record.event._tag === "IntegratorRunStarted" &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (matching.some((record) => record.key !== key))
    return invalidEvidence("run-start evidence appears under a foreign key")
  if (matching.length !== 1) return invalidEvidence("initial conclusive quarantine requires one exact run start")
  const record = matching[0]
  return record !== undefined && record.position > session.position
    ? validEvidence(record)
    : invalidEvidence("run start must follow the fixed session")
}

const validateRunResult = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord
): EvidenceValidation<RunResultRecord> => {
  const key = integratorRunResultRecordedRecordKey(run)
  const matching = records.filter(
    (record): record is RunResultRecord =>
      record.event._tag === "IntegratorRunResultRecorded" &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (matching.some((record) => record.key !== key))
    return invalidEvidence("run-result evidence appears under a foreign key")
  if (matching.length !== 1) return invalidEvidence("initial conclusive quarantine requires one exact run result")
  const record = matching[0]
  return record !== undefined && runResultMatches(record, run) && record.position > start.position
    ? validEvidence(record)
    : invalidEvidence("run-result evidence is foreign or does not match the conclusive result")
}

const validateNotPreparedEvidence = (
  candidateEvents: ReadonlyArray<JournalRecord>,
  result: NotPreparedInput,
  resultRecord: RunResultRecord
): EvidenceValidation<ConclusiveBasis> => {
  if (resultRecord.event.result._tag !== "NotPrepared" || resultRecord.event.result.detail !== result.detail) {
    return invalidEvidence("run-result evidence is foreign or does not match NotPrepared")
  }
  return candidateEvents.length === 0
    ? validEvidence(conclusiveBasisFor(result, resultRecord.position))
    : invalidEvidence("NotPrepared cannot have run-bound Git candidate evidence")
}

const candidateEventsNameForeignCandidate = (
  records: ReadonlyArray<JournalRecord>,
  candidateText: CandidateText
): boolean =>
  records.some(
    ({ event }) =>
      (event._tag === "IntegratorRunCandidateGitReadIntended" || event._tag === "IntegratorRunCandidateGitObserved") &&
      event.candidateText !== candidateText
  )

const candidateEventsUseForeignKey = (records: ReadonlyArray<JournalRecord>, result: CandidateRejectedInput): boolean =>
  records.some(
    (record) =>
      record.event._tag === "IntegratorRunCandidateGitReadIntended" &&
      record.key !== integratorRunCandidateGitReadIntendedRecordKey(result.run, result.candidateText)
  ) ||
  records.some(
    (record) =>
      record.event._tag === "IntegratorRunCandidateGitObserved" &&
      record.key !== integratorRunCandidateGitObservedRecordKey(result.run, result.candidateText)
  )

const candidateObservationChronologyIsExact = (
  result: CandidateRejectedInput,
  resultRecord: RunResultRecord,
  readIntent: JournalRecord,
  observation: JournalRecord
): boolean =>
  readIntentMatches(readIntent, result.run, result.candidateText) &&
  observationMatches(observation, result.run, result.candidateText) &&
  observation.position > readIntent.position &&
  readIntent.position > resultRecord.position &&
  gitObservationEquivalence(observation.event.observation, result.observation) &&
  !integratorCandidateHasExactParents(
    result.observation,
    result.run.session.expectedTargetHead,
    result.run.session.acceptedResult.commit
  )

const recordedPreparedCandidateMatches = (result: CandidateRejectedInput, record: RunResultRecord): boolean =>
  record.event.result._tag === "PreparedCandidate" && record.event.result.candidateText === result.candidateText

const resolveCandidateReadEvidence = (
  records: ReadonlyArray<JournalRecord>,
  result: CandidateRejectedInput
): EvidenceValidation<{ readonly observation: JournalRecord; readonly readIntent: JournalRecord }> => {
  const readIntent = exactRecordAt(
    records,
    integratorRunCandidateGitReadIntendedRecordKey(result.run, result.candidateText)
  )
  const observation = exactRecordAt(
    records,
    integratorRunCandidateGitObservedRecordKey(result.run, result.candidateText)
  )
  if (typeof readIntent === "string") return invalidEvidence(readIntent)
  if (typeof observation === "string") return invalidEvidence(observation)
  return readIntent !== undefined && observation !== undefined
    ? validEvidence({ observation, readIntent })
    : invalidEvidence("candidate rejection lacks the exact invalid Git observation chronology")
}

const validateCandidateRejectedEvidence = (
  records: ReadonlyArray<JournalRecord>,
  candidateEvents: ReadonlyArray<JournalRecord>,
  result: CandidateRejectedInput,
  resultRecord: RunResultRecord
): EvidenceValidation<ConclusiveBasis> => {
  if (!recordedPreparedCandidateMatches(result, resultRecord)) {
    return invalidEvidence("run-result evidence is foreign or does not match the prepared candidate")
  }
  if (candidateEventsNameForeignCandidate(candidateEvents, result.candidateText)) {
    return invalidEvidence("run-bound Git evidence names a foreign candidate")
  }
  if (candidateEventsUseForeignKey(candidateEvents, result)) {
    return invalidEvidence("run-bound Git evidence appears under a foreign key")
  }
  const resolved = resolveCandidateReadEvidence(records, result)
  if (resolved._tag === "Invalid") return resolved
  return candidateObservationChronologyIsExact(
    result,
    resultRecord,
    resolved.value.readIntent,
    resolved.value.observation
  )
    ? validEvidence(conclusiveBasisFor(result, resultRecord.position, resolved.value.observation.position))
    : invalidEvidence("candidate rejection lacks the exact invalid Git observation chronology")
}

const validateModernRunEvidence = (
  records: ReadonlyArray<JournalRecord>,
  result: InitialConclusiveIntegrationQuarantineInput
): EvidenceValidation<ConclusiveBasis> => {
  const run = result.run
  if (run.ordinal !== 1) return invalidEvidence("initial conclusive quarantine requires Integrator run 1")
  if (hasLegacySessionEvidence(records, run)) {
    return invalidEvidence("legacy session-only Integrator evidence cannot create modern run quarantine")
  }
  const session = validateFixedSession(records, run)
  if (session._tag === "Invalid") return session
  const start = validateRunStart(records, run, session.value)
  if (start._tag === "Invalid") return start
  const recordedResult = validateRunResult(records, run, start.value)
  if (recordedResult._tag === "Invalid") return recordedResult
  const candidateEvents = records.filter((record) => sameRunCandidateEvent(record, run))
  return result._tag === "NotPrepared"
    ? validateNotPreparedEvidence(candidateEvents, result, recordedResult.value)
    : validateCandidateRejectedEvidence(records, candidateEvents, result, recordedResult.value)
}

/** Records Q for one exact modern run-1 conclusive result before target ownership is released. */
export const appendInitialConclusiveIntegrationQuarantine = Effect.fn(
  "IntegrationQuarantine.appendInitialConclusiveIntegrationQuarantine"
)(function* (result: InitialConclusiveIntegrationQuarantineInput) {
  const journal = yield* InRunJournal
  const run = result.run
  const runId = runIdFor(run)
  const records = yield* journal.read(runId)
  const validation = validateModernRunEvidence(records, result)
  if (validation._tag === "Invalid") return yield* reject(run, validation.detail)

  const basis = validation.value
  const key = integrationQuarantinedRecordKey(run.session.sessionId, basis)
  const event = IntegrationQuarantinedEvent.make({
    basis,
    correlation: run.session,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const existingAtKey = exactRecordAt(records, key)
  if (typeof existingAtKey === "string") return yield* reject(run, existingAtKey)
  if (existingAtKey !== undefined) {
    return sameExpectedQuarantine(existingAtKey, run, key, event)
      ? existingAtKey
      : yield* reject(run, "initial conclusive quarantine key contains a foreign event")
  }
  const duplicate = records.filter(
    (record) => record.event._tag === "IntegrationQuarantined" && quarantineEventEquivalence(record.event, event)
  )
  if (duplicate.length > 0) return yield* reject(run, "initial conclusive quarantine exists under a foreign key")

  const appended = yield* journal.append(runId, key, event).pipe(
    Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
      Effect.gen(function* () {
        const refreshed = yield* journal.read(runId)
        const winner = refreshed.find((record) => record.position === existingPosition)
        if (winner !== undefined && sameExpectedQuarantine(winner, run, key, event)) return winner
        return yield* reject(run, "initial conclusive quarantine append contradicted existing Journal history")
      })
    )
  )
  return sameExpectedQuarantine(appended, run, key, event)
    ? appended
    : yield* reject(run, "initial conclusive quarantine append returned a foreign Journal record")
})
