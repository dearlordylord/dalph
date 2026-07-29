import type { TaskTrackerFactsObservation } from "./task-tracker-facts.js"
import { factFamilyCoverageMatchesExplicitTaskIds, taskTrackerTargetKey } from "./task-tracker-target.js"
import type { WorkflowOperation } from "./workflow-operation.js"

/** Proves that normalized tracker evidence answers the exact initiating read. */
export const taskTrackerObservationMatchesRead = (
  observation: TaskTrackerFactsObservation,
  operation: Extract<WorkflowOperation, { readonly _tag: "ReadTaskWorkSpecification" | "ReadTrackerGraph" }>
): boolean => {
  if (taskTrackerTargetKey(operation.target) !== taskTrackerTargetKey(observation.target)) return false
  if (observation._tag === "FocusedTaskWorkSpecificationFacts") {
    return operation._tag === "ReadTaskWorkSpecification" && operation.taskId === observation.factFamily.taskId
  }
  return (
    operation._tag === "ReadTrackerGraph" &&
    factFamilyCoverageMatchesExplicitTaskIds(observation.factFamilies, operation.readShape.explicitlyCoveredTaskIds)
  )
}
