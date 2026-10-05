import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import { GitCommitSha, GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { GitCommand, GitCommandResult, nodeGitCommandLayer } from "./command.js"
import { nodeGitTargetPromotionLayer } from "./target-promotion.js"
import { TargetPromotionGit, TargetPromotionGitRequest } from "../../workflow/protocols/target-promotion/events.js"

const nativeLayer = nodeGitTargetPromotionLayer.pipe(
  Layer.provideMerge(nodeGitCommandLayer),
  Layer.provideMerge(NodeServices.layer)
)

const fixture = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const commands = yield* GitCommand
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-promotion-safety-" })
  const source = `${root}/source`
  yield* fileSystem.makeDirectory(source)
  const git = Effect.fn("PromotionSafetyTest.git")(function* (directory: string, ...args: ReadonlyArray<string>) {
    const result = yield* commands.runInWorktree(directory, args)
    expect(result.exitCode, result.stderr).toBe(0)
    return result.stdout
  })
  yield* git(source, "init", "--initial-branch=main")
  yield* git(source, "config", "user.email", "dalph@example.invalid")
  yield* git(source, "config", "user.name", "Dalph safety fixture")
  yield* fileSystem.writeFileString(`${source}/file`, "base\n")
  yield* git(source, "add", "file")
  yield* git(source, "commit", "-m", "base")
  const expectedTargetHead = GitCommitSha.make((yield* git(source, "rev-parse", "HEAD")).trim())
  yield* fileSystem.writeFileString(`${source}/file`, "candidate\n")
  yield* git(source, "commit", "-am", "candidate")
  const candidateCommit = GitCommitSha.make((yield* git(source, "rev-parse", "HEAD")).trim())
  yield* git(source, "checkout", "--detach", candidateCommit)
  yield* git(source, "branch", "integration", expectedTargetHead)
  const request = TargetPromotionGitRequest.make({
    candidateCommit,
    expectedTargetHead,
    integrationTarget: IntegrationTarget.make({
      repository: GitRepositoryLocator.make(`${source}/.git`),
      ref: IntegrationTargetRef.make("refs/heads/integration")
    })
  })
  return { commands, fileSystem, git, request, root, source }
})

it.effect("promotes an unoccupied direct ref with the exact expected head", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { git, request, source } = yield* fixture
      const promotion = yield* TargetPromotionGit
      expect(yield* promotion.read(request)).toMatchObject({ _tag: "CandidateNotInAncestry" })
      expect(yield* promotion.compareAndSet(request)).toEqual({ _tag: "Applied", newHeadSha: request.candidateCommit })
      expect((yield* git(source, "rev-parse", request.integrationTarget.ref)).trim()).toBe(request.candidateCommit)
      // A checkout appearing after an applied write does not turn reconciliation into another mutation.
      yield* git(source, "checkout", "integration")
      expect(yield* promotion.read(request)).toEqual({
        _tag: "CandidateCurrent",
        currentHeadSha: request.candidateCommit
      })
    })
  ).pipe(Effect.provide(nativeLayer))
)

it.effect("refuses clean and dirty occupied targets without changing refs, index or files", () =>
  Effect.gen(function* () {
    for (const location of ["main", "linked"] as const) {
      for (const state of ["clean", "staged", "unstaged", "untracked"] as const) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { fileSystem, git, request, root, source } = yield* fixture
            const worktree = location === "main" ? source : `${root}/linked`
            yield* location === "main"
              ? git(source, "checkout", "integration")
              : git(source, "worktree", "add", worktree, "integration")
            if (state === "staged" || state === "unstaged") {
              yield* fileSystem.writeFileString(`${worktree}/file`, "Alice's work\n")
              if (state === "staged") yield* git(worktree, "add", "file")
            }
            if (state === "untracked") yield* fileSystem.writeFileString(`${worktree}/untracked`, "retained\n")
            const observe = Effect.gen(function* () {
              return {
                head: yield* git(source, "rev-parse", request.integrationTarget.ref),
                index: yield* git(worktree, "ls-files", "--stage", "-z"),
                status: yield* git(worktree, "status", "--porcelain", "-z"),
                file: yield* fileSystem.readFileString(`${worktree}/file`),
                untracked: state === "untracked" ? yield* fileSystem.readFileString(`${worktree}/untracked`) : undefined
              }
            })
            const before = yield* observe
            const promotion = yield* TargetPromotionGit
            for (const failure of [
              yield* promotion.read(request).pipe(Effect.flip),
              yield* promotion.compareAndSet(request).pipe(Effect.flip)
            ]) {
              expect(failure).toMatchObject({
                _tag: "TargetPromotionSafetyFailure",
                refusal: { _tag: "OccupiedWorktree", worktree }
              })
            }
            expect(yield* observe).toEqual(before)
          })
        ).pipe(Effect.provide(nativeLayer))
      }
    }
  })
)

