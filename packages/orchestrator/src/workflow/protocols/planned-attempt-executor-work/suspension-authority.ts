import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import {
  journalRecordsForAttempt,
  journalRecordsForAttemptKind,
  journalRecordsOfKind,
  lastJournalRecordOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { latestPlannedAttemptExecutorEvidence, latestPlannedAttemptExecutorProjectionIssue } from "./evidence.js"
import { acceptedPlannedAttemptExecutorReportRecords } from "./report-acceptance.js"

const lastElementOffset = -1

/**
 * Authorizes one Suspend intent from accepted executor lifecycle evidence.
 * Owning Run Pause and cancellation may retain the last accepted Executing authority only across
 * an exact passive unavailable or unreadable observation. The observation may
 * precede or follow the control because neither result changes executor
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
  const pause = Array.from(journalRecordsOfKind(records, "ControlDirectionApplied")).findLast(
    ({ event }) =>
      event._tag === "ControlDirectionApplied" &&
      event.direction === "Pause" &&
      event.subject._tag === "Run" &&
      event.subject.runId === plannedAttempt.runId
  )
  const control = cancellation ?? pause
  const retainedExecutingIsUncontradicted =
    latestAcceptedReport !== undefined &&
    Array.from(journalRecordsForAttempt(records, plannedAttempt.attemptId)).every(({ event, position }) => {
      if (position <= latestAcceptedReport.position) return true
      if (
        event._tag === "PlannedAttemptExecutorStateObserved" ||
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved"
      ) {
        if (!plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)) return false
        return (
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          (event.observation._tag === "ExecutorStateUnreadable" ||
            event.observation._tag === "ExecutorStateTemporarilyUnavailable" ||
            (event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "ExecutorWorkExecuting" &&
              event.observation.report.correlation.runId === plannedAttempt.runId &&
              event.observation.report.correlation.attemptId === plannedAttempt.attemptId))
        )
      }
      if (event._tag === "PlannedAttemptExecutorCommandResponseObserved") {
        return (
          plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
          event.report._tag === "ExecutorWorkExecuting" &&
          event.report.correlation.runId === plannedAttempt.runId &&
          event.report.correlation.attemptId === plannedAttempt.attemptId
        )
      }
      return true
    })
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
    retainedExecutingIsUncontradicted &&
    latestStateObservation.position === latestProjectionIssue.observedAt &&
    control !== undefined &&
    latestAcceptedReport.position < latestStateObservation.position &&
    latestAcceptedReport.position < control.position
  )
}
