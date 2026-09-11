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
  if (
    operation._tag === "ReadTrackerGraph" &&
    operation.cause._tag !== "AttemptContinuation" &&
    operation.cause._tag !== "ExecutingWorkAuthorityCheck"
  )
    return false
  if (operation._tag === "ReadTrackerGraph" && operation.cause._tag === "ExecutingWorkAuthorityCheck") {
    const coveredTaskIds = [...operation.readShape.explicitlyCoveredTaskIds].toSorted()
    const namedTaskIds = [...new Set(namedPlans.map(({ plannedAttempt }) => plannedAttempt.taskId))].toSorted()
    return (
      namedPlans.some(({ plannedAttempt: candidate }) => plannedTaskAttemptEquivalence(candidate, plannedAttempt)) &&
      coveredTaskIds.length === namedTaskIds.length &&
      coveredTaskIds.every((taskId, index) => taskId === namedTaskIds[index]) &&
      namedPlans.every(({ plannedAttempt: candidate }) => candidate.runId === plannedAttempt.runId)
    )
  }
  const namedPlan = namedPlans.length === 1 ? namedPlans[0] : undefined
  return (
    namedPlan !== undefined &&
    namedPlan.plannedAttempt.runId === plannedAttempt.runId &&
    namedPlan.plannedAttempt.attemptId === plannedAttempt.attemptId &&
    plannedTaskAttemptEquivalence(namedPlan.plannedAttempt, plannedAttempt)
  )
}
