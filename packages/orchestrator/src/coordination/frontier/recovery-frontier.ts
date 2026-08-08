import { Option, Schema } from "effect"
import { PlannedTaskAttempt, TaskId, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { reconstructedTaskGraphFor } from "../reconstruction/graph-knowledge.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { WorkflowOperation } from "../../workflow/registry/operation.js"

/**
 * One exact next durable boundary for a task entering or continuing Dalph-coordinated work.
 * It is reduced from journal history and is never appended to that history.
 */
export const RunRecoveryFrontierEntry = Schema.TaggedUnion({
  TaskClaimAcquisitionNeeded: { observationOperation: WorkflowOperation.cases.ReadTrackerGraph, taskId: TaskId },
  TaskClaimAcquisitionUnresolved: { operation: WorkflowOperation.cases.AcquireTaskClaim },
  TaskEligibilityRefreshNeeded: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    observationOperation: WorkflowOperation.cases.ReadTrackerGraph
  },
  TaskEligibilityRefreshUnresolved: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    operation: WorkflowOperation.cases.ReadTrackerGraph
  },
  TaskWorkSpecificationReadNeeded: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    observationOperation: WorkflowOperation.cases.ReadTrackerGraph
  },
  TaskWorkSpecificationReadUnresolved: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    operation: WorkflowOperation.cases.ReadTaskWorkSpecification
  },
  TaskAttemptPlanNeeded: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    observationOperation: WorkflowOperation.cases.ReadTaskWorkSpecification
  },
  TaskWorktreeReconciliationNeeded: {
    authority: Schema.Literal("Git"),
    planOperation: WorkflowOperation.cases.RecordTaskAttemptPlan
  },
  TaskWorktreeReconciliationUnresolved: { operation: WorkflowOperation.cases.ReconcileTaskWorktree },
  PlannedAttemptExecutorWorkNeeded: { planOperation: WorkflowOperation.cases.RecordTaskAttemptPlan },
  PlannedAttemptExecutorWorkUnresolved: { planOperation: WorkflowOperation.cases.RecordTaskAttemptPlan },
  Terminal: { plannedAttempt: PlannedTaskAttempt }
})
export type RunRecoveryFrontierEntry = typeof RunRecoveryFrontierEntry.Type
type TaskClaimAcquisitionNeeded = Extract<RunRecoveryFrontierEntry, { readonly _tag: "TaskClaimAcquisitionNeeded" }>

export const NonterminalRecoveryFrontierTag = Schema.Literals([
  "TaskClaimAcquisitionNeeded",
  "TaskClaimAcquisitionUnresolved",
  "TaskEligibilityRefreshNeeded",
  "TaskEligibilityRefreshUnresolved",
  "TaskWorkSpecificationReadNeeded",
  "TaskWorkSpecificationReadUnresolved",
  "TaskAttemptPlanNeeded",
  "TaskWorktreeReconciliationNeeded",
  "TaskWorktreeReconciliationUnresolved",
  "PlannedAttemptExecutorWorkNeeded",
  "PlannedAttemptExecutorWorkUnresolved"
])

/**
 * The complete non-persisted recovery frontier for one Dalph run.
 * Every acknowledged planned task attempt or unfinished pre-attempt task contributes one entry.
 */
export const RunRecoveryFrontier = Schema.Struct({ entries: Schema.Array(RunRecoveryFrontierEntry) })
export type RunRecoveryFrontier = typeof RunRecoveryFrontier.Type

const sameAttempt = plannedTaskAttemptEquivalence

const reconstructedGraphThrough = (
  records: ReadonlyArray<JournalRecord>,
  recordIndex: number,
  target: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"]["target"]
) =>
  reconstructedTaskGraphFor(
    {
      taskTrackerFacts: records
        .slice(0, recordIndex + 1)
        .flatMap(({ event }) => (event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []))
    },
    target
  )

const graphReadIntentFor = (records: ReadonlyArray<JournalRecord>, operationId: string) => {
  const intent = records.find(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.operationId === operationId
  )?.event
  return intent?._tag === "TaskTrackerReadIntentRecorded" && intent.operation._tag === "ReadTrackerGraph"
    ? intent.operation
    : undefined
}

