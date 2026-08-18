/* eslint-disable max-lines -- One chronological validator owns the exact run-one, Q, D, and fresh-lineage Retry relation. */
import { plannedTaskAttemptEquivalence, IntegrationTarget } from "@dalph/contracts"
import { Schema } from "effect"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integratorRunCandidateGitObservedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  type IntegrationQuarantineBasis,
  type IntegrationQuarantineDirectionAppliedEvent,
  type IntegrationQuarantinedEvent
} from "../integration-quarantine/events.js"
import type { IntegratorRunPreparationInput } from "./session.js"
import { integratorRunCorrelationForSession } from "./session.js"
import {
  IntegratorGitObservation,
  type IntegratorCandidateText,
  type IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  integratorRetryRunOrdinal,
  integratorRunCorrelationsEqual
} from "./events.js"
import { integratorCorrelationsEqual, integratorResponsibilityFactsFromCorrelation } from "./state.js"

type SessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSessionFixed" }>
}
type RunStartedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunStarted" }>
}
type RunResultRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunResultRecorded" }>
}
type CandidateObservationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunCandidateGitObserved" }>
}
type ProviderAbsenceRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationProviderRunActivityAbsent" }>
}
type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }
type DirectionRecord = JournalRecord & { readonly event: IntegrationQuarantineDirectionAppliedEvent }
type TargetLineageRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetLineageObserved" }>
}
type GitReadIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "GitReadIntentRecorded" }>
}

/** The exact ordinal-one result chronology that permits an operator Retry. */
type IntegratorRetryOrdinalOneEvidence =
  | {
      readonly _tag: "ConclusiveResult"
      readonly run: RunStartedRecord
      readonly result: RunResultRecord
      readonly candidateObservation?: CandidateObservationRecord
    }
  | { readonly _tag: "ProviderRunFailure"; readonly run: RunStartedRecord; readonly absence: ProviderAbsenceRecord }

/** The fresh Git read pair that proves the target lineage after Retry. */
type IntegratorRetryLineage = { readonly intent: GitReadIntentRecord; readonly observation: TargetLineageRecord }

/** One exact `(S, E, Q, D, L)` Retry relation reconstructed from Journal records. */
export type IntegratorRetryAuthorization = {
  readonly session: IntegratorRunCorrelation["session"]
  readonly sessionRecord: SessionRecord
  readonly ordinalOneEvidence: IntegratorRetryOrdinalOneEvidence
  readonly quarantine: QuarantineRecord
  readonly direction: DirectionRecord
  readonly lineage: IntegratorRetryLineage
  readonly run: IntegratorRunCorrelation
}

/** Result of checking one requested ordinal-two run against the exact Retry relation. */
type IntegratorRetryAuthorizationResult =
  | { readonly _tag: "Authorized"; readonly authorization: IntegratorRetryAuthorization }
  | { readonly _tag: "Rejected"; readonly detail: string }

/** Bounds used while reconstructing the fresh lineage pair for one Retry relation. */
type IntegratorRetryAuthorizationOptions = {
  readonly beforePosition?: JournalPosition
  readonly requiredTargetLineageObservedAt?: JournalPosition
}

const targetLineageObservationEquivalence = Schema.toEquivalence(TargetLineageObservation)
const integrationTargetEquivalence = Schema.toEquivalence(IntegrationTarget)
const integratorGitObservationEquivalence = Schema.toEquivalence(IntegratorGitObservation)

const rejected = (detail: string): IntegratorRetryAuthorizationResult => ({ _tag: "Rejected", detail })

const recordsAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): ReadonlyArray<JournalRecord> =>
  records.filter((record) => record.position === position)

const oneRecordAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalRecord | undefined => {
  const matches = recordsAt(records, position)
  return matches.length === 1 ? matches[0] : undefined
}

const isSessionRecord = (record: JournalRecord): record is SessionRecord =>
  record.event._tag === "IntegratorSessionFixed"
const isRunStartedRecord = (record: JournalRecord): record is RunStartedRecord =>
  record.event._tag === "IntegratorRunStarted"
const isRunResultRecord = (record: JournalRecord): record is RunResultRecord =>
  record.event._tag === "IntegratorRunResultRecorded"
