import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskRevision,
  TaskExecutorLocator,
  WorktreeLocator
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { OperationId } from "../../identity.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  isCleanupEligibleDisposition,
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner
} from "./disposition.js"
import {
  runWorktreeCleanup,
  TestWorktreeCleanupBoundary,
  worktreeCleanupTestLayer,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation
} from "./worktree.js"
import { appendReplacementProvenance, replacementPredecessorsFor } from "./provenance-fixtures.js"

const runId = RunId.make("issue-69-worktree-run")
const baseSha = GitCommitSha.make("1111111111111111111111111111111111111111")
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("issue-69-p1"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/task/issue-69-p1"),
  executor: TaskExecutorLocator.make("executor:issue-69"),
  runId,
  taskId: TaskId.make("issue-69-task"),
  taskRevision: TaskRevision.make("revision:1"),
  worktree: WorktreeLocator.make("/tmp/issue-69-p1")
})
const successor = PlannedTaskAttempt.make({
  ...attempt,
  attemptId: AttemptId.make("issue-69-p2"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-p2"),
  taskRevision: TaskRevision.make("revision:2"),
  worktree: WorktreeLocator.make("/tmp/issue-69-p2")
})
const disposition = PlannedAttemptCleanupDisposition.cases.Superseded.make({
  dispositionAt: JournalPosition.make(3),
  plannedAttempt: attempt,
  successorAttempt: successor
})
const authorization = WorktreeCleanupAuthorization.make({
  causalPredecessors: replacementPredecessorsFor(attempt),
  disposition,
  evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.worktree,
  observationAt: JournalPosition.make(3),
  observationOperationId: OperationId.make("issue-69-worktree-read"),
  operationId: OperationId.make("issue-69-worktree-cleanup"),
  owner: WorktreeCleanupOwner.make({ attemptId: attempt.attemptId, branch: attempt.branch }),
  writerQuiescent: true
})

const setup = (
  observations: ReadonlyArray<WorktreeCleanupObservation>,
  mutations: ReadonlyArray<WorktreeCleanupMutationResult> = []
) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const result = yield* runWorktreeCleanup(authorization)
    const calls = yield* TestWorktreeCleanupBoundary
    return { calls: yield* calls.calls(), result }
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations, mutations })), Effect.provide(memoryJournalTestLayer))

const present = WorktreeCleanupObservation.cases.Present.make({
  attemptId: attempt.attemptId,
  branch: attempt.branch,
  headSha: baseSha,
  locator: attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(1),
  writerQuiescent: true
})

it.effect("removes the exact superseded worktree after fresh matching facts", () =>
  setup(
    [
      present,
      WorktreeCleanupObservation.cases.Absent.make({
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(2)
      })
    ],
    [
      WorktreeCleanupMutationResult.cases.Removed.make({
        branch: attempt.branch,
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(2)
      })
    ]
  ).pipe(
    Effect.tap(({ calls, result }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("Settled")
        expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
      })
    )
  )
)

