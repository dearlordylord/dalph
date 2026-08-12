import { it } from "@effect/vitest"
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
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { decodeJournalEvent, encodeJournalEvent } from "../../../workflow-journal/event-codec.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { makeTaskAttemptPlanOperation } from "../../registry/operation.js"
import { AttemptChoiceRequestId } from "./events.js"
import { PlannedAttemptReplacedEvent, PlannedAttemptReplacementWitness } from "./replacement-events.js"
import { PlannedAttemptExecutorReportOrdinal } from "../planned-attempt-executor-work/events.js"

const runId = RunId.make("restart-event-run")
const taskId = TaskId.make("restart-event-task")
const p1 = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("restart-event-P1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/restart-event-P1"),
  executor: TaskExecutorLocator.make("executor:restart-event"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("restart-event-F1"),
  worktree: WorktreeLocator.make("/worktrees/restart-event-P1")
})
const p2 = PlannedTaskAttempt.make({
  ...p1,
  attemptId: AttemptId.make("restart-event-P2"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/restart-event-P2"),
  taskRevision: TaskRevision.make("restart-event-F2"),
  worktree: WorktreeLocator.make("/worktrees/restart-event-P2")
})
const subject = { observedTaskRevision: p2.taskRevision, plannedAttempt: p1 }
const requestId = AttemptChoiceRequestId.make({ nonce: "restart-event-D1", runId })
const expectedClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("restart-event-claim"),
  owner: ClaimOwner.make("restart-event-owner"),
  taskId,
  token: ClaimToken.make("restart-event-token")
})
const witness = PlannedAttemptReplacementWitness.make({
  claimObservationOperationId: OperationId.make("restart-event-current-claim"),
  expectedClaim,
  graphObservationOperationId: OperationId.make("restart-event-current-graph"),
  oldWorktreeObservationOperationId: OperationId.make("restart-event-current-W1"),
  oldWorktreeProof: PlannedWorktreeReady.make({
    baseSha: p1.baseSha,
    branch: p1.branch,
    headSha: GitCommitSha.make("3".repeat(40)),
    worktree: p1.worktree
  }),
  quiescenceProof: { _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
  specificationObservationOperationId: OperationId.make("restart-event-current-F2"),
  targetHeadSha: p2.baseSha,
  targetLineageObservationOperationId: OperationId.make("restart-event-current-H2")
})
const successorPlan = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("restart-event-plan-P2"),
  plannedAttempt: p2,
  predecessorOperationIds: [
    witness.graphObservationOperationId,
    witness.specificationObservationOperationId,
    witness.claimObservationOperationId,
    witness.oldWorktreeObservationOperationId,
    witness.targetLineageObservationOperationId
  ]
})

const event = PlannedAttemptReplacedEvent.make({
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  requestId,
  subject,
  successorPlan,
  version: workflowJournalEventVersion,
  witness
})

it.effect("round-trips the one atomic P1-to-P2 replacement event", () =>
  Effect.gen(function* () {
    expect(yield* decodeJournalEvent(encodeJournalEvent(event))).toEqual(event)
  })
)

it.effect("rejects a successor that reuses P1 resources or is not based at recorded H2", () =>
  Effect.gen(function* () {
    for (const plannedAttempt of [
      { ...p2, attemptId: p1.attemptId },
      { ...p2, branch: p1.branch },
      { ...p2, worktree: p1.worktree },
      { ...p2, baseSha: GitCommitSha.make("4".repeat(40)) }
    ]) {
      const invalid = { ...event, successorPlan: { ...successorPlan, plannedAttempt } }
      expect(yield* Schema.decodeUnknownEffect(PlannedAttemptReplacedEvent)(invalid).pipe(Effect.flip)).toMatchObject({
        _tag: "SchemaError"
      })
    }
  })
)
