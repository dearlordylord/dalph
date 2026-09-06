import type { RunId } from "@dalph/contracts"
import { Data } from "effect"
import type { Task } from "../../authorities/task-tracker/task.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { FreshWorkflowStep, type FreshWorkflowStep as FreshWorkflowStepType } from "../delivery/fresh-workflow-step.js"

type RejectedFreshTaskClaimDisposition = Data.TaggedEnum<{
  ConstraintAbsent: Record<never, never>
  ConstraintCleared: Record<never, never>
  ConstraintRetained: Record<never, never>
  ObserveConstraint: { readonly step: FreshWorkflowStepType }
}>

const RejectedFreshTaskClaimDisposition = Data.taggedEnum<RejectedFreshTaskClaimDisposition>()

const isWithinWakeWindow = (
  record: JournalRecord,
  runId: RunId,
  after: JournalPosition,
  before?: JournalPosition
): boolean => record.runId === runId && record.position > after && (before === undefined || record.position < before)

const isAcceptedCompleteGraphOutcome = (
  record: JournalRecord,
  completeGraphObserved: ReadonlySet<OperationId>,
  requiredOperationIds?: ReadonlySet<OperationId>
): boolean => {
  const event = record.event
  if (event._tag !== "TaskTrackerFactsObserved") return false
  const complete =
    event.observation._tag === "CompleteTaskTrackerFacts" ||
    event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
  return (
    complete &&
    completeGraphObserved.has(event.operationId) &&
    (requiredOperationIds === undefined || requiredOperationIds.has(event.operationId))
  )
}

const completeGraphWakeFor = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  after: JournalPosition,
  targetKey: string,
  completeGraphObserved: ReadonlySet<OperationId>,
  before?: JournalPosition,
  requiredOperationIds?: ReadonlySet<OperationId>
) => {
  const outcome = records.findLast(
    (record) =>
      isWithinWakeWindow(record, runId, after, before) &&
      isAcceptedCompleteGraphOutcome(record, completeGraphObserved, requiredOperationIds)
  )
  if (outcome?.event._tag !== "TaskTrackerFactsObserved") return undefined
  const outcomeOperationId = outcome.event.operationId
  return records.findLast(
    ({ event, position, runId: recordRunId }) =>
      recordRunId === runId &&
      position < outcome.position &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.operationId === outcomeOperationId &&
      taskTrackerTargetKey(event.operation.target) === targetKey
  )
}

type FocusedClaimReadRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }> & {
    readonly operation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"],
      { readonly _tag: "ReadTaskClaim" }
    >
  }
}

const isFocusedConstraintRead = (
  record: JournalRecord,
  runId: RunId,
  after: JournalPosition,
  task: Task,
  targetKey: string,
  claimOperationId: OperationId
): record is FocusedClaimReadRecord =>
  record.runId === runId &&
  record.position > after &&
  record.event._tag === "TaskTrackerReadIntentRecorded" &&
  record.event.operation._tag === "ReadTaskClaim" &&
  record.event.operation.taskId === task.id &&
  taskTrackerTargetKey(record.event.operation.target) === targetKey &&
  record.event.operation.predecessorOperationIds.includes(claimOperationId)

type FocusedReadAdvance =
  | { readonly _tag: "Cleared" }
  | { readonly _tag: "Ignored" }
  | { readonly _tag: "Retained" }
  | { readonly _tag: "WakeAdvanced"; readonly wakeBaseline: JournalPosition }

const advanceFocusedConstraintRead = (
  records: ReadonlyArray<JournalRecord>,
  read: FocusedClaimReadRecord,
  runId: RunId,
  wakeBaseline: JournalPosition,
  targetKey: string,
  completeGraphObserved: ReadonlySet<OperationId>
): FocusedReadAdvance => {
  const graphWake = completeGraphWakeFor(
    records,
    runId,
    wakeBaseline,
    targetKey,
    completeGraphObserved,
    read.position,
    new Set(read.event.operation.predecessorOperationIds)
  )
  if (graphWake === undefined) return { _tag: "Ignored" }
  const operationId = read.event.operation.operationId
  const observation = records.findLast(
    (record) =>
      record.runId === runId &&
      record.position > read.position &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.operationId === operationId
  )
  if (observation?.event._tag !== "TaskTrackerFactsObserved") return { _tag: "Retained" }
  const facts = observation.event.observation
  return facts._tag === "FocusedTaskClaimFacts" && facts.observation._tag === "UnclaimedTask"
    ? { _tag: "Cleared" }
    : { _tag: "WakeAdvanced", wakeBaseline: observation.position }
}

