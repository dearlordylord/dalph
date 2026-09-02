import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect } from "effect"
import { expect } from "vitest"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

const lastItemIndex = -1
const capstoneTimeout = 600_000
const capstoneRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.autonomousExecutorDeliveryCapstone).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)
const historicalRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStory).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

it("records B Safe then rereads tracker G1 before D begins and preserves the activation return", () => {
  const story = maintainedAuthoredCassetteCatalog.autonomousExecutorDeliveryCapstone.story
  const bSafe = story.findIndex(
    (item) =>
      item._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" &&
      item.report._tag === "ExecutorWorkSafelySuspended" &&
      item.report.attemptId === "attempt:B:1"
  )

  expect(bSafe).toBeGreaterThanOrEqual(0)
  expect(story.slice(bSafe, bSafe + 6)).toMatchObject([
    {
      _tag: "PlannedAttemptExecutorPassiveLifecycleChanged",
      report: { _tag: "ExecutorWorkSafelySuspended", attemptId: "attempt:B:1" }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "delivery-story-target" } },
    { _tag: "TrackerGraphReadReturned", graph: { revision: "delivery-story-G1" } },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:D:3" },
      request: "Begin"
    },
    {
      _tag: "PlannedAttemptExecutorProjectionReturned",
      report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:D:3" }
    },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    }
  ])
})

it.effect(
  "observes reduced capacity revision two before the authored restart cut",
  () =>
    Effect.gen(function* () {
      const run = yield* capstoneRun
      const changes = run.records.filter(({ event }) => event._tag === "TaskWorkCapacityChanged")

      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({
        event: { _tag: "TaskWorkCapacityChanged", capacity: 2, previousRevision: 1, revision: 2 },
        runId: run.runId
      })
      expect(
        run.records.some(
          ({ event }) => event._tag === "TaskWorkCapacityChanged" && (event.revision > 2 || event.capacity !== 2)
        )
      ).toBe(false)

      const reduced = run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrence._tag === "SetTaskExecutionCapacity"
      )
      const death = run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrence._tag === "CoordinatorProcessDies"
      )
      expect(reduced).toBeDefined()
      expect(death).toBeDefined()
      if (reduced === undefined || death === undefined) return
      expect(reduced.captureOrder).toBeLessThan(death.captureOrder)
      expect(reduced.activationOrdinal).toBe(death.activationOrdinal)
    }),
  capstoneTimeout
)

it.effect(
  "records exactly one C2 Safe ordinal before Continue B",
  () =>
    Effect.gen(function* () {
      const run = yield* capstoneRun
      const c2Reports = run.records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.runId === run.runId &&
          event.report.correlation.attemptId === "attempt:C:2"
      )

      expect(
        c2Reports.map(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported"
            ? { ordinal: event.ordinal, report: event.report._tag }
            : undefined
        )
      ).toEqual([
        { ordinal: 1, report: "ExecutorWorkExecuting" },
        { ordinal: 2, report: "ExecutorWorkSafelySuspended" }
      ])
      expect(
        c2Reports.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.ordinal === 3)
      ).toBe(false)

      const safe = run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
          capture.occurrence.request === "Suspend" &&
          capture.occurrence.report._tag === "ExecutorWorkSafelySuspended" &&
          capture.occurrence.report.attemptId === "attempt:C:2"
      )
      const continued = run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.occurrence._tag === "OperatorContinuesAttempt" &&
          capture.occurrence.attemptId === "attempt:B:1"
      )
      expect(safe).toBeDefined()
      expect(continued).toBeDefined()
      if (safe === undefined || continued === undefined) return
      expect(safe.captureOrder).toBeLessThan(continued.captureOrder)
    }),
  capstoneTimeout
)

