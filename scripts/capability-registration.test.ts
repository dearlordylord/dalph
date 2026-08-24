import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  capabilityRegistrationInventory,
  capabilityRegistrationIssues,
  type CapabilityRegistrationInventory
} from "./capability-registration.js"
import {
  repositoryCapabilitySourceFiles,
  runCapabilityRegistrationGate,
  type CapabilitySourceFile
} from "./capability-registration-gate.js"

const sourceFiles = repositoryCapabilitySourceFiles()

const issuesFor = (inventory: CapabilityRegistrationInventory): ReadonlyArray<string> =>
  runCapabilityRegistrationGate(inventory, sourceFiles)

describe("capability registration gate", () => {
  it("runs every registered controlled and production implementation through its named contract family", () => {
    expect(issuesFor(capabilityRegistrationInventory)).toEqual([])

    for (const capability of capabilityRegistrationInventory.capabilities) {
      for (const role of ["controlled", "production"] as const) {
        const implementation = capability[role]
        if (implementation._tag === "Implementation") {
          expect(capability.contract.executions).toContainEqual(expect.objectContaining({ role }))
        }
      }
    }
  })

  it("records typed N/A evidence instead of fabricating repository providers", () => {
    const completion = capabilityRegistrationInventory.capabilities.find(
      ({ family }) => family === "task-tracker-completion"
    )
    const integrator = capabilityRegistrationInventory.capabilities.find(({ family }) => family === "outer-integrator")

    expect(completion?.production).toEqual(
      expect.objectContaining({ _tag: "NotApplicable", reason: "application-supplied-boundary" })
    )
    expect(integrator?.production).toEqual(
      expect.objectContaining({ _tag: "NotApplicable", reason: "no-repository-provider" })
    )
  })

  it("rejects a missing family even when the inventory is otherwise unchanged", () => {
    const missingFamily = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.filter(({ family }) => family !== "outer-integrator")
    }

    expect(issuesFor(missingFamily)).toContain("missing capability family outer-integrator")
  })

  it("rejects duplicate family and implementation registrations", () => {
    const original = capabilityRegistrationInventory.capabilities.find(({ family }) => family === "journal")
    if (original === undefined) throw new Error("journal registration fixture is missing")
    const duplicate = {
      ...capabilityRegistrationInventory,
      capabilities: [...capabilityRegistrationInventory.capabilities, original]
    }

    const issues = capabilityRegistrationIssues(duplicate)
    expect(issues).toContain("duplicate capability family journal")
    expect(issues).toContain("duplicate implementation identity memoryJournalTestLayer")
  })

  it("rejects stale implementation and composition evidence", () => {
    const stale = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) => {
        if (capability.family !== "git-worktree") return capability
        const production = capability.production
        return {
          ...capability,
          production: {
            ...production,
            composition: { ...production.composition, marker: "removedFromProductionComposition" }
          }
        }
      })
    }

    expect(issuesFor(stale)).toContain(
      "git-worktree production composition marker is stale: removedFromProductionComposition"
    )
  })

  it("rejects one-sided contract evidence", () => {
    const oneSided = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) =>
        capability.family === "journal"
          ? {
              ...capability,
              contract: {
                ...capability.contract,
                executions: capability.contract.executions.filter(({ role }) => role === "controlled")
              }
            }
          : capability
      )
    }

    expect(issuesFor(oneSided)).toContain("journal production has no shared contract execution")
  })

  it("rejects a production contract test that stops invoking the shared helper", () => {
    const staleInvocation = sourceFiles.map((file) =>
      file.path === "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts"
        ? { ...file, source: file.source.replace("trackerMutationContract({", "removedTrackerMutationContract({") }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, staleInvocation)).toContain(
      "task-tracker-claim contract invocation marker is stale: trackerMutationContract("
    )
  })

  it("rejects comment and string residue when shared-contract execution is removed", () => {
    const residue = sourceFiles.map((file) => {
      if (file.path === "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            'trackerMutationContract({ ...trackerMutationContractFixture(taskId, "github"), layer })',
            'const contractResidue = "trackerMutationContract("\nconst regexResidue = /trackerMutationContract\\(/'
          )
        }
      }
      return file
    })

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, residue)).toContain(
      "task-tracker-claim contract invocation marker is stale: trackerMutationContract("
    )
  })

  it("rejects a registered implementation identity that is not consumed by its declared composition", () => {
    const original = capabilityRegistrationInventory.capabilities.find(({ family }) => family === "git-worktree")
    if (original === undefined || original.production._tag !== "Implementation") {
      throw new Error("Git worktree production registration fixture is missing")
    }
    const production = original.production
    const unconsumed = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) =>
        capability.family === "git-worktree"
          ? {
              ...capability,
              production: {
                ...production,
                identity: "nodeGitTargetLineageLayer",
                marker: "nodeGitTargetLineageLayer",
                source: "packages/orchestrator/src/authorities/git/target-lineage.ts",
                composition: { ...production.composition, identity: "nodeGitTargetLineageLayer" }
              }
            }
          : capability
      )
    }

    expect(issuesFor(unconsumed)).toContain(
      "git-worktree production composition does not consume implementation identity nodeGitTargetLineageLayer"
    )
  })

  it("rejects an assembled production layer that is absent from the registry", () => {
    const unknownLayer: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-unknown-layer.ts",
      source: "export const unknownProductionCapabilityLayer = Layer.succeed(UnknownService, {})"
    }
    const unknownComposition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-unknown-composition.ts",
      source:
        'import { unknownProductionCapabilityLayer } from "./issue-79-unknown-layer.js"\nexport const assembled = unknownProductionCapabilityLayer'
    }
    const inventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: unknownComposition.path }
      ]
    }

    expect(runCapabilityRegistrationGate(inventory, [...sourceFiles, unknownLayer, unknownComposition])).toContain(
      "production uses unregistered exported Layer unknownProductionCapabilityLayer"
    )
  })

  it("audits exported Layer values without a Layer suffix and through re-exports", () => {
    const layerSource: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-layer-source.ts",
      source: "export const hiddenProvider =\n  Layer.succeed(UnknownService, {})"
    }
    const reexportSource: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-layer-reexport.ts",
      source: 'export {\n  hiddenProvider as provider\n} from "./issue-79-layer-source.js"'
    }
    const composition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-layer-composition.ts",
      source: 'import { provider } from "./issue-79-layer-reexport.js"\nexport const assembled = provider'
    }
    const inventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: composition.path }
      ]
    }

    expect(
      runCapabilityRegistrationGate(inventory, [...sourceFiles, layerSource, reexportSource, composition])
    ).toEqual(expect.arrayContaining(["production uses unregistered exported Layer provider"]))
  })

  it("audits source text without loading or invoking a live provider", () => {
    const providerCalled = false
    const providerLayer: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-provider-layer.ts",
      source: 'export const unregisteredProviderLayer = Layer.effect(Provider, () => fetch("https://provider.invalid"))'
    }
    const providerComposition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-provider-composition.ts",
      source:
        'import { unregisteredProviderLayer } from "./issue-79-provider-layer.js"\nexport const assembled = unregisteredProviderLayer'
    }
    const inventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: providerComposition.path }
      ]
    }

    const issues = runCapabilityRegistrationGate(inventory, [...sourceFiles, providerLayer, providerComposition])
    expect(issues).toContain("production uses unregistered exported Layer unregisteredProviderLayer")
    expect(providerCalled).toBe(false)
  })

  it("is part of check:all", () => {
    const packageJson = readFileSync("package.json", "utf8")
    const qualityGate = readFileSync("scripts/run-quality-gate.mjs", "utf8")

    expect(packageJson).toContain('"test:capability-registration"')
    expect(qualityGate).toContain("test:capability-registration")
  })
})
