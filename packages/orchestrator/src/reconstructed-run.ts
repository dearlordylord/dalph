/* eslint-disable functional/immutable-data -- Pure reducers mutate only local scratch that never escapes. */
import { Option } from "effect"
import type { RunId, TaskId } from "./domain.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import type { JournalRecord } from "./journal-store.js"
import { workflowJournalTransitionRuleFor } from "./workflow-journal-transition.js"
import {
  BestAvailableDurableGraphKnowledge,
  ReconstructedRunInvariantIssue,
  type ReconstructedRunResult,
  type ReconstructedRunState,
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  type ReconstructedWorkflowHistory,
  WorkflowResponsibilityEntry,
  workflowResponsibilityOperationId,
  WorkflowResponsibilityState
} from "./reconstructed-run-state.js"

/** Pure graph-knowledge reducer. */
const reduceGraphKnowledge = (records: ReadonlyArray<JournalRecord>): BestAvailableDurableGraphKnowledge => {
  return BestAvailableDurableGraphKnowledge.make({
    taskTrackerFacts: records.flatMap(({ event }) =>
      event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []
    )
  })
}

const taskBoundaryResponsibility = (record: JournalRecord): WorkflowResponsibilityEntry | undefined => {
  const event = record.event
  if (event._tag === "TaskClaimAcquisitionIntended") {
    return WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
      acquisition: event.operation.acquisition,
      beganAt: record.position,
      taskId: event.operation.acquisition.taskId
    })
  }
  if (event._tag === "TaskWorktreeReconciliationIntended") {
    return WorkflowResponsibilityEntry.cases.TaskWorktreeResponsibility.make({
      beganAt: record.position,
      operation: event.operation,
      taskId: event.operation.plannedAttempt.taskId
    })
  }
  return undefined
}

const responsibilityForRecord = (record: JournalRecord): WorkflowResponsibilityEntry | undefined => {
  if (record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    return WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
      beganAt: record.position,
      plannedAttempt: record.event.plannedAttempt
    })
  }
  return taskBoundaryResponsibility(record)
}

/** Pure per-subject responsibility reducer. */
const reduceWorkflowResponsibility = (records: ReadonlyArray<JournalRecord>): WorkflowResponsibilityState => {
  const entries = records.flatMap<WorkflowResponsibilityEntry>((record) => {
    const entry = responsibilityForRecord(record)
    return entry === undefined ? [] : [entry]
  })
  return WorkflowResponsibilityState.make({ entries })
}

/** Pure workflow-history reducer; it retains every exact decoded record. */
const reduceWorkflowHistory = (records: ReadonlyArray<JournalRecord>): ReconstructedWorkflowHistory => ({ records })

const validateGraphKnowledge = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<ReconstructedRunInvariantIssue> =>
  records.flatMap((record, index) =>
    record.event._tag === "TaskTrackerFactsObserved" && record.position !== index + 1
      ? [
          ReconstructedRunInvariantIssue.cases.GraphKnowledgeHistoryMismatch.make({
            operationId: record.event.operationId,
            position: record.position
          })
        ]
      : []
  )

/** Applies each recorded operator direction in journal order. */
const reducePauseState = (records: ReadonlyArray<JournalRecord>): ReconstructedPauseState => {
  let runPaused = false
  const pausedTaskIds = new Set<TaskId>()
  for (const { event } of records) {
    if (event._tag !== "ControlCommandRecorded") continue
    switch (event.command._tag) {
      case "RequestRunPause":
        runPaused = true
        break
      case "RequestRunUnpause":
        runPaused = false
        break
      case "RequestTaskPause":
        pausedTaskIds.add(event.command.taskId)
        break
      case "RequestTaskUnpause":
        pausedTaskIds.delete(event.command.taskId)
        break
    }
  }
  const taskIds = [...pausedTaskIds].sort()
  return ReconstructedPauseState.make({
    run: runPaused
      ? ReconstructedRunPauseState.cases.RunPaused.make({})
      : ReconstructedRunPauseState.cases.RunUnpaused.make({}),
    tasks:
      taskIds.length === 0
        ? ReconstructedTaskPauseState.cases.NoTaskPauses.make({})
        : ReconstructedTaskPauseState.cases.TaskPauses.make({ taskIds })
  })
}

const plannedResponsibilityHasOrigin = (
  entry: Extract<WorkflowResponsibilityEntry, { readonly _tag: "PlannedAttemptExecutorWorkResponsibility" }>,
  record: JournalRecord | undefined
): boolean => {
  if (record?.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    return (
      record.event.plannedAttempt.runId === entry.plannedAttempt.runId &&
      record.event.plannedAttempt.attemptId === entry.plannedAttempt.attemptId
    )
  }
  return false
}

const validateResponsibilityEntry = (
  entry: WorkflowResponsibilityEntry,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ReconstructedRunInvariantIssue> => {
  const record = records.at(entry.beganAt - 1)
  if (entry._tag === "PlannedAttemptExecutorWorkResponsibility") {
    return plannedResponsibilityHasOrigin(entry, record)
      ? []
      : [
          ReconstructedRunInvariantIssue.cases.PlannedAttemptExecutorWorkHistoryMismatch.make({
            attemptId: entry.plannedAttempt.attemptId,
            position: entry.beganAt
          })
        ]
  }
  const operationId = workflowResponsibilityOperationId(entry)
  if (record !== undefined) {
    const descriptor = describeJournalEvent(record.event)
    const transition = workflowJournalTransitionRuleFor(record.event._tag)
    if (
      descriptor._tag === "OperationEventDescriptor" &&
      descriptor.operationId === operationId &&
      transition?._tag === "Intent"
    )
      return []
  }
  return [
    ReconstructedRunInvariantIssue.cases.ResponsibilityHistoryMismatch.make({ operationId, position: entry.beganAt })
  ]
}

const validateResponsibility = (
  responsibility: WorkflowResponsibilityState,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ReconstructedRunInvariantIssue> =>
  responsibility.entries.flatMap((entry) => validateResponsibilityEntry(entry, records))

/** Composes the distinct reducers for records already accepted as valid workflow-journal history. */
export const reconstructValidatedRunState = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ReconstructedRunState => {
  const graphKnowledge = reduceGraphKnowledge(records)
  const responsibility = reduceWorkflowResponsibility(records)
  return {
    appliedThrough: records.at(records.length - 1)?.position ?? null,
    graphKnowledge,
    pause: reducePauseState(records),
    responsibility,
    runId,
    workflowHistory: reduceWorkflowHistory(records)
  }
}

/** Reconstructs arbitrary records and reports broken history-to-state invariants. */
export const reconstructRunState = (runId: RunId, records: ReadonlyArray<JournalRecord>): ReconstructedRunResult => {
  const state = reconstructValidatedRunState(runId, records)
  const issues = [...validateGraphKnowledge(records), ...validateResponsibility(state.responsibility, records)]
  if (issues.length === 0) return { _tag: "ValidReconstructedRun", state }
  return {
    _tag: "InvalidReconstructedRun",
    issues: [Option.getOrThrow(Option.fromUndefinedOr(issues[0])), ...issues.slice(1)]
  }
}
