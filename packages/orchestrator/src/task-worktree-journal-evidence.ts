import { Effect } from "effect"
import type { OperationId, PlannedTaskAttempt } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
import { samePlannedTaskAttempt } from "./task-attempt-plan-recording.js"
import { TaskWorktreeHistoryContradiction } from "./task-worktree-reconciliation.js"

export const requireReadyWorktree = Effect.fn("WorkflowJournal.requireReadyWorktree")(
  function*(
    records: ReadonlyArray<JournalRecord>,
    plannedAttempt: PlannedTaskAttempt,
    operationId: OperationId,
    predecessorOperationIds: ReadonlyArray<OperationId>
  ) {
    const intents = records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReconciliationIntended"
        && predecessorOperationIds.includes(event.operation.operationId)
        ? [event]
        : []
    )
    const intent = intents[0]
    if (intent === undefined || intents.length !== 1) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: intents.length === 0 ? "MissingIntent" : "MultipleIntents"
      })
    }
    if (!samePlannedTaskAttempt(intent.operation.plannedAttempt, plannedAttempt)) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: "PlanMismatch"
      })
    }
    const proofs = records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReady"
        && event.operationId === intent.operation.operationId
        ? [event.proof]
        : []
    )
    const proof = proofs[0]
    if (proof === undefined || proofs.length !== 1) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: proofs.length === 0 ? "MissingProof" : "MultipleProofs"
      })
    }
    if (
      proof.baseSha !== plannedAttempt.baseSha
      || proof.branch !== plannedAttempt.branch
      || proof.worktree !== plannedAttempt.worktree
    ) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: "ProofMismatch"
      })
    }
  }
)
