/* eslint-disable max-lines -- Cold diagnostics and indexed live provenance stay co-located for parity. */
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantinedRecordKey,
  integratorAutomaticSuccessorSessionFixedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  isJournalRecordEvidence,
  journalRecordByKey,
  journalRecordByPosition,
  journalRecordsOfKind,
  type JournalHistorySource,
  type JournalRecordEvidence
} from "../../../workflow-journal/record-evidence.js"
import { exactJournalRecordAtKey } from "../../../workflow-journal/exact-record.js"
import type {
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantinedEvent as IntegrationQuarantinedEventType
} from "./events.js"
import {
  type IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  integratorRetryRunOrdinal,
  integratorRunCorrelationsEqual,
  type IntegratorSessionCorrelation
} from "../integrator/events.js"
import {
  integratorCorrelationsEqual,
  integratorResponsibilityFactsEqual,
  integratorResponsibilityFactsFromCorrelation
} from "../integrator/state.js"
import {
  evaluateIntegratorFullRerunAuthorization,
  evaluateIntegratorRetryAuthorization
} from "../integrator/retry-authorization.js"
import { exactTargetLineageRecord } from "./canonical-lineage.js"
import { evaluateIntegratorFullRerunSuccessor } from "../integrator/successor-history.js"
import { validateAutomaticSuccessorSessionFixedRecord } from "../integrator/automatic-successor-session.js"
import { validatePromotionStaleQuarantineEvidence } from "./promotion-stale-evidence.js"

type AbsenceRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationProviderRunActivityAbsent" }>
}

type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEventType }

const runIdFor = (run: IntegratorRunCorrelation) => run.session.plannedAttempt.runId
const initialRunOrdinal = IntegratorRunOrdinal.make(1)

const fixedSessionKey = (session: IntegratorSessionCorrelation) =>
  integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session))

const sameResponsibility = (left: IntegratorSessionCorrelation, right: IntegratorSessionCorrelation): boolean =>
  integratorResponsibilityFactsEqual(
    integratorResponsibilityFactsFromCorrelation(left),
    integratorResponsibilityFactsFromCorrelation(right)
  )

const absenceMatches = (record: JournalRecord, run: IntegratorRunCorrelation): record is AbsenceRecord =>
  record.runId === runIdFor(run) &&
  record.event._tag === "IntegrationProviderRunActivityAbsent" &&
  integratorCorrelationsEqual(record.event.correlation, run.session) &&
  record.key === integrationProviderRunActivityAbsentRecordKey(run) &&
  integratorRunCorrelationsEqual(record.event.run, run)

type FixedSessionValidation =
  | { readonly _tag: "Valid"; readonly session: JournalRecord }
  | { readonly _tag: "Invalid"; readonly detail: string }

type DirectSessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSessionFixed" }>
}
type SuccessorSessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
}
type AutomaticSuccessorSessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorAutomaticSuccessorSessionFixed" }>
}
type ProviderSuccessorSessionRecord = SuccessorSessionRecord | AutomaticSuccessorSessionRecord
type FixedSessionRecord = DirectSessionRecord | ProviderSuccessorSessionRecord

const isDirectSessionRecord = (record: JournalRecord): record is DirectSessionRecord =>
  record.event._tag === "IntegratorSessionFixed"

const isFullRerunSuccessorSessionRecord = (record: JournalRecord): record is SuccessorSessionRecord =>
  record.event._tag === "IntegratorSuccessorSessionFixed"

const isAutomaticSuccessorSessionRecord = (record: JournalRecord): record is AutomaticSuccessorSessionRecord =>
  record.event._tag === "IntegratorAutomaticSuccessorSessionFixed"

const directSessionsFor = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): ReadonlyArray<DirectSessionRecord> =>
  history.filter(
    (record): record is DirectSessionRecord =>
      record.event._tag === "IntegratorSessionFixed" && sameResponsibility(record.event.correlation, run.session)
  )

