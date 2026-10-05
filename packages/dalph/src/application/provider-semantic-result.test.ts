import { it } from "@effect/vitest"
import {
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  PlannedAttemptExecutorCorrelation,
  RunId,
  WorktreeLocator
} from "@dalph/contracts"
import { EvidenceStore, GitCommandResult } from "@dalph/orchestrator"
import { Crypto, Effect } from "effect"
import { expect } from "vitest"
import {
  ProviderResultAuthorityUnavailable,
  providerResultGitBoundary,
  publishProviderResultEvidence,
  validateOwnedSemanticCandidate,
  type ProviderResultValidationBoundary
} from "./provider-semantic-result.js"

const commit = GitCommitSha.make("a".repeat(40))
const otherCommit = GitCommitSha.make("b".repeat(40))
const correlation = PlannedAttemptExecutorCorrelation.make({
  attemptId: AttemptId.make("attempt:result:0"),
  runId: RunId.make("run:result")
})
const reference = EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("00".repeat(32)) })
const response = JSON.stringify({ version: 1, outcome: "Accepted", commit })

const controlledBoundary = (calls: Array<string>): ProviderResultValidationBoundary => ({
  proveOwnership: Effect.sync(() => {
    calls.push("ownership")
  }),
  readHead: Effect.sync(() => {
    calls.push("head")
    return commit
  }),
  isBaseAncestor: () =>
    Effect.sync(() => {
      calls.push("lineage")
      return true
    }),
  publishAndVerifyEvidence: (candidate, owner) =>
    Effect.sync(() => {
      calls.push("evidence")
      expect(candidate).toBe(commit)
      expect(owner).toEqual(correlation)
      return reference
    })
})

it.effect("validates exact ownership, current HEAD, lineage and evidence before rereading HEAD", () =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    const result = yield* validateOwnedSemanticCandidate(response, correlation, controlledBoundary(calls))
    expect(result).toEqual({ commit, evidenceManifest: reference })
    expect(calls).toEqual(["ownership", "head", "lineage", "evidence", "head"])
  })
)

it.effect("refuses foreign ownership before parsing or Git/evidence effects", () =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    const unavailable = new ProviderResultAuthorityUnavailable({ boundary: "Ownership", detail: "foreign turn" })
    const error = yield* validateOwnedSemanticCandidate("invalid", correlation, {
      ...controlledBoundary(calls),
      proveOwnership: Effect.fail(unavailable)
    }).pipe(Effect.flip)
    expect(error).toBe(unavailable)
    expect(calls).toEqual([])
  })
)

it.effect("rejects malformed and foreign legacy answers without publishing evidence", () =>
  Effect.gen(function* () {
    for (const text of ["invalid", JSON.stringify({ commit, correlation: { ...correlation, runId: "run:foreign" } })]) {
      const calls: Array<string> = []
      const error = yield* validateOwnedSemanticCandidate(text, correlation, controlledBoundary(calls)).pipe(
        Effect.flip
      )
      expect(error._tag).toBe("ProviderResultRejected")
      expect(calls).toEqual(["ownership"])
    }
  })
)

it.effect("rejects a proven HEAD mismatch before lineage or evidence publication", () =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    const error = yield* validateOwnedSemanticCandidate(response, correlation, {
      ...controlledBoundary(calls),
      readHead: Effect.succeed(otherCommit)
    }).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "ProviderResultRejected", reason: "CandidateHeadMismatch" })
    expect(calls).toEqual(["ownership"])
  })
)

it.effect("distinguishes proven invalid lineage from unavailable Git authority", () =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    const rejected = yield* validateOwnedSemanticCandidate(response, correlation, {
      ...controlledBoundary(calls),
      isBaseAncestor: () => Effect.succeed(false)
    }).pipe(Effect.flip)
    expect(rejected).toMatchObject({ _tag: "ProviderResultRejected", reason: "CandidateLineageInvalid" })
    const unavailable = new ProviderResultAuthorityUnavailable({ boundary: "Lineage", detail: "Git unavailable" })
    const error = yield* validateOwnedSemanticCandidate(response, correlation, {
      ...controlledBoundary(calls),
      isBaseAncestor: () => Effect.fail(unavailable)
    }).pipe(Effect.flip)
    expect(error).toBe(unavailable)
    expect(calls).not.toContain("evidence")
  })
)

