import { Effect, Schema } from "effect"
import {
  type PlannedTaskAttempt,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "./events.js"

/** An executor response named a different planned attempt than Dalph requested. */
export class PlannedAttemptExecutorCorrelationMismatch extends Schema.TaggedErrorClass<PlannedAttemptExecutorCorrelationMismatch>()(
  "PlannedAttemptExecutorCorrelationMismatch",
  { expected: PlannedAttemptExecutorCorrelation, observed: PlannedAttemptExecutorCorrelation }
) {}

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.attemptId === right.attemptId && left.runId === right.runId

const runCommand = Effect.fn("PlannedAttemptExecutorWorkflow.runCommand")(function* (
  plannedAttempt: PlannedTaskAttempt,
  command: "StartOrContinue" | "Suspend"
) {
  const journal = yield* JournalStore
  const executor = yield* PlannedAttemptExecutor
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const records = yield* journal.read(plannedAttempt.runId)
  const responsibilityBegan = records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (!responsibilityBegan) {
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
  }

  const report: PlannedAttemptExecutorReport =
    command === "StartOrContinue"
      ? yield* executor.startOrContinue(plannedAttempt)
      : yield* executor.requestSuspension(plannedAttempt)
  if (!sameCorrelation(correlation, report.correlation)) {
    return yield* new PlannedAttemptExecutorCorrelationMismatch({ expected: correlation, observed: report.correlation })
  }

  const ordinal = PlannedAttemptExecutorReportOrdinal.make(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === plannedAttempt.attemptId
    ).length + 1
  )
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
    PlannedAttemptExecutorWorkReportedEvent.make({ ordinal, report, version: workflowJournalEventVersion })
  )
  return report
})

/** Starts or resumes all executor work for the exact planned attempt. */
export const continuePlannedAttemptExecutorWork = (plannedAttempt: PlannedTaskAttempt) =>
  runCommand(plannedAttempt, "StartOrContinue")

/** Asks the executor to stop all work while preserving the exact attempt for resume. */
export const requestPlannedAttemptExecutorSuspension = (plannedAttempt: PlannedTaskAttempt) =>
  runCommand(plannedAttempt, "Suspend")
