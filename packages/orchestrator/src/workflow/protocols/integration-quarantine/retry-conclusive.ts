import { Effect, Schema } from "effect"
import {
  integrationQuarantinedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { exactJournalRecordAtKey } from "../../../workflow-journal/exact-record.js"
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
  integratorRunCorrelationsEqual,
  integratorRetryRunOrdinal,
  IntegratorRunProtocolResult
} from "../integrator/events.js"
import type { IntegratorRunCorrelation } from "../integrator/events.js"
import { IntegratorJournalContradiction } from "../integrator/errors.js"
import { evaluateIntegratorRetryAuthorization } from "../integrator/retry-authorization.js"
import { integratorCorrelationsEqual } from "../integrator/state.js"

type NotPreparedInput = Extract<IntegratorRunProtocolResult, { readonly _tag: "NotPrepared" }>
type CandidateRejectedInput = Extract<IntegratorRunProtocolResult, { readonly _tag: "CandidateRejected" }>

/** The only Retry run-two results that are conclusive enough to create Q2. */
export type RetryConclusiveIntegrationQuarantineInput = NotPreparedInput | CandidateRejectedInput

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
type ConclusiveBasis = Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>

type EvidenceValidation<Value> =
  | { readonly _tag: "Valid"; readonly value: Value }
  | { readonly _tag: "Invalid"; readonly detail: string }

const quarantineEventEquivalence = Schema.toEquivalence(IntegrationQuarantinedEvent)
const gitObservationEquivalence = Schema.toEquivalence(IntegratorGitObservation)

const runIdFor = (run: IntegratorRunCorrelation) => run.session.plannedAttempt.runId

const reject = (run: IntegratorRunCorrelation, detail: string): Effect.Effect<never, IntegratorJournalContradiction> =>
  Effect.fail(new IntegratorJournalContradiction({ detail, runId: runIdFor(run) }))

const invalidEvidence = (detail: string): EvidenceValidation<never> => ({ _tag: "Invalid", detail })
const validEvidence = <Value>(value: Value): EvidenceValidation<Value> => ({ _tag: "Valid", value })

const runStartMatches = (record: JournalRecord, run: IntegratorRunCorrelation): record is RunStartedRecord =>
  record.event._tag === "IntegratorRunStarted" &&
  record.runId === runIdFor(run) &&
  record.key === integratorRunStartedRecordKey(run) &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  record.position > run.session.targetLineageObservedAt

const runResultMatches = (
  record: JournalRecord,
  input: RetryConclusiveIntegrationQuarantineInput,
  start: RunStartedRecord
): record is RunResultRecord => {
  const run = input.run
  return runResultRecordMatches(record, run, start) && runResultOutcomeMatches(record, input)
}

const runResultRecordMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord
): record is RunResultRecord =>
  record.event._tag === "IntegratorRunResultRecorded" &&
  record.runId === runIdFor(run) &&
  record.key === integratorRunResultRecordedRecordKey(run) &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  integratorCorrelationsEqual(record.event.result.correlation, run.session) &&
  record.position > start.position

const runResultOutcomeMatches = (record: RunResultRecord, input: RetryConclusiveIntegrationQuarantineInput): boolean =>
  input._tag === "NotPrepared"
    ? record.event.result._tag === "NotPrepared" && record.event.result.detail === input.detail
    : record.event.result._tag === "PreparedCandidate" && record.event.result.candidateText === input.candidateText

const sameRunCandidateEvent = (record: JournalRecord, run: IntegratorRunCorrelation): boolean =>
  (record.event._tag === "IntegratorRunCandidateGitReadIntended" ||
    record.event._tag === "IntegratorRunCandidateGitObserved") &&
  record.runId === runIdFor(run) &&
  integratorRunCorrelationsEqual(record.event.run, run)

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
  result: RetryConclusiveIntegrationQuarantineInput,
  resultRecordedAt: JournalPosition,
  candidateObservationAt?: JournalPosition
): ConclusiveBasis =>
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

