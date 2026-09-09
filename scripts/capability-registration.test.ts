import { describe, expect, it } from "vitest"
import {
  capabilityRegistrationInventory,
  capabilityRegistrationIssues,
  type CapabilityRegistrationInventory
} from "./capability-registration.js"
import {
  inspectCapabilitySourceProgram,
  repositoryCapabilitySourceFiles,
  runCapabilityRegistrationGate,
  type CapabilitySourceFile
} from "./capability-registration-gate.js"
// @ts-expect-error The quality-gate policy is an executable JavaScript module.
import { boundedQualityGateCommand, capabilityRegistrationQualityGate } from "./quality-gate-stage-policy.mjs"

const sourceFiles = repositoryCapabilitySourceFiles()
const githubTrackerMutationContractCall = `trackerMutationContract({
  ...trackerMutationContractFixture(taskId, "github"),
  layer: githubTrackerMutationLayer.pipe(Layer.provide(githubClaimFixtureLayer), Layer.provide(NodeCrypto.layer))
})`

const issuesFor = (inventory: CapabilityRegistrationInventory): ReadonlyArray<string> =>
  runCapabilityRegistrationGate(inventory, sourceFiles)

describe("capability registration gate", () => {
  it("fails closed for a first-audit virtual source under a repository source root", () => {
    const path = "packages/contracts/src/issue-262-invalid-added-root.ts"
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      { path, source: "export {}\nexport const = 1" }
    ])

    expect(issues.some((issue) => issue.includes(`in ${path}:`) && issue.includes("TS1134"))).toBe(true)
  })

  it(
    "runs every registered controlled, production, and qualification implementation through its named contract family",
    { timeout: 30_000 },
    () => {
      inspectCapabilitySourceProgram([
        {
          path: "scripts/fixtures/issue-262-unrelated-global.ts",
          source: "declare const issue262UnrelatedGlobal: string"
        }
      ])
      const issues = issuesFor(capabilityRegistrationInventory)
      const repositoryDiagnostics = inspectCapabilitySourceProgram(sourceFiles)

      expect(issues).toEqual([])
      expect(repositoryDiagnostics.reusedSourcePaths).toEqual([])
      expect(repositoryDiagnostics.rebuiltSourcePaths).toHaveLength(sourceFiles.length)

      for (const capability of capabilityRegistrationInventory.capabilities) {
        for (const role of ["controlled", "production", "qualification"] as const) {
          const implementation = capability[role]
          if (implementation?._tag === "Implementation") {
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

  it("registers the real tracker and Integrator authorities and keeps unavailable providers typed N/A", () => {
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
      expect.objectContaining({ _tag: "Implementation", identity: "nodeCodexIntegratorLayer" })
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

  it("rejects qualification composition evidence substituted for a production implementation", () => {
    const crossRole = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) =>
        capability.family !== "immutable-evidence"
          ? capability
          : {
              ...capability,
              production: {
                ...capability.production,
                composition: {
                  ...capability.production.composition,
                  source: "packages/dalph/bin/codex-qualification-host.ts"
                }
              }
            }
      )
    }

    expect(issuesFor(crossRole)).toContain(
      "immutable-evidence production composition role is stale: packages/dalph/bin/codex-qualification-host.ts is qualification"
    )
  })

  it("rejects an unclassified test consumer substituted for real production consumption", () => {
    const unclassifiedConsumer: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-unclassified-evidence-consumer.test.ts",
      source:
        'import { nodeEvidenceStoreLayer } from "../../packages/orchestrator/src/workflow/protocols/evidence-store.js"\nexport const testEvidenceLayer = nodeEvidenceStoreLayer'
    }
    const substituted = {
      ...capabilityRegistrationInventory,
      capabilities: capabilityRegistrationInventory.capabilities.map((capability) =>
        capability.family !== "immutable-evidence"
          ? capability
          : {
              ...capability,
              production: {
                ...capability.production,
                composition: {
                  ...capability.production.composition,
                  marker: "nodeEvidenceStoreLayer",
                  source: unclassifiedConsumer.path
                }
              }
            }
      )
    }
    const withoutProductionConsumption = sourceFiles.map((file) =>
      file.path === "packages/dalph/src/application/production-host.ts"
        ? {
            ...file,
            source: file.source.replace(
              "nodeEvidenceStoreLayer(configuration.evidenceStoreRoot).pipe(Layer.provide(NodeServices.layer))",
              "Layer.empty"
            )
          }
        : file
    )

    expect(
      runCapabilityRegistrationGate(substituted, [...withoutProductionConsumption, unclassifiedConsumer])
    ).toContain(`immutable-evidence production composition role is stale: ${unclassifiedConsumer.path} is unregistered`)
  })

  it("rejects replacement of the registered evidence Layer in the production host", () => {
    const replacedProductionHost = sourceFiles.map((file) =>
      file.path === "packages/dalph/src/application/production-host.ts"
        ? {
            ...file,
            source: file.source.replace(
              "nodeEvidenceStoreLayer(configuration.evidenceStoreRoot).pipe(Layer.provide(NodeServices.layer))",
              "Layer.empty"
            )
          }
        : file
    )

    expect(runCapabilityRegistrationGate(capabilityRegistrationInventory, replacedProductionHost)).toContain(
      "immutable-evidence production composition marker is stale: nodeEvidenceStoreLayer"
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

    expect(issuesFor(oneSided)).toEqual(
      expect.arrayContaining([
        "journal production has no shared contract execution",
        "journal qualification has no shared contract execution"
      ])
    )
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
    ["journal", "qualification", "sqliteJournalTestLayer"],
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

  it("rejects a qualification-only capability Layer assembled by a production composition", () => {
    const productionComposition: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-cross-role-composition.ts",
      source:
        'import { sqliteJournalTestLayer } from "../../packages/orchestrator/src/workflow-journal/adapters/sqlite-store.js"\nexport const assembled = sqliteJournalTestLayer'
    }
    const inventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: productionComposition.path }
      ]
    }

    expect(runCapabilityRegistrationGate(inventory, [...sourceFiles, productionComposition])).toContain(
      "production uses unregistered exported Layer sqliteJournalTestLayer"
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
      capabilities: [],
      compositionSources: [{ role: "production" as const, source: composition.path }],
      compositionSupportBindings: [],
      requiredFamilies: []
    }
    const issue = "production uses unregistered exported Layer temporaryProviderLayer"

    expect(runCapabilityRegistrationGate(inventory, [provider, composition])).toContain(issue)
    expect(runCapabilityRegistrationGate(inventory, [composition])).not.toContain(issue)
    expect(runCapabilityRegistrationGate(inventory, [provider, composition])).toContain(issue)
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
        "const localProvider = Layer.succeed(UnknownService, {})",
        "export const assembledLocal = hidden",
        "export const assembledDefault = defaultProvider",
        "export const assembledNamespace = namespace.hidden",
        "export const assembledLocalProvider = localProvider"
      ].join("\n")
    }
    const inventory = {
      ...capabilityRegistrationInventory,
      compositionSources: [
        ...capabilityRegistrationInventory.compositionSources,
        { role: "production" as const, source: composition.path }
      ]
    }

    const issues = runCapabilityRegistrationGate(inventory, [...sourceFiles, layerSource, reexportSource, composition])
    expect(issues).toEqual(
      expect.arrayContaining([
        "production uses unregistered exported Layer hidden",
        "production uses unregistered exported Layer defaultProvider",
        "production uses unregistered exported Layer namespace.hidden"
      ])
    )
    expect(issues).not.toContain("production uses unregistered exported Layer localProvider")
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

  it("reuses unchanged source trees when a later audit adds a virtual root", () => {
    const basePath = "scripts/fixtures/issue-262-cache-base.ts"
    const addedPath = "scripts/fixtures/issue-262-cache-added.ts"
    const base = [{ path: basePath, source: "export const cacheBase = 1" }]

    inspectCapabilitySourceProgram(base)
    const expanded = inspectCapabilitySourceProgram([
      ...base,
      { path: addedPath, source: "export const cacheAdded = 2" }
    ])

    expect(expanded.reusedSourcePaths).toContain(basePath)
    expect(expanded.rebuiltSourcePaths).toContain(addedPath)
    expect(expanded.rebuiltSourcePaths).not.toContain(basePath)
  })

  it("rebuilds a source whose complete text changes instead of reusing its old tree", () => {
    const path = "scripts/fixtures/issue-262-cache-changed.ts"
    const original = [{ path, source: "export const cacheValue = 1" }]

    inspectCapabilitySourceProgram(original)
    const changed = inspectCapabilitySourceProgram([{ path, source: "export const cacheValue = 2" }])

    expect(changed.rebuiltSourcePaths).toContain(path)
    expect(changed.reusedSourcePaths).not.toContain(path)
  })

  it("fails closed on syntax diagnostics from an added virtual source without exposing repository diagnostics", () => {
    const path = "scripts/fixtures/issue-262-invalid-syntax.ts"
    const validSource: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-invalid-syntax-base.ts",
      source: "export const valid = 1"
    }
    const invalidSource: CapabilitySourceFile = { path, source: "export const = 1" }

    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [validSource, invalidSource])
    const diagnostics = issues.filter((issue) => issue.startsWith("source audit TypeScript diagnostic"))

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.every((issue) => issue.includes(`in ${path}:`))).toBe(true)
    expect(issues).toEqual(expect.arrayContaining(diagnostics))
  })

  it("fails closed on semantic diagnostics from a changed virtual source", () => {
    const path = "scripts/fixtures/issue-262-invalid-semantic.ts"
    const validSource: CapabilitySourceFile = { path, source: 'export const semanticValue: string = "valid"' }
    const invalidSource: CapabilitySourceFile = { path, source: "export const semanticValue: string = 1" }

    inspectCapabilitySourceProgram([validSource])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [invalidSource])

    expect(issues.some((issue) => issue.includes(`in ${path}:`) && issue.includes("TS2322"))).toBe(true)
    expect(
      issues
        .filter((issue) => issue.startsWith("source audit TypeScript diagnostic"))
        .every((issue) => issue.includes(`in ${path}:`))
    ).toBe(true)
  })

  it("preserves or recomputes diagnostics across unrelated and ambient source changes", () => {
    const path = "scripts/fixtures/issue-262-equivalent-invalid.ts"
    const invalidSource = { path, source: "export const value: string = 1" }
    const validSource = {
      path: "scripts/fixtures/issue-262-equivalent-valid.ts",
      source: "export const validValue = 1"
    }
    const unrelatedSource = {
      path: "scripts/fixtures/issue-262-equivalent-unrelated.ts",
      source: "export const unrelatedValue = 2"
    }

    const firstIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      { ...invalidSource },
      { ...validSource }
    ])
    const reorderedIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      { ...validSource },
      { ...invalidSource }
    ])
    const expandedIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      { ...validSource },
      { ...invalidSource },
      unrelatedSource
    ])
    const changedUnrelatedIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      { ...validSource },
      { ...invalidSource },
      { ...unrelatedSource, source: "export const unrelatedValue = 3" }
    ])
    const hasExpectedDiagnostic = (issues: ReadonlyArray<string>) =>
      issues.some((issue) => issue.includes(`in ${path}:`) && issue.includes("TS2322"))

    expect(hasExpectedDiagnostic(firstIssues)).toBe(true)
    expect(hasExpectedDiagnostic(reorderedIssues)).toBe(true)
    expect(hasExpectedDiagnostic(expandedIssues)).toBe(true)
    expect(hasExpectedDiagnostic(changedUnrelatedIssues)).toBe(true)

    const conflictPath = "scripts/fixtures/issue-262-global-conflict.ts"
    const retainedGlobal: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-262-global-retained.ts",
      source: "export {}; declare global { const issue262Conflict: string }"
    }
    const conflictingGlobal: CapabilitySourceFile = {
      path: conflictPath,
      source: "export {}; declare global { const issue262Conflict: number }"
    }
    const conflictingIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      retainedGlobal,
      conflictingGlobal
    ])
    const afterRemovalIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [retainedGlobal])

    expect(conflictingIssues.some((issue) => issue.includes("TS2451"))).toBe(true)
    expect(afterRemovalIssues.some((issue) => issue.includes("TS2451"))).toBe(false)

    const ambientPath = "scripts/fixtures/issue-262-ambient-value.ts"
    const consumerPath = "scripts/fixtures/issue-262-ambient-consumer.ts"
    const ambientNumber: CapabilitySourceFile = {
      path: ambientPath,
      source: "export {}; declare global { const issue262AmbientValue: number }"
    }
    const ambientString: CapabilitySourceFile = {
      path: ambientPath,
      source: "export {}; declare global { const issue262AmbientValue: string }"
    }
    const ambientConsumer: CapabilitySourceFile = {
      path: consumerPath,
      source: "export const issue262ConsumerValue: number = issue262AmbientValue"
    }
    const freshAmbientIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      { ...ambientString, path: "scripts/fixtures/issue-262-fresh-ambient-value.ts" },
      {
        path: "scripts/fixtures/issue-262-fresh-ambient-consumer.ts",
        source: "export const issue262FreshConsumerValue: number = issue262AmbientValue"
      }
    ])

    const baselineAmbientIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      ambientNumber,
      ambientConsumer
    ])
    expect(baselineAmbientIssues.some((issue) => issue.startsWith("source audit TypeScript diagnostic"))).toBe(false)
    const changedAmbientIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      ambientString,
      ambientConsumer
    ])
    const diagnosticCodes = (issues: ReadonlyArray<string>) =>
      issues.flatMap((issue) => issue.match(/source audit TypeScript diagnostic \([^)]*\) (TS\d+)/u)?.[1] ?? [])
    expect(freshAmbientIssues.some((issue) => issue.includes("TS2322"))).toBe(true)
    expect(
      changedAmbientIssues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2322"))
    ).toBe(true)
    expect(diagnosticCodes(changedAmbientIssues)).toEqual(diagnosticCodes(freshAmbientIssues))

    const indirectRoot = "scripts/fixtures/issue-262-indirect-ambient"
    const indirectTypePath = `${indirectRoot}/type.ts`
    const indirectAugmenterPath = `${indirectRoot}/augmenter.ts`
    const indirectConsumerPath = `${indirectRoot}/consumer.ts`
    const indirectAugmenter: CapabilitySourceFile = {
      path: indirectAugmenterPath,
      source:
        'import type { Issue262AmbientType } from "./type.js"\nexport {}; declare global { const issue262IndirectAmbientValue: Issue262AmbientType }'
    }
    const indirectConsumer: CapabilitySourceFile = {
      path: indirectConsumerPath,
      source: "export const issue262IndirectConsumerValue: number = issue262IndirectAmbientValue"
    }
    inspectCapabilitySourceProgram([
      { path: indirectTypePath, source: "export type Issue262AmbientType = number" },
      indirectAugmenter,
      indirectConsumer
    ])
    const changedSources = [
      { path: indirectTypePath, source: "export type Issue262AmbientType = string" },
      indirectAugmenter,
      indirectConsumer
    ]
    const changedIndirectIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, changedSources)
    const changedDiagnostics = inspectCapabilitySourceProgram(changedSources)

    const freshIndirectRoot = "scripts/fixtures/issue-262-fresh-indirect-ambient"
    const freshIndirectIssues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [
      { path: `${freshIndirectRoot}/type.ts`, source: "export type Issue262AmbientType = string" },
      {
        path: `${freshIndirectRoot}/augmenter.ts`,
        source:
          'import type { Issue262AmbientType } from "./type.js"\nexport {}; declare global { const issue262IndirectAmbientValue: Issue262AmbientType }'
      },
      {
        path: `${freshIndirectRoot}/consumer.ts`,
        source: "export const issue262IndirectConsumerValue: number = issue262IndirectAmbientValue"
      }
    ])
    const compilerIssues = (issues: ReadonlyArray<string>) =>
      issues.filter((issue) => issue.startsWith("source audit TypeScript diagnostic"))

    expect(
      changedIndirectIssues.some((issue) => issue.includes(`in ${indirectConsumerPath}:`) && issue.includes("TS2322"))
    ).toBe(true)
    expect(changedDiagnostics.rebuiltSourcePaths).toContain(indirectTypePath)
    expect(changedDiagnostics.reusedSourcePaths).toEqual(
      expect.arrayContaining([indirectAugmenterPath, indirectConsumerPath])
    )
    expect(compilerIssues(changedIndirectIssues)).toEqual(
      compilerIssues(freshIndirectIssues).map((issue) => issue.replaceAll(freshIndirectRoot, indirectRoot))
    )
  })

  it("fails closed when a changed dependency removes an imported export", () => {
    const dependencyPath = "scripts/fixtures/issue-262-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-dependency-consumer.ts"
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        'import { dependencyValue } from "./issue-262-dependency.js"\nexport const consumerValue = dependencyValue'
    }
    const validDependency: CapabilitySourceFile = { path: dependencyPath, source: "export const dependencyValue = 1" }
    const removedExport: CapabilitySourceFile = { path: dependencyPath, source: "export const replacementValue = 1" }

    inspectCapabilitySourceProgram([validDependency, consumer])
    const changedSources = [removedExport, consumer]
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, changedSources)
    const diagnostics = inspectCapabilitySourceProgram(changedSources)

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2305"))).toBe(true)
    expect(diagnostics.rebuiltDependencyPaths).toContain(dependencyPath)
    expect(diagnostics.reusedDependencyPaths).toContain(consumerPath)
  })

  it("fails closed when a removed dependency remains imported", () => {
    const dependencyPath = "scripts/fixtures/issue-262-removed-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-removed-dependency-consumer.ts"
    const dependency: CapabilitySourceFile = { path: dependencyPath, source: "export const dependencyValue = 1" }
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        'import { dependencyValue } from "./issue-262-removed-dependency.js"\nexport const consumerValue = dependencyValue'
    }

    inspectCapabilitySourceProgram([dependency, consumer])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [consumer])

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2307"))).toBe(true)
  })

  it("fails closed when a changed import-type dependency removes an exported type", () => {
    const dependencyPath = "scripts/fixtures/issue-262-import-type-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-import-type-consumer.ts"
    const dependency: CapabilitySourceFile = {
      path: dependencyPath,
      source: "export interface DependencyShape { readonly value: number }"
    }
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        'type DependencyShape = import("./issue-262-import-type-dependency.js").DependencyShape\nexport const consumerValue: DependencyShape = { value: 1 }'
    }
    const changedDependency: CapabilitySourceFile = {
      path: dependencyPath,
      source: "export interface ReplacementShape { readonly value: number }"
    }

    inspectCapabilitySourceProgram([dependency, consumer])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [changedDependency, consumer])

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2694"))).toBe(true)
  })

  it("fails closed when a removed triple-slash dependency remains referenced", () => {
    const dependencyPath = "scripts/fixtures/issue-262-triple-reference-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-triple-reference-consumer.ts"
    const dependency: CapabilitySourceFile = {
      path: dependencyPath,
      source: "type TripleReferenceShape = { readonly value: number }"
    }
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        '/// <reference path="./issue-262-triple-reference-dependency.ts" />\nexport const consumerValue: TripleReferenceShape = { value: 1 }'
    }

    inspectCapabilitySourceProgram([dependency, consumer])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [consumer])

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2304"))).toBe(true)
  })

  it("fails closed when a changed dynamic-import dependency removes an exported value", () => {
    const dependencyPath = "scripts/fixtures/issue-262-dynamic-import-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-dynamic-import-consumer.ts"
    const dependency: CapabilitySourceFile = { path: dependencyPath, source: "export const dynamicValue = 1" }
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        'export const consumerValue = import("./issue-262-dynamic-import-dependency.js").then(({ dynamicValue }) => dynamicValue)'
    }
    const changedDependency: CapabilitySourceFile = {
      path: dependencyPath,
      source: "export const replacementValue = 1"
    }

    inspectCapabilitySourceProgram([dependency, consumer])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [changedDependency, consumer])

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2339"))).toBe(true)
  })

  it("fails closed when a changed require dependency removes an exported value", () => {
    const dependencyPath = "scripts/fixtures/issue-262-require-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-require-consumer.ts"
    const dependency: CapabilitySourceFile = { path: dependencyPath, source: "export const requiredValue = 1" }
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        'import dependency = require("./issue-262-require-dependency.js")\nexport const consumerValue = dependency.requiredValue'
    }
    const changedDependency: CapabilitySourceFile = {
      path: dependencyPath,
      source: "export const replacementValue = 1"
    }

    inspectCapabilitySourceProgram([dependency, consumer])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [changedDependency, consumer])

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2339"))).toBe(true)
  })

  it("rechecks an unchanged consumer after a changed ordinary require call dependency", () => {
    const dependencyPath = "scripts/fixtures/issue-262-require-call-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-require-call-consumer.ts"
    const dependency: CapabilitySourceFile = { path: dependencyPath, source: "export const requiredValue = 1" }
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        'declare function require(path: string): unknown\nconst dependency = require("./issue-262-require-call-dependency.js")\nconst latentError: string = 1\nexport const consumerValue = dependency'
    }
    const changedDependency: CapabilitySourceFile = {
      path: dependencyPath,
      source: "export const replacementValue = 1"
    }

    inspectCapabilitySourceProgram([dependency, consumer])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [changedDependency, consumer])

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2322"))).toBe(true)
  })

  it("rechecks an unchanged consumer after an ordinary require call dependency is removed", () => {
    const dependencyPath = "scripts/fixtures/issue-262-require-call-removed-dependency.ts"
    const consumerPath = "scripts/fixtures/issue-262-require-call-removed-consumer.ts"
    const dependency: CapabilitySourceFile = { path: dependencyPath, source: "export const requiredValue = 1" }
    const consumer: CapabilitySourceFile = {
      path: consumerPath,
      source:
        'declare function require(path: string): unknown\nconst dependency = require("./issue-262-require-call-removed-dependency.js")\nconst latentError: string = 1\nexport const consumerValue = dependency'
    }

    inspectCapabilitySourceProgram([dependency, consumer])
    const issues = runCapabilityRegistrationGate(capabilityRegistrationInventory, [consumer])

    expect(issues.some((issue) => issue.includes(`in ${consumerPath}:`) && issue.includes("TS2322"))).toBe(true)
  })

  it("keeps exact source-array identity caching and refreshes Program recency", () => {
    const baselinePath = "scripts/fixtures/issue-262-cache-identity.ts"
    const baseline = [{ path: baselinePath, source: "export const cached = 1" }]
    const baselineDiagnostics = inspectCapabilitySourceProgram(baseline)
    inspectCapabilitySourceProgram([
      { path: "scripts/fixtures/issue-262-cache-displacement-a.ts", source: "export const displacementA = 1" },
      { path: "scripts/fixtures/issue-262-cache-displacement-b.ts", source: "export const displacementB = 2" }
    ])

    expect(inspectCapabilitySourceProgram(baseline)).toBe(baselineDiagnostics)
    const expanded = inspectCapabilitySourceProgram([
      ...baseline,
      { path: "scripts/fixtures/issue-262-cache-expanded.ts", source: "export const expanded = 2" }
    ])
    expect(expanded.reusedSourcePaths).toContain(baselinePath)
    expect(expanded.rebuiltSourcePaths).toContain("scripts/fixtures/issue-262-cache-expanded.ts")
  })

  it("audits source text without loading or invoking a live provider", () => {
    const providerLayer: CapabilitySourceFile = {
      path: "scripts/fixtures/issue-79-provider-layer.ts",
      source: [
        'throw new Error("capability source audit evaluated the provider fixture")',
        'export const unregisteredProviderLayer = Layer.effect(Provider, () => fetch("https://provider.invalid"))'
      ].join("\n")
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

    const providerSources = [...sourceFiles, providerLayer, providerComposition]
    const repositorySourcePath = sourceFiles[0]?.path
    if (repositorySourcePath === undefined) throw new Error("repository capability sources are missing")
    inspectCapabilitySourceProgram(sourceFiles)
    const issues = runCapabilityRegistrationGate(inventory, providerSources)
    const providerDiagnostics = inspectCapabilitySourceProgram(providerSources)
    expect(issues).toContain("production uses unregistered exported Layer unregisteredProviderLayer")
    expect(providerDiagnostics.reusedSourcePaths).toContain(repositorySourcePath)
    expect(new Set(providerDiagnostics.reusedSourcePaths)).toEqual(new Set(sourceFiles.map(({ path }) => path)))
  })

  it("passes the capability deadline and parent-signal policy to the bounded runner", () => {
    expect(
      boundedQualityGateCommand({
        gate: capabilityRegistrationQualityGate,
        nodeExecutable: "/fixture/node",
        pnpmEntryPoint: "/fixture/pnpm.cjs"
      })
    ).toEqual({
      args: ["/fixture/pnpm.cjs", "--silent", "test:capability-registration"],
      environment: undefined,
      executable: "/fixture/node",
      name: "Quality gate 'capability registration'",
      relayParentSignals: true,
      terminationGraceMilliseconds: undefined,
      timeoutMilliseconds: 60_000
    })

    expect(
      boundedQualityGateCommand({
        gate: {
          args: ["test:issue-268-c4"],
          name: "issue 268 fresh-process repeatability",
          terminationGrace: 15_000,
          timeout: 19 * 60_000
        },
        nodeExecutable: "/fixture/node",
        pnpmEntryPoint: "/fixture/pnpm.cjs"
      })
    ).toMatchObject({
      args: ["/fixture/pnpm.cjs", "--silent", "test:issue-268-c4"],
      relayParentSignals: true,
      terminationGraceMilliseconds: 15_000
    })
  })
})
