/**
 * Dependency-neutral inventory for the repository's capability-registration
 * audit. This module names evidence and source markers only; it does not
 * import or construct any Dalph service, Layer, provider, or runtime.
 */

type CapabilityFamily =
  | "journal"
  | "task-tracker-graph-read"
  | "task-tracker-claim"
  | "task-tracker-completion-claim"
  | "task-tracker-completion"
  | "git-worktree"
  | "git-lineage"
  | "git-integrator-candidate"
  | "git-target-promotion"
  | "planned-attempt-executor"
  | "outer-integrator"
  | "immutable-evidence"
  | "planned-worktree-cleanup"
  | "planned-branch-cleanup"
  | "integrator-predecessor-candidate-cleanup"
  | "coordinator-ownership"

type CapabilityRole = "controlled" | "production"

interface ContractExecution {
  readonly role: CapabilityRole
  readonly source: string
  /** A named test/harness call that executes the shared public contract. */
  readonly marker: string
  /** Optional source call-site proof when the suite is imported from another test. */
  readonly invocation?: ContractInvocation
  /** Source-backed proof of which registered implementation the call exercises. */
  readonly implementation?: ContractImplementationBinding
}

export interface ContractImplementationBinding {
  readonly identity: string
  readonly source: string
  readonly marker: string
  readonly selector:
    | { readonly _tag: "Argument"; readonly index: number }
    | { readonly _tag: "ObjectProperty"; readonly property: string }
    | { readonly _tag: "InvocationScope" }
}

interface ContractEvidence {
  /** Stable name for the provider-neutral public contract being exercised. */
  readonly id: string
  readonly executions: ReadonlyArray<ContractExecution>
}

interface CompositionEvidence {
  readonly _tag: "Assembled" | "SuppliedAtBoundary"
  readonly source: string
  /** The exact source identifier or parameter accepted by the composition. */
  readonly marker: string
  /** The registered value whose identity must be consumed by this composition. */
  readonly identity: string
}

export interface RegisteredImplementation {
  readonly _tag: "Implementation"
  /** Stable source identity. It is not inferred from a filename convention. */
  readonly identity: string
  readonly source: string
  /** Exact declaration/service marker in the implementation source. */
  readonly marker: string
  readonly composition: CompositionEvidence
}

interface ContractInvocation {
  readonly source: string
  readonly marker: string
  /** Stable semantic argument evidence disambiguates repeated helper calls in one source. */
  readonly selector?:
    | { readonly _tag: "ObjectProperty"; readonly property: string; readonly value: string }
    | { readonly _tag: "StringArgument"; readonly index: number; readonly value: string }
    | { readonly _tag: "ArgumentReference"; readonly index: number; readonly value: string }
}

interface CompositionReference {
  readonly _tag: "Assembled" | "SuppliedAtBoundary"
  readonly source: string
  /** The exact source identifier or parameter accepted by the composition. */
  readonly marker: string
}

type NotApplicableReason = "no-repository-provider" | "application-supplied-boundary" | "provider-private-boundary"

interface NotApplicableImplementation {
  readonly _tag: "NotApplicable"
  readonly reason: NotApplicableReason
  /** Concrete reason parity must not be fabricated for this side. */
  readonly detail: string
}

interface CapabilityRegistration {
  readonly family: CapabilityFamily
  readonly boundary: string
  readonly contract: ContractEvidence
  readonly controlled: RegisteredImplementation | NotApplicableImplementation
  readonly production: RegisteredImplementation | NotApplicableImplementation
}

interface CompositionSource {
  readonly role: CapabilityRole
  readonly source: string
}

/**
 * A production composition may contain layers that are not one of #79's
 * capability families. They are explicitly recorded here so a newly used
 * exported layer cannot disappear from the audit under an ad-hoc exemption.
 */
interface CompositionSupportBinding {
  readonly identity: string
  /** Authored source containing the support value's declaration. */
  readonly source: string
  /** Declaration name resolved in the support source. */
  readonly marker: string
  readonly reason: string
}

export interface CapabilityRegistrationInventory {
  readonly requiredFamilies: ReadonlyArray<CapabilityFamily>
  readonly capabilities: ReadonlyArray<CapabilityRegistration>
  readonly compositionSources: ReadonlyArray<CompositionSource>
  readonly compositionSupportBindings: ReadonlyArray<CompositionSupportBinding>
}

const implementation = (
  identity: string,
  source: string,
  marker: string,
  composition: CompositionReference
): RegisteredImplementation => ({
  _tag: "Implementation",
  composition: { ...composition, identity },
  identity,
  marker,
  source
})

const notApplicable = (reason: NotApplicableReason, detail: string): NotApplicableImplementation => ({
  _tag: "NotApplicable",
  detail,
  reason
})

const contract = (id: string, executions: ReadonlyArray<ContractExecution>): ContractEvidence => ({ executions, id })

const implementationBinding = (
  identity: string,
  source: string,
  marker: string,
  selector: ContractImplementationBinding["selector"]
): ContractImplementationBinding => ({ identity, marker, selector, source })

const composed = (source: string, marker: string): CompositionReference => ({ _tag: "Assembled", marker, source })

