import { Schema } from "effect"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  IntegrationQuarantineDirectionAppliedEvent,
  type IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionSubject,
  type IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantinedEvent,
  IntegrationQuarantineJournalEvent,
  type IntegrationQuarantineBasis,
  sameIntegrationQuarantineDirectionSubject
} from "./events.js"
import { IntegratorGitObservation, IntegratorSessionId, integratorRunCorrelationsEqual } from "../integrator/events.js"
import { integratorCorrelationsEqual } from "../integrator/state.js"

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
  record: JournalRecord | undefined,
  correlation: IntegrationQuarantinedEvent["correlation"],
  detail: Extract<IntegrationQuarantineBasis, { readonly _tag: "ProviderRunFailure" }>["detail"]
): record is JournalRecord & { readonly event: IntegrationProviderRunActivityAbsentEvent } =>
  record?.event._tag === "IntegrationProviderRunActivityAbsent" &&
  record.event.detail === detail &&
  integratorCorrelationsEqual(record.event.correlation, correlation)

type IntegratorResultRecord = JournalRecord & {
  readonly event: Extract<
    JournalRecord["event"],
    { readonly _tag: "IntegratorResultRecorded" | "IntegratorRunResultRecorded" }
  >
}

type IntegratorCandidateObservationRecord = JournalRecord & {
  readonly event: Extract<
    JournalRecord["event"],
    { readonly _tag: "IntegratorCandidateGitObserved" | "IntegratorRunCandidateGitObserved" }
  >
}

const isIntegratorResultRecord = (record: JournalRecord | undefined): record is IntegratorResultRecord =>
  record?.event._tag === "IntegratorResultRecorded" || record?.event._tag === "IntegratorRunResultRecorded"

const isIntegratorCandidateObservationRecord = (
  record: JournalRecord | undefined
): record is IntegratorCandidateObservationRecord =>
  record?.event._tag === "IntegratorCandidateGitObserved" || record?.event._tag === "IntegratorRunCandidateGitObserved"

const isDirectionRecord = (record: JournalRecord | undefined): record is DirectionRecord =>
  record?.event._tag === "IntegrationQuarantineDirectionApplied"

const resultRecordFor = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  quarantine: QuarantineRecord
): IntegratorResultRecord | undefined => {
  const record = recordAt(records, position)
  if (!isIntegratorResultRecord(record)) return undefined
  const matchingRunStart = (() => {
    if (record.event._tag === "IntegratorResultRecorded") return true
    const run = record.event.run
    return records.some(
      (candidate) =>
        candidate.position < record.position &&
        candidate.event._tag === "IntegratorRunStarted" &&
        integratorRunCorrelationsEqual(candidate.event.run, run)
    )
  })()
  const exactInitialRun =
    record.event._tag === "IntegratorResultRecorded" ||
    (record.event.run.ordinal === 1 &&
      integratorCorrelationsEqual(record.event.run.session, quarantine.event.correlation))
  return record.position < quarantine.position &&
    matchingRunStart &&
    exactInitialRun &&
    integratorCorrelationsEqual(record.event.result.correlation, quarantine.event.correlation)
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
  quarantine: QuarantineRecord
): IntegratorCandidateObservationRecord | undefined => {
  const record = recordAt(records, position)
  if (!isIntegratorCandidateObservationRecord(record)) return undefined
  const exactInitialRun =
    record.event._tag === "IntegratorCandidateGitObserved"
      ? integratorCorrelationsEqual(record.event.correlation, quarantine.event.correlation)
      : record.event.run.ordinal === 1 &&
        integratorCorrelationsEqual(record.event.run.session, quarantine.event.correlation)
  return record.position < quarantine.position && exactInitialRun ? record : undefined
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

const conclusiveEvidenceMatchesRecords = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord
): boolean => {
  if (quarantine.event.basis._tag !== "ConclusiveResult") return false
  const { cause, evidence } = quarantine.event.basis
  const resultRecord = resultRecordFor(records, evidence.resultRecordedAt, quarantine)
  if (resultRecord === undefined) return false
  if (cause._tag === "NotPrepared") return notPreparedResultMatches(resultRecord, cause)
  const observationAt = evidence.candidateObservationAt
  return (
    observationAt !== undefined &&
    candidateResultMatches(resultRecord, cause) &&
    candidateObservationMatches(candidateObservationRecordFor(records, observationAt, quarantine), resultRecord, cause)
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
      record.event.correlation.sessionId === correlation.sessionId
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
    record.event.requestId.runId === correlation.plannedAttempt.runId
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

function quarantineEvidenceMatchesRecords(
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord
): boolean {
  const { basis } = quarantine.event
  if (basis._tag === "ConclusiveResult") return conclusiveEvidenceMatchesRecords(records, quarantine)
  if (basis._tag === "ProviderRunFailure") {
    return (
      basis.ownedActivityProvenAbsentAt < quarantine.position &&
      providerActivityAbsenceMatches(
        recordAt(records, basis.ownedActivityProvenAbsentAt),
        quarantine.event.correlation,
        basis.detail
      )
    )
  }
  return retryTargetHeadEvidenceMatchesRecords(records, quarantine)
}

const contradiction = (detail: string): IntegrationQuarantineState =>
  IntegrationQuarantineState.cases.Contradiction.make({ detail })

const lastArrayElement = -1

const quarantineContradiction = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  sessionId: IntegratorSessionId
): string | undefined => {
  if (!quarantineEvidenceMatchesRecords(records, quarantine)) {
    return "quarantine evidence does not reference exact earlier Journal facts"
  }
  const subject = IntegrationQuarantineDirectionSubject.make({ quarantineAt: quarantine.position, sessionId })
  const directions = directionRecordsFor(records, subject)
  if (directions.length > 1) return "one quarantine occurrence has more than one applied direction"
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
      quarantineEvidenceMatchesRecords(records, record)
  )

/** Exposes the narrowed Journal event type for adjacent registry projections. */
export const isIntegrationQuarantineEvent = (
  event: JournalRecord["event"]
): event is IntegrationQuarantineJournalEvent => Schema.is(IntegrationQuarantineJournalEvent)(event)
