import { describe, expect, it } from "vitest"

import {
  createQuintGateTiming,
  formatQuintGateTimingReport,
  quintCommandKindForArgs,
  runWithQuintGateTiming
} from "./quint-gate-timing.mjs"

describe("Quint gate timing", () => {
  it("classifies the four commands used by the formal gate", () => {
    expect(quintCommandKindForArgs(["typecheck", "model.qnt"])).toBe("typecheck")
    expect(quintCommandKindForArgs(["test", "model_test.qnt"])).toBe("test")
    expect(quintCommandKindForArgs(["run", "model.qnt"])).toBe("sampled-run")
    expect(quintCommandKindForArgs(["verify", "model.qnt"])).toBe("verify")
    expect(() => quintCommandKindForArgs(["compile", "model.qnt"])).toThrow("Unknown Quint command")
  })

  it("records each typecheck, test, sampled run, and verify command and their aggregates", async () => {
    let now = 100
    const timing = createQuintGateTiming({ now: () => now })
    const run = async (durationMilliseconds: number, exitCode: number) => {
      now += durationMilliseconds
      return { exitCode }
    }

    await timing.measure({ kind: "typecheck", name: "model typecheck", run: () => run(11, 0) })
    await timing.measure({ kind: "test", name: "model tests", run: () => run(13, 0) })
    await timing.measure({ kind: "sampled-run", name: "model sampled run", run: () => run(17, 0) })
    await timing.measure({ kind: "verify", name: "expected temporal mutant", run: () => run(19, 1) })

    expect(timing.records()).toEqual([
      { kind: "typecheck", name: "model typecheck", durationMilliseconds: 11, result: "exit:0" },
      { kind: "test", name: "model tests", durationMilliseconds: 13, result: "exit:0" },
      { kind: "sampled-run", name: "model sampled run", durationMilliseconds: 17, result: "exit:0" },
      { kind: "verify", name: "expected temporal mutant", durationMilliseconds: 19, result: "exit:1" }
    ])
    expect(timing.aggregates()).toEqual({
      typecheck: { count: 1, durationMilliseconds: 11 },
      test: { count: 1, durationMilliseconds: 13 },
      "sampled-run": { count: 1, durationMilliseconds: 17 },
      verify: { count: 1, durationMilliseconds: 19 }
    })
  })

  it("records a failed command before returning its failure", async () => {
    let now = 0
    const timing = createQuintGateTiming({ now: () => now })

    await expect(
      timing.measure({
        kind: "verify",
        name: "failed verify",
        run: async () => {
          now = 23
          throw new Error("fixture failure")
        }
      })
    ).rejects.toThrow("fixture failure")

    expect(timing.records()).toEqual([
      { kind: "verify", name: "failed verify", durationMilliseconds: 23, result: "failed" }
    ])
    expect(timing.aggregates().verify).toEqual({ count: 1, durationMilliseconds: 23 })
  })

  it("reports concurrently completed commands in their reserved identity order", async () => {
    let now = 0
    const timing = createQuintGateTiming({ now: () => now })
    const slow = timing.measure({
      kind: "verify",
      name: "first identity",
      order: 0,
      run: async () => {
        await Promise.resolve()
        now += 30
        return { exitCode: 0 }
      }
    })
    const fast = timing.measure({
      kind: "test",
      name: "second identity",
      order: 1,
      run: async () => {
        now += 5
        return { exitCode: 0 }
      }
    })

    await Promise.all([slow, fast])
    expect(timing.records()).toEqual([
      { kind: "verify", name: "first identity", durationMilliseconds: 35, result: "exit:0" },
      { kind: "test", name: "second identity", durationMilliseconds: 35, result: "exit:0" }
    ])
  })

  it("reports accumulated timings in finally while preserving the command failure", async () => {
    let now = 0
    const timing = createQuintGateTiming({ now: () => now })
    const reports: Array<string> = []

    await expect(
      runWithQuintGateTiming({
        timing,
        run: () =>
          timing.measure({
            kind: "test",
            name: "selected governed test",
            run: async () => {
              now = 41
              throw new Error("original governed test failure")
            }
          }),
        write: (report) => reports.push(report)
      })
    ).rejects.toThrow("original governed test failure")

    expect(reports).toHaveLength(1)
    expect(reports[0]).toBe(formatQuintGateTimingReport(timing))
    expect(reports[0]).toContain("Quint command timing: test selected governed test 0.04s result=failed")
    expect(reports[0]).toContain("Quint phase timing: test 1 command(s), 0.04s")
  })

  it("fails closed instead of recording an unknown successful result", async () => {
    const timing = createQuintGateTiming()
    await expect(
      timing.measure({
        kind: "test",
        name: "invalid result",
        // @ts-expect-error This negative control supplies the malformed boundary result rejected at runtime.
        run: async () => ({ outputLineCount: 1 })
      })
    ).rejects.toThrow("invalid result returned no exact exit code")
    expect(timing.records()).toEqual([
      expect.objectContaining({ kind: "test", name: "invalid result", result: "invalid" })
    ])
  })

  it("records an invalid result and fails closed on an unknown failure classification", async () => {
    const timing = createQuintGateTiming()
    const unknownFailure = Object.assign(new Error("unknown failure"), { quintCommandResult: "mystery" })
    await expect(
      timing.measure({
        kind: "verify",
        name: "unknown failure result",
        run: async () => Promise.reject(unknownFailure)
      })
    ).rejects.toThrow("unknown failure result produced unknown command result: mystery")
    expect(timing.records()).toEqual([
      expect.objectContaining({ kind: "verify", name: "unknown failure result", result: "invalid" })
    ])
  })
})
