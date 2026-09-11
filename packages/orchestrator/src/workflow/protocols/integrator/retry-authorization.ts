/* eslint-disable max-lines -- One chronological validator owns the exact run-one, Q, D, and fresh-lineage Retry relation. */
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Schema } from "effect"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integratorRunCandidateGitObservedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integrationProviderRunActivityAbsentRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  isJournalRecordEvidence,
  journalRecordByPosition,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import {
  integrationQuarantineDirectionSubject,
  type IntegrationQuarantineBasis,
  type IntegrationQuarantineDirectionAppliedEvent,
  type IntegrationQuarantinedEvent
} from "../integration-quarantine/events.js"
import type { IntegratorRunPreparationInput } from "./session.js"
import {
  IntegratorGitObservation,
  type IntegratorCandidateText,
  IntegratorRunOrdinal,
  integratorRetryRunOrdinal,
  integratorRunCorrelationsEqual,
  IntegratorRunCorrelation
} from "./events.js"
import { integratorCorrelationsEqual, integratorResponsibilityFactsFromCorrelation } from "./state.js"
import { exactTargetLineageRecord } from "../integration-quarantine/canonical-lineage.js"
import { validatePromotionStaleQuarantineEvidence } from "../integration-quarantine/promotion-stale-evidence.js"
import { evaluateIntegratorFullRerunSuccessor } from "./successor-history.js"

type SessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSessionFixed" }>
}
type SuccessorSessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
}
type CanonicalSessionRecord = SessionRecord | SuccessorSessionRecord
type RunStartedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunStarted" }>
}
type RunResultRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunResultRecorded" }>
}
type CandidateObservationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunCandidateGitObserved" }>
}
type PromotionStaleRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetPromotionStale" }>
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
  | {
      readonly _tag: "PromotionStale"
      readonly run: RunStartedRecord
      readonly result: RunResultRecord
      readonly candidateObservation: CandidateObservationRecord
      readonly stale: PromotionStaleRecord
    }
  | { readonly _tag: "ProviderRunFailure"; readonly run: RunStartedRecord; readonly absence: ProviderAbsenceRecord }

/** The fresh Git read pair that proves the target lineage after Retry. */
type IntegratorRetryLineage = { readonly intent: GitReadIntentRecord; readonly observation: TargetLineageRecord }

/** One exact `(S, E, Q, D, L)` Retry relation reconstructed from Journal records. */
export type IntegratorRetryAuthorization = {
  readonly session: IntegratorRunCorrelation["session"]
  readonly sessionRecord: CanonicalSessionRecord
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
  /** FullRerun uses the same exact S1/Q/D/L reconstruction as Retry. */
  readonly predecessorSession?: IntegratorRunCorrelation["session"]
  readonly requiredDirection?: "Retry" | "FullRerun"
  readonly requiredTargetLineageObservedAt?: JournalPosition
}

const targetLineageObservationEquivalence = Schema.toEquivalence(TargetLineageObservation)
const integratorGitObservationEquivalence = Schema.toEquivalence(IntegratorGitObservation)

const rejected = (detail: string): IntegratorRetryAuthorizationResult => ({ _tag: "Rejected", detail })

const matchingOfKind = <A extends JournalRecord>(
  records: JournalHistorySource,
  kind: JournalRecord["event"]["_tag"],
  predicate: (record: JournalRecord) => record is A
): { readonly count: number; readonly first: A | undefined } => {
  let count = 0
  let first: A | undefined
  for (const record of journalRecordsOfKind(records, kind)) {
    if (!predicate(record)) continue
    count += 1
    first ??= record
  }
  return { count, first }
}

const someOfKind = (
  records: JournalHistorySource,
  kind: JournalRecord["event"]["_tag"],
  predicate: (record: JournalRecord) => boolean
): boolean => {
  for (const record of journalRecordsOfKind(records, kind)) if (predicate(record)) return true
  return false
}

const everyOfKind = (
  records: JournalHistorySource,
  kind: JournalRecord["event"]["_tag"],
  predicate: (record: JournalRecord) => boolean
): boolean => !someOfKind(records, kind, (record) => !predicate(record))

const recordsAt = (records: JournalHistorySource, position: JournalPosition): ReadonlyArray<JournalRecord> => {
  if (!isJournalRecordEvidence(records)) return records.filter((record) => record.position === position)
  const record = journalRecordByPosition(records, position)
  return record === undefined ? [] : [record]
}

