import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
import { expect } from "vitest"
import { GitCommandInvocationFailure, type GitCommandService } from "../../../authorities/git/command.js"
import { probePath, parseWorktreeRecords, missingReference, nonGitPath, resultDetail } from "./boundary-evidence.js"

const head = "1111111111111111111111111111111111111111"

it("classifies valid, duplicate, unknown, and malformed Git worktree records", () => {
  expect(
    parseWorktreeRecords(
      `worktree /tmp/cleanup-p1\nHEAD ${head}\nbranch refs/heads/cleanup-p1\n\nworktree /tmp/cleanup-p2\nHEAD ${head}\n`
    )
  ).toEqual({
    _tag: "Valid",
    records: [
      { branch: "refs/heads/cleanup-p1", head, worktree: "/tmp/cleanup-p1" },
      { head, worktree: "/tmp/cleanup-p2" }
    ]
  })

  const malformed = [
    "bare",
    "unknown field value",
    `worktree /tmp/cleanup-p1\nworktree /tmp/cleanup-p2\nHEAD ${head}`,
    `worktree /tmp/cleanup-p1\nHEAD ${head}\nHEAD ${head}`,
    `worktree /tmp/cleanup-p1\nHEAD ${head}\nbranch refs/heads/cleanup-p1\n\nworktree /tmp/cleanup-p1\nHEAD ${head}`,
    `worktree /tmp/cleanup-p1\nHEAD ${head}\nbranch refs/heads/cleanup-p1\n\nworktree /tmp/cleanup-p2\nHEAD ${head}\nbranch refs/heads/cleanup-p1`,
    "worktree /tmp/cleanup-p1\nHEAD not-a-commit"
  ]
  for (const stdout of malformed) expect(parseWorktreeRecords(stdout)._tag).toBe("Malformed")
})

it("classifies Git stderr and exit results without inventing absence", () => {
  expect(resultDetail("  fatal: unavailable  ", 2)).toBe("fatal: unavailable")
  expect(resultDetail("", 2)).toBe("git exited 2")
  expect(missingReference("fatal: refs/heads/old is not a valid ref")).toBe(true)
  expect(missingReference("fatal: permission denied")).toBe(false)
  expect(nonGitPath("fatal: not a git repository")).toBe(true)
  expect(nonGitPath("fatal: permission denied")).toBe(false)
})

it.effect("probes missing and existing paths before interpreting Git responses", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-cleanup-probe-" })
      const existing = `${root}/existing`
      const missing = `${root}/missing`
      yield* fileSystem.makeDirectory(existing)

      const command = (
        result: Effect.Effect<
          { readonly exitCode: number; readonly stderr: string; readonly stdout: string },
          GitCommandInvocationFailure
        >
      ): GitCommandService => ({
        run: () => Effect.die("probePath must not call run"),
        runInWorktree: () => result,
        runBytesInWorktree: () => Effect.die("probePath must not call runBytesInWorktree")
      })

      expect(
        (yield* probePath(
          fileSystem,
          command(Effect.succeed({ exitCode: 0, stderr: "", stdout: "true" })),
          missing,
          []
        ))._tag
      ).toBe("Absent")
      expect(
        yield* probePath(fileSystem, command(Effect.succeed({ exitCode: 0, stderr: "", stdout: "true" })), existing, [])
      ).toEqual({ _tag: "Present", result: { exitCode: 0, stderr: "", stdout: "true" } })
      expect(
        yield* probePath(
          fileSystem,
          command(Effect.succeed({ exitCode: 2, stderr: "not a git repository", stdout: "" })),
          existing,
          []
        )
      ).toEqual({ _tag: "Present", result: { exitCode: 2, stderr: "not a git repository", stdout: "" } })
      expect(
        yield* probePath(
          fileSystem,
          command(Effect.fail(new GitCommandInvocationFailure({ detail: "response lost" }))),
          existing,
          []
        )
      ).toEqual({ _tag: "Present", result: { failure: "response lost" } })
      expect(
        (yield* probePath(
          fileSystem,
          command(Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })),
          `${root}\u0000`,
          []
        ))._tag
      ).toBe("Unreadable")
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
