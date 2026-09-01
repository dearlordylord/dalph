/* eslint-disable max-lines -- Production workflow assembly keeps its capability topology co-located for auditability. */
import { NodeServices } from "@effect/platform-node"
import { type IntegrationTarget, PlannedAttemptExecutor, type RunId } from "@dalph/contracts"
import {
  type JournaledRunObservationSource,
  type ApplicationExitTraceEvent,
  type ApplicationProcessEndDecision,
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
  BranchCleanupBoundary,
  IntegratorCandidateCleanupBoundary,
  ApplicationExitShell,
  type ProductionHostApplicationExitShellService,
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
  WorktreeCleanupBoundary,
  TaskTrackerMutationThrottled,
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
  /** Optional process-local activation-finalization observation for diagnostics. */
  readonly onActivationFinalizationStart?: (kind: "Ordinary" | "ActiveWorkAuthorityRefresh") => Effect.Effect<void>
  /** Optional host-owned current-first tracker notification adapter; values remain hints. */
  readonly trackerNotificationSource?: CurrentSignal<unknown>
  /** Required observation of every typed tracker/Git/journal failure; no activation failure is swallowed. */
  readonly onFailure: ProductionRunReactivationFailureObserver
  /** Optional separate channel for the exact failure that must escape the host. */
  readonly onNonRetryableFailure?: (failure: TaskTrackerMutationThrottled) => Effect.Effect<void>
}

/** Observes every typed failure while the process-local Run owner cools down or stops. */
export type ProductionRunReactivationFailureObserver = (failure: unknown) => Effect.Effect<void>

/** Concrete cleanup boundary call used by host qualification observers. */
export type ProductionWorkflowCleanupBoundary =
  | "worktree.observe"
  | "worktree.remove"
  | "branch.observe"
  | "branch.remove"
  | "candidate.observe"
  | "candidate.remove"

/** Side-effect-only observation of the real disposition cleanup services. */
export type ProductionWorkflowCleanupObserver = (boundary: ProductionWorkflowCleanupBoundary) => Effect.Effect<void>

/** Side-effect-only observation of a direct application Exit request. */
export type ProductionApplicationExitRequestObserver = () => Effect.Effect<void>

/** Side-effect-only observation of the process-end boundary called by Exit. */
export type ProductionApplicationProcessEndObserver = (decision: ApplicationProcessEndDecision) => Effect.Effect<void>

/** Side-effect-only observation of lifecycle trace events emitted by Exit. */
export type ProductionApplicationExitTraceObserver = (event: ApplicationExitTraceEvent) => Effect.Effect<void>

/**
 * The production workflow either receives one already-constructed host-scoped
 * shell or constructs one ordinary shell with its process-local observers.
 * Keeping these as tagged variants prevents a supplied host shell from being
 * paired with observer fields that the workflow would silently ignore.
 */
export type ProductionWorkflowApplicationExitBoundary =
  | { readonly _tag: "SuppliedHostShell"; readonly shell: ProductionHostApplicationExitShellService }
  | {
      readonly _tag: "ConstructOrdinaryShell"
      readonly requestObserver?: ProductionApplicationExitRequestObserver
      readonly processEndObserver?: ProductionApplicationProcessEndObserver
      readonly traceObserver?: ProductionApplicationExitTraceObserver
    }

