import { taskTrackerGraphFactsObserved } from "../test/task-tracker-facts.js"
import { it as effectIt } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { expect, it } from "vitest"
import { ControlCommand, ControlCommandRecordedEvent } from "./control-command.js"
import {
  AttemptId,
  AuthenticatedOperatorIdentity,
  ClaimOwner,
  ClaimToken,
  ControlCommandId,
  FixtureTarget,
  GitCommitSha,
  JournalPosition,
  JournalRecordKey,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TrackerRevision,
  WorktreeLocator
} from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import {
  attemptPlanRecordKey,
  controlCommandRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "./journal-record-key.js"
import {
  type JournalRecord,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "./journal-store.js"
import { reduceWorkflowJournalHistory } from "./workflow-journal-history.js"
import { deriveRunRecoveryFrontier } from "./run-recovery-frontier.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "./planned-attempt-executor-journal.js"
import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  PlannedAttemptExecutorReport
} from "./planned-attempt-executor.js"
import {
  reconstructedTaskIsPaused,
  WorkflowResponsibilityEntry,
  workflowResponsibilityKey,
  workflowResponsibilityOperationId
} from "./reconstructed-run-state.js"
import { reconstructRunState } from "./reconstructed-run.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  causalGraphProjection,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  WorkflowOperation
} from "./workflow-operation.js"

const runId = RunId.make("workflow-journal-history")
const taskId = TaskId.make("task-A")
const target = FixtureTarget.make("fixture-A")
const initial = makeTrackerGraphObservationOperation(OperationId.make("observe-initial"), target)
const claim = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("claim-A"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("token-A")
  },
  predecessorOperationIds: [initial.operationId]
})
const admission = makeTrackerGraphObservationOperation(
  OperationId.make("observe-admission"),
  target,
  [claim.acquisition.operationId],
  [taskId]
)
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A"),
  executor: TaskExecutorLocator.make("executor:fake"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("revision-A"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A")
})
const plan = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("plan-A"),
  plannedAttempt,
  predecessorOperationIds: [admission.operationId]
})
const worktree = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("worktree-A"),
  plannedAttempt,
  predecessorOperationIds: [plan.operationId]
})
const proof = PlannedWorktreeReady.make({
  baseSha: plannedAttempt.baseSha,
  branch: plannedAttempt.branch,
  headSha: plannedAttempt.baseSha,
  worktree: plannedAttempt.worktree
})
const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)

const eventRows = [
  { event: taskTrackerReadIntent(initial), key: intentRecordKey(initial.operationId) },
  {
    event: taskTrackerGraphFactsObserved(initial, { revision: TrackerRevision.make("tracker-1"), taskIds: [taskId] }),
    key: outcomeRecordKey(initial.operationId)
  },
  {
    event: TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion }),
    key: intentRecordKey(claim.acquisition.operationId)
  },
  {
    event: TaskClaimAcquiredEvent.make({
      claim: ActiveTaskClaim.make(claim.acquisition),
      version: workflowJournalEventVersion
    }),
    key: outcomeRecordKey(claim.acquisition.operationId)
  },
  { event: taskTrackerReadIntent(admission), key: intentRecordKey(admission.operationId) },
  {
    event: taskTrackerGraphFactsObserved(admission, { revision: TrackerRevision.make("tracker-2"), taskIds: [taskId] }),
    key: outcomeRecordKey(admission.operationId)
  },
  {
    event: TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
    key: attemptPlanRecordKey(plannedAttempt.attemptId)
  },
  {
    event: TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion }),
    key: intentRecordKey(worktree.operationId)
  },
  {
    event: TaskWorktreeReadyEvent.make({
      operationId: worktree.operationId,
      proof,
      version: workflowJournalEventVersion
    }),
    key: outcomeRecordKey(worktree.operationId)
  },
  {
    event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId)
  },
  {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkReportedRecordKey(
      plannedAttempt.attemptId,
      PlannedAttemptExecutorReportOrdinal.make(1)
    )
  },
  {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }),
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkReportedRecordKey(
      plannedAttempt.attemptId,
      PlannedAttemptExecutorReportOrdinal.make(2)
    )
  },
  {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(3),
      report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } }),
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkReportedRecordKey(
      plannedAttempt.attemptId,
      PlannedAttemptExecutorReportOrdinal.make(3)
    )
  }
] as const

