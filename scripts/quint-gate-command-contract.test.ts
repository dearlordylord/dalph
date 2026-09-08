import { describe, expect, it } from "vitest"

import { acceptedLegacyQuintGateCommandKeys } from "./quint-gate-legacy-command-oracle.mjs"
import { type QuintManifestCommand, quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import {
  assertAcceptedLegacyQuintGateCommands,
  assertQuintGateCommandContract,
  assertQuintGateSampleThreadContract,
  legacyQuintGateExpectedCommandCounts,
  quintGateSampleThreadCount,
  quintGateExpectedCommandCounts,
  withQuintGateSampleThreadContract
} from "./quint-gate-command-contract.mjs"

const commandAt = (manifest: ReadonlyArray<QuintManifestCommand>, index: number) => {
  const command = manifest[index]
  if (command === undefined) throw new Error(`missing command ${index}`)
  return command
}

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
    expect(acceptedLegacyQuintGateCommandKeys).toHaveLength(legacyQuintGateExpectedCommandCounts.total)
    expect(() => assertAcceptedLegacyQuintGateCommands(quintGateCommandManifest)).not.toThrow()
  })

  it.each([
    ["omission", (manifest: Array<QuintManifestCommand>) => manifest.filter((_command, index) => index !== 1)],
    [
      "reorder",
      (manifest: Array<QuintManifestCommand>) =>
        manifest.map((command, index) =>
          index === 0 ? commandAt(manifest, 1) : index === 1 ? commandAt(manifest, 0) : command
        )
    ],
    [
      "duplication",
      (manifest: Array<QuintManifestCommand>) =>
        manifest.map((command, index) => (index === 1 ? commandAt(manifest, 0) : command))
    ],
    [
      "substitution",
      (manifest: Array<QuintManifestCommand>) =>
        manifest.map((command, index) => (index === 1 ? { ...command, name: "substituted command" } : command))
    ]
  ])("rejects legacy command %s against the independent accepted oracle", (_case, mutate) => {
    expect(() =>
      assertAcceptedLegacyQuintGateCommands(mutate(quintGateCommandManifest.map((command) => ({ ...command }))))
    ).toThrow("accepted legacy Quint command")
  })

  it("rejects one omission when execution and manifest omit the same command", () => {
    const omittedManifest = quintGateCommandManifest.filter(
      (command) => command.name !== "fresh-task admission ambiguity proof exhaustive model"
    )
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
