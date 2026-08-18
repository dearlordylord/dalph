// @effect-diagnostics multipleEffectProvide:off
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import {
  AttemptId,
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  IntegrationCandidateGit,
  IntegrationCandidateGitReadFailure
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorSessionId
} from "../../workflow/protocols/integrator/events.js"
import {
  TargetPromotionCompareAndSetFailure,
  TargetPromotionCompareAndSetResult,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  type TargetPromotionGitService,
  TargetPromotionGitReadObservation,
  type TargetPromotionCorrelation,
  targetPromotionCorrelationFor,
  targetPromotionGitRequestFor
} from "../../workflow/protocols/target-promotion/events.js"
import { GitCommand, GitCommandInvocationFailure, GitCommandResult, nodeGitCommandLayer } from "./command.js"
import { GitTargetLineage, GitTargetLineageReadFailure, nodeGitTargetLineageLayer } from "./target-lineage.js"
import { nodeGitIntegrationCandidateLayer } from "./integration-candidate.js"
import { nodeGitTargetPromotionLayer } from "./target-promotion.js"

type Repository = {
  readonly gitDirectory: GitRepositoryLocator
  readonly run: (
    ...args: ReadonlyArray<string>
  ) => Effect.Effect<string, unknown, ChildProcessSpawner.ChildProcessSpawner>
}

const runGit = Effect.fn("RealGitQualification.runGit")(function* (cwd: string, ...args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make("git", args, { cwd }))
      const [exitCode, stderr, stdout] = yield* Effect.all(
        [
          handle.exitCode,
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
        ],
        { concurrency: "unbounded" }
      )
      if (exitCode !== 0) return yield* Effect.die(`git ${args.join(" ")} failed: ${stderr}`)
      return stdout.trim()
    })
  )
})

const withRepository = <A, E, R>(use: (repository: Repository) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-real-git-qualification-" })
    const directory = `${root}/repository`
    yield* fileSystem.makeDirectory(directory)
    yield* runGit(directory, "init", "--initial-branch=main")
    yield* runGit(directory, "config", "user.email", "dalph@example.invalid")
    yield* runGit(directory, "config", "user.name", "Dalph Test")
    return yield* use({
      gitDirectory: GitRepositoryLocator.make(`${directory}/.git`),
      run: (...args) => runGit(directory, ...args)
    })
  }).pipe(Effect.provide(NodeServices.layer))

const nodeLineageLayer = nodeGitTargetLineageLayer.pipe(
  Layer.provide(nodeGitCommandLayer),
  Layer.provide(NodeServices.layer)
)

const nodeCandidateLayer = nodeGitIntegrationCandidateLayer.pipe(
  Layer.provide(nodeGitCommandLayer),
  Layer.provide(NodeServices.layer)
)

const nodeTargetPromotionLayer = nodeGitTargetPromotionLayer.pipe(
  Layer.provide(nodeGitCommandLayer),
  Layer.provide(NodeServices.layer)
)

const evidence = EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("a".repeat(64)) })

const promotionCorrelationFor = (
  target: IntegrationTarget,
  expectedHead: GitCommitSha,
  acceptedResultCommit: GitCommitSha,
  candidateCommit: GitCommitSha
): TargetPromotionCorrelation => {
  const acceptedResult = AcceptedResult.make({ commit: acceptedResultCommit, evidenceManifest: evidence })
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("real-git-promotion-attempt"),
    baseSha: expectedHead,
    branch: TaskBranchRef.make("refs/heads/dalph/real-git-promotion"),
    executor: TaskExecutorLocator.make("executor:real-git-promotion"),
    runId: RunId.make("real-git-promotion-run"),
    taskId: TaskId.make("real-git-promotion-task"),
    taskRevision: TaskRevision.make("real-git-promotion-revision"),
    worktree: WorktreeLocator.make("/worktrees/real-git-promotion")
  })
  const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit,
    candidateText: IntegratorCandidateText.make("real-git-promotion-candidate"),
    run: IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: IntegratorCorrelation.make({
        acceptedResult,
        candidateResource: IntegratorCandidateResourceLocator.make("real-git-promotion-resource"),
        expectedTargetHead: expectedHead,
        integrationTarget: target,
        plannedAttempt,
        queuedAt: JournalPosition.make(1),
        sessionId: IntegratorSessionId.make("real-git-promotion-session"),
        startedAt: JournalPosition.make(2),
        targetLineageObservedAt: JournalPosition.make(3)
      })
    }),
    directParents: [expectedHead, acceptedResultCommit],
    qualifiedAt: JournalPosition.make(4)
  })
  return targetPromotionCorrelationFor(qualifiedCandidate)
}

const scriptedTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/target-promotion.git")
})
const scriptedCorrelation = promotionCorrelationFor(
  scriptedTarget,
  GitCommitSha.make("1".repeat(40)),
  GitCommitSha.make("2".repeat(40)),
  GitCommitSha.make("3".repeat(40))
)
const scriptedRequest = targetPromotionGitRequestFor(scriptedCorrelation)

const scriptedTargetPromotion = <A>(
  operation: (git: TargetPromotionGitService) => Effect.Effect<A, unknown>,
  responses: ReadonlyArray<GitCommandResult>
) =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make(responses)
    const commands = GitCommand.of({
      run: () =>
        Ref.modify(remaining, ([next, ...rest]) => [
          next ?? GitCommandResult.make({ exitCode: 2, stderr: "missing scripted response", stdout: "" }),
          rest
        ]),
      runBytesInWorktree: () => Effect.die("unused"),
      runInWorktree: () => Effect.die("unused")
    })
    return yield* Effect.gen(function* () {
      const git = yield* TargetPromotionGit
      return yield* operation(git)
    }).pipe(Effect.provide(nodeGitTargetPromotionLayer), Effect.provide(Layer.succeed(GitCommand, commands)))
  })

const targetPromotionTransportFailureAfter = (responses: ReadonlyArray<GitCommandResult>) =>
  Effect.gen(function* () {
    const call = yield* Ref.make(0)
    const commands = GitCommand.of({
      run: () =>
        Ref.getAndUpdate(call, (current) => current + 1).pipe(
          Effect.flatMap((index) => {
            const response = responses[index]
            return response === undefined
              ? Effect.fail(new GitCommandInvocationFailure({ detail: `transport failed at call ${index + 1}` }))
              : Effect.succeed(response)
          })
        ),
      runBytesInWorktree: () => Effect.die("unused"),
      runInWorktree: () => Effect.die("unused")
    })
    return yield* Effect.gen(function* () {
      const git = yield* TargetPromotionGit
      return yield* git.read(scriptedRequest)
    }).pipe(
      Effect.provide(nodeGitTargetPromotionLayer),
      Effect.provide(Layer.succeed(GitCommand, commands)),
      Effect.flip
    )
  })