const recordsFrom = (
  rows: ReadonlyArray<{ readonly event: JournalRecord["event"]; readonly key: JournalRecord["key"] }>
): ReadonlyArray<JournalRecord> =>
  rows.map((row, index) => ({ ...row, position: JournalPosition.make(index + 1), runId }))

const records = recordsFrom(eventRows)
const firstRecord = Option.getOrThrow(Option.fromUndefinedOr(records[0]))
const firstOutcomeRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[1]))
const claimOutcomeRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[3]))
const planRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[6]))
const startRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[9]))
const firstReportRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[10]))
const terminalReportRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[12]))

it("accepts every chronological workflow-journal-history boundary prefix", () => {
  for (let length = 0; length <= records.length; length += 1) {
    const reduction = reduceWorkflowJournalHistory(runId, records.slice(0, length))
    expect(reduction._tag, `prefix ${length}`).toBe("ValidWorkflowJournalHistory")
  }
  const final = reduceWorkflowJournalHistory(runId, records)
  expect(final._tag).toBe("ValidWorkflowJournalHistory")
  if (final._tag !== "ValidWorkflowJournalHistory") return
  expect(final.recoveryFrontier.entries).toContainEqual({ _tag: "Terminal", plannedAttempt })
  expect(final.runState.appliedThrough).toBe(records.length)
  expect(final.runState.graphKnowledge.taskTrackerFacts).toHaveLength(2)
})

it("describes every current journal identity", () => {
  expect(records.map(({ event }) => describeJournalEvent(event)._tag)).toEqual([
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "OperationEventDescriptor",
    "PlannedAttemptExecutorEventDescriptor",
    "PlannedAttemptExecutorEventDescriptor",
    "PlannedAttemptExecutorEventDescriptor",
    "PlannedAttemptExecutorEventDescriptor"
  ])
})

it("rejects malformed envelopes, causal links, claims, plans, and executor reports", () => {
  const otherRun = RunId.make("other-run")
  const wrongAttempt = PlannedTaskAttempt.make({
    ...plannedAttempt,
    worktree: WorktreeLocator.make("/worktrees/other")
  })
  const malformed: ReadonlyArray<ReadonlyArray<JournalRecord>> = [
    [{ ...firstRecord, position: JournalPosition.make(2) }],
    [{ ...firstRecord, runId: otherRun }],
    [{ ...firstRecord, key: JournalRecordKey.make("wrong-key") }],
    [firstRecord, { ...firstRecord, position: JournalPosition.make(2) }],
    recordsFrom([firstOutcomeRow]),
    recordsFrom([claimOutcomeRow]),
    recordsFrom([planRow]),
    recordsFrom([
      planRow,
      {
        event: TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
        key: JournalRecordKey.make("duplicate-plan-key")
      }
    ]),
    recordsFrom([
      planRow,
      {
        event: TaskAttemptPlannedEvent.make({
          operation: makeTaskAttemptPlanOperation({ ...plan, plannedAttempt: wrongAttempt }),
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("contradictory-plan-key")
      }
    ]),
    recordsFrom([startRow]),
    recordsFrom([firstReportRow]),
    recordsFrom([
      planRow,
      startRow,
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(
          plannedAttempt.attemptId,
          PlannedAttemptExecutorReportOrdinal.make(2)
        )
      }
    ]),
    recordsFrom([
      planRow,
      startRow,
      terminalReportRow,
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(4),
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(
          plannedAttempt.attemptId,
          PlannedAttemptExecutorReportOrdinal.make(4)
        )
      }
    ])
  ]
  for (const history of malformed) {
    expect(reduceWorkflowJournalHistory(runId, history)._tag).toBe("InvalidWorkflowJournalHistory")
  }
})

