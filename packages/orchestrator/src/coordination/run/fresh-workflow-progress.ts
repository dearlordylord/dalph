import type { PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import { executorProgressContinuationAvailableFor } from "../executor-progress-graph-read.js"

/** The latest accepted complete graph observation whose intent follows an executor report. */
const latestCompleteGraphObservationAfter = (
  records: ReadonlyArray<JournalRecord>,
  reportPosition: JournalPosition
): JournalRecord | undefined =>
  records.findLast(
    ({ event, position }) =>
      position > reportPosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
      records.some(
        ({ event: candidate, position: intentPosition }) =>
          intentPosition > reportPosition &&
          candidate._tag === "TaskTrackerReadIntentRecorded" &&
          candidate.operation._tag === "ReadTrackerGraph" &&
          candidate.operation.operationId === event.operationId &&
          intentPosition < position
      )
  )

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
  const graphObservation = latestCompleteGraphObservationAfter(records, reportPosition)
  if (graphObservation === undefined || !executorProgressContinuationAvailableFor(records, plannedAttempt))
    return undefined
  if (graphObservation.event._tag !== "TaskTrackerFactsObserved") return undefined
  const latestSpecification = latestFocusedSpecificationObservationAfter(
    records,
    plannedAttempt.taskId,
    graphObservation.position
  )
  return latestSpecification !== undefined &&
    specificationObservationIsFresh(
      records,
      latestSpecification,
      graphObservation.position,
      graphObservation.event.operationId
    )
    ? undefined
    : graphObservation.event.operationId
}
