/* eslint-disable functional/immutable-data -- Pure reducers mutate only local scratch that never escapes. */
import { Option } from "effect"
import type { OperationId, RunId } from "./domain.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import type { JournalRecord } from "./journal-store.js"
import { managedHistoryTransitionRuleFor } from "./managed-history-transition.js"
import {
  BestAvailableDurableGraphKnowledge,
  completeTargetClosureFactFamilies,
  ReconstructedManagedRunInvariantIssue,
  type ReconstructedManagedRunResult,
  type ReconstructedManagedRunState,
  ReconstructedPauseState,
  ReconstructedRunPauseState,
  ReconstructedTaskPauseState,
  type ReconstructedWorkflowHistory,
  taskMembershipKey,
  type TaskTrackerTargetClosureKnowledge,
  TaskTrackerTargetClosureKnowledgeConflict,
  TaskTrackerTargetClosureObservation,
  trackerTargetKey,
  WorkflowResponsibilityEntry,
  WorkflowResponsibilityState
} from "./reconstructed-managed-run-state.js"

const applyGraphKnowledgeRecord = (
  records: ReadonlyArray<JournalRecord>,
  targetClosures: Map<string, TaskTrackerTargetClosureKnowledge>,
  record: JournalRecord
): void => {
  if (record.event._tag !== "TrackerGraphOutcomeObserved") return
  const graphOutcome = record.event
  const intent = records.find(({ event }) =>
    event._tag === "TrackerGraphObservationIntentRecorded"
    && event.operation.operationId === graphOutcome.operationId
  )?.event
  if (intent?._tag !== "TrackerGraphObservationIntentRecorded") return

  const targetKey = trackerTargetKey(intent.operation.target)
  const priorKnowledge = targetClosures.get(targetKey)
  const taskIds = [...new Set(graphOutcome.outcome.taskIds)].sort()
  const explicitlyCoveredTaskIds = [...intent.operation.readShape.explicitlyCoveredTaskIds]
  const provenAbsentTaskIds = explicitlyCoveredTaskIds.filter((taskId) => !taskIds.includes(taskId))
  const observation = TaskTrackerTargetClosureObservation.make({
    completeness: "Complete",
    consistency: "PotentiallyMixedTime",
    explicitlyCoveredTaskIds,
    factFamilies: [...completeTargetClosureFactFamilies],
    freshness: "FreshAtReadBoundary",
    observedAt: record.position,
    operationId: graphOutcome.operationId,
    provenAbsentTaskIds,
    revision: graphOutcome.outcome.revision,
    target: intent.operation.target,
    taskIds
  })
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
  return [...removedTaskIds, ...addedTaskIds].every((taskId) => observation.explicitlyCoveredTaskIds.includes(taskId))
    && removedTaskIds.every((taskId) => observation.provenAbsentTaskIds.includes(taskId))
}

const combineTargetClosureKnowledge = (
  prior: TaskTrackerTargetClosureKnowledge | undefined,
  observation: TaskTrackerTargetClosureObservation
): TaskTrackerTargetClosureKnowledge => {
  if (
    prior === undefined || (
      prior._tag === "TaskTrackerTargetClosureObserved"
      && (
        sameMembership(prior, observation)
        || changedMembershipIsProven(prior, observation)
      )
    )
  ) return observation
  if (prior._tag === "TaskTrackerTargetClosureKnowledgeConflict") {
    if (
      prior.observations.every((priorObservation) =>
        sameMembership(priorObservation, observation)
        || changedMembershipIsProven(priorObservation, observation)
      )
    ) return observation
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
const reduceGraphKnowledge = (
  records: ReadonlyArray<JournalRecord>
): BestAvailableDurableGraphKnowledge => {
  const targetClosures = new Map<string, TaskTrackerTargetClosureKnowledge>()
  for (const record of records) {
    applyGraphKnowledgeRecord(records, targetClosures, record)
  }
  return BestAvailableDurableGraphKnowledge.make({
    targetClosures: [...targetClosures.values()]
  })
}

const hasOutcome = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): boolean =>
  records.some(({ event }) => {
    const transition = managedHistoryTransitionRuleFor(event._tag)
    if (transition?._tag !== "Outcome" && transition?._tag !== "ProviderOutcome") return false
    const descriptor = describeJournalEvent(event)
    return descriptor._tag === "OperationEventDescriptor"
      && descriptor.operationId === operationId
  })

const taskBoundaryResponsibility = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord
): WorkflowResponsibilityEntry | undefined => {
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
  if (event._tag === "TaskWorkSessionEstablishmentIntentRecorded") {
    return WorkflowResponsibilityEntry.cases.TaskWorkSessionResponsibility.make({
      beganAt: record.position,
      operation: event.operation,
      taskId: event.operation.request.plannedAttempt.taskId
    })
  }
  if (
    event._tag === "TaskExecutionIntentRecorded"
    && !hasOutcome(records, event.operation.request.operationId)
  ) {
    return WorkflowResponsibilityEntry.cases.TaskExecutionResponsibility.make({
      beganAt: record.position,
      operation: event.operation,
      taskId: event.operation.request.plannedAttempt.taskId
    })
  }
  return undefined
}

