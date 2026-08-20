import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorktreeCleanupSettledEvent } from "./worktree.js"
import { BranchCleanupAuthorization, BranchCleanupEvidenceRevision, BranchCleanupOwner } from "./disposition.js"
import {
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  branchCleanupTestLayer,
  runBranchCleanup,
  TestBranchCleanupBoundary
} from "./branch.js"
import { worktreeCleanupSettledRecordKey } from "../../../workflow-journal/record-key.js"
import { authorization, attempt, disposition, runId, baseSha } from "./fixtures.js"

const branchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId],
  disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.branch,
  observationAt: JournalPosition.make(5),
  observationOperationId: OperationId.make("issue-69-branch-read"),
  operationId: OperationId.make("issue-69-branch-cleanup"),
  owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
  worktreeCleanupOperationId: OperationId.make("issue-69-worktree-cleanup"),
  writerQuiescent: true
})

const begin = Effect.fn("Issue69BranchTest.begin")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("issue-69-branch-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  yield* journal.append(
    runId,
    worktreeCleanupSettledRecordKey(authorization.operationId),
    WorktreeCleanupSettledEvent.make({
      authorization,
      occurrenceClassification: "NonActionOccurrence",
      result: { _tag: "AlreadyAbsent", locator: authorization.locator, revision: authorization.evidenceRevision },
      version: workflowJournalEventVersion
    })
  )
})

const present = BranchCleanupObservation.cases.Present.make({
  branch: attempt.branch,
  headSha: baseSha,
  revision: BranchCleanupEvidenceRevision.make(1)
})

it.effect("deletes a planned branch only after the exact worktree settlement", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const boundary = yield* TestBranchCleanupBoundary
    expect(result._tag).toBe("Settled")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [present],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("does not read or mutate a branch before worktree cleanup settles", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-branch-gate"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const result = yield* runBranchCleanup(branchAuthorization)
    const boundary = yield* TestBranchCleanupBoundary
    expect(result._tag).toBe("Preserved")
    expect(yield* boundary.calls()).toEqual([])
  }).pipe(Effect.provide(branchCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)
