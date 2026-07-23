import { Schema } from "effect"
import { PlannedTaskAttempt, TaskWorkSessionId } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
import { plannedTaskAttemptEquivalence } from "./planned-task-attempt.js"
import { WorkflowOperation } from "./workflow-operation.js"

/**
 * The exact next durable boundary for one acknowledged planned task attempt.
 * It is reduced from journal history and is never appended to that history.
 */
export const PlannedTaskAttemptRecoveryStage = Schema.TaggedUnion({
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
    plannedAttempt: PlannedTaskAttempt
  },
  Terminal: {
    plannedAttempt: PlannedTaskAttempt
  }
})
export type PlannedTaskAttemptRecoveryStage = typeof PlannedTaskAttemptRecoveryStage.Type

/**
 * The complete non-persisted recovery frontier for one managed run.
 * Every acknowledged planned task attempt contributes exactly one stage.
 */
export const ManagedRunRecoveryStage = Schema.Struct({
  attempts: Schema.Array(PlannedTaskAttemptRecoveryStage)
})
export type ManagedRunRecoveryStage = typeof ManagedRunRecoveryStage.Type

const sameAttempt = plannedTaskAttemptEquivalence

const stageForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  planOperation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
): PlannedTaskAttemptRecoveryStage => {
  const plannedAttempt = planOperation.plannedAttempt
  const terminal = records.some(({ event }) =>
    event._tag === "ImplementationConvergenceDispositionRecorded"
    && event.operation.request._tag === "AuthorizedImplementationConvergenceDisposition"
    && sameAttempt(event.operation.request.disposition.subject.plannedAttempt, plannedAttempt)
  )
  if (terminal) {
    return PlannedTaskAttemptRecoveryStage.cases.Terminal.make({ plannedAttempt })
  }

  const worktreeIntent = records.find(({ event }) =>
    event._tag === "TaskWorktreeReconciliationIntended"
    && sameAttempt(event.operation.plannedAttempt, plannedAttempt)
  )?.event
  if (worktreeIntent?._tag !== "TaskWorktreeReconciliationIntended") {
    return PlannedTaskAttemptRecoveryStage.cases.TaskWorktreeReconciliationNeeded.make({
      authority: "Git",
      planOperation
    })
  }
  const worktreeReady = records.some(({ event }) =>
    event._tag === "TaskWorktreeReady"
    && event.operationId === worktreeIntent.operation.operationId
  )
  if (!worktreeReady) {
    return PlannedTaskAttemptRecoveryStage.cases.TaskWorktreeReconciliationUnresolved.make({
      operation: worktreeIntent.operation
    })
  }

  const sessionIntent = records.find(({ event }) =>
    event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
    && sameAttempt(event.operation.request.plannedAttempt, plannedAttempt)
  )?.event
  if (sessionIntent?._tag !== "TaskWorkSessionEstablishmentIntentRecorded") {
    return PlannedTaskAttemptRecoveryStage.cases.TaskWorkSessionEstablishmentNeeded.make({
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
    return PlannedTaskAttemptRecoveryStage.cases.TaskWorkSessionEstablishmentUnresolved.make({
      operation: sessionIntent.operation
    })
  }

  const executionIntent = records.findLast(({ event }) =>
    event._tag === "TaskExecutionIntentRecorded"
    && sameAttempt(event.operation.request.plannedAttempt, plannedAttempt)
  )?.event
  if (executionIntent?._tag !== "TaskExecutionIntentRecorded") {
    return PlannedTaskAttemptRecoveryStage.cases.TaskExecutionNeeded.make({
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
    ? PlannedTaskAttemptRecoveryStage.cases.ImplementationConvergencePending.make({
      plannedAttempt
    })
    : PlannedTaskAttemptRecoveryStage.cases.TaskExecutionUnresolved.make({
      operation: executionIntent.operation
    })
}

/** Reduces immutable managed history into one total run-level recovery stage. */
export const deriveManagedRunRecoveryStage = (
  records: ReadonlyArray<JournalRecord>
): ManagedRunRecoveryStage =>
  ManagedRunRecoveryStage.make({
    attempts: records.flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned"
        ? [stageForAttempt(records, event.operation)]
        : []
    )
  })
