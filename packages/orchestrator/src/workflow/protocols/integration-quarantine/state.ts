/* eslint-disable max-lines -- Quarantine state validation and its exact causal indexes stay co-located for auditability. */
import { Schema } from "effect"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  IntegrationQuarantineDirectionAppliedEvent,
  type IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantinedEvent,
  IntegrationQuarantineJournalEvent,
  type IntegrationQuarantineBasis,
  sameIntegrationQuarantineDirectionSubject
} from "./events.js"
import {
  IntegratorGitObservation,
  IntegratorSessionId,
  integratorRetryRunOrdinal,
  integratorRunCorrelationsEqual
} from "../integrator/events.js"
import { integratorCorrelationsEqual } from "../integrator/state.js"
import { evaluateIntegratorRetryAuthorization } from "../integrator/retry-authorization.js"
import { providerRunStartFor, validateProviderRunActivityAbsent } from "./provider-failure.js"

/** Reconstructed disposition for one exact Integrator session; no process-local choice cache is retained. */
export const IntegrationQuarantineState = Schema.TaggedUnion({
  Contradiction: { detail: Schema.String },
  DirectionApplied: {
    application: IntegrationQuarantineDirectionAppliedEvent,
    applicationAt: JournalPosition,
    quarantine: IntegrationQuarantinedEvent,
    quarantineAt: JournalPosition
  },
  NoQuarantine: { sessionId: IntegratorSessionId },
  Quarantined: { quarantine: IntegrationQuarantinedEvent, quarantineAt: JournalPosition }
})
export type IntegrationQuarantineState = typeof IntegrationQuarantineState.Type

type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }
type DirectionRecord = JournalRecord & { readonly event: IntegrationQuarantineDirectionAppliedEvent }
type PromotionStaleRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetPromotionStale" }>
}

const isQuarantineRecord = (record: JournalRecord): record is QuarantineRecord =>
  record.event._tag === "IntegrationQuarantined"

const quarantineRecordHasCanonicalKey = (record: QuarantineRecord): boolean =>
  record.key === integrationQuarantinedRecordKey(record.event.correlation.sessionId, record.event.basis)

const directionRecordHasCanonicalKey = (record: DirectionRecord): boolean =>
  record.key ===
  integrationQuarantineDirectionAppliedRecordKey(
    IntegrationQuarantineDirectionSubject.make({
      quarantineAt: record.event.fingerprint.quarantineAt,
      sessionId: record.event.fingerprint.sessionId
    })
  )

const gitObservationEqual = Schema.toEquivalence(IntegratorGitObservation)

const quarantineRecordsFor = (
  records: ReadonlyArray<JournalRecord>,
  sessionId: IntegratorSessionId
): ReadonlyArray<QuarantineRecord> =>
  records
    .filter(
      (record): record is QuarantineRecord =>
        isQuarantineRecord(record) && record.event.correlation.sessionId === sessionId
    )
    .toSorted((left, right) => left.position - right.position)

const directionRecordsFor = (
  records: ReadonlyArray<JournalRecord>,
  subject: IntegrationQuarantineDirectionSubject
): ReadonlyArray<DirectionRecord> =>
  records
    .filter(
      (record): record is DirectionRecord =>
        record.event._tag === "IntegrationQuarantineDirectionApplied" &&
        sameIntegrationQuarantineDirectionSubject(
          IntegrationQuarantineDirectionSubject.make({
            quarantineAt: record.event.fingerprint.quarantineAt,
            sessionId: record.event.fingerprint.sessionId
          }),
          subject
        )
    )
    .toSorted((left, right) => left.position - right.position)

const recordAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalRecord | undefined =>
  records.find((record) => record.position === position)

const providerActivityAbsenceMatches = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord | undefined,
  correlation: IntegrationQuarantinedEvent["correlation"],
  detail: Extract<IntegrationQuarantineBasis, { readonly _tag: "ProviderRunFailure" }>["detail"]
): boolean => {
  /* v8 ignore next -- @preserve callers validate the absence record before this helper, so an undefined record is rejected by the preceding short-circuit. */
  if (record === undefined) return false
  const validation = validateProviderRunActivityAbsent(records, record)
  return (
    validation._tag === "Valid" &&
    integratorCorrelationsEqual(validation.run.session, correlation) &&
    validation.record.event.detail === detail
  )
}

type IntegratorResultRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunResultRecorded" }>
}

type IntegratorCandidateObservationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunCandidateGitObserved" }>
}

const isIntegratorResultRecord = (record: JournalRecord | undefined): record is IntegratorResultRecord =>
  record?.event._tag === "IntegratorRunResultRecorded"

const isIntegratorCandidateObservationRecord = (
  record: JournalRecord | undefined
): record is IntegratorCandidateObservationRecord => record?.event._tag === "IntegratorRunCandidateGitObserved"

