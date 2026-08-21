import { type RunId } from "@dalph/contracts"
import { HashMap, Option } from "effect"
import { type OperationId } from "../identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { CompleteTaskTrackerFactsObserved, UnchangedTaskTrackerFactsReconfirmed } from "./observation.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"

export interface TaskTrackerReconfirmationIndex {
  readonly completeFactsByOperation: HashMap.HashMap<OperationId, CompleteTaskTrackerFactsObserved>
}

export const makeTaskTrackerReconfirmationIndex = (): TaskTrackerReconfirmationIndex => ({
  completeFactsByOperation: HashMap.empty()
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
interface TaskTrackerReconfirmationValidation {
  readonly index: TaskTrackerReconfirmationIndex
  readonly detail: string | undefined
}

export const invalidTaskTrackerReconfirmationReference = (
  record: JournalRecord,
  runId: RunId,
  index: TaskTrackerReconfirmationIndex
): TaskTrackerReconfirmationValidation => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return { detail: undefined, index }
  if (record.event.observation._tag === "CompleteTaskTrackerFacts") {
    return record.runId === runId && !HashMap.has(index.completeFactsByOperation, record.event.operationId)
      ? {
          detail: undefined,
          index: {
            completeFactsByOperation: HashMap.set(
              index.completeFactsByOperation,
              record.event.operationId,
              record.event.observation
            )
          }
        }
      : { detail: undefined, index }
  }
  if (record.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") return { detail: undefined, index }
  const reconfirmation = record.event.observation
  const prior = Option.getOrUndefined(
    HashMap.get(index.completeFactsByOperation, reconfirmation.priorFullObservationOperationId)
  )
  return {
    detail:
      prior === undefined || !reconfirmationMatchesPriorFullObservation(reconfirmation, prior)
        ? `unchanged tracker facts require an earlier matching full observation ${reconfirmation.priorFullObservationOperationId}`
        : undefined,
    index
  }
}