const oneRecordAt = (records: JournalHistorySource, position: JournalPosition): JournalRecord | undefined => {
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
const runIdFor = (run: IntegratorRunCorrelation) => run.session.plannedAttempt.runId

const authoritySessionFor = (
  run: IntegratorRunCorrelation,
  options: IntegratorRetryAuthorizationOptions
): IntegratorRunCorrelation["session"] => options.predecessorSession ?? run.session

const hasForeignRunRecord = (records: JournalHistorySource, run: IntegratorRunCorrelation): boolean =>
  isJournalRecordEvidence(records) ? false : records.some((record) => record.runId !== runIdFor(run))

const hasDuplicateRecordIdentity = (records: JournalHistorySource): boolean =>
  isJournalRecordEvidence(records)
    ? false
    : records.some(
        (record, index) =>
          records.findIndex((candidate) => candidate.position === record.position) !== index ||
          records.findIndex((candidate) => candidate.key === record.key) !== index
      )

const exactSessionRecord = (
  records: JournalHistorySource,
  session: IntegratorRunCorrelation["session"],
  direction: "Retry" | "FullRerun",
  predecessorSession: IntegratorRunCorrelation["session"]
): CanonicalSessionRecord | undefined => {
  if (direction === "FullRerun") {
    const successors = matchingOfKind<SuccessorSessionRecord>(
      records,
      "IntegratorSuccessorSessionFixed",
      (record): record is SuccessorSessionRecord =>
        record.event._tag === "IntegratorSuccessorSessionFixed" &&
        record.runId === session.plannedAttempt.runId &&
        record.event.successor.sessionId === session.sessionId &&
        integratorCorrelationsEqual(record.event.successor, session) &&
        integratorCorrelationsEqual(record.event.predecessor, predecessorSession) &&
        record.key ===
          integratorSuccessorSessionFixedRecordKey(
            record.event.predecessor,
            record.event.quarantineAt,
            record.event.directionAppliedAt
          ) &&
        record.position > session.targetLineageObservedAt
    )
    return successors.count === 1 ? successors.first : undefined
  }
  const key = integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session))
  const matches = matchingOfKind<SessionRecord>(
    records,
    "IntegratorSessionFixed",
    (record): record is SessionRecord =>
      isSessionRecord(record) &&
      record.runId === session.plannedAttempt.runId &&
      record.key === key &&
      record.position > session.targetLineageObservedAt &&
      integratorCorrelationsEqual(record.event.correlation, session)
  )
  return matches.count === 1 ? matches.first : undefined
}

const exactRunStart = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  sessionRecord: CanonicalSessionRecord,
  beforePosition: JournalPosition
): RunStartedRecord | undefined => {
  const matches = matchingOfKind<RunStartedRecord>(
    records,
    "IntegratorRunStarted",
    (record): record is RunStartedRecord =>
      isRunStartedRecord(record) &&
      record.runId === runIdFor(run) &&
      record.key === integratorRunStartedRecordKey(run) &&
      record.position > sessionRecord.position &&
      record.position < beforePosition &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  return matches.count === 1 ? matches.first : undefined
}

const exactRunResult = (
  records: JournalHistorySource,
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
  integratorRunCorrelationsEqual(record.event.result.correlation, run)

const exactCandidateObservation = (
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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
  /* v8 ignore next -- @preserve the InvalidCandidate quarantine schema requires its exact candidate observation position. */
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
  records: JournalHistorySource,
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

/**
 * A rejected exact-head promotion is terminal provider evidence too: the
 * provider already returned and Git qualified its exact candidate before the
 * compare-and-set became stale. Cleanup still rereads provider-private owner,
 * revision, and writer facts before any removal.
 */
const promotionStaleEvidence = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  quarantine: QuarantineRecord
): IntegratorRetryOrdinalOneEvidence | undefined => {
  if (quarantine.event.basis._tag !== "PromotionStale") return undefined
  const validation = validatePromotionStaleQuarantineEvidence(records, quarantine)
  if (validation._tag === "Invalid") return undefined
  const basis = quarantine.event.basis
  const stale = validation.stale
  const qualified = stale.event.correlation.qualifiedCandidate
  if (
    !integratorRunCorrelationsEqual(qualified.run, run) ||
    qualified.candidateCommit !== basis.candidateCommit ||
    stale.event.observation.observedHeadSha !== basis.observedTargetHead
  ) {
    return undefined
  }
  const results = matchingOfKind<RunResultRecord>(
    records,
    "IntegratorRunResultRecorded",
    (record): record is RunResultRecord =>
      runResultMatches(record, run, start, stale.position) &&
      record.event.result._tag === "PreparedCandidate" &&
      record.event.result.candidateText === qualified.candidateText
  )
  const result = results.count === 1 ? results.first : undefined
  if (result === undefined) return undefined
  const observation = exactCandidateObservation(
    records,
    run,
    start,
    result,
    qualified.candidateText,
    qualified.qualifiedAt,
    stale.position
  )
  if (
    observation?.event.observation._tag !== "Commit" ||
    observation.event.observation.commit !== qualified.candidateCommit ||
    !integratorGitObservationEquivalence(observation.event.observation, {
      _tag: "Commit",
      candidateText: qualified.candidateText,
      commit: qualified.candidateCommit,
      directParents: qualified.directParents
    })
  ) {
    return undefined
  }
  return { _tag: "PromotionStale", candidateObservation: observation, result, run: start, stale }
}

const providerAbsenceIdentityMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  quarantine: QuarantineRecord
): record is ProviderAbsenceRecord =>
  quarantine.event.basis._tag === "ProviderRunFailure" &&
  isProviderAbsenceRecord(record) &&
  record.runId === runIdFor(run) &&
  record.key === integrationProviderRunActivityAbsentRecordKey(run) &&
  integratorRunCorrelationsEqual(record.event.run, run)

const providerAbsenceChronologyMatches = (
  record: ProviderAbsenceRecord,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  quarantine: QuarantineRecord
): boolean =>
  quarantine.event.basis._tag === "ProviderRunFailure" &&
  record.position > start.position &&
  record.position < quarantine.position &&
  record.event.detail === quarantine.event.basis.detail &&
  integratorCorrelationsEqual(record.event.correlation, run.session)

const providerAbsenceMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  start: RunStartedRecord,
  quarantine: QuarantineRecord
): record is ProviderAbsenceRecord =>
  providerAbsenceIdentityMatches(record, run, quarantine) &&
  providerAbsenceChronologyMatches(record, run, start, quarantine)

