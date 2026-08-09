import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { it as effectIt } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { ConflictingWorktreeRegistration, PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  controlDirectionAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  taskClaimReacquisitionDirectedRecordKey
} from "../../workflow-journal/record-key.js"
import { type JournalRecord } from "../../workflow-journal/store.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TargetLineageObservedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { reduceWorkflowJournalHistory } from "./history.js"
import { deriveRunRecoveryFrontier } from "../frontier/recovery-frontier.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  reconstructedTaskIsPaused,
  WorkflowResponsibilityEntry,
  workflowResponsibilityKey,
  workflowResponsibilityOperationId
} from "./state.js"
import { reconstructRunState } from "./reduce.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
import {
  causalGraphProjection,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  WorkflowOperation
} from "../../workflow/registry/operation.js"
import { AttemptWorktreeLost } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import {
  ControlDirectionAppliedEvent,
  ControlDirectionApplicationOrdinal
} from "../../workflow/protocols/control-direction-application/events.js"
import {
  TaskClaimReacquisitionDirectedEvent,
  TaskClaimReacquisitionRequestId
} from "../../workflow/protocols/task-claim-reacquisition/events.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"

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
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(
      plannedAttempt.attemptId,
      PlannedAttemptExecutorCommandOrdinal.make(1)
    )
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
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(2),
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(
      plannedAttempt.attemptId,
      PlannedAttemptExecutorCommandOrdinal.make(2)
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
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(3),
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(
      plannedAttempt.attemptId,
      PlannedAttemptExecutorCommandOrdinal.make(3)
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
const firstCommandRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[10]))
const firstReportRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[11]))
const terminalReportRow = Option.getOrThrow(Option.fromUndefinedOr(eventRows[15]))

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

it("rejects Git outcomes that do not match the exact read intent and planned attempt", () => {
  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/history-target.git"),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })
  const worktreeRead = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("history-worktree-read"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const targetRead = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make("history-target-lineage-read"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const otherAttempt = PlannedTaskAttempt.make({
    ...plannedAttempt,
    attemptId: AttemptId.make("attempt-B"),
    baseSha: GitCommitSha.make("2".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/attempt-B"),
    worktree: WorktreeLocator.make("/worktrees/attempt-B")
  })
  const worktreeOutcome = PlannedAttemptWorktreeObservedEvent.make({
    observation: AttemptWorktreeLost.make({ plannedAttempt }),
    occurrenceClassification: "NonActionOccurrence",
    operationId: targetRead.operationId,
    version: workflowJournalEventVersion
  })
  const mismatchedWorktreeOutcomes = [
    PlannedAttemptWorktreeObservedEvent.make({
      observation: PlannedWorktreeReady.make({
        baseSha: otherAttempt.baseSha,
        branch: otherAttempt.branch,
        headSha: otherAttempt.baseSha,
        worktree: otherAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: worktreeRead.operationId,
      version: workflowJournalEventVersion
    }),
    PlannedAttemptWorktreeObservedEvent.make({
      observation: AttemptWorktreeLost.make({ plannedAttempt: otherAttempt }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: worktreeRead.operationId,
      version: workflowJournalEventVersion
    }),
    PlannedAttemptWorktreeObservedEvent.make({
      observation: new ConflictingWorktreeRegistration({
        observedBranch: otherAttempt.branch,
        observedHead: otherAttempt.baseSha,
        plannedBranch: otherAttempt.branch,
        worktree: otherAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: worktreeRead.operationId,
      version: workflowJournalEventVersion
    })
  ] as const
  const lineageOutcome = (operationId: OperationId, outcomeAttempt: PlannedTaskAttempt) =>
    TargetLineageObservedEvent.make({
      observation: {
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: outcomeAttempt.baseSha,
        targetHeadSha: GitCommitSha.make("3".repeat(40))
      },
      occurrenceClassification: "NonActionOccurrence",
      operationId,
      plannedAttempt: outcomeAttempt,
      version: workflowJournalEventVersion
    })
  const intent = (operation: typeof worktreeRead | typeof targetRead) => ({
    event: GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation,
      version: workflowJournalEventVersion
    }),
    key: intentRecordKey(operation.operationId)
  })
  const outcome = (event: typeof worktreeOutcome | ReturnType<typeof lineageOutcome>) => ({
    event,
    key: outcomeRecordKey(event.operationId)
  })

  for (const history of [
    recordsFrom([intent(targetRead), outcome(worktreeOutcome)]),
    recordsFrom([intent(worktreeRead), outcome(lineageOutcome(worktreeRead.operationId, plannedAttempt))]),
    recordsFrom([intent(targetRead), outcome(lineageOutcome(targetRead.operationId, otherAttempt))]),
    ...mismatchedWorktreeOutcomes.map((event) => recordsFrom([intent(worktreeRead), outcome(event)]))
  ]) {
    expect(reduceWorkflowJournalHistory(runId, history)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: [expect.objectContaining({ detail: expect.stringContaining("requires its exact prior") })]
    })
  }
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
    "PlannedAttemptExecutorEventDescriptor",
    "PlannedAttemptExecutorEventDescriptor",
    "PlannedAttemptExecutorEventDescriptor",
    "PlannedAttemptExecutorEventDescriptor"
  ])
})

it("rejects an executor response without an exact outstanding command intent", () => {
  const reduction = reduceWorkflowJournalHistory(runId, recordsFrom([planRow, startRow, firstReportRow]))

  expect(reduction).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining("has no outstanding command intent") })
    ])
  })
})

