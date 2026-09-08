import { describe, expect, it } from "vitest"

import { legacyQuintGateCommandManifest, quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import {
  assertQuintGateCommandContract,
  assertQuintGateSampleThreadContract,
  legacyQuintGateExpectedCommandCounts,
  quintGateSampleThreadCount,
  quintGateExpectedCommandCounts,
  withQuintGateSampleThreadContract
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

  it("accepts the hosted-supported sampled-run thread count", () => {
    expect(quintGateSampleThreadCount).toBe(4)
    expect(() => assertQuintGateSampleThreadContract(["run", "spec.qnt", "--n-threads", "4"])).not.toThrow()
    expect(withQuintGateSampleThreadContract(["run", "spec.qnt"])).toEqual(["run", "spec.qnt", "--n-threads", "4"])
  })

  it.each([
    ["omitted", ["run", "spec.qnt"]],
    ["changed", ["run", "spec.qnt", "--n-threads", "12"]]
  ])("rejects a sampled-run thread count that is %s", (_case, args) => {
    expect(() => assertQuintGateSampleThreadContract(args)).toThrow(
      "Quint sampled-run thread contract mismatch: expected exactly --n-threads 4"
    )
  })

  it("rejects an existing sampled-run thread option instead of masking it with the required value", () => {
    expect(() => withQuintGateSampleThreadContract(["run", "spec.qnt", "--n-threads", "12"])).toThrow(
      "Quint sampled-run thread contract mismatch: expected exactly --n-threads 4"
    )
  })
})
