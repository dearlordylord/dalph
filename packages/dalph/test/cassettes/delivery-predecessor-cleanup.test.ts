import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import {
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateResourceLocator,
  IntegratorSessionId,
  type JournalRecord
} from "@dalph/orchestrator"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette,
  runFullRerunPredecessorCleanupFromHistory
} from "../../src/cassettes/index.js"

const timeout = 600_000
const evidenceRevision = IntegratorCandidateCleanupEvidenceRevision.make(7)
const removedRevision = IntegratorCandidateCleanupEvidenceRevision.make(8)

const cachedDeliveryRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryStoryDs14ThroughDs17).pipe(
      Effect.provide(NodeCrypto.layer)
    )
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
  return matches[0] as JournalRecord & { readonly event: Extract<JournalRecord["event"], { readonly _tag: Tag }> }
}

it.effect(
  "settles only A's FullRerun predecessor candidate resource before normal termination and preserves predecessor history and evidence",
  () =>
    Effect.gen(function* () {
      const delivery = yield* cachedDeliveryRun
      const predecessor = exactlyOne(delivery.records, "IntegratorSessionFixed").event.correlation
      const successor = exactlyOne(delivery.records, "IntegratorSuccessorSessionFixed").event.successor
      const present = IntegratorCandidateCleanupObservation.cases.Present.make({
        locator: predecessor.candidateResource,
        revision: evidenceRevision,
        sessionId: predecessor.sessionId,
        writerQuiescent: true
      })
      const absent = IntegratorCandidateCleanupObservation.cases.Absent.make({
        locator: predecessor.candidateResource,
        revision: removedRevision
      })
      const result = yield* runFullRerunPredecessorCleanupFromHistory({
        activations: 1,
        evidenceRevision,
        history: delivery.records,
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Removed.make({
            locator: predecessor.candidateResource,
            revision: removedRevision,
            sessionId: predecessor.sessionId
          })
        ],
        observations: [present, absent]
      })

      const authorization = exactlyOne(result.records, "IntegratorCandidateCleanupAuthorized").event.authorization
      expect(authorization.disposition.predecessor).toEqual(predecessor)
      expect(authorization.disposition.successor).toEqual(successor)
      expect(authorization.locator).toBe(predecessor.candidateResource)
      expect(authorization.owner.sessionId).toBe(predecessor.sessionId)
      expect(authorization.evidenceRevision).toBe(evidenceRevision)
      expect(authorization.writerQuiescent).toBe(true)
      expect(result.boundaryCalls.map(({ _tag }) => _tag)).toEqual(["Observe", "Remove", "Observe"])
      expect(result.boundaryCalls.every(({ locator }) => locator === predecessor.candidateResource)).toBe(true)
      expect(result.boundaryCalls.every(({ sessionId }) => sessionId === predecessor.sessionId)).toBe(true)
      expect(result.outcomes.map((outcome) => outcome.candidate?._tag)).toEqual(["Settled"])
      expect(result.upstreamAfter).toEqual(result.upstreamBefore)
      expect(result.upstreamAfter).toContainEqual(
        expect.objectContaining({ event: expect.objectContaining({ _tag: "IntegratorSessionFixed" }) })
      )
      expect(result.upstreamAfter).toContainEqual(
        expect.objectContaining({ event: expect.objectContaining({ _tag: "IntegratorSuccessorSessionFixed" }) })
      )
      expect(result.records.some(({ event }) => event._tag === "IntegratorCandidateCleanupSettled")).toBe(true)
      expect(result.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    }),
  timeout
)

it.effect(
  "rereads A's exact predecessor after a lost removal response before settling without another removal",
  () =>
    Effect.gen(function* () {
      const delivery = yield* cachedDeliveryRun
      const predecessor = exactlyOne(delivery.records, "IntegratorSessionFixed").event.correlation
      const present = IntegratorCandidateCleanupObservation.cases.Present.make({
        locator: predecessor.candidateResource,
        revision: evidenceRevision,
        sessionId: predecessor.sessionId,
        writerQuiescent: true
      })
      const absent = IntegratorCandidateCleanupObservation.cases.Absent.make({
        locator: predecessor.candidateResource,
        revision: removedRevision
      })
      const result = yield* runFullRerunPredecessorCleanupFromHistory({
        activations: 2,
        evidenceRevision,
        history: delivery.records,
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: "provider response lost after accepting the exact removal",
            locator: predecessor.candidateResource,
            sessionId: predecessor.sessionId
          })
        ],
        observations: [present, absent]
      })

      expect(result.boundaryCalls.map(({ _tag }) => _tag)).toEqual(["Observe", "Remove", "Observe"])
      expect(result.outcomes.map((outcome) => outcome.candidate?._tag)).toEqual(["Pending", "Settled"])
      expect(
        result.records.filter(({ event }) => event._tag === "IntegratorCandidateCleanupMutationIntended")
      ).toHaveLength(1)
      expect(exactlyOne(result.records, "IntegratorCandidateCleanupAbsenceConfirmed").event.cause).toBe(
        "MutationResponseReconciliation"
      )
      expect(result.upstreamAfter).toEqual(result.upstreamBefore)
    }),
  timeout
)