it("rejects a generic executor-state observation while an exact command remains unmatched", () => {
  const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
  const reduction = reduceWorkflowJournalHistory(
    runId,
    recordsFrom([
      planRow,
      startRow,
      firstCommandRow,
      {
        event: PlannedAttemptExecutorStateObservedEvent.make({
          observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
            report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
          }),
          occurrenceClassification: "NonActionOccurrence",
          ordinal: observationOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal)
      }
    ])
  )

  expect(reduction).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining("bypasses its unmatched command intent") })
    ])
  })
})

it("rejects more than three settled executor commands in one safe-suspension epoch", () => {
  for (const command of ["StartOrContinue", "Suspend"] as const) {
    const commandAndReports = Array.from({ length: 4 }, (_, index) => {
      const ordinal = index + 1
      const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(ordinal)
      const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(ordinal)
      return [
        {
          event: PlannedAttemptExecutorCommandIntendedEvent.make({
            command,
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: commandOrdinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          }),
          key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal)
        },
        {
          event: PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: reportOrdinal,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
            version: workflowJournalEventVersion
          }),
          key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal)
        }
      ] as const
    }).flat()
    const reduction = reduceWorkflowJournalHistory(
      runId,
      recordsFrom([...eventRows.slice(0, 10), ...commandAndReports])
    )

    expect(reduction).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining(`exceeds durable limit 3`) })
      ])
    })
  }
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