it.effect("types target promotion transport, malformed, indeterminate, and contradictory Git outcomes", () =>
  Effect.gen(function* () {
    expect(yield* targetPromotionTransportFailureAfter([])).toMatchObject({
      _tag: "TargetPromotionGitReadFailure",
      detail: "transport failed at call 1"
    })
    expect(
      yield* targetPromotionTransportFailureAfter([
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: scriptedRequest.expectedTargetHead })
      ])
    ).toMatchObject({ _tag: "TargetPromotionGitReadFailure", detail: "transport failed at call 2" })

    const targetReadTransport = yield* scriptedTargetPromotion((git) => git.read(scriptedRequest), []).pipe(Effect.flip)
    expect(targetReadTransport).toMatchObject({
      _tag: "TargetPromotionGitReadFailure",
      detail: "missing scripted response"
    })

    const invalidTarget = yield* scriptedTargetPromotion(
      (git) => git.read(scriptedRequest),
      [GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "not-a-commit" })]
    ).pipe(Effect.flip)
    expect(invalidTarget).toMatchObject({ _tag: "TargetPromotionGitReadFailure", target: scriptedTarget })

    const ancestryTransport = yield* scriptedTargetPromotion(
      (git) => git.read(scriptedRequest),
      [
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: scriptedRequest.expectedTargetHead }),
        GitCommandResult.make({ exitCode: 2, stderr: "ancestry unavailable", stdout: "" })
      ]
    ).pipe(Effect.flip)
    expect(ancestryTransport).toMatchObject({ detail: "ancestry unavailable" })

    const ancestryWithoutDiagnostic = yield* scriptedTargetPromotion(
      (git) => git.read(scriptedRequest),
      [
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: scriptedRequest.expectedTargetHead }),
        GitCommandResult.make({ exitCode: 2, stderr: "", stdout: "" })
      ]
    ).pipe(Effect.flip)
    expect(ancestryWithoutDiagnostic).toMatchObject({ detail: "git exited 2" })

    const compareTransport = yield* scriptedTargetPromotion((git) => git.compareAndSet(scriptedRequest), []).pipe(
      Effect.flip
    )
    expect(compareTransport).toMatchObject({
      _tag: "TargetPromotionCompareAndSetFailure",
      expectedHead: scriptedRequest.expectedTargetHead
    })

    const stillExpected = yield* scriptedTargetPromotion(
      (git) => git.compareAndSet(scriptedRequest),
      [
        GitCommandResult.make({ exitCode: 1, stderr: "stale compare-and-set", stdout: "" }),
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: scriptedRequest.expectedTargetHead })
      ]
    ).pipe(Effect.flip)
    expect(stillExpected).toMatchObject({
      _tag: "TargetPromotionCompareAndSetFailure",
      detail: "stale compare-and-set"
    })

    const stillExpectedWithoutDiagnostic = yield* scriptedTargetPromotion(
      (git) => git.compareAndSet(scriptedRequest),
      [
        GitCommandResult.make({ exitCode: 1, stderr: "", stdout: "" }),
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: scriptedRequest.expectedTargetHead })
      ]
    ).pipe(Effect.flip)
    expect(stillExpectedWithoutDiagnostic).toMatchObject({
      detail: "Git rejected compare-and-set while the expected head remained current"
    })

    const unreadableAfterReject = yield* scriptedTargetPromotion(
      (git) => git.compareAndSet(scriptedRequest),
      [
        GitCommandResult.make({ exitCode: 1, stderr: "stale compare-and-set", stdout: "" }),
        GitCommandResult.make({ exitCode: 1, stderr: "target unreadable", stdout: "" })
      ]
    ).pipe(Effect.flip)
    expect(unreadableAfterReject).toMatchObject({ _tag: "TargetPromotionCompareAndSetFailure" })
    if (unreadableAfterReject instanceof TargetPromotionCompareAndSetFailure) {
      expect(unreadableAfterReject.detail).toContain("unable to reconcile current target: target unreadable")
    }

    const unreadableWithoutDiagnostic = yield* scriptedTargetPromotion(
      (git) => git.compareAndSet(scriptedRequest),
      [
        GitCommandResult.make({ exitCode: 1, stderr: "", stdout: "" }),
        GitCommandResult.make({ exitCode: 1, stderr: "", stdout: "" })
      ]
    ).pipe(Effect.flip)
    expect(unreadableWithoutDiagnostic).toMatchObject({
      detail: expect.stringContaining("git update-ref exited 1; unable to reconcile current target: git exited 1")
    })
  })
)

const setupMerge = Effect.fn("RealGitQualification.setupMerge")(function* (repository: Repository) {
  yield* repository.run("commit", "--allow-empty", "-m", "base")
  const base = GitCommitSha.make(yield* repository.run("rev-parse", "HEAD"))
  yield* repository.run("checkout", "-b", "accepted")
  yield* repository.run("commit", "--allow-empty", "-m", "accepted")
  const accepted = GitCommitSha.make(yield* repository.run("rev-parse", "HEAD"))
  yield* repository.run("checkout", "main")
  yield* repository.run("commit", "--allow-empty", "-m", "target")
  const targetHead = GitCommitSha.make(yield* repository.run("rev-parse", "HEAD"))
  yield* repository.run("checkout", "-b", "candidate")
  yield* repository.run("merge", "--no-ff", "--no-edit", "accepted")
  const candidate = GitCommitSha.make(yield* repository.run("rev-parse", "HEAD"))
  yield* repository.run("commit", "--allow-empty", "-m", "candidate descendant")
  const candidateDescendant = GitCommitSha.make(yield* repository.run("rev-parse", "HEAD"))
  yield* repository.run("checkout", "main")
  yield* repository.run("checkout", "-b", "concurrent", targetHead)
  yield* repository.run("commit", "--allow-empty", "-m", "concurrent")
  const concurrentHead = GitCommitSha.make(yield* repository.run("rev-parse", "HEAD"))
  yield* repository.run("checkout", "main")
  return { accepted, base, candidate, candidateDescendant, concurrentHead, targetHead }
})

