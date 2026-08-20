import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  integrationResponsibilityBeganRecordKey,
  integrationProviderRunActivityAbsentRecordKey,
  integrationStartedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  intentRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { IntegrationQuarantineDirectionFingerprint, IntegrationQuarantinedEvent } from "./events.js"
import { integrationResponsibilityEquivalence } from "../integration-admission/responsibility.js"
import {
  integratorRetryRunOrdinal,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  integratorRunCorrelationsEqual
} from "../integrator/events.js"
import {
  integratorCorrelationsEqual,
  integratorResponsibilityFactsFromCorrelation,
  validateIntegratorSuccessorSessionFixed
} from "../integrator/state.js"

type AbsenceRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationProviderRunActivityAbsent" }>
}

type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }

const runIdFor = (run: IntegratorRunCorrelation) => run.session.plannedAttempt.runId

/**
 * Reconstructs the durable S1 admission responsibility that precedes cleanup
 * authority. A caller-made correlation is not enough: both queue and cutoff
 * records must carry the exact accepted result, target, attempt, run, key, and
 * positions from the canonical integration-admission protocol.
 */
const exactResponsibilityHistory = (records: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean => {
  const facts = {
    acceptedResult: run.session.acceptedResult,
    integrationTarget: run.session.integrationTarget,
    plannedAttempt: run.session.plannedAttempt
  }
  const queued = records.filter(
    (record) =>
      record.event._tag === "IntegrationResponsibilityBegan" &&
      record.position === run.session.queuedAt &&
      record.runId === runIdFor(run) &&
      record.key === integrationResponsibilityBeganRecordKey(run.session.plannedAttempt.attemptId) &&
      integrationResponsibilityEquivalence(record.event, facts)
  )
  const started = records.filter(
    (record) =>
      record.event._tag === "IntegrationStarted" &&
      record.position === run.session.startedAt &&
      record.runId === runIdFor(run) &&
      record.key === integrationStartedRecordKey(run.session.plannedAttempt.attemptId) &&
      record.event.responsibilityBeganAt === run.session.queuedAt &&
      integrationResponsibilityEquivalence(record.event, facts)
  )
  const queuedRecord = queued[0]
  const startedRecord = started[0]
  return (
    queued.length === 1 &&
    started.length === 1 &&
    queuedRecord !== undefined &&
    startedRecord !== undefined &&
    queuedRecord.position < startedRecord.position
  )
}

const exactTargetLineage = (records: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean => {
  const lineage = records.find((record) => record.position === run.session.targetLineageObservedAt)
  const lineageEvent = lineage?.event
  if (lineage === undefined || lineageEvent?._tag !== "TargetLineageObserved") return false
  const intents = records.filter(
    (record) =>
      record.event._tag === "GitReadIntentRecorded" &&
      record.runId === runIdFor(run) &&
      record.key === intentRecordKey(lineageEvent.operationId) &&
      record.position < lineage.position &&
      record.event.operation._tag === "ReadTargetLineage" &&
      record.event.operation.operationId === lineageEvent.operationId &&
      plannedTaskAttemptEquivalence(record.event.operation.plannedAttempt, run.session.plannedAttempt) &&
      record.event.operation.integrationTarget.repository === run.session.integrationTarget.repository &&
      record.event.operation.integrationTarget.ref === run.session.integrationTarget.ref
  )
  return (
    intents.length === 1 &&
    plannedTaskAttemptEquivalence(lineageEvent.plannedAttempt, run.session.plannedAttempt) &&
    lineageEvent.observation.plannedBaseSha === run.session.plannedAttempt.baseSha &&
    lineageEvent.observation.targetHeadSha === run.session.expectedTargetHead &&
    lineageEvent.observation.plannedBaseIsAncestorOfTargetHead
  )
}

const fixedSessionPosition = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): number | undefined => {
  if (!exactTargetLineage(records, run)) return undefined
  if (run.ordinal === IntegratorRunOrdinal.make(1)) {
    if (!exactResponsibilityHistory(records, run)) return undefined
    const key = integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(run.session))
    const fixed = records.filter(
      (record) =>
        record.event._tag === "IntegratorSessionFixed" &&
        record.runId === runIdFor(run) &&
        record.key === key &&
        integratorCorrelationsEqual(record.event.correlation, run.session)
    )
    return fixed.length === 1 && fixed[0] !== undefined && fixed[0].position > run.session.targetLineageObservedAt
      ? fixed[0].position
      : undefined
  }
  if (run.ordinal !== integratorRetryRunOrdinal) return undefined
  const successors = records.filter(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
    } =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      record.runId === runIdFor(run) &&
      integratorCorrelationsEqual(record.event.successor, run.session) &&
      record.key ===
        integratorSuccessorSessionFixedRecordKey(
          record.event.predecessor,
          record.event.quarantineAt,
          record.event.directionAppliedAt
        )
  )
  if (successors.length !== 1 || successors[0] === undefined) return undefined
  const successor = successors[0]
  const predecessorRun = IntegratorRunCorrelation.make({
    ordinal: IntegratorRunOrdinal.make(1),
    session: successor.event.predecessor
  })
  if (!exactResponsibilityHistory(records, predecessorRun)) return undefined
  const validation = validateIntegratorSuccessorSessionFixed(records, successor.event.predecessor, run.session)
  return validation._tag === "Valid" && successor.position > run.session.targetLineageObservedAt
    ? successor.position
    : undefined
}