const successorSessionsFor = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): ReadonlyArray<ProviderSuccessorSessionRecord> =>
  history.filter(
    (record): record is ProviderSuccessorSessionRecord =>
      (record.event._tag === "IntegratorSuccessorSessionFixed" ||
        record.event._tag === "IntegratorAutomaticSuccessorSessionFixed") &&
      integratorCorrelationsEqual(record.event.successor, run.session)
  )

const directSessionHasForeignEvidence = (
  direct: ReadonlyArray<DirectSessionRecord>,
  run: IntegratorRunCorrelation,
  key: JournalRecord["key"]
): boolean =>
  direct.some(
    (record) =>
      !integratorCorrelationsEqual(record.event.correlation, run.session) ||
      record.runId !== runIdFor(run) ||
      record.key !== key
  )

const exactDirectSession = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>
): FixedSessionValidation => {
  const key = fixedSessionKey(run.session)
  if (direct.length !== 1 || directSessionHasForeignEvidence(direct, run, key)) {
    return { _tag: "Invalid", detail: "fixed Integrator session evidence is foreign to the provider run" }
  }
  const lookup = exactJournalRecordAtKey(history, key)
  if (lookup._tag !== "Found") {
    return { _tag: "Invalid", detail: "provider run lacks its exact fixed Integrator session" }
  }
  const lineage = exactTargetLineageRecord(history, {
    expectedTargetHead: run.session.expectedTargetHead,
    integrationTarget: run.session.integrationTarget,
    plannedAttempt: run.session.plannedAttempt,
    targetLineageObservedAt: run.session.targetLineageObservedAt
  })
  if (lineage === undefined || lineage.observation.position >= lookup.record.position) {
    return { _tag: "Invalid", detail: "provider run lacks its exact target-lineage observation" }
  }
  return { _tag: "Valid", session: lookup.record }
}

const fixedSessionRecordsFor = (
  history: JournalHistorySource,
  correlation: IntegratorSessionCorrelation
): ReadonlyArray<FixedSessionRecord> => {
  const candidates = [
    ...journalRecordsOfKind(history, "IntegratorSessionFixed"),
    ...journalRecordsOfKind(history, "IntegratorSuccessorSessionFixed"),
    ...journalRecordsOfKind(history, "IntegratorAutomaticSuccessorSessionFixed")
  ]
  return candidates.filter((record): record is FixedSessionRecord => {
    if (isDirectSessionRecord(record)) return integratorCorrelationsEqual(record.event.correlation, correlation)
    if (isFullRerunSuccessorSessionRecord(record) || isAutomaticSuccessorSessionRecord(record)) {
      return integratorCorrelationsEqual(record.event.successor, correlation)
    }
    return false
  })
}

const uniqueFixedPredecessorBefore = (
  history: JournalHistorySource,
  correlation: IntegratorSessionCorrelation,
  successor: AutomaticSuccessorSessionRecord
): FixedSessionRecord | undefined => {
  const predecessors = fixedSessionRecordsFor(history, correlation).filter(
    (record) => record.position < successor.position
  )
  return predecessors.length === 1 ? predecessors[0] : undefined
}

const exactDirectPredecessorRecord = (
  history: JournalHistorySource,
  successorRun: IntegratorRunCorrelation,
  predecessorRecord: DirectSessionRecord
): DirectSessionRecord | undefined => {
  const predecessor = predecessorRecord.event.correlation
  const key = fixedSessionKey(predecessor)
  const lookup = exactJournalRecordAtKey(history, key)
  if (lookup._tag !== "Found" || !isDirectSessionRecord(lookup.record)) return undefined
  const record = lookup.record
  if (
    record.position !== predecessorRecord.position ||
    record.key !== key ||
    record.runId !== runIdFor(successorRun) ||
    !integratorCorrelationsEqual(record.event.correlation, predecessor)
  ) {
    return undefined
  }
  return record
}

