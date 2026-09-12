import { describe, expect, it } from "vitest"

// @ts-expect-error The production subprocess helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

import {
  assertQuintSampledCommandWitnessesObserved,
  assertRequiredWitnessesObserved,
  quintWitnessesFromCommandArgs,
  assertTaskFactReplacementTestCollected,
  validateQuintCommandOutput
} from "./quint-witness-coverage.mjs"

describe("Quint sampled witness coverage", () => {
  it("returns every declared nonzero witness count", () => {
    const observed = assertRequiredWitnessesObserved(
      [
        "Reached was witnessed in 7 trace(s) out of 10000 explored (0.07%)",
        "AlsoReached was witnessed in 2 trace(s) out of 10000 explored (0.02%)"
      ].join("\n"),
      ["Reached", "AlsoReached"]
    )

    expect(Object.fromEntries(observed)).toEqual({ AlsoReached: 2, Reached: 7 })
  })

  it("accepts a valid zero count as a completed search, not proof of unreachability", () => {
    expect(
      Object.fromEntries(
        assertRequiredWitnessesObserved(
          "DeliberatelyUnreachablePhaseReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)",
          ["DeliberatelyUnreachablePhaseReached"]
        )
      )
    ).toEqual({ DeliberatelyUnreachablePhaseReached: 0 })
  })

  it("accepts zero counts uniformly, including the hosted accepted-result profile", () => {
    const hostedOutput = [
      "promotionExhaustedReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)",
      "successorSessionFixedReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)",
      "successorInFlightReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)",
      "successorResponseLostReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)"
    ].join("\n")

    expect(() =>
      assertRequiredWitnessesObserved(hostedOutput, [
        "promotionExhaustedReached",
        "successorSessionFixedReached",
        "successorInFlightReached",
        "successorResponseLostReached"
      ])
    ).not.toThrow()
  })

  it("rejects a declared witness omitted from command output", () => {
    expect(() => assertRequiredWitnessesObserved("Witnesses:\n", ["MissingReached"])).toThrow(
      "missing witness output: MissingReached"
    )
  })

  it("reads only the witnesses declared by one sampled command", () => {
    expect(
      quintWitnessesFromCommandArgs([
        "run",
        "specs/model.qnt",
        "--invariants",
        "safe",
        "--witnesses",
        "firstReached",
        "secondReached",
        "--max-steps",
        "20"
      ])
    ).toEqual(["firstReached", "secondReached"])
  })

  it("accepts a non-accepted-result sampled command whose witness is zero", () => {
    expect(() =>
      assertQuintSampledCommandWitnessesObserved({
        args: ["run", "specs/runActivation.qnt", "--witnesses", "processLossReached", "--max-steps", "20"],
        name: "Run activation sampled model",
        output: "processLossReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)"
      })
    ).not.toThrow()
  })

  it("fails closed when a sampled command declares no witnesses", () => {
    expect(() =>
      assertQuintSampledCommandWitnessesObserved({
        args: ["run", "specs/model.qnt", "--max-samples", "10000"],
        name: "unmeasured sampled model",
        output: ""
      })
    ).toThrow("unmeasured sampled model: no declared --witnesses")
  })

  it("rejects duplicate declarations and duplicate output rather than overwriting evidence", () => {
    const line = "Reached was witnessed in 0 trace(s) out of 10000 explored (0.00%)"
    expect(() => assertRequiredWitnessesObserved(line, ["Reached", "Reached"])).toThrow("duplicate declared")
    expect(() => assertRequiredWitnessesObserved(`${line}\n${line}`, ["Reached"])).toThrow("duplicate witness output")
  })

  it.each([
    "Reached was witnessed in -1 trace(s) out of 10000 explored (0.00%)",
    "Reached was witnessed in 10001 trace(s) out of 10000 explored (100.01%)",
    "Reached was witnessed in 0 trace(s) out of 0 explored (0.00%)",
    "Reached was witnessed in 1 trace(s) out of 10000 explored (99.00%)",
    "Reached was witnessed in 0 trace(s) out of 10000 explored"
  ])("rejects malformed sampled diagnostics: %s", (line) => {
    expect(() => assertRequiredWitnessesObserved(line, ["Reached"])).toThrow("malformed witness output")
  })

  const owner = "safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test"
  const ownerArgs = ["test", "specs/taskFactReconciliation_test.qnt", "--main", "taskFactReconciliationTest"]
  const ownerOutput = `    ok ${owner} passed 1 test(s)\n`

  it("requires exact collection and success of the canonical four-milestone trace", () => {
    expect(() => assertTaskFactReplacementTestCollected({ args: ownerArgs, output: ownerOutput })).not.toThrow()
    expect(() =>
      assertTaskFactReplacementTestCollected({ args: ownerArgs, output: `\u001b[32m${ownerOutput}\u001b[0m` })
    ).not.toThrow()
    for (const output of ["", ownerOutput + ownerOutput, `failed ${owner}`, `ok ${owner} passed 0 test(s)`]) {
      expect(() => assertTaskFactReplacementTestCollected({ args: ownerArgs, output })).toThrow(
        "not collected exactly once and passed"
      )
    }
    expect(() =>
      assertTaskFactReplacementTestCollected({ args: ["test", "specs/other.qnt"], output: ownerOutput })
    ).toThrow("exact canonical test command")
  })

  it("preserves complete failed diagnostics and the auto-seed on the original coverage error", () => {
    const output = "Reached was witnessed in malformed output\nUse --seed=0x123 --backend=rust to reproduce.\n"
    try {
      validateQuintCommandOutput({ args: ["run", "model.qnt", "--witnesses", "Reached"], name: "model", output })
      expect.unreachable("malformed output must fail")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ output, message: expect.stringContaining("malformed witness output") })
    }
  })

  it("applies mandatory collection validation to the exact gate command", () => {
    expect(() =>
      validateQuintCommandOutput({ args: ownerArgs, name: "task-fact reconciliation deterministic tests", output: "" })
    ).toThrow("not collected")
  })

  it("keeps a subprocess invariant counterexample fatal regardless of zero witness counts", async () => {
    const output =
      "Reached was witnessed in 0 trace(s) out of 10000 explored (0.00%)\nInvariant violated\nUse --seed=0x123 --backend=rust to reproduce.\n"
    await expect(
      runBoundedCommand({
        args: ["-e", `process.stdout.write(${JSON.stringify(output)}); process.exit(1)`],
        captureOutput: true,
        executable: process.execPath,
        forwardOutput: false,
        name: "invariant counterexample fixture",
        timeoutMilliseconds: 5000
      })
    ).rejects.toMatchObject({ output, quintCommandResult: "exit:1" })
  })
})
