import { Schema } from "effect"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { IntegratorRunCorrelation } from "./events.js"
import { IntegratorGitObservation, IntegratorRunOrdinal, integratorRetryRunOrdinal } from "./events.js"
import type { IntegratorRunPreparationInput } from "./session.js"
import { integratorRunCorrelationForSession, matchingIntegratorTargetLineageIntentPosition } from "./session.js"
import { integratorCorrelationsEqual } from "./state.js"

const gitObservationEquals = Schema.toEquivalence(IntegratorGitObservation)
type QuarantineRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationQuarantined" }>
}
type DirectionRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationQuarantineDirectionApplied" }>
}

const isQuarantineRecord = (record: JournalRecord | undefined): record is QuarantineRecord =>
  record?.event._tag === "IntegrationQuarantined"

const recordsAt = (records: ReadonlyArray<JournalRecord>, position: number): ReadonlyArray<JournalRecord> =>
  records.filter((record) => record.position === position)

const exactRunOneStart = (
  records: ReadonlyArray<JournalRecord>,
  runOne: IntegratorRunCorrelation
): JournalRecord | undefined => {
  const starts = records.filter(
    (record) =>
      record.event._tag === "IntegratorRunStarted" &&
      record.event.run.ordinal === runOne.ordinal &&
      integratorCorrelationsEqual(record.event.run.session, runOne.session)
  )
  return starts.length === 1 ? starts[0] : undefined
}

const exactLegacyInitialStart = (
  records: ReadonlyArray<JournalRecord>,
  runOne: IntegratorRunCorrelation,
  beforePosition: JournalPosition
): JournalRecord | undefined => {
  const sessions = records.filter(
    (record) =>
      record.position < beforePosition &&
      record.event._tag === "IntegratorSessionFixed" &&
      integratorCorrelationsEqual(record.event.correlation, runOne.session)
  )
  const session = sessions.length === 1 ? sessions[0] : undefined
  return session !== undefined && session.position > runOne.session.targetLineageObservedAt ? session : undefined
}

// eslint-disable-next-line complexity -- Conclusive Retry authority binds one exact start, result, optional candidate observation, and quarantine chronology.
const conclusiveRunOneEvidenceMatches = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  runOne: IntegratorRunCorrelation
): boolean => {
  if (quarantine.event.basis._tag !== "ConclusiveResult") return false
  const resultRecords = recordsAt(records, quarantine.event.basis.evidence.resultRecordedAt)
  const resultRecord = resultRecords.length === 1 ? resultRecords[0] : undefined
  if (resultRecord === undefined || resultRecord.position >= quarantine.position) return false
  if (
    resultRecord.event._tag !== "IntegratorRunResultRecorded" &&
    resultRecord.event._tag !== "IntegratorResultRecorded"
  ) {
    return false
  }
  const start =
    resultRecord.event._tag === "IntegratorRunResultRecorded"
      ? exactRunOneStart(records, runOne)
      : exactLegacyInitialStart(records, runOne, resultRecord.position)
  const exactRunBinding =
    resultRecord.event._tag === "IntegratorRunResultRecorded"
      ? resultRecord.event.run.ordinal === runOne.ordinal &&
        integratorCorrelationsEqual(resultRecord.event.run.session, runOne.session)
      : true
  if (
    start === undefined ||
    !exactRunBinding ||
    !integratorCorrelationsEqual(resultRecord.event.result.correlation, runOne.session) ||
    start.position >= resultRecord.position
  ) {
    return false
  }

  const cause = quarantine.event.basis.cause
  if (cause._tag === "NotPrepared") {
    return resultRecord.event.result._tag === "NotPrepared" && resultRecord.event.result.detail === cause.detail
  }
  if (
    resultRecord.event.result._tag !== "PreparedCandidate" ||
    resultRecord.event.result.candidateText !== cause.candidateText ||
    quarantine.event.basis.evidence.candidateObservationAt === undefined
  ) {
    return false
  }
  const observationRecords = recordsAt(records, quarantine.event.basis.evidence.candidateObservationAt)
  const observationRecord = observationRecords.length === 1 ? observationRecords[0] : undefined
  if (observationRecord === undefined) return false
  if (
    observationRecord.event._tag !== "IntegratorRunCandidateGitObserved" &&
    observationRecord.event._tag !== "IntegratorCandidateGitObserved"
  ) {
    return false
  }
  const exactObservationBinding =
    observationRecord.event._tag === "IntegratorRunCandidateGitObserved"
      ? observationRecord.event.run.ordinal === runOne.ordinal &&
        integratorCorrelationsEqual(observationRecord.event.run.session, runOne.session)
      : integratorCorrelationsEqual(observationRecord.event.correlation, runOne.session)
  return (
    exactObservationBinding &&
    observationRecord.event.candidateText === cause.candidateText &&
    gitObservationEquals(observationRecord.event.observation, cause.observation) &&
    resultRecord.position < observationRecord.position &&
    observationRecord.position < quarantine.position
  )
}