const isDirectionRecord = (record: JournalRecord | undefined): record is DirectionRecord =>
  record?.event._tag === "IntegrationQuarantineDirectionApplied"

const hasMatchingRunStart = (records: ReadonlyArray<JournalRecord>, record: IntegratorResultRecord): boolean => {
  const run = record.event.run
  return records.some(
    (candidate) =>
      candidate.position < record.position &&
      candidate.event._tag === "IntegratorRunStarted" &&
      (run.ordinal !== integratorRetryRunOrdinal || candidate.key === integratorRunStartedRecordKey(run)) &&
      integratorRunCorrelationsEqual(candidate.event.run, run)
  )
}

const resultBelongsToQuarantinedRun = (record: IntegratorResultRecord, quarantine: QuarantineRecord): boolean => {
  const run = record.event.run
  const supportedOrdinal = run.ordinal === 1 || run.ordinal === integratorRetryRunOrdinal
  return (
    supportedOrdinal &&
    record.key === integratorRunResultRecordedRecordKey(run) &&
    integratorCorrelationsEqual(run.session, quarantine.event.correlation) &&
    integratorCorrelationsEqual(record.event.result.correlation, quarantine.event.correlation)
  )
}

const resultRecordFor = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  quarantine: QuarantineRecord
): IntegratorResultRecord | undefined => {
  const record = recordAt(records, position)
  if (!isIntegratorResultRecord(record)) return undefined
  return record.position < quarantine.position &&
    hasMatchingRunStart(records, record) &&
    resultBelongsToQuarantinedRun(record, quarantine)
    ? record
    : undefined
}

const notPreparedResultMatches = (
  record: IntegratorResultRecord,
  detail: Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>["cause"] & {
    readonly _tag: "NotPrepared"
  }
): boolean => record.event.result._tag === "NotPrepared" && record.event.result.detail === detail.detail

const candidateResultMatches = (
  record: IntegratorResultRecord,
  candidateText: Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>["cause"] & {
    readonly _tag: "InvalidCandidate"
  }
): boolean =>
  record.event.result._tag === "PreparedCandidate" && record.event.result.candidateText === candidateText.candidateText

const candidateObservationRecordFor = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  quarantine: QuarantineRecord,
  resultRecord: IntegratorResultRecord
): IntegratorCandidateObservationRecord | undefined => {
  const record = recordAt(records, position)
  if (!isIntegratorCandidateObservationRecord(record)) return undefined
  const exactRun =
    record.event.run.ordinal === resultRecord.event.run.ordinal &&
    integratorRunCorrelationsEqual(record.event.run, resultRecord.event.run) &&
    record.key === integratorRunCandidateGitObservedRecordKey(resultRecord.event.run, record.event.candidateText)
  return record.position < quarantine.position && exactRun ? record : undefined
}

const candidateObservationMatches = (
  record: IntegratorCandidateObservationRecord | undefined,
  resultRecord: IntegratorResultRecord,
  cause: Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>["cause"] & {
    readonly _tag: "InvalidCandidate"
  }
): boolean =>
  record !== undefined &&
  record.position > resultRecord.position &&
  record.event.candidateText === cause.candidateText &&
  gitObservationEqual(record.event.observation, cause.observation)

const retryResultIsAuthorized = (records: ReadonlyArray<JournalRecord>, resultRecord: IntegratorResultRecord) => {
  if (resultRecord.event.run.ordinal !== integratorRetryRunOrdinal) return true
  const runStart = providerRunStartFor(records, resultRecord.event.run)
  if (runStart === undefined || runStart.position >= resultRecord.position) return false
  const authorization = evaluateIntegratorRetryAuthorization(records, resultRecord.event.run, {
    beforePosition: runStart.position
  })
  return (
    authorization._tag === "Authorized" &&
    authorization.authorization.lineage.observation.event.observation.targetHeadSha ===
      resultRecord.event.run.session.expectedTargetHead
  )
}

const invalidCandidateEvidenceMatchesRecords = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  resultRecord: IntegratorResultRecord,
  cause: Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>["cause"] & {
    readonly _tag: "InvalidCandidate"
  },
  observationAt: JournalPosition | undefined
): boolean =>
  observationAt !== undefined &&
  candidateResultMatches(resultRecord, cause) &&
  candidateObservationMatches(
    candidateObservationRecordFor(records, observationAt, quarantine, resultRecord),
    resultRecord,
    cause
  )

