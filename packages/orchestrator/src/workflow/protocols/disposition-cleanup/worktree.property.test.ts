import { expect, it } from "vitest"
import fc from "fast-check"
import { AttemptId, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { AttemptChoiceRequestId } from "../attempt-choice/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import {
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision
} from "./disposition.js"
import { worktreeCleanupObservationMatchesAuthorization, WorktreeCleanupObservation } from "./worktree.js"
import { attempt, authorization, baseSha, runId, successor } from "./fixtures.js"

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
