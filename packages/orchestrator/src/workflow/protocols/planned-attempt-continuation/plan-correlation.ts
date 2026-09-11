import { type PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { WorkflowOperation } from "../../registry/operation.js"

type TrackerRead = Extract<
  WorkflowOperation,
  { readonly _tag: "ReadTrackerGraph" | "ReadTaskWorkSpecification" | "ReadTaskClaim" }
>
type Plan = Extract<WorkflowOperation, { readonly _tag: "RecordTaskAttemptPlan" }>

/** Exact plans named by one current-fact read; this relation does not grant continuation authority. */
export const continuationReadNamesExactPlan = (
  operation: TrackerRead,
  namedPlans: ReadonlyArray<Plan>,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  switch (operation._tag) {
    case "ReadTrackerGraph": {
      switch (operation.cause._tag) {
        case "ExecutingWorkAuthorityCheck": {
          const coveredTaskIds = [...operation.readShape.explicitlyCoveredTaskIds].toSorted()
          const namedTaskIds = [...new Set(namedPlans.map(({ plannedAttempt }) => plannedAttempt.taskId))].toSorted()
          return (
            namedPlans.some(({ plannedAttempt: candidate }) =>
              plannedTaskAttemptEquivalence(candidate, plannedAttempt)
            ) &&
            coveredTaskIds.length === namedTaskIds.length &&
            coveredTaskIds.every((taskId, index) => taskId === namedTaskIds[index]) &&
            namedPlans.every(({ plannedAttempt: candidate }) => candidate.runId === plannedAttempt.runId)
          )
        }
        case "AttemptContinuation":
          break
        case "AttemptRestartAuthorityCheck":
        case "PostQuiescenceReconfirmation":
        case "TaskControlMembershipCheck":
        case "WorkflowEstablishment":
          return false
      }
      break
    }
    case "ReadTaskClaim":
    case "ReadTaskWorkSpecification":
      break
  }
  return (
    namedPlans.length === 1 &&
    namedPlans.every(
      ({ plannedAttempt: candidate }) =>
        candidate.runId === plannedAttempt.runId &&
        candidate.attemptId === plannedAttempt.attemptId &&
        plannedTaskAttemptEquivalence(candidate, plannedAttempt)
    )
  )
}
