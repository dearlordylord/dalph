import { describe, expect, it } from "vitest"

import { acceptedFreshTaskAdmissionQuintGateCommandKeys } from "./quint-gate-fresh-task-command-oracle.mjs"
import { acceptedLegacyQuintGateCommandKeys } from "./quint-gate-legacy-command-oracle.mjs"
import { type QuintManifestCommand, quintGateCommandManifest } from "./quint-gate-command-manifest.mjs"
import {
  assertAcceptedLegacyQuintGateCommands,
  assertAcceptedQuintGateCommands,
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

  it("retains the accepted 13-command #315 inventory as an exact ordered subset", () => {
    expect(acceptedFreshTaskAdmissionQuintGateCommandKeys).toEqual([
      "typecheck\u0000fresh-task admission model typecheck",
      "test\u0000fresh-task admission deterministic tests",
      "test\u0000fresh-task admission negative mutation profile",
      "sampled-run\u0000fresh-task admission sampled model",
      "typecheck\u0000fresh-task admission proof projection typecheck",
      "test\u0000fresh-task admission capacity proof deterministic tests",
      "test\u0000fresh-task admission capacity proof negative mutation profile",
      "sampled-run\u0000fresh-task admission capacity proof sampled model",
      "verify\u0000fresh-task admission capacity proof exhaustive model",
      "test\u0000fresh-task admission ambiguity proof deterministic tests",
      "test\u0000fresh-task admission ambiguity proof negative mutation profile",
      "sampled-run\u0000fresh-task admission ambiguity proof sampled model",
      "verify\u0000fresh-task admission ambiguity proof exhaustive model"
    ])
    expect(() => assertAcceptedQuintGateCommands(quintGateCommandManifest)).not.toThrow()
  })

  it.each([
    ["omission", (manifest: Array<QuintManifestCommand>) => manifest.filter((_command, index) => index !== 52)],
    [
      "reorder",
      (manifest: Array<QuintManifestCommand>) =>
        manifest.map((command, index) =>
          index === 52 ? commandAt(manifest, 53) : index === 53 ? commandAt(manifest, 52) : command
        )
    ],
    [
      "duplication",
      (manifest: Array<QuintManifestCommand>) =>
        manifest.map((command, index) => (index === 53 ? commandAt(manifest, 52) : command))
    ],
    [
      "substitution",
      (manifest: Array<QuintManifestCommand>) =>
        manifest.map((command) =>
          command.name === "fresh-task admission capacity proof exhaustive model"
            ? { ...command, name: "fresh-task admission substituted proof exhaustive model" }
            : command
        )
    ]
  ])("rejects a #315 command %s against the independent accepted oracle", (_case, mutate) => {
    expect(() =>
      assertAcceptedQuintGateCommands(mutate(quintGateCommandManifest.map((command) => ({ ...command }))))
    ).toThrow("accepted Quint command")
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
      "accepted Quint command"
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
