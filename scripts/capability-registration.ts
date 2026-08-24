/**
 * Dependency-neutral inventory for the repository's capability-registration
 * audit. This module names evidence and source markers only; it does not
 * import or construct any Dalph service, Layer, provider, or runtime.
 */

type CapabilityFamily =
  | "journal"
  | "task-tracker-graph-read"
  | "task-tracker-claim"
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
  composition: CompositionEvidence
): RegisteredImplementation => ({ _tag: "Implementation", composition, identity, marker, source })

const notApplicable = (reason: NotApplicableReason, detail: string): NotApplicableImplementation => ({
  _tag: "NotApplicable",
  detail,
  reason
})

const contract = (id: string, executions: ReadonlyArray<ContractExecution>): ContractEvidence => ({ executions, id })

const composed = (source: string, marker: string): CompositionEvidence => ({ _tag: "Assembled", marker, source })

const supplied = (source: string, marker: string): CompositionEvidence => ({
  _tag: "SuppliedAtBoundary",
  marker,
  source
})

const controlledComposition = composed

/**
 * The acceptance issue is the authority for this family set. Keeping the
 * required set separate from the records makes deleting one record a real
 * negative case instead of allowing the inventory to redefine its own scope.
 */
const requiredFamilies = [
  "journal",
  "task-tracker-graph-read",
  "task-tracker-claim",
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
    source: "packages/orchestrator/src/workflow-journal/store.test.ts"
  },
  {
    invocation: {
      marker: "durableJournalStoreContract(",
      source: "packages/orchestrator/src/workflow-journal/store.test.ts"
    },
    marker: "journalAppendContract",
    role: "production",
    source: "packages/orchestrator/src/workflow-journal/store.test.ts"
  }
])

const trackerGraphContract = contract("TrackerGraphReader", [
  {
    marker: "trackerGraphReaderContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/tracker-graph-reader-contract.ts",
    invocation: {
      marker: "trackerGraphReaderContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/graph-reader.contract.test.ts"
    }
  },
  {
    marker: "trackerGraphReaderContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/tracker-graph-reader-contract.ts",
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
    source: "packages/orchestrator/test/contracts/tracker-mutation-contract.ts"
  },
  {
    invocation: {
      marker: "trackerMutationContract(",
      source: "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.test.ts"
    },
    marker: "trackerMutationContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/tracker-mutation-contract.ts"
  }
])

const completionContract = contract("CompletionBoundary", [
  {
    marker: "CompletionClaimBoundary",
    role: "controlled",
    source: "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.ts"
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
    source: "packages/orchestrator/test/contracts/git-worktree-contract.ts"
  },
  {
    invocation: {
      marker: "gitWorktreeContract(",
      source: "packages/orchestrator/src/authorities/git/node-worktree.test.ts"
    },
    marker: "gitWorktreeContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/git-worktree-contract.ts"
  }
])

const lineageContract = contract("GitTargetLineage", [
  {
    invocation: {
      marker: "gitTargetLineageContract(",
      source: "packages/orchestrator/src/authorities/git/target-lineage.test.ts"
    },
    marker: "gitTargetLineageContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/git-target-lineage-contract.ts"
  },
  {
    invocation: {
      marker: "gitTargetLineageContract(",
      source: "packages/orchestrator/src/authorities/git/target-lineage.test.ts"
    },
    marker: "gitTargetLineageContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/git-target-lineage-contract.ts"
  }
])

const integratorCandidateContract = contract("IntegratorGit", [
  {
    invocation: {
      marker: "integratorCandidateContract(",
      source: "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts"
    },
    marker: "integratorCandidateContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/integrator-candidate-contract.ts"
  },
  {
    invocation: {
      marker: "integratorCandidateContract(",
      source: "packages/orchestrator/src/authorities/git/integrator-candidate.test.ts"
    },
    marker: "integratorCandidateContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/integrator-candidate-contract.ts"
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
    source: "packages/orchestrator/test/contracts/target-promotion-contract.ts"
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
    source: "packages/orchestrator/test/contracts/planned-attempt-executor-contract.ts"
  },
  {
    invocation: {
      marker: "plannedAttemptExecutorContract(",
      source: "packages/dalph/src/application/codex-planned-attempt-executor.test.ts"
    },
    marker: "plannedAttemptExecutorContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/planned-attempt-executor-contract.ts"
  }
])

const integratorContract = contract("Integrator", [
  {
    marker: "Integrator.of",
    role: "controlled",
    source: "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts"
  }
])

