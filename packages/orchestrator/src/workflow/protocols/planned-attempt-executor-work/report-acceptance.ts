import {
  type PlannedAttemptExecutorReport,
  type PlannedTaskAttempt,
  samePlannedAttemptExecutorReport
} from "@dalph/contracts"
import { Effect } from "effect"
import { plannedAttemptExecutorWorkReportedRecordKey } from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { latestUnacceptedPlannedAttemptExecutorReport } from "./evidence.js"
import { PlannedAttemptExecutorReportOrdinal, PlannedAttemptExecutorWorkReportedEvent } from "./events.js"
import {
  acceptedPlannedAttemptExecutorReportRecords,
  plannedAttemptExecutorLifecycleTransitionError
} from "./lifecycle-history.js"

export {
  acceptedPlannedAttemptExecutorReportRecords,
  plannedAttemptExecutorLifecycleTransitionError
} from "./lifecycle-history.js"

const lastElementOffset = -1

/** Appends a report ordinal only for a distinct accepted lifecycle transition. */
export const acceptDistinctPlannedAttemptExecutorReport = Effect.fn(
  "PlannedAttemptExecutorWorkflow.acceptDistinctReport"
)(function* (plannedAttempt: PlannedTaskAttempt, report: PlannedAttemptExecutorReport) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(plannedAttempt.runId)
  const accepted = acceptedPlannedAttemptExecutorReportRecords(records, plannedAttempt)
  const latest = accepted.at(lastElementOffset)
  if (
    latest?.event._tag === "PlannedAttemptExecutorWorkReported" &&
    samePlannedAttemptExecutorReport(latest.event.report, report)
  ) {
    return false
  }
  const transitionError = plannedAttemptExecutorLifecycleTransitionError(records, plannedAttempt, report)
  if (transitionError !== undefined) return yield* transitionError
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(accepted.length + 1)
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
    PlannedAttemptExecutorWorkReportedEvent.make({ ordinal, report, version: workflowJournalEventVersion })
  )
  return true
})

/** Completes the acceptance half of an earlier exact observation after an interrupted append. */
export const acceptPendingPlannedAttemptExecutorReport = Effect.fn(
  "PlannedAttemptExecutorWorkflow.acceptPendingReport"
)(function* (plannedAttempt: PlannedTaskAttempt) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(plannedAttempt.runId)
  const pending = latestUnacceptedPlannedAttemptExecutorReport(records, plannedAttempt)
  if (pending === undefined) return undefined
  yield* acceptDistinctPlannedAttemptExecutorReport(plannedAttempt, pending.report)
  return pending.report
})
