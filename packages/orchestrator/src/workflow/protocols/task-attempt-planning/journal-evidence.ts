import { Effect } from "effect"
import { type PlannedTaskAttempt } from "@dalph/contracts"
import { type OperationId } from "../../identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { journalRecordsForAttempt, journalRecordsOfKind, isJournalRecordEvidence, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { samePlannedTaskAttempt, TaskAttemptPlanHistoryContradiction } from "./record.js"

/** Every durable planned-attempt recording operation, including an atomic replacement's successor plan. */
type RecordedTaskAttemptPlan = Extract<JournalRecord["event"], { readonly _tag: "TaskAttemptPlanned" }>["operation"]

const recordedPlansByPrefix = new WeakMap<JournalHistorySource, ReadonlyArray<RecordedTaskAttemptPlan>>()

export const recordedTaskAttemptPlans = (
  records: JournalHistorySource
): ReadonlyArray<RecordedTaskAttemptPlan> => {
  const cached = recordedPlansByPrefix.get(records)
  if (cached !== undefined) return cached
  const candidates = isJournalRecordEvidence(records) ? [...journalRecordsOfKind(records, "TaskAttemptPlanned"), ...journalRecordsOfKind(records, "PlannedAttemptReplaced")].sort((left, right) => left.position - right.position) : records
  const plans = candidates.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned"
      ? [event.operation]
      : event._tag === "PlannedAttemptReplaced"
        ? [event.successorPlan]
        : []
  )
  recordedPlansByPrefix.set(records, plans)
  return plans
}

/** Finds the durable operation that recorded one exact attempt identity. */
export const recordedTaskAttemptPlanFor = (records: JournalHistorySource, plannedAttempt: PlannedTaskAttempt) =>
  recordedTaskAttemptPlans(Array.from(journalRecordsForAttempt(records, plannedAttempt.attemptId))).find(
    ({ plannedAttempt: recorded }) =>
      recorded.attemptId === plannedAttempt.attemptId && samePlannedTaskAttempt(recorded, plannedAttempt)
  )

/** Requires the one exact causal durable plan before resource reconciliation. */
export const requireAcknowledgedPlan = Effect.fn("WorkflowJournal.requireAcknowledgedPlan")(function* (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  operationId: OperationId,
  predecessorOperationIds: ReadonlyArray<OperationId>
) {
  const plans = recordedTaskAttemptPlans(Array.from(journalRecordsForAttempt(records, plannedAttempt.attemptId))).filter(
    ({ plannedAttempt: recorded }) => recorded.attemptId === plannedAttempt.attemptId
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
