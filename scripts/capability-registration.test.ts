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
const githubTrackerMutationContractCall = `trackerMutationContract({
  ...trackerMutationContractFixture(taskId, "github"),
  layer: githubTrackerMutationLayer.pipe(Layer.provide(githubClaimFixtureLayer), Layer.provide(NodeCrypto.layer))
})`

const issuesFor = (inventory: CapabilityRegistrationInventory): ReadonlyArray<string> =>
  runCapabilityRegistrationGate(inventory, sourceFiles)

describe("capability registration gate", () => {
  it(
    "runs every registered controlled and production implementation through its named contract family",
    { timeout: 30_000 },
    () => {
      expect(issuesFor(capabilityRegistrationInventory)).toEqual([])

      for (const capability of capabilityRegistrationInventory.capabilities) {
        for (const role of ["controlled", "production"] as const) {
          const implementation = capability[role]
          if (implementation._tag === "Implementation") {
            expect(capability.contract.executions).toContainEqual(
              expect.objectContaining({
                implementation: expect.objectContaining({
                  identity: implementation.identity,
                  marker: implementation.marker,
                  source: implementation.source
                }),
                role
              })
            )
          }
        }
      }
    }
  )

  it("registers the four real tracker authorities and keeps unrelated unavailable providers typed N/A", () => {
    const graph = capabilityRegistrationInventory.capabilities.find(
      ({ family }) => family === "task-tracker-graph-read"
    )
    const completion = capabilityRegistrationInventory.capabilities.find(
      ({ family }) => family === "task-tracker-completion"
    )
    const completionClaim = capabilityRegistrationInventory.capabilities.find(
      ({ family }) => family === "task-tracker-completion-claim"
    )
    const claim = capabilityRegistrationInventory.capabilities.find(({ family }) => family === "task-tracker-claim")
    const integrator = capabilityRegistrationInventory.capabilities.find(({ family }) => family === "outer-integrator")
    const promotion = capabilityRegistrationInventory.capabilities.find(
      ({ family }) => family === "git-target-promotion"
    )

    expect([
      graph?.production._tag,
      claim?.production._tag,
      completionClaim?.production._tag,
      completion?.production._tag
    ]).toEqual(["Implementation", "Implementation", "Implementation", "Implementation"])
    expect(
      capabilityRegistrationInventory.requiredFamilies.filter((family) => family.startsWith("task-tracker-"))
    ).toEqual([
      "task-tracker-graph-read",
      "task-tracker-claim",
      "task-tracker-completion-claim",
      "task-tracker-completion"
    ])
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
            source: file.source.replace(
              'journalAppendContract("sqlite", () =>',
              'removedJournalAppendContract("sqlite", () =>'
            )
          }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, removedJournalEdge)).toContain(
      "journal production contract invocation marker is stale: journalAppendContract("
    )
  })

  it("rejects independent contracts that substitute different implementations", () => {
    const substituted = sourceFiles.map((file) => {
      if (file.path === "packages/orchestrator/src/authorities/git/target-lineage.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "layer: controlledTargetLineageLayer,",
            "layer: gitTargetLineageTestLayer({ plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: base, targetHeadSha: base }),"
          )
        }
      }
      if (file.path === "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts") {
        return { ...file, source: file.source.replace("layer: controlledContractLayer,", "layer: nodeContractLayer,") }
      }
      if (file.path === "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "layer: Layer.succeed(Integrator, controlledIntegratorContractService),",
            "layer: Layer.succeed(Integrator, Integrator.of({ prepare: (request) => Effect.succeed(prepared(request)) })),"
          )
        }
      }
      if (file.path === "packages/orchestrator/src/workflow-journal/store.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "productionJournalStoreLayer.pipe(",
            'sqliteJournalTestLayer({ filename: JournalDatabaseLocator.make(":memory:") }).pipe('
          )
        }
      }
      if (file.path === "packages/orchestrator/src/authorities/task-tracker/github/graph-reader.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "layer: githubTrackerGraphReaderLayer.pipe(Layer.provide(clientLayer)),",
            "layer: Layer.empty,"
          )
        }
      }
      if (file.path === "packages/dalph/src/application/codex-planned-attempt-executor.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "layer: layerForImplementation(codexPlannedAttemptExecutorLayer)(makeHarness()),",
            "layer: Layer.empty,"
          )
        }
      }
      if (file.path === "packages/orchestrator/src/workflow/protocols/evidence-store.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "(root) => nodeEvidenceStoreLayer(EvidenceStoreLocator.make(root)).pipe(Layer.provide(NodeServices.layer)),",
            "() => memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer)),"
          )
        }
      }
      const controlledCleanupIdentity =
        file.path === "packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.test.ts"
          ? "worktreeCleanupTestLayer"
          : file.path === "packages/orchestrator/src/workflow/protocols/disposition-cleanup/branch.test.ts"
            ? "branchCleanupTestLayer"
            : file.path ===
                "packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.test.ts"
              ? "integratorCandidateCleanupTestLayer"
              : undefined
      if (controlledCleanupIdentity !== undefined) {
        return {
          ...file,
          source: file.source.replace(
            `const implementationLayer = ${controlledCleanupIdentity}(`,
            "const implementationLayer = Layer.effectDiscard("
          )
        }
      }
      if (file.path === "packages/orchestrator/src/workflow/protocols/disposition-cleanup/production.test.ts") {
        return { ...file, source: file.source.replaceAll("gitDispositionCleanupBoundaryLayer", "removedCleanupLayer") }
      }
      return file
    })

    const expectedIssues = [
      "git-lineage controlled contract implementation binding is stale: controlledTargetLineageLayer",
      "git-integrator-candidate controlled contract implementation binding is stale: controlledContractLayer",
      "outer-integrator controlled contract implementation binding is stale: controlledIntegratorContractService",
      "journal production contract implementation binding is stale: productionJournalStoreLayer",
      "task-tracker-graph-read production contract implementation binding is stale: githubTrackerGraphReaderLayer",
      "planned-attempt-executor production contract implementation binding is stale: codexPlannedAttemptExecutorLayer",
      "immutable-evidence production contract implementation binding is stale: nodeEvidenceStoreLayer",
      "planned-worktree-cleanup controlled contract implementation binding is stale: worktreeCleanupTestLayer",
      "planned-worktree-cleanup production contract implementation binding is stale: gitDispositionCleanupBoundaryLayer",
      "planned-branch-cleanup controlled contract implementation binding is stale: branchCleanupTestLayer",
      "planned-branch-cleanup production contract implementation binding is stale: gitDispositionCleanupBoundaryLayer",
      "integrator-predecessor-candidate-cleanup controlled contract implementation binding is stale: integratorCandidateCleanupTestLayer",
      "integrator-predecessor-candidate-cleanup production contract implementation binding is stale: gitDispositionCleanupBoundaryLayer"
    ]
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, substituted)

    expect(issues).toEqual(expect.arrayContaining(expectedIssues))
  })

  it.each([
    ["task-tracker-claim", "production", "githubTrackerMutationLayer"],
    ["task-tracker-completion-claim", "controlled", "controlledCompletionClaimBoundaryLayerFrom"],
    ["task-tracker-completion-claim", "production", "githubCompletionClaimBoundaryLayer"],
    ["task-tracker-completion", "production", "githubCompletionTaskBoundaryLayer"]
  ] as const)("rejects a missing implementation binding for %s %s", (family, role, identity) => {
    const missingBinding = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) =>
        capability.family !== family
          ? capability
          : {
              ...capability,
              contract: {
                ...capability.contract,
                executions: capability.contract.executions.map((execution) => {
                  if (execution.role !== role) return execution
                  const { implementation: _implementation, ...executionWithoutImplementation } = execution
                  return executionWithoutImplementation
                })
              }
            }
      )
    }

    expect(issuesFor(missingBinding)).toContain(
      `${family} ${role} contract implementation binding is missing: ${identity}`
    )
  })

  it("rejects alternate, empty, and stale implementation proof on all four newly bound tracker edges", () => {
    const substituted = sourceFiles.map((file) => {
      if (file.path === "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "layer: githubTrackerMutationLayer.pipe(Layer.provide(githubClaimFixtureLayer), Layer.provide(NodeCrypto.layer))",
            "layer: Layer.empty"
          )
        }
      }
      if (
        file.path === "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.test.ts"
      ) {
        return {
          ...file,
          source: file.source.replace(
            "layer: controlledCompletionClaimBoundaryLayerFrom([fixture.activeClaim]),",
            "layer: controlledCompletionTaskBoundaryLayerFrom([openFacts]),"
          )
        }
      }
      if (file.path === "packages/orchestrator/src/authorities/task-tracker/github/completion-claim.test.ts") {
        return {
          ...file,
          source: file.source.replace(
            "  layer: Layer.unwrap(\n    makeHarness().pipe(\n      Effect.provide(NodeCrypto.layer),\n      Effect.map(({ layer }) => layer)\n    )\n  ),",
            "  layer: Layer.empty,"
          )
        }
      }
      return file
    })
    const sourceIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, substituted)
    expect(sourceIssues).toEqual(
      expect.arrayContaining([
        "task-tracker-claim production contract implementation binding is stale: githubTrackerMutationLayer",
        "task-tracker-completion-claim controlled contract implementation binding is stale: controlledCompletionClaimBoundaryLayerFrom",
        "task-tracker-completion-claim production contract implementation binding is stale: githubCompletionClaimBoundaryLayer"
      ])
    )
    expect(sourceIssues).toHaveLength(3)

    const staleProductionCompletionIdentity = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) =>
        capability.family !== "task-tracker-completion"
          ? capability
          : {
              ...capability,
              contract: {
                ...capability.contract,
                executions: capability.contract.executions.map((execution) =>
                  execution.role !== "production" || execution.implementation === undefined
                    ? execution
                    : {
                        ...execution,
                        implementation: { ...execution.implementation, identity: "staleCompletionTaskLayer" }
                      }
                )
              }
            }
      )
    }
    expect(issuesFor(staleProductionCompletionIdentity)).toContain(
      "task-tracker-completion production contract implementation binding is stale: staleCompletionTaskLayer"
    )
  })

  it("rejects a coordinator contract call that shadows the extracted public helper", () => {
    const substituted = sourceFiles.map((file) =>
      file.path === "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts"
        ? {
            ...file,
            source: file.source.replace(
              'import { coordinatorLockContract } from "../../../test/contracts/coordinator-lock-contract.js"',
              "const coordinatorLockContract = () => undefined"
            )
          }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, substituted)).toContain(
      "coordinator-ownership contract invocation marker is stale: coordinatorLockContract("
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
            githubTrackerMutationContractCall,
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
              `${githubTrackerMutationContractCall}\n`,
              `{\n  const { trackerMutationContract } = { trackerMutationContract: () => undefined }\n  ${githubTrackerMutationContractCall}\n}\n`
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

  it("does not retain a removed fixture's Layer binding in the next source audit", () => {
    const provider: CapabilitySourceFile = {
      path: "scripts/fixtures/transient-provider.ts",
      source: "export const temporaryProviderLayer = Layer.succeed(UnknownService, {})"
    }
    const composition: CapabilitySourceFile = {
      path: "scripts/fixtures/transient-composition.ts",
      source:
        'import { temporaryProviderLayer } from "./transient-provider.js"\nexport const assembled = temporaryProviderLayer'
    }
    const inventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: composition.path }
      ]
    }
    const issue = "production uses unregistered exported Layer temporaryProviderLayer"

    expect(runCapabilityRegistrationGate(inventory, [...sourceFiles, provider, composition])).toContain(issue)
    expect(runCapabilityRegistrationGate(inventory, [...sourceFiles, composition])).not.toContain(issue)
    expect(runCapabilityRegistrationGate(inventory, [...sourceFiles, provider, composition])).toContain(issue)
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

  it("relays parent signals for every bounded quality-gate stage", () => {
    const qualityGate = readFileSync("scripts/run-quality-gate.mjs", "utf8")

    expect(qualityGate).toMatch(
      /name: `Quality gate '\$\{gate\.name\}'`,\n\s*relayParentSignals: true,\n\s*terminationGraceMilliseconds: gate\.terminationGrace,/u
    )
    expect(qualityGate).not.toContain("relayParentSignals: gate.relayParentSignals")
  })
})
