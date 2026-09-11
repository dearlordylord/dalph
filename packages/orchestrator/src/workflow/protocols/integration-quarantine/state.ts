/* eslint-disable max-lines -- Quarantine state validation and its exact causal indexes stay co-located for auditability. */
import { Schema } from "effect"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  isJournalRecordEvidence,
  journalRecordByPosition,
  journalRecordsForIntegratorSession,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
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
import { validatePromotionStaleQuarantineEvidence } from "./promotion-stale-evidence.js"

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
  records: JournalHistorySource,
  sessionId: IntegratorSessionId
): Iterable<QuarantineRecord> => {
  if (!isJournalRecordEvidence(records)) {
    return records
      .filter(
        (record): record is QuarantineRecord =>
          isQuarantineRecord(record) && record.event.correlation.sessionId === sessionId
      )
      .toSorted((left, right) => left.position - right.position)
  }
  return {
    *[Symbol.iterator]() {
      for (const record of journalRecordsForIntegratorSession(records, sessionId)) {
        if (isQuarantineRecord(record) && record.event.correlation.sessionId === sessionId) yield record
      }
    }
  }
}

const directionRecordsFor = (
  records: JournalHistorySource,
  subject: IntegrationQuarantineDirectionSubject
): Iterable<DirectionRecord> => {
  const matches = (record: JournalRecord): record is DirectionRecord =>
    record.event._tag === "IntegrationQuarantineDirectionApplied" &&
    sameIntegrationQuarantineDirectionSubject(
      IntegrationQuarantineDirectionSubject.make({
        quarantineAt: record.event.fingerprint.quarantineAt,
        sessionId: record.event.fingerprint.sessionId
      }),
      subject
    )
  if (!isJournalRecordEvidence(records)) {
    return records.filter(matches).toSorted((left, right) => left.position - right.position)
  }
  return {
    *[Symbol.iterator]() {
      for (const record of journalRecordsForIntegratorSession(records, subject.sessionId)) {
        if (matches(record)) yield record
      }
    }
  }
}

const recordAt = (records: JournalHistorySource, position: JournalPosition): JournalRecord | undefined =>
  journalRecordByPosition(records, position)

