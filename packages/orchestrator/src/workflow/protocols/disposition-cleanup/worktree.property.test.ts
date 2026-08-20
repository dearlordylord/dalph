import { expect, it } from "vitest"
import { it as effectIt } from "@effect/vitest"
import fc from "fast-check"
import { AttemptId, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { Effect } from "effect"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { AttemptChoiceRequestId } from "../attempt-choice/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { OperationId } from "../../identity.js"
import {
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision
} from "./disposition.js"
import {
  runWorktreeCleanup,
  TestWorktreeCleanupBoundary,
  worktreeCleanupObservationMatchesAuthorization,
  WorktreeCleanupObservation,
  worktreeCleanupTestLayer
} from "./worktree.js"
import { attempt, authorization, baseSha, runId, successor } from "./fixtures.js"
import { appendReplacementProvenance } from "./provenance-fixtures.js"

it("varies locator, owner, terminal occurrence, and observation revision without widening cleanup authority", () => {
  fc.assert(
    fc.property(
      fc.record({
        locatorMatches: fc.boolean(),
        ownerMatches: fc.boolean(),
        occurrence: fc.constantFrom("Abandoned", "Settled", "Superseded"),
        revisionMatches: fc.boolean()
      }),
      ({ locatorMatches, occurrence, ownerMatches, revisionMatches }) => {
        const disposition =
          occurrence === "Abandoned"
            ? PlannedAttemptCleanupDisposition.cases.Abandoned.make({
                dispositionAt: JournalPosition.make(2),
                plannedAttempt: attempt,
                requestId: AttemptChoiceRequestId.make({ nonce: "issue-69-stop", runId })
              })
            : occurrence === "Settled"
              ? PlannedAttemptCleanupDisposition.cases.Settled.make({
                  dispositionAt: JournalPosition.make(2),
                  plannedAttempt: attempt,
                  settlementOperationId: OperationId.make("issue-69-settlement")
                })
              : PlannedAttemptCleanupDisposition.cases.Superseded.make({
                  dispositionAt: JournalPosition.make(2),
                  plannedAttempt: attempt,
                  successorAttempt: successor
                })
        const evidenceRevision = WorktreeCleanupEvidenceRevision.make(revisionMatches ? 1 : 2)
        const candidateAuthorization = WorktreeCleanupAuthorization.make({
          ...authorization,
          disposition,
          evidenceRevision: WorktreeCleanupEvidenceRevision.make(1)
        })
        const observation = WorktreeCleanupObservation.cases.Present.make({
          attemptId: ownerMatches ? attempt.attemptId : AttemptId.make("foreign-attempt"),
          branch: ownerMatches ? attempt.branch : TaskBranchRef.make("refs/heads/foreign"),
          headSha: baseSha,
          locator: locatorMatches ? attempt.worktree : WorktreeLocator.make("/tmp/foreign"),
          revision: evidenceRevision,
          writerQuiescent: true
        })
        expect(worktreeCleanupObservationMatchesAuthorization(observation, candidateAuthorization)).toBe(
          locatorMatches && ownerMatches && revisionMatches
        )
      }
    )
  )
})

effectIt.effect("table-reconciles changed locator, owner, and revision without a worktree mutation", () =>
  Effect.gen(function* () {
    const cases = [
      WorktreeCleanupObservation.cases.Foreign.make({
        locator: WorktreeLocator.make("/tmp/foreign-worktree"),
        observedBranch: attempt.branch,
        observedHead: baseSha,
        reason: "MovedRegistration",
        revision: WorktreeCleanupEvidenceRevision.make(2)
      }),
      WorktreeCleanupObservation.cases.Foreign.make({
        locator: attempt.worktree,
        observedBranch: TaskBranchRef.make("refs/heads/foreign"),
        observedHead: baseSha,
        reason: "OtherOwner",
        revision: WorktreeCleanupEvidenceRevision.make(2)
      }),
      WorktreeCleanupObservation.cases.Unreadable.make({ detail: "provider read failed", locator: attempt.worktree })
    ]
    for (const observation of cases) {
      const result = yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          FixtureTarget.make("issue-69-worktree-property-protocol"),
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* appendReplacementProvenance(attempt, successor)
        const outcome = yield* runWorktreeCleanup(authorization)
        const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
        return { calls, outcome }
      }).pipe(
        Effect.provide(worktreeCleanupTestLayer({ observations: [observation] })),
        Effect.provide(memoryJournalTestLayer)
      )
      expect(result.outcome._tag).toBe("Preserved")
      expect(result.calls.map(({ _tag }) => _tag)).toEqual(["Observe"])
    }
  })
)
