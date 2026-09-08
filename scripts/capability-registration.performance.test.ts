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

interface MeasurementExpectation {
  readonly compilerDiagnosticCount: number
  readonly issueCount: number
  readonly issueIncludes?: string
  readonly rebuiltDependencyPaths: ReadonlyArray<string>
  readonly rebuiltPaths: ReadonlyArray<string>
  readonly reusedDependencyPaths: ReadonlyArray<string>
  readonly reusedPaths: ReadonlyArray<string>
}

const measured = (
  name: string,
  inventory: typeof capabilityRegistrationInventory,
  sources: ReadonlyArray<CapabilitySourceFile>,
  expected: MeasurementExpectation
) => {
  const startedAt = performance.now()
  const issues = runCapabilityRegistrationGate(inventory, sources)
  const elapsedMilliseconds = performance.now() - startedAt
  const diagnostics = inspectCapabilitySourceProgram(sources)
  expect(issues).toHaveLength(expected.issueCount)
  expect(diagnostics.compilerDiagnostics).toHaveLength(expected.compilerDiagnosticCount)
  expect(new Set(diagnostics.rebuiltDependencyPaths)).toEqual(new Set(expected.rebuiltDependencyPaths))
  expect(diagnostics.rebuiltSourcePaths).toHaveLength(expected.rebuiltPaths.length)
  expect(diagnostics.rebuiltSourcePaths).toEqual(expect.arrayContaining([...expected.rebuiltPaths]))
  expect(new Set(diagnostics.reusedDependencyPaths)).toEqual(new Set(expected.reusedDependencyPaths))
  expect(new Set(diagnostics.reusedSourcePaths)).toEqual(new Set(expected.reusedPaths))
  if (expected.issueIncludes !== undefined) expect(issues.join("\n")).toContain(expected.issueIncludes)
  return {
    compilerDiagnosticCount: diagnostics.compilerDiagnostics.length,
    elapsedMilliseconds: Math.round(elapsedMilliseconds),
    issueCount: issues.length,
    name,
    rebuiltDependencyCount: diagnostics.rebuiltDependencyPaths.length,
    rebuiltSourceCount: diagnostics.rebuiltSourcePaths.length,
    reusedDependencyCount: diagnostics.reusedDependencyPaths.length,
    reusedSourceCount: diagnostics.reusedSourcePaths.length
  }
}

describe("capability registration performance evidence", () => {
  it("reports named source-audit rows and their tree reuse counters", () => {
    const baseline = repositorySources.map((file) => ({ ...file }))
    const samePath = "scripts/fixtures/issue-262-benchmark-semantic.ts"
    const validSamePathSource: CapabilitySourceFile = {
      path: samePath,
      source: 'export const semanticValue: string = "valid"'
    }
    const samePathMutation: CapabilitySourceFile = { path: samePath, source: "export const semanticValue: string = 1" }
    const addedLayer: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-benchmark-layer.ts",
      source: [
        "declare const Layer: { succeed: (...args: ReadonlyArray<unknown>) => unknown }",
        "export const benchmarkLayer = Layer.succeed(undefined, {})"
      ].join("\n")
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
      source: [
        "declare const Layer: { effect: (...args: ReadonlyArray<unknown>) => unknown }",
        "declare const Provider: unique symbol",
        "declare function fetch(url: string): unknown",
        'export const benchmarkProviderLayer = Layer.effect(Provider, () => fetch("https://provider.invalid"))'
      ].join("\n")
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
    const baselineRow = measured("baseline", capabilityRegistrationInventory, baseline, {
      compilerDiagnosticCount: 0,
      issueCount: 0,
      rebuiltDependencyPaths: repositorySources.map(({ path }) => path),
      rebuiltPaths: repositorySources.map(({ path }) => path),
      reusedDependencyPaths: [],
      reusedPaths: []
    })
    const identicalSources = baseline.map((file) => ({ ...file }))
    const identicalDiagnostics = inspectCapabilitySourceProgram(identicalSources)
    expect(inspectCapabilitySourceProgram(identicalSources)).toBe(identicalDiagnostics)
    expect(identicalDiagnostics.compilerDiagnostics).toHaveLength(0)
    expect(identicalDiagnostics.rebuiltDependencyPaths).toHaveLength(0)
    expect(identicalDiagnostics.rebuiltSourcePaths).toHaveLength(0)
    expect(new Set(identicalDiagnostics.reusedDependencyPaths)).toEqual(
      new Set(repositorySources.map(({ path }) => path))
    )
    expect(new Set(identicalDiagnostics.reusedSourcePaths)).toEqual(new Set(repositorySources.map(({ path }) => path)))

    inspectCapabilitySourceProgram([...baseline, validSamePathSource])
    const samePathRow = measured(
      "same-path mutation",
      capabilityRegistrationInventory,
      [...baseline, samePathMutation],
      {
        compilerDiagnosticCount: 1,
        issueCount: 1,
        issueIncludes: `in ${samePath}:`,
        rebuiltDependencyPaths: [samePath],
        rebuiltPaths: [samePath],
        reusedDependencyPaths: repositorySources.map(({ path }) => path),
        reusedPaths: repositorySources.map(({ path }) => path)
      }
    )
    const rows = [
      baselineRow,
      samePathRow,
      measured(
        "added/re-export roots",
        addedRootsInventory,
        [...baseline, addedLayer, addedReexport, addedComposition],
        {
          compilerDiagnosticCount: 0,
          issueCount: 1,
          issueIncludes: "production uses unregistered exported Layer reexportedLayer",
          rebuiltDependencyPaths: [...repositorySources, addedLayer, addedReexport, addedComposition].map(
            ({ path }) => path
          ),
          rebuiltPaths: [addedLayer.path, addedReexport.path, addedComposition.path],
          reusedDependencyPaths: [],
          reusedPaths: repositorySources.map(({ path }) => path)
        }
      ),
      measured("provider-text roots", providerInventory, [...baseline, providerLayer, providerComposition], {
        compilerDiagnosticCount: 0,
        issueCount: 1,
        issueIncludes: "production uses unregistered exported Layer benchmarkProviderLayer",
        rebuiltDependencyPaths: [...repositorySources, providerLayer, providerComposition].map(({ path }) => path),
        rebuiltPaths: [providerLayer.path, providerComposition.path],
        reusedDependencyPaths: [],
        reusedPaths: repositorySources.map(({ path }) => path)
      })
    ]

    expect(rows).toHaveLength(4)
    for (const row of rows) console.log(JSON.stringify(row))
  }, 120_000)
})
