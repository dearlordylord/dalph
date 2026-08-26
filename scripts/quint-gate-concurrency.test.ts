import { describe, expect, it } from "vitest"

import { quintGateBatchResults, quintGateFamilyConcurrency, runQuintGateFamily } from "./quint-gate-concurrency.mjs"

describe("Quint gate family scheduler", () => {
  it("keeps a fixed family bound and restores input order after out-of-order completion", async () => {
    let active = 0
    let peak = 0
    const completionOrder: Array<string> = []
    const results = await runQuintGateFamily({
      commands: ["slow", "fast", "medium"],
      run: async (command) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, command === "slow" ? 30 : command === "fast" ? 5 : 10))
        completionOrder.push(command)
        active -= 1
        return `${command} result`
      }
    })

    expect(peak).toBe(quintGateFamilyConcurrency)
    expect(completionOrder).toEqual(["fast", "medium", "slow"])
    expect(results).toEqual(["slow result", "fast result", "medium result"])
  })

  it("aborts running siblings and does not admit work after the first failure", async () => {
    const started: Array<string> = []
    const aborted: Array<string> = []
    let failure: unknown

    try {
      await runQuintGateFamily({
        commands: ["failure", "sibling", "not-admitted"],
        run: async (command, signal) => {
          started.push(command)
          if (command === "failure") throw new Error("selected command failed")
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 1000)
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer)
                aborted.push(command)
                resolve(undefined)
              },
              { once: true }
            )
          })
          return command
        }
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({ message: "selected command failed" })
    expect(started).toEqual(["failure", "sibling"])
    expect(aborted).toEqual(["sibling"])
    expect(quintGateBatchResults(failure)).toEqual([
      { status: "rejected", reason: expect.any(Error) },
      { status: "fulfilled", value: "sibling" },
      undefined
    ])
  })

  it("retains the first command failure when a cancelled sibling also rejects", async () => {
    let failure: unknown
    try {
      await runQuintGateFamily({
        commands: ["first failure", "cancelled sibling"],
        run: async (command, signal) => {
          if (command === "first failure") throw new Error("first failure is authoritative")
          await new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("sibling cancellation")), { once: true })
          })
          return command
        }
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({ message: "first failure is authoritative" })
  })

  it("rejects an invalid concurrency bound before starting a command", async () => {
    const run = async () => "unexpected"
    await expect(runQuintGateFamily({ commands: ["command"], run, concurrency: 0 })).rejects.toThrow("positive integer")
  })
})