const evidenceContract = contract("EvidenceStore", [
  {
    invocation: {
      marker: "evidenceStoreContract(",
      source: "packages/orchestrator/src/workflow/protocols/evidence-store.test.ts"
    },
    marker: "evidenceStoreContract",
    role: "controlled",
    source: "packages/orchestrator/test/contracts/evidence-store-contract.ts"
  },
  {
    invocation: {
      marker: "evidenceStoreContract(",
      source: "packages/orchestrator/src/workflow/protocols/evidence-store.test.ts"
    },
    marker: "evidenceStoreContract",
    role: "production",
    source: "packages/orchestrator/test/contracts/evidence-store-contract.ts"
  }
])

const cleanupContract = (familyMarker: string, controlledInvocationSource: string): ContractEvidence =>
  contract(familyMarker, [
    {
      invocation: { marker: "dispositionCleanupContract({", source: controlledInvocationSource },
      marker: "dispositionCleanupContract",
      role: "controlled",
      source: "packages/orchestrator/test/contracts/disposition-cleanup-contract.ts"
    },
    {
      invocation: {
        marker: "dispositionCleanupContract({",
        source: "packages/orchestrator/src/workflow/protocols/disposition-cleanup/production.test.ts"
      },
      marker: "dispositionCleanupContract",
      role: "production",
      source: "packages/orchestrator/test/contracts/disposition-cleanup-contract.ts"
    }
  ])

const coordinatorContract = contract("CoordinatorLock", [
  {
    invocation: {
      marker: "coordinatorLockContract(",
      source: "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts"
    },
    marker: "coordinatorLockContract",
    role: "controlled",
    source: "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts"
  },
  {
    invocation: {
      marker: "coordinatorLockContract(",
      source: "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts"
    },
    marker: "coordinatorLockContract",
    role: "production",
    source: "packages/orchestrator/src/authorities/coordinator-ownership/ownership.test.ts"
  }
])

/**
 * Current production and controlled implementation inventory. A production
 * `SuppliedAtBoundary` entry means the composition accepts a provider-neutral
 * service and the repository owns the named provider implementation; it does
 * not claim that a remote provider was contacted by this audit.
 */
