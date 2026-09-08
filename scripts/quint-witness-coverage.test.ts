import { describe, expect, it } from "vitest"

import {
  assertQuintSampledCommandWitnessesObserved,
  assertRequiredWitnessesObserved,
  quintWitnessesFromCommandArgs
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

  it("rejects a deliberately unreachable phase reported by Quint", () => {
    expect(() =>
      assertRequiredWitnessesObserved(
        "DeliberatelyUnreachablePhaseReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)",
        ["DeliberatelyUnreachablePhaseReached"]
      )
    ).toThrow("unreachable witnesses: DeliberatelyUnreachablePhaseReached")
  })

  it("fails closed on the four zero-count witnesses from the hosted accepted-result profile", () => {
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
    ).toThrow(
      "unreachable witnesses: promotionExhaustedReached, successorSessionFixedReached, successorInFlightReached, successorResponseLostReached"
    )
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

  it("fails a non-accepted-result sampled command when its own witness is zero", () => {
    expect(() =>
      assertQuintSampledCommandWitnessesObserved({
        args: ["run", "specs/runActivation.qnt", "--witnesses", "processLossReached", "--max-steps", "20"],
        name: "Run activation sampled model",
        output: "processLossReached was witnessed in 0 trace(s) out of 10000 explored (0.00%)"
      })
    ).toThrow("Run activation sampled model: unreachable witnesses: processLossReached")
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
})