const isCandidateObservationRecord = (record: JournalRecord): record is CandidateObservationRecord =>
  record.event._tag === "IntegratorRunCandidateGitObserved"
const isProviderAbsenceRecord = (record: JournalRecord): record is ProviderAbsenceRecord =>
  record.event._tag === "IntegrationProviderRunActivityAbsent"
const isQuarantineRecord = (record: JournalRecord): record is QuarantineRecord =>
  record.event._tag === "IntegrationQuarantined"
const isDirectionRecord = (record: JournalRecord): record is DirectionRecord =>
  record.event._tag === "IntegrationQuarantineDirectionApplied"
const isTargetLineageRecord = (record: JournalRecord): record is TargetLineageRecord =>
  record.event._tag === "TargetLineageObserved"
const isGitReadIntentRecord = (record: JournalRecord): record is GitReadIntentRecord =>
  record.event._tag === "GitReadIntentRecorded"

const runIdFor = (run: IntegratorRunCorrelation) => run.session.plannedAttempt.runId

const hasForeignRunRecord = (records: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean =>
  records.some((record) => record.runId !== runIdFor(run))

const hasDuplicateRecordIdentity = (records: ReadonlyArray<JournalRecord>): boolean =>
  records.some(
    (record, index) =>
      records.findIndex((candidate) => candidate.position === record.position) !== index ||
      records.findIndex((candidate) => candidate.key === record.key) !== index
  )

const exactSessionRecord = (
  records: ReadonlyArray<JournalRecord>,
  session: IntegratorRunCorrelation["session"]
): SessionRecord | undefined => {
  const key = integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session))
  const matches = records.filter(
    (record): record is SessionRecord =>
      isSessionRecord(record) &&
      record.runId === session.plannedAttempt.runId &&
      record.key === key &&
      record.position > session.targetLineageObservedAt &&
      integratorCorrelationsEqual(record.event.correlation, session)
  )
  return matches.length === 1 ? matches[0] : undefined
}

const exactRunStart = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  sessionRecord: SessionRecord,
  beforePosition: JournalPosition
): RunStartedRecord | undefined => {
  const matches = records.filter(
    (record): record is RunStartedRecord =>
      isRunStartedRecord(record) &&
      record.runId === runIdFor(run) &&
      record.key === integratorRunStartedRecordKey(run) &&
      record.position > sessionRecord.position &&
      record.position < beforePosition &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  return matches.length === 1 ? matches[0] : undefined
}

const exactRunResult = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  recordedAt: JournalPosition,
  beforePosition: JournalPosition
): RunResultRecord | undefined => {
  const record = oneRecordAt(records, recordedAt)
  return record !== undefined && runResultMatches(record, run, start, beforePosition) ? record : undefined
}

const runResultMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  beforePosition: JournalPosition
): record is RunResultRecord =>
  isRunResultRecord(record) &&
  record.runId === runIdFor(run) &&
  record.key === integratorRunResultRecordedRecordKey(run) &&
  record.position > start.position &&
  record.position < beforePosition &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  integratorCorrelationsEqual(record.event.result.correlation, run.session)

const exactCandidateObservation = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  result: RunResultRecord,
  candidateText: IntegratorCandidateText,
  observedAt: JournalPosition,
  beforePosition: JournalPosition
): CandidateObservationRecord | undefined => {
  const record = oneRecordAt(records, observedAt)
  return record !== undefined && candidateObservationMatches(record, run, start, result, candidateText, beforePosition)
    ? record
    : undefined
}

const candidateObservationMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  result: RunResultRecord,
  candidateText: IntegratorCandidateText,
  beforePosition: JournalPosition
): record is CandidateObservationRecord =>
  isCandidateObservationRecord(record) &&
  record.runId === runIdFor(run) &&
  record.key === integratorRunCandidateGitObservedRecordKey(run, candidateText) &&
  record.event.candidateText === candidateText &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  record.position > result.position &&
  record.position < beforePosition &&
  record.position > start.position

