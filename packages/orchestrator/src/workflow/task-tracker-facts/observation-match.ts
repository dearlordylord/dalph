import type { TaskTrackerFactsObservation } from "./observation.js"
import {
  factFamilyCoverageMatchesExplicitTaskIds,
  taskTrackerTargetKey
} from "../../authorities/task-tracker/target.js"
import type { WorkflowOperation } from "../registry/operation.js"
import {
  completionTaskFocusedReadPurposeEquals,
  completionTaskRequestEquals
} from "../protocols/integration-finality/events.js"

type TaskTrackerReadOperation = Extract<
  WorkflowOperation,
  { readonly _tag: "ReadCompletionTaskFacts" | "ReadTaskClaim" | "ReadTaskWorkSpecification" | "ReadTrackerGraph" }
>

const focusedCompletionMatchesRead = (
  observation: Extract<TaskTrackerFactsObservation, { readonly _tag: "FocusedTaskCompletionFacts" }>,
  operation: TaskTrackerReadOperation
): boolean =>
  operation._tag === "ReadCompletionTaskFacts" &&
  completionTaskRequestEquals(operation.request, observation.request) &&
  completionTaskFocusedReadPurposeEquals(operation.purpose, observation.purpose)

const focusedWorkSpecificationMatchesRead = (
  observation: Extract<TaskTrackerFactsObservation, { readonly _tag: "FocusedTaskWorkSpecificationFacts" }>,
  operation: TaskTrackerReadOperation
): boolean => operation._tag === "ReadTaskWorkSpecification" && operation.taskId === observation.factFamily.taskId

const focusedClaimMatchesRead = (
  observation: Extract<
    TaskTrackerFactsObservation,
    { readonly _tag: "FocusedTaskClaimFacts" | "FocusedTaskClaimFactsUnreadable" }
  >,
  operation: TaskTrackerReadOperation
): boolean => operation._tag === "ReadTaskClaim" && operation.taskId === observation.coverage.taskId

const completeGraphMatchesRead = (
  observation: Extract<
    TaskTrackerFactsObservation,
    { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
  >,
  operation: TaskTrackerReadOperation
): boolean =>
  operation._tag === "ReadTrackerGraph" &&
  factFamilyCoverageMatchesExplicitTaskIds(observation.factFamilies, operation.readShape.explicitlyCoveredTaskIds)

/** Proves that normalized tracker evidence answers the exact initiating read. */
export const taskTrackerObservationMatchesRead = (
  observation: TaskTrackerFactsObservation,
  operation: TaskTrackerReadOperation
): boolean => {
  if (taskTrackerTargetKey(operation.target) !== taskTrackerTargetKey(observation.target)) return false
  switch (observation._tag) {
    case "FocusedTaskCompletionFacts":
      return focusedCompletionMatchesRead(observation, operation)
    case "FocusedTaskWorkSpecificationFacts":
      return focusedWorkSpecificationMatchesRead(observation, operation)
    case "FocusedTaskClaimFacts":
    case "FocusedTaskClaimFactsUnreadable":
      return focusedClaimMatchesRead(observation, operation)
    case "CompleteTaskTrackerFacts":
    case "UnchangedTaskTrackerFactsReconfirmed":
      return completeGraphMatchesRead(observation, operation)
  }
}