// eslint-disable-next-line complexity -- Provider-absence Retry authority binds the exact session, detail, run-one start, and quarantine chronology.
const providerRunFailureEvidenceMatches = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  runOne: IntegratorRunCorrelation
): boolean => {
  if (quarantine.event.basis._tag !== "ProviderRunFailure") return false
  const start = exactRunOneStart(records, runOne)
  const absenceRecords = recordsAt(records, quarantine.event.basis.ownedActivityProvenAbsentAt)
  const absence = absenceRecords.length === 1 ? absenceRecords[0] : undefined
  return (
    start !== undefined &&
    start.position > runOne.session.targetLineageObservedAt &&
    absence?.event._tag === "IntegrationProviderRunActivityAbsent" &&
    integratorCorrelationsEqual(absence.event.correlation, runOne.session) &&
    absence.event.detail === quarantine.event.basis.detail &&
    start.position < absence.position &&
    absence.position < quarantine.position
  )
}

const exactRunOneQuarantineEvidenceMatches = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  runOne: IntegratorRunCorrelation
): boolean =>
  conclusiveRunOneEvidenceMatches(records, quarantine, runOne) ||
  providerRunFailureEvidenceMatches(records, quarantine, runOne)

// eslint-disable-next-line complexity -- Retry authority is one indivisible Q/D/evidence relation with fail-closed identity checks.
const retryDirectionOrIssue = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): DirectionRecord | string => {
  const workflowRunId = run.session.plannedAttempt.runId
  const retryDirections = records.filter(
    (record): record is DirectionRecord =>
      record.event._tag === "IntegrationQuarantineDirectionApplied" &&
      record.event.fingerprint.direction === "Retry" &&
      record.event.fingerprint.sessionId === run.session.sessionId &&
      record.event.requestId.runId === workflowRunId &&
      record.runId === workflowRunId
  )
  if (retryDirections.length !== 1) return "run two requires one exact Retry direction for its session and Run"
  const direction = retryDirections[0]
  if (direction === undefined) return "run two requires one exact Retry direction for its session and Run"
  const quarantineAt = direction.event.fingerprint.quarantineAt
  const subjectDirections = records.filter(
    (record) =>
      record.event._tag === "IntegrationQuarantineDirectionApplied" &&
      record.event.fingerprint.sessionId === run.session.sessionId &&
      record.event.fingerprint.quarantineAt === quarantineAt
  )
  if (subjectDirections.length !== 1) return "run two requires Retry to be the unique winning quarantine direction"

  const quarantineRecords = recordsAt(records, quarantineAt)
  const quarantine = quarantineRecords.length === 1 ? quarantineRecords[0] : undefined
  if (
    !isQuarantineRecord(quarantine) ||
    quarantine.runId !== workflowRunId ||
    !integratorCorrelationsEqual(quarantine.event.correlation, run.session) ||
    quarantine.position >= direction.position
  ) {
    return "run two Retry direction has no exact earlier quarantine for its session and Run"
  }
  const runOne = integratorRunCorrelationForSession(run.session, IntegratorRunOrdinal.make(1))
  return exactRunOneQuarantineEvidenceMatches(records, quarantine, runOne)
    ? direction
    : "run two quarantine has no exact terminal ordinal-one evidence"
}