it.effect(
  "runs reconstructed ordinary activation through strict exact projections before returning unsettled responsibility",
  () =>
    Effect.gen(function* () {
      const run = yield* capstoneRun
      const reconstructedOccurrences = run.observationCaptures.flatMap((capture) =>
        capture.activationOrdinal === 2 && capture._tag === "AuthoredStoryOccurrenceCaptured"
          ? [capture.occurrence]
          : []
      )
      const returnedAt = reconstructedOccurrences.findIndex((item) => item._tag === "CoordinatorActivationReturned")
      expect(returnedAt).toBeGreaterThanOrEqual(0)
      expect(reconstructedOccurrences.slice(0, returnedAt + 1)).toMatchObject([
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph" } },
        { _tag: "TrackerGraphReadReturned", graph: { revision: "delivery-story-G1" } },
        {
          _tag: "PlannedAttemptExecutorProjectionReturned",
          report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:A:0" }
        },
        {
          _tag: "PlannedAttemptExecutorProjectionReturned",
          report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:C:2" }
        },
        {
          _tag: "PlannedAttemptExecutorProjectionReturned",
          report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:D:3" }
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph" } },
        { _tag: "TrackerGraphReadReturned", graph: { revision: "delivery-story-G1" } },
        {
          _tag: "CoordinatorActivationReturned",
          decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
        }
      ])
      expect(
        reconstructedOccurrences
          .slice(0, returnedAt + 1)
          .some((item) =>
            [
              "TaskWorkSpecificationReadReturned",
              "TaskClaimReadReturned",
              "PlannedAttemptWorktreeReadReturned",
              "TargetLineageReadReturned",
              "PlannedAttemptExecutorWorkReported"
            ].includes(item._tag)
          )
      ).toBe(false)
    }),
  capstoneTimeout
)

it.effect(
  "emits the exact DS01 through DS13 delivery checkpoint table",
  () =>
    Effect.gen(function* () {
      const run = yield* capstoneRun
      const initial = run.deliveryFrames.find(({ graph }) => graph._tag === "Established")

      expect(run.reactivationOwnerProcessGenerationCount).toBe(2)
      expect(initial?.capacity).toBe(3)
      expect(
        initial?.graph._tag === "Established"
          ? initial.graph.tasks.map(({ id, prerequisiteIds }) => ({ id, prerequisiteIds }))
          : []
      ).toEqual(["A", "B", "C", "D", "E"].map((id) => ({ id, prerequisiteIds: [] })))
    }),
  capstoneTimeout
)

it.effect(
  "consumes a staggered graph while restart-added X waits for recovered capacity",
  () =>
    Effect.gen(function* () {
      const run = yield* historicalRun
      const established = run.deliveryFrames.filter(({ graph }) => graph._tag === "Established")
      const completeTopology = established.find(
        ({ graph }) => graph._tag === "Established" && graph.tasks.length === 10
      )
      const edges =
        completeTopology?.graph._tag === "Established"
          ? completeTopology.graph.tasks.flatMap(({ id, prerequisiteIds }) =>
              prerequisiteIds.map((prerequisiteId) => `${prerequisiteId}->${id}`)
            )
          : []
      const heldSets = run.deliveryFrames.map(({ heldPositions }) =>
        heldPositions
          .map(({ taskId }) => taskId)
          .toSorted()
          .join("+")
      )
      const eligibleSets = established.map(({ frontier }) =>
        frontier
          .filter(({ standing }) => standing === "Eligible")
          .map(({ taskId }) => taskId)
          .toSorted()
          .join("+")
      )
      const expectedFrontiers = ["A", "B+C", "B+C+X", "D+X", "E+F", "H+I", "G", ""]
      let previousFrontier = lastItemIndex
      const frontierPositions = expectedFrontiers.map((frontier) => {
        previousFrontier = eligibleSets.indexOf(frontier, previousFrontier + 1)
        return previousFrontier
      })
      const expectedOverlaps = ["B+C", "C", "X", "D", "E+F", "F", "H+I", "I", "G"]
      let previousOverlap = lastItemIndex
      const overlapPositions = expectedOverlaps.map((overlap) => {
        previousOverlap = heldSets.indexOf(overlap, previousOverlap + 1)
        return previousOverlap
      })
      const taskByAttempt = new Map(
        run.records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
            ? [[event.plannedAttempt.attemptId, event.plannedAttempt.taskId] as const]
            : []
        )
      )
      const taskWork = run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          ? [`began:${event.plannedAttempt.taskId}`]
          : event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
            ? [`terminal:${taskByAttempt.get(event.report.correlation.attemptId)}`]
            : []
      )
      const taskIds = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "X"]
      const expectedExecutionOrder = ["A", "B", "C", "X", "D", "E", "F", "H", "I", "G"]
      const currentTaskGraphReads = run.records.flatMap(({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTrackerGraph" &&
        event.operation.cause._tag === "WorkflowEstablishment" &&
        event.operation.predecessorOperationIds.length === 0 &&
        event.operation.readShape.explicitlyCoveredTaskIds.length === 1
          ? event.operation.readShape.explicitlyCoveredTaskIds
          : []
      )
      const claimIntents = run.records.flatMap(({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition.taskId] : []
      )

      expect(completeTopology).toBeDefined()
      expect(edges.toSorted()).toEqual([
        "A->B",
        "A->C",
        "A->X",
        "B->D",
        "C->D",
        "D->E",
        "D->F",
        "E->H",
        "F->I",
        "H->G",
        "I->G",
        "X->G"
      ])
      expect(completeTopology?.frontier).toHaveLength(10)
      expect(overlapPositions.every((position) => position >= 0)).toBe(true)
      expect(frontierPositions.every((position) => position >= 0)).toBe(true)
      expect(
        run.deliveryFrames.every(({ capacity, heldPositions }) => capacity === 2 && heldPositions.length <= 2)
      ).toBe(true)
      expect(taskWork.toSorted()).toEqual(
        taskIds.flatMap((taskId) => [`began:${taskId}`, `terminal:${taskId}`]).toSorted()
      )
      expect(currentTaskGraphReads).toEqual(expectedExecutionOrder)
      expect(claimIntents).toEqual(expectedExecutionOrder)
      const aSettledAt = run.records.findIndex(
        ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === "A"
      )
      const bBeganAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === "B"
      )
      expect(aSettledAt).toBeGreaterThanOrEqual(0)
      expect(bBeganAt).toBeGreaterThan(aSettledAt)
      expect(
        run.records.flatMap(({ event }) =>
          event._tag === "IntegrationFinalitySettled" ? [event.claim.plannedAttempt.taskId] : []
        )
      ).toEqual(["A", "B", "C", "X", "D", "E", "F", "H", "I", "G"])
      expect(
        run.records.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report._tag === "ExecutorWorkTerminal" &&
            event.report.result._tag === "Completed"
        )
      ).toBe(false)
      expect(run.records.at(lastItemIndex)?.event._tag).toBe("WorkflowRunTerminated")
      expect(run.deliveryFrames.at(lastItemIndex)?.heldPositions).toEqual([])
      expect(run.cassette.story.at(lastItemIndex)?._tag).toBe("ExpectedBehavior")
    }),
  capstoneTimeout
)

