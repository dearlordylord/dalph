import { NodeServices } from "@effect/platform-node"
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
  WorktreeLocator
} from "@dalph/contracts"
import { GitCommand, type GitCommandService } from "../../../authorities/git/command.js"
import {
  CoordinatorOwnership,
  CoordinatorOwnershipLost,
  GitCommonDirectoryLocator,
  GitCommonDirectoryTarget
} from "../../../authorities/coordinator-ownership/ownership.js"
import {
  CleanupMutationOrdinal,
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner
} from "./disposition.js"
import { BranchCleanupBoundary } from "./branch.js"
import { IntegratorCandidateCleanupBoundary } from "./integrator-candidate.js"
import { WorktreeCleanupBoundary } from "./worktree.js"
import { gitDispositionCleanupBoundaryLayer } from "./boundaries.js"
import { attempt, authorization, baseSha } from "./fixtures.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"

const target = GitCommonDirectoryTarget.make("/tmp/issue-69-boundary-git")
const lock = GitCommonDirectoryLocator.make("/tmp/issue-69-boundary-git")
const ownershipLost = new CoordinatorOwnershipLost({ gitCommonDirectory: lock })

const commandLayer = (calls: Ref.Ref<number>) =>
  Layer.succeed(
    GitCommand,
    GitCommand.of({
      run: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as({ exitCode: 0, stderr: "", stdout: "" })),
      runInWorktree: () =>
        Ref.update(calls, (count) => count + 1).pipe(Effect.as({ exitCode: 1, stderr: "", stdout: "" })),
      runBytesInWorktree: () => Effect.die("byte command is outside this boundary test")
    })
  )

const failingOwnershipLayer = Layer.succeed(
  CoordinatorOwnership,
  CoordinatorOwnership.of({ release: Effect.void, runMutation: () => Effect.fail(ownershipLost) })
)

const releasedOwnershipLayer = (released: Ref.Ref<boolean>) =>
  Layer.succeed(
    CoordinatorOwnership,
    CoordinatorOwnership.of({
      release: Ref.set(released, true),
      runMutation: (mutation) =>
        Effect.gen(function* () {
          if (yield* Ref.get(released)) return yield* ownershipLost
          return yield* mutation
        })
    })
  )

const boundaryServices = (
  calls: Ref.Ref<number>,
  commands: GitCommandService = {
    run: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as({ exitCode: 0, stderr: "", stdout: "" })),
    runInWorktree: () =>
      Ref.update(calls, (count) => count + 1).pipe(
        Effect.as({ exitCode: 1, stderr: "fatal: not a git repository", stdout: "" })
      ),
    runBytesInWorktree: () => Effect.die("byte command is outside this boundary test")
  }
) =>
  Effect.gen(function* () {
    const worktree = yield* WorktreeCleanupBoundary
    const branch = yield* BranchCleanupBoundary
    const candidate = yield* IntegratorCandidateCleanupBoundary
    return { branch, candidate, worktree }
  }).pipe(
    Effect.provide(gitDispositionCleanupBoundaryLayer(target)),
    Effect.provide(Layer.succeed(GitCommand, commands)),
    Effect.provide(
      Layer.succeed(
        CoordinatorOwnership,
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (effect) => effect })
      )
    ),
    Effect.provide(NodeServices.layer)
  )

const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: baseSha,
    evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
  }),
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-boundary-p1"),
  expectedTargetHead: baseSha,
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("repo:issue-69-boundary")
  }),
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-boundary-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const candidateSuccessor = IntegratorSessionCorrelation.make({
  ...candidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-boundary-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-boundary-p2"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: candidatePredecessor.targetLineageObservedAt,
  observationOperationId: authorization.observationOperationId,
  operationId: authorization.operationId,
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})
const branchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId],
  disposition: authorization.disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.branch,
  observationAt: authorization.observationAt,
  observationOperationId: authorization.observationOperationId,
  operationId: authorization.operationId,
  owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
  worktreeCleanupOperationId: authorization.operationId,
  writerQuiescent: true
})