const conclusiveEvidenceMatchesRecords = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord
): boolean => {
  /* v8 ignore next -- @preserve this helper is called only after quarantineEvidenceMatchesRecords narrows the basis to ConclusiveResult. */
  if (quarantine.event.basis._tag !== "ConclusiveResult") return false
  const { cause, evidence } = quarantine.event.basis
  const resultRecord = resultRecordFor(records, evidence.resultRecordedAt, quarantine)
  if (resultRecord === undefined) return false
  if (!retryResultIsAuthorized(records, resultRecord)) return false
  if (cause._tag === "NotPrepared") return notPreparedResultMatches(resultRecord, cause)
  return invalidCandidateEvidenceMatchesRecords(
    records,
    quarantine,
    resultRecord,
    cause,
    evidence.candidateObservationAt
  )
}

const priorQuarantineFor = (
  records: ReadonlyArray<JournalRecord>,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>,
  correlation: QuarantineRecord["event"]["correlation"]
): QuarantineRecord | undefined =>
  records.find(
    (record): record is QuarantineRecord =>
      isQuarantineRecord(record) &&
      record.position === basis.priorQuarantineAt &&
      record.event.correlation.sessionId === correlation.sessionId &&
      quarantineRecordHasCanonicalKey(record)
  )

const retryDirectionFor = (
  records: ReadonlyArray<JournalRecord>,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>,
  correlation: QuarantineRecord["event"]["correlation"]
): DirectionRecord | undefined => {
  const record = recordAt(records, basis.directionAppliedAt)
  if (!isDirectionRecord(record)) return undefined
  return record.event.fingerprint.direction === "Retry" &&
    record.event.fingerprint.sessionId === correlation.sessionId &&
    record.event.fingerprint.quarantineAt === basis.priorQuarantineAt &&
    record.event.requestId.runId === correlation.plannedAttempt.runId &&
    directionRecordHasCanonicalKey(record)
    ? record
    : undefined
}

const targetLineageFor = (
  records: ReadonlyArray<JournalRecord>,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>,
  correlation: QuarantineRecord["event"]["correlation"]
): JournalRecord | undefined => {
  const record = recordAt(records, basis.targetLineageObservedAt)
  return record?.event._tag === "TargetLineageObserved" &&
    record.event.observation.targetHeadSha === basis.observedTargetHead &&
    plannedTaskAttemptEquivalence(record.event.plannedAttempt, correlation.plannedAttempt)
    ? record
    : undefined
}

const retryEvidencePositionsAreCausal = (
  priorQuarantine: QuarantineRecord,
  direction: DirectionRecord,
  observationRecord: JournalRecord,
  quarantine: QuarantineRecord
): boolean =>
  priorQuarantine.position < direction.position &&
  direction.position < observationRecord.position &&
  observationRecord.position < quarantine.position

function retryTargetHeadEvidenceMatchesRecords(
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord
): boolean {
  /* v8 ignore next -- @preserve quarantineEvidenceMatchesRecords dispatches here only for RetryTargetHeadChanged bases. */
  if (quarantine.event.basis._tag !== "RetryTargetHeadChanged") return false
  const { basis, correlation } = quarantine.event
  const priorQuarantine = priorQuarantineFor(records, basis, correlation)
  const direction = retryDirectionFor(records, basis, correlation)
  const observationRecord = targetLineageFor(records, basis, correlation)
  if (priorQuarantine === undefined || direction === undefined || observationRecord === undefined) return false
  return (
    retryEvidencePositionsAreCausal(priorQuarantine, direction, observationRecord, quarantine) &&
    basis.observedTargetHead !== correlation.expectedTargetHead &&
    quarantineEvidenceMatchesRecords(records, priorQuarantine)
  )
}

const promotionStaleRecordMatchesEnvelope = (
  stale: JournalRecord | undefined,
  quarantine: QuarantineRecord
): stale is PromotionStaleRecord =>
  stale !== undefined &&
  stale.event._tag === "TargetPromotionStale" &&
  stale.position < quarantine.position &&
  stale.runId === quarantine.runId &&
  stale.key === targetPromotionStaleRecordKey(stale.event.correlation.requestId)

const promotionStaleEvidenceMatchesRecords = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord
): boolean => {
  if (quarantine.event.basis._tag !== "PromotionStale") return false
  const { basis, correlation } = quarantine.event
  const stale = recordAt(records, basis.targetPromotionStaleAt)
  if (!promotionStaleRecordMatchesEnvelope(stale, quarantine)) return false
  return (
    integratorCorrelationsEqual(stale.event.correlation.qualifiedCandidate.run.session, correlation) &&
    stale.event.correlation.qualifiedCandidate.candidateCommit === basis.candidateCommit &&
    stale.event.observation.observedHeadSha === basis.observedTargetHead
  )
}

