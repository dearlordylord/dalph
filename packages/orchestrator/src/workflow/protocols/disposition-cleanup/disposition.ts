import { Schema } from "effect"
import { AttemptId, GitCommitSha, PlannedTaskAttempt, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import { AttemptChoiceRequestId } from "../attempt-choice/events.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"

/**
 * The exact terminal occurrence that made one planned-attempt resource
 * disposable.  A cleanup authorization cannot be made from a task lifecycle,
 * process age, or an inferred terminal state.
 */
export const PlannedAttemptCleanupDisposition = Schema.TaggedUnion({
  Abandoned: { dispositionAt: JournalPosition, plannedAttempt: PlannedTaskAttempt, requestId: AttemptChoiceRequestId },
  Settled: { dispositionAt: JournalPosition, plannedAttempt: PlannedTaskAttempt, settlementOperationId: OperationId },
  Superseded: {
    dispositionAt: JournalPosition,
    plannedAttempt: PlannedTaskAttempt,
    successorAttempt: PlannedTaskAttempt
  }
})
export type PlannedAttemptCleanupDisposition = typeof PlannedAttemptCleanupDisposition.Type

/** Structural equality for the immutable terminal occurrence used by both
 * the worktree and branch cleanup authorizations. */
export const plannedAttemptCleanupDispositionEquals = Schema.toEquivalence(PlannedAttemptCleanupDisposition)

/** The exact FullRerun occurrence that transferred an Integrator responsibility. */
export const IntegratorCandidateCleanupDisposition = Schema.TaggedStruct("Superseded", {
  directionAppliedAt: JournalPosition,
  dispositionAt: JournalPosition,
  predecessor: IntegratorSessionCorrelation,
  successor: IntegratorSessionCorrelation
}).check(
  Schema.makeFilter((disposition) =>
    disposition.predecessor.sessionId !== disposition.successor.sessionId &&
    disposition.predecessor.candidateResource !== disposition.successor.candidateResource &&
    disposition.dispositionAt < disposition.directionAppliedAt
      ? undefined
      : "candidate cleanup requires one distinct predecessor and successor after quarantine"
  )
)
export type IntegratorCandidateCleanupDisposition = typeof IntegratorCandidateCleanupDisposition.Type

/** Ownership evidence for the exact planned-attempt worktree registration. */
export const WorktreeCleanupOwner = Schema.Struct({ attemptId: AttemptId, branch: TaskBranchRef }).pipe(
  Schema.brand("WorktreeCleanupOwner")
)
export type WorktreeCleanupOwner = typeof WorktreeCleanupOwner.Type

/** Ownership evidence for the exact planned branch ref. */
export const BranchCleanupOwner = Schema.Struct({ attemptId: AttemptId }).pipe(Schema.brand("BranchCleanupOwner"))
export type BranchCleanupOwner = typeof BranchCleanupOwner.Type

/** Ownership evidence for an Integrator-owned predecessor candidate resource. */
export const IntegratorCandidateCleanupOwner = Schema.Struct({ sessionId: IntegratorSessionId }).pipe(
  Schema.brand("IntegratorCandidateCleanupOwner")
)
export type IntegratorCandidateCleanupOwner = typeof IntegratorCandidateCleanupOwner.Type

/** Provider evidence revisions are never interchangeable across cleanup families. */
export const WorktreeCleanupEvidenceRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("WorktreeCleanupEvidenceRevision")
)
export type WorktreeCleanupEvidenceRevision = typeof WorktreeCleanupEvidenceRevision.Type

export const BranchCleanupEvidenceRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("BranchCleanupEvidenceRevision")
)
export type BranchCleanupEvidenceRevision = typeof BranchCleanupEvidenceRevision.Type

export const IntegratorCandidateCleanupEvidenceRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("IntegratorCandidateCleanupEvidenceRevision")
)
export type IntegratorCandidateCleanupEvidenceRevision = typeof IntegratorCandidateCleanupEvidenceRevision.Type

/** Positive bounded cleanup mutation attempt ordinal. */
export const CleanupMutationOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CleanupMutationOrdinal")
)
export type CleanupMutationOrdinal = typeof CleanupMutationOrdinal.Type

/** Positive fresh-authority observation ordinal used during cleanup recovery. */
export const CleanupObservationOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CleanupObservationOrdinal")
)
export type CleanupObservationOrdinal = typeof CleanupObservationOrdinal.Type

