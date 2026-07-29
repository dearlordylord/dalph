/* eslint-disable functional/immutable-data -- Pure reducers mutate only local scratch that never escapes. */
import { Option } from "effect"
import type { RunId, TaskId } from "./domain.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import type { JournalRecord } from "./journal-store.js"
import { workflowJournalTransitionRuleFor } from "./workflow-journal-transition.js"
import {
  BestAvailableDurableGraphKnowledge,
  makeTaskTrackerTargetClosureObservation,
  ReconstructedRunInvariantIssue,
  type ReconstructedRunResult,
  type ReconstructedRunState,
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  type ReconstructedWorkflowHistory,
  taskMembershipKey,
  type TaskTrackerTargetClosureKnowledge,
  TaskTrackerTargetClosureKnowledgeConflict,
  type TaskTrackerTargetClosureObservation,
  trackerTargetKey,
  WorkflowResponsibilityEntry,
  workflowResponsibilityOperationId,
  WorkflowResponsibilityState
} from "./reconstructed-run-state.js"

const applyGraphKnowledgeRecord = (
  records: ReadonlyArray<JournalRecord>,
  targetClosures: Map<string, TaskTrackerTargetClosureKnowledge>,
  record: JournalRecord
): void => {
  if (record.event._tag !== "TrackerGraphOutcomeObserved") return
  const graphOutcome = record.event
  const intent = records.find(
    ({ event }) =>
      event._tag === "TrackerGraphObservationIntentRecorded" && event.operation.operationId === graphOutcome.operationId
  )?.event
  if (intent?._tag !== "TrackerGraphObservationIntentRecorded") return

  const targetKey = trackerTargetKey(intent.operation.target)
  const priorKnowledge = targetClosures.get(targetKey)
  const observation = makeTaskTrackerTargetClosureObservation(intent.operation, graphOutcome.outcome, record.position)
  targetClosures.set(targetKey, combineTargetClosureKnowledge(priorKnowledge, observation))
}

const sameMembership = (
  left: TaskTrackerTargetClosureObservation,
  right: TaskTrackerTargetClosureObservation
): boolean => taskMembershipKey(left.taskIds) === taskMembershipKey(right.taskIds)

const changedMembershipIsProven = (
  prior: TaskTrackerTargetClosureObservation,
  observation: TaskTrackerTargetClosureObservation
): boolean => {
  const removedTaskIds = prior.taskIds.filter((taskId) => !observation.taskIds.includes(taskId))
  const addedTaskIds = observation.taskIds.filter((taskId) => !prior.taskIds.includes(taskId))
  return (
    [...removedTaskIds, ...addedTaskIds].every((taskId) => observation.explicitlyCoveredTaskIds.includes(taskId)) &&
    removedTaskIds.every((taskId) => observation.provenAbsentTaskIds.includes(taskId))
  )
}

const combineTargetClosureKnowledge = (
  prior: TaskTrackerTargetClosureKnowledge | undefined,
  observation: TaskTrackerTargetClosureObservation
): TaskTrackerTargetClosureKnowledge => {
  if (
    prior === undefined ||
    (prior._tag === "TaskTrackerTargetClosureObserved" &&
      (sameMembership(prior, observation) || changedMembershipIsProven(prior, observation)))
  )
    return observation
  if (prior._tag === "TaskTrackerTargetClosureKnowledgeConflict") {
    if (
      prior.observations.every(
        (priorObservation) =>
          sameMembership(priorObservation, observation) || changedMembershipIsProven(priorObservation, observation)
      )
    )
      return observation
    return TaskTrackerTargetClosureKnowledgeConflict.make({
      observations: [...prior.observations, observation],
      target: observation.target
    })
  }
  return TaskTrackerTargetClosureKnowledgeConflict.make({
    observations: [prior, observation],
    target: observation.target
  })
}

/** Pure graph-knowledge reducer. */
const reduceGraphKnowledge = (records: ReadonlyArray<JournalRecord>): BestAvailableDurableGraphKnowledge => {
  const targetClosures = new Map<string, TaskTrackerTargetClosureKnowledge>()
  for (const record of records) {
    applyGraphKnowledgeRecord(records, targetClosures, record)
  }
  return BestAvailableDurableGraphKnowledge.make({ targetClosures: [...targetClosures.values()] })
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

const graphKnowledgeObservations = (
  knowledge: BestAvailableDurableGraphKnowledge
): ReadonlyArray<TaskTrackerTargetClosureObservation> =>
  knowledge.targetClosures.flatMap((entry) =>
    entry._tag === "TaskTrackerTargetClosureObserved" ? [entry] : entry.observations
  )

const validateGraphKnowledge = (
  graphKnowledge: BestAvailableDurableGraphKnowledge,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ReconstructedRunInvariantIssue> =>
  graphKnowledgeObservations(graphKnowledge).flatMap((observation) => {
    const record = records.at(observation.observedAt - 1)
    if (record?.event._tag === "TrackerGraphOutcomeObserved" && record.event.operationId === observation.operationId)
      return []
    return [
      ReconstructedRunInvariantIssue.cases.GraphKnowledgeHistoryMismatch.make({
        operationId: observation.operationId,
        position: observation.observedAt
      })
    ]
  })

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
  const issues = [
    ...validateGraphKnowledge(state.graphKnowledge, records),
    ...validateResponsibility(state.responsibility, records)
  ]
  if (issues.length === 0) return { _tag: "ValidReconstructedRun", state }
  return {
    _tag: "InvalidReconstructedRun",
    issues: [Option.getOrThrow(Option.fromUndefinedOr(issues[0])), ...issues.slice(1)]
  }
}