const ordinalOneEvidence = (
  records: JournalHistorySource,
  sessionRecord: CanonicalSessionRecord,
  quarantine: QuarantineRecord,
  authoritySession: IntegratorRunCorrelation["session"]
): IntegratorRetryOrdinalOneEvidence | undefined => {
  const runOne = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: authoritySession })
  const start = exactRunStart(records, runOne, sessionRecord, quarantine.position)
  return start === undefined
    ? undefined
    : (conclusiveResultEvidence(records, runOne, start, quarantine) ??
        promotionStaleEvidence(records, runOne, start, quarantine) ??
        providerFailureEvidence(records, runOne, start, quarantine))
}

const exactDirectionAndQuarantine = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  options: IntegratorRetryAuthorizationOptions,
  authoritySession: IntegratorRunCorrelation["session"]
): { readonly direction: DirectionRecord; readonly quarantine: QuarantineRecord } | string => {
  const runId = runIdFor(run)
  const foreignDirection = someOfKind(
    records,
    "IntegrationQuarantineDirectionApplied",
    (record) =>
      isDirectionRecord(record) &&
      record.event.fingerprint.sessionId === authoritySession.sessionId &&
      record.key !==
        integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(record.event.fingerprint))
  )
  /* v8 ignore next -- @preserve retryPreflightIssue rejects every foreign or wrongly keyed session direction before this helper is reached. */
  if (foreignDirection) {
    return "Retry history contains a foreign or wrongly keyed direction"
  }
  const retryDirections = matchingOfKind<DirectionRecord>(
    records,
    "IntegrationQuarantineDirectionApplied",
    (record): record is DirectionRecord =>
      isDirectionRecord(record) &&
      record.runId === runId &&
      record.event.requestId.runId === runId &&
      record.event.fingerprint.direction === (options.requiredDirection ?? "Retry") &&
      record.event.fingerprint.sessionId === authoritySession.sessionId &&
      record.key ===
        integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(record.event.fingerprint))
  )
  if (retryDirections.count !== 1) return "Retry requires one exact applied direction for its session and Run"
  const direction = retryDirections.first
  /* v8 ignore next -- @preserve a length-one array always yields an element; this guard protects malformed runtime data. */
  if (direction === undefined) return "Retry requires one exact applied direction for its session and Run"
  /* v8 ignore next -- @preserve duplicate direction subjects have the same deterministic key and are rejected by retryPreflightIssue before this helper is reached. */
  if (!hasUniqueDirectionSubject(records, direction, authoritySession))
    return "Retry must be the unique winning quarantine direction"
  const quarantine = exactPriorQuarantine(records, run, direction, authoritySession)
  return quarantine === undefined ? "direction has no exact earlier ordinal-one quarantine" : { direction, quarantine }
}