it.effect("reads real compatible, equivalent-content, rewritten, and unrelated target lineage without mutation", () =>
  Effect.scoped(
    withRepository(({ gitDirectory, run }) =>
      Effect.gen(function* () {
        yield* run("commit", "--allow-empty", "-m", "base")
        const base = GitCommitSha.make(yield* run("rev-parse", "HEAD"))
        const baseTree = yield* run("rev-parse", `${base}^{tree}`)
        yield* run("commit", "--allow-empty", "-m", "target")
        const targetHead = GitCommitSha.make(yield* run("rev-parse", "HEAD"))
        yield* run("checkout", "-b", "concurrent")
        yield* run("commit", "--allow-empty", "-m", "concurrent")
        const concurrentHead = GitCommitSha.make(yield* run("rev-parse", "HEAD"))
        yield* run("checkout", "main")
        yield* run("checkout", "--orphan", "unrelated")
        yield* run("commit", "--allow-empty", "-m", "unrelated")
        const unrelatedHead = GitCommitSha.make(yield* run("rev-parse", "HEAD"))
        yield* run("checkout", "main")

        const target = IntegrationTarget.make({
          ref: IntegrationTargetRef.make("refs/heads/main"),
          repository: gitDirectory
        })
        const lineage = yield* GitTargetLineage
        expect(yield* lineage.read(base, target)).toEqual({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: base,
          targetHeadSha: targetHead
        })

        yield* run("update-ref", target.ref, concurrentHead)
        expect(yield* lineage.read(base, target)).toEqual({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: base,
          targetHeadSha: concurrentHead
        })

        yield* run("update-ref", target.ref, unrelatedHead)
        expect(yield* lineage.read(base, target)).toEqual({
          plannedBaseIsAncestorOfTargetHead: false,
          plannedBaseSha: base,
          targetHeadSha: unrelatedHead
        })
        yield* run("checkout", "--orphan", "equivalent-content")
        yield* run("commit", "--allow-empty", "-m", "equivalent content")
        const equivalentContentHead = GitCommitSha.make(yield* run("rev-parse", "HEAD"))
        expect(yield* run("rev-parse", `${equivalentContentHead}^{tree}`)).toBe(baseTree)
        yield* run("update-ref", target.ref, equivalentContentHead)
        expect(yield* lineage.read(base, target)).toEqual({
          plannedBaseIsAncestorOfTargetHead: false,
          plannedBaseSha: base,
          targetHeadSha: equivalentContentHead
        })
        const contradictory = yield* lineage.read(GitCommitSha.make("0".repeat(40)), target).pipe(Effect.flip)
        expect(contradictory).toBeInstanceOf(GitTargetLineageReadFailure)
        expect(yield* run("rev-parse", target.ref)).toBe(equivalentContentHead)
      }).pipe(Effect.provide(nodeLineageLayer))
    )
  )
)

it.effect("reads real candidate objects and preserves exact ordered parents and typed negative observations", () =>
  Effect.scoped(
    withRepository(({ gitDirectory, run }) =>
      Effect.gen(function* () {
        const { accepted, base, candidate, targetHead } = yield* setupMerge({ gitDirectory, run })
        const tree = GitCommitSha.make(yield* run("rev-parse", `${candidate}^{tree}`))
        const missing = GitCommitSha.make("0".repeat(40))
        const git = yield* IntegrationCandidateGit

        expect(yield* git.readSubmittedCommit(gitDirectory, candidate)).toEqual({
          _tag: "Commit",
          directParents: [targetHead, accepted]
        })
        expect(yield* git.readSubmittedCommit(gitDirectory, accepted)).toEqual({
          _tag: "Commit",
          directParents: [base]
        })
        expect(yield* git.readSubmittedCommit(gitDirectory, tree)).toEqual({ _tag: "NonCommit", objectType: "tree" })
        expect(yield* git.readSubmittedCommit(gitDirectory, missing)).toEqual({ _tag: "Missing" })
        expect(yield* run("rev-parse", "refs/heads/main")).toBe(targetHead)
        expect(
          yield* git
            .readSubmittedCommit(GitRepositoryLocator.make(`${gitDirectory}/missing`), candidate)
            .pipe(Effect.flip)
        ).toBeInstanceOf(IntegrationCandidateGitReadFailure)
      }).pipe(Effect.provide(nodeCandidateLayer))
    )
  )
)