/** Optional production boundaries that advance one accepted result through delivery and finality. */
// eslint-disable-next-line functional/no-mixed-types -- Production qualification groups typed service values and one typed reconstruction observation callback.
export interface ProductionWorkflowRuntimeBoundaries {
  /** Already-acquired repository owner shared with host discovery and SQLite. */
  readonly coordinatorOwnership?: CoordinatorOwnership["Service"]
  /** One explicit application Exit construction topology; host shells carry no ordinary observers. */
  readonly applicationExit?: ProductionWorkflowApplicationExitBoundary
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
  /** Qualification-only observation of the one host-owned Exit shell at workflow acquisition. */
  readonly onApplicationExitShell?: (applicationExit: ApplicationExitShell["Service"]) => Effect.Effect<void>
  /** Side-effect-only observation of the actual workflow Git command service. */
  readonly workflowGitCommandObserver?: ProductionWorkflowGitCommandObserver
  /** Optional direct observation of disposition cleanup boundary calls. */
  readonly workflowCleanupObserver?: ProductionWorkflowCleanupObserver
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

const observedWorktreeCleanup = (
  service: WorktreeCleanupBoundary["Service"],
  observe: ProductionWorkflowCleanupObserver
) =>
  WorktreeCleanupBoundary.of({
    ...service,
    observe: (...args) => observe("worktree.observe").pipe(Effect.andThen(service.observe(...args))),
    remove: (...args) => observe("worktree.remove").pipe(Effect.andThen(service.remove(...args)))
  })

const observedBranchCleanup = (service: BranchCleanupBoundary["Service"], observe: ProductionWorkflowCleanupObserver) =>
  BranchCleanupBoundary.of({
    ...service,
    observe: (...args) => observe("branch.observe").pipe(Effect.andThen(service.observe(...args))),
    remove: (...args) => observe("branch.remove").pipe(Effect.andThen(service.remove(...args)))
  })

const observedCandidateCleanup = (
  service: IntegratorCandidateCleanupBoundary["Service"],
  observe: ProductionWorkflowCleanupObserver
) =>
  IntegratorCandidateCleanupBoundary.of({
    ...service,
    observe: (...args) => observe("candidate.observe").pipe(Effect.andThen(service.observe(...args))),
    remove: (...args) => observe("candidate.remove").pipe(Effect.andThen(service.remove(...args)))
  })

const observedWorkflowCleanupLayer = <E, R>(
  layer: Layer.Layer<WorktreeCleanupBoundary | BranchCleanupBoundary | IntegratorCandidateCleanupBoundary, E, R>,
  observe: ProductionWorkflowCleanupObserver | undefined
) => {
  if (observe === undefined) return layer
  return Layer.fromBuildMemo((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      Effect.map((context) =>
        Context.add(
          Context.add(
            Context.add(
              context,
              WorktreeCleanupBoundary,
              observedWorktreeCleanup(Context.get(context, WorktreeCleanupBoundary), observe)
            ),
            BranchCleanupBoundary,
            observedBranchCleanup(Context.get(context, BranchCleanupBoundary), observe)
          ),
          IntegratorCandidateCleanupBoundary,
          observedCandidateCleanup(Context.get(context, IntegratorCandidateCleanupBoundary), observe)
        )
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
 * A provider-throttled task mutation is the one activation failure that must
 * stop this process-local owner and escape the host. Other tracker, Git,
 * Journal, and executor failures remain ordinary #218 cooldown observations.
 */
export const isNonRetryableProductionActivationFailure = (failure: unknown): failure is TaskTrackerMutationThrottled =>
  failure instanceof TaskTrackerMutationThrottled

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
    isNonRetryableFailure: isNonRetryableProductionActivationFailure,
    onFailure: (failure) =>
      options
        .onFailure(failure)
        .pipe(
          Effect.andThen(
            isNonRetryableProductionActivationFailure(failure)
              ? (options.onNonRetryableFailure?.(failure) ?? Effect.void)
              : Effect.void
          )
        ),
    readControl,
    runId,
    ...(options.onActivationFinalizationStart === undefined
      ? {}
      : { onActivationFinalizationStart: options.onActivationFinalizationStart }),
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
  const cleanupBoundaryLayer = observedWorkflowCleanupLayer(
    gitDispositionCleanupBoundaryLayer(target, candidateAuthorityLayer),
    runtimeBoundaries.workflowCleanupObserver
  ).pipe(Layer.provide(workflowGitCommandLayer), Layer.provide(NodeServices.layer))
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
  const applicationExitLayer =
    runtimeBoundaries.applicationExit === undefined ||
    runtimeBoundaries.applicationExit._tag === "ConstructOrdinaryShell"
      ? Layer.effect(
          ApplicationExitShell,
          Effect.gen(function* () {
            const ownership = yield* CoordinatorOwnership
            const processLifecycle = {
              requestEnd: (decision: ApplicationProcessEndDecision) =>
                runtimeBoundaries.applicationExit?._tag === "ConstructOrdinaryShell"
                  ? (runtimeBoundaries.applicationExit.processEndObserver?.(decision) ?? Effect.void)
                  : Effect.void
            }
            const trace =
              runtimeBoundaries.applicationExit?._tag !== "ConstructOrdinaryShell" ||
              runtimeBoundaries.applicationExit.traceObserver === undefined
                ? undefined
                : { emit: runtimeBoundaries.applicationExit.traceObserver }
            const applicationExit = yield* makeApplicationExitShell(ownership, processLifecycle, trace)
            const requestBoundary =
              runtimeBoundaries.applicationExit?._tag !== "ConstructOrdinaryShell" ||
              runtimeBoundaries.applicationExit.requestObserver === undefined
                ? applicationExit.requestBoundary
                : {
                    requestExit: runtimeBoundaries.applicationExit
                      .requestObserver()
                      .pipe(Effect.andThen(applicationExit.requestBoundary.requestExit))
                  }
            return { ...applicationExit, requestBoundary }
          })
        )
      : // A host supplies the already-constructed host-scoped shell. Retain
        // this exact object for workflow and Codex instead of decorating it or
        // introducing a second shell; its construction owns request/trace taps.
        Layer.succeed(ApplicationExitShell, runtimeBoundaries.applicationExit.shell)
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
      if (runtimeBoundaries.onApplicationExitShell !== undefined) {
        yield* runtimeBoundaries.onApplicationExitShell(applicationExit)
      }
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