const hasUniqueDirectionSubject = (
  records: JournalHistorySource,
  direction: DirectionRecord,
  authoritySession: IntegratorRunCorrelation["session"]
): boolean =>
  matchingOfKind<DirectionRecord>(
    records,
    "IntegrationQuarantineDirectionApplied",
    (record): record is DirectionRecord =>
      isDirectionRecord(record) &&
      record.event.fingerprint.sessionId === authoritySession.sessionId &&
      record.event.fingerprint.quarantineAt === direction.event.fingerprint.quarantineAt &&
      record.key ===
        integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(record.event.fingerprint))
  ).count === 1

const exactPriorQuarantine = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  direction: DirectionRecord,
  authoritySession: IntegratorRunCorrelation["session"]
): QuarantineRecord | undefined => {
  const quarantine = oneRecordAt(records, direction.event.fingerprint.quarantineAt)
  if (quarantine === undefined || !isQuarantineRecord(quarantine)) return undefined
  return quarantine.runId === runIdFor(run) &&
    quarantine.key ===
      integrationQuarantinedRecordKey(quarantine.event.correlation.sessionId, quarantine.event.basis) &&
    quarantine.position < direction.position &&
    quarantine.event.basis._tag !== "RetryTargetHeadChanged" &&
    integratorCorrelationsEqual(quarantine.event.correlation, authoritySession)
    ? quarantine
    : undefined
}

const freshLineage = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  direction: DirectionRecord,
  options: IntegratorRetryAuthorizationOptions
): IntegratorRetryLineage | undefined => {
  let latest: IntegratorRetryLineage | undefined
  for (const observation of journalRecordsOfKind(records, "TargetLineageObserved")) {
    if (!isFreshLineageObservation(observation, run, direction, options)) continue
    const lineage = exactTargetLineageRecord(
      records,
      {
        // The fresh Git read is allowed to prove either the unchanged head or
        // a changed head; the caller compares this exact observed payload with
        // the requested preparation after the intent/result pair is proven.
        expectedTargetHead: observation.event.observation.targetHeadSha,
        integrationTarget: run.session.integrationTarget,
        plannedAttempt: run.session.plannedAttempt,
        targetLineageObservedAt: observation.position
      },
      options.beforePosition === undefined
        ? { afterPosition: direction.position }
        : { afterPosition: direction.position, beforePosition: options.beforePosition }
    )
    if (lineage !== undefined && (latest === undefined || lineage.observation.position > latest.observation.position)) {
      latest = lineage
    }
  }
  return latest
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

const exactSessionQuarantines = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  authoritySession: IntegratorRunCorrelation["session"]
): boolean =>
  everyOfKind(
    records,
    "IntegrationQuarantined",
    (record) =>
      !isQuarantineRecord(record) ||
      record.event.correlation.sessionId !== authoritySession.sessionId ||
      (record.runId === runIdFor(run) &&
        integratorCorrelationsEqual(record.event.correlation, authoritySession) &&
        record.key === integrationQuarantinedRecordKey(record.event.correlation.sessionId, record.event.basis))
  )

const exactSessionDirections = (
  records: JournalHistorySource,
  authoritySession: IntegratorRunCorrelation["session"]
): boolean =>
  everyOfKind(
    records,
    "IntegrationQuarantineDirectionApplied",
    (record) =>
      !isDirectionRecord(record) ||
      record.event.fingerprint.sessionId !== authoritySession.sessionId ||
      record.key ===
        integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(record.event.fingerprint))
  )

/**
 * Reconstructs the one exact Retry relation used by both run-two admission and
 * changed-head Q2 recording. A session-only result is intentionally not an
 * ordinal-one evidence variant and therefore cannot authorize this relation.
 */
export const evaluateIntegratorRetryAuthorization = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  options: IntegratorRetryAuthorizationOptions = {}
): IntegratorRetryAuthorizationResult => {
  if (run.ordinal !== integratorRetryRunOrdinal) return rejected("Retry authorization applies only to run ordinal two")
  const authoritySession = authoritySessionFor(run, options)
  const preflightIssue = retryPreflightIssue(records, run, authoritySession)
  if (preflightIssue !== undefined) return rejected(preflightIssue)
  return authorizeRetryRelation(records, run, options)
}

/**
 * Reconstructs the one canonical FullRerun relation. Candidate cleanup and
 * ordinary successor activation share this path so ordinal-two authority
 * cannot be weakened by a cleanup-local provider/quarantine predicate.
 */