/** The maximum number of destructive requests one exact cleanup authorization may issue. */
export const cleanupMutationRequestLimit = 3 as const // eslint-disable-line no-magic-numbers
export const CleanupMutationRequestLimit = Schema.Literal(cleanupMutationRequestLimit)
export type CleanupMutationRequestLimit = typeof CleanupMutationRequestLimit.Type

/** A worktree authorization names only the planned attempt's own locator and owner. */
export const WorktreeCleanupAuthorization = Schema.Struct({
  causalPredecessors: Schema.NonEmptyArray(OperationId),
  disposition: PlannedAttemptCleanupDisposition,
  evidenceRevision: WorktreeCleanupEvidenceRevision,
  expectedHead: GitCommitSha,
  locator: WorktreeLocator,
  observationAt: JournalPosition,
  observationOperationId: OperationId,
  operationId: OperationId,
  owner: WorktreeCleanupOwner,
  writerQuiescent: Schema.Literal(true)
}).check(
  Schema.makeFilter((authorization) => {
    const attempt = authorization.disposition.plannedAttempt
    return authorization.locator === attempt.worktree &&
      authorization.owner.attemptId === attempt.attemptId &&
      authorization.owner.branch === attempt.branch
      ? undefined
      : "worktree cleanup authorization must bind the exact planned attempt locator and owner"
  })
)
export type WorktreeCleanupAuthorization = typeof WorktreeCleanupAuthorization.Type

/** A branch authorization is legal only after its predecessor worktree settled. */
export const BranchCleanupAuthorization = Schema.Struct({
  causalPredecessors: Schema.NonEmptyArray(OperationId),
  disposition: PlannedAttemptCleanupDisposition,
  evidenceRevision: BranchCleanupEvidenceRevision,
  expectedHead: GitCommitSha,
  locator: TaskBranchRef,
  observationAt: JournalPosition,
  observationOperationId: OperationId,
  operationId: OperationId,
  owner: BranchCleanupOwner,
  worktreeCleanupOperationId: OperationId,
  writerQuiescent: Schema.Literal(true)
}).check(
  Schema.makeFilter((authorization) => {
    const attempt = authorization.disposition.plannedAttempt
    return authorization.locator === attempt.branch &&
      authorization.owner.attemptId === attempt.attemptId &&
      authorization.expectedHead.length > 0
      ? undefined
      : "branch cleanup authorization must bind the exact planned branch and expected head"
  })
)
export type BranchCleanupAuthorization = typeof BranchCleanupAuthorization.Type

/** A candidate authorization names only the predecessor resource transferred by FullRerun. */
export const IntegratorCandidateCleanupAuthorization = Schema.Struct({
  causalPredecessors: Schema.NonEmptyArray(OperationId),
  disposition: IntegratorCandidateCleanupDisposition,
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision,
  locator: IntegratorCandidateResourceLocator,
  observationAt: JournalPosition,
  observationOperationId: OperationId,
  operationId: OperationId,
  owner: IntegratorCandidateCleanupOwner,
  writerQuiescent: Schema.Literal(true)
}).check(
  Schema.makeFilter((authorization) => {
    const predecessor = authorization.disposition.predecessor
    return authorization.locator === predecessor.candidateResource &&
      authorization.owner.sessionId === predecessor.sessionId
      ? undefined
      : "candidate cleanup authorization must bind the predecessor session resource and owner"
  })
)
export type IntegratorCandidateCleanupAuthorization = typeof IntegratorCandidateCleanupAuthorization.Type

/** Value equality for the immutable authorization subjects used by recovery. */
export const worktreeCleanupAuthorizationEquals = Schema.toEquivalence(WorktreeCleanupAuthorization)
export const branchCleanupAuthorizationEquals = Schema.toEquivalence(BranchCleanupAuthorization)
export const integratorCandidateCleanupAuthorizationEquals = Schema.toEquivalence(
  IntegratorCandidateCleanupAuthorization
)

/** Shared result vocabulary for a controlled mutation boundary. */
export const CleanupMutationFailureOutcome = Schema.Literals(["DefinitelyNotApplied", "Unknown"])
export type CleanupMutationFailureOutcome = typeof CleanupMutationFailureOutcome.Type

/** Only these terminal occurrences may produce cleanup authorization subjects. */
export const isCleanupEligibleDisposition = (
  value: unknown
): value is PlannedAttemptCleanupDisposition | IntegratorCandidateCleanupDisposition =>
  Schema.is(PlannedAttemptCleanupDisposition)(value) || Schema.is(IntegratorCandidateCleanupDisposition)(value)
