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
  WorktreeLocator
} from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { attemptPlanRecordKey, plannedAttemptExecutorWorkStartedRecordKey } from "./journal-record-key.js"
import { type JournalRecord, TaskAttemptPlannedEvent } from "./journal-store.js"
import { reduceWorkflowJournalHistory } from "./workflow-journal-history.js"
import { PlannedAttemptExecutorWorkStartedEvent } from "./planned-attempt-executor-journal.js"
import { makeTaskAttemptPlanOperation } from "./workflow-operation.js"

const runId = RunId.make("duplicate-attempt-run")
const taskId = TaskId.make("A")

const attempt = (attemptId: string) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(attemptId),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/${attemptId}`),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("task-A-revision"),
    worktree: WorktreeLocator.make(`/worktrees/${attemptId}`)
  })

const planAndStart = (plannedAttempt: PlannedTaskAttempt, firstPosition: number): ReadonlyArray<JournalRecord> => {
  const operation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`plan-${plannedAttempt.attemptId}`),
    plannedAttempt,
    predecessorOperationIds: []
  })
  return [
    {
      event: TaskAttemptPlannedEvent.make({ operation, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(firstPosition),
      runId
    },
    {
      event: PlannedAttemptExecutorWorkStartedEvent.make({ plannedAttempt, version: workflowJournalEventVersion }),
      key: plannedAttemptExecutorWorkStartedRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(firstPosition + 1),
      runId
    }
  ]
}

it("lower reducer identifies duplicate unfinished planned-attempt executor work", () => {
  const first = attempt("attempt-A-3")
  const second = attempt("attempt-A-4")
  const reduction = reduceWorkflowJournalHistory(runId, [...planAndStart(first, 1), ...planAndStart(second, 3)])

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({
      _tag: "DuplicateUnfinishedTaskAttemptIssue",
      first: expect.objectContaining({ attemptId: "attempt-A-3", position: 2, runId }),
      second: expect.objectContaining({ attemptId: "attempt-A-4", position: 4, runId }),
      taskId: "A"
    })
  )
})

it("rejects a second start for the same planned attempt without merging it", () => {
  const plannedAttempt = attempt("attempt-A-3")
  const records = planAndStart(plannedAttempt, 1)
  const reduction = reduceWorkflowJournalHistory(runId, [
    ...records,
    {
      event: PlannedAttemptExecutorWorkStartedEvent.make({ plannedAttempt, version: workflowJournalEventVersion }),
      key: plannedAttemptExecutorWorkStartedRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(3),
      runId
    }
  ])

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({
      _tag: "DuplicateUnfinishedTaskAttemptIssue",
      first: expect.objectContaining({ attemptId: "attempt-A-3", position: 2, runId }),
      second: expect.objectContaining({ attemptId: "attempt-A-3", position: 3, runId }),
      taskId: "A"
    })
  )
})
