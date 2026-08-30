import type { RunId, TaskId } from "@dalph/contracts"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import type { OperationId } from "../workflow/identity.js"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"

/** The immutable tracker target recorded by exactly one valid Run beginning. */
export const exactWorkflowRunTargetFor = (records: ReadonlyArray<JournalRecord>): TrackerTarget | undefined => {
  const beginnings = records.filter(({ event }) => event._tag === "WorkflowRunBegan")
  const beginning = beginnings.length === 1 ? beginnings[0] : undefined
  return beginning?.event._tag === "WorkflowRunBegan" ? beginning.event.target : undefined
}

/**
 * Projects one Run's immutable tracker target while retaining the caller's
 * Run-identity guard when a shared journal projection contains other Runs.
 */
export const exactWorkflowRunTargetForRun = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId
): TrackerTarget | undefined => exactWorkflowRunTargetFor(records.filter((record) => record.runId === runId))

/**
 * A stopped-claim disposition may use only the focused claim read whose
 * operation names the immutable Run target.  This predicate is shared by
 * recovery, public control, and termination projection so those boundaries
 * cannot settle from a foreign-target read.
 */
export const claimReadMatchesTarget = (
  records: ReadonlyArray<JournalRecord>,
  observationOperationId: OperationId,
  taskId: TaskId,
  after: JournalPosition,
  before: JournalPosition,
  target: TrackerTarget | undefined
): boolean => {
  if (target === undefined) return false
  const read = records.find(
    ({ event, position }) =>
      position > after &&
      position < before &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.operationId === observationOperationId &&
      event.operation.taskId === taskId
  )
  return (
    read?.event._tag === "TaskTrackerReadIntentRecorded" &&
    read.event.operation._tag === "ReadTaskClaim" &&
    taskTrackerTargetKey(read.event.operation.target) === taskTrackerTargetKey(target)
  )
}
