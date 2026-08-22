import { NodeServices } from "@effect/platform-node"
import { type IntegrationTarget, PlannedAttemptExecutor, type RunId } from "@dalph/contracts"
import {
  AllocatedWorkflowRunId,
  JournaledRunBootstrap,
  type JournaledRuntimeLayerInput,
  type TrackerGraphReader,
  attemptChoiceControlLayer,
  controlDirectionApplicationLayer,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedTrackerMutationLayer,
  type GitCommonDirectoryTarget,
  type JournalStoreError,
  EvidenceStore,
  ApplicationExitShell,
  makeApplicationExitShell,
  journaledRunBootstrapLayer,
  journaledWorkflowInterpreterLayer,
  ApplicationExitRequestBoundary,
  CoordinatorOwnership,
  nodeGitCommandLayer,
  nodeGitIntegratorCandidateLayer,
  nodeGitTargetLineageLayer,
  nodeGitWorktreeLayer,
  freshOperationIdAllocatorLayer,
  productionCoordinatorOwnershipLayer,
  productionJournalStoreLayer,
  type TrackerMutation,
  validatedRunActivationLayer,
  taskWorkCapacityControlLayer,
  taskClaimReacquisitionControlLayer,
  workflowInterpreterLayer,
  WorkflowInterpreter,
  WorkflowTrace,
  type EvidenceStoreService,
  type TargetPromotionRuntimeInput,
  type CompletionClaimBoundaryService,
  type CompletionTaskBoundaryService,
  gitDispositionCleanupBoundaryLayer,
  IntegratorCandidateProviderAuthority,
  type IntegratorCandidateProviderAuthorityService,
  makeRunReactivationOwner,
  attachRunReactivationHintSource,
  runWorkflow,
  type InitialControlPolicySource,
  type TrackerTarget,
  type RunReactivationHintSource
} from "@dalph/orchestrator"
import type { FileSystem } from "effect"
import { Crypto, Duration, Effect, Layer, Schema } from "effect"

const finitePositiveDuration = Schema.DurationFromString.check(
  Schema.makeFilter((duration) =>
    Duration.isFinite(duration) && Duration.isPositive(duration)
      ? undefined
      : "reactivation intervals must be finite and greater than zero"
  )
)

/** Decoded production timer input; raw CLI/config strings do not reach the owner. */
export const ProductionRunReactivationInterval = finitePositiveDuration.pipe(
  Schema.brand("ProductionRunReactivationInterval")
)
export type ProductionRunReactivationInterval = typeof ProductionRunReactivationInterval.Type

const defaultProductionRunReactivationInterval = ProductionRunReactivationInterval.make(Duration.minutes(1))

// eslint-disable-next-line functional/no-mixed-types -- Production composition groups decoded timing, failure observation, and ephemeral hint sources at one boundary.
export interface ProductionRunReactivationOptions {
  readonly activationInterval?: ProductionRunReactivationInterval
  readonly onFailure?: (failure: unknown) => Effect.Effect<void>
  /** Optional current-first notification/publication sources; values remain hints. */
  readonly hintSources?: ReadonlyArray<RunReactivationHintSource<unknown>>
}

/**
 * Builds one process-local owner for the exact production Run. Every owner
 * turn re-enters the ordinary public `runWorkflow` establishment boundary;
 * no tracker notification or prior observation is retained as authority.
 */
export const makeProductionRunReactivationOwner = <EInitial, RInitial>(
  target: TrackerTarget,
  initialControlPolicySource: InitialControlPolicySource<EInitial, RInitial>,
  runId: RunId,
  options: ProductionRunReactivationOptions = {}
) =>
  Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    const activation = runWorkflow(target, initialControlPolicySource, AllocatedWorkflowRunId.make(runId)).pipe(
      Effect.provideService(JournaledRunBootstrap, bootstrap)
    )
    const activationInterval = options.activationInterval ?? defaultProductionRunReactivationInterval
    const owner =
      options.onFailure === undefined
        ? yield* makeRunReactivationOwner({ activate: activation, activationInterval })
        : yield* makeRunReactivationOwner({ activate: activation, activationInterval, onFailure: options.onFailure })
    if (options.hintSources !== undefined) {
      yield* Effect.forEach(options.hintSources, (source) => attachRunReactivationHintSource(owner, source))
    }
    const applicationExit = yield* ApplicationExitShell
    yield* applicationExit.registerProcessLocalDrain({ closeProcessLocalResources: owner.stop() })
    return owner
  })

/**
 * Composes live tracker/Git boundaries with the caller-selected executor
 * implementation through the ordinary Effect Layer environment.
 */
type ProductionWorkflowLayer<TrackerError, TrackerRequirements> = Layer.Layer<
  ApplicationExitRequestBoundary | ApplicationExitShell | JournaledRunBootstrap,
  | TrackerError
  | JournalStoreError
  | Layer.Error<typeof productionJournalStoreLayer>
  | Layer.Error<ReturnType<typeof productionCoordinatorOwnershipLayer>>,
  Crypto.Crypto | FileSystem.FileSystem | TrackerGraphReader | TrackerRequirements | WorkflowTrace