const hasExactPredecessorLineageBefore = (
  history: JournalHistorySource,
  predecessor: IntegratorSessionCorrelation,
  sessionPosition: JournalRecord["position"]
): boolean => {
  const lineage = exactTargetLineageRecord(history, {
    expectedTargetHead: predecessor.expectedTargetHead,
    integrationTarget: predecessor.integrationTarget,
    plannedAttempt: predecessor.plannedAttempt,
    targetLineageObservedAt: predecessor.targetLineageObservedAt
  })
  return lineage !== undefined && lineage.observation.position < sessionPosition
}

const directPredecessorEvidenceMatches = (
  directPredecessor: DirectSessionRecord,
  predecessorRecord: DirectSessionRecord,
  predecessor: IntegratorSessionCorrelation
): boolean =>
  directPredecessor.position === predecessorRecord.position &&
  integratorCorrelationsEqual(directPredecessor.event.correlation, predecessor)

const exactDirectAutomaticPredecessor = (
  history: JournalHistorySource,
  successorRun: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>,
  predecessorRecord: DirectSessionRecord
): FixedSessionValidation => {
  const predecessor = predecessorRecord.event.correlation
  if (direct.length !== 1) return invalidDirectPredecessor()
  const directPredecessor = direct[0]
  if (directPredecessor === undefined) return invalidDirectPredecessor()
  const record = exactDirectPredecessorRecord(history, successorRun, predecessorRecord)
  if (record === undefined) return invalidDirectPredecessor()
  if (!directPredecessorEvidenceMatches(directPredecessor, predecessorRecord, predecessor)) {
    return invalidDirectPredecessor()
  }
  if (!hasExactPredecessorLineageBefore(history, predecessor, record.position)) return invalidDirectPredecessor()
  return { _tag: "Valid", session: record }
}

const invalidDirectPredecessor = (): FixedSessionValidation => ({
  _tag: "Invalid",
  detail: "provider automatic successor has foreign or incomplete direct predecessor evidence"
})

const exactFullRerunAutomaticPredecessor = (
  history: JournalHistorySource,
  successorRun: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>,
  predecessorRecord: SuccessorSessionRecord
): FixedSessionValidation => {
  if (direct.length !== 1) {
    return { _tag: "Invalid", detail: "provider automatic successor has foreign FullRerun predecessor evidence" }
  }
  const directPredecessor = direct[0]
  if (
    directPredecessor === undefined ||
    !integratorCorrelationsEqual(directPredecessor.event.correlation, predecessorRecord.event.predecessor)
  ) {
    return { _tag: "Invalid", detail: "provider automatic successor has foreign FullRerun predecessor evidence" }
  }
  const fullRerun = evaluateIntegratorFullRerunSuccessor(
    history,
    predecessorRecord,
    predecessorRecord.event.predecessor
  )
  if (fullRerun._tag === "Invalid") return fullRerun
  if (predecessorRecord.runId !== runIdFor(successorRun)) {
    return { _tag: "Invalid", detail: "provider automatic successor has a foreign FullRerun predecessor run" }
  }
  return { _tag: "Valid", session: predecessorRecord }
}

const validAutomaticSuccessorFixRecord = (
  history: JournalHistorySource,
  run: IntegratorRunCorrelation,
  successor: AutomaticSuccessorSessionRecord
): boolean => {
  const key = integratorAutomaticSuccessorSessionFixedRecordKey(
    successor.event.predecessor,
    successor.event.authorizationAt
  )
  const lookup = exactJournalRecordAtKey(history, key)
  if (lookup._tag !== "Found") return false
  if (lookup.record.position !== successor.position || successor.key !== key) return false
  if (successor.runId !== runIdFor(run) || successor.position <= run.session.targetLineageObservedAt) return false
  return integratorCorrelationsEqual(successor.event.successor, run.session)
}

