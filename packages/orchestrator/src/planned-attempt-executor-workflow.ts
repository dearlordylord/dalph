import { Effect, Schema } from "effect"
import type { PlannedTaskAttempt } from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import {
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkStartedRecordKey
} from "./journal-record-key.js"
import { JournalStore } from "./journal-store.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkStartedEvent
} from "./planned-attempt-executor-journal.js"
import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "./planned-attempt-executor.js"

/** An executor response named a different planned attempt than Dalph requested. */
export class PlannedAttemptExecutorCorrelationMismatch
  extends Schema.TaggedErrorClass<PlannedAttemptExecutorCorrelationMismatch>()(
    "PlannedAttemptExecutorCorrelationMismatch",
    {
      expected: PlannedAttemptExecutorCorrelation,
      observed: PlannedAttemptExecutorCorrelation
    }
  )
{}

const sameCorrelation = (
  left: PlannedAttemptExecutorCorrelation,
  right: PlannedAttemptExecutorCorrelation
): boolean =>
  left.attemptId === right.attemptId
  && left.runId === right.runId

const runCommand = Effect.fn("PlannedAttemptExecutorWorkflow.runCommand")(
  function*(
    plannedAttempt: PlannedTaskAttempt,
    command: "StartOrContinue" | "Suspend"
  ) {
    const journal = yield* JournalStore
    const executor = yield* PlannedAttemptExecutor
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const records = yield* journal.read(plannedAttempt.runId)
    const started = records.some(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkStarted"
      && event.plannedAttempt.attemptId === plannedAttempt.attemptId
    )
    if (!started) {
      yield* journal.append(
        plannedAttempt.runId,
        plannedAttemptExecutorWorkStartedRecordKey(plannedAttempt.attemptId),
        PlannedAttemptExecutorWorkStartedEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    }

    const report: PlannedAttemptExecutorReport = command === "StartOrContinue"
      ? yield* executor.startOrContinue(plannedAttempt)
      : yield* executor.requestSuspension(plannedAttempt)
    if (!sameCorrelation(correlation, report.correlation)) {
      return yield* new PlannedAttemptExecutorCorrelationMismatch({
        expected: correlation,
        observed: report.correlation
      })
    }

    const ordinal = PlannedAttemptExecutorReportOrdinal.make(
      records.filter(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported"
        && event.report.correlation.attemptId === plannedAttempt.attemptId
      ).length + 1
    )
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkReportedRecordKey(
        plannedAttempt.attemptId,
        ordinal
      ),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal,
        report,
        version: workflowJournalEventVersion
      })
    )
    return report
  }
)

/** Starts or resumes all executor work for the exact planned attempt. */
export const continuePlannedAttemptExecutorWork = (
  plannedAttempt: PlannedTaskAttempt
) => runCommand(plannedAttempt, "StartOrContinue")

/** Asks the executor to stop all work while preserving the exact attempt for resume. */
export const requestPlannedAttemptExecutorSuspension = (
  plannedAttempt: PlannedTaskAttempt
) => runCommand(plannedAttempt, "Suspend")