>

export const productionWorkflowInterpreterLayer = <TrackerError, TrackerRequirements>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  integrationTarget: IntegrationTarget,
  trackerMutationAdapterLayer: Layer.Layer<TrackerMutation, TrackerError, TrackerRequirements>,
  plannedAttemptExecutorLayer: Layer.Layer<PlannedAttemptExecutor>,
  /**
   * Provider-owned Integrator candidate authority. Production cannot infer
   * predecessor ownership or writer quiescence from a Git locator. Callers
   * must install the provider's exact ownership/quiescence adapter (or the
   * explicit unavailable adapter while candidate cleanup is unsupported).
   */
  integratorCandidateProviderAuthority: IntegratorCandidateProviderAuthorityService,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinality?: CompletionClaimBoundaryService,
  completionTask?: CompletionTaskBoundaryService,
  acceptedResultEvidenceStore?: EvidenceStoreService
): ProductionWorkflowLayer<TrackerError, TrackerRequirements> => {
  const ownershipLayer = productionCoordinatorOwnershipLayer(target)
  const trackerMutationLayer = coordinatorOwnedTrackerMutationLayer(trackerMutationAdapterLayer).pipe(
    Layer.provide(ownershipLayer)
  )
  const gitWorktreeLayer = coordinatorOwnedGitWorktreeLayer(
    nodeGitWorktreeLayer(target).pipe(Layer.provide(nodeGitCommandLayer), Layer.provide(NodeServices.layer))
  ).pipe(Layer.provide(ownershipLayer))
  const gitTargetLineageLayer = nodeGitTargetLineageLayer.pipe(
    Layer.provide(nodeGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const gitIntegratorCandidateLayer = nodeGitIntegratorCandidateLayer.pipe(
    Layer.provide(nodeGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const candidateAuthorityLayer = Layer.succeed(
    IntegratorCandidateProviderAuthority,
    IntegratorCandidateProviderAuthority.of(integratorCandidateProviderAuthority)
  )
  const cleanupBoundaryLayer = gitDispositionCleanupBoundaryLayer(target, candidateAuthorityLayer).pipe(
    Layer.provide(nodeGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const journalLayer = productionJournalStoreLayer.pipe(Layer.provide(ownershipLayer))
  const baseInterpreterLayer = workflowInterpreterLayer.pipe(
    Layer.provide(trackerMutationLayer),
    Layer.provide(gitTargetLineageLayer),
    Layer.provide(gitWorktreeLayer)
  )
  const executorWithAcceptedEvidence =
    acceptedResultEvidenceStore === undefined
      ? plannedAttemptExecutorLayer
      : plannedAttemptExecutorLayer.pipe(Layer.provide(Layer.succeed(EvidenceStore, acceptedResultEvidenceStore)))
  const applicationExitLayer = Layer.effect(
    ApplicationExitShell,
    Effect.gen(function* () {
      const ownership = yield* CoordinatorOwnership
      return yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
    })
  )
  const executorWithApplicationExit = executorWithAcceptedEvidence.pipe(Layer.provideMerge(applicationExitLayer))
  const nonJournaledRuntimeInputs = Layer.merge(baseInterpreterLayer, executorWithApplicationExit)

  return Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const crypto = yield* Crypto.Crypto
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const applicationExit = yield* ApplicationExitShell
      const runtimeLayer = ({ runId: activeRunId }: JournaledRuntimeLayerInput) => {
        const interpreterLayer = journaledWorkflowInterpreterLayer(
          activeRunId,
          Layer.succeed(WorkflowInterpreter, interpreter)
        )
        const operatorControlLayer = Layer.mergeAll(
          attemptChoiceControlLayer,
          controlDirectionApplicationLayer,
          taskClaimReacquisitionControlLayer,
          taskWorkCapacityControlLayer
        )
        return validatedRunActivationLayer(
          activeRunId,
          integrationTarget,
          targetPromotion,
          integrationFinality,
          completionTask,
          cleanupBoundaryLayer,
          acceptedResultEvidenceStore
        ).pipe(
          Layer.provide(interpreterLayer),
          Layer.provide(gitIntegratorCandidateLayer),
          Layer.provide(operatorControlLayer),
          Layer.provide(freshOperationIdAllocatorLayer.pipe(Layer.provide(Layer.succeed(Crypto.Crypto, crypto)))),
          Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace))
        )
      }
      return Layer.merge(
        journaledRunBootstrapLayer(runId, runtimeLayer, applicationExit).pipe(Layer.provide(journalLayer)),
        Layer.mergeAll(
          Layer.succeed(ApplicationExitRequestBoundary, applicationExit.requestBoundary),
          // Keep the process-wide shell available so Exit can invoke the
          // owner's process-local stop drain.
          Layer.succeed(ApplicationExitShell, applicationExit)
        )
      )
    })
  ).pipe(Layer.provide(nonJournaledRuntimeInputs), Layer.provide(ownershipLayer))
}