const providerActivityAbsenceMatches = (
  records: JournalHistorySource,
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

const hasMatchingRunStart = (records: JournalHistorySource, record: IntegratorResultRecord): boolean => {
  const run = record.event.run
  for (const candidate of journalRecordsForIntegratorSession(records, run.session.sessionId)) {
    if (
      candidate.position < record.position &&
      candidate.event._tag === "IntegratorRunStarted" &&
      (run.ordinal !== integratorRetryRunOrdinal || candidate.key === integratorRunStartedRecordKey(run)) &&
      integratorRunCorrelationsEqual(candidate.event.run, run)
    ) return true
  }
  return false
}

const resultBelongsToQuarantinedRun = (record: IntegratorResultRecord, quarantine: QuarantineRecord): boolean => {
  const run = record.event.run
  const supportedOrdinal = run.ordinal === 1 || run.ordinal === integratorRetryRunOrdinal
  return (
    supportedOrdinal &&
    record.key === integratorRunResultRecordedRecordKey(run) &&
    integratorCorrelationsEqual(run.session, quarantine.event.correlation) &&
    integratorRunCorrelationsEqual(record.event.result.correlation, run)
  )
}

const resultRecordFor = (
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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

const retryResultIsAuthorized = (records: JournalHistorySource, resultRecord: IntegratorResultRecord) => {
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
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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
  records: JournalHistorySource,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "RetryTargetHeadChanged" }>,
  correlation: QuarantineRecord["event"]["correlation"]
): QuarantineRecord | undefined =>
  (() => {
    const record = recordAt(records, basis.priorQuarantineAt)
    return record !== undefined &&
      isQuarantineRecord(record) &&
      record.event.correlation.sessionId === correlation.sessionId &&
      quarantineRecordHasCanonicalKey(record)
      ? record
      : undefined
  })()

const retryDirectionFor = (
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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
  records: JournalHistorySource,
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

const promotionStaleEvidenceMatchesRecords = (
  records: JournalHistorySource,
  quarantine: QuarantineRecord
): boolean => validatePromotionStaleQuarantineEvidence(records, quarantine)._tag === "Valid"

function quarantineEvidenceMatchesRecords(
  records: JournalHistorySource,
  quarantine: QuarantineRecord
): boolean {
  const { basis } = quarantine.event
  if (basis._tag === "ConclusiveResult") return conclusiveEvidenceMatchesRecords(records, quarantine)
  if (basis._tag === "ProviderRunFailure") return providerFailureEvidenceMatchesRecords(records, quarantine, basis)
  if (basis._tag === "PromotionStale") return promotionStaleEvidenceMatchesRecords(records, quarantine)
  return retryTargetHeadEvidenceMatchesRecords(records, quarantine)
}

const providerFailureEvidenceMatchesRecords = (
  records: JournalHistorySource,
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

const quarantineContradiction = (
  records: JournalHistorySource,
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
  let directionCount = 0
  let hasForeignDirection = false
  let hasNonCausalDirection = false
  for (const direction of directions) {
    directionCount += 1
    hasForeignDirection ||= !directionRecordHasCanonicalKey(direction)
    hasNonCausalDirection ||= direction.position <= quarantine.position
  }
  if (directionCount > 1) return "one quarantine occurrence has more than one applied direction"
  let successorSession = false
  for (const { event, position, runId } of journalRecordsForIntegratorSession(records, sessionId)) {
    if (
      event._tag === "IntegratorSuccessorSessionFixed" &&
      runId === quarantine.runId &&
      position < quarantine.position &&
      integratorCorrelationsEqual(event.successor, quarantine.event.correlation)
    ) {
      successorSession = true
      break
    }
  }
  if (successorSession && directionCount > 0) {
    return "a FullRerun successor quarantine cannot apply another direction"
  }
  if (hasForeignDirection) {
    return "quarantine direction has a foreign Journal key"
  }
  return hasNonCausalDirection ? "a quarantine direction must follow its quarantine occurrence" : undefined
}

const latestQuarantineState = (
  records: JournalHistorySource,
  latest: QuarantineRecord,
  sessionId: IntegratorSessionId
): IntegrationQuarantineState => {
  const subject = IntegrationQuarantineDirectionSubject.make({ quarantineAt: latest.position, sessionId })
  const application = directionRecordsFor(records, subject)[Symbol.iterator]().next().value
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
  source: JournalHistorySource,
  sessionId: IntegratorSessionId
): IntegrationQuarantineState => {
  let latest: QuarantineRecord | undefined
  for (const quarantine of quarantineRecordsFor(source, sessionId)) {
    const detail = quarantineContradiction(source, quarantine, sessionId)
    if (detail !== undefined) return contradiction(detail)
    latest = quarantine
  }
  if (latest === undefined) return IntegrationQuarantineState.cases.NoQuarantine.make({ sessionId })
  return latestQuarantineState(source, latest, sessionId)
}

/** Returns the exact quarantine occurrence named by a direction fingerprint. */
export const quarantineRecordForFingerprint = (
  source: JournalHistorySource,
  fingerprint: IntegrationQuarantineDirectionFingerprint
): QuarantineRecord | undefined => {
  const record = recordAt(source, fingerprint.quarantineAt)
  return record !== undefined &&
    isQuarantineRecord(record) &&
    record.event.correlation.sessionId === fingerprint.sessionId &&
    quarantineRecordHasCanonicalKey(record) &&
    quarantineEvidenceMatchesRecords(source, record)
    ? record
    : undefined
}

/** Exposes the narrowed Journal event type for adjacent registry projections. */
export const isIntegrationQuarantineEvent = (
  event: JournalRecord["event"]
): event is IntegrationQuarantineJournalEvent => Schema.is(IntegrationQuarantineJournalEvent)(event)
