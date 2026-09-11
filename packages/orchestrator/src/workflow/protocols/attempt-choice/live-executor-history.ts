import { type PlannedTaskAttempt, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { Effect } from "effect"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalStore } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"

export const appendAcceptedExecutingExecutorHistory = Effect.fn(
  "AttemptChoiceLiveExecutorHistory.appendAcceptedExecuting"
)(function* (plannedAttempt: PlannedTaskAttempt, suppliedJournal?: InRunJournal["Service"] | JournalStore["Service"]) {
  const journal = suppliedJournal ?? (yield* InRunJournal)
  const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })

  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report: executing,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: executing,
      version: workflowJournalEventVersion
    })
  )
})

export const appendAcceptedSafeExecutorHistory = Effect.fn("AttemptChoiceLiveExecutorHistory.appendAcceptedSafe")(
  function* (plannedAttempt: PlannedTaskAttempt, suppliedJournal?: InRunJournal["Service"] | JournalStore["Service"]) {
    const journal = suppliedJournal ?? (yield* InRunJournal)
    const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
    const safeOrdinal = 2
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(safeOrdinal)
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(safeOrdinal)
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })

    yield* appendAcceptedExecutingExecutorHistory(plannedAttempt, journal)
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Suspend",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report: safe,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: safe,
        version: workflowJournalEventVersion
      })
    )
  }
)
