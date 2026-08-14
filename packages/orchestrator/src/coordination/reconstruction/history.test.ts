import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseContradictedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
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
import { advanceWorkflowJournalHistory, reduceWorkflowJournalHistory } from "./history.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
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

it("reports the same terminating-record issue when an accepted terminated prefix is advanced", () => {
  const target = FixtureTarget.make("incremental-terminated-history-target")
  const terminated: ReadonlyArray<JournalRecord> = [
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
    }
  ]
  const prior = reduceWorkflowJournalHistory(runId, terminated)
  expect(prior._tag).toBe("ValidWorkflowJournalHistory")
  if (prior._tag !== "ValidWorkflowJournalHistory") return
  const successor = planAndStart(attempt("incremental-after-termination"), 3)[0]
  expect(successor).toBeDefined()
  if (successor === undefined) return

  expect(advanceWorkflowJournalHistory(prior, successor)).toEqual(
    reduceWorkflowJournalHistory(runId, [...terminated, successor])
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

it("folds the executor command, projection, response, state, and report evidence table", () => {
  const plannedAttempt = attempt("executor-evidence-table")
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const foreignCorrelation = plannedAttemptExecutorCorrelation({
    ...plannedAttempt,
    runId: RunId.make("executor-evidence-foreign-run")
  })
  const command = (ordinal: number, command: "StartOrContinue" | "Suspend") => {
    const brandedOrdinal = PlannedAttemptExecutorCommandOrdinal.make(ordinal)
    return {
      event: PlannedAttemptExecutorCommandIntendedEvent.make({
        command,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: brandedOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, brandedOrdinal)
    }
  }
  const report = (ordinal: number, report: PlannedAttemptExecutorReport) => {
    const brandedOrdinal = PlannedAttemptExecutorReportOrdinal.make(ordinal)
    return {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: brandedOrdinal,
        report,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, brandedOrdinal)
    }
  }
  const projection = (
    commandOrdinal: number,
    projectionOrdinal: number,
    observation: PlannedAttemptExecutorCommandProjectionObservation
  ) => {
    const brandedCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(commandOrdinal)
    const brandedProjectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(projectionOrdinal)
    return {
      event: PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: brandedCommandOrdinal,
        observation,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal: brandedProjectionOrdinal,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorCommandProjectionObservedRecordKey(
        plannedAttempt.attemptId,
        brandedCommandOrdinal,
        brandedProjectionOrdinal
      )
    }
  }
  const state = (ordinal: number, observation: PlannedAttemptExecutorStateObservation) => {
    const brandedOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(ordinal)
    return {
      event: PlannedAttemptExecutorStateObservedEvent.make({
        observation,
        occurrenceClassification: "NonActionOccurrence",
        ordinal: brandedOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, brandedOrdinal)
    }
  }
  const responseContradiction = (commandOrdinal: number, observed: PlannedAttemptExecutorReport) => {
    const brandedOrdinal = PlannedAttemptExecutorCommandOrdinal.make(commandOrdinal)
    return {
      event: PlannedAttemptExecutorCommandResponseContradictedEvent.make({
        commandOrdinal: brandedOrdinal,
        observed,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorCommandResponseContradictedRecordKey(plannedAttempt.attemptId, brandedOrdinal)
    }
  }
  const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
  const safelySuspended = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
  const terminal = PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
  const foreignRunning = PlannedAttemptExecutorReport.cases.Running.make({ correlation: foreignCorrelation })
  const recordsFor = (
    rows: ReadonlyArray<{ readonly event: JournalRecord["event"]; readonly key: JournalRecord["key"] }>
  ) => [
    ...planAndStart(plannedAttempt, 1),
    ...rows.map((row, index) => ({ ...row, position: JournalPosition.make(index + 3), runId }))
  ]
  const histories = [
    {
      expected: "ValidWorkflowJournalHistory" as const,
      rows: [
        command(1, "StartOrContinue"),
        report(1, running),
        command(2, "Suspend"),
        report(2, safelySuspended),
        command(3, "StartOrContinue"),
        report(3, terminal)
      ]
    },
    {
      expected: "ValidWorkflowJournalHistory" as const,
      rows: [
        command(1, "StartOrContinue"),
        projection(
          1,
          1,
          PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({ report: running })
        )
      ]
    },
    {
      expected: "ValidWorkflowJournalHistory" as const,
      rows: [
        command(1, "StartOrContinue"),
        projection(
          1,
          1,
          PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorReportContradiction.make({
            observed: foreignRunning
          })
        )
      ]
    },
    {
      expected: "ValidWorkflowJournalHistory" as const,
      rows: [command(1, "StartOrContinue"), responseContradiction(1, foreignRunning)]
    },
    {
      expected: "ValidWorkflowJournalHistory" as const,
      rows: [state(1, PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({}))]
    },
    {
      expected: "InvalidWorkflowJournalHistory" as const,
      rows: [
        state(1, PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: foreignRunning }))
      ]
    },
    {
      expected: "InvalidWorkflowJournalHistory" as const,
      rows: [
        state(1, PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({ observed: running }))
      ]
    },
    {
      expected: "InvalidWorkflowJournalHistory" as const,
      rows: [command(1, "StartOrContinue"), command(1, "StartOrContinue")]
    },
    { expected: "InvalidWorkflowJournalHistory" as const, rows: [report(1, running)] }
  ]

  for (const { expected, rows } of histories) {
    expect(reduceWorkflowJournalHistory(runId, recordsFor(rows))).toMatchObject({ _tag: expected })
  }
})
