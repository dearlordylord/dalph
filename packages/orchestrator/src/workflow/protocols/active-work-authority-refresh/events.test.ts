import { expect, it } from "vitest"
import { Schema } from "effect"
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
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { GitWorktreeReadFailure } from "../../../authorities/git/worktree.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
import { WorkflowOperation, makeTaskAttemptPlanOperation } from "../../registry/operation.js"
import { OperationId } from "../../identity.js"
import {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshGitReadFailedEvent,
  ActiveWorkAuthorityRefreshOrdinal,
  makeActiveWorkAuthorityRefreshGitReadOperation
} from "./events.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  activeWorkAuthorityRefreshGitReadFailedRecordKey,
  workflowRunBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { type JournalRecord } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import {
  ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent,
  TaskAttemptPlannedEvent,
  WorkflowRunBeganEvent
} from "../../registry/event.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"

const runId = RunId.make("active-refresh-event-run")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("active-refresh-event-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/active-refresh-event"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("active-refresh-event-task"),
  taskRevision: TaskRevision.make("active-refresh-event-revision"),
  worktree: WorktreeLocator.make("/worktrees/active-refresh-event")
})
const rawOperation = WorkflowOperation.cases.ReadTaskWorktree.make({
  operationId: OperationId.make("active-refresh-event-read"),
  plannedAttempt,
  predecessorOperationIds: []
})
const authority = ActiveWorkAuthorityRefreshAuthority.make({ attemptId: plannedAttempt.attemptId, runId })
const ordinal = ActiveWorkAuthorityRefreshOrdinal.make(1)
const operation = makeActiveWorkAuthorityRefreshGitReadOperation(rawOperation, authority, ordinal)
const failure = new GitWorktreeReadFailure({ detail: "controlled Git read failure", worktree: plannedAttempt.worktree })
const event = ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
  authority,
  failure,
  occurrenceClassification: "NonActionOccurrence",
  operation,
  ordinal,
  source: "TrackerNotification",
  version: workflowJournalEventVersion
})

const activeIntent = ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  operation,
  version: workflowJournalEventVersion
})

it("accepts an exact branded active-refresh Git failure and derives its stable key", () => {
  expect(event._tag).toBe("ActiveWorkAuthorityRefreshGitReadFailed")
  expect(describeJournalEvent(event)).toMatchObject({
    _tag: "OperationEventDescriptor",
    expectedKey: activeWorkAuthorityRefreshGitReadFailedRecordKey(rawOperation.operationId, ordinal)
  })
})

it("rejects an active-refresh Git failure whose resource does not match its operation", () => {
  expect(() =>
    Schema.decodeUnknownSync(ActiveWorkAuthorityRefreshGitReadFailedEvent)({
      ...event,
      failure: new GitWorktreeReadFailure({
        detail: "wrong worktree",
        worktree: WorktreeLocator.make("/worktrees/other")
      })
    })
  ).toThrow()
})

it("accepts the failure only after the exact Running attempt and journal-first Git intent", () => {
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("active-refresh-event-plan"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: WorkflowRunBeganEvent.make({
        initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        target: FixtureTarget.make("active-refresh-event-target"),
        version: workflowJournalEventVersion
      }),
      key: workflowRunBeganRecordKey,
      position: JournalPosition.make(1),
      runId
    },
    {
      event: TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
      key: attemptPlanRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      position: JournalPosition.make(4),
      runId
    },
    {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
      position: JournalPosition.make(5),
      runId
    },
    { event: activeIntent, key: intentRecordKey(rawOperation.operationId), position: JournalPosition.make(6), runId },
    {
      event,
      key: activeWorkAuthorityRefreshGitReadFailedRecordKey(rawOperation.operationId, ordinal),
      position: JournalPosition.make(7),
      runId
    }
  ]

  expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")

  const withoutIntent = records
    .filter(({ event: candidate }) => candidate._tag !== "ActiveWorkAuthorityRefreshGitReadIntentRecorded")
    .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
  const invalidWithoutIntent = reduceWorkflowJournalHistory(runId, withoutIntent)
  expect(invalidWithoutIntent._tag).toBe("InvalidWorkflowJournalHistory")
  if (invalidWithoutIntent._tag !== "InvalidWorkflowJournalHistory") return
  expect(invalidWithoutIntent.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        detail: `active-refresh Git failure ${rawOperation.operationId} requires its exact prior Git read intent`
      })
    ])
  )
})