it.effect("never returns a validated result when HEAD changes during evidence publication", () =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    let reads = 0
    const error = yield* validateOwnedSemanticCandidate(response, correlation, {
      ...controlledBoundary(calls),
      readHead: Effect.sync(() => {
        reads += 1
        return reads === 1 ? commit : otherCommit
      })
    }).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "ProviderResultAuthorityUnavailable", boundary: "Head" })
    expect(calls).toEqual(["ownership", "lineage", "evidence"])
  })
)

it.effect("preserves unavailable HEAD and evidence as technical failures without automatic correction", () =>
  Effect.gen(function* () {
    for (const boundary of ["Head", "Evidence"] as const) {
      const calls: Array<string> = []
      const unavailable = new ProviderResultAuthorityUnavailable({ boundary, detail: "authority unavailable" })
      const operations = controlledBoundary(calls)
      const error = yield* validateOwnedSemanticCandidate(response, correlation, {
        ...operations,
        ...(boundary === "Head"
          ? { readHead: Effect.fail(unavailable) }
          : { publishAndVerifyEvidence: () => Effect.fail(unavailable) })
      }).pipe(Effect.flip)
      expect(error).toBe(unavailable)
      expect(calls).not.toContain("evidence")
    }
  })
)

it.effect("validates a known exact legacy envelope through the same authoritative boundary", () =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    const result = yield* validateOwnedSemanticCandidate(
      JSON.stringify({ commit, correlation }),
      correlation,
      controlledBoundary(calls)
    )
    expect(result).toEqual({ commit, evidenceManifest: reference })
    expect(calls).toEqual(["ownership", "head", "lineage", "evidence", "head"])
  })
)

it.effect("uses exact Git worktree/Base and distinguishes ancestry exit 1 from exit 128", () =>
  Effect.gen(function* () {
    const worktree = WorktreeLocator.make("/worktrees/result-validation")
    for (const exitCode of [0, 1, 128]) {
      const calls: Array<ReadonlyArray<string>> = []
      const boundary = providerResultGitBoundary(
        {
          runInWorktree: (observedWorktree, args) =>
            Effect.sync(() => {
              expect(observedWorktree).toBe(worktree)
              calls.push(args)
              return GitCommandResult.make({ exitCode, stdout: "", stderr: "" })
            })
        },
        worktree,
        otherCommit
      )
      if (exitCode === 128) {
        expect((yield* boundary.isBaseAncestor(commit).pipe(Effect.flip)).boundary).toBe("Lineage")
      } else {
        expect(yield* boundary.isBaseAncestor(commit)).toBe(exitCode === 0)
      }
      expect(calls).toEqual([["merge-base", "--is-ancestor", otherCommit, commit]])
    }
  })
)

it.effect("refuses unsuccessful or malformed authoritative HEAD observations", () =>
  Effect.gen(function* () {
    for (const result of [
      { exitCode: 128, stdout: `${commit}\n`, stderr: "" },
      { exitCode: 0, stdout: "malformed", stderr: "" }
    ]) {
      const boundary = providerResultGitBoundary(
        { runInWorktree: () => Effect.succeed(GitCommandResult.make(result)) },
        WorktreeLocator.make("/worktrees/result-validation"),
        otherCommit
      )
      expect((yield* boundary.readHead.pipe(Effect.flip)).boundary).toBe("Head")
    }
  })
)

it.effect("checks evidence readback bytes, locator byte length and digest independently", () =>
  Effect.gen(function* () {
    const crypto = Crypto.make({
      digest: () => Effect.succeed(new Uint8Array(32)),
      randomBytes: (size) => new Uint8Array(size)
    })
    for (const defect of ["none", "bytes", "length", "digest"] as const) {
      let saved = new Uint8Array()
      const evidence = EvidenceStore.of({
        put: (bytes) =>
          Effect.sync(() => {
            saved = bytes.slice()
            return EvidenceReference.make({
              byteLength: bytes.byteLength + (defect === "length" ? 1 : 0),
              digest: EvidenceDigest.make((defect === "digest" ? "ff" : "00").repeat(32))
            })
          }),
        read: () => Effect.sync(() => (defect === "bytes" ? new Uint8Array(saved.byteLength) : saved.slice()))
      })
      if (defect === "none") {
        const accepted = yield* publishProviderResultEvidence(evidence, crypto, commit, correlation)
        expect(accepted.byteLength).toBe(saved.byteLength)
        expect(JSON.parse(new TextDecoder().decode(saved))).toMatchObject({ commit, correlation, outcome: "Accepted" })
      } else {
        expect(
          (yield* publishProviderResultEvidence(evidence, crypto, commit, correlation).pipe(Effect.flip)).boundary
        ).toBe("Evidence")
      }
    }
  })
)
