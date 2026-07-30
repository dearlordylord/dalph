import { it as effectIt } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import {
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner
} from "../../authorities/task-tracker/github/target.js"
import { decodeFreshWorkflowRunIdForDiagnostics, freshWorkflowRunId } from "./fresh-run-identity.js"

effectIt.effect("assigns distinct opaque fresh run identities and diagnostically restores the exact target", () =>
  Effect.gen(function* () {
    const target = GithubIssueTarget.make({
      issueNumber: GithubIssueNumber.make(918_273_645),
      owner: GithubRepositoryOwner.make("dalph-visible-owner"),
      repository: GithubRepositoryName.make("orchestrator-visible-repository")
    })
    const first = yield* freshWorkflowRunId(target)
    const second = yield* freshWorkflowRunId(target)

    expect(first).not.toBe(second)
    expect(first).toMatch(/^r1\.[A-Za-z0-9_-]+$/)
    expect(first).not.toContain(String(target.issueNumber))
    expect(first).not.toContain(target.owner)
    expect(first).not.toContain(target.repository)

    const firstDecoded = yield* decodeFreshWorkflowRunIdForDiagnostics(first)
    const secondDecoded = yield* decodeFreshWorkflowRunIdForDiagnostics(second)
    expect(firstDecoded.target).toEqual(target)
    expect(secondDecoded.target).toEqual(target)
    expect(firstDecoded.freshness).not.toBe(secondDecoded.freshness)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

effectIt.effect("rejects malformed fresh run identities through one typed diagnostic failure", () =>
  Effect.gen(function* () {
    const malformed = [
      RunId.make("foreign-run"),
      RunId.make("r2.eyJ0YXJnZXQiOiJmaXh0dXJlIn0"),
      RunId.make("r1.not_valid_base64?"),
      RunId.make("r1.e30")
    ]

    const failures = yield* Effect.forEach(malformed, (runId) =>
      decodeFreshWorkflowRunIdForDiagnostics(runId).pipe(Effect.flip)
    )

    expect(failures.map(({ _tag }) => _tag)).toEqual(malformed.map(() => "FreshWorkflowRunIdDiagnosticDecodeFailure"))
  })
)