const advanceFocusedConstraintReads = (
  records: ReadonlyArray<JournalRecord>,
  reads: ReadonlyArray<FocusedClaimReadRecord>,
  runId: RunId,
  initialWakeBaseline: JournalPosition,
  targetKey: string,
  completeGraphObserved: ReadonlySet<OperationId>
): Exclude<FocusedReadAdvance, { readonly _tag: "Ignored" }> => {
  let wakeBaseline = initialWakeBaseline
  for (const read of reads) {
    const result = advanceFocusedConstraintRead(records, read, runId, wakeBaseline, targetKey, completeGraphObserved)
    if (result._tag === "Ignored") continue
    if (result._tag === "Cleared" || result._tag === "Retained") return result
    wakeBaseline = result.wakeBaseline
  }
  return { _tag: "WakeAdvanced", wakeBaseline }
}

const freshSelectionClaimOperationId = (record: JournalRecord): OperationId | undefined =>
  record.event._tag === "TaskClaimAcquisitionIntended" &&
  record.event.operation.authority._tag === "TaskSelectionAuthority"
    ? record.event.operation.acquisition.operationId
    : undefined

/**
 * Projects the task-local constraint created by one conclusive fresh claim
 * rejection. Complete graph observations only wake focused reads; only the
 * tracker's focused `UnclaimedTask` result clears the constraint.
 */
export const rejectedFreshTaskClaimDisposition = (
  records: ReadonlyArray<JournalRecord>,
  task: Task,
  claimIntent: JournalRecord,
  completeGraphObserved: ReadonlySet<OperationId>,
  immutableRunTargetKey: string
): RejectedFreshTaskClaimDisposition => {
  const claimOperationId = freshSelectionClaimOperationId(claimIntent)
  if (claimOperationId === undefined) return RejectedFreshTaskClaimDisposition.ConstraintAbsent()
  const runId = claimIntent.runId
  const rejected = records.findLast((record) =>
    isRejectedClaimOutcome(record, runId, claimIntent.position, claimOperationId)
  )
  if (rejected?.event._tag !== "TaskClaimAcquisitionRejected") {
    return RejectedFreshTaskClaimDisposition.ConstraintAbsent()
  }

  const focusedReads = records.filter((record) =>
    isFocusedConstraintRead(record, runId, rejected.position, task, immutableRunTargetKey, claimOperationId)
  )
  const advancement = advanceFocusedConstraintReads(
    records,
    focusedReads,
    runId,
    rejected.position,
    immutableRunTargetKey,
    completeGraphObserved
  )
  if (advancement._tag === "Cleared") return RejectedFreshTaskClaimDisposition.ConstraintCleared()
  if (advancement._tag === "Retained") return RejectedFreshTaskClaimDisposition.ConstraintRetained()

  const wakeGraph = completeGraphWakeFor(
    records,
    runId,
    advancement.wakeBaseline,
    immutableRunTargetKey,
    completeGraphObserved
  )
  if (wakeGraph?.event._tag !== "TaskTrackerReadIntentRecorded") {
    return RejectedFreshTaskClaimDisposition.ConstraintRetained()
  }
  return RejectedFreshTaskClaimDisposition.ObserveConstraint({
    step: FreshWorkflowStep.ReadRejectedTaskClaim({
      predecessorOperationId: wakeGraph.event.operation.operationId,
      rejectedClaimOperationId: claimOperationId,
      task
    })
  })
}

const isRejectedClaimOutcome = (
  record: JournalRecord,
  runId: RunId,
  after: JournalPosition,
  operationId: OperationId
): boolean =>
  record.runId === runId &&
  record.position > after &&
  record.event._tag === "TaskClaimAcquisitionRejected" &&
  record.event.operationId === operationId