it.effect("does not cross any cleanup mutation boundary after coordinator ownership is lost", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const boundaries = yield* Effect.gen(function* () {
      const worktree = yield* WorktreeCleanupBoundary
      const branch = yield* BranchCleanupBoundary
      const candidate = yield* IntegratorCandidateCleanupBoundary
      return { branch, candidate, worktree }
    }).pipe(
      Effect.provide(gitDispositionCleanupBoundaryLayer(target)),
      Effect.provide(commandLayer(calls)),
      Effect.provide(failingOwnershipLayer),
      Effect.provide(NodeServices.layer)
    )
    const failures = yield* Effect.all([
      boundaries.worktree.remove(authorization, CleanupMutationOrdinal.make(1)).pipe(Effect.flip),
      boundaries.branch.remove(branchAuthorization, CleanupMutationOrdinal.make(1)).pipe(Effect.flip)
    ])
    for (const failure of failures) expect(failure).toBeInstanceOf(CoordinatorOwnershipLost)
    const candidateResult = yield* boundaries.candidate.remove(candidateAuthorization, CleanupMutationOrdinal.make(1))
    expect(candidateResult._tag).toBe("Unknown")
    expect(yield* Ref.get(calls)).toBe(0)
  })
)

it.effect("does not cross a cleanup mutation boundary after explicit ownership release", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const released = yield* Ref.make(false)
    const boundary = yield* Effect.gen(function* () {
      const service = yield* WorktreeCleanupBoundary
      const ownership = yield* CoordinatorOwnership
      yield* ownership.release
      return service
    }).pipe(
      Effect.provide(gitDispositionCleanupBoundaryLayer(target)),
      Effect.provide(commandLayer(calls)),
      Effect.provide(releasedOwnershipLayer(released)),
      Effect.provide(NodeServices.layer)
    )
    const failure = yield* boundary.remove(authorization, CleanupMutationOrdinal.make(1)).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(CoordinatorOwnershipLost)
    expect(yield* Ref.get(calls)).toBe(0)
  })
)

it.effect("classifies an existing non-worktree directory as unregistered, not absent", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const boundaries = yield* boundaryServices(calls)
    const observed = yield* boundaries.worktree.observe({ ...authorization, locator: WorktreeLocator.make("/tmp") })
    expect(observed._tag).toBe("Unregistered")
    expect(yield* Ref.get(calls)).toBe(2)
  })
)

it.effect("classifies a missing branch ref reported as not a valid ref as absent", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const commands: GitCommandService = {
      run: (_directory, args) =>
        args[0] === "show-ref"
          ? Ref.update(calls, (count) => count + 1).pipe(
              Effect.as({ exitCode: 1, stderr: "fatal: refs/heads/missing is not a valid ref", stdout: "" })
            )
          : Ref.update(calls, (count) => count + 1).pipe(Effect.as({ exitCode: 0, stderr: "", stdout: "" })),
      runInWorktree: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as({
            exitCode: 1,
            stderr: "fatal: cannot change to '/tmp/issue-69-p1': No such file or directory",
            stdout: ""
          })
        ),
      runBytesInWorktree: () => Effect.die("byte command is outside this boundary test")
    }
    const boundaries = yield* boundaryServices(calls, commands)
    const observed = yield* boundaries.branch.observe(branchAuthorization)
    expect(observed._tag).toBe("Absent")
  })
)

it.effect("rejects malformed or ambiguous porcelain blocks as unreadable", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const commands: GitCommandService = {
      run: (_directory, args) =>
        args[0] === "worktree"
          ? Ref.update(calls, (count) => count + 1).pipe(
              Effect.as({
                exitCode: 0,
                stderr: "",
                stdout:
                  "worktree /tmp/issue-69-p1\nHEAD 1111111111111111111111111111111111111111\n\nworktree /tmp/issue-69-p2\n"
              })
            )
          : Ref.update(calls, (count) => count + 1).pipe(
              Effect.as({ exitCode: 0, stderr: "", stdout: "1111111111111111111111111111111111111111" })
            ),
      runInWorktree: () => Effect.die("malformed list must stop before path probing"),
      runBytesInWorktree: () => Effect.die("byte command is outside this boundary test")
    }
    const boundaries = yield* boundaryServices(calls, commands)
    const observed = yield* boundaries.worktree.observe(authorization)
    expect(observed._tag).toBe("Unreadable")
  })
)

it.effect("does not expose a provider-neutral candidate remove command", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const boundaries = yield* boundaryServices(calls)
    const result = yield* boundaries.candidate.remove(candidateAuthorization, CleanupMutationOrdinal.make(1))
    expect(result._tag).toBe("Unknown")
    expect(yield* Ref.get(calls)).toBe(0)
  })
)
