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
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import {
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner
} from "./disposition.js"
import { replacementPredecessorsFor, replacementWorktreeObservationOperationIdFor } from "./provenance-fixtures.js"

const dispositionPosition = 5
const authorizationObservationPosition = 3

export const runId = RunId.make("issue-69-worktree-run")
export const baseSha = GitCommitSha.make("1111111111111111111111111111111111111111")
export const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("issue-69-p1"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/task/issue-69-p1"),
  executor: TaskExecutorLocator.make("executor:issue-69"),
  runId,
  taskId: TaskId.make("issue-69-task"),
  taskRevision: TaskRevision.make("revision:1"),
  worktree: WorktreeLocator.make("/tmp/issue-69-p1")
})
export const successor = PlannedTaskAttempt.make({
  ...attempt,
  attemptId: AttemptId.make("issue-69-p2"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-p2"),
  taskRevision: TaskRevision.make("revision:2"),
  worktree: WorktreeLocator.make("/tmp/issue-69-p2")
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
  operationId: OperationId.make("issue-69-worktree-cleanup"),
  owner: WorktreeCleanupOwner.make({ attemptId: attempt.attemptId, branch: attempt.branch }),
  writerQuiescent: true
})