const validateAutomaticPredecessor = (
  history: JournalHistorySource,
  successorRun: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>,
  predecessorRecord: FixedSessionRecord
): FixedSessionValidation => {
  if (isDirectSessionRecord(predecessorRecord)) {
    return exactDirectAutomaticPredecessor(history, successorRun, direct, predecessorRecord)
  }
  if (isAutomaticSuccessorSessionRecord(predecessorRecord)) {
    return exactAutomaticSuccessorSession(history, successorRun, direct, predecessorRecord)
  }
  if (isFullRerunSuccessorSessionRecord(predecessorRecord)) {
    return exactFullRerunAutomaticPredecessor(history, successorRun, direct, predecessorRecord)
  }
  return { _tag: "Invalid", detail: "provider automatic successor has an unknown predecessor record" }
}

function exactAutomaticSuccessorSession(
  history: JournalHistorySource,
  run: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>,
  successor: AutomaticSuccessorSessionRecord
): FixedSessionValidation {
  const successorRun = { ...run, session: successor.event.successor }
  const predecessorRecord = uniqueFixedPredecessorBefore(history, successor.event.predecessor, successor)
  if (predecessorRecord === undefined) {
    return { _tag: "Invalid", detail: "provider automatic successor lacks one exact fixed predecessor session" }
  }
  const predecessorValidation = validateAutomaticPredecessor(history, successorRun, direct, predecessorRecord)
  if (predecessorValidation._tag === "Invalid") return predecessorValidation
  const validation = validateAutomaticSuccessorSessionFixedRecord(history, successor, successor.event.predecessor)
  if (validation._tag === "Invalid") return validation
  if (!validAutomaticSuccessorFixRecord(history, successorRun, successor)) {
    return { _tag: "Invalid", detail: "provider automatic successor has a foreign key or chronology" }
  }
  return { _tag: "Valid", session: successor }
}

const fixedSessionForRun = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): FixedSessionValidation => {
  const direct = directSessionsFor(history, run)
  const successors = successorSessionsFor(history, run)
  if (successors.length > 1) {
    return { _tag: "Invalid", detail: "provider run has duplicate successor session evidence" }
  }
  const successor = successors[0]
  if (successor === undefined) return exactDirectSession(history, run, direct)
  if (isAutomaticSuccessorSessionRecord(successor)) {
    return exactAutomaticSuccessorSession(history, run, direct, successor)
  }
  if (!isFullRerunSuccessorSessionRecord(successor)) {
    return { _tag: "Invalid", detail: "provider run has unknown successor session evidence" }
  }
  if (direct.some((record) => !integratorCorrelationsEqual(record.event.correlation, successor.event.predecessor))) {
    return { _tag: "Invalid", detail: "provider successor has foreign fixed-session evidence" }
  }
  const relation = evaluateIntegratorFullRerunSuccessor(history, successor, successor.event.predecessor)
  if (relation._tag === "Invalid") return relation
  return { _tag: "Valid", session: successor }
}

/** Returns the exact durable start for a run after its fixed session relation. */
type ValidFixedSession = Extract<FixedSessionValidation, { readonly _tag: "Valid" }>

