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
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect, Exit, Option } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { makeTaskClaimAcquisitionOperation } from "../../workflow/registry/operation.js"
import { FreshWorkflowStep } from "../delivery/fresh-workflow-step.js"
import { makeFreshTaskCandidateFrontierForTest } from "../../../test/support/fresh-task-candidate.js"
import {
  makeFreshTaskAdmissionsProjectionForTest,
  projectFreshTaskAdmissionForTest
} from "../../../test/support/fresh-task-admission.js"
import { TaskWorkCapacity } from "./capacity.js"
import {
  makeFreshTaskAdmissionBasis,
  FreshTaskAdmissionCommitmentAuthorityInvalid,
  FreshTaskAdmissionBasisInvalid,
  FreshTaskAdmissionBasisRunMismatch,
  type FreshTaskAdmissionProjection,
  FreshTaskAdmissionReleaseAuthorityInvalid,
  isFreshTaskAdmissionBasis,
  projectFreshTaskAdmission,
  sameFreshTaskCommitment,
  TaskAdmissionOccupancy,
  taskAdmissionOccupancyExecutorCorrelation
} from "./fresh-task-admission.js"

const runId = RunId.make("fresh-admission-domain-run")
const taskA = TaskId.make("A")

const candidateFor = (taskId: TaskId) => {
  const task = { id: taskId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
  const predecessorOperationId = OperationId.make(`graph:${taskId}`)
  const frontier = makeFreshTaskCandidateFrontierForTest({
    decisions: [
      {
        step: FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId, task }),
        transition: RunnableFrontierTransition.CommitFreshTaskClaimIntent({
          taskId,
          taskRevision: taskRevisionFor(task)
        })
      }
    ],
    runId
  })
  return Option.getOrThrow(Option.fromUndefinedOr(frontier.candidates[0]))
}

const projectionFor = (taskIds: ReadonlyArray<TaskId>) =>
  makeFreshTaskAdmissionsProjectionForTest(
    taskIds.map((taskId) => ({ operationId: OperationId.make(`claim:${taskId}`), taskId })),
    runId
  )

const plannedAttemptFor = (taskId: TaskId, ordinal: string): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt:${taskId}:${ordinal}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/attempt-${taskId}-${ordinal}`),
    executor: TaskExecutorLocator.make("executor:controlled"),
    runId,
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}:${ordinal}`),
    worktree: WorktreeLocator.make(`/worktrees/attempt-${taskId}-${ordinal}`)
  })

it("detaches and deeply freezes the exact claim operation carried by a commitment", () => {
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("immutable-commitment-claim"),
      owner: ClaimOwner.make("dalph:immutable-commitment"),
      taskId: taskA,
      token: ClaimToken.make("immutable-commitment-token")
    },
    predecessorOperationIds: []
  })
  const projection = projectFreshTaskAdmissionForTest(runId, [operation])
  const commitment = Option.getOrThrow(Option.fromUndefinedOr(projection.commitments[0]?.commitment))

  expect(commitment.operation).not.toBe(operation)
  expect(() => {
    ;(commitment.operation.acquisition as { taskId: TaskId }).taskId = TaskId.make("B")
  }).toThrow()
  expect(commitment.operation.acquisition.taskId).toBe(taskA)
})

it.effect("returns an immutable admission basis whose capacity and occupancy cannot drift after validation", () =>
  Effect.gen(function* () {
    const projection = projectionFor([taskA])
    const basis = yield* makeFreshTaskAdmissionBasis({
      acceptedAt: projection.acceptedAt,
      capacity: TaskWorkCapacity.make(1),
      entries: [],
      projection,
      runId
    })

    expect(() => {
      ;(basis as { capacity: TaskWorkCapacity }).capacity = TaskWorkCapacity.make(2)
    }).toThrow()
    expect("set" in basis.occupied).toBe(false)
    expect(basis.capacity).toBe(1)
    expect([...basis.occupied.keys()]).toEqual([taskA])
  })
)

it.effect("does not recognize a frozen structural copy as an issued admission basis", () =>
  Effect.gen(function* () {
    const basis = yield* makeFreshTaskAdmissionBasis({ capacity: TaskWorkCapacity.make(1), entries: [], runId })

    expect(isFreshTaskAdmissionBasis(basis)).toBe(true)
    expect(isFreshTaskAdmissionBasis(Object.freeze({ ...basis }))).toBe(false)
  })
)

