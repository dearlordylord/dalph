import { AttemptId, GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { Schema } from "effect"
import { IntegratorCandidateResourceLocator, IntegratorSessionId } from "../integrator/events.js"
import {
  BranchCleanupEvidenceRevision,
  IntegratorCandidateCleanupEvidenceRevision,
  WorktreeCleanupEvidenceRevision
} from "./disposition.js"

/** Fresh Git evidence for the exact planned worktree named by one authorization. */
export const WorktreeCleanupObservation = Schema.TaggedUnion({
  Present: {
    attemptId: AttemptId,
    branch: TaskBranchRef,
    headSha: GitCommitSha,
    locator: WorktreeLocator,
    revision: WorktreeCleanupEvidenceRevision,
    writerQuiescent: Schema.Literal(true)
  },
  Absent: { locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  Foreign: {
    locator: WorktreeLocator,
    observedBranch: TaskBranchRef,
    observedHead: GitCommitSha,
    reason: Schema.Literals(["OtherBranch", "OtherOwner", "MovedRegistration"]),
    revision: WorktreeCleanupEvidenceRevision
  },
  Unregistered: { locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  Unreadable: { detail: Schema.String, locator: WorktreeLocator }
})
export type WorktreeCleanupObservation = typeof WorktreeCleanupObservation.Type

/** Fresh Git facts for the exact planned branch after its worktree settled. */
export const BranchCleanupObservation = Schema.TaggedUnion({
  Present: {
    branch: TaskBranchRef,
    headSha: GitCommitSha,
    registeredWorktree: Schema.NullOr(WorktreeLocator),
    revision: BranchCleanupEvidenceRevision
  },
  Absent: { branch: TaskBranchRef, revision: BranchCleanupEvidenceRevision },
  Foreign: {
    branch: TaskBranchRef,
    observedHead: GitCommitSha,
    observedWorktree: WorktreeLocator,
    reason: Schema.Literals(["DifferentHead", "RegisteredWorktree", "OtherOwner"]),
    revision: BranchCleanupEvidenceRevision
  },
  Unreadable: { branch: TaskBranchRef, detail: Schema.String }
})
export type BranchCleanupObservation = typeof BranchCleanupObservation.Type

/** Fresh provider-neutral observation for one quarantined predecessor candidate. */
export const IntegratorCandidateCleanupObservation = Schema.TaggedUnion({
  Present: {
    locator: IntegratorCandidateResourceLocator,
    revision: IntegratorCandidateCleanupEvidenceRevision,
    sessionId: IntegratorSessionId,
    writerQuiescent: Schema.Literal(true)
  },
  Absent: { locator: IntegratorCandidateResourceLocator, revision: IntegratorCandidateCleanupEvidenceRevision },
  Foreign: {
    locator: IntegratorCandidateResourceLocator,
    observedSessionId: IntegratorSessionId,
    reason: Schema.Literals(["LiveWriter", "OtherSession", "Transferred"]),
    revision: IntegratorCandidateCleanupEvidenceRevision
  },
  Unreadable: { detail: Schema.String, locator: IntegratorCandidateResourceLocator }
})
export type IntegratorCandidateCleanupObservation = typeof IntegratorCandidateCleanupObservation.Type
