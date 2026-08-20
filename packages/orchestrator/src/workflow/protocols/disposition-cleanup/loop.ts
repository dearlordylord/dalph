import { Effect } from "effect"
import { RunId } from "@dalph/contracts"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import {
  isCleanupEligibleDisposition,
  type BranchCleanupAuthorization,
  type IntegratorCandidateCleanupAuthorization,
  type WorktreeCleanupAuthorization
} from "./disposition.js"
import { runBranchCleanup, type BranchCleanupOutcome } from "./branch.js"
import { runIntegratorCandidateCleanup, type IntegratorCandidateCleanupOutcome } from "./integrator-candidate.js"
import { runWorktreeCleanup, type WorktreeCleanupOutcome } from "./worktree.js"

/** The three independent cleanup responsibilities reconstructed for one Run. */
export type DispositionCleanupResponsibilities = {
  readonly branch: BranchCleanupAuthorization | undefined
  readonly candidate: IntegratorCandidateCleanupAuthorization | undefined
  readonly worktree: WorktreeCleanupAuthorization | undefined
}

/** Results of one composed cleanup loop, retaining each family's typed outcome. */
export type DispositionCleanupLoopResult = {
  readonly branch: BranchCleanupOutcome | undefined
  readonly candidate: IntegratorCandidateCleanupOutcome | undefined
  readonly selected: DispositionCleanupResponsibilities
  readonly worktree: WorktreeCleanupOutcome | undefined
}

/**
 * Selects only responsibilities whose exact durable terminal occurrence is in
 * the supplied Run. A decoded caller subject is merely a candidate: journaled
 * replacement or successor evidence is what makes it eligible.
 */
export const selectCleanupResponsibilities = (
  records: ReadonlyArray<JournalRecord>,
  candidates: DispositionCleanupResponsibilities
): DispositionCleanupResponsibilities => {
  const replacement = records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptReplaced" &&
      candidates.worktree !== undefined &&
      event.subject.plannedAttempt.runId === candidates.worktree.disposition.plannedAttempt.runId &&
      event.subject.plannedAttempt.taskId === candidates.worktree.disposition.plannedAttempt.taskId
  )
  const successor = records.some(
    ({ event }) =>
      event._tag === "IntegratorSuccessorSessionFixed" &&
      candidates.candidate !== undefined &&
      event.successor.plannedAttempt.runId === candidates.candidate.disposition.predecessor.plannedAttempt.runId &&
      event.successor.sessionId === candidates.candidate.disposition.successor.sessionId
  )
  return {
    branch:
      replacement && candidates.branch !== undefined && isCleanupEligibleDisposition(candidates.branch.disposition)
        ? candidates.branch
        : undefined,
    candidate:
      successor && candidates.candidate !== undefined && isCleanupEligibleDisposition(candidates.candidate.disposition)
        ? candidates.candidate
        : undefined,
    worktree:
      replacement && candidates.worktree !== undefined && isCleanupEligibleDisposition(candidates.worktree.disposition)
        ? candidates.worktree
        : undefined
  }
}

/**
 * Runs the same family protocols used by production activation. Worktree
 * settlement is the explicit gate for branch cleanup; candidate cleanup is an
 * independent family and never borrows either resource's authority.
 */
export const runDispositionCleanupLoop = Effect.fn("DispositionCleanup.loop")(function* (
  runId: RunId,
  candidates: DispositionCleanupResponsibilities
) {
  const journal = yield* InRunJournal
  const selected = selectCleanupResponsibilities(yield* journal.read(runId), candidates)
  let worktree: WorktreeCleanupOutcome | undefined
  let branch: BranchCleanupOutcome | undefined
  let candidate: IntegratorCandidateCleanupOutcome | undefined
  if (selected.worktree !== undefined) {
    worktree = yield* runWorktreeCleanup(selected.worktree)
    if (worktree._tag === "Settled" && selected.branch !== undefined) {
      branch = yield* runBranchCleanup(selected.branch)
    }
  }
  if (selected.candidate !== undefined) {
    candidate = yield* runIntegratorCandidateCleanup(selected.candidate)
  }
  return { branch, candidate, selected, worktree } satisfies DispositionCleanupLoopResult
})
