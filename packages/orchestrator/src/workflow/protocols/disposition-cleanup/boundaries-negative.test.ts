import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer } from "effect"
import { expect } from "vitest"
import { WorktreeLocator, GitCommitSha } from "@dalph/contracts"
import { CoordinatorOwnership, GitCommonDirectoryTarget } from "../../../authorities/coordinator-ownership/ownership.js"
import {
  GitCommand,
  GitCommandInvocationFailure,
  type GitCommandResult,
  type GitCommandService
} from "../../../authorities/git/command.js"
import { BranchCleanupBoundary } from "./branch.js"
import { gitDispositionCleanupBoundaryLayer } from "./boundaries.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  CleanupMutationOrdinal
} from "./disposition.js"
import { WorktreeCleanupBoundary } from "./worktree.js"
import { authorization, attempt, baseSha } from "./fixtures.js"

const target = GitCommonDirectoryTarget.make("/tmp/issue-69-negative-boundaries.git")
const ownerLayer = Layer.succeed(
  CoordinatorOwnership,
  CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
)

const result = (stdout = "", exitCode = 0, stderr = ""): GitCommandResult => ({ exitCode, stderr, stdout })
const failed = (detail: string) => Effect.fail(new GitCommandInvocationFailure({ detail }))

const commandsFor = (input: {
  readonly list?: Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
  readonly ref?: Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
  readonly path?: Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
  readonly mutation?: Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
}): GitCommandService => ({
  run: (_directory, args) =>
    args[0] === "worktree" && args[1] === "list"
      ? (input.list ?? Effect.succeed(result()))
      : args[0] === "show-ref"
        ? (input.ref ?? Effect.succeed(result(baseSha)))
        : (input.mutation ?? Effect.succeed(result())),
  runInWorktree: () => input.path ?? Effect.succeed(result()),
  runBytesInWorktree: () => Effect.die("byte command is outside cleanup boundary qualification")
})

const withBoundaries = <A, E, R>(commands: GitCommandService, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(gitDispositionCleanupBoundaryLayer(target)),
    Effect.provide(Layer.succeed(GitCommand, commands)),
    Effect.provide(ownerLayer),
    Effect.provide(NodeServices.layer)
  )

const branchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId],
  disposition: authorization.disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(Number(authorization.evidenceRevision)),
  expectedHead: authorization.expectedHead,
  locator: authorization.owner.branch,
  observationAt: authorization.observationAt,
  observationOperationId: authorization.observationOperationId,
  operationId: authorization.operationId,
  owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
  worktreeCleanupOperationId: authorization.operationId,
  writerQuiescent: true
})

const branchForWorktree = (worktree: string) =>
  BranchCleanupAuthorization.make({
    ...branchAuthorization,
    disposition: {
      ...branchAuthorization.disposition,
      plannedAttempt: { ...branchAuthorization.disposition.plannedAttempt, worktree: WorktreeLocator.make(worktree) }
    }
  })

