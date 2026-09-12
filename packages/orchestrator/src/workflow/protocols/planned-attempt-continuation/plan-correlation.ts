import { type PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { WorkflowOperation } from "../../registry/operation.js"

type TrackerRead =
  | typeof WorkflowOperation.cases.ReadTrackerGraph.Type
  | typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
  | typeof WorkflowOperation.cases.ReadTaskClaim.Type
type Plan = typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type

const executingReadCoversNamedPlans = (
  operation: Extract<TrackerRead, { readonly _tag: "ReadTrackerGraph" }>,
  namedPlans: ReadonlyArray<Plan>,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const coveredTaskIds = [...operation.readShape.explicitlyCoveredTaskIds].toSorted()
  const namedTaskIds = [...new Set(namedPlans.map(({ plannedAttempt }) => plannedAttempt.taskId))].toSorted()
  return (
    namedPlans.some(({ plannedAttempt: candidate }) => plannedTaskAttemptEquivalence(candidate, plannedAttempt)) &&
    coveredTaskIds.length === namedTaskIds.length &&
    coveredTaskIds.every((taskId, index) => taskId === namedTaskIds[index]) &&
    namedPlans.every(({ plannedAttempt: candidate }) => candidate.runId === plannedAttempt.runId)
  )
}

const namesSingleContinuationPlan = (namedPlans: ReadonlyArray<Plan>, plannedAttempt: PlannedTaskAttempt): boolean =>
  namedPlans.length === 1 &&
  namedPlans.every(
    ({ plannedAttempt: candidate }) =>
      candidate.runId === plannedAttempt.runId &&
      candidate.attemptId === plannedAttempt.attemptId &&
      plannedTaskAttemptEquivalence(candidate, plannedAttempt)
  )

/** Exact plans named by one current-fact read; this relation does not grant continuation authority. */
export const continuationReadNamesExactPlan = (
  operation: TrackerRead,
  namedPlans: ReadonlyArray<Plan>,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  if (operation._tag === "ReadTrackerGraph") {
    if (operation.cause._tag === "ExecutingWorkAuthorityCheck") {
      return executingReadCoversNamedPlans(operation, namedPlans, plannedAttempt)
    }
    if (operation.cause._tag !== "AttemptContinuation") return false
  }
  return namesSingleContinuationPlan(namedPlans, plannedAttempt)
}
