import { Schema } from "effect"
import { AttemptId } from "@dalph/contracts"
import { OperationId } from "../../identity.js"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { WorkflowOperation } from "../../registry/operation.js"

/** A fresh Git observation proved the exact worktree and declared Base. */
export const AuthoritativeTaskWorktreeReady = Schema.TaggedStruct("AuthoritativeTaskWorktreeReady", {
  proof: PlannedWorktreeReady
})

export const TaskWorktreeReconciliationResult = AuthoritativeTaskWorktreeReady
export type TaskWorktreeReconciliationResult = typeof TaskWorktreeReconciliationResult.Type

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