it("reconstructs all pause commands and responsibility identities", () => {
  const operatorId = AuthenticatedOperatorIdentity.make("operator")
  const commands = [
    ControlCommand.cases.RequestTaskPause.make({
      commandId: ControlCommandId.make("pause-task"),
      operatorId,
      runId,
      taskId
    }),
    ControlCommand.cases.RequestTaskUnpause.make({
      commandId: ControlCommandId.make("unpause-task"),
      operatorId,
      runId,
      taskId
    }),
    ControlCommand.cases.RequestRunPause.make({ commandId: ControlCommandId.make("pause-run"), operatorId, runId }),
    ControlCommand.cases.RequestRunUnpause.make({ commandId: ControlCommandId.make("unpause-run"), operatorId, runId })
  ]
  const withCommands = recordsFrom([
    ...eventRows.slice(0, 10),
    ...commands.map((command) => ({
      event: ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion }),
      key: controlCommandRecordKey(command.commandId)
    }))
  ])
  for (let length = 11; length <= withCommands.length; length += 1) {
    const reconstruction = reconstructRunState(runId, withCommands.slice(0, length))
    expect(reconstruction._tag).toBe("ValidReconstructedRun")
  }
  const pausedTask = reconstructRunState(runId, withCommands.slice(0, 11))
  expect(pausedTask._tag).toBe("ValidReconstructedRun")
  if (pausedTask._tag !== "ValidReconstructedRun") return
  expect(reconstructedTaskIsPaused(pausedTask.state.pause, taskId)).toBe(true)
  expect(reconstructedTaskIsPaused(pausedTask.state.pause, TaskId.make("another-task"))).toBe(false)
  const responsibilities = pausedTask.state.responsibility.entries
  expect(responsibilities.map(workflowResponsibilityKey)).toEqual([
    `operation:${claim.acquisition.operationId}`,
    `operation:${worktree.operationId}`,
    plannedAttemptExecutorCorrelationKey(correlation)
  ])
  const claimResponsibility = Option.getOrThrow(Option.fromUndefinedOr(responsibilities[0]))
  const worktreeResponsibility = Option.getOrThrow(Option.fromUndefinedOr(responsibilities[1]))
  if (
    claimResponsibility._tag === "PlannedAttemptExecutorWorkResponsibility" ||
    worktreeResponsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
  )
    return
  expect(workflowResponsibilityOperationId(claimResponsibility)).toBe(claim.acquisition.operationId)
  expect(workflowResponsibilityOperationId(worktreeResponsibility)).toBe(worktree.operationId)
})

it("rejects commands and executor correlations bound to another run", () => {
  const otherRun = RunId.make("wrong-owner")
  const command = ControlCommand.cases.RequestRunPause.make({
    commandId: ControlCommandId.make("wrong-run-command"),
    operatorId: AuthenticatedOperatorIdentity.make("operator"),
    runId: otherRun
  })
  const commandRecord = recordsFrom([
    {
      event: ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion }),
      key: controlCommandRecordKey(command.commandId)
    }
  ])
  const wrongExecutorAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: otherRun })
  const executorRecord = recordsFrom([
    {
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: wrongExecutorAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(wrongExecutorAttempt.attemptId)
    }
  ])
  expect(reduceWorkflowJournalHistory(runId, commandRecord)._tag).toBe("InvalidWorkflowJournalHistory")
  expect(reduceWorkflowJournalHistory(runId, executorRecord)._tag).toBe("InvalidWorkflowJournalHistory")
})

effectIt.effect("enforces responsibility and causal-operation invariants", () =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(WorkflowResponsibilityEntry)({
      _tag: "PlannedAttemptExecutorWorkResponsibility",
      beganAt: 1,
      plannedAttempt
    })
    expect(
      yield* Schema.decodeUnknownEffect(WorkflowResponsibilityEntry)({
        _tag: "TaskClaimResponsibility",
        acquisition: claim.acquisition,
        beganAt: 1,
        taskId: "different-task"
      }).pipe(Effect.result)
    ).toMatchObject({ _tag: "Failure" })

    for (const operation of [claim, plan, worktree]) {
      const operationId =
        operation._tag === "AcquireTaskClaim" ? operation.acquisition.operationId : operation.operationId
      expect(
        yield* Schema.decodeUnknownEffect(WorkflowOperation)({
          ...operation,
          predecessorOperationIds: [operationId]
        }).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" })
    }
  })
)

