import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { attemptPlanRecordKey, TaskAttemptPlannedEvent } from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import { makeTaskAttemptPlanOperation } from "./workflow-operation.js"

const safeSegment = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)

it("gives every generated acknowledged-plan prefix exactly one derived recovery stage", () => {
  fc.assert(fc.property(safeSegment, (segment) => {
    const runId = RunId.make(`property-run-${segment}`)
    const attempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`attempt-${segment}`),
      baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
      branch: TaskBranchRef.make(`refs/heads/${segment}`),
      executor: TaskExecutorLocator.make(`executor:${segment}`),
      runId,
      session: TaskWorkSessionLocator.make(`session:${segment}`),
      taskId: TaskId.make(`task-${segment}`),
      taskRevision: TaskRevision.make(`revision-${segment}`),
      worktree: WorktreeLocator.make(`/tmp/${segment}`)
    })
    const operation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make(`plan-${segment}`),
      plannedAttempt: attempt,
      predecessorOperationIds: []
    })
    const reduction = reduceManagedHistory(runId, [{
      event: TaskAttemptPlannedEvent.make({ operation, version: 4 }),
      key: attemptPlanRecordKey(attempt.attemptId),
      position: JournalPosition.make(1),
      runId
    }])
    expect(reduction._tag).toBe("ValidManagedHistory")
    if (reduction._tag === "InvalidManagedHistory") return
    expect(reduction.recoveryStage.attempts).toHaveLength(1)
    expect(reduction.recoveryStage.attempts[0]?._tag)
      .toBe("TaskWorktreeReconciliationNeeded")
  }))
})