const conclusiveResultEvidence = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  quarantine: QuarantineRecord
): IntegratorRetryOrdinalOneEvidence | undefined => {
  if (quarantine.event.basis._tag !== "ConclusiveResult") return undefined
  const { cause, evidence } = quarantine.event.basis
  const result = exactRunResult(records, run, start, evidence.resultRecordedAt, quarantine.position)
  if (result === undefined) return undefined
  return cause._tag === "NotPrepared"
    ? notPreparedEvidence(cause.detail, result, start)
    : preparedCandidateEvidence(
        records,
        run,
        start,
        result,
        cause,
        evidence.candidateObservationAt,
        quarantine.position
      )
}

const notPreparedEvidence = (
  detail: string,
  result: RunResultRecord,
  start: RunStartedRecord
): IntegratorRetryOrdinalOneEvidence | undefined =>
  result.event.result._tag === "NotPrepared" && result.event.result.detail === detail
    ? { _tag: "ConclusiveResult", run: start, result }
    : undefined

const preparedCandidateEvidence = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  result: RunResultRecord,
  cause: Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>["cause"] & {
    readonly _tag: "InvalidCandidate"
  },
  observationAt: JournalPosition | undefined,
  beforePosition: JournalPosition
): IntegratorRetryOrdinalOneEvidence | undefined => {
  if (result.event.result._tag !== "PreparedCandidate" || result.event.result.candidateText !== cause.candidateText) {
    return undefined
  }
  if (observationAt === undefined) return undefined
  const observation = exactCandidateObservation(
    records,
    run,
    start,
    result,
    cause.candidateText,
    observationAt,
    beforePosition
  )
  return observation !== undefined &&
    integratorGitObservationEquivalence(observation.event.observation, cause.observation)
    ? { _tag: "ConclusiveResult", run: start, result, candidateObservation: observation }
    : undefined
}

const providerFailureEvidence = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  quarantine: QuarantineRecord
): IntegratorRetryOrdinalOneEvidence | undefined => {
  if (quarantine.event.basis._tag !== "ProviderRunFailure") return undefined
  const record = oneRecordAt(records, quarantine.event.basis.ownedActivityProvenAbsentAt)
  return record !== undefined && providerAbsenceMatches(record, run, start, quarantine)
    ? { _tag: "ProviderRunFailure", run: start, absence: record }
    : undefined
}

const providerAbsenceMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  quarantine: QuarantineRecord
): record is ProviderAbsenceRecord =>
  quarantine.event.basis._tag === "ProviderRunFailure" &&
  isProviderAbsenceRecord(record) &&
  record.runId === runIdFor(run) &&
  record.position > start.position &&
  record.position < quarantine.position &&
  record.event.detail === quarantine.event.basis.detail &&
  integratorCorrelationsEqual(record.event.correlation, run.session)

const ordinalOneEvidence = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  sessionRecord: SessionRecord,
  quarantine: QuarantineRecord
): IntegratorRetryOrdinalOneEvidence | undefined => {
  const runOne = integratorRunCorrelationForSession(run.session, IntegratorRunOrdinal.make(1))
  const start = exactRunStart(records, runOne, sessionRecord, quarantine.position)
  return start === undefined
    ? undefined
    : (conclusiveResultEvidence(records, runOne, start, quarantine) ??
        providerFailureEvidence(records, runOne, start, quarantine))
}

const exactDirectionAndQuarantine = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): { readonly direction: DirectionRecord; readonly quarantine: QuarantineRecord } | string => {
  const runId = runIdFor(run)
  const retryDirections = records.filter(
    (record): record is DirectionRecord =>
      isDirectionRecord(record) &&
      record.runId === runId &&
      record.event.requestId.runId === runId &&
      record.event.fingerprint.direction === "Retry" &&
      record.event.fingerprint.sessionId === run.session.sessionId
  )
  if (retryDirections.length !== 1) return "Retry requires one exact applied Retry direction for its session and Run"
  const direction = retryDirections[0]
  if (direction === undefined) return "Retry requires one exact applied Retry direction for its session and Run"
  if (!hasUniqueDirectionSubject(records, run, direction))
    return "Retry must be the unique winning quarantine direction"
  const quarantine = exactPriorQuarantine(records, run, direction)
  return quarantine === undefined
    ? "Retry direction has no exact earlier ordinal-one quarantine"
    : { direction, quarantine }
}