export const capabilityRegistrationInventory = {
  requiredFamilies,
  capabilities: [
    {
      boundary: "JournalStore read, append, lifecycle, and retirement",
      controlled: implementation(
        "memoryJournalStoreLayer",
        "packages/orchestrator/src/workflow-journal/adapters/memory-store.ts",
        "memoryJournalStoreLayer",
        controlledComposition("packages/orchestrator/src/workflow-journal/store.test.ts", "memoryJournalTestLayer")
      ),
      contract: journalContract,
      family: "journal",
      production: implementation(
        "sqliteJournalStoreLayer",
        "packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts",
        "sqliteJournalStoreLayer",
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
        "githubTrackerGraphReaderNodeLayer",
        "packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts",
        "githubTrackerGraphReaderNodeLayer",
        supplied("packages/dalph/src/application/dry-run.ts", "githubTrackerGraphReaderNodeLayer")
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
        "githubTrackerMutationNodeLayer",
        "packages/orchestrator/src/authorities/task-tracker/github/claim-mutation.ts",
        "githubTrackerMutationNodeLayer",
        supplied("packages/dalph/src/application/production.ts", "trackerMutationAdapterLayer")
      )
    },
    {
      boundary: "task completion and focused tracker observations",
      controlled: implementation(
        "controlledCompletionClaimBoundaryLayer",
        "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.ts",
        "controlledCompletionClaimBoundaryLayer",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.test.ts",
          "controlledCompletionClaimBoundaryLayerFrom"
        )
      ),
      contract: completionContract,
      family: "task-tracker-completion",
      production: notApplicable(
        "application-supplied-boundary",
        "production activation accepts completion and focused-observation services from its application host; this repository has no provider adapter to register"
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
        "gitTargetLineageTestLayer",
        "packages/orchestrator/src/authorities/git/target-lineage.ts",
        "gitTargetLineageTestLayer",
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
        "controlledIntegratorGitService",
        "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts",
        "IntegratorGit.of",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts",
          "IntegratorGit.of"
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
        "controlledTargetPromotionGitService",
        "packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts",
        "TargetPromotionGit.of",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts",
          "gitLayer"
        )
      ),
      contract: targetPromotionContract,
      family: "git-target-promotion",
      production: implementation(
        "nodeGitTargetPromotionLayer",
        "packages/orchestrator/src/authorities/git/target-promotion.ts",
        "nodeGitTargetPromotionLayer",
        supplied("packages/dalph/src/application/production.ts", "targetPromotion")
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
        "nodeCodexPlannedAttemptExecutorLayer",
        "packages/dalph/src/application/codex-planned-attempt-executor.ts",
        "nodeCodexPlannedAttemptExecutorLayer",
        composed("packages/dalph/bin/codex-qualification-host.ts", "nodeCodexPlannedAttemptExecutorLayer")
      )
    },
    {
      boundary: "outer Integrator",
      controlled: implementation(
        "controlledIntegratorService",
        "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts",
        "Integrator.of",
        controlledComposition(
          "packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts",
          "Integrator.of"
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
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.test.ts"
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
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/branch.test.ts"
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
        "packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.test.ts"
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
    { identity: "attemptChoiceControlLayer", reason: "operator-control protocol support" },
    { identity: "coordinatorOwnershipLayer", reason: "coordinator wrapper implementation support" },
    {
      identity: "coordinatorOwnedGitWorktreeLayer",
      reason: "coordinator wrapper around the registered Git worktree boundary"
    },
    {
      identity: "coordinatorOwnedTrackerMutationLayer",
      reason: "coordinator wrapper around the registered tracker claim boundary"
    },
    { identity: "controlDirectionApplicationLayer", reason: "operator-control protocol support" },
    { identity: "controlledWorkflowInterpreterLayer", reason: "controlled composition assembly" },
    { identity: "deterministicOperationIdAllocatorLayer", reason: "controlled identity allocation support" },
    { identity: "deterministicPlannedTaskAttemptLayer", reason: "controlled planning support" },
    { identity: "deterministicTaskClaimAcquisitionPlannerLayer", reason: "controlled planning support" },
    { identity: "dryCliEnvironmentLayer", reason: "dry-run denied host environment" },
    { identity: "dryRunOperationIdAllocatorLayer", reason: "dry-run planning support" },
    { identity: "dryRunPlannedTaskAttemptLayer", reason: "dry-run planning support" },
    { identity: "dryRunTaskClaimPlannerLayer", reason: "dry-run planning support" },
    { identity: "fixtureReaderFileLayer", reason: "fixture input support for controlled graph reads" },
    { identity: "freshOperationIdAllocatorLayer", reason: "production identity allocation support" },
    {
      identity: "githubGraphqlClientNodeLayer",
      reason: "GitHub transport support behind the registered tracker provider"
    },
    { identity: "journalLayer", reason: "journaled application runtime support" },
    { identity: "journaledRunBootstrapLayer", reason: "journal establishment support" },
    { identity: "journaledWorkflowInterpreterLayer", reason: "journaled workflow support" },
    { identity: "nodeCodexAttemptStoreLayer", reason: "implementation-private Codex executor storage" },
    { identity: "nodeCodexProcessNativeLayer", reason: "implementation-private Codex process support" },
    { identity: "nodeGitCommandLayer", reason: "shared Git command dependency of registered Git boundaries" },
    { identity: "operatorControlLayer", reason: "operator-control protocol support" },
    { identity: "productionRunReactivationLayer", reason: "application lifecycle composition" },
    { identity: "productionCoordinatorOwnershipLayer", reason: "production coordinator ownership assembly" },
    { identity: "productionJournalStoreLayer", reason: "production journal assembly" },
    { identity: "productionWorkflowInterpreterLayer", reason: "application composition entry" },
    { identity: "runReactivationOwnerLayer", reason: "application lifecycle composition" },
    { identity: "taskClaimReacquisitionControlLayer", reason: "claim-control protocol support" },
    { identity: "taskWorkCapacityControlLayer", reason: "task-work capacity protocol support" },
    { identity: "traceOutputStdioLayer", reason: "dry-run trace output support" },
    { identity: "unpublishedInRunJournalTestLayer", reason: "SQLite test-only journal support" },
    { identity: "validatedRunActivationLayer", reason: "Run activation support" },
    { identity: "workflowInterpreterLayer", reason: "shared workflow composition" },
    { identity: "workflowTraceOutputLayer", reason: "dry-run trace output support" },
    { identity: "codexAppServerNodeLayer", reason: "Codex app-server host support" },
    { identity: "makeDryRunTrackerGraphReaderLayer", reason: "dry-run tracker adapter selection support" },
    { identity: "dryRunTrackerGraphReaderLayer", reason: "dry-run tracker adapter selection support" }
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

  for (const required of inventory.requiredFamilies) {
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
  }
  /* eslint-enable functional/immutable-data */
  return issues
}
