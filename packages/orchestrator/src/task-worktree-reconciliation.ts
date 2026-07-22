import { Schema } from "effect"
import { AttemptId, OperationId } from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { WorkflowOperation } from "./workflow-operation.js"

/** A fresh Git observation proved the exact worktree and declared Base. */
export const AuthoritativeTaskWorktreeReady = Schema.TaggedStruct(
  "AuthoritativeTaskWorktreeReady",
  { proof: PlannedWorktreeReady }
)

/** Dry-run records the operation without reading or changing Git. */
export const TaskWorktreeReconciliationSimulated = Schema.TaggedStruct(
  "TaskWorktreeReconciliationSimulated",
  { operation: WorkflowOperation.cases.ReconcileTaskWorktree }
)

export const TaskWorktreeReconciliationResult = Schema.Union([
  AuthoritativeTaskWorktreeReady,
  TaskWorktreeReconciliationSimulated
])
export type TaskWorktreeReconciliationResult = typeof TaskWorktreeReconciliationResult.Type

/** Planning and Git reconciliation came from incompatible live/simulated interpreters. */
export class TaskWorktreeExecutionModeContradiction
  extends Schema.TaggedErrorClass<TaskWorktreeExecutionModeContradiction>()(
    "TaskWorktreeExecutionModeContradiction",
    { operationId: OperationId }
  )
{}

/** Journal history cannot prove the exact ready worktree required before agent work. */
export class TaskWorktreeHistoryContradiction extends Schema.TaggedErrorClass<TaskWorktreeHistoryContradiction>()(
  "TaskWorktreeHistoryContradiction",
  {
    attemptId: AttemptId,
    operationId: OperationId,
    reason: Schema.Literals([
      "MissingIntent",
      "MissingProof",
      "MultipleIntents",
      "MultipleProofs",
      "PlanMismatch",
      "ProofMismatch"
    ])
  }
) {}

/** Logs declared Base, observed HEAD, and the successful ancestor proof before agent work. */
export const TaskWorktreeReadyTrace = Schema.TaggedStruct("TaskWorktreeReady", {
  operation: WorkflowOperation.cases.ReconcileTaskWorktree,
  proof: PlannedWorktreeReady
})

/** Dry-run projects the planned Git operation without fabricating Git facts. */
export const TaskWorktreeReconciliationSimulatedTrace = Schema.TaggedStruct(
  "TaskWorktreeReconciliationSimulated",
  { operation: WorkflowOperation.cases.ReconcileTaskWorktree }
)