it.effect(
  "does not authorize A's predecessor cleanup without the exact stale-promotion intent",
  () =>
    Effect.gen(function* () {
      const delivery = yield* cachedDeliveryRun
      const predecessor = exactlyOne(delivery.records, "IntegratorSessionFixed").event.correlation
      const result = yield* runFullRerunPredecessorCleanupFromHistory({
        activations: 1,
        evidenceRevision,
        history: delivery.records.filter(({ event }) => event._tag !== "TargetPromotionAttemptIntended"),
        observations: [
          IntegratorCandidateCleanupObservation.cases.Present.make({
            locator: predecessor.candidateResource,
            revision: evidenceRevision,
            sessionId: predecessor.sessionId,
            writerQuiescent: true
          })
        ]
      })

      expect(result.boundaryCalls).toEqual([])
      expect(result.outcomes[0]?.candidate).toBeUndefined()
      expect(result.records.some(({ event }) => event._tag === "IntegratorCandidateCleanupAuthorized")).toBe(false)
      expect(result.upstreamAfter).toEqual(result.upstreamBefore)
    }),
  timeout
)

it.effect(
  "preserves A's predecessor for every foreign, changed, live-writer, contradictory, or unreadable boundary result",
  () =>
    Effect.gen(function* () {
      const delivery = yield* cachedDeliveryRun
      const predecessor = exactlyOne(delivery.records, "IntegratorSessionFixed").event.correlation
      const successor = exactlyOne(delivery.records, "IntegratorSuccessorSessionFixed").event.successor
      const otherSession = IntegratorSessionId.make("integrator-session:issue-273-other-owner")
      const otherLocator = IntegratorCandidateResourceLocator.make("integrator-resource:issue-273-other-candidate")
      const cases = [
        {
          name: "other session",
          observation: IntegratorCandidateCleanupObservation.cases.Foreign.make({
            locator: predecessor.candidateResource,
            observedSessionId: otherSession,
            reason: "OtherSession",
            revision: evidenceRevision
          }),
          outcome: "Preserved"
        },
        {
          name: "transferred resource",
          observation: IntegratorCandidateCleanupObservation.cases.Foreign.make({
            locator: predecessor.candidateResource,
            observedSessionId: successor.sessionId,
            reason: "Transferred",
            revision: evidenceRevision
          }),
          outcome: "Preserved"
        },
        {
          name: "live writer",
          observation: IntegratorCandidateCleanupObservation.cases.Foreign.make({
            locator: predecessor.candidateResource,
            observedSessionId: predecessor.sessionId,
            reason: "LiveWriter",
            revision: evidenceRevision
          }),
          outcome: "Preserved"
        },
        {
          name: "changed revision",
          observation: IntegratorCandidateCleanupObservation.cases.Present.make({
            locator: predecessor.candidateResource,
            revision: removedRevision,
            sessionId: predecessor.sessionId,
            writerQuiescent: true
          }),
          outcome: "Preserved"
        },
        {
          name: "contradictory locator",
          observation: IntegratorCandidateCleanupObservation.cases.Present.make({
            locator: otherLocator,
            revision: evidenceRevision,
            sessionId: predecessor.sessionId,
            writerQuiescent: true
          }),
          outcome: "Preserved"
        },
        {
          name: "unreadable provider facts",
          observation: IntegratorCandidateCleanupObservation.cases.Unreadable.make({
            detail: "provider evidence could not be read",
            locator: predecessor.candidateResource
          }),
          outcome: "Pending"
        }
      ] as const

      for (const scenario of cases) {
        const result = yield* runFullRerunPredecessorCleanupFromHistory({
          activations: 1,
          evidenceRevision,
          history: delivery.records,
          observations: [scenario.observation]
        })
        expect(
          result.boundaryCalls.map(({ _tag }) => _tag),
          scenario.name
        ).toEqual(["Observe"])
        expect(result.outcomes[0]?.candidate?._tag, scenario.name).toBe(scenario.outcome)
        expect(
          result.records.some(({ event }) => event._tag === "IntegratorCandidateCleanupMutationIntended"),
          scenario.name
        ).toBe(false)
        expect(
          result.records.some(({ event }) => event._tag === "IntegratorCandidateCleanupSettled"),
          scenario.name
        ).toBe(false)
        expect(result.upstreamAfter, scenario.name).toEqual(result.upstreamBefore)
      }
    }),
  timeout
)
