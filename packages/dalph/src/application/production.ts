import { NodeServices } from "@effect/platform-node"
import { type IntegrationTarget, PlannedAttemptExecutor, type RunId } from "@dalph/contracts"
import {
  type JournaledRunObservationSource,
  AllocatedWorkflowRunId,
  JournaledRunBootstrap,
  type JournaledRuntimeLayerInput,
  type RunActivationOpportunityValue,
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
  GitCommand,
  type GitCommandService,
  journaledRunBootstrapLayer,
  journaledWorkflowInterpreterLayer,
  ApplicationExitRequestBoundary,
  CoordinatorOwnership,
  type JournalStore,
  type RunLifecycleJournal,
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
  Integrator,
  type IntegratorService,
  type TargetPromotionRuntimeInput,
  type CompletionClaimBoundaryService,
  type CompletionTaskBoundaryService,
  gitDispositionCleanupBoundaryLayer,
  IntegratorCandidateProviderAuthority,
  type IntegratorCandidateProviderAuthorityService,
  runReactivationOwnerLayer,
  runWorkflowWithActiveWorkAuthorityRefresh,
  runWorkflow,
  type InitialControlPolicySource,
  type CurrentSignal,
  type TrackerTarget,
  type RunRecoveryProjection,
  type TaskWorkCapacityControl,
  WorkflowRunAlreadyTerminated,
  defaultJournalMaintenanceObservation
} from "@dalph/orchestrator"
import type { FileSystem } from "effect"
import { Context, Crypto, Duration, Effect, Layer, Schema } from "effect"

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

// eslint-disable-next-line functional/no-mixed-types -- Production composition groups decoded timing and the typed failure observation boundary at one application seam.
export interface ProductionRunReactivationOptions {
  readonly activationInterval?: ProductionRunReactivationInterval
  readonly failureCooldown?: ProductionRunReactivationInterval
  /** Optional process-local timer lifecycle observation for diagnostics. */
  readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
  /** Optional host-owned current-first tracker notification adapter; values remain hints. */
  readonly trackerNotificationSource?: CurrentSignal<unknown>
  /** Required boundary for typed tracker/Git/journal failures; no activation failure is swallowed. */
  readonly onFailure: (failure: unknown) => Effect.Effect<void>
}

/** Optional production boundaries that advance one accepted result through delivery and finality. */
// eslint-disable-next-line functional/no-mixed-types -- Production qualification groups typed service values and one typed reconstruction observation callback.
export interface ProductionWorkflowRuntimeBoundaries {
  /** Already-acquired repository owner shared with host discovery and SQLite. */
  readonly coordinatorOwnership?: CoordinatorOwnership["Service"]
  /** Optional journal implementation for process-boundary acceptance tests. */
  readonly journalStoreLayer?: Layer.Layer<
    JournalStore | RunLifecycleJournal,
    Layer.Error<typeof productionJournalStoreLayer>,
    never
  >
  readonly targetPromotion?: TargetPromotionRuntimeInput
  readonly integrationFinality?: CompletionClaimBoundaryService
  readonly completionTask?: CompletionTaskBoundaryService
  readonly acceptedResultEvidenceStore?: EvidenceStoreService
  readonly integrator?: IntegratorService
  /** Optional qualification observation after the real Run recovery projection is built. */
  readonly onReconstructed?: (input: ProductionRunReconstructionObservation) => Effect.Effect<void>
  /** Side-effect-only observation of the actual workflow Git command service. */
  readonly workflowGitCommandObserver?: ProductionWorkflowGitCommandObserver
}

/** Names the concrete Git command method crossed by workflow worktree and lineage protocols. */
export type ProductionWorkflowGitCommand = "run" | "runInWorktree" | "runBytesInWorktree"

/** Qualification-only tap over the production workflow Git service; it cannot replace that service. */
export type ProductionWorkflowGitCommandObserver = (operation: ProductionWorkflowGitCommand) => Effect.Effect<void>

/** Services assembled from one validated journal prefix for qualification. */
export interface ProductionRunReconstructionObservation {
  readonly recovery: RunRecoveryProjection["Service"]
  readonly taskWorkCapacity: TaskWorkCapacityControl["Service"]
}

const observedWorkflowGitCommand = (service: GitCommandService, observe: ProductionWorkflowGitCommandObserver) =>
  GitCommand.of({
    ...service,
    run: (...args) => observe("run").pipe(Effect.andThen(service.run(...args))),
    runInWorktree: (...args) => observe("runInWorktree").pipe(Effect.andThen(service.runInWorktree(...args))),
    runBytesInWorktree: (...args) =>
      observe("runBytesInWorktree").pipe(Effect.andThen(service.runBytesInWorktree(...args)))
  })

const observedWorkflowGitCommandLayer = (observe: ProductionWorkflowGitCommandObserver | undefined) => {
  const layer = nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer))
  if (observe === undefined) return layer
  return Layer.fromBuildMemo((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      Effect.map((context) =>
        Context.add(context, GitCommand, observedWorkflowGitCommand(Context.get(context, GitCommand), observe))
      )
    )
  )
}

const defaultProductionRunReactivationCooldownSeconds = 5
const defaultProductionRunReactivationCooldown = ProductionRunReactivationInterval.make(
  Duration.seconds(defaultProductionRunReactivationCooldownSeconds)
)

const isWorkflowRunAlreadyTerminated = (failure: unknown): boolean => failure instanceof WorkflowRunAlreadyTerminated

/**
 * Supported production composition for one exact Run. It acquires one scoped
 * owner, re-enters the ordinary `runWorkflow` boundary for each hint/timer,
 * initializes pause state from the Journal, and wires accepted Run controls
 * only after their Journal append succeeds. The repository's CLI remains a
 * dry-run host; this Layer is the production application entry seam.
 */
