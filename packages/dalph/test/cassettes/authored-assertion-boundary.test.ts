import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
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
import {
  describeJournalEvent,
  JournalPosition,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  TaskClaimReacquisitionDirectedEvent,
  TaskClaimReacquisitionRequestId,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import { assertAuthoredExpectedBehavior } from "../../src/cassettes/authored-outcomes.js"

it.effect("projects reacquisition and non-exact executor evidence through the authored assertion boundary", () =>
  Effect.gen(function* () {
    const runId = RunId.make("coverage-authored-outcome-run")
    const taskId = TaskId.make("coverage-authored-outcome-task")
    const requestId = TaskClaimReacquisitionRequestId.make("coverage-authored-outcome-request")
    const direction = TaskClaimReacquisitionDirectedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject: { runId, taskId },
      version: workflowJournalEventVersion
    })
    const directionAssertions = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
      orchestration: null,
      protocol: [{ _tag: "TaskClaimReacquisitionDirected", requestId, taskId }],
      taskWork: { absences: [], results: [] }
    })
    expect(
      (yield* assertAuthoredExpectedBehavior(
        [
          {
            event: direction,
            key: describeJournalEvent(direction).expectedKey,
            position: JournalPosition.make(1),
            runId
          }
        ],
        directionAssertions
      )).protocolEvidence
    ).toEqual([{ _tag: "TaskClaimReacquisitionDirected", requestId, taskId }])

    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("assertion-attempt"),
      baseSha: GitCommitSha.make("1".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/assertion-attempt"),
      executor: TaskExecutorLocator.make("executor:assertion"),
      runId,
      taskId,
      taskRevision: TaskRevision.make("assertion-revision"),
      worktree: WorktreeLocator.make("/assertion/worktree")
    })
    const unavailable = PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      observation: { _tag: "ExecutorStateNoCurrentReport" },
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
      version: workflowJournalEventVersion
    })
    const noEvidenceAssertions = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
      orchestration: [],
      protocol: null,
      taskWork: { absences: [], results: [] }
    })
    expect(
      (yield* assertAuthoredExpectedBehavior(
        [
          {
            event: unavailable,
            key: describeJournalEvent(unavailable).expectedKey,
            position: JournalPosition.make(1),
            runId
          }
        ],
        noEvidenceAssertions
      )).orchestrationEvidence
    ).toEqual([])
  })
)
