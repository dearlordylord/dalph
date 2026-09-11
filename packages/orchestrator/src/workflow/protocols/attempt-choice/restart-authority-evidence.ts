import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import { Schema } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  journalEvidenceBefore,
  journalRecordByKey,
  journalRecordsForAttemptKind,
  isJournalRecordEvidence,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import {
  attemptChoiceAppliedRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptReplacedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import {
  latestPlannedAttemptExecutorEvidence,
  isAcceptedPlannedAttemptExecutorEvidence,
  type AcceptedPlannedAttemptExecutorEvidence
} from "../planned-attempt-executor-work/evidence.js"
import { hasValidAcceptedPlannedAttemptExecutorLifecycleHistory } from "../planned-attempt-executor-work/lifecycle-history.js"
import {
  AttemptQuiescenceProof,
  type AttemptChoiceRequestId,
  type AttemptChoiceSubject,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "./events.js"

/** Exact durable applied Restart choice used by replacement reconstruction. */
export type RestartApplicationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Omit<Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>, "choice"> & {
    readonly choice: "RestartTaskImplementation"
  }
}

/** One atomic replacement event recovered for an applied Restart choice. */
export type PlannedAttemptReplacementRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
}

const isRestartApplicationRecord = (
  record: JournalRecord,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
): record is RestartApplicationRecord => {
  const { event } = record
  return (
    event._tag === "AttemptChoiceApplied" &&
    event.choice === "RestartTaskImplementation" &&
    record.runId === subject.plannedAttempt.runId &&
    record.key === attemptChoiceAppliedRecordKey(event.requestId) &&
    sameAttemptChoiceRequestId(event.requestId, requestId) &&
    sameAttemptChoiceSubject(event.subject, subject)
  )
}

const isPlannedAttemptReplacementRecord = (
  record: JournalRecord,
  subject: AttemptChoiceSubject
): record is PlannedAttemptReplacementRecord => {
  const { event } = record
  return (
    event._tag === "PlannedAttemptReplaced" &&
    record.runId === subject.plannedAttempt.runId &&
    record.key === plannedAttemptReplacedRecordKey(subject.plannedAttempt.attemptId) &&
    sameAttemptChoiceSubject(event.subject, subject)
  )
}

export const exactAppliedRestart = (
  records: JournalHistorySource,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
): RestartApplicationRecord | undefined => {
  const record = journalRecordByKey(records, attemptChoiceAppliedRecordKey(requestId))
  return record !== undefined && isRestartApplicationRecord(record, requestId, subject) ? record : undefined
}

export const recordedReplacement = (
  records: JournalHistorySource,
  subject: AttemptChoiceSubject
): PlannedAttemptReplacementRecord | undefined => {
  const record = journalRecordByKey(records, plannedAttemptReplacedRecordKey(subject.plannedAttempt.attemptId))
  return record !== undefined && isPlannedAttemptReplacementRecord(record, subject) ? record : undefined
}

/** Canonical claim authority retained at the exact applied Restart position. */
export const restartClaimAuthorityAtApplication = (
  records: JournalHistorySource,
  application: RestartApplicationRecord
) =>
  authorizedClaimForAttempt(
    isJournalRecordEvidence(records)
      ? journalEvidenceBefore(records, JournalPosition.make(application.position + 1))
      : records.filter(({ position }) => position <= application.position),
    application.event.subject.plannedAttempt
  )

/** Converts executor evidence source identity into its durable quiescence proof. */
export const proofFor = (evidence: AcceptedPlannedAttemptExecutorEvidence): AttemptQuiescenceProof => ({
  _tag: "AcceptedReport",
  reportOrdinal: evidence.source.ordinal
})