const hasLaterGraphForTarget = (
  records: ReadonlyArray<JournalRecord>,
  recordIndex: number,
  targetKey: string
): boolean =>
  records
    .slice(recordIndex + 1)
    .some(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        (event.observation._tag === "CompleteTaskTrackerFacts" ||
          event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
        taskTrackerTargetKey(event.observation.target) === targetKey
    )

const unclaimedEntriesForRecord = (
  records: ReadonlyArray<JournalRecord>,
  claimedTaskIds: ReadonlySet<TaskId>,
  plannedTaskIds: ReadonlySet<TaskId>,
  record: JournalRecord,
  recordIndex: number
): ReadonlyArray<TaskClaimAcquisitionNeeded> => {
  const event = record.event
  if (
    event._tag !== "TaskTrackerFactsObserved" ||
    (event.observation._tag !== "CompleteTaskTrackerFacts" &&
      event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed")
  )
    return []
  const observationOperation = graphReadIntentFor(records, event.operationId)
  if (observationOperation === undefined) return []
  if (hasLaterGraphForTarget(records, recordIndex, taskTrackerTargetKey(event.observation.target))) return []
  const reconstructed = reconstructedGraphThrough(records, recordIndex, observationOperation.target)
  if (Option.isNone(reconstructed)) return []
  return reconstructed.value
    .eligibleTasks()
    .flatMap(({ id: taskId }) =>
      claimedTaskIds.has(taskId) || plannedTaskIds.has(taskId)
        ? []
        : [RunRecoveryFrontierEntry.cases.TaskClaimAcquisitionNeeded.make({ observationOperation, taskId })]
    )
}

const recoveryEntryForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  planOperation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
): RunRecoveryFrontierEntry => {
  const plannedAttempt = planOperation.plannedAttempt
  const worktreeIntent = records.find(
    ({ event }) =>
      event._tag === "TaskWorktreeReconciliationIntended" && sameAttempt(event.operation.plannedAttempt, plannedAttempt)
  )?.event
  if (worktreeIntent?._tag !== "TaskWorktreeReconciliationIntended") {
    return RunRecoveryFrontierEntry.cases.TaskWorktreeReconciliationNeeded.make({ authority: "Git", planOperation })
  }
  const worktreeReady = records.some(
    ({ event }) => event._tag === "TaskWorktreeReady" && event.operationId === worktreeIntent.operation.operationId
  )
  if (!worktreeReady) {
    return RunRecoveryFrontierEntry.cases.TaskWorktreeReconciliationUnresolved.make({
      operation: worktreeIntent.operation
    })
  }

  const responsibilityBegan = records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      sameAttempt(event.plannedAttempt, plannedAttempt)
  )
  if (!responsibilityBegan) {
    return RunRecoveryFrontierEntry.cases.PlannedAttemptExecutorWorkNeeded.make({ planOperation })
  }
  const latestReport = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.attemptId === plannedAttempt.attemptId &&
      event.report.correlation.runId === plannedAttempt.runId
  )?.event
  return latestReport?._tag === "PlannedAttemptExecutorWorkReported" && latestReport.report._tag === "Terminal"
    ? RunRecoveryFrontierEntry.cases.Terminal.make({ plannedAttempt })
    : RunRecoveryFrontierEntry.cases.PlannedAttemptExecutorWorkUnresolved.make({ planOperation })
}

const taskPreparationEntry = (
  records: ReadonlyArray<JournalRecord>,
  claimOperation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
  admissionOperation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
): RunRecoveryFrontierEntry => {
  const taskId = claimOperation.acquisition.taskId
  const specificationRead = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorkSpecification" &&
      event.operation.taskId === taskId &&
      event.operation.predecessorOperationIds.includes(admissionOperation.operationId)
  )?.event
  if (
    specificationRead?._tag !== "TaskTrackerReadIntentRecorded" ||
    specificationRead.operation._tag !== "ReadTaskWorkSpecification"
  ) {
    return RunRecoveryFrontierEntry.cases.TaskWorkSpecificationReadNeeded.make({
      claimOperation,
      observationOperation: admissionOperation
    })
  }
  const observed = records.some(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" && event.operationId === specificationRead.operation.operationId
  )
  return observed
    ? RunRecoveryFrontierEntry.cases.TaskAttemptPlanNeeded.make({
        claimOperation,
        observationOperation: specificationRead.operation
      })
    : RunRecoveryFrontierEntry.cases.TaskWorkSpecificationReadUnresolved.make({
        claimOperation,
        operation: specificationRead.operation
      })
}