it("reconstructs all applied pause directions and responsibility identities", () => {
  const directions = [
    { direction: "Pause", subject: { _tag: "Task", runId, taskId } },
    { direction: "Unpause", subject: { _tag: "Task", runId, taskId } },
    { direction: "Pause", subject: { _tag: "Run", runId } },
    { direction: "Unpause", subject: { _tag: "Run", runId } }
  ] as const
  const withDirections = recordsFrom([
    ...eventRows.slice(0, 10),
    ...directions.map((direction, index) => ({
      event: ControlDirectionAppliedEvent.make({
        ...direction,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(index + 1),
        version: workflowJournalEventVersion
      }),
      key: controlDirectionAppliedRecordKey(ControlDirectionApplicationOrdinal.make(index + 1))
    }))
  ])
  for (let length = 11; length <= withDirections.length; length += 1) {
    const reconstruction = reconstructRunState(runId, withDirections.slice(0, length))
    expect(reconstruction._tag).toBe("ValidReconstructedRun")
  }
  const pausedTask = reconstructRunState(runId, withDirections.slice(0, 11))
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

it("requires a prior matching applied Operator direction for a reacquisition intent", () => {
  const requestId = TaskClaimReacquisitionRequestId.make("history-reacquisition-request")
  const direction = TaskClaimReacquisitionDirectedEvent.make({
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    requestId,
    subject: { runId, taskId },
    version: workflowJournalEventVersion
  })
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: taskClaimReacquisitionOperationId(requestId),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("history-replacement-token")
    },
    authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId },
    predecessorOperationIds: []
  })
  const intent = {
    event: TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
    key: intentRecordKey(operation.acquisition.operationId)
  } as const
  const lossRead = makeTaskClaimObservationOperation(OperationId.make("history-loss-read"), target, taskId, [
    claim.acquisition.operationId
  ])
  const lossRows = [
    ...eventRows.slice(0, 4),
    { event: taskTrackerReadIntent(lossRead), key: intentRecordKey(lossRead.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        lossRead.operationId,
        makeFocusedTaskClaimFactsObserved(lossRead, UnclaimedTask.make({ taskId }))
      ),
      key: outcomeRecordKey(lossRead.operationId)
    }
  ] as const

  const authorized = recordsFrom([
    ...lossRows,
    { event: direction, key: taskClaimReacquisitionDirectedRecordKey(requestId) },
    intent
  ])
  const foreignRunDirection = TaskClaimReacquisitionDirectedEvent.make({
    ...direction,
    subject: { runId: RunId.make("another-run"), taskId }
  })
  const crossRunDirection = recordsFrom([
    ...lossRows,
    { event: foreignRunDirection, key: taskClaimReacquisitionDirectedRecordKey(requestId) }
  ])
  const unauthorized = recordsFrom([...lossRows, intent])
  const staleIdentityOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      ...operation.acquisition,
      operationId: claim.acquisition.operationId,
      token: claim.acquisition.token
    },
    authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId },
    predecessorOperationIds: []
  })
  const staleIdentity = recordsFrom([
    ...lossRows,
    { event: direction, key: taskClaimReacquisitionDirectedRecordKey(requestId) },
    {
      event: TaskClaimAcquisitionIntendedEvent.make({
        operation: staleIdentityOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(staleIdentityOperation.acquisition.operationId)
    }
  ])
  const prefixCollision = makeTaskClaimAcquisitionOperation({
    acquisition: {
      ...operation.acquisition,
      operationId: OperationId.make("task-claim-reacquisition:not-a-direction")
    },
    predecessorOperationIds: []
  })
  const exactRead = makeTaskClaimObservationOperation(OperationId.make("history-exact-read"), target, taskId)
  const laterLossRead = makeTaskClaimObservationOperation(OperationId.make("history-later-loss-read"), target, taskId)
  const staleDirectionRows = (observation: JournalRecord["event"]) =>
    recordsFrom([
      ...eventRows.slice(0, 4),
      { event: taskTrackerReadIntent(exactRead), key: intentRecordKey(exactRead.operationId) },
      { event: observation, key: outcomeRecordKey(exactRead.operationId) },
      { event: direction, key: taskClaimReacquisitionDirectedRecordKey(requestId) },
      { event: taskTrackerReadIntent(laterLossRead), key: intentRecordKey(laterLossRead.operationId) },
      {
        event: taskTrackerFactsObservedEvent(
          laterLossRead.operationId,
          makeFocusedTaskClaimFactsObserved(laterLossRead, UnclaimedTask.make({ taskId }))
        ),
        key: outcomeRecordKey(laterLossRead.operationId)
      },
      intent
    ])
  const restoredThenLost = recordsFrom([
    ...lossRows,
    { event: direction, key: taskClaimReacquisitionDirectedRecordKey(requestId) },
    { event: taskTrackerReadIntent(exactRead), key: intentRecordKey(exactRead.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        exactRead.operationId,
        makeFocusedTaskClaimFactsObserved(exactRead, ActiveTaskClaim.make(claim.acquisition))
      ),
      key: outcomeRecordKey(exactRead.operationId)
    },
    { event: taskTrackerReadIntent(laterLossRead), key: intentRecordKey(laterLossRead.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        laterLossRead.operationId,
        makeFocusedTaskClaimFactsObserved(laterLossRead, UnclaimedTask.make({ taskId }))
      ),
      key: outcomeRecordKey(laterLossRead.operationId)
    },
    intent
  ])
  const restoredClaimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("history-restored-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("history-restored-token")
    },
    predecessorOperationIds: [lossRead.operationId]
  })
  const acquiredThenLost = recordsFrom([
    ...lossRows,
    {
      event: TaskClaimAcquisitionIntendedEvent.make({
        operation: restoredClaimOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(restoredClaimOperation.acquisition.operationId)
    },
    {
      event: TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(restoredClaimOperation.acquisition),
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(restoredClaimOperation.acquisition.operationId)
    },
    { event: direction, key: taskClaimReacquisitionDirectedRecordKey(requestId) },
    { event: taskTrackerReadIntent(laterLossRead), key: intentRecordKey(laterLossRead.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        laterLossRead.operationId,
        makeFocusedTaskClaimFactsObserved(laterLossRead, UnclaimedTask.make({ taskId }))
      ),
      key: outcomeRecordKey(laterLossRead.operationId)
    },
    intent
  ])
  const acquiredAfterCommand = recordsFrom([
    ...lossRows,
    { event: direction, key: taskClaimReacquisitionDirectedRecordKey(requestId) },
    {
      event: TaskClaimAcquisitionIntendedEvent.make({
        operation: restoredClaimOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(restoredClaimOperation.acquisition.operationId)
    },
    {
      event: TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(restoredClaimOperation.acquisition),
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(restoredClaimOperation.acquisition.operationId)
    },
    intent
  ])
  const foreignClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("history-foreign-claim"),
    owner: ClaimOwner.make("foreign-owner"),
    taskId,
    token: ClaimToken.make("history-foreign-token")
  })
  const foreignRead = makeTaskClaimObservationOperation(OperationId.make("history-foreign-read"), target, taskId)
  const foreignConfirmation = makeTaskClaimObservationOperation(
    OperationId.make("history-foreign-confirmation"),
    target,
    taskId
  )
  const confirmedForeignEpisode = recordsFrom([
    ...eventRows.slice(0, 4),
    { event: taskTrackerReadIntent(foreignRead), key: intentRecordKey(foreignRead.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        foreignRead.operationId,
        makeFocusedTaskClaimFactsObserved(foreignRead, foreignClaim)
      ),
      key: outcomeRecordKey(foreignRead.operationId)
    },
    { event: direction, key: taskClaimReacquisitionDirectedRecordKey(requestId) },
    { event: taskTrackerReadIntent(foreignConfirmation), key: intentRecordKey(foreignConfirmation.operationId) },
    {
      event: taskTrackerFactsObservedEvent(
        foreignConfirmation.operationId,
        makeFocusedTaskClaimFactsObserved(foreignConfirmation, foreignClaim)
      ),
      key: outcomeRecordKey(foreignConfirmation.operationId)
    },
    intent
  ])

  expect(reduceWorkflowJournalHistory(runId, authorized)._tag).toBe("ValidWorkflowJournalHistory")
  expect(reduceWorkflowJournalHistory(runId, crossRunDirection)).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [expect.objectContaining({ detail: expect.stringContaining("binds run another-run") })]
  })
  expect(reduceWorkflowJournalHistory(runId, unauthorized)).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [
      expect.objectContaining({
        detail: `task-claim reacquisition ${operation.acquisition.operationId} has no prior matching applied Operator direction`
      })
    ]
  })
  expect(reduceWorkflowJournalHistory(runId, staleIdentity)._tag).toBe("InvalidWorkflowJournalHistory")
  expect(
    reduceWorkflowJournalHistory(
      runId,
      staleDirectionRows(
        taskTrackerFactsObservedEvent(
          exactRead.operationId,
          makeFocusedTaskClaimFactsObserved(exactRead, ActiveTaskClaim.make(claim.acquisition))
        )
      )
    )
  ).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [
      expect.objectContaining({ detail: expect.stringContaining("has no prior matching applied Operator direction") })
    ]
  })
  expect(reduceWorkflowJournalHistory(runId, restoredThenLost)).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [
      expect.objectContaining({ detail: expect.stringContaining("has no prior matching applied Operator direction") })
    ]
  })
  expect(reduceWorkflowJournalHistory(runId, acquiredThenLost)).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [
      expect.objectContaining({ detail: expect.stringContaining("has no prior matching applied Operator direction") })
    ]
  })
  expect(
    latestTaskClaimReacquisitionDirection(
      acquiredThenLost,
      runId,
      taskId,
      ActiveTaskClaim.make(restoredClaimOperation.acquisition),
      acquiredThenLost.at(-1)?.position ?? JournalPosition.make(0)
    )
  ).toBeUndefined()
  const exactRejection = recordsFrom([
    {
      event: TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion }),
      key: intentRecordKey(claim.acquisition.operationId)
    },
    {
      event: TaskClaimAcquisitionRejectedEvent.make({
        observed: ActiveTaskClaim.make(claim.acquisition),
        operationId: claim.acquisition.operationId,
        reason: "ForeignClaim",
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(claim.acquisition.operationId)
    }
  ])
  expect(reduceWorkflowJournalHistory(runId, exactRejection)).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining("does not prove a foreign claim") })
    ])
  })
  expect(reduceWorkflowJournalHistory(runId, acquiredAfterCommand)).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [
      expect.objectContaining({ detail: expect.stringContaining("has no prior matching applied Operator direction") })
    ]
  })
  expect(reduceWorkflowJournalHistory(runId, confirmedForeignEpisode)._tag).toBe("ValidWorkflowJournalHistory")
  expect(
    latestTaskClaimReacquisitionDirection(
      acquiredAfterCommand,
      runId,
      taskId,
      ActiveTaskClaim.make(restoredClaimOperation.acquisition),
      acquiredAfterCommand.at(-1)?.position ?? JournalPosition.make(0)
    )
  ).toBeUndefined()
  expect(
    reduceWorkflowJournalHistory(
      runId,
      staleDirectionRows(
        taskTrackerFactsObservedEvent(exactRead.operationId, makeFocusedTaskClaimFactsUnreadable(exactRead))
      )
    )
  ).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: [
      expect.objectContaining({ detail: expect.stringContaining("has no prior matching applied Operator direction") })
    ]
  })
  expect(
    reduceWorkflowJournalHistory(
      runId,
      recordsFrom([
        {
          event: TaskClaimAcquisitionIntendedEvent.make({
            operation: prefixCollision,
            version: workflowJournalEventVersion
          }),
          key: intentRecordKey(prefixCollision.acquisition.operationId)
        }
      ])
    )._tag
  ).toBe("ValidWorkflowJournalHistory")
})

it("rejects applied directions and executor correlations bound to another run", () => {
  const otherRun = RunId.make("wrong-owner")
  const ordinal = ControlDirectionApplicationOrdinal.make(1)
  const direction = ControlDirectionAppliedEvent.make({
    direction: "Pause",
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    ordinal,
    subject: { _tag: "Run", runId: otherRun },
    version: workflowJournalEventVersion
  })
  const directionRecord = recordsFrom([{ event: direction, key: controlDirectionAppliedRecordKey(ordinal) }])
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
  expect(reduceWorkflowJournalHistory(runId, directionRecord)._tag).toBe("InvalidWorkflowJournalHistory")
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
