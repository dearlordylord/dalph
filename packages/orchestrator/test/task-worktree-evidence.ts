import { Effect } from "effect"
import { PlannedWorktreeReady } from "../src/git-worktree.js"
import { workflowJournalEventVersion } from "../src/journal-event-version.js"
import {
  intentRecordKey,
  JournalStore,
  outcomeRecordKey,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "../src/journal-store.js"
import type { WorkflowOperation } from "../src/workflow-operation.js"

export const recordReadyWorktreeEvidence = (
  operation: typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type
) =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      operation.plannedAttempt.runId,
      intentRecordKey(operation.operationId),
      TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      operation.plannedAttempt.runId,
      outcomeRecordKey(operation.operationId),
      TaskWorktreeReadyEvent.make({
        operationId: operation.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: operation.plannedAttempt.baseSha,
          branch: operation.plannedAttempt.branch,
          headSha: operation.plannedAttempt.baseSha,
          worktree: operation.plannedAttempt.worktree
        }),
        version: workflowJournalEventVersion
      })
    )
  })
