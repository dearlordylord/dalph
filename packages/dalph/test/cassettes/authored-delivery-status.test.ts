import { AttemptId, GitCommitSha, RunId } from "@dalph/contracts"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { deliveryStatusOf, DeliveryStatusRunMismatch, type DeliveryRuntimeReadyObservation } from "@dalph/orchestrator"
import {
  authoredDeliveryStatusReadOf,
  type AuthoredDeliveryStatusRead
} from "../../src/cassettes/authored-delivery-status.js"
import { maintainedAuthoredCassetteCatalog } from "../../src/cassettes/catalog.js"
import { runAuthoredScenarioCassette, evaluateAuthoredObservationCapture } from "../../src/cassettes/authored-runner.js"
import { comparisonValue } from "./delivery-capstone-replay-comparison.test-support.js"
import { canonicalIdentity } from "../../../orchestrator/src/coordination/delivery/delivery-status-order.js"
import { acceptedManifestReferenceFor } from "./delivery-capstone-authored-correlations.test-support.js"

it.effect(
  "authored capstone carries exact canonical status or typed failure at its observation moment",
  () =>
    Effect.gen(function* () {
      const observed: Array<{
        readonly observation: DeliveryRuntimeReadyObservation
        readonly read: AuthoredDeliveryStatusRead
      }> = []
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone, {
        onDeliveryStatusRead: (observation, read) => {
          observed.push({ observation, read })
        }
      })
      const statusCaptures = run.observationCaptures.filter((capture) => capture._tag === "DeliveryStatusCaptured")
      expect(statusCaptures.length).toBeGreaterThan(0)
      expect(statusCaptures.length).toBeGreaterThan(
        run.observationCaptures.filter((capture) => capture._tag === "DeliveryRuntimeOwnersCaptured").length
      )
      for (const capture of statusCaptures) {
        const moment = run.observationMoments.find((candidate) => candidate.captureOrder === capture.captureOrder)
        expect(moment?._tag).toBe("DeliveryStatusMoment")
        expect(moment?.deliveryStatusRead).toBe(capture.deliveryStatusRead)
      }
      expect(observed.map(({ read }) => read)).toEqual(
        statusCaptures.map(({ deliveryStatusRead }) => deliveryStatusRead)
      )
      for (const { observation, read } of observed) {
        const canonical = deliveryStatusOf({ _tag: "Run", runId: run.runId }, observation)
        if (read._tag === "Unobserved") return expect.fail("actual Ready observation was not projected")
        expect(read._tag === "Status" ? read.status : read.error).toEqual(canonical)
      }
      expect(observed.some(({ read }) => read._tag === "ProjectionFailed")).toBe(true)
      expect(
        observed.some(({ observation }, index) => {
          const previous = observed[index - 1]?.observation
          return (
            previous !== undefined &&
            JSON.stringify(previous.liveOwners) === JSON.stringify(observation.liveOwners) &&
            previous.evaluation.acceptedAt !== observation.evaluation.acceptedAt
          )
        })
      ).toBe(true)
      const first = run.observationMoments[0]
      expect(first?.deliveryStatusRead).toEqual({ _tag: "Unobserved" })
      const observation = observed[0]?.observation
      if (observation === undefined) return expect.fail("missing actual Ready observation")
      const failure = authoredDeliveryStatusReadOf({ _tag: "Run", runId: RunId.make("different-run") }, observation)
      expect(failure._tag).toBe("ProjectionFailed")
      if (failure._tag !== "ProjectionFailed") return expect.fail("typed mismatch was hidden")
      expect(failure.error).toBeInstanceOf(DeliveryStatusRunMismatch)
      const capture = statusCaptures[0]
      if (capture === undefined) return expect.fail("missing actual status capture")
      const failedMoment = yield* evaluateAuthoredObservationCapture({ ...capture, deliveryStatusRead: failure }, null)
      expect(failedMoment.deliveryStatusRead).toBe(failure)
      expect(failedMoment.deliveryFrame).toBeNull()
    }).pipe(Effect.provide(NodeCrypto.layer)),
  600_000
)

it("status conflict replay normalizes only the proposal Run and preserves different task and operation identities", () => {
  const proposal = (runId: string, taskId: string, operationId: string) =>
    `delivery:${JSON.stringify({ runId, route: { taskId, operationId } })}`
  const identity = (runId: string, taskId: string, operationId: string) =>
    canonicalIdentity(["live-owner", proposal(runId, taskId, operationId), 3])
  const fresh = identity("fresh-run", "A", "cassette:fresh-run:operation:7")
  const reference = identity("reference-run", "A", "cassette:reference-run:operation:7")
  expect(comparisonValue({ entryIdentity: fresh }, "fresh-run", "reference-run")).toEqual({ entryIdentity: reference })
  expect(
    comparisonValue(
      { entryIdentity: identity("fresh-run", "B", "cassette:fresh-run:operation:7") },
      "fresh-run",
      "reference-run"
    )
  ).not.toEqual({ entryIdentity: reference })
  expect(
    comparisonValue(
      { entryIdentity: identity("fresh-run", "A", "cassette:fresh-run:operation:8") },
      "fresh-run",
      "reference-run"
    )
  ).not.toEqual({ entryIdentity: reference })
  expect(comparisonValue({ detail: fresh }, "fresh-run", "reference-run")).toEqual({ detail: fresh })
  expect(comparisonValue({ entryIdentity: `malformed:${fresh}` }, "fresh-run", "reference-run")).toEqual({
    entryIdentity: `malformed:${fresh}`
  })
})

it("status conflict identity changes a verified acceptance descriptor but preserves altered evidence and unrelated identities", () => {
  const freshRun = RunId.make("fresh-manifest-run")
  const referenceRun = RunId.make("reference-manifest-run")
  const commit = GitCommitSha.make("3".repeat(40))
  const attemptId = AttemptId.make("attempt:A:0")
  const original = acceptedManifestReferenceFor({ runId: freshRun, attemptId }, commit)
  const reference = acceptedManifestReferenceFor({ runId: referenceRun, attemptId }, commit)
  const manifests = new Map([[`${original.byteLength}:${original.digest}`, reference]])
  const proposalIdentity = (runId: RunId, evidenceManifest: typeof original) =>
    canonicalIdentity([
      "live-owner",
      `delivery:${JSON.stringify({ runId, route: { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "QueueAcceptedResultIntegrationResponsibility", accepted: { acceptedResult: { commit, evidenceManifest }, correlation: { runId, attemptId } } } } })}`
    ])
  const actual = proposalIdentity(freshRun, original)
  const expected = proposalIdentity(referenceRun, reference)
  expect(comparisonValue({ entryIdentity: actual }, freshRun, referenceRun, "", manifests)).toEqual({
    entryIdentity: expected
  })
  expect(
    comparisonValue(
      { entryIdentity: proposalIdentity(freshRun, { ...original, byteLength: original.byteLength + 1 }) },
      freshRun,
      referenceRun,
      "",
      manifests
    )
  ).not.toEqual({ entryIdentity: expected })
  expect(comparisonValue({ unrelatedId: actual }, freshRun, referenceRun, "", manifests)).toEqual({
    unrelatedId: actual
  })
})