it("does not accept a structural commitment copy as canonical identity", () => {
  const commitment = projectionFor([taskA]).commitments[0]?.commitment
  if (commitment === undefined) return expect.fail("canonical test commitment missing")

  expect(sameFreshTaskCommitment(commitment, commitment)).toBe(true)
  expect(sameFreshTaskCommitment(commitment, Object.freeze({ ...commitment }))).toBe(false)
})

it.effect("rejects a cast durable commitment when no canonical Journal projection supplied it", () =>
  Effect.gen(function* () {
    const commitment = projectionFor([taskA]).commitments[0]
    if (commitment === undefined) return yield* Effect.die("canonical test commitment missing")
    const invalid = yield* makeFreshTaskAdmissionBasis({
      capacity: TaskWorkCapacity.make(1),
      // @ts-expect-error Exercise the runtime guard retained for untyped callers and hostile casts.
      entries: [commitment],
      runId
    }).pipe(Effect.flip)

    expect(invalid).toBeInstanceOf(FreshTaskAdmissionCommitmentAuthorityInvalid)
    expect(invalid).toMatchObject({ taskIds: [taskA] })
  })
)

it.effect("deeply snapshots held-correlation evidence", () =>
  Effect.gen(function* () {
    const attempt = plannedAttemptFor(taskA, "immutable-evidence")
    const basis = yield* makeFreshTaskAdmissionBasis({
      capacity: TaskWorkCapacity.make(1),
      entries: [TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: attempt })],
      runId
    })
    const held = basis.held[0]
    if (held === undefined) return yield* Effect.die("exact immutable held evidence missing")

    expect(held.correlation).not.toBe(plannedAttemptExecutorCorrelation(attempt))
    expect(Object.isFrozen(held.correlation)).toBe(true)
    expect(() => {
      ;(held.correlation as { attemptId: AttemptId }).attemptId = AttemptId.make("forged-attempt")
    }).toThrow()
    expect("set" in basis.releaseEvidence).toBe(false)
  })
)

it.effect("constructs one closed occupancy map across entry, commitment, responsibility, and held-attempt states", () =>
  Effect.gen(function* () {
    const projection = projectionFor([TaskId.make("B")])
    const basis = yield* makeFreshTaskAdmissionBasis({
      acceptedAt: projection.acceptedAt,
      capacity: TaskWorkCapacity.make(4),
      entries: [
        TaskAdmissionOccupancy.FreshEntryReserved({ candidate: candidateFor(taskA) }),
        TaskAdmissionOccupancy.ExistingResponsibilityReserved({
          plannedAttempt: plannedAttemptFor(TaskId.make("C"), "1")
        }),
        TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: plannedAttemptFor(TaskId.make("D"), "1") })
      ],
      projection,
      runId
    })

    expect([...basis.occupied.keys()].toSorted()).toEqual(["A", "B", "C", "D"])
    expect(basis.occupied.get(taskA)?._tag).toBe("FreshEntryReserved")
  })
)

it.effect("rejects overlap instead of representing two occupancy forms for one task", () =>
  Effect.gen(function* () {
    const projection = projectionFor([taskA])
    const invalid = yield* makeFreshTaskAdmissionBasis({
      acceptedAt: projection.acceptedAt,
      capacity: TaskWorkCapacity.make(1),
      entries: [TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: plannedAttemptFor(taskA, "1") })],
      projection,
      runId
    }).pipe(Effect.flip)

    expect(invalid).toBeInstanceOf(FreshTaskAdmissionBasisInvalid)
    expect(invalid).toMatchObject({ duplicateTaskIds: ["A"] })
  })
)

it.effect("retains over-capacity occupancy during contraction while exposing no free entry", () =>
  Effect.gen(function* () {
    const projection = projectionFor([TaskId.make("A"), TaskId.make("B")])
    const basis = yield* makeFreshTaskAdmissionBasis({
      acceptedAt: projection.acceptedAt,
      capacity: TaskWorkCapacity.make(1),
      entries: [],
      projection,
      runId
    })

    expect(basis.occupied.size).toBe(2)
  })
)

it.effect("rejects duplicate task identity derived from authoritative aggregates", () =>
  Effect.gen(function* () {
    const invalid = yield* makeFreshTaskAdmissionBasis({
      capacity: TaskWorkCapacity.make(2),
      entries: [
        TaskAdmissionOccupancy.FreshEntryReserved({ candidate: candidateFor(taskA) }),
        TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: plannedAttemptFor(taskA, "2") })
      ],
      runId
    }).pipe(Effect.flip)

    expect(invalid).toBeInstanceOf(FreshTaskAdmissionBasisInvalid)
    expect(invalid).toMatchObject({ duplicateTaskIds: ["A"] })
  })
)