it.effect("does not call a boundary when a replayed operation has different authorization facts", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-authorization-replay"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const first = yield* runWorktreeCleanup(authorization)
    const replayedAuthorization = WorktreeCleanupAuthorization.make({
      ...authorization,
      expectedHead: GitCommitSha.make("2".repeat(40))
    })
    const second = yield* runWorktreeCleanup(replayedAuthorization)
    const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
    expect(first._tag).toBe("Pending")
    expect(second._tag).toBe("Preserved")
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove"])
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [present],
        mutations: [
          WorktreeCleanupMutationResult.cases.Unknown.make({
            branch: attempt.branch,
            detail: "lost",
            locator: attempt.worktree
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("records initial absence as reconciliation, never as a mutation result", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-initial-absence"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const result = yield* runWorktreeCleanup(authorization)
    const records = yield* journal.read(runId)
    expect(result._tag).toBe("Settled")
    expect(records.map(({ event }) => event._tag)).not.toContain("WorktreeCleanupMutationResultRecorded")
    expect(records.map(({ event }) => event._tag)).toContain("WorktreeCleanupAbsenceConfirmed")
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a caller-made disposition when durable terminal provenance is missing", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-missing-provenance"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const result = yield* runWorktreeCleanup(authorization)
    const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
    expect(result._tag).toBe("Preserved")
    expect(calls).toEqual([])
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("preserves an invalid successful mutation response instead of settling", () =>
  setup(
    [present],
    [
      WorktreeCleanupMutationResult.cases.Removed.make({
        branch: attempt.branch,
        locator: WorktreeLocator.make("/tmp/foreign-worktree"),
        revision: WorktreeCleanupEvidenceRevision.make(2)
      })
    ]
  ).pipe(
    Effect.tap(({ calls, result }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("Preserved")
        expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove"])
      })
    )
  )
)

it("rejects a superseded disposition that reuses predecessor identity", () => {
  expect(() =>
    PlannedAttemptCleanupDisposition.cases.Superseded.make({
      dispositionAt: JournalPosition.make(3),
      plannedAttempt: attempt,
      successorAttempt: attempt
    })
  ).toThrow()
})

it.effect("preserves changed or unreadable worktree facts without a remove call", () =>
  setup([
    WorktreeCleanupObservation.cases.Foreign.make({
      locator: attempt.worktree,
      observedBranch: TaskBranchRef.make("refs/heads/other"),
      observedHead: baseSha,
      reason: "OtherBranch",
      revision: WorktreeCleanupEvidenceRevision.make(2)
    })
  ]).pipe(
    Effect.tap(({ calls, result }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("Preserved")
        expect(calls.map((call) => call._tag)).toEqual(["Observe"])
      })
    )
  )
)

it.effect("reconciles an applied response loss with a fresh absence and never duplicates remove", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-target-loss"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const first = yield* runWorktreeCleanup(authorization).pipe(
      Effect.provide(
        worktreeCleanupTestLayer({
          observations: [
            present,
            WorktreeCleanupObservation.cases.Absent.make({
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          ],
          mutations: [
            WorktreeCleanupMutationResult.cases.Unknown.make({
              branch: attempt.branch,
              detail: "response lost",
              locator: attempt.worktree
            })
          ]
        })
      )
    )
    const second = yield* runWorktreeCleanup(authorization).pipe(
      Effect.provide(
        worktreeCleanupTestLayer({
          observations: [
            WorktreeCleanupObservation.cases.Absent.make({
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          ]
        })
      )
    )
    expect(first._tag).toBe("Pending")
    expect(second._tag).toBe("Settled")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

const boundBoundaryLayer = worktreeCleanupTestLayer({
  observations: [present],
  mutations: [
    WorktreeCleanupMutationResult.cases.Unknown.make({
      branch: attempt.branch,
      detail: "unknown",
      locator: attempt.worktree
    }),
    WorktreeCleanupMutationResult.cases.Unknown.make({
      branch: attempt.branch,
      detail: "unknown",
      locator: attempt.worktree
    }),
    WorktreeCleanupMutationResult.cases.Unknown.make({
      branch: attempt.branch,
      detail: "unknown",
      locator: attempt.worktree
    })
  ]
})

it.effect("stops after the three-request cleanup bound", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-target-bound"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const first = yield* runWorktreeCleanup(authorization)
    const second = yield* runWorktreeCleanup(authorization)
    const third = yield* runWorktreeCleanup(authorization)
    const fourth = yield* runWorktreeCleanup(authorization)
    expect([first, second, third].map((value) => value._tag)).toEqual(["Pending", "Pending", "Pending"])
    expect(fourth._tag).toBe("Pending")
    const boundary = yield* TestWorktreeCleanupBoundary
    expect((yield* boundary.calls()).filter((call) => call._tag === "Remove")).toHaveLength(3)
  }).pipe(Effect.provide(boundBoundaryLayer), Effect.provide(memoryJournalTestLayer))
)

it("does not authorize cleanup for a current quarantine without a terminal disposal", () => {
  expect(isCleanupEligibleDisposition({ _tag: "CurrentQuarantine", sessionId: "live-session" })).toBe(false)
})
