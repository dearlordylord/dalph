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
import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import { TaskLifecycle } from "../../authorities/task-tracker/task.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { makeFreshTaskCandidateFrontierForTest } from "../../../test/support/fresh-task-candidate.js"
import { deliveryProposalsOf } from "./delivery-proposal-derivation.js"
import { deliveryProposalFrontierOf } from "./relations.js"
import { DeliveryRuntimeProposalOwnershipConflict } from "./delivery-runtime-admission-loop.js"
import {
  DeliveryRuntimeAdmissionProgressContradiction,
  runDeliveryRuntimeAdmissionSweep
} from "./delivery-runtime-admission-sweep.js"

const runId = RunId.make("admission-sweep-test-run")
const taskId = TaskId.make("existing-task")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("existing-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/existing-task"),
  executor: TaskExecutorLocator.make("executor:admission-sweep-test"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("existing-revision"),
  worktree: WorktreeLocator.make("/worktrees/existing-task")
})
const proposal = Option.getOrThrow(
  Option.fromUndefinedOr(
    deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [],
      responsibilities: [
        { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(1), plannedAttempt }
      ],
      runId,
      transitions: [
        RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
          acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
          plannedAttempt
        })
      ]
    }).ticketDelivery[0]
  )
)
const freshTask = {
  id: TaskId.make("fresh-task"),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const freshTaskCandidateFrontier = makeFreshTaskCandidateFrontierForTest({
  decisions: [
    {
      step: {
        _tag: "AcquireTaskClaim",
        predecessorOperationId: OperationId.make("fresh-current-graph"),
        task: freshTask
      },
      transition: RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId: freshTask.id,
        taskRevision: taskRevisionFor(freshTask)
      })
    }
  ],
  runId
})
const freshTaskCandidate = Option.getOrThrow(Option.fromUndefinedOr(freshTaskCandidateFrontier.candidates[0]))
const availableFrontier = deliveryProposalFrontierOf([[proposal]], [], [freshTaskCandidate], freshTaskCandidateFrontier)
const ownershipConflictFrontier = deliveryProposalFrontierOf([[proposal], [proposal]])

it.effect("checks an empty frontier once and stops", () =>
  Effect.gen(function* () {
    let passes = 0
    yield* runDeliveryRuntimeAdmissionSweep(deliveryProposalFrontierOf([]), () =>
      Effect.sync(() => {
        passes += 1
        return false
      })
    )
    expect(passes).toBe(1)
  })
)

it.effect("completes the ordinary-plus-fresh fixed frontier", () =>
  Effect.gen(function* () {
    let passes = 0
    let successfulStarts = 0
    yield* runDeliveryRuntimeAdmissionSweep(availableFrontier, () =>
      Effect.sync(() => {
        passes += 1
        if (successfulStarts === 2) return false
        successfulStarts += 1
        return true
      })
    )
    expect(successfulStarts).toBe(2)
    expect(passes).toBe(3)
  })
)

it.effect("fails a non-progressing admission result at the fixed frontier bound", () =>
  Effect.gen(function* () {
    let passes = 0
    const failure = yield* Effect.flip(
      runDeliveryRuntimeAdmissionSweep(availableFrontier, () =>
        Effect.sync(() => {
          passes += 1
          return true
        })
      )
    )
    expect(failure).toBeInstanceOf(DeliveryRuntimeAdmissionProgressContradiction)
    expect(failure).toMatchObject({ maximumSuccessfulStarts: 2, successfulStarts: 3 })
    expect(passes).toBe(3)
  })
)

it.effect("executes one ownership-conflict pass so its typed error remains observable", () =>
  Effect.gen(function* () {
    let passes = 0
    const conflict = new DeliveryRuntimeProposalOwnershipConflict({ proposalIds: [proposal.id] })
    const failure = yield* Effect.flip(
      runDeliveryRuntimeAdmissionSweep(ownershipConflictFrontier, () => {
        passes += 1
        return Effect.fail(conflict)
      })
    )
    expect(failure).toBe(conflict)
    expect(passes).toBe(1)
  })
)