it.effect("preserves every Git worktree observation that is not exact and present", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-cleanup-boundary-negative-" })
      const existing = `${root}/existing`
      const missing = `${root}/missing`
      yield* fileSystem.makeDirectory(existing)
      const worktree = (locator: string) => ({ ...authorization, locator: WorktreeLocator.make(locator) })
      const cases: ReadonlyArray<
        readonly [string, GitCommandService, "Absent" | "Foreign" | "Unregistered" | "Unreadable"]
      > = [
        ["list failure", commandsFor({ list: failed("list response lost") }), "Unreadable"],
        ["list exit", commandsFor({ list: Effect.succeed(result("", 2, "permission denied")) }), "Unreadable"],
        [
          "malformed list",
          commandsFor({ list: Effect.succeed(result("worktree /tmp/a\nHEAD not-a-commit\n")) }),
          "Unreadable"
        ],
        ["missing path", commandsFor({ list: Effect.succeed(result()) }), "Absent"],
        ["path command failure", commandsFor({ path: failed("path response lost") }), "Unreadable"],
        ["plain path", commandsFor({ path: Effect.succeed(result("", 1, "not a git repository")) }), "Unregistered"],
        ["successful path probe", commandsFor({ path: Effect.succeed(result("true")) }), "Unregistered"],
        [
          "unreadable path probe",
          commandsFor({ path: Effect.succeed(result("", 1, "permission denied")) }),
          "Unreadable"
        ],
        ["unreadable stat", commandsFor({}), "Unreadable"],
        [
          "foreign branch",
          commandsFor({
            list: Effect.succeed(
              result(`worktree ${authorization.locator}\nHEAD ${baseSha}\nbranch refs/heads/foreign\n\n`)
            )
          }),
          "Foreign"
        ],
        [
          "foreign head",
          commandsFor({
            list: Effect.succeed(
              result(
                `worktree ${authorization.locator}\nHEAD ${GitCommitSha.make("2".repeat(40))}\nbranch ${authorization.owner.branch}\n\n`
              )
            )
          }),
          "Foreign"
        ],
        [
          "registered record without branch",
          commandsFor({ list: Effect.succeed(result(`worktree ${authorization.locator}\nHEAD ${baseSha}\n\n`)) }),
          "Foreign"
        ]
      ]
      for (const [name, commands, expected] of cases) {
        const path =
          name === "unreadable stat"
            ? `${root}\u0000`
            : name.includes("missing")
              ? missing
              : name.includes("path") || name.includes("plain")
                ? existing
                : authorization.locator
        const observedAuthorization = worktree(path)
        const observed = yield* withBoundaries(
          commands,
          Effect.gen(function* () {
            return yield* (yield* WorktreeCleanupBoundary).observe(observedAuthorization)
          })
        )
        expect(observed._tag, name).toBe(expected)
      }
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("classifies worktree mutation success, command failure, and nonzero results", () =>
  Effect.gen(function* () {
    const success = yield* withBoundaries(
      commandsFor({ mutation: Effect.succeed(result()) }),
      Effect.gen(function* () {
        return yield* (yield* WorktreeCleanupBoundary).remove(authorization, CleanupMutationOrdinal.make(1))
      })
    )
    expect(success._tag).toBe("Removed")
    const unknown = yield* withBoundaries(
      commandsFor({ mutation: Effect.succeed(result("", 2, "permission denied")) }),
      Effect.gen(function* () {
        return yield* (yield* WorktreeCleanupBoundary).remove(authorization, CleanupMutationOrdinal.make(1))
      })
    )
    expect(unknown._tag).toBe("Unknown")
    const failedResult = yield* withBoundaries(
      commandsFor({ mutation: failed("mutation response lost") }),
      Effect.gen(function* () {
        return yield* (yield* WorktreeCleanupBoundary).remove(authorization, CleanupMutationOrdinal.make(1))
      })
    )
    expect(failedResult._tag).toBe("Unknown")
  })
)

it.effect("preserves every branch observation that is not exact and removable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-branch-boundary-negative-" })
      const existing = `${root}/existing`
      const missing = `${root}/missing`
      yield* fileSystem.makeDirectory(existing)
      const validList = `worktree ${existing}\nHEAD ${baseSha}\nbranch ${authorization.owner.branch}\n\n`
      const cases: ReadonlyArray<
        readonly [string, GitCommandService, "Present" | "Absent" | "Foreign" | "Unreadable"]
      > = [
        ["ref failure", commandsFor({ ref: failed("ref response lost") }), "Unreadable"],
        ["ref error", commandsFor({ ref: Effect.succeed(result("", 2, "permission denied")) }), "Unreadable"],
        ["missing ref and path", commandsFor({ ref: Effect.succeed(result("", 1, "not a valid ref")) }), "Absent"],
        [
          "missing ref other path error",
          commandsFor({
            ref: Effect.succeed(result("", 1, "permission denied")),
            path: Effect.succeed(result("", 1, "permission denied"))
          }),
          "Unreadable"
        ],
        [
          "missing ref path error",
          commandsFor({
            ref: Effect.succeed(result("", 1, "not a valid ref")),
            path: Effect.succeed(result("", 1, "permission denied"))
          }),
          "Unreadable"
        ],
        [
          "missing ref with registered path",
          commandsFor({ ref: Effect.succeed(result("", 1, "not a valid ref")), path: Effect.succeed(result("true")) }),
          "Unreadable"
        ],
        [
          "missing ref path failure",
          commandsFor({ ref: Effect.succeed(result("", 1, "not a valid ref")), path: failed("path response lost") }),
          "Unreadable"
        ],
        [
          "missing ref plain path",
          commandsFor({
            ref: Effect.succeed(result("", 1, "not a valid ref")),
            path: Effect.succeed(result("", 1, "not a git repository"))
          }),
          "Unreadable"
        ],
        ["malformed ref head", commandsFor({ ref: Effect.succeed(result("not-a-commit")) }), "Unreadable"],
        ["worktree list failure", commandsFor({ list: failed("list response lost") }), "Unreadable"],
        [
          "worktree list error",
          commandsFor({ list: Effect.succeed(result("", 2, "permission denied")) }),
          "Unreadable"
        ],
        [
          "malformed worktree list",
          commandsFor({ list: Effect.succeed(result("worktree /tmp/a\nHEAD not-a-commit\n")) }),
          "Unreadable"
        ],
        ["registered worktree", commandsFor({ list: Effect.succeed(result(validList)) }), "Foreign"],
        [
          "foreign head",
          commandsFor({
            ref: Effect.succeed(result(GitCommitSha.make("2".repeat(40)))),
            path: Effect.succeed(result("", 1, "not a git repository"))
          }),
          "Foreign"
        ],
        ["present branch", commandsFor({ path: Effect.succeed(result("", 1, "not a git repository")) }), "Present"],
        ["present branch with existing Git worktree", commandsFor({ path: Effect.succeed(result("true")) }), "Foreign"],
        ["existing path command failure", commandsFor({ path: failed("path response lost") }), "Unreadable"],
        [
          "existing path plain",
          commandsFor({ path: Effect.succeed(result("", 1, "not a git repository")) }),
          "Unreadable"
        ],
        [
          "existing path error",
          commandsFor({ path: Effect.succeed(result("", 1, "permission denied")) }),
          "Unreadable"
        ],
        [
          "unreadable stat missing ref",
          commandsFor({ ref: Effect.succeed(result("", 1, "not a valid ref")) }),
          "Unreadable"
        ],
        ["unreadable stat present ref", commandsFor({}), "Unreadable"]
      ]
      for (const [name, commands, expected] of cases) {
        const path =
          name === "unreadable stat missing ref" || name === "unreadable stat present ref"
            ? `${root}\u0000`
            : name === "missing ref and path" || name === "foreign head" || name === "present branch"
              ? missing
              : existing
        const observed = yield* withBoundaries(
          commands,
          Effect.gen(function* () {
            return yield* (yield* BranchCleanupBoundary).observe(branchForWorktree(path))
          })
        )
        expect(observed._tag, name).toBe(expected)
      }
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("classifies branch mutation success, command failure, and nonzero results", () =>
  Effect.gen(function* () {
    const success = yield* withBoundaries(
      commandsFor({ mutation: Effect.succeed(result()) }),
      Effect.gen(function* () {
        return yield* (yield* BranchCleanupBoundary).remove(branchAuthorization, CleanupMutationOrdinal.make(1))
      })
    )
    expect(success._tag).toBe("Removed")
    const unknown = yield* withBoundaries(
      commandsFor({ mutation: Effect.succeed(result("", 2, "permission denied")) }),
      Effect.gen(function* () {
        return yield* (yield* BranchCleanupBoundary).remove(branchAuthorization, CleanupMutationOrdinal.make(1))
      })
    )
    expect(unknown._tag).toBe("Unknown")
    const failedResult = yield* withBoundaries(
      commandsFor({ mutation: failed("mutation response lost") }),
      Effect.gen(function* () {
        return yield* (yield* BranchCleanupBoundary).remove(branchAuthorization, CleanupMutationOrdinal.make(1))
      })
    )
    expect(failedResult._tag).toBe("Unknown")
  })
)
