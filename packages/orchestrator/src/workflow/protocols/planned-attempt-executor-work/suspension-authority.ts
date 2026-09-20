import type { PlannedTaskAttempt } from "@dalph/contracts"
import {
  journalRecordsForAttemptKind,
  lastJournalRecordOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { latestPlannedAttemptExecutorEvidence, latestPlannedAttemptExecutorProjectionIssue } from "./evidence.js"
import { acceptedPlannedAttemptExecutorReportRecords } from "./report-acceptance.js"

const lastElementOffset = -1

/**
 * Authorizes one Suspend intent from accepted executor lifecycle evidence.
 * Cancellation may retain the last accepted Executing authority only across
 * an exact passive unavailable or unreadable observation. The observation may
 * precede or follow cancellation because neither result changes executor
 * identity or lifecycle authority.
 */
export const plannedAttemptExecutorSuspensionIsAuthorized = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const latestEvidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (latestEvidence?.source._tag === "AcceptedReport" && latestEvidence.report._tag === "ExecutorWorkExecuting") {
    return true
  }

  const latestAcceptedReport = acceptedPlannedAttemptExecutorReportRecords(records, plannedAttempt).at(
    lastElementOffset
  )
  const latestProjectionIssue = latestPlannedAttemptExecutorProjectionIssue(records, plannedAttempt)
  const latestStateObservation = Array.from(
    journalRecordsForAttemptKind(records, plannedAttempt.attemptId, "PlannedAttemptExecutorStateObserved")
  ).findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorStateObserved" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  const cancellation = lastJournalRecordOfKind(records, "RunCancellationApplied")
  const passiveObservationDoesNotContradictExecuting =
    latestStateObservation?.event._tag === "PlannedAttemptExecutorStateObserved" &&
    ((latestProjectionIssue?.reason === "Unreadable" &&
      latestStateObservation.event.observation._tag === "ExecutorStateUnreadable") ||
      (latestProjectionIssue?.reason === "TemporarilyUnavailable" &&
        latestStateObservation.event.observation._tag === "ExecutorStateTemporarilyUnavailable"))

  return (
    latestAcceptedReport?.event._tag === "PlannedAttemptExecutorWorkReported" &&
    latestAcceptedReport.event.report._tag === "ExecutorWorkExecuting" &&
    passiveObservationDoesNotContradictExecuting &&
    latestStateObservation.position === latestProjectionIssue.observedAt &&
    cancellation?.event._tag === "RunCancellationApplied" &&
    latestAcceptedReport.position < latestStateObservation.position &&
    latestAcceptedReport.position < cancellation.position
  )
}
