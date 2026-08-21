import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  TaskBranchRef
} from "@dalph/contracts"
import { CoordinatorOwnership } from "../../../authorities/coordinator-ownership/ownership.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  CleanupMutationOrdinal,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner
} from "./disposition.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"
import { preservingDispositionCleanupBoundaryLayer } from "./preserving-boundary.js"
import { BranchCleanupBoundary } from "./branch.js"
import { IntegratorCandidateCleanupBoundary } from "./integrator-candidate.js"
import { WorktreeCleanupBoundary } from "./worktree.js"
import { attempt, authorization, baseSha } from "./fixtures.js"

const branchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId],
  disposition: authorization.disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: TaskBranchRef.make("refs/heads/task/issue-69-p1"),
  observationAt: authorization.observationAt,
  observationOperationId: authorization.observationOperationId,
  operationId: OperationId.make("issue-69-preserving-branch"),
  owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
  worktreeCleanupOperationId: authorization.operationId,
  writerQuiescent: true
})

const predecessor = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: baseSha,
    evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
  }),
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-preserving-p1"),
  expectedTargetHead: baseSha,
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("repo:issue-69-preserving")
  }),
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-preserving-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})

const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-preserving-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor,
    successor: IntegratorSessionCorrelation.make({
      ...predecessor,
      candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-preserving-p2"),
      sessionId: IntegratorSessionId.make("session:issue-69-preserving-p2"),
      targetLineageObservedAt: JournalPosition.make(12)
    })
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: predecessor.candidateResource,
  observationAt: predecessor.targetLineageObservedAt,
  observationOperationId: OperationId.make("issue-69-preserving-candidate-observation"),
  operationId: OperationId.make("issue-69-preserving-candidate"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: predecessor.sessionId }),
  writerQuiescent: true
})

it.effect("preserves every resource when the composition has no Git cleanup boundary", () =>
  Effect.gen(function* () {
    const mutations = yield* Ref.make(0)
    const ownership = Layer.succeed(
      CoordinatorOwnership,
      CoordinatorOwnership.of({
        release: Effect.void,
        runMutation: (mutation) => Ref.update(mutations, (count) => count + 1).pipe(Effect.andThen(mutation))
      })
    )
    const boundaries = yield* Effect.gen(function* () {
      const worktree = yield* WorktreeCleanupBoundary
      const branch = yield* BranchCleanupBoundary
      const candidate = yield* IntegratorCandidateCleanupBoundary
      return { branch, candidate, worktree }
    }).pipe(Effect.provide(preservingDispositionCleanupBoundaryLayer), Effect.provide(ownership))

    expect((yield* boundaries.worktree.observe(authorization))._tag).toBe("Unreadable")
    expect((yield* boundaries.branch.observe(branchAuthorization))._tag).toBe("Unreadable")
    expect((yield* boundaries.candidate.observe(candidateAuthorization))._tag).toBe("Unreadable")
    expect((yield* boundaries.worktree.remove(authorization, CleanupMutationOrdinal.make(1)))._tag).toBe("Unknown")
    expect((yield* boundaries.branch.remove(branchAuthorization, CleanupMutationOrdinal.make(1)))._tag).toBe("Unknown")
    expect((yield* boundaries.candidate.remove(candidateAuthorization, CleanupMutationOrdinal.make(1)))._tag).toBe(
      "Unknown"
    )
    expect(yield* Ref.get(mutations)).toBe(3)
  })
)