const validateRunStart = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): EvidenceValidation<RunStartedRecord> => {
  const key = integratorRunStartedRecordKey(run)
  const atKey = exactJournalRecordAtKey(records, key)
  if (atKey._tag === "Duplicate") return invalidEvidence(atKey.detail)
  if (atKey._tag === "Found" && !runStartMatches(atKey.record, run)) {
    return invalidEvidence("Retry run-two start key contains foreign evidence")
  }
  const matching = records.filter(
    (record): record is RunStartedRecord =>
      record.event._tag === "IntegratorRunStarted" &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (matching.some((record) => record.key !== key)) {
    return invalidEvidence("Retry run-two start evidence appears under a foreign key")
  }
  if (matching.length !== 1) return invalidEvidence("Retry conclusive quarantine requires one exact run-two start")
  const start = matching[0]
  /* v8 ignore next -- @preserve matching.length === 1 makes index zero defined; this guard protects the typed boundary if Array indexing semantics change. */
  return start !== undefined && runStartMatches(start, run)
    ? validEvidence(start)
    : invalidEvidence("Retry run-two start evidence is foreign or precedes the fixed lineage")
}

const validateRunResult = (
  records: ReadonlyArray<JournalRecord>,
  input: RetryConclusiveIntegrationQuarantineInput,
  start: RunStartedRecord
): EvidenceValidation<RunResultRecord> => {
  const run = input.run
  const key = integratorRunResultRecordedRecordKey(run)
  const atKey = exactJournalRecordAtKey(records, key)
  /* v8 ignore next -- @preserve retryPreflightIssue rejects duplicate run-result identities before this exact-key validation. */
  if (atKey._tag === "Duplicate") return invalidEvidence(atKey.detail)
  if (atKey._tag === "Found" && !runResultMatches(atKey.record, input, start)) {
    return invalidEvidence("Retry run-two result key contains foreign or contradictory evidence")
  }
  const matching = records.filter(
    (record): record is RunResultRecord =>
      record.event._tag === "IntegratorRunResultRecorded" &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (matching.some((record) => record.key !== key)) {
    return invalidEvidence("Retry run-two result evidence appears under a foreign key")
  }
  if (matching.length !== 1) return invalidEvidence("Retry conclusive quarantine requires one exact run-two result")
  const result = matching[0]
  /* v8 ignore next -- @preserve matching.length === 1 makes index zero defined; this guard protects the typed boundary if Array indexing semantics change. */
  return result !== undefined && runResultMatches(result, input, start)
    ? validEvidence(result)
    : invalidEvidence("Retry run-two result does not match the conclusive input")
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

const validateNotPreparedEvidence = (
  candidateEvents: ReadonlyArray<JournalRecord>,
  result: NotPreparedInput,
  resultRecord: RunResultRecord
): EvidenceValidation<ConclusiveBasis> => {
  /* v8 ignore next -- @preserve validateRunResult already proves the exact NotPrepared tag and detail for this branch. */
  if (resultRecord.event.result._tag !== "NotPrepared" || resultRecord.event.result.detail !== result.detail) {
    return invalidEvidence("Retry run-two result does not match NotPrepared")
  }
  return candidateEvents.length === 0
    ? validEvidence(conclusiveBasisFor(result, resultRecord.position))
    : invalidEvidence("NotPrepared cannot have run-two Git candidate evidence")
}

interface ExactCandidateEvidence {
  readonly observation: JournalRecord
  readonly readIntent: JournalRecord
}

const exactCandidateEvidence = (
  records: ReadonlyArray<JournalRecord>,
  result: CandidateRejectedInput
): EvidenceValidation<ExactCandidateEvidence> => {
  const readIntentLookup = exactJournalRecordAtKey(
    records,
    integratorRunCandidateGitReadIntendedRecordKey(result.run, result.candidateText)
  )
  const observationLookup = exactJournalRecordAtKey(
    records,
    integratorRunCandidateGitObservedRecordKey(result.run, result.candidateText)
  )
  /* v8 ignore next -- @preserve retryPreflightIssue rejects duplicate candidate-read identities before this lookup. */
  if (readIntentLookup._tag === "Duplicate") return invalidEvidence(readIntentLookup.detail)
  /* v8 ignore next -- @preserve retryPreflightIssue rejects duplicate candidate-observation identities before this lookup. */
  if (observationLookup._tag === "Duplicate") return invalidEvidence(observationLookup.detail)
  if (readIntentLookup._tag === "Missing" || observationLookup._tag === "Missing") {
    return invalidEvidence("Retry candidate rejection lacks the exact invalid Git observation chronology")
  }
  return validEvidence({ observation: observationLookup.record, readIntent: readIntentLookup.record })
}

const candidateChronologyIsExact = (
  evidence: ExactCandidateEvidence,
  result: CandidateRejectedInput,
  resultRecord: RunResultRecord
): boolean =>
  readIntentMatches(evidence.readIntent, result.run, result.candidateText) &&
  observationMatches(evidence.observation, result.run, result.candidateText) &&
  evidence.observation.position > evidence.readIntent.position &&
  evidence.readIntent.position > resultRecord.position &&
  gitObservationEquivalence(evidence.observation.event.observation, result.observation) &&
  !integratorCandidateHasExactParents(
    result.observation,
    result.run.session.expectedTargetHead,
    result.run.session.acceptedResult.commit
  )

const validateCandidateRejectedEvidence = (
  records: ReadonlyArray<JournalRecord>,
  candidateEvents: ReadonlyArray<JournalRecord>,
  result: CandidateRejectedInput,
  resultRecord: RunResultRecord
): EvidenceValidation<ConclusiveBasis> => {
  /* v8 ignore next -- @preserve validateRunResult already proves the exact PreparedCandidate tag and candidate text. */
  if (
    resultRecord.event.result._tag !== "PreparedCandidate" ||
    resultRecord.event.result.candidateText !== result.candidateText
  ) {
    return invalidEvidence("Retry run-two result does not match the prepared candidate")
  }
  if (candidateEventsNameForeignCandidate(candidateEvents, result.candidateText)) {
    return invalidEvidence("Retry run-two Git evidence names a foreign candidate")
  }
  if (candidateEventsUseForeignKey(candidateEvents, result)) {
    return invalidEvidence("Retry run-two Git evidence appears under a foreign key")
  }
  const evidence = exactCandidateEvidence(records, result)
  if (evidence._tag === "Invalid") return evidence
  return candidateChronologyIsExact(evidence.value, result, resultRecord)
    ? validEvidence(conclusiveBasisFor(result, resultRecord.position, evidence.value.observation.position))
    : invalidEvidence("Retry candidate rejection lacks the exact invalid Git observation chronology")
}

const validateHistory = (
  records: ReadonlyArray<JournalRecord>,
  result: RetryConclusiveIntegrationQuarantineInput
): EvidenceValidation<ConclusiveBasis> => {
  const run = result.run
  if (run.ordinal !== integratorRetryRunOrdinal) {
    return invalidEvidence("Retry conclusive quarantine requires Integrator run 2")
  }
  const start = validateRunStart(records, run)
  if (start._tag === "Invalid") return start

  const authorization = evaluateIntegratorRetryAuthorization(records, run, { beforePosition: start.value.position })
  if (authorization._tag === "Rejected") return invalidEvidence(authorization.detail)
  if (
    authorization.authorization.lineage.observation.event.observation.targetHeadSha !== run.session.expectedTargetHead
  ) {
    return invalidEvidence("Retry conclusive quarantine requires an unchanged fresh target head")
  }

  const recordedResult = validateRunResult(records, result, start.value)
  if (recordedResult._tag === "Invalid") return recordedResult
  const candidateEvents = records.filter((record) => sameRunCandidateEvent(record, run))
  return result._tag === "NotPrepared"
    ? validateNotPreparedEvidence(candidateEvents, result, recordedResult.value)
    : validateCandidateRejectedEvidence(records, candidateEvents, result, recordedResult.value)
}

/** Records Q2 for one exact Retry run-two conclusive result before ownership is released. */
export const appendRetryConclusiveIntegrationQuarantine = Effect.fn(
  "IntegrationQuarantine.appendRetryConclusiveIntegrationQuarantine"
)(function* (input: unknown) {
  const decoded = yield* Schema.decodeUnknownEffect(IntegratorRunProtocolResult, { onExcessProperty: "error" })(input)
  if (decoded._tag === "PreparedCandidate") {
    return yield* reject(decoded.run, "Retry conclusive quarantine accepts only NotPrepared or CandidateRejected")
  }
  const result: RetryConclusiveIntegrationQuarantineInput = decoded
  const journal = yield* InRunJournal
  const run = result.run
  const runId = runIdFor(run)
  const records = yield* journal.read(runId)
  const validation = validateHistory(records, result)
  if (validation._tag === "Invalid") return yield* reject(run, validation.detail)

  const basis = validation.value
  const key = integrationQuarantinedRecordKey(run.session.sessionId, basis)
  const event = IntegrationQuarantinedEvent.make({
    basis,
    correlation: run.session,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const existingAtKey = exactJournalRecordAtKey(records, key)
  /* v8 ignore next -- @preserve exactSessionQuarantines rejects duplicate Q2 identities before this append-side lookup. */
  if (existingAtKey._tag === "Duplicate") return yield* reject(run, existingAtKey.detail)
  if (existingAtKey._tag === "Found") {
    /* v8 ignore start -- @preserve the earlier exact-session scan admits only the same expected quarantine at this key. */
    return sameExpectedQuarantine(existingAtKey.record, run, key, event)
      ? existingAtKey.record
      : yield* reject(run, "Retry conclusive quarantine key contains a foreign event")
    /* v8 ignore stop -- @preserve */
  }
  const duplicate = records.filter(
    (record) => record.event._tag === "IntegrationQuarantined" && quarantineEventEquivalence(record.event, event)
  )
  /* v8 ignore next -- @preserve exactSessionQuarantines rejects an equivalent Q2 under another key before this duplicate scan. */
  if (duplicate.length > 0) {
    return yield* reject(run, "Retry conclusive quarantine exists under a foreign key")
  }

  const appended = yield* journal.append(runId, key, event).pipe(
    Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
      Effect.gen(function* () {
        const refreshed = yield* journal.read(runId)
        const winner = refreshed.find((record) => record.position === existingPosition)
        if (winner !== undefined && sameExpectedQuarantine(winner, run, key, event)) return winner
        return yield* reject(run, "Retry conclusive quarantine append contradicted existing Journal history")
      })
    )
  )
  return sameExpectedQuarantine(appended, run, key, event)
    ? appended
    : yield* reject(run, "Retry conclusive quarantine append returned a foreign Journal record")
})
