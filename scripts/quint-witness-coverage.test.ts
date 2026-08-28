import { describe, expect, it } from "vitest"

import { assertRequiredWitnessesObserved } from "./quint-witness-coverage.mjs"

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

  it("rejects a declared witness omitted from command output", () => {
    expect(() => assertRequiredWitnessesObserved("Witnesses:\n", ["MissingReached"])).toThrow(
      "missing witness output: MissingReached"
    )
  })
})