export const evaluateIntegratorFullRerunAuthorization = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  predecessorSession: IntegratorRunCorrelation["session"],
  targetLineageObservedAt: JournalPosition
): IntegratorRetryAuthorizationResult => {
  if (run.ordinal !== integratorRetryRunOrdinal)
    return rejected("FullRerun authorization applies only to run ordinal two")
  const preflightIssue = retryPreflightIssue(records, run, predecessorSession)
  if (preflightIssue !== undefined) return rejected(preflightIssue)
  const candidates = matchingOfKind<SuccessorSessionRecord>(
    records,
    "IntegratorSuccessorSessionFixed",
    (record): record is SuccessorSessionRecord =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      integratorCorrelationsEqual(record.event.successor, run.session) &&
      integratorCorrelationsEqual(record.event.predecessor, predecessorSession)
  )
  if (candidates.count !== 1) return rejected("FullRerun requires one exact successor session relation")
  const successorRecord = candidates.first !== undefined && candidates.first.position > 0 ? candidates.first : undefined
  if (successorRecord === undefined) return rejected("FullRerun requires one exact successor session relation")
  const relation = evaluateIntegratorFullRerunSuccessor(records, successorRecord, predecessorSession)
  if (relation._tag === "Invalid") return rejected(relation.detail)
  if (relation.successor.targetLineageObservedAt !== targetLineageObservedAt) {
    return rejected("FullRerun successor uses a foreign target-lineage observation")
  }
  const evidence = ordinalOneEvidence(records, relation.predecessorSession, relation.quarantine, predecessorSession)
  if (evidence === undefined) return rejected("FullRerun predecessor has no exact terminal evidence")
  if (relation.lineage.observation.event.observation.targetHeadSha !== run.session.expectedTargetHead) {
    return rejected("FullRerun requires the fresh target-lineage observation bound to S2")
  }
  return {
    _tag: "Authorized",
    authorization: {
      direction: relation.direction,
      lineage: relation.lineage,
      ordinalOneEvidence: evidence,
      quarantine: relation.quarantine,
      run,
      session: run.session,
      sessionRecord: relation.record
    }
  }
}

const retryPreflightIssue = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  authoritySession: IntegratorRunCorrelation["session"]
): string | undefined => {
  if (hasForeignRunRecord(records, run) || hasDuplicateRecordIdentity(records)) {
    return "Retry authorization requires one exact Journal history for the Run"
  }
  if (
    someOfKind(
      records,
      "IntegrationQuarantined",
      (record) =>
        isQuarantineRecord(record) &&
        record.event.basis._tag === "RetryTargetHeadChanged" &&
        integratorCorrelationsEqual(record.event.correlation, authoritySession)
    )
  ) {
    return "Retry authorization was terminated by a changed-head quarantine"
  }
  if (!exactSessionQuarantines(records, run, authoritySession))
    return "Retry history contains a foreign or wrongly keyed quarantine"
  return exactSessionDirections(records, authoritySession)
    ? undefined
    : "Retry history contains a foreign or wrongly keyed direction"
}

const authorizeRetryRelation = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  options: IntegratorRetryAuthorizationOptions
): IntegratorRetryAuthorizationResult => {
  const authoritySession = authoritySessionFor(run, options)
  const sessionRecord = exactSessionRecord(records, run.session, options.requiredDirection ?? "Retry", authoritySession)
  if (sessionRecord === undefined) return rejected("Retry has no exact fixed session S")
  const ordinalOneSessionRecord =
    options.requiredDirection === "FullRerun"
      ? exactSessionRecord(records, authoritySession, "Retry", authoritySession)
      : sessionRecord
  if (ordinalOneSessionRecord === undefined) return rejected("Retry has no exact predecessor fixed session S1")
  const directionAndQuarantine = exactDirectionAndQuarantine(records, run, options, authoritySession)
  if (typeof directionAndQuarantine === "string") return rejected(directionAndQuarantine)
  const evidence = ordinalOneEvidence(
    records,
    ordinalOneSessionRecord,
    directionAndQuarantine.quarantine,
    authoritySession
  )
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
  records: JournalHistorySource,
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
  records: JournalHistorySource,
  request: IntegratorRunPreparationInput
): string | undefined => {
  const existingRunStarts = matchingOfKind<RunStartedRecord>(
    records,
    "IntegratorRunStarted",
    (record): record is RunStartedRecord =>
      isRunStartedRecord(record) &&
      record.event.run.ordinal === integratorRetryRunOrdinal &&
      integratorCorrelationsEqual(record.event.run.session, request.run.session)
  )
  const beforePosition = existingRunStarts.count === 1 ? existingRunStarts.first?.position : undefined
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
