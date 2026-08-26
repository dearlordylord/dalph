import { performance } from "node:perf_hooks"
import { describe, expect, it } from "vitest"
import { capabilityRegistrationInventory } from "./capability-registration.js"
import {
  inspectCapabilitySourceProgram,
  repositoryCapabilitySourceFiles,
  runCapabilityRegistrationGate,
  type CapabilitySourceFile
} from "./capability-registration-gate.js"

const repositorySources = repositoryCapabilitySourceFiles()

const sourceWithPath = (path: string): CapabilitySourceFile => {
  const source = repositorySources.find((file) => file.path === path)
  if (source === undefined) throw new Error(`benchmark source is missing: ${path}`)
  return source
}

const measured = (
  name: string,
  inventory: typeof capabilityRegistrationInventory,
  sources: ReadonlyArray<CapabilitySourceFile>
) => {
  const startedAt = performance.now()
  const issues = runCapabilityRegistrationGate(inventory, sources)
  const elapsedMilliseconds = performance.now() - startedAt
  const diagnostics = inspectCapabilitySourceProgram(sources)
  return {
    elapsedMilliseconds: Math.round(elapsedMilliseconds),
    issueCount: issues.length,
    name,
    rebuiltSourceCount: diagnostics.rebuiltSourcePaths.length,
    reusedSourceCount: diagnostics.reusedSourcePaths.length
  }
}

describe("capability registration performance evidence", () => {
  it("reports named source-audit rows and their tree reuse counters", () => {
    const baseline = repositorySources.map((file) => ({ ...file }))
    const mutationPath = "packages/contracts/src/index.ts"
    const mutationSource = sourceWithPath(mutationPath)
    const samePathMutation = baseline.map((file) =>
      file.path === mutationPath ? { ...file, source: `${file.source}\n// issue-262 benchmark mutation` } : file
    )
    const addedLayer: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-benchmark-layer.ts",
      source: "export const benchmarkLayer = Layer.succeed(UnknownService, {})"
    }
    const addedReexport: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-benchmark-reexport.ts",
      source: 'export { benchmarkLayer as reexportedLayer } from "./issue-262-benchmark-layer.js"'
    }
    const addedComposition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-benchmark-composition.ts",
      source:
        'import { reexportedLayer } from "./issue-262-benchmark-reexport.js"\nexport const benchmarkAssembly = reexportedLayer'
    }
    const addedRootsInventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: addedComposition.path }
      ]
    }
    const providerLayer: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-benchmark-provider-layer.ts",
      source: 'export const benchmarkProviderLayer = Layer.effect(Provider, () => fetch("https://provider.invalid"))'
    }
    const providerComposition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-benchmark-provider-composition.ts",
      source:
        'import { benchmarkProviderLayer } from "./issue-262-benchmark-provider-layer.js"\nexport const benchmarkProviderAssembly = benchmarkProviderLayer'
    }
    const providerInventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: providerComposition.path }
      ]
    }
    const rows = [
      measured("baseline", capabilityRegistrationInventory, baseline),
      measured("same-path mutation", capabilityRegistrationInventory, samePathMutation),
      measured("added/re-export roots", addedRootsInventory, [
        ...samePathMutation,
        addedLayer,
        addedReexport,
        addedComposition
      ]),
      measured("provider-text roots", providerInventory, [...samePathMutation, providerLayer, providerComposition])
    ]

    expect(mutationSource.source).toBeDefined()
    expect(rows).toHaveLength(4)
    for (const row of rows) console.log(JSON.stringify(row))
  }, 120_000)
})
