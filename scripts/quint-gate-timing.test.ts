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
    const run = async <A>(durationMilliseconds: number, value: A): Promise<A> => {
      now += durationMilliseconds
      return value
    }

    await timing.measure({ kind: "typecheck", name: "model typecheck", run: () => run(11, "typed") })
    await timing.measure({ kind: "test", name: "model tests", run: () => run(13, "tested") })
    await timing.measure({ kind: "sampled-run", name: "model sampled run", run: () => run(17, "sampled") })
    await timing.measure({ kind: "verify", name: "model verify", run: () => run(19, "verified") })

    expect(timing.records()).toEqual([
      { kind: "typecheck", name: "model typecheck", durationMilliseconds: 11 },
      { kind: "test", name: "model tests", durationMilliseconds: 13 },
      { kind: "sampled-run", name: "model sampled run", durationMilliseconds: 17 },
      { kind: "verify", name: "model verify", durationMilliseconds: 19 }
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

    expect(timing.records()).toEqual([{ kind: "verify", name: "failed verify", durationMilliseconds: 23 }])
    expect(timing.aggregates().verify).toEqual({ count: 1, durationMilliseconds: 23 })
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
    expect(reports[0]).toContain("Quint command timing: test selected governed test 0.04s")
    expect(reports[0]).toContain("Quint phase timing: test 1 command(s), 0.04s")
  })
})
