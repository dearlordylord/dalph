import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
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
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation"
  }
}

/** One atomic replacement event recovered for an applied Restart choice. */
export type PlannedAttemptReplacementRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
}

export const exactAppliedRestart = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
): RestartApplicationRecord | undefined => {
  const matches = records.filter(
    (record): record is RestartApplicationRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "RestartTaskImplementation" &&
      record.runId === subject.plannedAttempt.runId &&
      record.key === attemptChoiceAppliedRecordKey(record.event.requestId) &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )
  return matches.length === 1 ? matches[0] : undefined
}

export const recordedReplacement = (
  records: ReadonlyArray<JournalRecord>,
  subject: AttemptChoiceSubject
): PlannedAttemptReplacementRecord | undefined => {
  const replacements = records.filter(
    (record): record is PlannedAttemptReplacementRecord =>
      record.event._tag === "PlannedAttemptReplaced" &&
      record.runId === subject.plannedAttempt.runId &&
      record.key === plannedAttemptReplacedRecordKey(subject.plannedAttempt.attemptId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )
  return replacements.length === 1 ? replacements[0] : undefined
}

/** Canonical claim authority retained at the exact applied Restart position. */
export const restartClaimAuthorityAtApplication = (
  records: ReadonlyArray<JournalRecord>,
  application: RestartApplicationRecord
) =>
  authorizedClaimForAttempt(
    records.filter(({ position }) => position <= application.position),
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
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  before: JournalPosition,
  expected: AttemptQuiescenceProof
): boolean => {
  const bounded = records.filter(({ position }) => position < before)
  const evidence = latestPlannedAttemptExecutorEvidence(bounded, plannedAttempt)
  if (evidence === undefined || evidence.observedAt >= before) return false
  const responsibilities = bounded.filter(
    (record) =>
      record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      record.runId === plannedAttempt.runId &&
      record.key === plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId) &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt) &&
      record.position < evidence.observedAt
  )
  if (responsibilities.length !== 1) return false
  const commands = bounded.filter(
    (record) =>
      record.event._tag === "PlannedAttemptExecutorCommandIntended" &&
      record.runId === plannedAttempt.runId &&
      record.key === plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, record.event.ordinal) &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt) &&
      record.position < evidence.observedAt
  )
  if (commands.length === 0) return false
  if (!isAcceptedPlannedAttemptExecutorEvidence(evidence)) return false
  if (!hasValidAcceptedPlannedAttemptExecutorLifecycleHistory(bounded, plannedAttempt)) return false
  const source = evidence.source
  const exactSource =
    bounded.filter(
      (candidate) =>
        candidate.event._tag === "PlannedAttemptExecutorWorkReported" &&
        candidate.runId === plannedAttempt.runId &&
        candidate.key === plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, source.ordinal) &&
        candidate.position === evidence.observedAt &&
        candidate.event.ordinal === source.ordinal &&
        candidate.event.report.correlation.runId === plannedAttempt.runId &&
        candidate.event.report.correlation.attemptId === plannedAttempt.attemptId
    ).length === 1
  if (!exactSource) return false
  const laterExecutorCommand = records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (laterExecutorCommand) return false
  const quiescent = evidence.report._tag === "ExecutorWorkSafelySuspended"
  return quiescent && proofEquals(proofFor(evidence), expected)
}
