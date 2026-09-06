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
import { Effect, Option, Ref, Semaphore } from "effect"
import { expect } from "vitest"
import { TaskLifecycle } from "../../authorities/task-tracker/task.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { deliveryProposalsOf } from "./delivery-proposal-derivation.js"
import { makeDeliveryRuntimeAdmissionLoop } from "./delivery-runtime-admission-loop.js"
import type { DeliveryRuntimeLiveOwnerSource } from "./delivery-runtime-observation.js"
import { makeFreshTaskCandidateFrontierForTest } from "../../../test/support/fresh-task-candidate.js"
import type { DeliveryRuntimeLocalDeferral } from "./delivery-runtime-local-deferral.js"
import type { DeliveryProposalId } from "./delivery-proposal.js"
import { makeFreshTaskAdmissionTestBasis } from "../../../test/support/fresh-task-admission.js"

const runId = RunId.make("admission-loop-test-run")
const taskId = TaskId.make("existing-task")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("existing-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/existing-task"),
  executor: TaskExecutorLocator.make("executor:admission-loop-test"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("existing-revision"),
  worktree: WorktreeLocator.make("/worktrees/existing-task")
})

it.effect("does not admit a fresh candidate after a ready existing responsibility is deferred", () =>
  Effect.gen(function* () {
    const existingTransition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
      acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
      plannedAttempt
    })
    const existing = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [],
      responsibilities: [
        { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(1), plannedAttempt }
      ],
      runId,
      transitions: [existingTransition]
    }).ticketDelivery[0]
    if (existing === undefined) return yield* Effect.die("existing responsibility proposal was not derived")

    const freshTask = {
      id: TaskId.make("fresh-task"),
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const freshOperationId = OperationId.make("fresh-current-graph")
    const candidates = makeFreshTaskCandidateFrontierForTest({
      decisions: [
        {
          step: { _tag: "AcquireTaskClaim", predecessorOperationId: freshOperationId, task: freshTask },
          transition: RunnableFrontierTransition.CommitFreshTaskClaimIntent({
            taskId: freshTask.id,
            taskRevision: taskRevisionFor(freshTask)
          })
        }
      ],
      runId
    })
    const candidate = candidates.candidates[0]
    if (candidate === undefined) return yield* Effect.die("fresh candidate was not derived")

    const evaluation = {
      acceptedAt: null,
      proposedActions: {
        _tag: "DeliveryProposalsAvailable" as const,
        freshTaskCandidateFrontier: candidates,
        freshTaskCandidates: [candidate],
        isolatedIssues: [],
        proposals: [existing]
      },
      taskWork: makeFreshTaskAdmissionTestBasis({ capacity: 1, runId })
    }
    const latest = yield* Ref.make(Option.some(evaluation))
    const localDeferrals = yield* Ref.make<ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>>(new Map())
    const owners = yield* Ref.make<ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLiveOwnerSource>>(new Map())
    const selectionGate = yield* Semaphore.make(1)
    const reserved: Array<DeliveryProposalId> = []
    const freshReserved: Array<string> = []
    let published = 0
    const admission = { synchronize: () => Effect.void }

    const loop = yield* makeDeliveryRuntimeAdmissionLoop({
      admission,
      emit: () => Effect.void,
      latest,
      localDeferrals,
      owners,
      publishRuntimeObservationInsideGate: () => Effect.sync(() => (published += 1)),
      reserveAndStart: (proposal) =>
        Effect.sync(() => {
          reserved.push(proposal.id)
          return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
        }),
      reserveFreshAndStart: (freshFrontier) =>
        Effect.sync(() => {
          freshReserved.push(...freshFrontier.candidates.map(({ taskId }) => taskId))
          return { _tag: "Started" as const, started: true }
        }),
      selectionGate
    })

    expect(yield* loop.admitPass()).toBe(false)
    expect(reserved).toEqual([existing.id])
    expect(freshReserved).toEqual([])

    const emptyFrontier = {
      _tag: "DeliveryProposalsAvailable" as const,
      isolatedIssues: [],
      freshTaskCandidates: [],
      proposals: []
    }
    const liveFrontier = { ...emptyFrontier, proposals: [existing] }
    const settledOwner = { isSettled: Effect.succeed(true), proposal: existing } as DeliveryRuntimeLiveOwnerSource
    const unsettledOwner = { isSettled: Effect.succeed(false), proposal: existing } as DeliveryRuntimeLiveOwnerSource

    yield* Ref.set(owners, new Map([[existing.id, settledOwner]]))
    yield* loop.pruneSettledOwners(emptyFrontier)
    expect(yield* Ref.get(owners)).toEqual(new Map())
    expect(published).toBe(1)

    yield* Ref.set(owners, new Map([[existing.id, unsettledOwner]]))
    yield* loop.pruneSettledOwners(emptyFrontier)
    expect(yield* Ref.get(owners)).toEqual(new Map([[existing.id, unsettledOwner]]))
    expect(published).toBe(1)

    yield* Ref.set(owners, new Map([[existing.id, settledOwner]]))
    yield* loop.pruneSettledOwners(liveFrontier)
    expect(yield* Ref.get(owners)).toEqual(new Map([[existing.id, settledOwner]]))
    expect(published).toBe(1)
  })
)