/** Reduces immutable workflow-journal history into one total run-level recovery frontier. */
export const deriveRunRecoveryFrontier = (records: ReadonlyArray<JournalRecord>): RunRecoveryFrontier => {
  const plannedStages = records.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned" ? [recoveryEntryForAttempt(records, event.operation)] : []
  )
  const plannedTaskIds = new Set(
    records.flatMap(({ event }) => (event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt.taskId] : []))
  )
  const unplannedClaims = records.flatMap<RunRecoveryFrontierEntry>(({ event }) => {
    if (event._tag !== "TaskClaimAcquisitionIntended" || plannedTaskIds.has(event.operation.acquisition.taskId))
      return []
    const rejected = records.some(
      ({ event: candidate }) =>
        candidate._tag === "TaskClaimAcquisitionRejected" &&
        candidate.operationId === event.operation.acquisition.operationId
    )
    if (rejected) return []
    const acquired = records.some(
      ({ event: candidate }) =>
        candidate._tag === "TaskClaimAcquired" &&
        candidate.claim.operationId === event.operation.acquisition.operationId
    )
    if (!acquired) {
      return [RunRecoveryFrontierEntry.cases.TaskClaimAcquisitionUnresolved.make({ operation: event.operation })]
    }
    const admission = records.findLast(
      ({ event: candidate }) =>
        candidate._tag === "TaskTrackerReadIntentRecorded" &&
        candidate.operation._tag === "ReadTrackerGraph" &&
        candidate.operation.predecessorOperationIds.includes(event.operation.acquisition.operationId)
    )?.event
    if (admission?._tag !== "TaskTrackerReadIntentRecorded" || admission.operation._tag !== "ReadTrackerGraph") {
      const priorObservation = records.findLast(
        ({ event: candidate }) =>
          candidate._tag === "TaskTrackerReadIntentRecorded" &&
          candidate.operation._tag === "ReadTrackerGraph" &&
          event.operation.predecessorOperationIds.includes(candidate.operation.operationId)
      )?.event
      return priorObservation?._tag === "TaskTrackerReadIntentRecorded" &&
        priorObservation.operation._tag === "ReadTrackerGraph"
        ? [
            RunRecoveryFrontierEntry.cases.TaskEligibilityRefreshNeeded.make({
              claimOperation: event.operation,
              observationOperation: priorObservation.operation
            })
          ]
        : []
    }
    const observedIndex = records.findLastIndex(
      ({ event: candidate }) =>
        candidate._tag === "TaskTrackerFactsObserved" && candidate.operationId === admission.operation.operationId
    )
    const reconstructed =
      observedIndex < 0 ? Option.none() : reconstructedGraphThrough(records, observedIndex, admission.operation.target)
    const admitted = Option.exists(reconstructed, (snapshot) =>
      snapshot.eligibleTasks().some(({ id }) => id === event.operation.acquisition.taskId)
    )
    return admitted
      ? [taskPreparationEntry(records, event.operation, admission.operation)]
      : [
          RunRecoveryFrontierEntry.cases.TaskEligibilityRefreshUnresolved.make({
            claimOperation: event.operation,
            operation: admission.operation
          })
        ]
  })
  const claimedTaskIds = new Set(
    records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition.taskId] : []
    )
  )
  const unclaimedTasks = records
    .flatMap((record, recordIndex) =>
      unclaimedEntriesForRecord(records, claimedTaskIds, plannedTaskIds, record, recordIndex)
    )
    .filter(
      (entry, index, entries) => entries.findLastIndex((candidate) => candidate.taskId === entry.taskId) === index
    )
  return RunRecoveryFrontier.make({ entries: [...plannedStages, ...unplannedClaims, ...unclaimedTasks] })
}