const exactRunStart = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  fixedAt: number
): JournalRecord | undefined => {
  const starts = records.filter(
    (record) =>
      record.event._tag === "IntegratorRunStarted" &&
      record.runId === runIdFor(run) &&
      record.key === integratorRunStartedRecordKey(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  return starts.length === 1 && starts[0] !== undefined && starts[0].position > fixedAt ? starts[0] : undefined
}

/** Canonical provider-owned absence proof used by quarantine reconstruction and cleanup authorization. */
export const validateProviderRunActivityAbsent = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord
):
  | {
      readonly _tag: "Valid"
      readonly run: IntegratorRunCorrelation
      readonly record: AbsenceRecord
      readonly runStart: JournalRecord
    }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  const absenceRecord = records.find(
    (candidate): candidate is AbsenceRecord =>
      candidate === record && candidate.event._tag === "IntegrationProviderRunActivityAbsent"
  )
  if (absenceRecord === undefined) {
    return { _tag: "Invalid", detail: "record is not provider-activity absence evidence" }
  }
  const run = absenceRecord.event.run
  if (
    ![IntegratorRunOrdinal.make(1), integratorRetryRunOrdinal].includes(run.ordinal) ||
    !integratorCorrelationsEqual(absenceRecord.event.correlation, run.session) ||
    absenceRecord.runId !== runIdFor(run) ||
    absenceRecord.key !== integrationProviderRunActivityAbsentRecordKey(run)
  ) {
    return { _tag: "Invalid", detail: "provider-activity absence has a foreign key, run, or session" }
  }
  const absences = records.filter(
    (candidate): candidate is AbsenceRecord =>
      candidate.event._tag === "IntegrationProviderRunActivityAbsent" &&
      integratorRunCorrelationsEqual(candidate.event.run, run)
  )
  if (absences.length !== 1 || absences[0] !== absenceRecord) {
    return { _tag: "Invalid", detail: "provider-activity absence is duplicate or contradictory" }
  }
  const fixedAt = fixedSessionPosition(records, run)
  if (fixedAt === undefined) {
    return { _tag: "Invalid", detail: "provider run lacks its exact fixed session and target lineage" }
  }
  const runStart = exactRunStart(records, run, fixedAt)
  if (runStart === undefined || runStart.position >= absenceRecord.position) {
    return { _tag: "Invalid", detail: "provider-run absence lacks the exact earlier run start" }
  }
  const conflictingEvidence = records.some(
    (candidate) =>
      (candidate.event._tag === "IntegratorRunResultRecorded" ||
        candidate.event._tag === "IntegratorRunCandidateGitReadIntended" ||
        candidate.event._tag === "IntegratorRunCandidateGitObserved") &&
      integratorRunCorrelationsEqual(candidate.event.run, run)
  )
  return conflictingEvidence
    ? { _tag: "Invalid", detail: "provider-activity absence contradicts exact run evidence" }
    : { _tag: "Valid", run, record: absenceRecord, runStart }
}

/** Finds only a quarantine whose provider-failure basis has passed the canonical absence proof. */
export const quarantineRecordForFingerprint = (
  records: ReadonlyArray<JournalRecord>,
  fingerprint: IntegrationQuarantineDirectionFingerprint
): QuarantineRecord | undefined =>
  records.find((record): record is QuarantineRecord => {
    if (
      record.event._tag !== "IntegrationQuarantined" ||
      record.position !== fingerprint.quarantineAt ||
      record.event.correlation.sessionId !== fingerprint.sessionId ||
      record.key !== integrationQuarantinedRecordKey(record.event.correlation.sessionId, record.event.basis)
    ) {
      return false
    }
    const basis = record.event.basis
    if (basis._tag !== "ProviderRunFailure") return false
    const absence = records.find((candidate) => candidate.position === basis.ownedActivityProvenAbsentAt)
    const validation = absence === undefined ? undefined : validateProviderRunActivityAbsent(records, absence)
    return (
      validation?._tag === "Valid" &&
      validation.record.position < record.position &&
      validation.record.event.detail === basis.detail
    )
  })
