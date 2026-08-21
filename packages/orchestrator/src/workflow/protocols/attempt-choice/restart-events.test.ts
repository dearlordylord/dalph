import { it } from "@effect/vitest"
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
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
import { GitTargetLineageReadFailure } from "../../../authorities/git/target-lineage.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { decodeJournalEvent, encodeJournalEvent } from "../../../workflow-journal/event-codec.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import { AttemptChoiceRequestId } from "./events.js"
import {
  AttemptRestartAuthorityReadFailedEvent,
  AttemptRestartTaskFactsReadFailure,
  PlannedAttemptReplacedEvent,
  PlannedAttemptReplacementWitness,
  restartAuthorityReadOperationMatches
} from "./replacement-events.js"
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
    witness.expectedClaim.operationId,
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

it.effect("rejects a successor plan that omits retained K1 from its causal history", () =>
  Effect.gen(function* () {
    const invalid = {
      ...event,
      successorPlan: {
        ...successorPlan,
        predecessorOperationIds: successorPlan.predecessorOperationIds.filter(
          (operationId) => operationId !== expectedClaim.operationId
        )
      }
    }
    expect(yield* Schema.decodeUnknownEffect(PlannedAttemptReplacedEvent)(invalid).pipe(Effect.flip)).toMatchObject({
      _tag: "SchemaError"
    })
  })
)

it("matches all exact Restart read-failure operations and rejects a different boundary", () => {
  const trackerTarget = FixtureTarget.make("restart-event-target")
  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/restart-event.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("restart-event-graph"),
    trackerTarget,
    [],
    [taskId]
  )
  const taskFailure = AttemptRestartTaskFactsReadFailure.make({
    detail: "tracker unreadable",
    source: "FixtureReader.FixtureReadError",
    target: trackerTarget
  })
  const worktreeOperation = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("restart-event-worktree"),
    plannedAttempt: p1,
    predecessorOperationIds: []
  })
  const worktreeFailure = new GitWorktreeReadFailure({ detail: "Git unreadable", worktree: p1.worktree })
  const targetOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make("restart-event-target-lineage"),
    plannedAttempt: p1,
    predecessorOperationIds: []
  })
  const targetFailure = new GitTargetLineageReadFailure({
    detail: "target unreadable",
    plannedBaseSha: p1.baseSha,
    target: integrationTarget
  })

  expect(restartAuthorityReadOperationMatches(graphOperation, taskFailure, subject)).toBe(true)
  expect(restartAuthorityReadOperationMatches(worktreeOperation, worktreeFailure, subject)).toBe(true)
  expect(restartAuthorityReadOperationMatches(targetOperation, targetFailure, subject)).toBe(true)
  expect(
    restartAuthorityReadOperationMatches(
      makeTaskClaimObservationOperation(OperationId.make("restart-event-claim-read"), trackerTarget, taskId),
      taskFailure,
      subject
    )
  ).toBe(false)
})

it("rejects replacement witnesses with duplicate reads and authority failures for another P1 boundary", () => {
  expect(() =>
    PlannedAttemptReplacementWitness.make({
      ...witness,
      graphObservationOperationId: witness.claimObservationOperationId
    })
  ).toThrow()

  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/restart-event-foreign-boundary.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  })
  expect(() =>
    AttemptRestartAuthorityReadFailedEvent.make({
      failure: new GitWorktreeReadFailure({ detail: "foreign worktree", worktree: p2.worktree }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: OperationId.make("restart-event-foreign-worktree-failure"),
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
  ).toThrow()

  expect(() =>
    AttemptRestartAuthorityReadFailedEvent.make({
      failure: new GitTargetLineageReadFailure({
        detail: "foreign base",
        plannedBaseSha: p2.baseSha,
        target: integrationTarget
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: OperationId.make("restart-event-foreign-lineage-failure"),
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
  ).toThrow()
})
