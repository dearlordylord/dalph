import { Effect } from "effect"
import type { OperationId, PlannedTaskAttempt } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
import { samePlannedTaskAttempt, TaskAttemptPlanHistoryContradiction } from "./task-attempt-plan-recording.js"

/** Requires the one exact causal durable plan before resource reconciliation. */
export const requireAcknowledgedPlan = Effect.fn(
  "WorkflowJournal.requireAcknowledgedPlan"
)(function*(
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  operationId: OperationId,
  predecessorOperationIds: ReadonlyArray<OperationId>
) {
  const plans = records.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned"
      && event.operation.plannedAttempt.attemptId === plannedAttempt.attemptId
      ? [event]
      : []
  )
  const plan = plans[0]
  if (plan === undefined || plans.length !== 1) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: plans.length === 0 ? "Missing" : "MultiplePlans"
    })
  }
  if (!predecessorOperationIds.includes(plan.operation.operationId)) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: "CausalPredecessorMissing"
    })
  }
  if (!samePlannedTaskAttempt(plan.operation.plannedAttempt, plannedAttempt)) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: "PlanMismatch"
    })
  }
})