const implementationReviewPlannedAttempt = (
  records: ReadonlyArray<JournalRecord>,
  evidenceSealingOperationId: OperationId
) => {
  const evidenceIntent = records.find(({ event }) =>
    event._tag === "ImplementationEvidenceSealingIntended"
    && event.operation.operationId === evidenceSealingOperationId
  )
  return evidenceIntent?.event._tag === "ImplementationEvidenceSealingIntended"
    ? evidenceIntent.event.operation.plannedAttempt
    : undefined
}

const reviewBoundaryResponsibility = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord
): WorkflowResponsibilityEntry | undefined => {
  const event = record.event
  if (
    event._tag === "ImplementationEvidenceSealingIntended"
    && !hasOutcome(records, event.operation.operationId)
  ) {
    return WorkflowResponsibilityEntry.cases.ImplementationEvidenceResponsibility.make({
      beganAt: record.position,
      operation: event.operation,
      taskId: event.operation.plannedAttempt.taskId
    })
  }
  if (
    event._tag === "ImplementationReviewIntended"
    && !hasOutcome(records, event.operation.request.operationId)
  ) {
    const plannedAttempt = implementationReviewPlannedAttempt(
      records,
      event.operation.request.evidenceSealingOperationId
    )
    if (plannedAttempt === undefined) return undefined
    return WorkflowResponsibilityEntry.cases.ImplementationReviewResponsibility.make({
      beganAt: record.position,
      operation: event.operation,
      plannedAttempt,
      taskId: plannedAttempt.taskId
    })
  }
  if (
    event._tag === "ReviewFindingsHandbackIntended"
    && !hasOutcome(records, event.operation.request.operationId)
  ) {
    return WorkflowResponsibilityEntry.cases.ReviewFindingsHandbackResponsibility.make({
      beganAt: record.position,
      operation: event.operation,
      taskId: event.operation.request.plannedAttempt.taskId
    })
  }
  return undefined
}

/** Pure per-subject responsibility reducer. */
const reduceWorkflowResponsibility = (
  records: ReadonlyArray<JournalRecord>
): WorkflowResponsibilityState => {
  const entries = records.flatMap<WorkflowResponsibilityEntry>((record) => {
    const entry = taskBoundaryResponsibility(records, record)
      ?? reviewBoundaryResponsibility(records, record)
    return entry === undefined ? [] : [entry]
  })
  return WorkflowResponsibilityState.make({ entries })
}

/** Pure workflow-history reducer; it retains every exact decoded record. */
const reduceWorkflowHistory = (
  records: ReadonlyArray<JournalRecord>
): ReconstructedWorkflowHistory => ({ records })

/** Pure pause reducer, ready for the pause command algebra introduced later. */
const reducePauseState = (
  _records: ReadonlyArray<JournalRecord>
): ReconstructedPauseState =>
  ReconstructedPauseState.make({
    run: ReconstructedRunPauseState.cases.RunUnpaused.make({}),
    tasks: ReconstructedTaskPauseState.cases.NoTaskPauses.make({})
  })

