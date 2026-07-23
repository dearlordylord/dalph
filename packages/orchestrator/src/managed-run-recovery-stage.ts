import { Schema } from "effect"
import { PlannedTaskAttempt, TaskId, TaskWorkSessionId } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
import { plannedTaskAttemptEquivalence } from "./planned-task-attempt.js"
import { WorkflowOperation } from "./workflow-operation.js"

/**
 * One exact next durable boundary for a task entering or continuing managed work.
 * It is reduced from journal history and is never appended to that history.
 */
export const ManagedRunRecoveryStageEntry = Schema.TaggedUnion({
  TaskClaimAcquisitionNeeded: {
    observationOperation: WorkflowOperation.cases.ReadTrackerGraph,
    taskId: TaskId
  },
  TaskClaimAcquisitionUnresolved: {
    operation: WorkflowOperation.cases.AcquireTaskClaim
  },
  TaskEligibilityRefreshNeeded: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    observationOperation: WorkflowOperation.cases.ReadTrackerGraph
  },
  TaskEligibilityRefreshUnresolved: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    operation: WorkflowOperation.cases.ReadTrackerGraph
  },
  TaskAttemptPlanNeeded: {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    observationOperation: WorkflowOperation.cases.ReadTrackerGraph
  },
  TaskWorktreeReconciliationNeeded: {
    authority: Schema.Literal("Git"),
    planOperation: WorkflowOperation.cases.RecordTaskAttemptPlan
  },
  TaskWorktreeReconciliationUnresolved: {
    operation: WorkflowOperation.cases.ReconcileTaskWorktree
  },
  TaskWorkSessionEstablishmentNeeded: {
    authority: Schema.Literal("TaskRunner"),
    planOperation: WorkflowOperation.cases.RecordTaskAttemptPlan,
    worktreeOperation: WorkflowOperation.cases.ReconcileTaskWorktree
  },
  TaskWorkSessionEstablishmentUnresolved: {
    operation: WorkflowOperation.cases.EstablishTaskWorkSession
  },
  TaskExecutionNeeded: {
    authority: Schema.Literal("TaskExecutor"),
    planOperation: WorkflowOperation.cases.RecordTaskAttemptPlan,
    sessionEstablishmentOperation: WorkflowOperation.cases.EstablishTaskWorkSession,
    sessionId: TaskWorkSessionId
  },
  TaskExecutionUnresolved: {
    operation: WorkflowOperation.cases.ExecuteTaskWork
  },
  ImplementationConvergencePending: {
    planOperation: WorkflowOperation.cases.RecordTaskAttemptPlan
  },
  Terminal: {
    plannedAttempt: PlannedTaskAttempt
  }
})
export type ManagedRunRecoveryStageEntry = typeof ManagedRunRecoveryStageEntry.Type

export const NonterminalRecoveryStageTag = Schema.Literals([
  "TaskClaimAcquisitionNeeded",
  "TaskClaimAcquisitionUnresolved",
  "TaskEligibilityRefreshNeeded",
  "TaskEligibilityRefreshUnresolved",
  "TaskAttemptPlanNeeded",
  "TaskWorktreeReconciliationNeeded",
  "TaskWorktreeReconciliationUnresolved",
  "TaskWorkSessionEstablishmentNeeded",
  "TaskWorkSessionEstablishmentUnresolved",
  "TaskExecutionNeeded",
  "TaskExecutionUnresolved",
  "ImplementationConvergencePending"
])

/**
 * The complete non-persisted recovery frontier for one managed run.
 * Every acknowledged planned task attempt or unfinished pre-attempt task contributes one entry.
 */
export const ManagedRunRecoveryStage = Schema.Struct({
  entries: Schema.Array(ManagedRunRecoveryStageEntry)
})
export type ManagedRunRecoveryStage = typeof ManagedRunRecoveryStage.Type

const sameAttempt = plannedTaskAttemptEquivalence

const stageForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  planOperation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
): ManagedRunRecoveryStageEntry => {
  const plannedAttempt = planOperation.plannedAttempt
  const terminal = records.some(({ event }) =>
    event._tag === "ImplementationConvergenceDispositionRecorded"
    && event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
    && sameAttempt(event.operation.request.disposition.subject.plannedAttempt, plannedAttempt)
  )
  if (terminal) {
    return ManagedRunRecoveryStageEntry.cases.Terminal.make({ plannedAttempt })
  }

  const worktreeIntent = records.find(({ event }) =>
    event._tag === "TaskWorktreeReconciliationIntended"
    && sameAttempt(event.operation.plannedAttempt, plannedAttempt)
  )?.event
  if (worktreeIntent?._tag !== "TaskWorktreeReconciliationIntended") {
    return ManagedRunRecoveryStageEntry.cases.TaskWorktreeReconciliationNeeded.make({
      authority: "Git",
      planOperation
    })
  }
  const worktreeReady = records.some(({ event }) =>
    event._tag === "TaskWorktreeReady"
    && event.operationId === worktreeIntent.operation.operationId
  )
  if (!worktreeReady) {
    return ManagedRunRecoveryStageEntry.cases.TaskWorktreeReconciliationUnresolved.make({
      operation: worktreeIntent.operation
    })
  }

  const sessionIntent = records.find(({ event }) =>
    event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
    && sameAttempt(event.operation.request.plannedAttempt, plannedAttempt)
  )?.event
  if (sessionIntent?._tag !== "TaskWorkSessionEstablishmentIntentRecorded") {
    return ManagedRunRecoveryStageEntry.cases.TaskWorkSessionEstablishmentNeeded.make({
      authority: "TaskRunner",
      planOperation,
      worktreeOperation: worktreeIntent.operation
    })
  }
  const sessionEstablished = records.find(({ event }) =>
    event._tag === "TaskWorkSessionEstablished"
    && event.outcome.operationId === sessionIntent.operation.request.operationId
  )?.event
  if (sessionEstablished?._tag !== "TaskWorkSessionEstablished") {
    return ManagedRunRecoveryStageEntry.cases.TaskWorkSessionEstablishmentUnresolved.make({
      operation: sessionIntent.operation
    })
  }

  const executionIntent = records.findLast(({ event }) =>
    event._tag === "TaskExecutionIntentRecorded"
    && sameAttempt(event.operation.request.plannedAttempt, plannedAttempt)
  )?.event
  if (executionIntent?._tag !== "TaskExecutionIntentRecorded") {
    return ManagedRunRecoveryStageEntry.cases.TaskExecutionNeeded.make({
      authority: "TaskExecutor",
      planOperation,
      sessionEstablishmentOperation: sessionIntent.operation,
      sessionId: sessionEstablished.outcome.sessionId
    })
  }
  const executionObserved = records.some(({ event }) =>
    event._tag === "TaskExecutionOutcomeObserved"
    && event.outcome.outcome.operationId === executionIntent.operation.request.operationId
  )
  return executionObserved
    ? ManagedRunRecoveryStageEntry.cases.ImplementationConvergencePending.make({
      planOperation
    })
    : ManagedRunRecoveryStageEntry.cases.TaskExecutionUnresolved.make({
      operation: executionIntent.operation
    })
}

/** Reduces immutable managed history into one total run-level recovery stage. */
export const deriveManagedRunRecoveryStage = (
  records: ReadonlyArray<JournalRecord>
): ManagedRunRecoveryStage => {
  const plannedStages = records.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned"
      ? [stageForAttempt(records, event.operation)]
      : []
  )
  const plannedTaskIds = new Set(
    records.flatMap(({ event }) => event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt.taskId] : [])
  )
  const unplannedClaims = records.flatMap<ManagedRunRecoveryStageEntry>(({ event }) => {
    if (
      event._tag !== "TaskClaimAcquisitionIntended"
      || plannedTaskIds.has(event.operation.acquisition.taskId)
    ) return []
    const acquired = records.some(({ event: candidate }) =>
      candidate._tag === "TaskClaimAcquired"
      && candidate.claim.operationId === event.operation.acquisition.operationId
    )
    if (!acquired) {
      return [ManagedRunRecoveryStageEntry.cases.TaskClaimAcquisitionUnresolved.make({
        operation: event.operation
      })]
    }
    const admission = records.findLast(({ event: candidate }) =>
      candidate._tag === "TrackerGraphObservationIntentRecorded"
      && candidate.operation.predecessorOperationIds.includes(event.operation.acquisition.operationId)
    )?.event
    if (admission?._tag !== "TrackerGraphObservationIntentRecorded") {
      const priorObservation = records.findLast(({ event: candidate }) =>
        candidate._tag === "TrackerGraphObservationIntentRecorded"
        && event.operation.predecessorOperationIds.includes(candidate.operation.operationId)
      )?.event
      return priorObservation?._tag === "TrackerGraphObservationIntentRecorded"
        ? [ManagedRunRecoveryStageEntry.cases.TaskEligibilityRefreshNeeded.make({
          claimOperation: event.operation,
          observationOperation: priorObservation.operation
        })]
        : []
    }
    const observed = records.some(({ event: candidate }) =>
      candidate._tag === "TrackerGraphOutcomeObserved"
      && candidate.operationId === admission.operation.operationId
    )
    return observed
      ? [ManagedRunRecoveryStageEntry.cases.TaskAttemptPlanNeeded.make({
        claimOperation: event.operation,
        observationOperation: admission.operation
      })]
      : [ManagedRunRecoveryStageEntry.cases.TaskEligibilityRefreshUnresolved.make({
        claimOperation: event.operation,
        operation: admission.operation
      })]
  })
  const claimedTaskIds = new Set(
    records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition.taskId] : []
    )
  )
  const unclaimedTasks = records.flatMap(({ event }) => {
    if (event._tag !== "TrackerGraphOutcomeObserved") return []
    const observation = records.find(({ event: candidate }) =>
      candidate._tag === "TrackerGraphObservationIntentRecorded"
      && candidate.operation.operationId === event.operationId
    )?.event
    if (observation?._tag !== "TrackerGraphObservationIntentRecorded") return []
    return event.outcome.taskIds.flatMap((taskId) =>
      claimedTaskIds.has(taskId) || plannedTaskIds.has(taskId)
        ? []
        : [ManagedRunRecoveryStageEntry.cases.TaskClaimAcquisitionNeeded.make({
          observationOperation: observation.operation,
          taskId
        })]
    )
  }).filter((entry, index, entries) =>
    entries.findLastIndex((candidate) => candidate.taskId === entry.taskId) === index
  )
  return ManagedRunRecoveryStage.make({
    entries: [...plannedStages, ...unplannedClaims, ...unclaimedTasks]
  })
}
