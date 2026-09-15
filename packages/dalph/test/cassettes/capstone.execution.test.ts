import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { runAuthoredScenarioCassette } from "../../src/cassettes/authored-runner.js"
import { deliveryStoryCapstoneAuthoredCassette } from "../../src/cassettes/delivery-story-capstone.js"
import { assertDeliveryCapstoneCheckpoints } from "./delivery-capstone-checkpoints.test-support.js"
import {
  assertDeliveryCapstoneFinalityCorrelations,
  assertDeliveryCapstonePredecessorCleanup
} from "./delivery-capstone-cleanup.test-support.js"
import { assertDeliveryCapstoneFreshReplay } from "./delivery-capstone-replay.test-support.js"

const capstoneTimeout = 600_000
// Acceptance assertions share one completed run; replay still executes a second fresh journal.
const cachedCapstoneRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(deliveryStoryCapstoneAuthoredCassette).pipe(Effect.provide(NodeCrypto.layer))
  )
)

it.effect(
  "maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedCapstoneRun
      expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
      yield* assertDeliveryCapstoneCheckpoints(run)
      const occurrences = run.observationCaptures.flatMap((capture) =>
        capture._tag === "AuthoredStoryOccurrenceCaptured"
          ? [{ storyPosition: capture.storyPosition, occurrence: capture.occurrence }]
          : []
      )
      // 403 authored source occurrences minus one unsupported selection leaves 402 executed story items.
      expect(deliveryStoryCapstoneAuthoredCassette.story).toHaveLength(402)
      expect(occurrences).toEqual(
        deliveryStoryCapstoneAuthoredCassette.story.map((occurrence, index) => ({
          storyPosition: index + 1,
          occurrence
        }))
      )
      expect(run.activationOrdinals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
      expect(run.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
      const settlements = run.records.flatMap(({ event }) =>
        event._tag === "IntegrationFinalitySettled" ? [event] : []
      )
      expect(
        settlements.map(({ claim }) => ({
          taskId: claim.plannedAttempt.taskId,
          attemptId: claim.plannedAttempt.attemptId,
          runId: claim.plannedAttempt.runId
        }))
      ).toEqual([
        { taskId: "A", attemptId: "attempt:A:0", runId: run.runId },
        { taskId: "B", attemptId: "attempt:B:2", runId: run.runId },
        { taskId: "C", attemptId: "attempt:C:1", runId: run.runId },
        { taskId: "D", attemptId: "attempt:D:0", runId: run.runId },
        { taskId: "E", attemptId: "attempt:E:0", runId: run.runId },
        { taskId: "F", attemptId: "attempt:F:1", runId: run.runId },
        { taskId: "G", attemptId: "attempt:G:0", runId: run.runId }
      ])
      expect(new Set(settlements.map(({ claim }) => claim.plannedAttempt.taskId)).size).toBe(7)
      const successorRecord = run.records.find(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")
      const aSettlement = settlements.find(({ claim }) => claim.plannedAttempt.taskId === "A")
      if (successorRecord?.event._tag !== "IntegratorSuccessorSessionFixed" || aSettlement === undefined)
        return expect.fail("missing A's exact FullRerun successor or settlement")
      const { predecessor, successor } = successorRecord.event
      const aPromotion = aSettlement.claim.promotionCorrelation
      const aCandidate = aPromotion.qualifiedCandidate
      expect(aCandidate.run.session).toEqual(successor)
      expect(aCandidate.run.session.sessionId).not.toBe(predecessor.sessionId)
      expect(aCandidate.run.session.candidateResource).not.toBe(predecessor.candidateResource)
      expect(aCandidate.candidateCommit).toBe("d".repeat(40))
      expect(aCandidate.directParents).toEqual(["2".repeat(40), "3".repeat(40)])
      const qualification = run.records.find(({ position }) => position === aCandidate.qualifiedAt)
      expect(qualification?.event).toMatchObject({
        _tag: "IntegratorRunCandidateGitObserved",
        run: aCandidate.run,
        candidateText: aCandidate.candidateText,
        observation: { _tag: "Commit", commit: aCandidate.candidateCommit, directParents: aCandidate.directParents }
      })
      const stalePromotion = run.records.find(
        ({ event }) =>
          event._tag === "TargetPromotionStale" &&
          event.correlation.qualifiedCandidate.run.session.sessionId === predecessor.sessionId
      )
      const successfulPromotion = run.records.find(
        ({ event }) =>
          event._tag === "TargetPromotionObservedSuccess" && event.correlation.requestId === aPromotion.requestId
      )
      if (stalePromotion === undefined || successfulPromotion?.event._tag !== "TargetPromotionObservedSuccess")
        return expect.fail("missing rejected predecessor or promoted successor evidence")
      expect(successfulPromotion.event.correlation).toEqual(aPromotion)
      expect(successorRecord.position).toBeGreaterThan(stalePromotion.position)
      expect(aCandidate.qualifiedAt).toBeGreaterThan(successorRecord.position)
      expect(successfulPromotion.position).toBeGreaterThan(aCandidate.qualifiedAt)
      expect(aSettlement.successObservation.observedAt).toBeGreaterThan(successfulPromotion.position)
      const finalResponses = occurrences.flatMap(({ occurrence }) =>
        occurrence._tag === "TrackerGraphReadReturned" && occurrence.graph.revision === "Gfinal"
          ? [occurrence.graph]
          : []
      )
      expect(finalResponses).toHaveLength(2)
      expect(finalResponses[1]).toEqual(finalResponses[0])
      const finalReads = [
        ...new Map(
          run.deliveryFrames.flatMap(({ graph }) =>
            graph._tag === "Established" && graph.revision === "Gfinal"
              ? [[graph.observation.operationId, graph] as const]
              : []
          )
        ).values()
      ]
      expect(finalReads).toHaveLength(2)
      const [firstFinalRead, laterFinalRead] = finalReads
      if (firstFinalRead === undefined || laterFinalRead === undefined)
        return expect.fail("missing two distinct durable Gfinal observations")
      expect(laterFinalRead.observation.operationId).not.toBe(firstFinalRead.observation.operationId)
      expect(laterFinalRead.observation.recordedAt).toBeGreaterThan(firstFinalRead.observation.recordedAt)
      expect(laterFinalRead.tasks).toEqual(firstFinalRead.tasks)
      const finalIntent = run.records.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation.operationId === laterFinalRead.observation.operationId
      )
      if (finalIntent?.event._tag !== "TaskTrackerReadIntentRecorded")
        return expect.fail("missing later Gfinal read intent")
      expect(finalIntent.event.operation).toMatchObject({
        _tag: "ReadTrackerGraph",
        cause: { _tag: "PostQuiescenceReconfirmation" }
      })
      const settlementPositions = run.records.flatMap(({ event, position }) =>
        event._tag === "IntegrationFinalitySettled" ? [position] : []
      )
      const lastSettlementPosition = Math.max(...settlementPositions)
      expect(finalIntent.position).toBeGreaterThan(lastSettlementPosition)
      expect(finalIntent.position).toBeGreaterThan(firstFinalRead.observation.recordedAt)
      expect(laterFinalRead.observation.recordedAt).toBeGreaterThan(finalIntent.position)
      expect(
        run.records.find(({ position }) => position === firstFinalRead.observation.recordedAt)?.event
      ).toMatchObject({ _tag: "TaskTrackerFactsObserved", operationId: firstFinalRead.observation.operationId })
      const quiescentMoment = run.observationMoments.findLast(
        ({ deliveryFrame, liveOwners }) =>
          deliveryFrame !== null &&
          deliveryFrame.acceptedAt !== null &&
          deliveryFrame.acceptedAt >= lastSettlementPosition &&
          deliveryFrame.acceptedAt < finalIntent.position &&
          deliveryFrame.quiescence._tag === "TrackerReconfirmationAllowed" &&
          liveOwners.length === 0
      )
      if (quiescentMoment?.deliveryFrame === undefined || quiescentMoment.deliveryFrame === null)
        return expect.fail("missing quiescent observation before the later Gfinal read")
      expect(quiescentMoment.deliveryFrame.heldPositions).toEqual([])
      expect(quiescentMoment.deliveryFrame.settlements).toHaveLength(7)
      expect(quiescentMoment.deliveryFrame.actionPlanning).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: []
      })
      const terminations = run.records.flatMap(({ event }) => (event._tag === "WorkflowRunTerminated" ? [event] : []))
      expect(terminations).toHaveLength(1)
      expect(terminations.map(({ disposition }) => disposition)).toEqual(["Completed"])
      expect(terminations[0]?.evidence).toMatchObject({
        runId: run.runId,
        operationId: laterFinalRead.observation.operationId,
        observedAt: laterFinalRead.observation.recordedAt,
        contentIdentity: "Gfinal",
        graphOutcome: "AllTasksSucceeded",
        complete: true
      })
      expect(
        run.records.find(({ position }) => position === laterFinalRead.observation.recordedAt)?.event
      ).toMatchObject({ _tag: "TaskTrackerFactsObserved", operationId: laterFinalRead.observation.operationId })
      const terminalRecord = run.records.find(({ event }) => event._tag === "WorkflowRunTerminated")
      expect(terminalRecord?.position).toBeGreaterThan(laterFinalRead.observation.recordedAt)
    }).pipe(Effect.provide(NodeCrypto.layer)),
  capstoneTimeout
)

it.effect(
  "completes the uninterrupted seven-task run after reconciling A FullRerun predecessor cleanup",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedCapstoneRun
      assertDeliveryCapstonePredecessorCleanup(run)
      assertDeliveryCapstoneFinalityCorrelations(run)
    }),
  capstoneTimeout
)

it.effect(
  "replays the maintained capstone with the same exact chronology",
  () =>
    Effect.gen(function* () {
      const first = yield* cachedCapstoneRun
      const second = yield* runAuthoredScenarioCassette(deliveryStoryCapstoneAuthoredCassette)
      yield* assertDeliveryCapstoneFreshReplay(first, second)
    }).pipe(Effect.provide(NodeCrypto.layer)),
  capstoneTimeout
)
