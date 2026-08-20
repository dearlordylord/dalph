import { describe, expect, it } from "vitest"
import { runDeliveryLoopCrashRestartScenario } from "../src/delivery-loop-harness.ts"

describe("production-shaped durable delivery loop", () => {
  it("reuses the stored action result after restart, republishes its accepted fact, and does not call the boundary twice", async () => {
    const result = await runDeliveryLoopCrashRestartScenario({
      adapter: "effect-workflow-v1",
      actionCount: 1
    })

    expect(result.executionIds).toHaveLength(1)
    expect(result.attemptIds).toEqual([])
    expect(result.reservedAttemptIds).toEqual(["attempt-232-ambiguity-0001"])
    expect(result.boundaryCalls).toEqual([
      expect.objectContaining({
        operationId: "delivery-operation-233-0001",
        processInstance: "process-1"
      })
    ])
    expect(result.publications).toEqual([
      expect.objectContaining({
        operationId: "delivery-operation-233-0001",
        processInstance: "process-2"
      })
    ])
    expect(result.proposalObservations).toEqual([
      "PresentBeforeCrash",
      "PresentAfterRestartBeforePublication",
      "AbsentAfterAcceptedFactPublication"
    ])
  })

  it("reads current facts after replayed publication before the next current-state decision", async () => {
    const result = await runDeliveryLoopCrashRestartScenario({
      adapter: "effect-workflow-v1",
      actionCount: 1
    })

    expect(result.providerCalls.filter(({ request }) => request === "GitHub.ReadCurrentTaskFacts")).toEqual([
      expect.objectContaining({
        processInstance: "process-2",
        result: "Open:OutsideTarget",
        trackerRevision: 2
      })
    ])
    expect(result.publications[0]?.trackerRevision).toBe(1)
    expect(result.currentTaskDecisions).toEqual(["StopOutsideTarget"])
  })

  it("keeps two delivery actions distinct through Workflow and republishes each matching result", async () => {
    const result = await runDeliveryLoopCrashRestartScenario({
      adapter: "effect-workflow-v1",
      actionCount: 2
    })

    expect(result.executionIds).toHaveLength(1)
    expect(result.boundaryCalls.map(({ operationId, target }) => ({ operationId, target }))).toEqual([
      { operationId: "delivery-operation-233-0001", target: "delivery-loop-target" },
      { operationId: "delivery-operation-233-0002", target: "delivery-loop-target" }
    ])
    expect(
      result.publications
        .filter(({ processInstance }) => processInstance === "process-3")
        .map(({ acceptedOperationId, operationId }) => ({ acceptedOperationId, operationId }))
    ).toEqual([
      { acceptedOperationId: "delivery-operation-233-0001", operationId: "delivery-operation-233-0001" },
      { acceptedOperationId: "delivery-operation-233-0002", operationId: "delivery-operation-233-0002" }
    ])
    expect(result.proposalObservations.at(-1)).toBe("AbsentAfterAcceptedFactPublication")
  })

  it("records the suppressed replay-publication negative control", async () => {
    const result = await runDeliveryLoopCrashRestartScenario({
      adapter: "effect-workflow-v1",
      actionCount: 1,
      publicationMode: "Suppress"
    })

    expect(result.publicationSuppressed).toBe(true)
    expect(result.publications).toEqual([])
    expect(result.proposalObservations).not.toContain("AbsentAfterAcceptedFactPublication")
  })

  it("records the generic Activity-identity negative control", async () => {
    const result = await runDeliveryLoopCrashRestartScenario({
      adapter: "effect-workflow-v1",
      actionCount: 2,
      activityIdentityMode: "Generic"
    })

    expect(result.boundaryCalls).toHaveLength(1)
    expect(result.boundaryCalls[0]?.operationId).toBe("delivery-operation-233-0001")
    expect(
      result.publications.find(({ operationId }) => operationId === "delivery-operation-233-0002")
        ?.acceptedOperationId
    ).toBe("delivery-operation-233-0001")
  })

  it("projects the same delivery consequences through the Journal baseline and Workflow adapter", async () => {
    const [baseline, candidate] = await Promise.all([
      runDeliveryLoopCrashRestartScenario({ adapter: "journal-baseline", actionCount: 2 }),
      runDeliveryLoopCrashRestartScenario({ adapter: "effect-workflow-v1", actionCount: 2 })
    ])
    const consequences = (result: typeof baseline) => ({
      canonicalTrace: result.canonicalTrace
    })

    expect(consequences(candidate)).toEqual(consequences(baseline))
  })
})
