import { Effect } from "effect"
import { type PlannedTaskAttempt } from "@dalph/contracts"
import { type OperationId } from "../../identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { samePlannedTaskAttempt, TaskAttemptPlanHistoryContradiction } from "./record.js"

/** Requires the one exact causal durable plan before resource reconciliation. */
export const requireAcknowledgedPlan = Effect.fn("WorkflowJournal.requireAcknowledgedPlan")(function* (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  operationId: OperationId,
  predecessorOperationIds: ReadonlyArray<OperationId>
) {
  const plans = records.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === plannedAttempt.attemptId
      ? [event.operation]
      : event._tag === "PlannedAttemptReplaced" &&
          event.successorPlan.plannedAttempt.attemptId === plannedAttempt.attemptId
        ? [event.successorPlan]
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
  if (!predecessorOperationIds.includes(plan.operationId)) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: "CausalPredecessorMissing"
    })
  }
  if (!samePlannedTaskAttempt(plan.plannedAttempt, plannedAttempt)) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: "PlanMismatch"
    })
  }
})
