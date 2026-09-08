import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

import {
  assertQuintHostedDeadlineContract,
  createQuintGateDeadline,
  quintGateRegressionBudgetMilliseconds,
  quintGateSafetyTimeoutMilliseconds
} from "./quint-gate-policy.mjs"
import { createQuintGateTiming, runWithQuintGateTiming } from "./quint-gate-timing.mjs"
// @ts-expect-error The production process runner is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")

describe("Quint hosted deadline", () => {
  it("leaves the accepted reserve and child termination time strictly inside the 16-minute job", () => {
    expect(quintGateRegressionBudgetMilliseconds).toBe(750_000)
    expect(quintGateSafetyTimeoutMilliseconds + 210_000 + 5_000 + 2_000).toBeLessThan(960_000)
  })

  it("checks the production workflow cutoff against the deadline policy", () => {
    expect(() => assertQuintHostedDeadlineContract(workflow)).not.toThrow()
  })

  it.each([
    ["missing job", workflow.replace("  formal-models:", "  other-job:")],
    ["missing cutoff", workflow.replace("    timeout-minutes: 16", "")],
    ["malformed cutoff", workflow.replace("    timeout-minutes: 16", "    timeout-minutes: invalid")],
    ["shortened cutoff", workflow.replace("    timeout-minutes: 16", "    timeout-minutes: 15")],
    ["widened cutoff", workflow.replace("    timeout-minutes: 16", "    timeout-minutes: 17")],
    [
      "duplicate cutoff",
      workflow.replace("    timeout-minutes: 16", "    timeout-minutes: 16\n    timeout-minutes: 16")
    ]
  ])("fails closed on a %s in the workflow", (_name, source) => {
    expect(() => assertQuintHostedDeadlineContract(source)).toThrow("Quint hosted deadline contract")
  })

  it("times out a late wedged child and retains the earlier command result and phase accounting", async () => {
    let now = 100
    const remaining = createQuintGateDeadline({ now: () => now })
    const timing = createQuintGateTiming({ now: () => now })
    const reports: Array<string> = []
    await expect(
      runWithQuintGateTiming({
        timing,
        write: (report) => reports.push(report),
        run: async () => {
          await timing.measure({
            kind: "typecheck",
            name: "completed typecheck",
            run: async () => {
              now += 20
              return { exitCode: 0 }
            }
          })
          now = 100 + quintGateSafetyTimeoutMilliseconds - 500
          expect(remaining("late wedged verify")).toBe(500)
          await timing.measure({
            kind: "verify",
            name: "late wedged verify",
            run: async () => {
              try {
                return await runBoundedCommand({
                  args: ["-e", "setInterval(() => {}, 1000)"],
                  executable: process.execPath,
                  forwardOutput: false,
                  name: "late wedged verify",
                  timeoutMilliseconds: remaining("late wedged verify")
                })
              } finally {
                now += 500
              }
            }
          })
        }
      })
    ).rejects.toMatchObject({ quintCommandResult: "timed-out", message: "late wedged verify exceeded 0.5 seconds" })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toContain("typecheck completed typecheck 0.02s result=exit:0")
    expect(reports[0]).toContain("verify late wedged verify 0.50s result=timed-out")
    expect(reports[0]).toContain("Quint phase timing: typecheck 1 command(s), 0.02s")
    expect(reports[0]).toContain("Quint phase timing: verify 1 command(s), 0.50s")
  })

  it("rejects command admission after the absolute deadline instead of starting a fresh one-millisecond timeout", () => {
    let now = 10
    const remaining = createQuintGateDeadline({ now: () => now })
    now = 10 + quintGateSafetyTimeoutMilliseconds
    expect(() => remaining("not admitted")).toThrow("not admitted")
    try {
      remaining("not admitted")
    } catch (error) {
      expect(error).toMatchObject({ quintCommandResult: "timed-out" })
    }
  })
})