const support = (identity: string, reason: string, source: string): CompositionSupportBinding => ({
  identity,
  marker: identity,
  reason,
  source
})

const controlledComposition = composed

/**
 * The acceptance issue is the authority for this family set. Keeping the
 * required set separate from the records makes deleting one record a real
 * negative case instead of allowing the inventory to redefine its own scope.
 */
const requiredCapabilityFamilies = [
  "journal",
  "task-tracker-graph-read",
  "task-tracker-claim",
  "task-tracker-completion-claim",
  "task-tracker-completion",
  "git-worktree",
  "git-lineage",
  "git-integrator-candidate",
  "git-target-promotion",
  "planned-attempt-executor",
  "outer-integrator",
  "immutable-evidence",
  "planned-worktree-cleanup",
  "planned-branch-cleanup",
  "integrator-predecessor-candidate-cleanup",
  "coordinator-ownership"
] as const satisfies ReadonlyArray<CapabilityFamily>

const journalContract = contract("JournalStore", [
  {
    invocation: {
      marker: "journalAppendContract(",
      source: "packages/orchestrator/src/workflow-journal/store.test.ts"
    },
    marker: "journalAppendContract",
    role: "controlled",
    source: "packages/orchestrator/src/workflow-journal/store.test.ts",
    implementation: implementationBinding(
      "memoryJournalTestLayer",
      "packages/orchestrator/src/workflow-journal/adapters/memory-store.ts",
      "memoryJournalTestLayer",
      { _tag: "Argument", index: 1 }
    )
  },
  {
    invocation: {
      marker: "journalAppendContract(",
      selector: { _tag: "StringArgument", index: 0, value: "sqlite" },
      source: "packages/orchestrator/src/workflow-journal/store.test.ts"
    },
    marker: "journalAppendContract",
    role: "production",
    source: "packages/orchestrator/src/workflow-journal/store.test.ts",
    implementation: implementationBinding(
      "productionJournalStoreLayer",
      "packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts",
      "productionJournalStoreLayer",
      { _tag: "Argument", index: 1 }
    )
  }
])

const trackerGraphContract = contract("TrackerGraphReader", [
  {
    marker: "trackerGraphReaderContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/tracker-graph-reader-contract.ts",
    implementation: implementationBinding(
      "trackerGraphReaderLayer",
      "packages/orchestrator/src/authorities/task-tracker/graph-reader.ts",
      "trackerGraphReaderLayer",
      { _tag: "ObjectProperty", property: "layer" }
    ),
    invocation: {
      marker: "trackerGraphReaderContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/graph-reader.contract.test.ts"
    }
  },
  {
    marker: "trackerGraphReaderContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/tracker-graph-reader-contract.ts",
    implementation: implementationBinding(
      "githubTrackerGraphReaderLayer",
      "packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts",
      "githubTrackerGraphReaderLayer",
      { _tag: "ObjectProperty", property: "layer" }
    ),
    invocation: {
      marker: "trackerGraphReaderContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/github/graph-reader.test.ts"
    }
  }
])

