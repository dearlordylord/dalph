import { type PlannedTaskAttempt, type RunId, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptReplacedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { WorkflowOperation } from "../../registry/operation.js"
import { recordedTaskAttemptPlans } from "../task-attempt-planning/journal-evidence.js"
import { currentAcceptedPlannedAttemptExecutorLifecycleFor } from "../planned-attempt-executor-work/evidence.js"

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

type RecordedTaskAttemptPlan = typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type

const recordedPlanEntriesBefore = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  before?: JournalPosition
): ReadonlyArray<RecordedTaskAttemptPlan> =>
  records.flatMap((record) => {
    if (record.runId !== runId || (before !== undefined && record.position >= before)) return []
    if (
      record.event._tag === "TaskAttemptPlanned" &&
      record.key === attemptPlanRecordKey(record.event.operation.plannedAttempt.attemptId)
    ) {
      return [record.event.operation]
    }
    if (
      record.event._tag === "PlannedAttemptReplaced" &&
      record.event.subject.plannedAttempt.runId === runId &&
      record.key === plannedAttemptReplacedRecordKey(record.event.subject.plannedAttempt.attemptId)
    ) {
      return [record.event.successorPlan]
    }
    return []
  })

/**
 * Resolves one durable same-Run plan and accepted Executing lifecycle for each
 * active attempt at a boundary. Missing, duplicate, foreign, or same-task
 * competing plans fail closed instead of shrinking the causal predecessor set.
 */
export const exactAcceptedExecutingPlansBefore = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  plannedAttempts: ReadonlyArray<PlannedTaskAttempt>,
  before?: JournalPosition
): ReadonlyArray<RecordedTaskAttemptPlan> | undefined => {
  if (
    plannedAttempts.length === 0 ||
    plannedAttempts.some(({ runId: attemptRunId }) => attemptRunId !== runId) ||
    new Set(plannedAttempts.map(({ taskId }) => taskId)).size !== plannedAttempts.length
  ) {
    return undefined
  }
  const prefix = records.filter(
    (record) => record.runId === runId && (before === undefined || record.position < before)
  )
  const planEntries = recordedPlanEntriesBefore(records, runId, before)
  const resolved = plannedAttempts.map((plannedAttempt) =>
    planEntries.filter(
      (operation) =>
        operation.plannedAttempt.runId === runId &&
        plannedTaskAttemptEquivalence(operation.plannedAttempt, plannedAttempt)
    )
  )
  if (
    resolved.some(({ length }) => length !== 1) ||
    plannedAttempts.some(
      (plannedAttempt) => currentAcceptedPlannedAttemptExecutorLifecycleFor(prefix, plannedAttempt)._tag !== "Executing"
    )
  ) {
    return undefined
  }
  return resolved.flatMap((entries) => entries)
}

/**
 * Validates the durable authority-check intent's exact bijection: every
 * predecessor is one same-Run plan, every covered task has one such plan, and
 * every named attempt had accepted Executing authority before the intent.
 */
export const acceptedExecutingAttemptsForAuthorityCheckIntent = (
  records: ReadonlyArray<JournalRecord>,
  intent: JournalRecord
): ReadonlyArray<PlannedTaskAttempt> | undefined => {
  if (intent.event._tag !== "TaskTrackerReadIntentRecorded" || intent.event.operation._tag !== "ReadTrackerGraph") {
    return undefined
  }
  const operation = intent.event.operation
  if (
    intent.key !== intentRecordKey(operation.operationId) ||
    operation.cause._tag !== "ExecutingWorkAuthorityCheck" ||
    operation.predecessorOperationIds.length === 0 ||
    operation.readShape.explicitlyCoveredTaskIds.length === 0
  ) {
    return undefined
  }
  const planEntries = recordedPlanEntriesBefore(records, intent.runId, intent.position)
  const namedEntries = operation.predecessorOperationIds.map((operationId) =>
    planEntries.filter((plan) => plan.operationId === operationId)
  )
  if (namedEntries.some(({ length }) => length !== 1)) return undefined
  const plannedAttempts = namedEntries.flatMap((entries) => entries.map((plan) => plan.plannedAttempt))
  const exactPlans = exactAcceptedExecutingPlansBefore(records, intent.runId, plannedAttempts, intent.position)
  if (exactPlans === undefined) return undefined
  const coveredTaskIds = [...operation.readShape.explicitlyCoveredTaskIds].toSorted()
  const plannedTaskIds = plannedAttempts.map(({ taskId }) => taskId).toSorted()
  if (
    coveredTaskIds.length !== plannedTaskIds.length ||
    !coveredTaskIds.every((taskId, index) => taskId === plannedTaskIds[index])
  ) {
    return undefined
  }
  return plannedAttempts
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
  if (
    operation._tag === "ReadTrackerGraph" &&
    operation.cause._tag !== "AttemptContinuation" &&
    operation.cause._tag !== "ExecutingWorkAuthorityCheck"
  ) {
    return false
  }
  const plans = recordedTaskAttemptPlans(records)
  const namedPlans = plans.filter(({ operationId }) => operation.predecessorOperationIds.includes(operationId))
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