const head = GitCommitSha.make("1".repeat(40))
const request = TargetPromotionGitRequest.make({
  candidateCommit: GitCommitSha.make("2".repeat(40)),
  expectedTargetHead: head,
  integrationTarget: IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/controlled.git"),
    ref: IntegrationTargetRef.make("refs/heads/integration")
  })
})
const safeInventory = "worktree /controlled.git\0bare\0\0"
const direct = GitCommandResult.make({ exitCode: 1, stderr: "", stdout: "" })

it.effect("refuses unreadable inventory and non-direct targets before mutation", () =>
  Effect.gen(function* () {
    for (const [identity, inventory, expected] of [
      [direct, "", "InventoryUnreadable"],
      [direct, "worktree /x\0branch refs/heads/integration\0\0", "InventoryUnreadable"],
      [direct, `${safeInventory}${safeInventory}`, "InventoryUnreadable"],
      [direct, "worktree /x\0HEAD bad\0detached\0\0", "InventoryUnreadable"],
      [
        GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "refs/heads/other\n" }),
        safeInventory,
        "TargetIdentityUnreadable"
      ],
      [
        GitCommandResult.make({ exitCode: 128, stderr: "unreadable", stdout: "" }),
        safeInventory,
        "TargetIdentityUnreadable"
      ]
    ] as const) {
      const writes = yield* Ref.make(0)
      const commands = GitCommand.of({
        run: (_directory, args) =>
          args[0] === "symbolic-ref"
            ? Effect.succeed(identity)
            : args[0] === "worktree"
              ? Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: inventory }))
              : Ref.update(writes, (value) => value + 1).pipe(
                  Effect.as(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "" }))
                ),
        runInWorktree: () => Effect.die("unused"),
        runBytesInWorktree: () => Effect.die("unused")
      })
      const failure = yield* Effect.gen(function* () {
        return yield* (yield* TargetPromotionGit).compareAndSet(request).pipe(Effect.flip)
      }).pipe(Effect.provide(nodeGitTargetPromotionLayer), Effect.provideService(GitCommand, commands))
      expect(failure).toMatchObject({ _tag: "TargetPromotionSafetyFailure", refusal: { _tag: expected } })
      expect(yield* Ref.get(writes)).toBe(0)
    }
  })
)

it.effect("rechecks occupancy at the mutation boundary and preserves exact-head rejection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { git, request, source } = yield* fixture
      const promotion = yield* TargetPromotionGit
      yield* promotion.read(request)
      yield* git(source, "checkout", "integration")
      expect(yield* promotion.compareAndSet(request).pipe(Effect.flip)).toMatchObject({
        _tag: "TargetPromotionSafetyFailure",
        refusal: { _tag: "OccupiedWorktree" }
      })
      yield* git(source, "checkout", "--detach", request.candidateCommit)
      yield* git(
        source,
        "update-ref",
        request.integrationTarget.ref,
        request.candidateCommit,
        request.expectedTargetHead
      )
      expect(yield* promotion.compareAndSet(request)).toEqual({
        _tag: "RejectedExpectedHead",
        observedHeadSha: request.candidateCommit
      })
    })
  ).pipe(Effect.provide(nativeLayer))
)
