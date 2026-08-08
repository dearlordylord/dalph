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
import { InRunJournal } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorContinuationLimit,
  defaultPlannedAttemptExecutorContinuationLimit,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "./events.js"

/** An executor response named a different planned attempt than Dalph requested. */
export class PlannedAttemptExecutorCorrelationMismatch extends Schema.TaggedErrorClass<PlannedAttemptExecutorCorrelationMismatch>()(
  "PlannedAttemptExecutorCorrelationMismatch",
  { expected: PlannedAttemptExecutorCorrelation, observed: PlannedAttemptExecutorCorrelation }
) {}

/** The exact attempt consumed its durable start-or-continue budget while the executor still reported Running. */
export class PlannedAttemptExecutorContinuationLimitReached extends Schema.TaggedErrorClass<PlannedAttemptExecutorContinuationLimitReached>()(
  "PlannedAttemptExecutorContinuationLimitReached",
  { correlation: PlannedAttemptExecutorCorrelation, limit: PlannedAttemptExecutorContinuationLimit }
) {}

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.attemptId === right.attemptId && left.runId === right.runId

export type PlannedAttemptExecutorContinuationDisposition =
  | { readonly _tag: "ExecutorContinuationAvailable" }
  | { readonly _tag: "ExecutorContinuationLimitReached"; readonly limit: PlannedAttemptExecutorContinuationLimit }

/** Pure durable-budget decision shared by all conforming interpreter Layers. */
export const plannedAttemptExecutorContinuationDisposition = (
  correlation: PlannedAttemptExecutorCorrelation,
  reports: ReadonlyArray<PlannedAttemptExecutorReport>,
  continuationLimit = defaultPlannedAttemptExecutorContinuationLimit
): PlannedAttemptExecutorContinuationDisposition => {
  const acceptedReports = reports.filter((report) => sameCorrelation(correlation, report.correlation))
  const lastSafeSuspension = acceptedReports.findLastIndex(({ _tag }) => _tag === "SafelySuspended")
  const runningSinceSafeSuspension = acceptedReports
    .slice(lastSafeSuspension + 1)
    .filter(({ _tag }) => _tag === "Running")
  return runningSinceSafeSuspension.length >= continuationLimit
    ? { _tag: "ExecutorContinuationLimitReached", limit: continuationLimit }
    : { _tag: "ExecutorContinuationAvailable" }
}

const runCommand = Effect.fn("PlannedAttemptExecutorWorkflow.runCommand")(function* (
  plannedAttempt: PlannedTaskAttempt,
  command: "StartOrContinue" | "Suspend",
  continuationLimit: PlannedAttemptExecutorContinuationLimit
) {
  const journal = yield* InRunJournal
  const executor = yield* PlannedAttemptExecutor
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const records = yield* journal.read(plannedAttempt.runId)
  const responsibilityBegan = records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  const acceptedReports = records.flatMap(({ event }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" && sameCorrelation(correlation, event.report.correlation)
      ? [event.report]
      : []
  )
  const continuation = plannedAttemptExecutorContinuationDisposition(correlation, acceptedReports, continuationLimit)
  if (command === "StartOrContinue" && continuation._tag === "ExecutorContinuationLimitReached") {
    return yield* new PlannedAttemptExecutorContinuationLimitReached({ correlation, limit: continuation.limit })
  }
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

  const ordinal = PlannedAttemptExecutorReportOrdinal.make(acceptedReports.length + 1)
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
    PlannedAttemptExecutorWorkReportedEvent.make({ ordinal, report, version: workflowJournalEventVersion })
  )
  return report
})

/** Starts or resumes all executor work for the exact planned attempt. */
export const continuePlannedAttemptExecutorWork = (
  plannedAttempt: PlannedTaskAttempt,
  continuationLimit = defaultPlannedAttemptExecutorContinuationLimit
) => runCommand(plannedAttempt, "StartOrContinue", continuationLimit)

/** Asks the executor to stop all work while preserving the exact attempt for resume. */
export const requestPlannedAttemptExecutorSuspension = (plannedAttempt: PlannedTaskAttempt) =>
  runCommand(plannedAttempt, "Suspend", defaultPlannedAttemptExecutorContinuationLimit)