const providerRunStartFor = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  fixedSession: ValidFixedSession
): JournalRecord | undefined => {
  const key = integratorRunStartedRecordKey(run)
  const starts = records.filter(
    (record) => record.event._tag === "IntegratorRunStarted" && integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (starts.length !== 1 || starts.some((record) => record.runId !== runIdFor(run) || record.key !== key)) {
    return undefined
  }
  const start = starts.find((candidate) => candidate.key === key)
  return start !== undefined && start.position > fixedSession.session.position ? start : undefined
}

const firstSuccessorSessionFor = (
  history: JournalHistorySource,
  run: IntegratorRunCorrelation
): JournalRecord | undefined => {
  let successor: JournalRecord | undefined
  for (const record of journalRecordsOfKind(history, "IntegratorSuccessorSessionFixed")) {
    if (
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      integratorCorrelationsEqual(record.event.successor, run.session)
    ) {
      successor = record
      break
    }
  }
  return successor
}

const retryAuthorizationIssue = (
  history: JournalHistorySource,
  run: IntegratorRunCorrelation,
  runStart: JournalRecord
): string | undefined => {
  if (run.ordinal !== integratorRetryRunOrdinal) return undefined
  const successor = firstSuccessorSessionFor(history, run)
  if (successor?.event._tag === "IntegratorSuccessorSessionFixed") {
    const authorization = evaluateIntegratorFullRerunAuthorization(
      history,
      run,
      successor.event.predecessor,
      run.session.targetLineageObservedAt
    )
    return authorization._tag === "Authorized" ? undefined : authorization.detail
  }
  const authorization = evaluateIntegratorRetryAuthorization(history, run, { beforePosition: runStart.position })
  if (authorization._tag === "Rejected") return authorization.detail
  return authorization.authorization.lineage.observation.event.observation.targetHeadSha ===
    run.session.expectedTargetHead
    ? undefined
    : "Retry provider-run quarantine requires an unchanged fresh target head"
}

const hasRecordedRunResult = (history: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean =>
  history.some(
    (record) =>
      record.event._tag === "IntegratorRunResultRecorded" &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )

const hasRecordedRunCandidateEvidence = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): boolean =>
  history.some(
    (record) =>
      (record.event._tag === "IntegratorRunCandidateGitReadIntended" ||
        record.event._tag === "IntegratorRunCandidateGitObserved") &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )

type ProviderRunPredecessors = { readonly session: JournalRecord; readonly runStart: JournalRecord }
type ProviderRunPredecessorValidation =
  | { readonly _tag: "Valid"; readonly value: ProviderRunPredecessors }
  | { readonly _tag: "Invalid"; readonly detail: string }

const validateRunOnePredecessors = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  beforePosition: JournalRecord["position"]
): ProviderRunPredecessorValidation => {
  if (![initialRunOrdinal, integratorRetryRunOrdinal].includes(run.ordinal)) {
    return { _tag: "Invalid", detail: "provider-run quarantine accepts only Integrator runs 1 and 2" }
  }
  const history = records.filter((record) => record.position < beforePosition)
  const fixedSession = fixedSessionForRun(history, run)
  if (fixedSession._tag === "Invalid") return fixedSession
  const runStart = providerRunStartFor(history, run, fixedSession)
  if (runStart === undefined || runStart.position <= fixedSession.session.position) {
    return { _tag: "Invalid", detail: "provider-run quarantine requires one exact run start after the fixed session" }
  }
  const authorizationIssue = retryAuthorizationIssue(history, run, runStart)
  if (authorizationIssue !== undefined) return { _tag: "Invalid", detail: authorizationIssue }
  if (hasRecordedRunResult(history, run)) {
    return { _tag: "Invalid", detail: "provider-run absence contradicts an already recorded Integrator result" }
  }
  if (hasRecordedRunCandidateEvidence(history, run)) {
    return { _tag: "Invalid", detail: "provider-run absence contradicts run-bound candidate evidence" }
  }
  return { _tag: "Valid", value: { session: fixedSession.session, runStart } }
}

const exactRunStartIssue = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): string | undefined => {
  const key = integratorRunStartedRecordKey(run)
  const starts = records.filter(
    (candidate) =>
      candidate.event._tag === "IntegratorRunStarted" && integratorRunCorrelationsEqual(candidate.event.run, run)
  )
  return starts.length === 1 && !starts.some((candidate) => candidate.runId !== runIdFor(run) || candidate.key !== key)
    ? undefined
    : "provider run-start evidence is duplicate or wrongly keyed"
}

