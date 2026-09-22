import { GitCommitSha, RemotePublicationBranchRef, RemotePublicationEndpoint } from "@dalph/contracts"
import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
  RemotePublicationPushFailure,
  RemotePublicationPushResult
} from "../../workflow/protocols/direct-publication/events.js"
import { classifyAncestry, parseAdvertisedHead, parsePushResult } from "./direct-publication-parser.js"
import type { GitCommandResult } from "./command.js"

const target = {
  branch: RemotePublicationBranchRef.make("refs/heads/main"),
  endpoint: RemotePublicationEndpoint.make("https://example.invalid/dalph.git")
}
const candidate = GitCommitSha.make("a".repeat(40))
const remote = GitCommitSha.make("b".repeat(40))
const mergeBase = GitCommitSha.make("c".repeat(40))
const result = (overrides: Partial<GitCommandResult> = {}): GitCommandResult => ({
  exitCode: 0,
  stderr: "",
  stdout: "",
  ...overrides
})

const failureReason = async (effect: Effect.Effect<unknown, unknown>) => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) throw new Error("expected a failure")
  const failure = exit.cause.toString()
  expect(failure).toContain("RemotePublicationObservationFailure")
}

describe("direct publication parser boundaries", () => {
  it("rejects missing, failed, malformed, and mismatched remote advertisements", async () => {
    for (const advertised of [
      result({ exitCode: 2 }),
      result({ exitCode: 1, stderr: "denied" }),
      result({ stdout: "a\tb\nc\td" }),
      result({ stdout: "" }),
      result({ stdout: `${candidate}\trefs/heads/other` }),
      result({ stdout: `not-a-sha\t${target.branch}` })
    ]) {
      await failureReason(parseAdvertisedHead(advertised, target))
    }
    await expect(
      Effect.runPromise(parseAdvertisedHead(result({ stdout: `${candidate}\t${target.branch}` }), target))
    ).resolves.toBe(candidate)
  })

  it("classifies every remote ancestry relation and malformed merge-base", async () => {
    await expect(
      Effect.runPromise(classifyAncestry(result(), result(), result(), candidate, candidate, target))
    ).resolves.toMatchObject({ _tag: "CandidateCurrent" })
    await expect(
      Effect.runPromise(classifyAncestry(result(), result(), result(), candidate, remote, target))
    ).resolves.toMatchObject({ _tag: "CandidateAncestor" })
    await failureReason(classifyAncestry(result({ exitCode: 2 }), result(), result(), candidate, remote, target))
    await expect(
      Effect.runPromise(classifyAncestry(result({ exitCode: 1 }), result(), result(), candidate, remote, target))
    ).resolves.toMatchObject({ _tag: "RemoteAncestorOfCandidate" })
    await failureReason(
      classifyAncestry(result({ exitCode: 1 }), result({ exitCode: 2 }), result(), candidate, remote, target)
    )
    await expect(
      Effect.runPromise(
        classifyAncestry(
          result({ exitCode: 1 }),
          result({ exitCode: 1 }),
          result({ stdout: `${mergeBase}\n` }),
          candidate,
          remote,
          target
        )
      )
    ).resolves.toMatchObject({ _tag: "CompatibleCompetingHead" })
    await failureReason(
      classifyAncestry(
        result({ exitCode: 1 }),
        result({ exitCode: 1 }),
        result({ stdout: `${mergeBase}\n${mergeBase}\n` }),
        candidate,
        remote,
        target
      )
    )
    await failureReason(
      classifyAncestry(
        result({ exitCode: 1 }),
        result({ exitCode: 1 }),
        result({ stdout: "not-a-sha\n" }),
        candidate,
        remote,
        target
      )
    )
    await failureReason(
      classifyAncestry(
        result({ exitCode: 1 }),
        result({ exitCode: 1 }),
        result({ stdout: `${mergeBase}\n`, stderr: "warning" }),
        candidate,
        remote,
        target
      )
    )
    await expect(
      Effect.runPromise(
        classifyAncestry(
          result({ exitCode: 1 }),
          result({ exitCode: 1 }),
          result({ exitCode: 1 }),
          candidate,
          remote,
          target
        )
      )
    ).resolves.toMatchObject({ _tag: "IncompatibleLineage" })
    await failureReason(
      classifyAncestry(
        result({ exitCode: 1 }),
        result({ exitCode: 1 }),
        result({ exitCode: 2 }),
        candidate,
        remote,
        target
      )
    )
  })

  it("classifies exact push statuses, denials, throttles, and malformed output", async () => {
    const exact = `${candidate}:${target.branch}`
    const cases: ReadonlyArray<readonly [string, number, string]> = [
      ["*\t" + exact + "\t[up to date]", 0, "Applied"],
      ["=\t" + exact + "\tup to date", 0, "UpToDate"],
      ["!\t" + exact + "\tnon-fast-forward", 1, "RejectedNonFastForward"],
      ["!\t" + exact + "\t[remote rejected] policy", 1, "RejectedDefinite"],
      ["!\t" + exact + "\trate limit", 1, "Throttled"],
      ["!\t" + exact + "\tpermission denied", 1, "RejectedDefinite"]
    ]
    for (const [line, exitCode, tag] of cases) {
      await expect(
        Effect.runPromise(parsePushResult(result({ exitCode, stdout: line }), candidate, target))
      ).resolves.toMatchObject({ _tag: tag })
    }
    await expect(
      Effect.runPromise(
        parsePushResult(result({ stdout: "Done\nTo example\n*\t" + exact + "\tok" }), candidate, target)
      )
    ).resolves.toMatchObject({ _tag: "Applied" })
    for (const malformed of ["garbage", `*\t${candidate}:refs/heads/other\tok`, `*\t${exact}\tok\n=\t${exact}\tok`]) {
      await expect(
        Effect.runPromise(parsePushResult(result({ stdout: malformed }), candidate, target))
      ).rejects.toBeInstanceOf(RemotePublicationPushFailure)
    }
    await expect(
      Effect.runPromise(parsePushResult(result({ stderr: "authentication failed" }), candidate, target))
    ).resolves.toEqual(RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Authentication" }))
    await expect(
      Effect.runPromise(parsePushResult(result({ stderr: "temporarily unavailable" }), candidate, target))
    ).resolves.toMatchObject({ _tag: "Throttled" })
    await expect(
      Effect.runPromise(parsePushResult(result({ exitCode: 1, stdout: `*\t${exact}\tok` }), candidate, target))
    ).rejects.toBeInstanceOf(RemotePublicationPushFailure)
    await expect(
      Effect.runPromise(parsePushResult(result({ exitCode: 1, stdout: `=\t${exact}\tok` }), candidate, target))
    ).rejects.toBeInstanceOf(RemotePublicationPushFailure)
    await expect(
      Effect.runPromise(parsePushResult(result({ exitCode: 1, stdout: `+\t${exact}\tok` }), candidate, target))
    ).rejects.toBeInstanceOf(RemotePublicationPushFailure)
    await expect(
      Effect.runPromise(
        parsePushResult(result({ exitCode: 1, stdout: `!\t${exact}\tpolicy denied` }), candidate, target)
      )
    ).resolves.toEqual(RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Other" }))
  })
})
