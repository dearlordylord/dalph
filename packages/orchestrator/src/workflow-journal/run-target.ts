import type { RunId, TaskId } from "@dalph/contracts"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import type { OperationId } from "../workflow/identity.js"
import type { JournalPosition } from "./identity.js"
import {
  firstJournalRecordOfKind,
  lastJournalRecordOfKind,
  journalRecordsOfKind,
  journalRecordByKey,
  isJournalRecordEvidence,
  type JournalHistorySource
} from "./record-evidence.js"
import { intentRecordKey } from "./record-key.js"

/** The immutable tracker target recorded by exactly one valid Run beginning. */
export const exactWorkflowRunTargetFor = (records: JournalHistorySource): TrackerTarget | undefined => {
  const first = firstJournalRecordOfKind(records, "WorkflowRunBegan")
  if (first === undefined) return undefined
  const beginning = first === lastJournalRecordOfKind(records, "WorkflowRunBegan") ? first : undefined
  return beginning?.event._tag === "WorkflowRunBegan" ? beginning.event.target : undefined
}

/**
 * Projects one Run's immutable tracker target while retaining the caller's
 * Run-identity guard when a shared journal projection contains other Runs.
 */
export const exactWorkflowRunTargetForRun = (records: JournalHistorySource, runId: RunId): TrackerTarget | undefined =>
  exactWorkflowRunTargetFor(
    Array.from(journalRecordsOfKind(records, "WorkflowRunBegan")).filter((record) => record.runId === runId)
  )

/**
 * A stopped-claim disposition may use only the focused claim read whose
 * operation names the immutable Run target.  This predicate is shared by
 * recovery, public control, and termination projection so those boundaries
 * cannot settle from a foreign-target read.
 */
export const claimReadMatchesTarget = (
  records: JournalHistorySource,
  observationOperationId: OperationId,
  taskId: TaskId,
  after: JournalPosition,
  before: JournalPosition,
  target: TrackerTarget | undefined
): boolean => {
  if (target === undefined) return false
  const read = isJournalRecordEvidence(records)
    ? journalRecordByKey(records, intentRecordKey(observationOperationId))
    : records.find(
        ({ event, position }) =>
          position > after &&
          position < before &&
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTaskClaim" &&
          event.operation.operationId === observationOperationId &&
          event.operation.taskId === taskId
      )
  return (
    read !== undefined &&
    read.position > after &&
    read.position < before &&
    read.event._tag === "TaskTrackerReadIntentRecorded" &&
    read.event.operation._tag === "ReadTaskClaim" &&
    read.event.operation.operationId === observationOperationId &&
    read.event.operation.taskId === taskId &&
    taskTrackerTargetKey(read.event.operation.target) === taskTrackerTargetKey(target)
  )
}