it.effect("reports duplicate task identities in canonical code-unit order", () =>
  Effect.gen(function* () {
    const lower = TaskId.make("a")
    const upper = TaskId.make("Z")
    const projection = projectionFor([lower, upper])
    const invalid = yield* makeFreshTaskAdmissionBasis({
      acceptedAt: projection.acceptedAt,
      capacity: TaskWorkCapacity.make(4),
      entries: [lower, upper].map((taskId) =>
        TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: plannedAttemptFor(taskId, "canonical-order") })
      ),
      projection,
      runId
    }).pipe(Effect.flip)

    expect(invalid).toMatchObject({ duplicateTaskIds: ["Z", "a"] })
  })
)

it.effect("rejects occupancy from another Run instead of counting it in this Run", () =>
  Effect.gen(function* () {
    const otherRunAttempt = PlannedTaskAttempt.make({
      ...plannedAttemptFor(taskA, "other-run"),
      runId: RunId.make("fresh-admission-other-run")
    })
    const invalid = yield* makeFreshTaskAdmissionBasis({
      capacity: TaskWorkCapacity.make(1),
      entries: [TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: otherRunAttempt })],
      runId
    }).pipe(Effect.flip)

    expect(invalid).toBeInstanceOf(FreshTaskAdmissionBasisRunMismatch)
    expect(invalid).toMatchObject({ mismatchedTaskIds: [taskA], runId })
  })
)

it.effect("rejects a structurally fabricated release projection", () =>
  Effect.gen(function* () {
    const fabricated: FreshTaskAdmissionProjection = Object.assign(Object.create(null), {
      _tag: "FreshTaskAdmissionProjection",
      acceptedAt: JournalPosition.make(1),
      commitments: [],
      heldAttempts: [],
      releaseEvidence: [
        {
          _tag: "ExactPreOwnershipClaimRejected",
          claimOperationId: OperationId.make("fabricated-release"),
          runId,
          taskId: taskA
        }
      ],
      runId
    })
    const invalid = yield* makeFreshTaskAdmissionBasis({
      capacity: TaskWorkCapacity.make(1),
      entries: [],
      projection: fabricated,
      runId
    }).pipe(Effect.flip)

    expect(invalid).toBeInstanceOf(FreshTaskAdmissionReleaseAuthorityInvalid)
    expect(invalid).toMatchObject({ reason: "UnrecognizedProjection", runId })
  })
)

it("rejects an empty accepted prefix instead of minting admission authority", () => {
  // The canonical projector intentionally accepts an empty input as an
  // unestablished prefix, but must return no commitment or release authority.
  const result = projectFreshTaskAdmission(runId, [])
  expect(result).toMatchObject({
    _tag: "FreshTaskAdmissionProjectionInvalid",
    issues: ["accepted Run history is empty"],
    runId
  })
})

it.effect("fails closed for a non-object durable commitment shape", () =>
  Effect.gen(function* () {
    const hostile = { _tag: "FreshTaskCommitted", commitment: null } as never
    const result = yield* Effect.exit(
      makeFreshTaskAdmissionBasis({ capacity: TaskWorkCapacity.make(1), entries: [hostile], runId })
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
)

it.effect("fails closed when a hostile commitment omits its operation and acquisition", () =>
  Effect.gen(function* () {
    const hostile = { _tag: "FreshTaskCommitted", commitment: { runId, operation: null } } as never
    const result = yield* Effect.exit(
      makeFreshTaskAdmissionBasis({ capacity: TaskWorkCapacity.make(1), entries: [hostile], runId })
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
)

it.effect("fails closed when a hostile commitment carries an invalid task identity", () =>
  Effect.gen(function* () {
    const otherRun = RunId.make("fresh-admission-hostile-other-run")
    const hostile = {
      _tag: "FreshTaskCommitted",
      commitment: { runId: otherRun, operation: { acquisition: { taskId: 42 } } }
    } as never
    const result = yield* Effect.exit(
      makeFreshTaskAdmissionBasis({ capacity: TaskWorkCapacity.make(1), entries: [hostile], runId })
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
)

it("does not derive executor ownership from entry or claim occupancy", () => {
  const entry = TaskAdmissionOccupancy.FreshEntryReserved({ candidate: candidateFor(taskA) })
  const commitment = projectionFor([taskA]).commitments[0]
  if (commitment === undefined) return expect.fail("missing test commitment")

  expect(taskAdmissionOccupancyExecutorCorrelation(entry)).toBeUndefined()
  expect(taskAdmissionOccupancyExecutorCorrelation(commitment)).toBeUndefined()
})
