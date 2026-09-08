import { describe, expect, it } from "vitest"

import { legacyQuintGateCommandManifest, quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import {
  assertQuintGateCommandContract,
  legacyQuintGateExpectedCommandCounts,
  quintGateExpectedCommandCounts
} from "./quint-gate-command-contract.mjs"

describe("Quint gate command contract", () => {
  it("accepts the independent 105-command phase contract", () => {
    assertQuintGateCommandContract({ manifest: quintGateCommandManifest, executed: quintGateExpectedCommandCounts })
    expect(quintGateExpectedCommandCounts).toEqual({
      total: 105,
      typecheck: 15,
      test: 46,
      "sampled-run": 23,
      verify: 21
    })
  })

  it("retains the accepted 92-command inventory as an exact subset", () => {
    expect(legacyQuintGateExpectedCommandCounts).toEqual({
      total: 92,
      typecheck: 13,
      test: 40,
      "sampled-run": 20,
      verify: 19
    })
    expect(legacyQuintGateCommandManifest).toHaveLength(legacyQuintGateExpectedCommandCounts.total)
    expect(
      Object.fromEntries(
        ["typecheck", "test", "sampled-run", "verify"].map((kind) => [
          kind,
          legacyQuintGateCommandManifest.filter((command) => command.kind === kind).length
        ])
      )
    ).toEqual({ typecheck: 13, test: 40, "sampled-run": 20, verify: 19 })
    expect(legacyQuintGateCommandManifest.every((command) => quintGateCommandManifest.includes(command))).toBe(true)
  })

  it("rejects one omission when execution and manifest omit the same command", () => {
    const omittedManifest = quintGateCommandManifest.slice(0, -1)
    const omittedExecution = { ...quintGateExpectedCommandCounts, total: 104, verify: 20 }

    expect(() => assertQuintGateCommandContract({ manifest: omittedManifest, executed: omittedExecution })).toThrow(
      "expected 105"
    )
  })
})
