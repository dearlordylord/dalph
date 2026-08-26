import { describe, expect, it } from "vitest"

import { quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import { assertQuintGateCommandContract, quintGateExpectedCommandCounts } from "./quint-gate-command-contract.mjs"

describe("Quint gate command contract", () => {
  it("accepts the independent 92-command phase contract", () => {
    assertQuintGateCommandContract({ manifest: quintGateCommandManifest, executed: quintGateExpectedCommandCounts })
  })

  it("rejects one omission when execution and manifest omit the same command", () => {
    const omittedManifest = quintGateCommandManifest.slice(0, -1)
    const omittedExecution = { ...quintGateExpectedCommandCounts, total: 91, verify: 18 }

    expect(() => assertQuintGateCommandContract({ manifest: omittedManifest, executed: omittedExecution })).toThrow(
      "expected 92"
    )
  })
})