const hasUniqueDirectionSubject = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  direction: DirectionRecord
): boolean =>
  records.filter(
    (record) =>
      isDirectionRecord(record) &&
      record.event.fingerprint.sessionId === run.session.sessionId &&
      record.event.fingerprint.quarantineAt === direction.event.fingerprint.quarantineAt
  ).length === 1

const exactPriorQuarantine = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  direction: DirectionRecord
): QuarantineRecord | undefined => {
  const quarantine = oneRecordAt(records, direction.event.fingerprint.quarantineAt)
  if (quarantine === undefined || !isQuarantineRecord(quarantine)) return undefined
  return quarantine.runId === runIdFor(run) &&
    quarantine.position < direction.position &&
    quarantine.event.basis._tag !== "RetryTargetHeadChanged" &&
    integratorCorrelationsEqual(quarantine.event.correlation, run.session)
    ? quarantine
    : undefined
}

const freshLineage = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  direction: DirectionRecord,
  options: IntegratorRetryAuthorizationOptions
): IntegratorRetryLineage | undefined => {
  const observations = records
    .filter((record): record is TargetLineageRecord => isFreshLineageObservation(record, run, direction, options))
    .toSorted((left, right) => Number(right.position) - Number(left.position))
  for (const observation of observations) {
    const sameOperationObservations = records.filter(
      (record) => isTargetLineageRecord(record) && record.event.operationId === observation.event.operationId
    )
    const intents = records.filter((record): record is GitReadIntentRecord =>
      isMatchingLineageIntent(record, run, observation, direction)
    )
    if (sameOperationObservations.length === 1 && intents.length === 1) {
      const intent = intents[0]
      if (intent !== undefined) return { intent, observation }
    }
  }
  return undefined
}

const isFreshLineageObservation = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  direction: DirectionRecord,
  options: IntegratorRetryAuthorizationOptions
): record is TargetLineageRecord =>
  isTargetLineageRecord(record) && isFreshLineageObservationForRun(record, run, direction, options)

const isFreshLineageObservationForRun = (
  record: TargetLineageRecord,
  run: IntegratorRunCorrelation,
  direction: DirectionRecord,
  options: IntegratorRetryAuthorizationOptions
): boolean =>
  record.runId === runIdFor(run) &&
  record.position > direction.position &&
  isLineagePositionWithinBounds(record.position, options) &&
  plannedTaskAttemptEquivalence(record.event.plannedAttempt, run.session.plannedAttempt) &&
  record.event.observation.plannedBaseSha === run.session.plannedAttempt.baseSha &&
  record.event.observation.plannedBaseIsAncestorOfTargetHead

const isLineagePositionWithinBounds = (
  position: JournalPosition,
  options: IntegratorRetryAuthorizationOptions
): boolean =>
  (options.beforePosition === undefined || position < options.beforePosition) &&
  (options.requiredTargetLineageObservedAt === undefined || position === options.requiredTargetLineageObservedAt)

const isMatchingLineageIntent = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  observation: TargetLineageRecord,
  direction: DirectionRecord
): record is GitReadIntentRecord =>
  isGitReadIntentRecord(record) &&
  record.runId === runIdFor(run) &&
  record.event.operation._tag === "ReadTargetLineage" &&
  record.event.operation.operationId === observation.event.operationId &&
  record.position > direction.position &&
  record.position < observation.position &&
  plannedTaskAttemptEquivalence(record.event.operation.plannedAttempt, run.session.plannedAttempt) &&
  integrationTargetEquivalence(record.event.operation.integrationTarget, run.session.integrationTarget)

const exactSessionQuarantines = (records: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean =>
  records.every(
    (record) =>
      !isQuarantineRecord(record) ||
      record.event.correlation.sessionId !== run.session.sessionId ||
      (record.runId === runIdFor(run) && integratorCorrelationsEqual(record.event.correlation, run.session))
  )

/**
 * Reconstructs the one exact Retry relation used by both run-two admission and
 * changed-head Q2 recording. A session-only result is intentionally not an
 * ordinal-one evidence variant and therefore cannot authorize this relation.
 */
export const evaluateIntegratorRetryAuthorization = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  options: IntegratorRetryAuthorizationOptions = {}
): IntegratorRetryAuthorizationResult => {
  if (run.ordinal !== integratorRetryRunOrdinal) return rejected("Retry authorization applies only to run ordinal two")
  const preflightIssue = retryPreflightIssue(records, run)
  if (preflightIssue !== undefined) return rejected(preflightIssue)
  return authorizeRetryRelation(records, run, options)
}

