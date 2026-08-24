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
    const claim = capabilityRegistrationInventory.capabilities.find(({ family }) => family === "task-tracker-claim")
    const integrator = capabilityRegistrationInventory.capabilities.find(({ family }) => family === "outer-integrator")
    const promotion = capabilityRegistrationInventory.capabilities.find(
      ({ family }) => family === "git-target-promotion"
    )

    expect(completion?.production).toEqual(
      expect.objectContaining({ _tag: "NotApplicable", reason: "application-supplied-boundary" })
    )
    expect(claim?.production).toEqual(
      expect.objectContaining({ _tag: "NotApplicable", reason: "application-supplied-boundary" })
    )
    expect(integrator?.production).toEqual(
      expect.objectContaining({ _tag: "NotApplicable", reason: "no-repository-provider" })
    )
    expect(promotion?.production).toEqual(
      expect.objectContaining({ _tag: "NotApplicable", reason: "application-supplied-boundary" })
    )
  })

  it("rejects a missing family even when the inventory is otherwise unchanged", () => {
    const missingFamily = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.filter(({ family }) => family !== "outer-integrator")
    }

    expect(issuesFor(missingFamily)).toContain("missing capability family outer-integrator")
  })

  it("keeps the required family denominator outside a mutated inventory", () => {
    const missingFamily = {
      ...capabilityRegistrationInventory,
      requiredFamilies: capabilityRegistrationInventory.requiredFamilies.filter(
        (family) => family !== "outer-integrator"
      ),
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

  it("rejects journal production when its shared contract edge is removed", () => {
    const removedJournalEdge = sourceFiles.map((file) =>
      file.path === "packages/orchestrator/src/workflow-journal/store.test.ts"
        ? {
            ...file,
            source: file.source
              .replace("  journalAppendContract(name, makeLayer)\n", "")
              .replace(
                'journalAppendContract("sqlite", () => sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") }))\n',
                ""
              )
          }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, removedJournalEdge)).toContain(
      "journal production contract invocation marker is stale: journalAppendContract("
    )
  })

  it("rejects a local same-name contract function that is not the imported public contract", () => {
    const localContract = sourceFiles.map((file) =>
      file.path === "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts"
        ? {
            ...file,
            source: file.source.replace(
              'import {\n  trackerMutationContract,\n  trackerMutationContractFixture\n} from "../../../../test/contracts/tracker-mutation-contract.js"',
              'import { trackerMutationContractFixture } from "../../../../test/contracts/tracker-mutation-contract.js"\nconst trackerMutationContract = () => undefined'
            )
          }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, localContract)).toContain(
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

  it("rejects one cleanup family when its same-helper production call is removed", () => {
    const removedCandidateCall = sourceFiles.map((file) =>
      file.path === "packages/orchestrator/src/workflow/protocols/disposition-cleanup/production.test.ts"
        ? {
            ...file,
            source: file.source.replace(
              "    yield* dispositionCleanupContract({ authorization: candidateAuthorization, boundary: candidate })\n",
              ""
            )
          }
        : file
    )

    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, removedCandidateCall)
    expect(issues).toContain(
      "integrator-predecessor-candidate-cleanup contract invocation marker is stale: dispositionCleanupContract({"
    )
    expect(issues).not.toContain(
      "planned-worktree-cleanup contract invocation marker is stale: dispositionCleanupContract({"
    )
    expect(issues).not.toContain(
      "planned-branch-cleanup contract invocation marker is stale: dispositionCleanupContract({"
    )
  })

  it("rejects only the removed evidence implementation call by its label argument", () => {
    const removedFilesystemCall = sourceFiles.map((file) =>
      file.path === "packages/orchestrator/src/workflow/protocols/evidence-store.test.ts"
        ? {
            ...file,
            source: file.source.replace(
              'evidenceStoreContract(\n  (root) => nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root)).pipe(Layer.provide(NodeServices.layer)),\n  "filesystem"\n)\n',
              ""
            )
          }
        : file
    )

    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, removedFilesystemCall)
    expect(issues).toContain("immutable-evidence contract invocation marker is stale: evidenceStoreContract(")
    expect(issues).not.toContain("immutable-evidence controlled contract invocation marker is stale")
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

  it("rejects implementation evidence pointed at a consumer instead of its declaration", () => {
    const consumerAsImplementationSource = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) =>
        capability.family === "git-worktree"
          ? {
              ...capability,
              production: { ...capability.production, source: "packages/dalph/src/application/production.ts" }
            }
          : capability
      )
    }

    expect(issuesFor(consumerAsImplementationSource)).toContain(
      "git-worktree production implementation marker is stale: nodeGitWorktreeLayer"
    )
  })

  it("rejects a same-name local composition value that shadows the registered Layer", () => {
    const shadowedComposition = sourceFiles.map((file) =>
      file.path === "packages/dalph/src/application/production.ts"
        ? {
            ...file,
            source: file.source.replace(
              "  const gitWorktreeLayer = coordinatorOwnedGitWorktreeLayer(\n",
              "  const nodeGitWorktreeLayer = 1\n  const gitWorktreeLayer = coordinatorOwnedGitWorktreeLayer(\n"
            )
          }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, shadowedComposition)).toContain(
      "git-worktree production composition does not consume implementation identity nodeGitWorktreeLayer"
    )
  })

  it("rejects a destructuring shadow of an imported shared contract", () => {
    const destructuredShadow = sourceFiles.map((file) =>
      file.path === "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts"
        ? {
            ...file,
            source: file.source.replace(
              'trackerMutationContract({ ...trackerMutationContractFixture(taskId, "github"), layer })\n',
              '{\n  const { trackerMutationContract } = { trackerMutationContract: () => undefined }\n  trackerMutationContract({ ...trackerMutationContractFixture(taskId, "github"), layer })\n}\n'
            )
          }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, destructuredShadow)).toContain(
      "task-tracker-claim contract invocation marker is stale: trackerMutationContract("
    )
  })

  it("requires source-backed support binding evidence and a concrete reason", () => {
    const malformedSupport = {
      ...capabilityRegistrationInventory,
      compositionSupportBindings: capabilityRegistrationInventory.compositionSupportBindings.map((binding) =>
        binding.identity === "attemptChoiceControlLayer"
          ? {
              ...binding,
              marker: "attemptChoiceControlLayer",
              reason: "",
              source: "packages/dalph/src/application/production.ts"
            }
          : binding
      )
    }

    expect(issuesFor(malformedSupport)).toContain("support binding attemptChoiceControlLayer has an empty reason")
    expect(issuesFor(malformedSupport)).toContain(
      "support binding attemptChoiceControlLayer declaration source is stale: packages/dalph/src/application/production.ts"
    )

    const arbitrarySupport = {
      ...capabilityRegistrationInventory,
      compositionSupportBindings: capabilityRegistrationInventory.compositionSupportBindings.map((binding) =>
        binding.identity === "attemptChoiceControlLayer"
          ? { ...binding, identity: "arbitrarySupportLayer", marker: "attemptChoiceControlLayer" }
          : binding
      )
    }
    expect(capabilityRegistrationIssues(arbitrarySupport)).toContain(
      "support binding arbitrarySupportLayer identity does not match declaration marker attemptChoiceControlLayer"
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

  it("audits local aliases, default exports, and namespace/default re-exports", () => {
    const layerSource: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-layer-export-forms.ts",
      source: ["const hidden = Layer.succeed(UnknownService, {})", "export { hidden }", "export default hidden"].join(
        "\n"
      )
    }
    const reexportSource: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-layer-export-forms-reexport.ts",
      source: [
        'export { hidden } from "./issue-79-layer-export-forms.js"',
        'export { default } from "./issue-79-layer-export-forms.js"',
        'export * as namespace from "./issue-79-layer-export-forms.js"'
      ].join("\n")
    }
    const composition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-layer-export-forms-composition.ts",
      source: [
        'import defaultProvider, { hidden } from "./issue-79-layer-export-forms-reexport.js"',
        'import { namespace } from "./issue-79-layer-export-forms-reexport.js"',
        "export const assembledLocal = hidden",
        "export const assembledDefault = defaultProvider",
        "export const assembledNamespace = namespace.hidden"
      ].join("\n")
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
    ).toEqual(
      expect.arrayContaining([
        "production uses unregistered exported Layer hidden",
        "production uses unregistered exported Layer defaultProvider",
        "production uses unregistered exported Layer namespace.hidden"
      ])
    )
  })

  it("runtime value consumption excludes type-only references", () => {
    const layerSource: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-type-only-layer.ts",
      source: "export const typeOnlyProvider = Layer.succeed(UnknownService, {})"
    }
    const composition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-type-only-composition.ts",
      source: [
        'import { typeOnlyProvider } from "./issue-79-type-only-layer.js"',
        "type ProviderShape = typeof typeOnlyProvider",
        "export const assembled = undefined as unknown"
      ].join("\n")
    }
    const inventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: composition.path }
      ]
    }

    expect(runCapabilityRegistrationGate(inventory, [...sourceFiles, layerSource, composition])).not.toContain(
      "production uses unregistered exported Layer typeOnlyProvider"
    )
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
