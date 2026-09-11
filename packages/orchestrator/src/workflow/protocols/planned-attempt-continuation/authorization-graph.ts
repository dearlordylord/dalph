import type { PlannedTaskAttempt } from "@dalph/contracts"
import { isDependencySatisfied, isTaskOpen } from "../../../authorities/task-tracker/task.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { journalRecordByKey, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import type { CompleteTaskTrackerFactsObserved } from "../../task-tracker-facts/observation.js"
import { reconfirmationMatchesPriorFullObservation } from "../../task-tracker-facts/reconfirmation.js"

type GraphObservation = Extract<
  Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
  { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
>

const completeGraphObservationFor = (
  records: JournalHistorySource,
  observation: GraphObservation,
  observedAt: JournalRecord["position"]
): CompleteTaskTrackerFactsObserved | undefined => {
  if (observation._tag === "CompleteTaskTrackerFacts") return observation
  const prior = journalRecordByKey(records, outcomeRecordKey(observation.priorFullObservationOperationId))
  return prior?.event._tag === "TaskTrackerFactsObserved" &&
    prior.position < observedAt &&
    prior.event.observation._tag === "CompleteTaskTrackerFacts" &&
    reconfirmationMatchesPriorFullObservation(observation, prior.event.observation)
    ? prior.event.observation
    : undefined
}

/** Derives current scheduler eligibility from the exact complete normalized graph payload. */
export const graphKeepsTaskEligible = (
  records: JournalHistorySource,
  observation: GraphObservation,
  observedAt: JournalRecord["position"],
  taskId: PlannedTaskAttempt["taskId"]
): boolean => {
  const complete = completeGraphObservationFor(records, observation, observedAt)
  if (complete === undefined) return false
  const [identities, lifecycles, prerequisites] = complete.factFamilies
  if (!identities.taskIds.includes(taskId)) return false
  const lifecycle = lifecycles.lifecycles.find((candidate) => candidate.taskId === taskId)?.lifecycle
  const prerequisiteIds = prerequisites.prerequisites.find(
    (candidate) => candidate.taskId === taskId
  )?.prerequisiteTaskIds
  if (lifecycle === undefined || prerequisiteIds === undefined || !isTaskOpen(lifecycle)) return false
  return prerequisiteIds.every((prerequisiteTaskId) => {
    const prerequisiteLifecycle = lifecycles.lifecycles.find(
      (candidate) => candidate.taskId === prerequisiteTaskId
    )?.lifecycle
    return prerequisiteLifecycle !== undefined && isDependencySatisfied(prerequisiteLifecycle)
  })
}