function quarantineEvidenceMatchesRecords(
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord
): boolean {
  const { basis } = quarantine.event
  if (basis._tag === "ConclusiveResult") return conclusiveEvidenceMatchesRecords(records, quarantine)
  if (basis._tag === "ProviderRunFailure") return providerFailureEvidenceMatchesRecords(records, quarantine, basis)
  if (basis._tag === "PromotionStale") return promotionStaleEvidenceMatchesRecords(records, quarantine)
  return retryTargetHeadEvidenceMatchesRecords(records, quarantine)
}

const providerFailureEvidenceMatchesRecords = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "ProviderRunFailure" }>
): boolean => {
  const absence = recordAt(records, basis.ownedActivityProvenAbsentAt)
  if (absence === undefined) return false
  const validation = validateProviderRunActivityAbsent(records, absence)
  if (validation._tag !== "Valid") return false
  return (
    basis.ownedActivityProvenAbsentAt > validation.runStart.position &&
    basis.ownedActivityProvenAbsentAt < quarantine.position &&
    providerActivityAbsenceMatches(records, absence, quarantine.event.correlation, basis.detail)
  )
}

const contradiction = (detail: string): IntegrationQuarantineState =>
  IntegrationQuarantineState.cases.Contradiction.make({ detail })

const lastArrayElement = -1

const quarantineContradiction = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  sessionId: IntegratorSessionId
): string | undefined => {
  if (!quarantineRecordHasCanonicalKey(quarantine)) {
    return "quarantine occurrence has a foreign Journal key"
  }
  if (!quarantineEvidenceMatchesRecords(records, quarantine)) {
    return "quarantine evidence does not reference exact earlier Journal facts"
  }
  const subject = IntegrationQuarantineDirectionSubject.make({ quarantineAt: quarantine.position, sessionId })
  const directions = directionRecordsFor(records, subject)
  if (directions.length > 1) return "one quarantine occurrence has more than one applied direction"
  const successorSession = records.some(
    ({ event, position, runId }) =>
      event._tag === "IntegratorSuccessorSessionFixed" &&
      runId === quarantine.runId &&
      position < quarantine.position &&
      integratorCorrelationsEqual(event.successor, quarantine.event.correlation)
  )
  if (successorSession && directions.length > 0) {
    return "a FullRerun successor quarantine cannot apply another direction"
  }
  if (directions.some((direction) => !directionRecordHasCanonicalKey(direction))) {
    return "quarantine direction has a foreign Journal key"
  }
  return directions.some((direction) => direction.position <= quarantine.position)
    ? "a quarantine direction must follow its quarantine occurrence"
    : undefined
}

const latestQuarantineState = (
  records: ReadonlyArray<JournalRecord>,
  latest: QuarantineRecord,
  sessionId: IntegratorSessionId
): IntegrationQuarantineState => {
  const subject = IntegrationQuarantineDirectionSubject.make({ quarantineAt: latest.position, sessionId })
  const application = directionRecordsFor(records, subject)[0]
  if (application === undefined) {
    return IntegrationQuarantineState.cases.Quarantined.make({
      quarantine: latest.event,
      quarantineAt: latest.position
    })
  }
  return IntegrationQuarantineState.cases.DirectionApplied.make({
    application: application.event,
    applicationAt: application.position,
    quarantine: latest.event,
    quarantineAt: latest.position
  })
}

/** Reconstructs the latest quarantine and its first direction directly from Journal records. */
export const deriveIntegrationQuarantineState = (
  records: ReadonlyArray<JournalRecord>,
  sessionId: IntegratorSessionId
): IntegrationQuarantineState => {
  const quarantines = quarantineRecordsFor(records, sessionId)
  const latest = quarantines.at(lastArrayElement)
  if (latest === undefined) return IntegrationQuarantineState.cases.NoQuarantine.make({ sessionId })

  for (const quarantine of quarantines) {
    const detail = quarantineContradiction(records, quarantine, sessionId)
    if (detail !== undefined) return contradiction(detail)
  }
  return latestQuarantineState(records, latest, sessionId)
}

/** Returns the exact quarantine occurrence named by a direction fingerprint. */
export const quarantineRecordForFingerprint = (
  records: ReadonlyArray<JournalRecord>,
  fingerprint: IntegrationQuarantineDirectionFingerprint
): QuarantineRecord | undefined =>
  records.find(
    (record): record is QuarantineRecord =>
      isQuarantineRecord(record) &&
      record.position === fingerprint.quarantineAt &&
      record.event.correlation.sessionId === fingerprint.sessionId &&
      quarantineRecordHasCanonicalKey(record) &&
      quarantineEvidenceMatchesRecords(records, record)
  )

/** Exposes the narrowed Journal event type for adjacent registry projections. */
export const isIntegrationQuarantineEvent = (
  event: JournalRecord["event"]
): event is IntegrationQuarantineJournalEvent => Schema.is(IntegrationQuarantineJournalEvent)(event)
