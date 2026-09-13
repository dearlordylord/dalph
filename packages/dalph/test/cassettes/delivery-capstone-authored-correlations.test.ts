import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "vitest"
import { EvidenceDigest, EvidenceReference, type RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { freshWorkflowRunId, IntegratorSessionCorrelation, JournalPosition } from "@dalph/orchestrator"
import { deliveryStoryCapstoneAuthoredCassette } from "../../src/cassettes/delivery-story-capstone.js"
import {
  acceptedManifestReferenceFor,
  normalizeDeclaredIntegratorSession,
  resolveDeclaredAuthoredIdentity
} from "./delivery-capstone-authored-correlations.test-support.js"

const declaredSession = (() => {
  const item = deliveryStoryCapstoneAuthoredCassette.story.find(
    (candidate) => candidate._tag === "IntegratorRequestReceived"
  )
  if (item?._tag !== "IntegratorRequestReceived") return expect.fail("capstone fixture lacks an Integrator request")
  return item.correlation.session
})()

const capstoneTarget = (() => {
  const item = deliveryStoryCapstoneAuthoredCassette.story.find((candidate) => candidate._tag === "RunCoordinator")
  if (item?._tag !== "RunCoordinator") return expect.fail("capstone fixture lacks a Run coordinator")
  return item.target
})()

const freshCanonicalRunId = (): RunId =>
  Effect.runSync(freshWorkflowRunId(capstoneTarget).pipe(Effect.provide(NodeCrypto.layer)))

const expectedResolvedSession = (actualRunId: RunId): IntegratorSessionCorrelation => {
  const resolved = Schema.decodeUnknownSync(IntegratorSessionCorrelation)(
    JSON.parse(JSON.stringify(declaredSession).replaceAll("$authored-run", String(actualRunId)))
  )
  return {
    ...resolved,
    acceptedResult: {
      ...resolved.acceptedResult,
      evidenceManifest: acceptedManifestReferenceFor(
        { attemptId: resolved.plannedAttempt.attemptId, runId: actualRunId },
        resolved.acceptedResult.commit
      )
    }
  }
}

it("resolves the decoded capstone correlation and independently sealed manifest", () => {
  const actualRunId = freshCanonicalRunId()
  const normalized = normalizeDeclaredIntegratorSession(declaredSession, actualRunId)

  expect(normalized).toEqual(expectedResolvedSession(actualRunId))
  expect(normalized.acceptedResult.evidenceManifest).toEqual(
    acceptedManifestReferenceFor(
      { attemptId: declaredSession.plannedAttempt.attemptId, runId: actualRunId },
      declaredSession.acceptedResult.commit
    )
  )
})

it("rejects foreign declared Runs and noncanonical declared evidence references", () => {
  const actualRunId = freshCanonicalRunId()
  const foreignDeclaredRun = {
    ...declaredSession,
    plannedAttempt: { ...declaredSession.plannedAttempt, runId: freshCanonicalRunId() }
  }
  expect(() => normalizeDeclaredIntegratorSession(foreignDeclaredRun, actualRunId)).toThrow(
    "authored Integrator session must declare the exact Run placeholder"
  )

  const nonSentinelDigest = {
    ...declaredSession,
    acceptedResult: {
      ...declaredSession.acceptedResult,
      evidenceManifest: EvidenceReference.make({
        byteLength: declaredSession.acceptedResult.evidenceManifest.byteLength,
        digest: EvidenceDigest.make("a".repeat(64))
      })
    }
  }
  expect(() => normalizeDeclaredIntegratorSession(nonSentinelDigest, actualRunId)).toThrow(
    "authored Integrator session must declare the sentinel accepted-evidence digest"
  )

  const wrongByteLength = {
    ...declaredSession,
    acceptedResult: {
      ...declaredSession.acceptedResult,
      evidenceManifest: EvidenceReference.make({
        byteLength: declaredSession.acceptedResult.evidenceManifest.byteLength + 1,
        digest: declaredSession.acceptedResult.evidenceManifest.digest
      })
    }
  }
  expect(() => normalizeDeclaredIntegratorSession(wrongByteLength, actualRunId)).toThrow(
    "authored Integrator session accepted-evidence byte length is not canonical"
  )
})

it("preserves identity suffixes, Run generation, and other correlation differences", () => {
  const actualRunId = freshCanonicalRunId()
  const suffix = ":attempt:A:0:135:137:tail"
  expect(resolveDeclaredAuthoredIdentity(`candidate:$authored-run${suffix}`, actualRunId)).toBe(
    `candidate:${actualRunId}${suffix}`
  )

  const changed = normalizeDeclaredIntegratorSession(
    {
      ...declaredSession,
      queuedAt: JournalPosition.make(Number(declaredSession.queuedAt) + 1),
      startedAt: JournalPosition.make(Number(declaredSession.startedAt) + 2),
      targetLineageObservedAt: JournalPosition.make(Number(declaredSession.targetLineageObservedAt) + 3)
    },
    actualRunId
  )
  expect(changed.queuedAt).toBe(Number(declaredSession.queuedAt) + 1)
  expect(changed.startedAt).toBe(Number(declaredSession.startedAt) + 2)
  expect(changed.targetLineageObservedAt).toBe(Number(declaredSession.targetLineageObservedAt) + 3)

  const otherRunId = freshCanonicalRunId()
  const other = normalizeDeclaredIntegratorSession(declaredSession, otherRunId)
  expect(other.sessionId).not.toBe(changed.sessionId)
  expect(other.candidateResource).not.toBe(changed.candidateResource)
})
