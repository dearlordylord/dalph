import { describe, expect, it } from "vitest"

import { quintGateFamilyConcurrency } from "./quint-gate-concurrency.mjs"
import { plannedAttemptExecutorInitialFamily } from "./quint-gate-production-plan.mjs"

describe("production Quint gate plan", () => {
  it("serializes the exact first evaluator-using command before admitting concurrency two", () => {
    expect(quintGateFamilyConcurrency).toBe(2)
    expect(plannedAttemptExecutorInitialFamily.concurrency).toBe(quintGateFamilyConcurrency)
    expect(plannedAttemptExecutorInitialFamily.serializedPrefix).toBe(1)
    expect(plannedAttemptExecutorInitialFamily.commands).toEqual([
      {
        name: "planned-attempt executor deterministic tests",
        args: ["test", "specs/plannedAttemptExecutor_test.qnt", "--main", "plannedAttemptExecutorTest"]
      },
      {
        name: "planned-attempt executor negative mutation profile",
        args: ["test", "specs/plannedAttemptExecutor_negative_test.qnt", "--main", "plannedAttemptExecutorNegativeTest"]
      },
      expect.objectContaining({
        name: "planned-attempt executor sampled model",
        args: expect.arrayContaining(["run", "specs/plannedAttemptExecutor.qnt", "--max-samples", "10000"])
      })
    ])
  })
})
