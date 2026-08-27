import { plannedAttemptExecutorCorrelation, type PlannedTaskAttempt, type TaskId } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import {
  executorProgressContinuationAvailableFor,
  executorProgressGraphReadCoversReport,
  executorProgressGraphReadInputOf,
  type ExecutorProgressGraphRead,
  type ExecutorProgressReport
} from "../executor-progress-graph-read.js"

const observedAtOf = (read: ExecutorProgressGraphRead): JournalPosition | undefined =>
  read.observation._tag === "Observed" ? read.observation.observedAt : undefined

/** The latest accepted complete graph observation that explicitly covers the executor report's exact task. */
const latestCompleteGraphReadCovering = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  reportPosition: JournalPosition
): ExecutorProgressGraphRead | undefined => {
  const report: ExecutorProgressReport = {
    acceptedAt: reportPosition,
    correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
    taskId: plannedAttempt.taskId
  }
  return records
    .flatMap(({ event, runId }) =>
      runId === plannedAttempt.runId &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph"
        ? executorProgressGraphReadInputOf(records, plannedAttempt.runId, event.operation.target).graphReads.filter(
            ({ operationId }) => operationId === event.operation.operationId
          )
        : []
    )
    .filter((read) => executorProgressGraphReadCoversReport(report, read))
    .toSorted((left, right) => Number(observedAtOf(right)) - Number(observedAtOf(left)))[0]
}

/**
 * A focused specification is fresh only when its own read intent started
 * after the progress graph observation and causally names that graph read.
 * The observation may be appended later than the graph read even when its
 * intent crossed the tracker boundary before it, so observation position
 * alone cannot establish freshness.
 */
const latestFocusedSpecificationObservationAfter = (
  records: ReadonlyArray<JournalRecord>,
  taskId: TaskId,
  graphObservationPosition: JournalPosition
): JournalRecord | undefined =>
  records.findLast(
    ({ event, position }) =>
      position > graphObservationPosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === taskId
  )

const specificationObservationIsFresh = (
  records: ReadonlyArray<JournalRecord>,
  observation: JournalRecord,
  graphObservationPosition: JournalPosition,
  graphOperationId: OperationId
): boolean => {
  if (observation.event._tag !== "TaskTrackerFactsObserved") return false
  const observationOperationId = observation.event.operationId
  return records.some(
    ({ event: candidate, position: intentPosition }) =>
      intentPosition > graphObservationPosition &&
      intentPosition < observation.position &&
      candidate._tag === "TaskTrackerReadIntentRecorded" &&
      candidate.operation._tag === "ReadTaskWorkSpecification" &&
      candidate.operation.operationId === observationOperationId &&
      candidate.operation.predecessorOperationIds.includes(graphOperationId)
  )
}

/** A progress graph check hands the exact attempt through the existing focused-facts chain. */
export const specificationReadRequiredAfterProgressGraph = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  reportPosition: JournalPosition
): OperationId | undefined => {
  const graphRead = latestCompleteGraphReadCovering(records, plannedAttempt, reportPosition)
  if (graphRead === undefined || !executorProgressContinuationAvailableFor(records, plannedAttempt)) return undefined
  const graphObservationPosition = observedAtOf(graphRead)
  /* v8 ignore next -- a covering graph read is necessarily observed. */
  if (graphObservationPosition === undefined) return undefined
  const latestSpecification = latestFocusedSpecificationObservationAfter(
    records,
    plannedAttempt.taskId,
    graphObservationPosition
  )
  return latestSpecification !== undefined &&
    specificationObservationIsFresh(records, latestSpecification, graphObservationPosition, graphRead.operationId)
    ? undefined
    : graphRead.operationId
}