const matchingFreshTargetLineageExists = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  directionAt: number,
  beforePosition: JournalPosition,
  requiredTargetLineageObservedAt: JournalPosition | undefined
): boolean =>
  records.some(
    // eslint-disable-next-line complexity -- A fresh lineage pair must bind every Git operation, target, attempt, head, and position fact.
    (observationRecord) => {
      if (
        observationRecord.event._tag !== "TargetLineageObserved" ||
        observationRecord.position <= directionAt ||
        observationRecord.position >= beforePosition ||
        (requiredTargetLineageObservedAt !== undefined &&
          observationRecord.position !== requiredTargetLineageObservedAt) ||
        observationRecord.event.observation.targetHeadSha !== run.session.expectedTargetHead ||
        observationRecord.event.observation.plannedBaseSha !== run.session.plannedAttempt.baseSha ||
        !observationRecord.event.observation.plannedBaseIsAncestorOfTargetHead ||
        !plannedTaskAttemptEquivalence(observationRecord.event.plannedAttempt, run.session.plannedAttempt)
      ) {
        return false
      }
      const observation = observationRecord.event
      return records.some(
        (intentRecord) =>
          intentRecord.event._tag === "GitReadIntentRecorded" &&
          intentRecord.event.operation._tag === "ReadTargetLineage" &&
          intentRecord.position > directionAt &&
          intentRecord.position < observationRecord.position &&
          intentRecord.event.operation.operationId === observation.operationId &&
          intentRecord.event.operation.integrationTarget.repository === run.session.integrationTarget.repository &&
          intentRecord.event.operation.integrationTarget.ref === run.session.integrationTarget.ref &&
          plannedTaskAttemptEquivalence(intentRecord.event.operation.plannedAttempt, run.session.plannedAttempt)
      )
    }
  )

/** Pure reconstruction validator for the exact Retry chronology preceding an ordinal-two start. */
export const integratorRunTwoAuthorizationIssue = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  options: { readonly beforePosition: JournalPosition; readonly requiredTargetLineageObservedAt?: JournalPosition }
): string | undefined => {
  if (run.ordinal !== integratorRetryRunOrdinal) return "Retry authorization applies only to Integrator run ordinal two"
  const direction = retryDirectionOrIssue(records, run)
  if (typeof direction === "string") return direction
  return matchingFreshTargetLineageExists(
    records,
    run,
    direction.position,
    options.beforePosition,
    options.requiredTargetLineageObservedAt
  )
    ? undefined
    : "run two requires a fresh matching unchanged target-lineage intent and observation after Retry"
}

/**
 * Returns why run two lacks exact Journal authorization. Retry authority is
 * the single winning `(session, quarantine, Retry)` direction plus a fresh
 * matching target-lineage read after that direction; no quarantine reducer
 * state or process-local counter participates.
 */
export const integratorRetryAuthorizationIssue = (
  records: ReadonlyArray<JournalRecord>,
  request: IntegratorRunPreparationInput
): string | undefined => {
  const { run } = request
  if (run.ordinal !== integratorRetryRunOrdinal) return "Retry authorization applies only to Integrator run ordinal two"
  const direction = retryDirectionOrIssue(records, run)
  if (typeof direction === "string") return direction

  const freshIntentAt = matchingIntegratorTargetLineageIntentPosition(records, request.preparation)
  const existingRunStart = records.find(
    (record) =>
      record.event._tag === "IntegratorRunStarted" &&
      record.event.run.ordinal === run.ordinal &&
      integratorCorrelationsEqual(record.event.run.session, run.session)
  )
  if (
    freshIntentAt === undefined ||
    freshIntentAt <= direction.position ||
    request.preparation.targetLineageObservedAt <= freshIntentAt ||
    (existingRunStart !== undefined && request.preparation.targetLineageObservedAt >= existingRunStart.position)
  ) {
    return "run two requires a fresh matching target-lineage intent and observation after Retry"
  }
  return undefined
}
