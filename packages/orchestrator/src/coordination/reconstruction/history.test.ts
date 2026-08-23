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
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
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
  intentRecordKey,
  outcomeRecordKey,
  runCancellationAppliedRecordKey,
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
import { workflowJournalHistoryIssueDetail } from "./history-result.js"
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
import { RunCancellationAppliedEvent } from "../../workflow/protocols/run-cancellation/events.js"
import { makeTaskAttemptPlanOperation } from "../../workflow/registry/operation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { completedRunFinalityFixture } from "../../../test/run-finality.js"
import { RunFinalityReadShape } from "../../coordination/frontier/run-finality.js"

const runId = RunId.make("duplicate-attempt-run")
const taskId = TaskId.make("A")

const completedHistory = (target: ReturnType<typeof FixtureTarget.make>): ReadonlyArray<JournalRecord> => {
  const fixture = completedRunFinalityFixture({ runId, target })
  return [
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
      event: fixture.intent,
      key: intentRecordKey(fixture.operation.operationId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: fixture.observation,
      key: outcomeRecordKey(fixture.operation.operationId),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: WorkflowRunTerminatedEvent.make({
        disposition: "Completed",
        evidence: fixture.evidence,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      key: workflowRunTerminatedRecordKey,
      position: JournalPosition.make(4),
      runId
    }
  ]
}

const historyDetailsFor = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  return reduction._tag === "InvalidWorkflowJournalHistory"
    ? reduction.issues.flatMap((issue) => ("detail" in issue ? [issue.detail] : []))
    : []
}

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
    ...completedHistory(target),
    ...planAndStart(attempt("after-termination"), 5)
  ]

  const reduction = reduceWorkflowJournalHistory(runId, records)

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({
      _tag: "WorkflowJournalHistorySemanticIssue",
      detail: "WorkflowRunTerminated must be the final record",
      position: 4,
      runId
    })
  )
})

it("reports the same terminating-record issue when an accepted terminated prefix is advanced", () => {
  const target = FixtureTarget.make("incremental-terminated-history-target")
  const terminated = completedHistory(target)
  const prior = reduceWorkflowJournalHistory(runId, terminated)
  expect(prior._tag).toBe("ValidWorkflowJournalHistory")
  if (prior._tag !== "ValidWorkflowJournalHistory") return
  const successor = planAndStart(attempt("incremental-after-termination"), 5)[0]
  expect(successor).toBeDefined()
  if (successor === undefined) return

  expect(advanceWorkflowJournalHistory(prior, successor)).toEqual(
    reduceWorkflowJournalHistory(runId, [...terminated, successor])
  )
})

