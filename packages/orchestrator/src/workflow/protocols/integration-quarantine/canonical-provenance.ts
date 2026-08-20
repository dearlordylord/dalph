import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
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
): ReadonlyArray<SuccessorSessionRecord> =>
  history.filter(
    (record): record is SuccessorSessionRecord =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
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

const directSessionRecordIsExact = (session: JournalRecord, run: IntegratorRunCorrelation): boolean =>
  session.runId === runIdFor(run) &&
  session.event._tag === "IntegratorSessionFixed" &&
  integratorCorrelationsEqual(session.event.correlation, run.session) &&
  session.position > run.session.targetLineageObservedAt

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
  if (lookup._tag === "Duplicate") return { _tag: "Invalid", detail: lookup.detail }
  if (lookup._tag === "Missing") {
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
  return directSessionRecordIsExact(lookup.record, run)
    ? { _tag: "Valid", session: lookup.record }
    : { _tag: "Invalid", detail: "provider run lacks its exact fixed Integrator session" }
}

const fixedSessionForRun = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): FixedSessionValidation => {
  const direct = directSessionsFor(history, run)
  const successors = successorSessionsFor(history, run)
  if (successors.length > 1) {
    return { _tag: "Invalid", detail: "provider run has duplicate FullRerun successor session evidence" }
  }
  const successor = successors[0]
  if (successor === undefined) return exactDirectSession(history, run, direct)
  const relation = evaluateIntegratorFullRerunSuccessor(history, successor, successor.event.predecessor)
  if (relation._tag === "Invalid") return relation
  return integratorCorrelationsEqual(relation.successor, run.session)
    ? { _tag: "Valid", session: successor }
    : { _tag: "Invalid", detail: "provider successor names a foreign session" }
}

/** Returns the exact durable start for a run after its fixed session relation. */
const providerRunStartFor = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): JournalRecord | undefined => {
  const fixedSession = fixedSessionForRun(records, run)
  if (fixedSession._tag === "Invalid") return undefined
  const key = integratorRunStartedRecordKey(run)
  const starts = records.filter(
    (record) => record.event._tag === "IntegratorRunStarted" && integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (starts.length !== 1 || starts.some((record) => record.runId !== runIdFor(run) || record.key !== key)) {
    return undefined
  }
  const start = starts[0]
  return start !== undefined && start.position > fixedSession.session.position ? start : undefined
}

const retryAuthorizationIssue = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  runStart: JournalRecord
): string | undefined => {
  if (run.ordinal !== integratorRetryRunOrdinal) return undefined
  const successor = history.find(
    (record) =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      integratorCorrelationsEqual(record.event.successor, run.session)
  )
  if (successor?.event._tag === "IntegratorSuccessorSessionFixed") {
    const authorization = evaluateIntegratorFullRerunAuthorization(
      history,
      run,
      successor.event.predecessor,
      run.session.targetLineageObservedAt
    )
    if (authorization._tag === "Rejected") return authorization.detail
    return authorization.authorization.lineage.observation.event.observation.targetHeadSha ===
      run.session.expectedTargetHead
      ? undefined
      : "FullRerun provider-run quarantine requires the successor target head"
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
  beforePosition?: JournalRecord["position"]
): ProviderRunPredecessorValidation => {
  if (![initialRunOrdinal, integratorRetryRunOrdinal].includes(run.ordinal)) {
    return { _tag: "Invalid", detail: "provider-run quarantine accepts only Integrator runs 1 and 2" }
  }
  const history = beforePosition === undefined ? records : records.filter((record) => record.position < beforePosition)
  const fixedSession = fixedSessionForRun(history, run)
  if (fixedSession._tag === "Invalid") return fixedSession
  const runStart = providerRunStartFor(history, run)
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

/** Pure validator shared by provider-failure reconciliation and cleanup provenance. */
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
