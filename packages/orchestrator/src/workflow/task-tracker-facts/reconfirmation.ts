import { type RunId } from "@dalph/contracts"
import { type OperationId } from "../identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { CompleteTaskTrackerFactsObserved, UnchangedTaskTrackerFactsReconfirmed } from "./observation.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"

export interface TaskTrackerReconfirmationIndex {
  readonly completeFactsByOperation: Map<OperationId, CompleteTaskTrackerFactsObserved>
}

export const makeTaskTrackerReconfirmationIndex = (): TaskTrackerReconfirmationIndex => ({
  completeFactsByOperation: new Map()
})

export const reconfirmationMatchesPriorFullObservation = (
  reconfirmation: UnchangedTaskTrackerFactsReconfirmed,
  prior: CompleteTaskTrackerFactsObserved
): boolean => {
  const [, reconfirmedLifecycles] = reconfirmation.factFamilies
  return (
    taskTrackerTargetKey(prior.target) === taskTrackerTargetKey(reconfirmation.target) &&
    prior.factFamilies[0].contentIdentity === reconfirmation.factFamilies[0].contentIdentity &&
    exactTaskIdSetKey(prior.factFamilies[0].taskIds) === exactTaskIdSetKey(reconfirmedLifecycles.subjectTaskIds)
  )
}

/**
 * Indexes full observations in journal order and rejects a compact observation
 * unless its referenced payload has already appeared in this exact run.
 */
export const invalidTaskTrackerReconfirmationReference = (
  record: JournalRecord,
  runId: RunId,
  index: TaskTrackerReconfirmationIndex
): string | undefined => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return undefined
  if (record.event.observation._tag === "CompleteTaskTrackerFacts") {
    if (record.runId === runId && !index.completeFactsByOperation.has(record.event.operationId)) {
      index.completeFactsByOperation.set(record.event.operationId, record.event.observation)
    }
    return undefined
  }
  if (record.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") return undefined
  const reconfirmation = record.event.observation
  const prior = index.completeFactsByOperation.get(reconfirmation.priorFullObservationOperationId)
  return prior === undefined || !reconfirmationMatchesPriorFullObservation(reconfirmation, prior)
    ? `unchanged tracker facts require an earlier matching full observation ${reconfirmation.priorFullObservationOperationId}`
    : undefined
}