it("retains each canonical tracker-facts observation in journal order", () => {
  const taskB = TaskId.make("task-B")
  const taskC = TaskId.make("task-C")
  const observations = [
    makeTrackerGraphObservationOperation(OperationId.make("membership-1"), target),
    makeTrackerGraphObservationOperation(OperationId.make("membership-2"), target),
    makeTrackerGraphObservationOperation(OperationId.make("membership-3"), target),
    makeTrackerGraphObservationOperation(OperationId.make("membership-4"), target, [], [taskId, taskB, taskC]),
    makeTrackerGraphObservationOperation(
      OperationId.make("membership-other-target"),
      FixtureTarget.make("other-target")
    )
  ]
  const memberships = [[taskId], [taskB], [taskC], [taskId, taskB, taskC], [taskC]]
  const rows = observations.flatMap((operation, index) => [
    { event: taskTrackerReadIntent(operation), key: intentRecordKey(operation.operationId) },
    {
      event: taskTrackerGraphFactsObserved(operation, {
        revision: TrackerRevision.make(`membership-${index}`),
        taskIds: Option.getOrThrow(Option.fromUndefinedOr(memberships[index]))
      }),
      key: outcomeRecordKey(operation.operationId)
    }
  ])
  const reconstructed = reconstructRunState(runId, recordsFrom(rows))
  expect(reconstructed._tag).toBe("ValidReconstructedRun")
  if (reconstructed._tag !== "ValidReconstructedRun") return
  expect(reconstructed.state.graphKnowledge.taskTrackerFacts).toHaveLength(5)

  const conflicting = reconstructRunState(runId, recordsFrom(rows.slice(0, 6)))
  expect(conflicting._tag).toBe("ValidReconstructedRun")

  const orphanId = OperationId.make("orphan")
  const orphanOperation = makeTrackerGraphObservationOperation(orphanId, target)
  const orphanOutcome = reconstructRunState(
    runId,
    recordsFrom([
      {
        event: taskTrackerGraphFactsObserved(orphanOperation, {
          revision: TrackerRevision.make("orphan"),
          taskIds: []
        }),
        key: outcomeRecordKey(orphanId)
      }
    ])
  )
  expect(orphanOutcome._tag).toBe("ValidReconstructedRun")
  expect(
    deriveRunRecoveryFrontier(
      orphanOutcome._tag === "ValidReconstructedRun" ? orphanOutcome.state.workflowHistory.records : []
    ).entries
  ).toEqual([])
})

it("projects the causal operation graph in canonical code-unit order", () => {
  const duplicatePlanId = makeTaskAttemptPlanOperation({ ...plan, operationId: initial.operationId })
  expect(
    causalGraphProjection([worktree, claim, plan, initial, duplicatePlanId]).map(({ operationId }) => operationId)
  ).toEqual([
    claim.acquisition.operationId,
    initial.operationId,
    initial.operationId,
    plan.operationId,
    worktree.operationId
  ])
})

it("reports reconstructed state whose derived facts do not match their journal positions", () => {
  const malformedPositions: ReadonlyArray<JournalRecord> = [
    { ...(recordsFrom([eventRows[0]])[0] as JournalRecord), position: JournalPosition.make(10) },
    { ...(recordsFrom([eventRows[1]])[0] as JournalRecord), position: JournalPosition.make(11) },
    { ...(recordsFrom([eventRows[2]])[0] as JournalRecord), position: JournalPosition.make(12) },
    { ...(recordsFrom([eventRows[9]])[0] as JournalRecord), position: JournalPosition.make(13) }
  ]
  const reconstruction = reconstructRunState(runId, malformedPositions)
  expect(reconstruction._tag).toBe("InvalidReconstructedRun")
  if (reconstruction._tag !== "InvalidReconstructedRun") return
  expect(reconstruction.issues.map(({ _tag }) => _tag)).toEqual([
    "GraphKnowledgeHistoryMismatch",
    "ResponsibilityHistoryMismatch",
    "PlannedAttemptExecutorWorkHistoryMismatch"
  ])

  const wrongRecordAtPosition = reconstructRunState(runId, [
    { ...Option.getOrThrow(Option.fromUndefinedOr(recordsFrom([eventRows[2]])[0])), position: JournalPosition.make(2) },
    Option.getOrThrow(Option.fromUndefinedOr(recordsFrom([eventRows[1]])[0]))
  ])
  expect(wrongRecordAtPosition._tag).toBe("InvalidReconstructedRun")
})
