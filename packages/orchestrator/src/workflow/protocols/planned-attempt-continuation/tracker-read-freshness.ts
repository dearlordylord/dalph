import { type PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { WorkflowOperation } from "../../registry/operation.js"
import { recordedTaskAttemptPlans } from "../task-attempt-planning/journal-evidence.js"

/** Tracker reads whose facts can authorize a resumed planned attempt. */
export type ContinuationTrackerReadOperation =
  | typeof WorkflowOperation.cases.ReadTrackerGraph.Type
  | typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
  | typeof WorkflowOperation.cases.ReadTaskClaim.Type

const isContinuationTrackerReadOperation = (
  operation: WorkflowOperation
): operation is ContinuationTrackerReadOperation =>
  operation._tag === "ReadTrackerGraph" ||
  operation._tag === "ReadTaskWorkSpecification" ||
  operation._tag === "ReadTaskClaim"

const operationNamesTask = (
  operation: ContinuationTrackerReadOperation,
  target: ContinuationTrackerReadOperation["target"],
  taskId: PlannedTaskAttempt["taskId"]
): boolean => {
  if (taskTrackerTargetKey(operation.target) !== taskTrackerTargetKey(target)) return false
  return operation._tag === "ReadTrackerGraph"
    ? operation.readShape.explicitlyCoveredTaskIds.includes(taskId)
    : operation.taskId === taskId
}

/**
 * Checks target/task correlation without attempting to infer a tracker target
 * from a planned attempt (the attempt deliberately has no tracker target).
 */
const continuationTrackerReadMatchesTask = (
  records: ReadonlyArray<JournalRecord>,
  operation: ContinuationTrackerReadOperation,
  target: ContinuationTrackerReadOperation["target"],
  taskId: PlannedTaskAttempt["taskId"],
  plannedAttempt?: PlannedTaskAttempt
): boolean => {
  if (!operationNamesTask(operation, target, taskId)) return false
  if (plannedAttempt === undefined) return true
  return continuationTrackerReadHasExactPlanPredecessor(records, operation, plannedAttempt)
}

/**
 * A tracker read has no attempt field of its own.  A continuation therefore
 * accepts it only when its causal predecessors name exactly one durable plan
 * for the current RunId and AttemptId.  A same-task/same-target read attached
 * to a foreign plan is not current evidence, and an ambiguous pair of plan
 * predecessors fails closed as well.
 */
export const continuationTrackerReadHasExactPlanPredecessor = (
  records: ReadonlyArray<JournalRecord>,
  operation: ContinuationTrackerReadOperation,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const plans = recordedTaskAttemptPlans(records)
  const namedPlans = plans.filter(({ operationId }) => operation.predecessorOperationIds.includes(operationId))
  if (namedPlans.length !== 1) return false
  const namedPlan = namedPlans[0]
  return (
    namedPlan !== undefined &&
    namedPlan.plannedAttempt.runId === plannedAttempt.runId &&
    namedPlan.plannedAttempt.attemptId === plannedAttempt.attemptId &&
    plannedTaskAttemptEquivalence(namedPlan.plannedAttempt, plannedAttempt)
  )
}

/** Exact durable outcome key for one tracker read operation. */
const isContinuationTrackerReadOutcome = (
  record: JournalRecord,
  operationId: ContinuationTrackerReadOperation["operationId"]
): record is JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
} =>
  record.key === outcomeRecordKey(operationId) &&
  record.event._tag === "TaskTrackerFactsObserved" &&
  record.event.operationId === operationId

/** A tracker outcome that cannot supply readable current continuation facts. */
const continuationTrackerOutcomeIsReadable = (
  operation: ContinuationTrackerReadOperation,
  record: JournalRecord
): boolean => {
  if (!isContinuationTrackerReadOutcome(record, operation.operationId)) return false
  const observation = record.event.observation
  if (observation._tag === "TaskTrackerFactsReadFailed") return false
  if (operation._tag === "ReadTrackerGraph") {
    return (
      observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )
  }
  if (operation._tag === "ReadTaskWorkSpecification") {
    return observation._tag === "FocusedTaskWorkSpecificationFacts"
  }
  return observation._tag === "FocusedTaskClaimFacts"
}

/** The latest exact correlated tracker read after a continuation boundary and its durable state. */
type ContinuationTrackerReadIntent = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }> & {
    readonly operation: ContinuationTrackerReadOperation
  }
}

export type ContinuationTrackerReadStatus =
  | { readonly _tag: "Pending"; readonly intent: ContinuationTrackerReadIntent }
  | {
      readonly _tag: "Unreadable" | "Readable"
      readonly intent: ContinuationTrackerReadIntent
      readonly outcome: JournalRecord
    }

export const latestContinuationTrackerReadStatusAfter = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalPosition,
  family: ContinuationTrackerReadOperation["_tag"],
  target: ContinuationTrackerReadOperation["target"],
  taskId: PlannedTaskAttempt["taskId"],
  plannedAttempt?: PlannedTaskAttempt
): ContinuationTrackerReadStatus | undefined => {
  const intent = records.findLast(
    (record): record is ContinuationTrackerReadIntent =>
      record.position > after &&
      record.event._tag === "TaskTrackerReadIntentRecorded" &&
      isContinuationTrackerReadOperation(record.event.operation) &&
      record.event.operation._tag === family &&
      record.key === intentRecordKey(record.event.operation.operationId) &&
      continuationTrackerReadMatchesTask(records, record.event.operation, target, taskId, plannedAttempt)
  )
  if (intent === undefined) return undefined

  const operationId = intent.event.operation.operationId
  const outcome = records.findLast((record) => isContinuationTrackerReadOutcome(record, operationId))
  if (outcome === undefined) return { _tag: "Pending", intent }
  if (outcome.position <= intent.position || !continuationTrackerOutcomeIsReadable(intent.event.operation, outcome)) {
    return { _tag: "Unreadable", intent, outcome }
  }
  return { _tag: "Readable", intent, outcome }
}
