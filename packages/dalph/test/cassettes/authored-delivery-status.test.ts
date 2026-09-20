import { AttemptId, GitCommitSha, RunId } from "@dalph/contracts"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  deliveryStatusOf,
  DeliveryStatusRunMismatch,
  type DeliveryRuntimeReadyObservation,
  type JournalRecord
} from "@dalph/orchestrator"
import {
  authoredDeliveryStatusReadOf,
  type AuthoredDeliveryStatusRead
} from "../../src/cassettes/authored-delivery-status.js"
import { maintainedAuthoredCassetteCatalog } from "../../src/cassettes/catalog.js"
import { runAuthoredScenarioCassette, evaluateAuthoredObservationCapture } from "../../src/cassettes/authored-runner.js"
import { comparisonValue } from "./delivery-capstone-replay-comparison.test-support.js"
import { canonicalIdentity } from "../../../orchestrator/src/coordination/delivery/delivery-status-order.js"
import { acceptedManifestReferenceFor } from "./delivery-capstone-authored-correlations.test-support.js"
import { restartPredecessorCleanupAfterRemoval } from "./delivery-predecessor-cleanup-restart.test-support.js"

const capstoneTimeout = 600_000

const cachedCapstoneRun = Effect.runSync(
  Effect.cached(
    Effect.gen(function* () {
      const observed: Array<{
        readonly observation: DeliveryRuntimeReadyObservation
        readonly read: AuthoredDeliveryStatusRead
      }> = []
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone, {
        diagnostics: "status",
        onDeliveryStatusRead: (observation, read) => {
          observed.push({ observation, read })
        }
      })
      return { observed, run }
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
)

const exactlyOne = <Tag extends JournalRecord["event"]["_tag"]>(
  records: ReadonlyArray<JournalRecord>,
  tag: Tag
): JournalRecord & { readonly event: Extract<JournalRecord["event"], { readonly _tag: Tag }> } => {
  const matches = records.filter(
    (record): record is JournalRecord & { readonly event: Extract<JournalRecord["event"], { readonly _tag: Tag }> } =>
      record.event._tag === tag
  )
  expect(matches).toHaveLength(1)
  const match = matches[0]
  if (match === undefined) return expect.fail(`missing ${tag}`)
  return match
}

it.effect(
  "authored capstone carries exact canonical status or typed failure at its observation moment",
  () =>
    Effect.gen(function* () {
      const { observed, run } = yield* cachedCapstoneRun
      const statusCaptures = run.observationCaptures.filter((capture) => capture._tag === "DeliveryStatusCaptured")
      expect(statusCaptures.length).toBeGreaterThan(0)
      expect(statusCaptures.length).toBeGreaterThan(
        run.observationCaptures.filter((capture) => capture._tag === "DeliveryRuntimeOwnersCaptured").length
      )
      for (const capture of statusCaptures) {
        const status = run.observationStatuses.find((candidate) => candidate.captureOrder === capture.captureOrder)
        expect(status?.deliveryStatusRead).toBe(capture.deliveryStatusRead)
      }
      expect(run.diagnostics).toBe("status")
      expect(run.observationStatuses).toHaveLength(run.observationCaptures.length)
      expect(run.observationStatuses.map(({ captureOrder }) => captureOrder)).toEqual(
        run.observationCaptures.map(({ captureOrder }) => captureOrder)
      )
      expect(run.observationPlaybackWork.projectedPublications).toBe(0)
      expect("deliveryFrames" in run).toBe(false)
      expect("observationMoments" in run).toBe(false)
      expect("preparedTrace" in run).toBe(false)
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
      const first = run.observationStatuses[0]
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
    }),
  capstoneTimeout
)

it.effect(
  "reopens A cleanup after exact removal before response and settles only after owning-boundary absence",
  () =>
    Effect.gen(function* () {
      const { run } = yield* cachedCapstoneRun
      const cleanupIndex = run.records.findIndex(({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized")
      expect(cleanupIndex).toBeGreaterThan(0)
      const retained = run.records.slice(0, cleanupIndex)
      const result = yield* restartPredecessorCleanupAfterRemoval(retained)
      expect(result.prefix.at(-1)?.event._tag).toBe("IntegratorCandidateCleanupMutationIntended")
      expect(
        result.prefix.some(
          ({ event }) =>
            event._tag === "IntegratorCandidateCleanupMutationResultRecorded" ||
            event._tag === "IntegratorCandidateCleanupSettled"
        )
      ).toBe(false)
      expect(result.reopened).toEqual(result.prefix)
      expect(result.records.slice(0, result.prefix.length)).toEqual(result.prefix)
      const predecessor = exactlyOne(
        retained.filter(
          ({ event }) => event._tag === "IntegratorSessionFixed" && event.correlation.plannedAttempt.taskId === "A"
        ),
        "IntegratorSessionFixed"
      ).event.correlation
      const successor = exactlyOne(
        retained.filter(
          ({ event }) =>
            event._tag === "IntegratorSuccessorSessionFixed" && event.predecessor.plannedAttempt.taskId === "A"
        ),
        "IntegratorSuccessorSessionFixed"
      )
      expect(result.calls.map(({ tag }) => tag)).toEqual(["Observe", "Remove", "Observe"])
      expect(
        result.calls.every(
          ({ locator, sessionId }) => locator === predecessor.candidateResource && sessionId === predecessor.sessionId
        )
      ).toBe(true)
      const absent = exactlyOne(result.records, "IntegratorCandidateCleanupAbsenceConfirmed")
      const settled = exactlyOne(result.records, "IntegratorCandidateCleanupSettled")
      expect(absent.event.cause).toBe("MutationResponseReconciliation")
      expect(settled.position).toBeGreaterThan(absent.position)
      expect(absent.position).toBeGreaterThan(result.prefix.length)
      expect(result.records.filter(({ event }) => !event._tag.startsWith("IntegratorCandidateCleanup"))).toEqual(
        retained
      )
      expect(result.records).toContainEqual(successor)
      expect(absent.event.authorization.disposition.predecessor).toEqual(predecessor)
      expect(absent.event.authorization.disposition.successor).toEqual(successor.event.successor)
      expect(result.result.remaining.candidate).toEqual([])
    }),
  capstoneTimeout
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
