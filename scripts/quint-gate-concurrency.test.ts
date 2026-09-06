import { describe, expect, it } from "vitest"

import { quintGateBatchResults, quintGateFamilyConcurrency, runQuintGateFamily } from "./quint-gate-concurrency.mjs"

const controlledCompletion = () => {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const controlledCommands = (commands: ReadonlyArray<string>) =>
  new Map(commands.map((command) => [command, controlledCompletion()] as const))

const controlledCommand = (values: ReturnType<typeof controlledCommands>, command: string) => {
  const value = values.get(command)
  if (value === undefined) throw new Error(`missing controlled command ${command}`)
  return value
}

describe("Quint gate family scheduler", () => {
  it("keeps a fixed family bound and restores input order after out-of-order completion", async () => {
    let active = 0
    let peak = 0
    const completionOrder: Array<string> = []
    const releases = controlledCommands(["slow", "fast", "medium"])
    const started = controlledCommands(["slow", "fast", "medium"])
    const completed = controlledCommands(["slow", "fast", "medium"])
    const execution = runQuintGateFamily({
      commands: ["slow", "fast", "medium"],
      run: async (command) => {
        active += 1
        peak = Math.max(peak, active)
        controlledCommand(started, command).resolve()
        await controlledCommand(releases, command).promise
        completionOrder.push(command)
        active -= 1
        controlledCommand(completed, command).resolve()
        return `${command} result`
      }
    })

    await Promise.all([controlledCommand(started, "slow").promise, controlledCommand(started, "fast").promise])
    controlledCommand(releases, "fast").resolve()
    await controlledCommand(started, "medium").promise
    controlledCommand(releases, "medium").resolve()
    await controlledCommand(completed, "medium").promise
    controlledCommand(releases, "slow").resolve()
    const results = await execution

    expect(peak).toBe(quintGateFamilyConcurrency)
    expect(completionOrder).toEqual(["fast", "medium", "slow"])
    expect(results).toEqual(["slow result", "fast result", "medium result"])
  })

  it("caps a caller-requested concurrency above the fixed family bound", async () => {
    let active = 0
    let peak = 0
    const startedCommands: Array<string> = []
    const releases = controlledCommands(["first", "second", "third", "fourth"])
    const started = controlledCommands(["first", "second", "third", "fourth"])
    const execution = runQuintGateFamily({
      commands: ["first", "second", "third", "fourth"],
      concurrency: 3,
      run: async (command) => {
        active += 1
        peak = Math.max(peak, active)
        startedCommands.push(command)
        controlledCommand(started, command).resolve()
        await controlledCommand(releases, command).promise
        active -= 1
        return command
      }
    })

    await Promise.all([controlledCommand(started, "first").promise, controlledCommand(started, "second").promise])
    const initiallyStarted = [...startedCommands]
    for (const release of releases.values()) release.resolve()
    const results = await execution

    expect(peak).toBe(quintGateFamilyConcurrency)
    expect(initiallyStarted).toEqual(["first", "second"])
    expect(results).toEqual(["first", "second", "third", "fourth"])
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
            signal.addEventListener(
              "abort",
              () => {
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
          await new Promise<never>((_resolve, reject) => {
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