const exactRunAbsenceIssue = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  record: JournalRecord
): string | undefined => {
  const absences = records.filter(
    (candidate) =>
      candidate.event._tag === "IntegrationProviderRunActivityAbsent" &&
      integratorRunCorrelationsEqual(candidate.event.run, run)
  )
  return absences.length === 1 && absences[0] === record
    ? undefined
    : "provider-activity absence is duplicate or contradictory"
}

const hasExactRunResultOrCandidate = (records: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean =>
  records.some(
    (candidate) =>
      (candidate.event._tag === "IntegratorRunResultRecorded" &&
        integratorRunCorrelationsEqual(candidate.event.run, run)) ||
      ((candidate.event._tag === "IntegratorRunCandidateGitReadIntended" ||
        candidate.event._tag === "IntegratorRunCandidateGitObserved") &&
        integratorRunCorrelationsEqual(candidate.event.run, run))
  )

type ProviderAbsenceValidation =
  | {
      readonly _tag: "Valid"
      readonly run: IntegratorRunCorrelation
      readonly record: AbsenceRecord
      readonly runStart: JournalRecord
    }
  | { readonly _tag: "Invalid"; readonly detail: string }

const indexedSuccessorSession = (
  records: JournalRecordEvidence,
  run: IntegratorRunCorrelation
): JournalRecord | undefined => {
  let session: JournalRecord | undefined
  for (const candidate of journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed")) {
    if (
      candidate.event._tag === "IntegratorSuccessorSessionFixed" &&
      integratorCorrelationsEqual(candidate.event.successor, run.session)
    ) {
      if (session !== undefined) return undefined
      const relation = evaluateIntegratorFullRerunSuccessor(records, candidate, candidate.event.predecessor)
      if (relation._tag === "Invalid") return undefined
      session = candidate
    }
  }
  for (const candidate of journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")) {
    if (
      isAutomaticSuccessorSessionRecord(candidate) &&
      integratorCorrelationsEqual(candidate.event.successor, run.session)
    ) {
      if (session !== undefined) return undefined
      const direct = [...journalRecordsOfKind(records, "IntegratorSessionFixed")].filter(
        (record): record is DirectSessionRecord =>
          isDirectSessionRecord(record) && sameResponsibility(record.event.correlation, run.session)
      )
      const relation = exactAutomaticSuccessorSession(records, run, direct, candidate)
      if (relation._tag === "Invalid") return undefined
      session = relation.session
    }
  }
  return session
}

const indexedFixedSession = (
  records: JournalRecordEvidence,
  run: IntegratorRunCorrelation
): JournalRecord | undefined => {
  const direct = journalRecordByKey(records, fixedSessionKey(run.session))
  if (
    direct?.event._tag !== "IntegratorSessionFixed" ||
    !integratorCorrelationsEqual(direct.event.correlation, run.session)
  ) {
    return indexedSuccessorSession(records, run)
  } else {
    const lineage = exactTargetLineageRecord(records, {
      expectedTargetHead: run.session.expectedTargetHead,
      integrationTarget: run.session.integrationTarget,
      plannedAttempt: run.session.plannedAttempt,
      targetLineageObservedAt: run.session.targetLineageObservedAt
    })
    if (lineage === undefined || lineage.observation.position >= direct.position) return undefined
  }
  return direct
}

const indexedProviderRunStart = (
  records: JournalRecordEvidence,
  run: IntegratorRunCorrelation,
  beforePosition: JournalRecord["position"]
): ProviderRunPredecessors | undefined => {
  const session = indexedFixedSession(records, run)
  if (session === undefined) return undefined
  const start = journalRecordByKey(records, integratorRunStartedRecordKey(run))
  return start?.event._tag === "IntegratorRunStarted" &&
    start.position > session.position &&
    start.position < beforePosition &&
    integratorRunCorrelationsEqual(start.event.run, run)
    ? { session, runStart: start }
    : undefined
}

/** Resolves the exact fixed-session/run-start relation before a causal boundary without applying absence-only exclusions. */
export const providerRunStartBefore = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  beforePosition: JournalRecord["position"]
): JournalRecord | undefined => {
  if (isJournalRecordEvidence(records)) return indexedProviderRunStart(records, run, beforePosition)?.runStart
  const history = records.filter((record) => record.position < beforePosition)
  const fixedSession = fixedSessionForRun(history, run)
  return fixedSession._tag === "Valid" ? providerRunStartFor(history, run, fixedSession) : undefined
}