export type RestartQuiescence =
  | { readonly _tag: "Proof"; readonly evidence: AcceptedPlannedAttemptExecutorEvidence }
  | {
      readonly _tag: "Rejected"
      readonly reason:
        | "AcceptedDoesNotAuthorizeReplacement"
        | "CompletedDoesNotAuthorizeReplacement"
        | "ExecutingDoesNotAuthorizeReplacement"
        | "FailedDoesNotAuthorizeReplacement"
        | "LaterExecutorCommandInvalidatedChoice"
    }
  | { readonly _tag: "Pending"; readonly reason: "ExecutorLifecycleAcceptancePending" | "ExecutorUnavailable" }
  | { readonly _tag: "Unproved" }

/** Terminal executor evidence is absorbing and never proves replacement. */
export const terminalRestartQuiescence = (evidence: AcceptedPlannedAttemptExecutorEvidence): RestartQuiescence => {
  if (evidence.report._tag !== "ExecutorWorkTerminal") return { _tag: "Unproved" }
  if (evidence.report.result._tag === "Accepted") {
    return { _tag: "Rejected", reason: "AcceptedDoesNotAuthorizeReplacement" }
  }
  if (evidence.report.result._tag === "Completed") {
    return { _tag: "Rejected", reason: "CompletedDoesNotAuthorizeReplacement" }
  }
  return { _tag: "Rejected", reason: "FailedDoesNotAuthorizeReplacement" }
}

/** Exact structural equality for the durable executor quiescence witness. */
const proofEquals = Schema.toEquivalence(AttemptQuiescenceProof)

/**
 * Validates the complete executor witness used by replacement and abandonment
 * cleanup. A directly forged safe report is insufficient: responsibility,
 * command intent, and the exact correlated response/projection must all be
 * present before the quiescence proof, with no later command before disposal.
 * Current Stop and Restart may reuse only an already accepted safe suspension
 * that remains current. Terminal lifecycle evidence is absorbing.
 */
export const exactExecutorQuiescenceEvidence = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  before: JournalPosition,
  expected: AttemptQuiescenceProof
): boolean => {
  const bounded = isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, before)
    : records.filter(({ position }) => position < before)
  const evidence = latestPlannedAttemptExecutorEvidence(bounded, plannedAttempt)
  if (evidence === undefined || evidence.observedAt >= before) return false
  let responsibilityCount = 0
  for (const record of journalRecordsForAttemptKind(
    bounded,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorWorkResponsibilityBegan"
  )) {
    if (
      record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      record.runId === plannedAttempt.runId &&
      record.key === plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId) &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt) &&
      record.position < evidence.observedAt
    )
      responsibilityCount += 1
  }
  if (responsibilityCount !== 1) return false
  let commandCount = 0
  for (const record of journalRecordsForAttemptKind(
    bounded,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandIntended"
  )) {
    if (
      record.event._tag === "PlannedAttemptExecutorCommandIntended" &&
      record.runId === plannedAttempt.runId &&
      record.key === plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, record.event.ordinal) &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt) &&
      record.position < evidence.observedAt
    )
      commandCount += 1
  }
  if (commandCount === 0) return false
  if (!isAcceptedPlannedAttemptExecutorEvidence(evidence)) return false
  if (!hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(bounded, plannedAttempt)) return false
  const source = evidence.source
  const candidate = journalRecordByKey(
    bounded,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, source.ordinal)
  )
  const exactSource =
    candidate !== undefined &&
    candidate.event._tag === "PlannedAttemptExecutorWorkReported" &&
    candidate.runId === plannedAttempt.runId &&
    candidate.key === plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, source.ordinal) &&
    candidate.position === evidence.observedAt &&
    candidate.event.ordinal === source.ordinal &&
    candidate.event.report.correlation.runId === plannedAttempt.runId &&
    candidate.event.report.correlation.attemptId === plannedAttempt.attemptId
  if (!exactSource) return false
  let laterExecutorCommand = false
  for (const { event, position } of journalRecordsForAttemptKind(
    records,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandIntended"
  )) {
    if (
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
    )
      laterExecutorCommand = true
  }
  if (laterExecutorCommand) return false
  const quiescent = evidence.report._tag === "ExecutorWorkSafelySuspended"
  return quiescent && proofEquals(proofFor(evidence), expected)
}
