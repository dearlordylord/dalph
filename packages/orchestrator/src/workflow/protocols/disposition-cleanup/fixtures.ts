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
  encodeTaskRevisionFingerprint
} from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import {
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner
} from "./disposition.js"
import { replacementPredecessorsFor, replacementWorktreeObservationOperationIdFor } from "./provenance-identities.js"

const dispositionPosition = 33
const authorizationObservationPosition = 30

export const runId = RunId.make("cleanup-worktree-run")
export const baseSha = GitCommitSha.make("1111111111111111111111111111111111111111")
export const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("cleanup-p1"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/task/cleanup-p1"),
  executor: TaskExecutorLocator.make("executor:cleanup"),
  runId,
  taskId: TaskId.make("cleanup-task"),
  taskRevision: TaskRevision.make("revision:1"),
  worktree: WorktreeLocator.make("/tmp/cleanup-p1")
})
export const successor = PlannedTaskAttempt.make({
  ...attempt,
  attemptId: AttemptId.make("cleanup-p2"),
  branch: TaskBranchRef.make("refs/heads/task/cleanup-p2"),
  taskRevision: encodeTaskRevisionFingerprint(
    JSON.stringify({ body: "cleanup provenance witness", title: "cleanup provenance witness" })
  ),
  worktree: WorktreeLocator.make("/tmp/cleanup-p2")
})
export const disposition = PlannedAttemptCleanupDisposition.cases.Superseded.make({
  dispositionAt: JournalPosition.make(dispositionPosition),
  plannedAttempt: attempt,
  successorAttempt: successor
})
export const authorization = WorktreeCleanupAuthorization.make({
  causalPredecessors: replacementPredecessorsFor(attempt),
  disposition,
  evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.worktree,
  observationAt: JournalPosition.make(authorizationObservationPosition),
  observationOperationId: replacementWorktreeObservationOperationIdFor(attempt),
  operationId: OperationId.make("cleanup-worktree-cleanup"),
  owner: WorktreeCleanupOwner.make({ attemptId: attempt.attemptId, branch: attempt.branch }),
  writerQuiescent: true
})
