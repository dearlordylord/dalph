import { recordedTaskAttemptPlanFor } from "../task-attempt-planning/journal-evidence.js"
import { plannedTaskAttemptEquivalence, type RunId } from "@dalph/contracts"
import {
  journalRecordByKey,
  journalRecordsForAttempt,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { resultRecoveryDirectedRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { Schema } from "effect"
import { latestAcceptedPlannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"
import { type ResultRecoveryRequestId, ApplyResultRecoveryRequest } from "./events.js"

type DirectionRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "ResultRecoveryDirected" }>
}
const sameRequest = Schema.toEquivalence(ApplyResultRecoveryRequest)

/** Admission shared by the live serialized control and its model adapter.
 * Exact redelivery returns its historical receipt even after the selection
 * becomes stale; it never reauthorizes the later executor action.
 */
export const evaluateResultRecoveryDirectionApplication = (
  request: ApplyResultRecoveryRequest,
  runId: RunId,
  records: JournalHistorySource
):
  | { readonly _tag: "RecordNewDirection" }
  | { readonly _tag: "ExactRedelivery"; readonly record: DirectionRecord }
  | { readonly _tag: "IdentityContradiction"; readonly record: DirectionRecord }
  | { readonly _tag: "Unavailable"; readonly detail: string } => {
  const existing = journalRecordByKey(records, resultRecoveryDirectedRecordKey(request.requestId))
  if (existing?.event._tag === "ResultRecoveryDirected") {
    const record = { ...existing, event: existing.event }
    return sameRequest(existing.event, request)
      ? { _tag: "ExactRedelivery", record }
      : { _tag: "IdentityContradiction", record }
  }
  const problem = resultRecoveryDirectionProblem(request, runId, records)
  return problem === undefined ? { _tag: "RecordNewDirection" } : { _tag: "Unavailable", detail: problem }
}

/** Pure admission of one selected direction; current tracker/Git checks still precede execution. */
export const resultRecoveryDirectionProblem = (
  request: ApplyResultRecoveryRequest,
  runId: RunId,
  records: JournalHistorySource,
  appliedRequestId?: ResultRecoveryRequestId
): string | undefined => {
  const attempt = request.subject.plannedAttempt
  if (attempt.runId !== runId || request.requestId.runId !== runId) return "result recovery belongs to another Run"
  if (recordedTaskAttemptPlanFor(records, attempt) === undefined)
    return "selected attempt does not match its immutable plan"
  for (const record of journalRecordsForAttempt(records, attempt.attemptId)) {
    const event = record.event
    if (event._tag === "IntegrationStarted" && plannedTaskAttemptEquivalence(event.plannedAttempt, attempt))
      return "integration already consumed the retained attempt"
    if (
      (event._tag === "PlannedAttemptReplaced" || event._tag === "ResultRecoveryAttemptReplaced") &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, attempt)
    )
      return "the selected attempt was already replaced"
    if (
      event._tag === "ResultRecoveryDirected" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, attempt) &&
      event.subject.reportOrdinal === request.subject.reportOrdinal &&
      (appliedRequestId === undefined ||
        event.requestId.runId !== appliedRequestId.runId ||
        event.requestId.nonce !== appliedRequestId.nonce)
    )
      return "a direction already won the selected result recovery"
  }
  const evidence = latestAcceptedPlannedAttemptExecutorEvidence(records, attempt)
  if (evidence === undefined || evidence.source.ordinal !== request.subject.reportOrdinal)
    return "the selected accepted report is no longer current"
  const report = evidence.report
  if (request.subject._tag === "RejectedResult") {
    if (report._tag !== "ExecutorWorkResultRejected") return "selection is not an accepted result rejection"
    return report.custody._tag === "Stopped" ? undefined : "rejected-result writers remain unresolved"
  }
  if (request.direction !== "RestartTaskImplementation") return "historical unknown failure permits Restart only"
  return report._tag === "ExecutorWorkTerminal" &&
    report.result._tag === "Failed" &&
    report.result.failureCode === undefined
    ? undefined
    : "selection is not a historical failure with unknown cause"
}