export const productionRunReactivationLayer = <EInitial, RInitial>(
  target: TrackerTarget,
  initialControlPolicySource: InitialControlPolicySource<EInitial, RInitial>,
  runId: RunId,
  options: ProductionRunReactivationOptions
) => {
  const activation = (opportunity: RunActivationOpportunityValue) =>
    runWorkflow(target, initialControlPolicySource, AllocatedWorkflowRunId.make(runId), opportunity)
  const activateActiveWorkAuthorityRefresh = (source: "TrackerNotification" | "Timer") =>
    runWorkflowWithActiveWorkAuthorityRefresh(
      target,
      initialControlPolicySource,
      AllocatedWorkflowRunId.make(runId),
      source
    )
  const readControl = Effect.gen(function* () {
    const bootstrap = yield* JournaledRunBootstrap
    return yield* bootstrap.readRunReactivationControl(target, runId)
  })
  const ownerLayer = runReactivationOwnerLayer({
    activate: activation,
    activateActiveWorkAuthorityRefresh,
    activationInterval: options.activationInterval ?? defaultProductionRunReactivationInterval,
    failureCooldown: options.failureCooldown ?? defaultProductionRunReactivationCooldown,
    installAcceptedRunReactivationObservers: ({ acceptedFactPublication, control }) =>
      Effect.gen(function* () {
        const bootstrap = yield* JournaledRunBootstrap
        yield* bootstrap.registerAcceptedRunReactivationObservers({
          control,
          acceptedFactPublication: () => acceptedFactPublication
        })
      }),
    isTerminationFailure: isWorkflowRunAlreadyTerminated,
    onFailure: options.onFailure,
    readControl,
    runId,
    ...(options.onTimerStateChange === undefined ? {} : { onTimerStateChange: options.onTimerStateChange }),
    ...(options.trackerNotificationSource === undefined
      ? {}
      : { trackerNotificationSource: options.trackerNotificationSource })
  })
  return ownerLayer
}

/**
 * Composes live tracker/Git boundaries with the caller-selected executor
 * implementation through the ordinary Effect Layer environment.
 */
type ProductionWorkflowLayer<TrackerError, TrackerRequirements> = Layer.Layer<
  ApplicationExitRequestBoundary | ApplicationExitShell | JournaledRunBootstrap | JournaledRunObservationSource,
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
  runtimeBoundaries: ProductionWorkflowRuntimeBoundaries = {}
): ProductionWorkflowLayer<TrackerError, TrackerRequirements> => {
  const {
    acceptedResultEvidenceStore,
    completionTask,
    integrationFinality,
    integrator,
    onReconstructed,
    targetPromotion
  } = runtimeBoundaries
  const ownershipLayer =
    runtimeBoundaries.coordinatorOwnership === undefined
      ? productionCoordinatorOwnershipLayer(target)
      : Layer.succeed(CoordinatorOwnership, runtimeBoundaries.coordinatorOwnership)
  const workflowGitCommandLayer = observedWorkflowGitCommandLayer(runtimeBoundaries.workflowGitCommandObserver)
  const trackerMutationLayer = coordinatorOwnedTrackerMutationLayer(trackerMutationAdapterLayer).pipe(
    Layer.provide(ownershipLayer)
  )
  const gitWorktreeLayer = coordinatorOwnedGitWorktreeLayer(
    nodeGitWorktreeLayer(target).pipe(Layer.provide(workflowGitCommandLayer), Layer.provide(NodeServices.layer))
  ).pipe(Layer.provide(ownershipLayer))
  const gitTargetLineageLayer = nodeGitTargetLineageLayer.pipe(
    Layer.provide(workflowGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const gitIntegratorCandidateLayer = nodeGitIntegratorCandidateLayer.pipe(
    Layer.provide(workflowGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const candidateAuthorityLayer = Layer.succeed(
    IntegratorCandidateProviderAuthority,
    IntegratorCandidateProviderAuthority.of(integratorCandidateProviderAuthority)
  )
  const cleanupBoundaryLayer = gitDispositionCleanupBoundaryLayer(target, candidateAuthorityLayer).pipe(
    Layer.provide(workflowGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const journalLayer = (runtimeBoundaries.journalStoreLayer ?? productionJournalStoreLayer).pipe(
    Layer.provide(ownershipLayer)
  )
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
  const integratorLayer = integrator === undefined ? Layer.empty : Layer.succeed(Integrator, Integrator.of(integrator))
  const nonJournaledRuntimeInputs = Layer.merge(baseInterpreterLayer, executorWithApplicationExit)

  return Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const crypto = yield* Crypto.Crypto
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const applicationExit = yield* ApplicationExitShell
      const runtimeLayer = ({ opportunity, runId: activeRunId }: JournaledRuntimeLayerInput) => {
        const interpreterLayer = journaledWorkflowInterpreterLayer(
          activeRunId,
          Layer.succeed(WorkflowInterpreter, interpreter),
          opportunity
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
          acceptedResultEvidenceStore,
          true,
          opportunity,
          onReconstructed
        ).pipe(
          Layer.provide(integratorLayer),
          Layer.provide(interpreterLayer),
          Layer.provide(gitIntegratorCandidateLayer),
          Layer.provide(operatorControlLayer),
          Layer.provide(freshOperationIdAllocatorLayer.pipe(Layer.provide(Layer.succeed(Crypto.Crypto, crypto)))),
          Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace))
        )
      }
      return Layer.merge(
        journaledRunBootstrapLayer(runId, runtimeLayer, applicationExit, defaultJournalMaintenanceObservation).pipe(
          Layer.provide(journalLayer)
        ),
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