it.effect(
  "preserves the double-diamond middle positions across coordinator restart",
  () =>
    Effect.gen(function* () {
      const run = yield* historicalRun
      const initial = run.deliveryFrames.find(
        ({ heldPositions }) =>
          heldPositions.some(({ taskId }) => taskId === "B") && heldPositions.some(({ taskId }) => taskId === "C")
      )
      const later = run.deliveryFrames.find(
        ({ activationOrdinal }) => initial !== undefined && activationOrdinal > initial.activationOrdinal
      )
      const correlations = (frame: NonNullable<typeof initial>) =>
        frame.heldPositions
          .filter(({ taskId }) => taskId === "B" || taskId === "C")
          .map(({ attemptId, runId, taskId }) => `${taskId}:${runId}:${attemptId}`)
          .toSorted()

      expect(initial).toBeDefined()
      expect(later).toBeDefined()
      if (initial === undefined || later === undefined) return
      expect(later.heldPositions.map(({ taskId }) => taskId).toSorted()).toEqual(["B", "C"])
      expect(correlations(later)).toEqual(correlations(initial))
      const xObservedWithBothPositions = run.deliveryFrames.findIndex(
        ({ graph, heldPositions }) =>
          graph._tag === "Established" &&
          graph.tasks.some(({ id }) => id === "X") &&
          ["B", "C"].every((taskId) => heldPositions.some((position) => position.taskId === taskId))
      )
      const xHeld = run.deliveryFrames.findIndex(({ heldPositions }) =>
        heldPositions.some(({ taskId }) => taskId === "X")
      )
      expect(xObservedWithBothPositions).toBeGreaterThanOrEqual(0)
      expect(xHeld).toBeGreaterThan(xObservedWithBothPositions)
      expect(run.deliveryFrames[xHeld]?.heldPositions.some(({ taskId }) => taskId === "B" || taskId === "C")).toBe(
        false
      )
    }),
  capstoneTimeout
)