it("rejects Run termination without a prior beginning", () => {
  const fixture = completedRunFinalityFixture({ runId, target: FixtureTarget.make("missing-beginning") })
  const reduction = reduceWorkflowJournalHistory(runId, [
    {
      event: WorkflowRunTerminatedEvent.make({
        disposition: "Completed",
        evidence: fixture.evidence,
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

it("rejects stale Completed evidence after durable Run cancellation", () => {
  const target = FixtureTarget.make("stale-completed-after-cancellation")
  const completed = completedHistory(target)
  const cancellation = {
    event: RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    key: runCancellationAppliedRecordKey,
    position: JournalPosition.make(4),
    runId
  }
  const staleTermination = completed[3]
  expect(staleTermination).toBeDefined()
  if (staleTermination === undefined) return
  const reduction = reduceWorkflowJournalHistory(runId, [
    ...completed.slice(0, 3),
    cancellation,
    { ...staleTermination, position: JournalPosition.make(5) }
  ])

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({
      detail: "cancellation terminal evidence must use a graph observation after RunCancellationApplied",
      position: 5,
      runId
    })
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
  const duplicate = reduction.issues.find(({ _tag }) => _tag === "DuplicateUnfinishedTaskAttemptIssue")
  if (duplicate === undefined) return
  expect(workflowJournalHistoryIssueDetail(duplicate)).toContain("task A has unfinished attempts")
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({
      _tag: "DuplicateUnfinishedTaskAttemptIssue",
      first: expect.objectContaining({ attemptId: "attempt-A-3", position: 2, runId }),
      second: expect.objectContaining({ attemptId: "attempt-A-4", position: 4, runId }),
      taskId: "A"
    })
  )
})

it("reports duplicate unfinished attempts in journal order despite HashMap key order", () => {
  const first = attempt("attempt-z")
  const second = attempt("attempt-a")
  const reduction = reduceWorkflowJournalHistory(runId, [...planAndStart(first, 1), ...planAndStart(second, 3)])

  expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
  if (reduction._tag !== "InvalidWorkflowJournalHistory") return
  expect(reduction.issues).toContainEqual(
    expect.objectContaining({
      _tag: "DuplicateUnfinishedTaskAttemptIssue",
      first: expect.objectContaining({ attemptId: "attempt-z", position: 2, runId }),
      second: expect.objectContaining({ attemptId: "attempt-a", position: 4, runId }),
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
    attemptId: AttemptId.make("executor-evidence-foreign-attempt")
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

it("covers terminal evidence validation boundaries as a table", () => {
  const target = FixtureTarget.make("terminal-validation-matrix")
  const valid = completedHistory(target)
  const terminationCandidate = valid.at(-1)
  const observationCandidate = valid[2]
  if (
    terminationCandidate?.event._tag !== "WorkflowRunTerminated" ||
    observationCandidate?.event._tag !== "TaskTrackerFactsObserved" ||
    observationCandidate.event.observation._tag !== "CompleteTaskTrackerFacts"
  ) {
    return expect.fail("completed history fixture is incomplete")
  }
  type TerminationRecord = JournalRecord & {
    readonly event: Extract<JournalRecord["event"], { readonly _tag: "WorkflowRunTerminated" }>
  }
  type CompleteObservationRecord = JournalRecord & {
    readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
      readonly observation: Extract<
        Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
        { readonly _tag: "CompleteTaskTrackerFacts" }
      >
    }
  }
  const termination = terminationCandidate as TerminationRecord
  const observationRecord = observationCandidate as CompleteObservationRecord

  type EvidenceChange = (evidence: typeof termination.event.evidence) => object
  const withEvidence = (change: EvidenceChange): ReadonlyArray<JournalRecord> => [
    ...valid.slice(0, -1),
    {
      ...termination,
      event: {
        ...termination.event,
        evidence: { ...termination.event.evidence, ...change(termination.event.evidence) }
      }
    }
  ]
  const withObservation = (change: (observation: typeof observationRecord.event.observation) => object) =>
    [
      ...valid.slice(0, 2),
      {
        ...observationRecord,
        event: {
          ...observationRecord.event,
          observation: { ...observationRecord.event.observation, ...change(observationRecord.event.observation) }
        }
      },
      termination
    ] as ReadonlyArray<JournalRecord>

  const cases: ReadonlyArray<{
    readonly name: string
    readonly records: ReadonlyArray<JournalRecord>
    readonly detail: string
  }> = [
    {
      name: "missing observed record",
      records: withEvidence(() => ({ observedAt: JournalPosition.make(99) })),
      detail: "termination evidence must name one earlier complete or unchanged tracker observation position"
    },
    {
      name: "observed record is the termination",
      records: withEvidence(() => ({ observedAt: JournalPosition.make(4) })),
      detail: "termination evidence must name one earlier complete or unchanged tracker observation position"
    },
    {
      name: "observed record is not a tracker observation",
      records: withEvidence(() => ({ observedAt: JournalPosition.make(2) })),
      detail: "termination evidence must name one earlier complete or unchanged tracker observation position"
    },
    {
      name: "unchanged observation has no earlier complete observation",
      records: withObservation(() => ({
        _tag: "UnchangedTaskTrackerFactsReconfirmed",
        priorFullObservationOperationId: OperationId.make("missing-terminal-complete")
      })),
      detail: "unchanged termination evidence must link to its earlier complete tracker observation"
    },
    {
      name: "unknown graph intent",
      records: withEvidence(() => ({ operationId: OperationId.make("missing-terminal-intent") })),
      detail: "termination evidence must name the exact complete graph-read intent"
    },
    {
      name: "graph intent read shape differs",
      records: withEvidence(() => ({
        readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [TaskId.make("root")] })
      })),
      detail: "termination evidence read shape or target does not match its graph-read intent"
    },
    {
      name: "fresh observation operation differs",
      records: withObservation(() => ({ operationId: OperationId.make("different-terminal-observation") })),
      detail: "termination evidence operation or target does not match the observed graph"
    },
    {
      name: "fresh observation coverage differs",
      records: withObservation((observation) => ({
        factFamilies: observation.factFamilies.map((family: (typeof observation.factFamilies)[number]) => ({
          ...family,
          coverage: { ...family.coverage, target: FixtureTarget.make("different-terminal-coverage") }
        }))
      })),
      detail: "termination evidence does not match the fresh observation's identity and coverage"
    },
    {
      name: "required family order differs",
      records: withEvidence(() => ({
        requiredFactFamilies: [
          "TaskLifecycles",
          "TaskLifecycles",
          "TaskPrerequisites",
          "TaskGroupings",
          "TaskTargetMembership"
        ]
      })),
      detail: "termination evidence must retain every required graph fact family in order"
    },
    {
      name: "root differs from observation",
      records: withEvidence(() => ({ rootTaskId: TaskId.make("different-terminal-root") })),
      detail: "termination evidence must retain the exact tracker-selected Run root"
    },
    {
      name: "root is absent from grouping facts",
      records: [
        ...valid.slice(0, 2),
        {
          ...observationRecord,
          event: {
            ...observationRecord.event,
            observation: {
              ...observationRecord.event.observation,
              factFamilies: observationRecord.event.observation.factFamilies.map((family, index) =>
                index === 3 ? { ...family, groupings: [] } : family
              )
            }
          }
        },
        termination
      ] as ReadonlyArray<JournalRecord>,
      detail: "termination evidence Run root must belong to the complete grouping facts"
    },
    {
      name: "graph revision differs",
      records: withObservation((observation) => ({
        factFamilies: observation.factFamilies.map((family: (typeof observation.factFamilies)[number]) => ({
          ...family,
          contentIdentity: TrackerRevision.make("different-terminal-revision")
        }))
      })),
      detail: "termination evidence revision or graph outcome is not current"
    },
    {
      name: "terminal task facts differ",
      records: withEvidence(() => ({ terminalTaskIds: [TaskId.make("root")] })),
      detail: "termination evidence terminal task facts do not match the graph"
    },
    {
      name: "dependency blockage facts differ",
      records: withEvidence(() => ({ blockedTaskIds: [TaskId.make("root")] })),
      detail: "termination evidence dependency blockage facts do not match the graph"
    },
    {
      name: "disposition precedence differs",
      records: [
        ...valid.slice(0, -1),
        { ...termination, event: { ...termination.event, disposition: "Blocked" } }
      ] as ReadonlyArray<JournalRecord>,
      detail: "termination disposition does not follow graph evidence and cancellation precedence"
    },
    {
      name: "an earlier complete observation is not latest",
      records: [
        ...valid.slice(0, -1),
        {
          ...observationRecord,
          key: JournalRecordKey.make("later-terminal-observation"),
          position: JournalPosition.make(4)
        },
        { ...termination, position: JournalPosition.make(5) }
      ],
      detail: "termination evidence must use the latest complete graph observation"
    },
    {
      name: "termination names another run",
      records: withEvidence(() => ({ runId: RunId.make("different-terminal-run") })),
      detail: "termination evidence must name the journal Run"
    },
    {
      name: "termination names another target",
      records: withEvidence(() => ({ target: FixtureTarget.make("different-terminal-target") })),
      detail: "termination evidence must name the beginning target"
    },
    {
      name: "termination evidence is incomplete",
      records: withEvidence(() => ({ complete: false })),
      detail: "termination evidence must prove complete root coverage"
    }
  ]

  for (const { detail, name, records } of cases) {
    expect(historyDetailsFor(records), name).toContain(detail)
  }

  const beginningRecord = valid[0]
  if (beginningRecord === undefined) return expect.fail("completed history fixture lacks beginning")
  const duplicateCancellation: JournalRecord = {
    ...beginningRecord,
    event: RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("terminal-validation-duplicate-cancellation"),
    position: JournalPosition.make(2)
  }
  const cancellationBeforeBeginning: JournalRecord = {
    ...beginningRecord,
    event: duplicateCancellation.event,
    key: JournalRecordKey.make("terminal-validation-cancellation-before-beginning"),
    position: JournalPosition.make(1)
  }
  expect(historyDetailsFor([cancellationBeforeBeginning, beginningRecord])).toContain(
    "RunCancellationApplied requires prior WorkflowRunBegan"
  )
  expect(
    historyDetailsFor([
      ...valid.slice(0, 3),
      { ...duplicateCancellation, position: JournalPosition.make(4) },
      {
        ...duplicateCancellation,
        position: JournalPosition.make(5),
        key: JournalRecordKey.make("terminal-validation-second-cancellation")
      }
    ])
  ).toContain("RunCancellationApplied may occur only once")
})
