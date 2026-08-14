import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  taskWorkCapacityPolicyRecordKey,
  workflowRunBeganRecordKey,
  workflowRunTerminatedRecordKey
} from "../../workflow-journal/record-key.js"
import { type JournalRecord } from "../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskWorkCapacityChangedEvent,
  WorkflowRunBeganEvent,
  WorkflowRunTerminatedEvent
} from "../../workflow/registry/event.js"
import { reduceWorkflowJournalHistory } from "./history.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { makeTaskAttemptPlanOperation } from "../../workflow/registry/operation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"

const runId = RunId.make("duplicate-attempt-run")
const taskId = TaskId.make("A")

it("folds nonconsecutive task-work capacity revisions into history issues", () => {
  const target = FixtureTarget.make("policy-history-target")
  const changed = TaskWorkCapacityChangedEvent.make({
    capacity: TaskWorkCapacity.make(2),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    previousRevision: RunPolicyRevision.make(1),
    revision: RunPolicyRevision.make(3),
    version: workflowJournalEventVersion
  })
  const reduction = reduceWorkflowJournalHistory(runId, [
    {
      event: WorkflowRunBeganEvent.make({
        initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        target,
        version: workflowJournalEventVersion
      }),
      key: workflowRunBeganRecordKey,
      position: JournalPosition.make(1),
      runId
    },
    { event: changed, key: taskWorkCapacityPolicyRecordKey(changed.revision), position: JournalPosition.make(2), runId }
  ])

  expect(reduction).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [expect.objectContaining({ detail: "task-work capacity revision 3 must immediately follow 1" })]
  })
})

it("rejects workflow records after Run termination", () => {
  const target = FixtureTarget.make("terminated-history-target")
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: WorkflowRunBeganEvent.make({
        initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        target,
        version: workflowJournalEventVersion
      }),
      key: workflowRunBeganRecordKey,
      position: JournalPosition.make(1),
      runId
    },
    {
      event: WorkflowRunTerminatedEvent.make({
        disposition: "Completed",
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      key: workflowRunTerminatedRecordKey,
      position: JournalPosition.make(2),
      runId
    },
    ...planAndStart(attempt("after-termination"), 3)
  ]

  const reduction = reduceWorkflowJournalHistory(runId, records)

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({
      _tag: "WorkflowJournalHistorySemanticIssue",
      detail: "WorkflowRunTerminated must be the final record",
      position: 2,
      runId
    })
  )
})

it("rejects Run termination without a prior beginning", () => {
  const reduction = reduceWorkflowJournalHistory(runId, [
    {
      event: WorkflowRunTerminatedEvent.make({
        disposition: "Completed",
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      key: workflowRunTerminatedRecordKey,
      position: JournalPosition.make(1),
      runId
    }
  ])

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({ detail: "WorkflowRunTerminated requires prior WorkflowRunBegan", position: 1, runId })
  )
})

it("rejects a Run beginning that follows workflow records", () => {
  const target = FixtureTarget.make("late-beginning-target")
  const reduction = reduceWorkflowJournalHistory(runId, [
    ...planAndStart(attempt("before-beginning"), 1),
    {
      event: WorkflowRunBeganEvent.make({
        initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        target,
        version: workflowJournalEventVersion
      }),
      key: workflowRunBeganRecordKey,
      position: JournalPosition.make(3),
      runId
    }
  ])

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({ detail: "WorkflowRunBegan must be the first record", position: 3, runId })
  )
})

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
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
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
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
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