const indexedRunResultOrCandidateExists = (records: JournalRecordEvidence, run: IntegratorRunCorrelation): boolean => {
  for (const candidate of journalRecordsOfKind(records, "IntegratorRunResultRecorded")) {
    if (
      candidate.event._tag === "IntegratorRunResultRecorded" &&
      integratorRunCorrelationsEqual(candidate.event.run, run)
    )
      return true
  }
  for (const kind of ["IntegratorRunCandidateGitReadIntended", "IntegratorRunCandidateGitObserved"] as const) {
    for (const candidate of journalRecordsOfKind(records, kind)) {
      if ("run" in candidate.event && integratorRunCorrelationsEqual(candidate.event.run, run)) return true
    }
  }
  return false
}

const validateIndexedProviderRunActivityAbsent = (
  records: JournalRecordEvidence,
  record: JournalRecord
): ProviderAbsenceValidation => {
  if (record.event._tag !== "IntegrationProviderRunActivityAbsent") {
    return { _tag: "Invalid", detail: "record is not provider-activity absence evidence" }
  }
  const run = record.event.run
  if (!integratorCorrelationsEqual(record.event.correlation, run.session)) {
    return { _tag: "Invalid", detail: "provider-activity absence has a foreign session correlation" }
  }
  if (![initialRunOrdinal, integratorRetryRunOrdinal].includes(run.ordinal)) {
    return { _tag: "Invalid", detail: "provider-run quarantine accepts only Integrator runs 1 and 2" }
  }
  const predecessors = indexedProviderRunStart(records, run, record.position)
  if (predecessors === undefined) {
    return { _tag: "Invalid", detail: "provider-run quarantine requires one exact run start after the fixed session" }
  }
  const authorizationIssue = retryAuthorizationIssue(records, run, predecessors.runStart)
  if (authorizationIssue !== undefined) return { _tag: "Invalid", detail: authorizationIssue }
  if (!absenceMatches(record, run)) {
    return { _tag: "Invalid", detail: "provider-activity absence has a foreign key or Journal Run" }
  }
  if (indexedRunResultOrCandidateExists(records, run))
    return { _tag: "Invalid", detail: "provider-activity absence contradicts exact run evidence" }
  return { _tag: "Valid", run, record, runStart: predecessors.runStart }
}

const indexedProviderAbsenceConflict = (
  records: JournalRecordEvidence,
  run: IntegratorRunCorrelation
): string | undefined => {
  for (const kind of [
    "IntegratorRunResultRecorded",
    "IntegratorRunCandidateGitReadIntended",
    "IntegratorRunCandidateGitObserved"
  ] as const) {
    for (const candidate of journalRecordsOfKind(records, kind)) {
      if ("run" in candidate.event && integratorRunCorrelationsEqual(candidate.event.run, run)) {
        return kind === "IntegratorRunResultRecorded"
          ? "provider-run absence contradicts an already recorded Integrator result"
          : "provider-run absence contradicts run-bound candidate evidence"
      }
    }
  }
  return undefined
}