const trackerClaimContract = contract("TrackerMutation", [
  {
    invocation: {
      marker: "trackerMutationContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/claim-mutation.test.ts"
    },
    marker: "trackerMutationContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/tracker-mutation-contract.ts",
    implementation: implementationBinding(
      "controlledTrackerMutationLayer",
      "packages/orchestrator/src/authorities/task-tracker/claim-mutation.ts",
      "controlledTrackerMutationLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "trackerMutationContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts"
    },
    marker: "trackerMutationContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/tracker-mutation-contract.ts",
    implementation: implementationBinding(
      "githubTrackerMutationLayer",
      "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.ts",
      "githubTrackerMutationLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const completionContract = contract("CompletionBoundary", [
  {
    invocation: {
      marker: "completionBoundaryContract(",
      source: "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.test.ts"
    },
    marker: "completionBoundaryContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/completion-boundary-contract.ts",
    implementation: implementationBinding(
      "controlledCompletionTaskBoundaryLayerFrom",
      "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.ts",
      "controlledCompletionTaskBoundaryLayerFrom",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "completionBoundaryContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/github/completion-task.test.ts"
    },
    marker: "completionBoundaryContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/completion-boundary-contract.ts",
    implementation: implementationBinding(
      "githubCompletionTaskBoundaryLayer",
      "packages/orchestrator/src/authorities/task-tracker/github/completion-task.ts",
      "githubCompletionTaskBoundaryLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const completionClaimContract = contract("CompletionClaimBoundary", [
  {
    invocation: {
      marker: "completionClaimBoundaryContract(",
      source: "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.test.ts"
    },
    marker: "completionClaimBoundaryContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/completion-claim-boundary-contract.ts",
    implementation: implementationBinding(
      "controlledCompletionClaimBoundaryLayerFrom",
      "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.ts",
      "controlledCompletionClaimBoundaryLayerFrom",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "completionClaimBoundaryContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/github/completion-claim.test.ts"
    },
    marker: "completionClaimBoundaryContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/completion-claim-boundary-contract.ts",
    implementation: implementationBinding(
      "githubCompletionClaimBoundaryLayer",
      "packages/orchestrator/src/authorities/task-tracker/github/completion-claim.ts",
      "githubCompletionClaimBoundaryLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const worktreeContract = contract("GitWorktree", [
  {
    invocation: {
      marker: "gitWorktreeContract(",
      source: "packages/orchestrator/src/authorities/git/worktree.test.ts"
    },
    marker: "gitWorktreeContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/git-worktree-contract.ts",
    implementation: implementationBinding(
      "gitWorktreeTestLayer",
      "packages/orchestrator/src/authorities/git/worktree.ts",
      "gitWorktreeTestLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "gitWorktreeContract(",
      source: "packages/orchestrator/src/authorities/git/node-worktree.test.ts"
    },
    marker: "gitWorktreeContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/git-worktree-contract.ts",
    implementation: implementationBinding(
      "nodeGitWorktreeLayer",
      "packages/orchestrator/src/authorities/git/node-worktree.ts",
      "nodeGitWorktreeLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const lineageContract = contract("GitTargetLineage", [
  {
    invocation: {
      marker: "gitTargetLineageContract(",
      selector: { _tag: "ObjectProperty", property: "name", value: "controlled" },
      source: "packages/orchestrator/src/authorities/git/target-lineage.test.ts"
    },
    marker: "gitTargetLineageContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/git-target-lineage-contract.ts",
    implementation: implementationBinding(
      "controlledTargetLineageLayer",
      "packages/orchestrator/src/workflow/interpretation/layers.ts",
      "controlledTargetLineageLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "gitTargetLineageContract(",
      selector: { _tag: "ObjectProperty", property: "name", value: "command-backed" },
      source: "packages/orchestrator/src/authorities/git/target-lineage.test.ts"
    },
    marker: "gitTargetLineageContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/git-target-lineage-contract.ts",
    implementation: implementationBinding(
      "nodeGitTargetLineageLayer",
      "packages/orchestrator/src/authorities/git/target-lineage.ts",
      "nodeGitTargetLineageLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const integratorCandidateContract = contract("IntegratorGit", [
  {
    invocation: {
      marker: "integratorCandidateContract(",
      selector: { _tag: "ObjectProperty", property: "name", value: "controlled" },
      source: "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts"
    },
    marker: "integratorCandidateContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/integrator-candidate-contract.ts",
    implementation: implementationBinding(
      "controlledContractLayer",
      "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts",
      "controlledContractLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "integratorCandidateContract(",
      selector: { _tag: "ObjectProperty", property: "name", value: "command-backed" },
      source: "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts"
    },
    marker: "integratorCandidateContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/integrator-candidate-contract.ts",
    implementation: implementationBinding(
      "nodeGitIntegratorCandidateLayer",
      "packages/orchestrator/src/authorities/git/integrator-candidate.ts",
      "nodeGitIntegratorCandidateLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const targetPromotionContract = contract("TargetPromotionGit", [
  {
    invocation: {
      marker: "targetPromotionContract(",
      source: "packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts"
    },
    marker: "targetPromotionContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/target-promotion-contract.ts",
    implementation: implementationBinding(
      "gitLayer",
      "packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts",
      "gitLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "targetPromotionContract(",
      source: "packages/orchestrator/src/authorities/git/real-git-qualification.test.ts"
    },
    marker: "targetPromotionContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/target-promotion-contract.ts"
  }
])

const executorContract = contract("PlannedAttemptExecutor", [
  {
    invocation: {
      marker: "plannedAttemptExecutorContract(",
      source: "packages/dalph/src/application/dry-run-planned-attempt-executor.test.ts"
    },
    marker: "plannedAttemptExecutorContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/planned-attempt-executor-contract.ts",
    implementation: implementationBinding(
      "dryRunPlannedAttemptExecutorLayer",
      "packages/dalph/src/application/dry-run-planned-attempt-executor.ts",
      "dryRunPlannedAttemptExecutorLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  },
  {
    invocation: {
      marker: "plannedAttemptExecutorContract(",
      source: "packages/dalph/src/application/codex-planned-attempt-executor.test.ts"
    },
    marker: "plannedAttemptExecutorContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/planned-attempt-executor-contract.ts",
    implementation: implementationBinding(
      "codexPlannedAttemptExecutorLayer",
      "packages/dalph/src/application/codex-planned-attempt-executor.ts",
      "codexPlannedAttemptExecutorLayer",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const integratorContract = contract("Integrator", [
  {
    invocation: {
      marker: "integratorContract(",
      source: "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts"
    },
    marker: "integratorContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/integrator-contract.ts",
    implementation: implementationBinding(
      "controlledIntegratorContractService",
      "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts",
      "controlledIntegratorContractService",
      { _tag: "ObjectProperty", property: "layer" }
    )
  }
])

const evidenceContract = contract("EvidenceStore", [
  {
    invocation: {
      marker: "evidenceStoreContract(",
      selector: { _tag: "StringArgument", index: 1, value: "controlled" },
      source: "packages/orchestrator/src/workflow/protocols/evidence-store.test.ts"
    },
    marker: "evidenceStoreContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/evidence-store-contract.ts",
    implementation: implementationBinding(
      "memoryEvidenceStoreLayer",
      "packages/orchestrator/src/workflow/protocols/evidence-store.ts",
      "memoryEvidenceStoreLayer",
      { _tag: "Argument", index: 0 }
    )
  },
  {
    invocation: {
      marker: "evidenceStoreContract(",
      selector: { _tag: "StringArgument", index: 1, value: "filesystem" },
      source: "packages/orchestrator/src/workflow/protocols/evidence-store.test.ts"
    },
    marker: "evidenceStoreContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/evidence-store-contract.ts",
    implementation: implementationBinding(
      "nodeEvidenceStoreLayer",
      "packages/orchestrator/src/workflow/protocols/evidence-store.ts",
      "nodeEvidenceStoreLayer",
      { _tag: "Argument", index: 0 }
    )
  }
])

const cleanupContract = (
  familyMarker: string,
  controlledInvocationSource: string,
  controlledImplementationIdentity: string,
  controlledImplementationSource: string,
  productionAuthorization: string
): ContractEvidence =>
  contract(familyMarker, [
    {
      invocation: { marker: "dispositionCleanupContract({", source: controlledInvocationSource },
      marker: "dispositionCleanupContract",
      role: "controlled",
      source: "packages/orchestrator/test/contracts/disposition-cleanup-contract.ts",
      implementation: implementationBinding(
        controlledImplementationIdentity,
        controlledImplementationSource,
        controlledImplementationIdentity,
        { _tag: "InvocationScope" }
      )
    },
    {
      invocation: {
        marker: "dispositionCleanupContract({",
        selector: { _tag: "ObjectProperty", property: "authorization", value: productionAuthorization },
        source: "packages/orchestrator/src/workflow/protocols/disposition-cleanup/production.test.ts"
      },
      marker: "dispositionCleanupContract",
      role: "production",
      source: "packages/orchestrator/test/contracts/disposition-cleanup-contract.ts",
      implementation: implementationBinding(
        "gitDispositionCleanupBoundaryLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/boundaries.ts",
        "gitDispositionCleanupBoundaryLayer",
        { _tag: "InvocationScope" }
      )
    }
  ])

const coordinatorContract = contract("CoordinatorLock", [
  {
    invocation: {
      marker: "coordinatorLockContract(",
      selector: { _tag: "StringArgument", index: 0, value: "controlled" },
      source: "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts"
    },
    marker: "coordinatorLockContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/coordinator-lock-contract.ts",
    implementation: implementationBinding(
      "controlledCoordinatorLockLayer",
      "packages/orchestrator/src/authorities/coordinator-ownership/ownership.ts",
      "controlledCoordinatorLockLayer",
      { _tag: "Argument", index: 1 }
    )
  },
  {
    invocation: {
      marker: "coordinatorLockContract(",
      selector: { _tag: "StringArgument", index: 0, value: "node" },
      source: "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts"
    },
    marker: "coordinatorLockContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/coordinator-lock-contract.ts",
    implementation: implementationBinding(
      "nodeCoordinatorLockLayer",
      "packages/orchestrator/src/authorities/coordinator-ownership/node-lock.ts",
      "nodeCoordinatorLockLayer",
      { _tag: "Argument", index: 1 }
    )
  }
])

/**
 * Current production and controlled implementation inventory. A production
 * `SuppliedAtBoundary` entry means the composition accepts a provider-neutral
 * service and the repository owns the named provider implementation; it does
 * not claim that a remote provider was contacted by this audit.
 */
export const capabilityRegistrationInventory = {
  requiredFamilies: [...requiredCapabilityFamilies],
  capabilities: [
    {
      boundary: "JournalStore read, append, lifecycle, and retirement",
      controlled: implementation(
        "memoryJournalTestLayer",
        "packages/orchestrator/src/workflow-journal/adapters/memory-store.ts",
        "memoryJournalTestLayer",
        controlledComposition("packages/orchestrator/src/workflow-journal/store.test.ts", "memoryJournalTestLayer")
      ),
      contract: journalContract,
      family: "journal",
      production: implementation(
        "productionJournalStoreLayer",
        "packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts",
        "productionJournalStoreLayer",
        composed("packages/dalph/src/application/production.ts", "productionJournalStoreLayer")
      )
    },
    {
      boundary: "task-tracker graph reads",
      controlled: implementation(
        "trackerGraphReaderLayer",
        "packages/orchestrator/src/authorities/task-tracker/graph-reader.ts",
        "trackerGraphReaderLayer",
        controlledComposition("packages/dalph/src/application/dry-run.ts", "trackerGraphReaderLayer")
      ),
      contract: trackerGraphContract,
      family: "task-tracker-graph-read",
      production: implementation(
        "githubTrackerGraphReaderLayer",
        "packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts",
        "githubTrackerGraphReaderLayer",
        composed(
          "packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts",
          "githubTrackerGraphReaderLayer"
        )
      )
    },
    {
      boundary: "task-tracker claim changes",
      controlled: implementation(
        "controlledTrackerMutationLayer",
        "packages/orchestrator/src/authorities/task-tracker/claim-mutation.ts",
        "controlledTrackerMutationLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/interpretation/layers.ts",
          "controlledTrackerMutationLayer"
        )
      ),
      contract: trackerClaimContract,
      family: "task-tracker-claim",
      production: implementation(
        "githubTrackerMutationLayer",
        "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.ts",
        "githubTrackerMutationLayer",
        composed(
          "packages/orchestrator/src/authorities/task-tracker/github/delivery-authority.ts",
          "githubTrackerMutationLayer"
        )
      )
    },
    {
      boundary: "completion-claim observation, creation, and deletion",
      controlled: implementation(
        "controlledCompletionClaimBoundaryLayerFrom",
        "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.ts",
        "controlledCompletionClaimBoundaryLayerFrom",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.test.ts",
          "controlledCompletionClaimBoundaryLayerFrom"
        )
      ),
      contract: completionClaimContract,
      family: "task-tracker-completion-claim",
      production: implementation(
        "githubCompletionClaimBoundaryLayer",
        "packages/orchestrator/src/authorities/task-tracker/github/completion-claim.ts",
        "githubCompletionClaimBoundaryLayer",
        composed(
          "packages/orchestrator/src/authorities/task-tracker/github/delivery-authority.ts",
          "githubCompletionClaimBoundaryLayer"
        )
      )
    },
    {
      boundary: "task completion and focused tracker observations",
      controlled: implementation(
        "controlledCompletionTaskBoundaryLayerFrom",
        "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.ts",
        "controlledCompletionTaskBoundaryLayerFrom",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.test.ts",
          "controlledCompletionTaskBoundaryLayerFrom"
        )
      ),
      contract: completionContract,
      family: "task-tracker-completion",
      production: implementation(
        "githubCompletionTaskBoundaryLayer",
        "packages/orchestrator/src/authorities/task-tracker/github/completion-task.ts",
        "githubCompletionTaskBoundaryLayer",
        composed(
          "packages/orchestrator/src/authorities/task-tracker/github/delivery-authority.ts",
          "githubCompletionTaskBoundaryLayer"
        )
      )
    },
    {
      boundary: "Git planned-worktree observation and change",
      controlled: implementation(
        "gitWorktreeTestLayer",
        "packages/orchestrator/src/authorities/git/worktree.ts",
        "gitWorktreeTestLayer",
        controlledComposition("packages/orchestrator/src/authorities/git/worktree.test.ts", "gitWorktreeTestLayer")
      ),
      contract: worktreeContract,
      family: "git-worktree",
      production: implementation(
        "nodeGitWorktreeLayer",
        "packages/orchestrator/src/authorities/git/node-worktree.ts",
        "nodeGitWorktreeLayer",
        composed("packages/dalph/src/application/production.ts", "nodeGitWorktreeLayer")
      )
    },
    {
      boundary: "Git target lineage observation",
      controlled: implementation(
        "controlledTargetLineageLayer",
        "packages/orchestrator/src/workflow/interpretation/layers.ts",
        "controlledTargetLineageLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/interpretation/layers.ts",
          "controlledTargetLineageLayer"
        )
      ),
      contract: lineageContract,
      family: "git-lineage",
      production: implementation(
        "nodeGitTargetLineageLayer",
        "packages/orchestrator/src/authorities/git/target-lineage.ts",
        "nodeGitTargetLineageLayer",
        composed("packages/dalph/src/application/production.ts", "nodeGitTargetLineageLayer")
      )
    },
    {
      boundary: "Git Integrator-candidate qualification",
      controlled: implementation(
        "controlledContractLayer",
        "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts",
        "controlledContractLayer",
        controlledComposition(
          "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts",
          "controlledContractLayer"
        )
      ),
      contract: integratorCandidateContract,
      family: "git-integrator-candidate",
      production: implementation(
        "nodeGitIntegratorCandidateLayer",
        "packages/orchestrator/src/authorities/git/integrator-candidate.ts",
        "nodeGitIntegratorCandidateLayer",
        composed("packages/dalph/src/application/production.ts", "nodeGitIntegratorCandidateLayer")
      )
    },
    {
      boundary: "Git exact-head target promotion",
      controlled: implementation(
        "gitLayer",
        "packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts",
        "gitLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts",
          "gitLayer"
        )
      ),
      contract: targetPromotionContract,
      family: "git-target-promotion",
      production: notApplicable(
        "application-supplied-boundary",
        "production activation accepts TargetPromotionRuntimeInput from its host; the node adapter is qualification-tested but this repository does not assemble it in production"
      )
    },
    {
      boundary: "planned-attempt executor",
      controlled: implementation(
        "dryRunPlannedAttemptExecutorLayer",
        "packages/dalph/src/application/dry-run-planned-attempt-executor.ts",
        "dryRunPlannedAttemptExecutorLayer",
        controlledComposition("packages/dalph/src/application/composition.ts", "dryRunPlannedAttemptExecutorLayer")
      ),
      contract: executorContract,
      family: "planned-attempt-executor",
      production: implementation(
        "codexPlannedAttemptExecutorLayer",
        "packages/dalph/src/application/codex-planned-attempt-executor.ts",
        "codexPlannedAttemptExecutorLayer",
        composed("packages/dalph/src/application/codex-planned-attempt-executor.ts", "codexPlannedAttemptExecutorLayer")
      )
    },
    {
      boundary: "outer Integrator",
      controlled: implementation(
        "controlledIntegratorContractService",
        "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts",
        "controlledIntegratorContractService",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts",
          "controlledIntegratorContractService"
        )
      ),
      contract: integratorContract,
      family: "outer-integrator",
      production: notApplicable(
        "no-repository-provider",
        "production activation accepts an outer Integrator service from its host; no repository-owned production Integrator provider is assembled"
      )
    },
    {
      boundary: "immutable evidence storage",
      controlled: implementation(
        "memoryEvidenceStoreLayer",
        "packages/orchestrator/src/workflow/protocols/evidence-store.ts",
        "memoryEvidenceStoreLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/evidence-store.test.ts",
          "memoryEvidenceStoreLayer"
        )
      ),
      contract: evidenceContract,
      family: "immutable-evidence",
      production: implementation(
        "nodeEvidenceStoreLayer",
        "packages/orchestrator/src/workflow/protocols/evidence-store.ts",
        "nodeEvidenceStoreLayer",
        composed("packages/dalph/bin/codex-qualification-host.ts", "nodeEvidenceStoreLayer")
      )
    },
    {
      boundary: "disposition-authorized planned-worktree cleanup",
      controlled: implementation(
        "worktreeCleanupTestLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.ts",
        "worktreeCleanupTestLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.test.ts",
          "worktreeCleanupTestLayer"
        )
      ),
      contract: cleanupContract(
        "PlannedWorktreeCleanup",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.test.ts",
        "worktreeCleanupTestLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.ts",
        "worktreeAuthorization"
      ),
      family: "planned-worktree-cleanup",
      production: implementation(
        "gitDispositionCleanupBoundaryLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/boundaries.ts",
        "gitDispositionCleanupBoundaryLayer",
        composed("packages/dalph/src/application/production.ts", "gitDispositionCleanupBoundaryLayer")
      )
    },
    {
      boundary: "disposition-authorized planned-branch cleanup",
      controlled: implementation(
        "branchCleanupTestLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/branch.ts",
        "branchCleanupTestLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/disposition-cleanup/branch.test.ts",
          "branchCleanupTestLayer"
        )
      ),
      contract: cleanupContract(
        "PlannedBranchCleanup",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/branch.test.ts",
        "branchCleanupTestLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/branch.ts",
        "branchAuthorization"
      ),
      family: "planned-branch-cleanup",
      production: implementation(
        "gitDispositionCleanupBoundaryLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/boundaries.ts",
        "gitDispositionCleanupBoundaryLayer",
        composed("packages/dalph/src/application/production.ts", "gitDispositionCleanupBoundaryLayer")
      )
    },
    {
      boundary: "disposition-authorized quarantined Integrator predecessor-candidate cleanup",
      controlled: implementation(
        "integratorCandidateCleanupTestLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.ts",
        "integratorCandidateCleanupTestLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.test.ts",
          "integratorCandidateCleanupTestLayer"
        )
      ),
      contract: cleanupContract(
        "IntegratorPredecessorCandidateCleanup",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.test.ts",
        "integratorCandidateCleanupTestLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.ts",
        "candidateAuthorization"
      ),
      family: "integrator-predecessor-candidate-cleanup",
      production: implementation(
        "gitDispositionCleanupBoundaryLayer",
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/boundaries.ts",
        "gitDispositionCleanupBoundaryLayer",
        composed("packages/dalph/src/application/production.ts", "gitDispositionCleanupBoundaryLayer")
      )
    },
    {
      boundary: "coordinator ownership",
      controlled: implementation(
        "controlledCoordinatorLockLayer",
        "packages/orchestrator/src/authorities/coordinator-ownership/ownership.ts",
        "controlledCoordinatorLockLayer",
        controlledComposition(
          "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts",
          "controlledCoordinatorLockLayer"
        )
      ),
      contract: coordinatorContract,
      family: "coordinator-ownership",
      production: implementation(
        "nodeCoordinatorLockLayer",
        "packages/orchestrator/src/authorities/coordinator-ownership/node-lock.ts",
        "nodeCoordinatorLockLayer",
        composed(
          "packages/orchestrator/src/authorities/coordinator-ownership/live-task-work-start.ts",
          "nodeCoordinatorLockLayer"
        )
      )
    }
  ],
  compositionSources: [
    { role: "production", source: "packages/orchestrator/src/authorities/task-tracker/github/delivery-authority.ts" },
    { role: "production", source: "packages/dalph/src/application/production.ts" },
    { role: "production", source: "packages/dalph/bin/codex-qualification-host.ts" },
    {
      role: "production",
      source: "packages/orchestrator/src/authorities/coordinator-ownership/live-task-work-start.ts"
    },
    { role: "production", source: "packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts" },
    { role: "controlled", source: "packages/dalph/src/application/composition.ts" },
    { role: "controlled", source: "packages/dalph/src/application/dry-run.ts" }
  ],
  compositionSupportBindings: [
    support(
      "githubDeliveryAuthorityLayer",
      "exact four-capability GitHub tracker assembly over one configured client and Crypto service",
      "packages/orchestrator/src/authorities/task-tracker/github/delivery-authority.ts"
    ),
    support(
      "githubTrackerGraphReaderNodeLayer",
      "node GraphQL dependencies around the registered GitHub graph-reader implementation",
      "packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts"
    ),
    support(
      "nodeCodexPlannedAttemptExecutorLayer",
      "node activity-census dependencies around the registered Codex executor implementation",
      "packages/dalph/src/application/codex-planned-attempt-executor.ts"
    ),
    support(
      "attemptChoiceControlLayer",
      "operator-control protocol support",
      "packages/orchestrator/src/workflow/protocols/attempt-choice/control.ts"
    ),
    support(
      "coordinatorOwnershipLayer",
      "coordinator wrapper implementation support",
      "packages/orchestrator/src/authorities/coordinator-ownership/live-task-work-start.ts"
    ),
    support(
      "coordinatorOwnedGitWorktreeLayer",
      "coordinator wrapper around the registered Git worktree boundary",
      "packages/orchestrator/src/authorities/coordinator-ownership/live-task-work-start.ts"
    ),
    support(
      "coordinatorOwnedTrackerMutationLayer",
      "coordinator wrapper around the registered tracker claim boundary",
      "packages/orchestrator/src/authorities/coordinator-ownership/live-task-work-start.ts"
    ),
    support(
      "controlDirectionApplicationLayer",
      "operator-control protocol support",
      "packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.ts"
    ),
    support(
      "controlledWorkflowInterpreterLayer",
      "controlled composition assembly",
      "packages/orchestrator/src/workflow/interpretation/layers.ts"
    ),
    support(
      "deterministicOperationIdAllocatorLayer",
      "controlled identity allocation support",
      "packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.ts"
    ),
    support(
      "deterministicPlannedTaskAttemptLayer",
      "controlled planning support",
      "packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.ts"
    ),
    support(
      "deterministicTaskClaimAcquisitionPlannerLayer",
      "controlled planning support",
      "packages/orchestrator/src/workflow/protocols/task-claim-acquisition/plan.ts"
    ),
    support("dryCliEnvironmentLayer", "dry-run denied host environment", "packages/dalph/src/application/dry-run.ts"),
    support(
      "dryRunOperationIdAllocatorLayer",
      "dry-run planning support",
      "packages/dalph/src/application/composition.ts"
    ),
    support(
      "dryRunPlannedTaskAttemptLayer",
      "dry-run planning support",
      "packages/dalph/src/application/composition.ts"
    ),
    support("dryRunTaskClaimPlannerLayer", "dry-run planning support", "packages/dalph/src/application/composition.ts"),
    support(
      "fixtureReaderFileLayer",
      "fixture input support for controlled graph reads",
      "packages/orchestrator/src/authorities/task-tracker/graph-reader.ts"
    ),
    support(
      "freshOperationIdAllocatorLayer",
      "production identity allocation support",
      "packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.ts"
    ),
    support(
      "githubGraphqlClientNodeLayer",
      "GitHub transport support behind the registered tracker provider",
      "packages/orchestrator/src/authorities/task-tracker/github/graphql-client.ts"
    ),
    support("journalLayer", "journaled application runtime support", "packages/dalph/src/application/production.ts"),
    support(
      "journaledRunBootstrapLayer",
      "journal establishment support",
      "packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts"
    ),
    support(
      "journaledWorkflowInterpreterLayer",
      "journaled workflow support",
      "packages/orchestrator/src/workflow-journal/journaled-interpreter.ts"
    ),
    support(
      "nodeCodexAttemptStoreLayer",
      "implementation-private Codex executor storage",
      "packages/dalph/src/application/codex-attempt-store.ts"
    ),
    support(
      "nodeCodexProcessNativeLayer",
      "implementation-private Codex process support",
      "packages/dalph/src/application/codex-process-native.ts"
    ),
    support(
      "nodeGitCommandLayer",
      "shared Git command dependency of registered Git boundaries",
      "packages/orchestrator/src/authorities/git/command.ts"
    ),
    support(
      "sqliteJournalStoreLayer",
      "implementation-private storage beneath the registered journal boundary",
      "packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts"
    ),
    support(
      "operatorControlLayer",
      "operator-control protocol support",
      "packages/dalph/src/application/production.ts"
    ),
    support(
      "productionRunReactivationLayer",
      "application lifecycle composition",
      "packages/dalph/src/application/production.ts"
    ),
    support(
      "productionCoordinatorOwnershipLayer",
      "production coordinator ownership assembly",
      "packages/orchestrator/src/authorities/coordinator-ownership/live-task-work-start.ts"
    ),
    support(
      "productionWorkflowInterpreterLayer",
      "application composition entry",
      "packages/dalph/src/application/production.ts"
    ),
    support(
      "runReactivationOwnerLayer",
      "application lifecycle composition",
      "packages/orchestrator/src/coordination/run/run-reactivation-owner.ts"
    ),
    support(
      "taskClaimReacquisitionControlLayer",
      "claim-control protocol support",
      "packages/orchestrator/src/workflow/protocols/task-claim-reacquisition/control.ts"
    ),
    support(
      "taskWorkCapacityControlLayer",
      "task-work capacity protocol support",
      "packages/orchestrator/src/control/task-work-capacity.ts"
    ),
    support(
      "traceOutputStdioLayer",
      "dry-run trace output support",
      "packages/dalph/src/presentation/stdio-trace-output.ts"
    ),
    support(
      "unpublishedInRunJournalTestLayer",
      "SQLite test-only journal support",
      "packages/orchestrator/src/workflow-journal/store.ts"
    ),
    support(
      "validatedRunActivationLayer",
      "Run activation support",
      "packages/orchestrator/src/coordination/run/startup-recovery.ts"
    ),
    support(
      "workflowInterpreterLayer",
      "shared workflow composition",
      "packages/orchestrator/src/workflow/interpretation/layers.ts"
    ),
    support(
      "workflowTraceOutputLayer",
      "dry-run trace output support",
      "packages/dalph/src/presentation/workflow-trace.ts"
    ),
    support(
      "codexAppServerNodeLayer",
      "Codex app-server host support",
      "packages/dalph/src/application/codex-app-server.ts"
    ),
    support(
      "makeDryRunTrackerGraphReaderLayer",
      "dry-run tracker adapter selection support",
      "packages/dalph/src/application/dry-run.ts"
    ),
    support(
      "dryRunTrackerGraphReaderLayer",
      "dry-run tracker adapter selection support",
      "packages/dalph/src/application/dry-run.ts"
    )
  ]
} satisfies CapabilityRegistrationInventory

export const capabilityRegistrationIssues = (
  inventory: CapabilityRegistrationInventory = capabilityRegistrationInventory
): ReadonlyArray<string> => {
  // Diagnostics are accumulated locally so one gate run reports every
  // broken registration; the mutable collection never crosses this boundary.
  /* eslint-disable functional/immutable-data */
  const issues: Array<string> = []
  const families = inventory.capabilities.map(({ family }) => family)
  const identitiesByFamily = new Set<string>()
  const identityFamilies = new Map<string, Set<CapabilityFamily>>()
  const compositionIdentities: Array<string> = []
  const cleanupFamilies = new Set<CapabilityFamily>([
    "planned-worktree-cleanup",
    "planned-branch-cleanup",
    "integrator-predecessor-candidate-cleanup"
  ])

  for (const required of requiredCapabilityFamilies) {
    if (!families.includes(required)) issues.push(`missing capability family ${required}`)
  }
  for (const family of families) {
    if (families.filter((candidate) => candidate === family).length > 1)
      issues.push(`duplicate capability family ${family}`)
  }
  for (const capability of inventory.capabilities) {
    for (const side of ["controlled", "production"] as const) {
      const entry = capability[side]
      if (entry._tag === "NotApplicable") {
        if (entry.detail.trim() === "") issues.push(`${capability.family} ${side} has an empty not-applicable reason`)
        continue
      }
      const identityKey = `${capability.family}:${entry.identity}`
      if (identitiesByFamily.has(identityKey)) issues.push(`duplicate implementation identity ${entry.identity}`)
      identitiesByFamily.add(identityKey)
      const owners = identityFamilies.get(entry.identity) ?? new Set<CapabilityFamily>()
      if (
        owners.size > 0 &&
        !(
          entry.identity === "gitDispositionCleanupBoundaryLayer" &&
          cleanupFamilies.has(capability.family) &&
          [...owners].every((owner) => cleanupFamilies.has(owner))
        )
      ) {
        issues.push(`duplicate implementation identity ${entry.identity}`)
      }
      owners.add(capability.family)
      identityFamilies.set(entry.identity, owners)
      if (entry.composition._tag === "Assembled") compositionIdentities.push(entry.identity)
    }
    const executions = capability.contract.executions
    const presentRoles = new Set(
      executions.filter(({ role }) => capability[role]._tag === "Implementation").map(({ role }) => role)
    )
    for (const role of ["controlled", "production"] as const) {
      if (capability[role]._tag === "Implementation" && !presentRoles.has(role)) {
        issues.push(`${capability.family} ${role} has no shared contract execution`)
      }
    }
    for (const execution of executions) {
      if (execution.marker.trim() === "") issues.push(`${capability.family} has an empty contract marker`)
    }
  }
  const supportIdentities = new Set<string>()
  for (const support of inventory.compositionSupportBindings) {
    if (supportIdentities.has(support.identity)) issues.push(`duplicate support binding ${support.identity}`)
    supportIdentities.add(support.identity)
    if (compositionIdentities.includes(support.identity))
      issues.push(`capability identity is incorrectly support-listed ${support.identity}`)
    if (support.reason.trim() === "") issues.push(`support binding ${support.identity} has an empty reason`)
    if (support.source.trim() === "") issues.push(`support binding ${support.identity} has an empty source`)
    if (support.marker.trim() === "") issues.push(`support binding ${support.identity} has an empty marker`)
    if (support.marker !== support.identity)
      issues.push(`support binding ${support.identity} identity does not match declaration marker ${support.marker}`)
  }
  /* eslint-enable functional/immutable-data */
  return issues
}