const retryPreflightIssue = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): string | undefined => {
  if (hasForeignRunRecord(records, run) || hasDuplicateRecordIdentity(records)) {
    return "Retry authorization requires one exact Journal history for the Run"
  }
  if (
    records.some(
      (record) =>
        isQuarantineRecord(record) &&
        record.event.basis._tag === "RetryTargetHeadChanged" &&
        integratorCorrelationsEqual(record.event.correlation, run.session)
    )
  ) {
    return "Retry authorization was terminated by a changed-head quarantine"
  }
  return exactSessionQuarantines(records, run)
    ? undefined
    : "Retry history contains a foreign or wrongly keyed quarantine"
}

const authorizeRetryRelation = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  options: IntegratorRetryAuthorizationOptions
): IntegratorRetryAuthorizationResult => {
  const sessionRecord = exactSessionRecord(records, run.session)
  if (sessionRecord === undefined) return rejected("Retry has no exact fixed session S")
  const directionAndQuarantine = exactDirectionAndQuarantine(records, run)
  if (typeof directionAndQuarantine === "string") return rejected(directionAndQuarantine)
  const evidence = ordinalOneEvidence(records, run, sessionRecord, directionAndQuarantine.quarantine)
  if (evidence === undefined) return rejected("Retry quarantine has no exact modern ordinal-one terminal evidence")
  const lineage = freshLineage(records, run, directionAndQuarantine.direction, options)
  if (lineage === undefined)
    return rejected("Retry requires one fresh matching target-lineage intent and observation L")
  return {
    _tag: "Authorized",
    authorization: {
      direction: directionAndQuarantine.direction,
      lineage,
      ordinalOneEvidence: evidence,
      quarantine: directionAndQuarantine.quarantine,
      run,
      session: run.session,
      sessionRecord
    }
  }
}

/** Pure reconstruction validator for the exact unchanged-head chronology preceding an ordinal-two start. */
export const integratorRunTwoAuthorizationIssue = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  options: { readonly beforePosition: JournalPosition; readonly requiredTargetLineageObservedAt?: JournalPosition }
): string | undefined => {
  const result = evaluateIntegratorRetryAuthorization(records, run, options)
  if (result._tag === "Rejected") return result.detail
  return result.authorization.lineage.observation.event.observation.targetHeadSha === run.session.expectedTargetHead
    ? undefined
    : "run two requires a fresh matching unchanged target-lineage intent and observation after Retry"
}

/**
 * Returns why a requested run-two preparation lacks the same exact Retry
 * relation. The caller retains the separate changed-head result after this
 * relation has proved the fresh Git read chronology.
 */
export const integratorRetryAuthorizationIssue = (
  records: ReadonlyArray<JournalRecord>,
  request: IntegratorRunPreparationInput
): string | undefined => {
  const existingRunStarts = records.filter(
    (record): record is RunStartedRecord =>
      isRunStartedRecord(record) &&
      record.event.run.ordinal === integratorRetryRunOrdinal &&
      integratorCorrelationsEqual(record.event.run.session, request.run.session)
  )
  const beforePosition = existingRunStarts.length === 1 ? existingRunStarts[0]?.position : undefined
  const options: IntegratorRetryAuthorizationOptions =
    beforePosition === undefined
      ? { requiredTargetLineageObservedAt: request.preparation.targetLineageObservedAt }
      : { beforePosition, requiredTargetLineageObservedAt: request.preparation.targetLineageObservedAt }
  const result = evaluateIntegratorRetryAuthorization(records, request.run, options)
  if (result._tag === "Rejected") return result.detail
  return targetLineageObservationEquivalence(
    result.authorization.lineage.observation.event.observation,
    request.preparation.targetLineage
  )
    ? undefined
    : "Retry target-lineage input does not match its exact Journal observation"
}