const graphKnowledgeObservations = (
  knowledge: BestAvailableDurableGraphKnowledge
): ReadonlyArray<TaskTrackerTargetClosureObservation> =>
  knowledge.targetClosures.flatMap((entry) =>
    entry._tag === "TaskTrackerTargetClosureObserved"
      ? [entry]
      : entry.observations
  )

const validateGraphKnowledge = (
  graphKnowledge: BestAvailableDurableGraphKnowledge,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ReconstructedManagedRunInvariantIssue> =>
  graphKnowledgeObservations(graphKnowledge).flatMap((observation) => {
    const record = records.at(observation.observedAt - 1)
    if (
      record?.event._tag === "TrackerGraphOutcomeObserved"
      && record.event.operationId === observation.operationId
    ) return []
    return [
      ReconstructedManagedRunInvariantIssue.cases.GraphKnowledgeHistoryMismatch.make({
        operationId: observation.operationId,
        position: observation.observedAt
      })
    ]
  })

const responsibilityOperationId = (
  entry: WorkflowResponsibilityEntry
): OperationId =>
  WorkflowResponsibilityEntry.match(entry, {
    ImplementationEvidenceResponsibility: ({ operation }) => operation.operationId,
    ImplementationReviewResponsibility: ({ operation }) => operation.request.operationId,
    ReviewFindingsHandbackResponsibility: ({ operation }) => operation.request.operationId,
    TaskClaimResponsibility: ({ acquisition }) => acquisition.operationId,
    TaskExecutionResponsibility: ({ operation }) => operation.request.operationId,
    TaskWorkSessionResponsibility: ({ operation }) => operation.request.operationId,
    TaskWorktreeResponsibility: ({ operation }) => operation.operationId
  })

const validateResponsibility = (
  responsibility: WorkflowResponsibilityState,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ReconstructedManagedRunInvariantIssue> =>
  responsibility.entries.flatMap((entry) => {
    const operationId = responsibilityOperationId(entry)
    const record = records.at(entry.beganAt - 1)
    if (record !== undefined) {
      const descriptor = describeJournalEvent(record.event)
      const transition = managedHistoryTransitionRuleFor(record.event._tag)
      if (
        descriptor._tag === "OperationEventDescriptor"
        && descriptor.operationId === operationId
        && transition?._tag === "Intent"
      ) return []
    }
    return [
      ReconstructedManagedRunInvariantIssue.cases.ResponsibilityHistoryMismatch.make({
        operationId,
        position: entry.beganAt
      })
    ]
  })

const validateReviewSubjects = (
  responsibility: WorkflowResponsibilityState,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<ReconstructedManagedRunInvariantIssue> =>
  records.flatMap(({ event, position }) => {
    if (
      event._tag !== "ImplementationReviewIntended"
      || hasOutcome(records, event.operation.request.operationId)
      || responsibility.entries.some((entry) =>
        entry._tag === "ImplementationReviewResponsibility"
        && entry.operation.request.operationId === event.operation.request.operationId
      )
    ) return []
    return [
      ReconstructedManagedRunInvariantIssue.cases.UnresolvedReviewSubject.make({
        operationId: event.operation.request.operationId,
        position
      })
    ]
  })

/**
 * Composes the distinct reducers only after managed-history validation has
 * accepted canonical order and causal relationships.
 */
export const reconstructManagedRunState = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ReconstructedManagedRunResult => {
  const graphKnowledge = reduceGraphKnowledge(records)
  const responsibility = reduceWorkflowResponsibility(records)
  const state: ReconstructedManagedRunState = {
    appliedThrough: records.at(records.length - 1)?.position ?? null,
    graphKnowledge,
    pause: reducePauseState(records),
    responsibility,
    runId,
    workflowHistory: reduceWorkflowHistory(records)
  }
  const issues = [
    ...validateGraphKnowledge(graphKnowledge, records),
    ...validateResponsibility(responsibility, records),
    ...validateReviewSubjects(responsibility, records)
  ]
  if (issues.length === 0) return { _tag: "ValidReconstructedManagedRun", state }
  return {
    _tag: "InvalidReconstructedManagedRun",
    issues: [Option.getOrThrow(Option.fromUndefinedOr(issues[0])), ...issues.slice(1)]
  }
}
