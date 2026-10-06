import { GitCommitSha, GitRepositoryLocator, IntegrationTargetRef } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Duration, Effect, Layer } from "effect"
import * as fc from "fast-check"
import { expect } from "vitest"
import {
  GitCommand,
  GitCommandInvocationFailure,
  GitCommandResponseDeadline,
  GitCommandSenderStopUnproven
} from "./command.js"
import { GitTaskAttemptBase, nodeGitTaskAttemptBaseLayer } from "./task-attempt-base.js"
import type { AttemptBasePolicy } from "../../workflow/protocols/task-attempt-planning/base.js"

const anchor = GitCommitSha.make("1".repeat(40))
const policy: AttemptBasePolicy = {
  _tag: "QualifiedCurrentIntegrationHead",
  executionRepository: GitRepositoryLocator.make("/execution"),
  integrationTarget: {
    repository: GitRepositoryLocator.make("/exact-target.git"),
    ref: IntegrationTargetRef.make("refs/heads/master")
  },
  lineageAnchor: anchor
}
const response = (stdout = "", exitCode = 0, stderr = "") => ({ stdout, exitCode, stderr })
const readWith = (selectedPolicy: AttemptBasePolicy, results: ReadonlyArray<ReturnType<typeof response> | "Failure">) =>
  Effect.gen(function* () {
    const calls: Array<{ readonly repository: string; readonly args: ReadonlyArray<string> }> = []
    let next = 0
    const run = (repository: string, args: ReadonlyArray<string>) => {
      calls.push({ repository, args })
      const result = results[next++]
      if (result === undefined) return Effect.die("unexpected extra Git read")
      return result === "Failure"
        ? Effect.fail(new GitCommandInvocationFailure({ detail: "controlled unreadable boundary" }))
        : Effect.succeed(result)
    }
    const observation = yield* GitTaskAttemptBase.pipe(
      Effect.flatMap((reader) => reader.read(selectedPolicy)),
      Effect.provide(nodeGitTaskAttemptBaseLayer),
      Effect.provide(
        Layer.succeed(
          GitCommand,
          GitCommand.of({
            runBoundedInWorktree: run,
            runBoundedInRepository: (repository, args, budget) => {
              expect(Duration.toMillis(Duration.fromInputUnsafe(budget))).toBeGreaterThan(0)
              expect(Duration.toMillis(Duration.fromInputUnsafe(budget))).toBeLessThanOrEqual(30_000)
              return run(repository, args)
            },
            run: () => Effect.die("unbounded Git read"),
            runInWorktree: () => Effect.die("unbounded worktree read"),
            runBytesInWorktree: () => Effect.die("no byte read")
          })
        )
      )
    )
    return { calls, observation }
  })

it.effect("qualifies one immutable head from exact repositories without ref rereads or mutations", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 }), async (digits) => {
        const head = GitCommitSha.make(digits.map((digit) => digit.toString(16)).join(""))
        const { calls, observation } = await Effect.runPromise(
          readWith(policy, [response(head), response(), response()])
        )
        expect(observation).toEqual({ _tag: "Qualified", baseSha: head })
        expect(calls).toEqual([
          { repository: "/exact-target.git", args: ["rev-parse", "--verify", "--quiet", "refs/heads/master^{commit}"] },
          { repository: "/exact-target.git", args: ["merge-base", "--is-ancestor", anchor, head] },
          { repository: "/execution", args: ["cat-file", "-e", `${head}^{commit}`] }
        ])
      }),
      { numRuns: 40 }
    )
  )
)

it.effect("refuses each unreadable or incompatible boundary without crossing later boundaries", () =>
  Effect.gen(function* () {
    for (const testCase of [
      { results: ["Failure" as const], boundary: "TargetHead" },
      { results: [response("", 128)], boundary: "TargetHead" },
      { results: [response("invalid-head")], boundary: "TargetHead" },
      { results: [response(anchor), "Failure" as const], boundary: "AnchorAncestry" },
      { results: [response(anchor), response("", 1)], boundary: "AnchorAncestry" },
      { results: [response(anchor), response("", 128, "anchor unavailable")], boundary: "AnchorAncestry" },
      { results: [response(anchor), response(), "Failure" as const], boundary: "ExecutionCommit" },
      { results: [response(anchor), response(), response("", 128)], boundary: "ExecutionCommit" }
    ]) {
      const result = yield* readWith(policy, testCase.results)
      expect(result.observation).toMatchObject({ _tag: "Refused", boundary: testCase.boundary })
      expect(result.calls).toHaveLength(testCase.results.length)
    }
    expect(yield* readWith({ _tag: "ExplicitFixedBase", baseSha: anchor }, [])).toEqual({
      calls: [],
      observation: { _tag: "Qualified", baseSha: anchor }
    })
  })
)

it.effect("settles a proved deadline but retains an unproven Git child as a typed unresolved failure", () =>
  Effect.gen(function* () {
    for (const failure of [new GitCommandResponseDeadline(), new GitCommandSenderStopUnproven()]) {
      let calls = 0
      const read = GitTaskAttemptBase.pipe(
        Effect.flatMap((reader) => reader.read(policy)),
        Effect.provide(nodeGitTaskAttemptBaseLayer),
        Effect.provide(
          Layer.succeed(
            GitCommand,
            GitCommand.of({
              run: () => Effect.die("unbounded read"),
              runInWorktree: () => Effect.die("unbounded read"),
              runBytesInWorktree: () => Effect.die("byte read"),
              runBoundedInWorktree: () => Effect.die("later worktree read"),
              runBoundedInRepository: () =>
                Effect.sync(() => {
                  calls += 1
                }).pipe(Effect.andThen(Effect.fail(failure)))
            })
          )
        )
      )
      const result = yield* read.pipe(Effect.result)
      expect(calls).toBe(1)
      if (failure._tag === "GitCommandResponseDeadline")
        expect(result).toMatchObject({ _tag: "Success", success: { _tag: "Refused", boundary: "TargetHead" } })
      else
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "GitTaskAttemptBaseUnsettled", reason: "SenderStopUnproven" }
        })
    }
  })
)
