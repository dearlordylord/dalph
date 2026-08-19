import { describe, expect, it } from "vitest"
import { runCrashRestartScenario } from "../src/harness.ts"
import { verifyAmbiguousClaimScenario } from "../src/scenario-verification.ts"

describe("durable-computation child-process harness", () => {
  const workflowExecutionId = "54c2759073567a3291c523227a11826d"

  it("checks GitHub after losing the mutation response and does not repeat the request", async () => {
    const result = await runCrashRestartScenario({
      adapter: "journal-baseline",
      faultPoint: "AfterClaimAppliedBeforeReplyRecorded"
    })

    expect(result.executionIds).toEqual(["run-232-ambiguity-0001"])
    expect(result.providerCalls.map(({ request }) => request)).toEqual([
      "GitHub.ReadClaim",
      "GitHub.CreateClaim",
      "GitHub.ReadClaim",
      "GitHub.ReadCurrentTaskFacts"
    ])
    expect(result.providerCalls.filter(({ request }) => request === "GitHub.CreateClaim")).toHaveLength(1)
    expect(result.recoveredDecision).toBe("ContinueSameRun")
    expect(verifyAmbiguousClaimScenario(result)).toEqual({ _tag: "ScenarioAccepted" })
  })

  it("reuses durable evidence when the provider outcome was already recorded", async () => {
    const result = await runCrashRestartScenario({
      adapter: "journal-baseline",
      faultPoint: "AfterClaimReplyDurableBeforeNextRead"
    })

    expect(result.providerCalls.map(({ request }) => request)).toEqual([
      "GitHub.ReadClaim",
      "GitHub.CreateClaim",
      "GitHub.ReadCurrentTaskFacts"
    ])
    expect(result.providerCalls.filter(({ request }) => request === "GitHub.CreateClaim")).toHaveLength(1)
    expect(result.providerCalls[1]?.replyDelivered).toBe(true)
    expect(result.recoveredDecision).toBe("ContinueSameRun")
  })

  it("reads current GitHub facts after downtime instead of replaying an old observation", async () => {
    const result = await runCrashRestartScenario({
      adapter: "journal-baseline",
      faultPoint: "AfterCleanCheckpoint"
    })

    const reads = result.providerCalls.filter(({ request }) => request === "GitHub.ReadCurrentTaskFacts")
    expect(reads.map(({ trackerRevision }) => trackerRevision)).toEqual([2, 3])
    expect(reads.map(({ result: observed }) => observed)).toEqual(["Open:Member", "Open:OutsideTarget"])
    expect(result.recoveredDecision).toBe("Wait")
  })

  it("admits no successor progress after application Exit cutoff", async () => {
    const result = await runCrashRestartScenario({
      adapter: "journal-baseline",
      faultPoint: "AfterExitCutoff"
    })

    const cutoff = result.providerCalls.findIndex(({ request }) => request === "ApplicationExit.CutoffObserved")
    expect(cutoff).toBeGreaterThanOrEqual(0)
    expect(result.providerCalls.slice(cutoff + 1).filter(({ processInstance }) => processInstance === "process-1")).toEqual(
      []
    )
    expect(result.providerCalls.filter(({ request }) => request === "GitHub.CreateClaim")).toHaveLength(1)
    expect(result.recoveredDecision).toBe("ContinueSameRun")
  })

  it("checks GitHub after the Workflow Activity loses its response and does not repeat the request", async () => {
    const result = await runCrashRestartScenario({
      adapter: "effect-workflow-v1",
      faultPoint: "AfterClaimAppliedBeforeReplyRecorded"
    })

    expect(result.executionIds).toEqual([workflowExecutionId])
    expect(result.providerCalls.map(({ request }) => request)).toEqual([
      "GitHub.ReadClaim",
      "GitHub.CreateClaim",
      "GitHub.ReadClaim",
      "GitHub.ReadCurrentTaskFacts"
    ])
    expect(result.providerCalls.filter(({ request }) => request === "GitHub.CreateClaim")).toHaveLength(1)
    expect(result.recoveredDecision).toBe("ContinueSameRun")
    expect(verifyAmbiguousClaimScenario(result)).toEqual({ _tag: "ScenarioAccepted" })
  })

  it("reuses the durable Workflow Activity result when GitHub's reply was recorded", async () => {
    const result = await runCrashRestartScenario({
      adapter: "effect-workflow-v1",
      faultPoint: "AfterClaimReplyDurableBeforeNextRead"
    })

    expect(result.providerCalls.map(({ request }) => request)).toEqual([
      "GitHub.ReadClaim",
      "GitHub.CreateClaim",
      "GitHub.ReadCurrentTaskFacts"
    ])
    expect(result.providerCalls[1]?.replyDelivered).toBe(true)
    expect(result.recoveredDecision).toBe("ContinueSameRun")
  })

  it("replays one exact Run without establishing a duplicate execution", async () => {
    const results = await Promise.all(
      (["journal-baseline", "effect-workflow-v1"] as const).map((adapter) =>
        runCrashRestartScenario({ adapter, faultPoint: "AfterClaimAppliedBeforeReplyRecorded" })
      )
    )

    expect(results.map(({ executionIds }) => executionIds)).toEqual([
      ["run-232-ambiguity-0001"],
      [workflowExecutionId]
    ])
  })

  it.each(["AfterExecutionStored", "AfterClaimIntentBeforeRequest"] as const)(
    "runs the frozen %s crash cut against both adapters",
    async (faultPoint) => {
      const [baseline, candidate] = await Promise.all([
        runCrashRestartScenario({ adapter: "journal-baseline", faultPoint }),
        runCrashRestartScenario({ adapter: "effect-workflow-v1", faultPoint })
      ])

      expect(baseline.recoveredDecision).toBe("ContinueSameRun")
      expect(candidate.recoveredDecision).toBe("ContinueSameRun")
      expect(candidate.canonicalTrace).toEqual(baseline.canonicalTrace)
      expect(baseline.operationalMetrics.firstProcessResidentKiB).toBeGreaterThan(0)
      expect(candidate.operationalMetrics.restartToProgressMilliseconds).toBeGreaterThan(0)
    }
  )

  it("projects equivalent canonical semantics across baseline and candidate", async () => {
    const [baseline, candidate] = await Promise.all([
      runCrashRestartScenario({
        adapter: "journal-baseline",
        faultPoint: "AfterClaimAppliedBeforeReplyRecorded"
      }),
      runCrashRestartScenario({
        adapter: "effect-workflow-v1",
        faultPoint: "AfterClaimAppliedBeforeReplyRecorded"
      })
    ])

    expect(candidate.canonicalTrace).toEqual(baseline.canonicalTrace)
  })

  it.each([
    "AfterClaimReplyDurableBeforeNextRead",
    "AfterCleanCheckpoint",
    "AfterExitCutoff"
  ] as const)("projects equivalent canonical semantics at %s", async (faultPoint) => {
    const [baseline, candidate] = await Promise.all([
      runCrashRestartScenario({ adapter: "journal-baseline", faultPoint }),
      runCrashRestartScenario({ adapter: "effect-workflow-v1", faultPoint })
    ])

    expect(candidate.canonicalTrace).toEqual(baseline.canonicalTrace)
  })

  it("fails closed when unfinished execution code changes incompatibly", async () => {
    const result = await runCrashRestartScenario({
      adapter: "effect-workflow-v1",
      faultPoint: "WithIncompatibleExecutionCode"
    })

    expect(result.providerCalls).toEqual([])
    expect(result.executionIds).toEqual([workflowExecutionId])
    expect(result.recoveredDecision).toBe("FailClosed")
    expect(result.failureDetail).toContain("ReconcileExactTaskClaimV2")
    expect(result.canonicalTrace.some(({ _tag }) => _tag === "TaskClaimAcquisitionIntended")).toBe(true)
    expect(result.canonicalTrace.at(-2)).toEqual({
      _tag: "ExecutionCodeRejected",
      changedStep: "ReconcileExactTaskClaimV2",
      found: "v1",
      requested: "v2"
    })
  })

  it("reads fresh GitHub facts when Workflow replays after ordinary downtime", async () => {
    const result = await runCrashRestartScenario({
      adapter: "effect-workflow-v1",
      faultPoint: "AfterCleanCheckpoint"
    })
    const reads = result.providerCalls.filter(({ request }) => request === "GitHub.ReadCurrentTaskFacts")

    expect(reads.map(({ trackerRevision }) => trackerRevision)).toEqual([2, 3])
    expect(reads.map(({ result: observed }) => observed)).toEqual(["Open:Member", "Open:OutsideTarget"])
    expect(result.recoveredDecision).toBe("Wait")
  })

  it("lets Workflow resume only after a later explicit start following the application Exit cutoff", async () => {
    const result = await runCrashRestartScenario({
      adapter: "effect-workflow-v1",
      faultPoint: "AfterExitCutoff"
    })
    const cutoff = result.providerCalls.findIndex(({ request }) => request === "ApplicationExit.CutoffObserved")

    expect(cutoff).toBeGreaterThanOrEqual(0)
    expect(result.providerCalls.slice(cutoff + 1).filter(({ processInstance }) => processInstance === "process-1")).toEqual(
      []
    )
    expect(result.recoveredDecision).toBe("ContinueSameRun")
  })

  it("rejects all ambiguity negative controls", async () => {
    const accepted = await runCrashRestartScenario({
      adapter: "journal-baseline",
      faultPoint: "AfterClaimAppliedBeforeReplyRecorded"
    })
    const createIndex = accepted.providerCalls.findIndex(({ request }) => request === "GitHub.CreateClaim")
    const create = accepted.providerCalls[createIndex]
    expect(create).toBeDefined()
    if (create === undefined) return

    const withoutReconciliation = {
      ...accepted,
      providerCalls: accepted.providerCalls.filter(
        ({ ordinal, request }) => request !== "GitHub.ReadClaim" || ordinal < create.ordinal
      )
    }
    const repeatedMutation = { ...accepted, providerCalls: [...accepted.providerCalls, create] }
    const rivalExecution = { ...accepted, executionIds: [...accepted.executionIds, "run-232-rival"] }
    const withoutIntent = {
      ...accepted,
      canonicalTrace: accepted.canonicalTrace.filter(({ _tag }) => _tag !== "TaskClaimAcquisitionIntended")
    }

    expect(verifyAmbiguousClaimScenario(withoutReconciliation)._tag).toBe("ScenarioRejected")
    expect(verifyAmbiguousClaimScenario(repeatedMutation)._tag).toBe("ScenarioRejected")
    expect(verifyAmbiguousClaimScenario(rivalExecution)._tag).toBe("ScenarioRejected")
    expect(verifyAmbiguousClaimScenario(withoutIntent)._tag).toBe("ScenarioRejected")
  })
})
