/* eslint-disable functional/immutable-data -- Pure reducers mutate only local scratch that never escapes. */
import { Option } from "effect"
import { type RunId, type TaskId } from "@dalph/contracts"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalTransitionRuleFor } from "./history-transition.js"
import {
  BestAvailableDurableGraphKnowledge,
  ReconstructedRunInvariantIssue,
  type ReconstructedRunResult,
  type ReconstructedRunState,
  ReconstructedPauseState,
  ReconstructedRunCancellationState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  type ReconstructedWorkflowHistory,
  WorkflowResponsibilityEntry,
  workflowResponsibilityOperationId,
  WorkflowResponsibilityState
} from "./state.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"

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
  if (event._tag === "TaskClaimReleaseIntended") {
    return WorkflowResponsibilityEntry.cases.TaskClaimReleaseResponsibility.make({
      beganAt: record.position,
      operation: event.operation,
      taskId: event.operation.release.claim.taskId
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
  const replacedAttemptIds = new Set(
    records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptReplaced" ? [event.subject.plannedAttempt.attemptId] : []
    )
  )
  const entries = records.flatMap<WorkflowResponsibilityEntry>((record) => {
    const entry = responsibilityForRecord(record)
    return entry === undefined ||
      (entry._tag === "PlannedAttemptExecutorWorkResponsibility" &&
        replacedAttemptIds.has(entry.plannedAttempt.attemptId))
      ? []
      : [entry]
  })
  return WorkflowResponsibilityState.make({ entries })
}

/** Pure workflow-history reducer; it retains every exact decoded record. */
const reduceWorkflowHistory = (records: ReadonlyArray<JournalRecord>): ReconstructedWorkflowHistory => ({ records })

const appendGraphKnowledge = (
  prior: BestAvailableDurableGraphKnowledge,
  record: JournalRecord
): BestAvailableDurableGraphKnowledge =>
  record.event._tag === "TaskTrackerFactsObserved"
    ? BestAvailableDurableGraphKnowledge.make({
        taskTrackerFacts: [...prior.taskTrackerFacts, record.event.observation]
      })
    : prior

const appendResponsibility = (
  prior: WorkflowResponsibilityState,
  record: JournalRecord
): WorkflowResponsibilityState => {
  if (record.event._tag === "PlannedAttemptReplaced") {
    const attemptId = record.event.subject.plannedAttempt.attemptId
    return WorkflowResponsibilityState.make({
      entries: prior.entries.filter(
        (entry) =>
          entry._tag !== "PlannedAttemptExecutorWorkResponsibility" || entry.plannedAttempt.attemptId !== attemptId
      )
    })
  }
  const entry = responsibilityForRecord(record)
  return entry === undefined ? prior : WorkflowResponsibilityState.make({ entries: [...prior.entries, entry] })
}

const appendControlPolicy = (
  prior: ReconstructedRunState["controlPolicy"],
  record: JournalRecord
): ReconstructedRunState["controlPolicy"] =>
  record.event._tag === "TaskWorkCapacityChanged"
    ? Option.some(
        RunControlPolicy.make({ revision: record.event.revision, taskExecutionCapacity: record.event.capacity })
      )
    : prior

const appendPauseState = (prior: ReconstructedPauseState, record: JournalRecord): ReconstructedPauseState => {
  if (record.event._tag !== "ControlDirectionApplied") return prior
  if (record.event.subject._tag === "Run") {
    return ReconstructedPauseState.make({
      run:
        record.event.direction === "Pause"
          ? ReconstructedRunPauseState.cases.RunPaused.make({})
          : ReconstructedRunPauseState.cases.RunUnpaused.make({}),
      tasks: prior.tasks
    })
  }
  const paused = new Set(prior.tasks._tag === "TaskPauses" ? prior.tasks.taskIds : [])
  if (record.event.direction === "Pause") paused.add(record.event.subject.taskId)
  else paused.delete(record.event.subject.taskId)
  const taskIds = [...paused].sort()
  return ReconstructedPauseState.make({
    run: prior.run,
    tasks:
      taskIds.length === 0
        ? ReconstructedTaskPauseState.cases.NoTaskPauses.make({})
        : ReconstructedTaskPauseState.cases.TaskPauses.make({ taskIds })
  })
}

const appendCancellationState = (
  prior: ReconstructedRunCancellationState,
  record: JournalRecord
): ReconstructedRunCancellationState =>
  record.event._tag === "RunCancellationApplied"
    ? ReconstructedRunCancellationState.cases.RunCancellationApplied.make({ appliedAt: record.position })
    : prior

/** Advances one already-validated prefix after its exact successor record has passed history validation. */
export const advanceReconstructedRunState = (
  prior: ReconstructedRunState,
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord> = [...prior.workflowHistory.records, record]
): ReconstructedRunState => {
  return {
    appliedThrough: record.position,
    controlPolicy: appendControlPolicy(prior.controlPolicy, record),
    graphKnowledge: appendGraphKnowledge(prior.graphKnowledge, record),
    pause: appendPauseState(prior.pause, record),
    cancellation: appendCancellationState(
      prior.cancellation ?? ReconstructedRunCancellationState.cases.RunCancellationNotApplied.make({}),
      record
    ),
    responsibility: appendResponsibility(prior.responsibility, record),
    runId: prior.runId,
    workflowHistory: { records }
  }
}

/** Applies the initial policy and every later Operator change in journal order. */
const reduceControlPolicy = (records: ReadonlyArray<JournalRecord>) => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began?.event._tag !== "WorkflowRunBegan") return Option.none()
  let policy = RunControlPolicy.make({
    revision: initialRunPolicyRevision,
    taskExecutionCapacity: began.event.initialControlPolicy.taskExecutionCapacity
  })
  for (const { event } of records) {
    if (event._tag !== "TaskWorkCapacityChanged") continue
    policy = RunControlPolicy.make({ revision: event.revision, taskExecutionCapacity: event.capacity })
  }
  return Option.some(policy)
}

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
    if (event._tag !== "ControlDirectionApplied") continue
    if (event.subject._tag === "Run") runPaused = event.direction === "Pause"
    else if (event.direction === "Pause") pausedTaskIds.add(event.subject.taskId)
    else pausedTaskIds.delete(event.subject.taskId)
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
    const transition = workflowJournalTransitionRuleFor(record.event)
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
    controlPolicy: reduceControlPolicy(records),
    graphKnowledge,
    pause: reducePauseState(records),
    cancellation: records.reduce<ReconstructedRunCancellationState>(
      appendCancellationState,
      ReconstructedRunCancellationState.cases.RunCancellationNotApplied.make({})
    ),
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