it.effect(
  "applies a real exact-head compare-and-set and reconciles an applied update whose response was lost before retry",
  () =>
    Effect.scoped(
      withRepository(({ gitDirectory, run }) =>
        Effect.gen(function* () {
          const { accepted, candidate, candidateDescendant, concurrentHead, targetHead } = yield* setupMerge({
            gitDirectory,
            run
          })
          const target = IntegrationTarget.make({
            ref: IntegrationTargetRef.make("refs/heads/main"),
            repository: gitDirectory
          })
          const correlation = promotionCorrelationFor(target, targetHead, accepted, candidate)
          const request = targetPromotionGitRequestFor(correlation)
          yield* Effect.gen(function* () {
            const git = yield* TargetPromotionGit
            expect(yield* git.read(request)).toEqual(
              TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: targetHead })
            )
            expect(yield* git.compareAndSet(request)).toEqual(
              TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidate })
            )
            expect(yield* run("rev-parse", target.ref)).toBe(candidate)

            yield* run("update-ref", target.ref, concurrentHead)
            expect(yield* git.compareAndSet(request)).toEqual(
              TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({ observedHeadSha: concurrentHead })
            )
            expect(yield* run("rev-parse", target.ref)).toBe(concurrentHead)

            yield* run("update-ref", target.ref, candidateDescendant)
            expect(yield* git.read(request)).toEqual(
              TargetPromotionGitReadObservation.cases.CandidateAncestor.make({ currentHeadSha: candidateDescendant })
            )

            const missingTarget = IntegrationTarget.make({
              ref: IntegrationTargetRef.make("refs/heads/missing"),
              repository: gitDirectory
            })
            const unreadable = yield* git
              .read(
                targetPromotionGitRequestFor(promotionCorrelationFor(missingTarget, targetHead, accepted, candidate))
              )
              .pipe(Effect.flip)
            expect(unreadable).toBeInstanceOf(TargetPromotionGitReadFailure)
          }).pipe(Effect.provide(nodeTargetPromotionLayer))

          yield* run("update-ref", target.ref, targetHead)
          const updateCalls = yield* Ref.make(0)
          const lostLayer = nodeGitTargetPromotionLayer.pipe(
            Layer.provide(makeResponseLossCommandLayer(updateCalls)),
            Layer.provide(NodeServices.layer)
          )
          const lost = yield* Effect.gen(function* () {
            const promotion = yield* TargetPromotionGit
            const failure = yield* promotion.compareAndSet(request).pipe(Effect.flip)
            expect(failure).toBeInstanceOf(TargetPromotionCompareAndSetFailure)
            expect(yield* promotion.read(request)).toEqual(
              TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: candidate })
            )
            return failure
          }).pipe(Effect.provide(lostLayer))
          expect(lost._tag).toBe("TargetPromotionCompareAndSetFailure")
          expect(yield* Ref.get(updateCalls)).toBe(1)
          expect(yield* run("rev-parse", target.ref)).toBe(candidate)
        })
      )
    )
)

const makeResponseLossCommandLayer = (updateCalls: Ref.Ref<number>) =>
  Layer.effect(
    GitCommand,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const runCommand = (args: ReadonlyArray<string>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(ChildProcess.make("git", args))
            const [exitCode, stderr, stdout] = yield* Effect.all(
              [
                handle.exitCode,
                handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
                handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
              ],
              { concurrency: "unbounded" }
            )
            return GitCommandResult.make({ exitCode, stderr, stdout })
          })
        ).pipe(Effect.mapError((failure) => new GitCommandInvocationFailure({ detail: String(failure) })))
      return GitCommand.of({
        run: (gitDirectory, args) =>
          Effect.gen(function* () {
            const result = yield* runCommand([`--git-dir=${gitDirectory}`, ...args])
            if (args[0] !== "update-ref" || result.exitCode !== 0) return result
            const call = yield* Ref.updateAndGet(updateCalls, (count) => count + 1)
            if (call === 1) return yield* new GitCommandInvocationFailure({ detail: "response lost" })
            return result
          }),
        runInWorktree: () => Effect.die("unused"),
        runBytesInWorktree: () => Effect.die("unused")
      })
    })
  )