/** Validates the exact fixed-session and run-start chronology before an absence append. */
export const validateProviderRunPredecessors = (
  records: JournalHistorySource,
  run: IntegratorRunCorrelation,
  beforePosition: JournalRecord["position"]
): ProviderRunPredecessorValidation => {
  if (!isJournalRecordEvidence(records)) return validateRunOnePredecessors(records, run, beforePosition)
  if (![initialRunOrdinal, integratorRetryRunOrdinal].includes(run.ordinal)) {
    return { _tag: "Invalid", detail: "provider-run quarantine accepts only Integrator runs 1 and 2" }
  }
  const predecessors = indexedProviderRunStart(records, run, beforePosition)
  if (predecessors === undefined) {
    return { _tag: "Invalid", detail: "provider-run quarantine requires one exact run start after the fixed session" }
  }
  const authorizationIssue = retryAuthorizationIssue(records, run, predecessors.runStart)
  if (authorizationIssue !== undefined) return { _tag: "Invalid", detail: authorizationIssue }
  const absenceConflict = indexedProviderAbsenceConflict(records, run)
  if (absenceConflict !== undefined) return { _tag: "Invalid", detail: absenceConflict }
  return { _tag: "Valid", value: predecessors }
}

/** Pure validator shared by provider-failure reconciliation and cleanup provenance. */
export const validateProviderRunActivityAbsent = (
  records: JournalHistorySource,
  record: JournalRecord
): ProviderAbsenceValidation => {
  if (isJournalRecordEvidence(records)) return validateIndexedProviderRunActivityAbsent(records, record)
  if (record.event._tag !== "IntegrationProviderRunActivityAbsent") {
    return { _tag: "Invalid", detail: "record is not provider-activity absence evidence" }
  }
  const run = record.event.run
  if (!integratorCorrelationsEqual(record.event.correlation, run.session)) {
    return { _tag: "Invalid", detail: "provider-activity absence has a foreign session correlation" }
  }
  const predecessors = validateRunOnePredecessors(records, run, record.position)
  if (predecessors._tag === "Invalid") return predecessors
  if (!absenceMatches(record, run)) {
    return { _tag: "Invalid", detail: "provider-activity absence has a foreign key or Journal Run" }
  }
  const runStartIssue = exactRunStartIssue(records, run)
  if (runStartIssue !== undefined) return { _tag: "Invalid", detail: runStartIssue }
  const absenceIssue = exactRunAbsenceIssue(records, run, record)
  if (absenceIssue !== undefined) return { _tag: "Invalid", detail: absenceIssue }
  if (hasExactRunResultOrCandidate(records, run)) {
    return { _tag: "Invalid", detail: "provider-activity absence contradicts exact run evidence" }
  }
  return { _tag: "Valid", run, record, runStart: predecessors.value.runStart }
}

const quarantineMatchesFingerprint = (
  record: JournalRecord | undefined,
  fingerprint: IntegrationQuarantineDirectionFingerprint
): record is QuarantineRecord =>
  record !== undefined &&
  record.event._tag === "IntegrationQuarantined" &&
  record.position === fingerprint.quarantineAt &&
  record.event.correlation.sessionId === fingerprint.sessionId &&
  record.key === integrationQuarantinedRecordKey(record.event.correlation.sessionId, record.event.basis)

/** Finds cleanup provenance after the provider-absence or stale-promotion proof has passed. */
export const quarantineRecordForFingerprint = (
  records: JournalHistorySource,
  fingerprint: IntegrationQuarantineDirectionFingerprint
): QuarantineRecord | undefined => {
  const candidates = isJournalRecordEvidence(records)
    ? [journalRecordByPosition(records, fingerprint.quarantineAt)]
    : records
  return candidates.find((record): record is QuarantineRecord => {
    if (!quarantineMatchesFingerprint(record, fingerprint)) return false
    const basis = record.event.basis
    if (basis._tag === "PromotionStale") {
      return validatePromotionStaleQuarantineEvidence(records, record)._tag === "Valid"
    }
    if (basis._tag !== "ProviderRunFailure") return false
    const absence = journalRecordByPosition(records, basis.ownedActivityProvenAbsentAt)
    const validation = absence === undefined ? undefined : validateProviderRunActivityAbsent(records, absence)
    return (
      validation?._tag === "Valid" &&
      validation.record.position < record.position &&
      validation.record.event.detail === basis.detail
    )
  })
}
