/* eslint-disable max-lines -- Production host composition keeps one scoped lifecycle and its qualification seams auditable. */
import { NodeCrypto, NodeHttpClient, NodeServices } from "@effect/platform-node"
import { IntegrationTarget, PlannedAttemptExecutor } from "@dalph/contracts"
import {
  type GithubGraphqlClient,
  type RunReactivationOwner,
  type ApplicationExitRequestBoundaryService,
  type ApplicationExitShellService,
  ApplicationExitShell,
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  CoordinatorOwnership,
  type CurrentSignal,
  type DeliveryRuntimeObservationState,
  EvidenceStore,
  type EvidenceStoreService,
  GitCommonDirectoryTarget,
  GitCommand,
  type GitCommandService,
  InitialControlPolicy,
  Integrator,
  IntegratorCandidateProviderAuthority,
  JournaledRunObservationSource,
  JournalStore,
  RunLifecycleJournal,
  type TaskTrackerMutationThrottled,
  TrackerGraphReader,
  TrackerMutation,
  WorkflowTrace,
  githubDeliveryAuthorityLayer,
  githubGraphqlClientLayer,
  journalStoreCapabilities,
  nodeEvidenceStoreLayer,
  nodeGitCommandLayer,
  productionCoordinatorOwnershipLayer,
  sqliteJournalStoreLayer,
  taskClaimAcquisitionPlannerLayer,
  type ProductionRunSelection,
  type TraceCursor,
  makeApplicationExitShell,
  selectProductionRun
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Layer } from "effect"
import type { CodexAppServer } from "./codex-app-server.js"
import { codexAppServerNodeLayer, nodeCodexOwnedActivityCensusLayer } from "./codex-app-server.js"
import { nodeCodexAttemptStoreLayer } from "./codex-attempt-store.js"
import { nodeCodexPlannedAttemptExecutorLayer } from "./codex-planned-attempt-executor.js"
import { nodeCodexIntegratorLayer } from "./codex-integrator.js"
import { CodexIntegratorConfiguration } from "./codex-integrator-private-store.js"
import {
  type ProductionRepositoryHostConfiguration,
  decodeProductionRepositoryHostConfiguration,
  productionPlannedTaskAttemptLayer
} from "./production-configuration.js"
import {
  productionRunReactivationLayer,
  productionWorkflowInterpreterLayer,
  type ProductionApplicationExitRequestObserver,
  type ProductionApplicationExitTraceObserver,
  type ProductionApplicationProcessEndObserver,
  type ProductionWorkflowCleanupObserver,
  type ProductionWorkflowGitCommandObserver,
  type ProductionRunReconstructionObservation
} from "./production.js"

/** Process-local signals and the host-owned lifecycle boundary exposed after one exact Run beginning is acknowledged. */
export interface ProductionHostObservation {
  readonly acceptedHistory: CurrentSignal<TraceCursor>
  readonly current: CurrentSignal<DeliveryRuntimeObservationState>
  readonly selection: ProductionRunSelection
  /** Transport-neutral lifecycle request shared with the configured host scope. */
  readonly applicationExitRequestBoundary: ApplicationExitRequestBoundaryService
}

type ProductionHostFoundation = CoordinatorOwnership | JournalStore | RunLifecycleJournal

/** Concrete live boundaries that qualification may observe without replacing. */
export type ProductionRepositoryHostBoundary =
  | "coordinator.acquire"
  | "journal.sqlite.open"
  | "evidence.acquire"
  | "evidence.put"
  | "git.acquire"
  | "git.run"
  | "git.runInWorktree"
  | "git.runBytesInWorktree"
  | "executor.acquire"
  | "executor.observe"
  | "executor.begin"
  | "executor.requestSuspension"
  | "executor.resume"
  | "github.authority.acquire"
  | "integrator.acquire"
  | "integrator.prepare"

/** A side-effect-only tap; it cannot provide a service or alter production authority. */
export type ProductionRepositoryHostBoundaryObserver = (
  boundary: ProductionRepositoryHostBoundary
) => Effect.Effect<void>

/** Qualification-only observation of the workflow's host-owned Exit shell. */
type ProductionRepositoryHostApplicationExitObserver = (
  applicationExit: ApplicationExitShellService
) => Effect.Effect<void>

/**
 * Builds the live repository owner and Journal before selection, then builds
 * the one exact Run graph from those same scoped service instances.
 */
export interface ProductionRepositoryHostGraph<EFoundation, RFoundation, ERun, RRun, EActivation> {
  readonly foundation: (
    configuration: ProductionRepositoryHostConfiguration
  ) => Layer.Layer<ProductionHostFoundation, EFoundation, RFoundation>
  readonly run: (
    configuration: ProductionRepositoryHostConfiguration,
    selection: ProductionRunSelection,
    onFailure: (failure: EActivation) => Effect.Effect<void>,
    applicationExit: ApplicationExitShellService
  ) => Layer.Layer<JournaledRunObservationSource | RunReactivationOwner, ERun, ProductionHostFoundation | RRun>
}

/** Network and process edge substitutions used by hermetic host qualification. */
// eslint-disable-next-line functional/no-mixed-types -- The qualification seam groups edge factories with a non-authoritative observation tap.
export interface ProductionRepositoryHostAdapters<ECodex = never, EGithub = never, ETrace = never> {
  /** Optional side-effect-only observation of real production boundary activity. */
  readonly boundaryObserver?: ProductionRepositoryHostBoundaryObserver
  /** Optional observation after the real in-Run recovery projection is assembled. */
  readonly onReconstructed?: (input: ProductionRunReconstructionObservation) => Effect.Effect<void>
  /** Optional observation of every typed tracker/Git/journal reactivation failure. */
  readonly onActivationFailure?: (failure: unknown) => Effect.Effect<void>
  /** Optional observation of the same host Exit shell at workflow acquisition. */
  readonly workflowApplicationExitObserver?: ProductionRepositoryHostApplicationExitObserver
  /** Optional observation of concrete Git methods used by the workflow protocols. */
  readonly workflowGitCommandObserver?: ProductionWorkflowGitCommandObserver
  /** Optional direct observation of ApplicationExitRequestBoundary.requestExit. */
  readonly applicationExitRequestObserver?: ProductionApplicationExitRequestObserver
  /** Optional direct observation of ApplicationProcessLifecycle.requestEnd. */
  readonly applicationProcessEndObserver?: ProductionApplicationProcessEndObserver
  /** Optional direct observation of graceful application lifecycle results/events. */
  readonly applicationExitTraceObserver?: ProductionApplicationExitTraceObserver
  /** Optional direct observation of workflow disposition cleanup calls. */
  readonly workflowCleanupObserver?: ProductionWorkflowCleanupObserver
  /** Optional observation of the process-local timer lifecycle. */
  readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
  /** Optional observation of each admitted activation finalization. */
  readonly onActivationFinalizationStart?: (kind: "Ordinary" | "ActiveWorkAuthorityRefresh") => Effect.Effect<void>
  readonly codexAppServer?: (
    configuration: ProductionRepositoryHostConfiguration
  ) => Layer.Layer<CodexAppServer, ECodex>
  readonly githubClient?: (
    configuration: ProductionRepositoryHostConfiguration
  ) => Layer.Layer<GithubGraphqlClient, EGithub>
  readonly workflowTrace?: () => Layer.Layer<WorkflowTrace, ETrace>
}

const defaultWorkflowTraceLayer = Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))

const defaultGithubClientLayer = (configuration: ProductionRepositoryHostConfiguration) =>
  githubGraphqlClientLayer({ token: configuration.githubToken }).pipe(Layer.provide(NodeHttpClient.layerUndici))

const defaultCodexAppServerLayer = (
  configuration: ProductionRepositoryHostConfiguration,
  attemptStore: ReturnType<typeof nodeCodexAttemptStoreLayer>
) => {
  return codexAppServerNodeLayer({
    executable: configuration.codexExecutable,
    clientName: configuration.codexClientName,
    clientVersion: configuration.codexClientVersion,
    modelProvider: configuration.codexProvider,
    providerCredential: configuration.codexProviderCredential,
    environment: { CODEX_HOME: configuration.codexStateDirectory }
  }).pipe(Layer.provide(attemptStore), Layer.provide(NodeServices.layer))
}

const observedLayerBuild = <A, E, R>(
  layer: Layer.Layer<A, E, R>,
  boundary: ProductionRepositoryHostBoundary,
  observe: ProductionRepositoryHostBoundaryObserver | undefined
) => {
  if (observe === undefined) return layer
  return layer.pipe(Layer.tap(() => observe(boundary)))
}

const observedGitCommand = (service: GitCommandService, observe: ProductionRepositoryHostBoundaryObserver) =>
  GitCommand.of({
    ...service,
    run: (...args) => observe("git.run").pipe(Effect.andThen(service.run(...args))),
    runInWorktree: (...args) => observe("git.runInWorktree").pipe(Effect.andThen(service.runInWorktree(...args))),
    runBytesInWorktree: (...args) =>
      observe("git.runBytesInWorktree").pipe(Effect.andThen(service.runBytesInWorktree(...args)))
  })

const observedGitCommandLayer = <E, R>(
  layer: Layer.Layer<GitCommand, E, R>,
  observe: ProductionRepositoryHostBoundaryObserver | undefined
) => {
  if (observe === undefined) return layer
  return Layer.fromBuildMemo((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      Effect.flatMap((context) =>
        observe("git.acquire").pipe(
          Effect.as(Context.add(context, GitCommand, observedGitCommand(Context.get(context, GitCommand), observe)))
        )
      )
    )
  )
}

const observedEvidenceStore = (service: EvidenceStoreService, observe: ProductionRepositoryHostBoundaryObserver) =>
  EvidenceStore.of({ ...service, put: (bytes) => observe("evidence.put").pipe(Effect.andThen(service.put(bytes))) })

const observedEvidenceStoreLayer = <E, R>(
  layer: Layer.Layer<EvidenceStore, E, R>,
  observe: ProductionRepositoryHostBoundaryObserver | undefined
) => {
  if (observe === undefined) return layer
  return Layer.fromBuildMemo((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      Effect.flatMap((context) =>
        observe("evidence.acquire").pipe(
          Effect.as(
            Context.add(context, EvidenceStore, observedEvidenceStore(Context.get(context, EvidenceStore), observe))
          )
        )
      )
    )
  )
}

const observedPlannedAttemptExecutor = (
  service: PlannedAttemptExecutor["Service"],
  observe: ProductionRepositoryHostBoundaryObserver
) =>
  PlannedAttemptExecutor.of({
    ...service,
    observe: (...args) => observe("executor.observe").pipe(Effect.andThen(service.observe(...args))),
    begin: (...args) => observe("executor.begin").pipe(Effect.andThen(service.begin(...args))),
    requestSuspension: (...args) =>
      observe("executor.requestSuspension").pipe(Effect.andThen(service.requestSuspension(...args))),
    resume: (...args) => observe("executor.resume").pipe(Effect.andThen(service.resume(...args)))
  })

const observedPlannedAttemptExecutorLayer = <E, R>(
  layer: Layer.Layer<PlannedAttemptExecutor, E, R>,
  observe: ProductionRepositoryHostBoundaryObserver | undefined
) => {
  if (observe === undefined) return layer
  return Layer.fromBuildMemo((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      Effect.flatMap((context) =>
        observe("executor.acquire").pipe(
          Effect.as(
            Context.add(
              context,
              PlannedAttemptExecutor,
              observedPlannedAttemptExecutor(Context.get(context, PlannedAttemptExecutor), observe)
            )
          )
        )
      )
    )
  )
}

const observedIntegrator = (service: Integrator["Service"], observe: ProductionRepositoryHostBoundaryObserver) =>
  Integrator.of({
    ...service,
    prepare: (...args) => observe("integrator.prepare").pipe(Effect.andThen(service.prepare(...args)))
  })

const observedIntegratorLayer = <E, R>(
  layer: Layer.Layer<Integrator | IntegratorCandidateProviderAuthority, E, R>,
  observe: ProductionRepositoryHostBoundaryObserver | undefined
) => {
  if (observe === undefined) return layer
  return Layer.fromBuildMemo((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      Effect.flatMap((context) =>
        observe("integrator.acquire").pipe(
          Effect.as(Context.add(context, Integrator, observedIntegrator(Context.get(context, Integrator), observe)))
        )
      )
    )
  )
}

/**
 * Keeps the coordinator lock held until the host scope closes after its caller
 * has received the lifecycle result. The application shell still owns the
 * decision and bounded drain; scope finalization owns the final lock release.
 */
const makeHostApplicationExitShell = Effect.fn("ProductionRepositoryHost.makeApplicationExitShell")(function* (
  ownership: CoordinatorOwnership["Service"],
  processLifecycle: Parameters<typeof makeApplicationExitShell>[1],
  onExitResultObserved: Effect.Effect<void>
) {
  const shell = yield* makeApplicationExitShell(
    ownership,
    processLifecycle,
    { emit: () => Effect.void },
    { coordinatorLockRelease: "HostScopeFinalization", onExitResultObserved }
  )
  return shell
})

/**
 * Complete production repository graph. Optional adapters replace only named
 * network or process edges for qualification; the mutation capability topology,
 * one shared Codex service, and Run chronology remain unchanged. The optional
 * boundary observer only taps those real production services.
 */
export const productionRepositoryHostGraph = <ECodex = never, EGithub = never, ETrace = never>(
  adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace> = {}
) => ({
  foundation: (configuration: ProductionRepositoryHostConfiguration) => {
    const ownership = observedLayerBuild(
      productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(configuration.commonDirectory)).pipe(
        Layer.provide(NodeServices.layer)
      ),
      "coordinator.acquire",
      adapters.boundaryObserver
    )
    const journalLayer = observedLayerBuild(
      sqliteJournalStoreLayer({ filename: configuration.journalDatabase }),
      "journal.sqlite.open",
      adapters.boundaryObserver
    )
    const journal = journalStoreCapabilities(journalLayer)
    return journal.pipe(Layer.provideMerge(ownership))
  },
  run: (
    configuration: ProductionRepositoryHostConfiguration,
    selection: ProductionRunSelection,
    onFailure: (failure: TaskTrackerMutationThrottled) => Effect.Effect<void>,
    applicationExit: ApplicationExitShellService
  ) =>
    Layer.unwrap(
      // eslint-disable-next-line complexity -- One production graph resolves optional edge adapters and observation while preserving one scoped service topology.
      Effect.gen(function* () {
        const ownership = yield* CoordinatorOwnership
        const journal = yield* JournalStore
        const lifecycle = yield* RunLifecycleJournal
        const workflowApplicationExitObserver = adapters.workflowApplicationExitObserver
        /* v8 ignore start -- @preserve Hermetic host tests replace the live GitHub boundary; this assignment retains the production-only provider default. */
        const githubClientLayer = adapters.githubClient?.(configuration) ?? defaultGithubClientLayer(configuration)
        /* v8 ignore stop */
        const githubAuthorityLayer = observedLayerBuild(
          githubDeliveryAuthorityLayer.pipe(Layer.provide(githubClientLayer), Layer.provide(NodeCrypto.layer)),
          "github.authority.acquire",
          adapters.boundaryObserver
        )
        const evidenceLayer = observedEvidenceStoreLayer(
          nodeEvidenceStoreLayer(configuration.evidenceStoreRoot).pipe(Layer.provide(NodeServices.layer)),
          adapters.boundaryObserver
        )
        const attemptStoreLayer = nodeCodexAttemptStoreLayer({
          stateDirectory: configuration.codexStateDirectory
        }).pipe(Layer.provide(NodeServices.layer))
        const appLayerWithoutApplicationExit: Layer.Layer<
          CodexAppServer,
          ECodex | Layer.Error<ReturnType<typeof defaultCodexAppServerLayer>>,
          ApplicationExitShell
        > = adapters.codexAppServer?.(configuration) ?? defaultCodexAppServerLayer(configuration, attemptStoreLayer)
        const appLayer: Layer.Layer<
          CodexAppServer,
          ECodex | Layer.Error<ReturnType<typeof defaultCodexAppServerLayer>>
        > = appLayerWithoutApplicationExit.pipe(Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)))
        const gitCommandLayer = observedGitCommandLayer(
          nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer)),
          adapters.boundaryObserver
        )
        const activityCensusLayer = nodeCodexOwnedActivityCensusLayer.pipe(Layer.provide(appLayer))
        const executorLayer = observedPlannedAttemptExecutorLayer(
          nodeCodexPlannedAttemptExecutorLayer.pipe(
            Layer.provide(appLayer),
            Layer.provide(activityCensusLayer),
            Layer.provide(attemptStoreLayer),
            Layer.provide(evidenceLayer),
            Layer.provide(gitCommandLayer),
            Layer.provide(NodeCrypto.layer),
            Layer.provide(NodeServices.layer)
          ),
          adapters.boundaryObserver
        )
        const integratorConfiguration = CodexIntegratorConfiguration.make({
          candidateWorktreeRoot: configuration.integratorCandidateWorktreeRoot,
          commonDirectory: configuration.commonDirectory,
          privateStoreLocator: configuration.integratorPrivateStore,
          repository: configuration.repository
        })
        const integratorLayer = observedIntegratorLayer(
          nodeCodexIntegratorLayer(integratorConfiguration).pipe(
            Layer.provide(appLayer),
            Layer.provide(activityCensusLayer),
            Layer.provide(gitCommandLayer),
            Layer.provide(NodeServices.layer),
            Layer.provide(Layer.succeed(CoordinatorOwnership, ownership))
          ),
          adapters.boundaryObserver
        )
        const sharedServices = Layer.mergeAll(
          githubAuthorityLayer,
          evidenceLayer,
          executorLayer,
          integratorLayer,
          adapters.workflowTrace?.() ?? defaultWorkflowTraceLayer
        )
        const services = yield* Layer.build(sharedServices)
        const tracker = Context.get(services, TrackerMutation)
        const trackerReader = Context.get(services, TrackerGraphReader)
        const completionClaim = Context.get(services, CompletionClaimBoundary)
        const completionTask = Context.get(services, CompletionTaskBoundary)
        const evidence = Context.get(services, EvidenceStore)
        const executor = Context.get(services, PlannedAttemptExecutor)
        const integrator = Context.get(services, Integrator)
        const candidateAuthority = Context.get(services, IntegratorCandidateProviderAuthority)
        const trace = Context.get(services, WorkflowTrace)
        const journalLayer = Layer.merge(
          Layer.succeed(JournalStore, journal),
          Layer.succeed(RunLifecycleJournal, lifecycle)
        )
        const planningLayer = Layer.merge(
          productionPlannedTaskAttemptLayer(configuration, selection.runId),
          taskClaimAcquisitionPlannerLayer(configuration.claimOwner).pipe(Layer.provide(NodeCrypto.layer))
        )
        const workflowLayer = productionWorkflowInterpreterLayer(
          selection.runId,
          GitCommonDirectoryTarget.make(configuration.commonDirectory),
          IntegrationTarget.make({ repository: configuration.repository, ref: configuration.integrationRef }),
          Layer.succeed(TrackerMutation, tracker),
          Layer.succeed(PlannedAttemptExecutor, executor),
          candidateAuthority,
          {
            acceptedResultEvidenceStore: evidence,
            completionTask,
            coordinatorOwnership: ownership,
            integrationFinality: completionClaim,
            integrator,
            journalStoreLayer: journalLayer,
            ...(adapters.applicationExitRequestObserver === undefined
              ? {}
              : { applicationExitRequestObserver: adapters.applicationExitRequestObserver }),
            ...(adapters.applicationProcessEndObserver === undefined
              ? {}
              : { applicationProcessEndObserver: adapters.applicationProcessEndObserver }),
            ...(adapters.applicationExitTraceObserver === undefined
              ? {}
              : { applicationExitTraceObserver: adapters.applicationExitTraceObserver }),
            applicationExit,
            ...(workflowApplicationExitObserver === undefined
              ? {}
              : { onApplicationExitShell: workflowApplicationExitObserver }),
            ...(adapters.onReconstructed === undefined ? {} : { onReconstructed: adapters.onReconstructed }),
            ...(adapters.workflowCleanupObserver === undefined
              ? {}
              : { workflowCleanupObserver: adapters.workflowCleanupObserver }),
            ...(adapters.workflowGitCommandObserver === undefined
              ? {}
              : { workflowGitCommandObserver: adapters.workflowGitCommandObserver })
          }
        ).pipe(
          Layer.provide(Layer.succeed(TrackerGraphReader, trackerReader)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace)),
          Layer.provide(planningLayer),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(NodeServices.layer)
        )
        return productionRunReactivationLayer(
          configuration.target,
          Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: configuration.taskWorkCapacity })),
          selection.runId,
          {
            activationInterval: configuration.activationInterval,
            failureCooldown: configuration.failureCooldown,
            ...(adapters.onActivationFinalizationStart === undefined
              ? {}
              : { onActivationFinalizationStart: adapters.onActivationFinalizationStart }),
            ...(adapters.onTimerStateChange === undefined ? {} : { onTimerStateChange: adapters.onTimerStateChange }),
            onFailure: adapters.onActivationFailure ?? (() => Effect.void),
            onNonRetryableFailure: onFailure
          }
        ).pipe(
          Layer.provide(planningLayer),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(NodeServices.layer),
          Layer.provideMerge(workflowLayer)
        )
      })
    )
})

/**
 * Alice invokes one configured production host. Configuration is decoded
 * before live acquisition; the callback receives a scoped observation only
 * after the selected Run's durable beginning has been acknowledged.
 */
export const withProductionRepositoryHost = <A, EUse, RUse, EFoundation, RFoundation, ERun, RRun, EActivation>(
  input: unknown,
  graph: ProductionRepositoryHostGraph<EFoundation, RFoundation, ERun, RRun, EActivation>,
  use: (observation: ProductionHostObservation) => Effect.Effect<A, EUse, RUse>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const configuration = yield* decodeProductionRepositoryHostConfiguration(input)
      const foundation = yield* Layer.build(graph.foundation(configuration))
      const selection = yield* selectProductionRun(configuration.target).pipe(Effect.provide(foundation))
      const hostStopRequested = yield* Deferred.make<void>()
      const hostResultObserved = yield* Deferred.make<void>()
      const applicationExit = yield* makeHostApplicationExitShell(
        Context.get(foundation, CoordinatorOwnership),
        {
          requestEnd: () =>
            Effect.yieldNow.pipe(
              Effect.andThen(Deferred.succeed(hostStopRequested, undefined)),
              Effect.asVoid,
              Effect.forkDetach,
              Effect.asVoid
            )
        },
        Deferred.succeed(hostResultObserved, undefined).pipe(Effect.asVoid)
      )
      const activationFailure = yield* Deferred.make<never, EActivation>()
      const run = yield* Layer.build(
        graph.run(
          configuration,
          selection,
          (failure) => Deferred.fail(activationFailure, failure).pipe(Effect.asVoid),
          applicationExit
        )
      ).pipe(Effect.provide(foundation))
      const source = Context.get(run, JournaledRunObservationSource)
      yield* Effect.raceFirst(source.awaitEstablished, Deferred.await(activationFailure))
      const observation = {
        acceptedHistory: source.acceptedHistory,
        current: source.current,
        selection,
        applicationExitRequestBoundary: applicationExit.requestBoundary
      } satisfies ProductionHostObservation
      // A typed activation failure can arrive after the Run has been
      // established. Keep the host effect attached to that failure so the
      // outer scope closes ordinary process-local resources without turning
      // the failure into Run finality, Exit, or a host retry. A supervisor
      // Exit request follows the same serving race after its result is
      // observed, then closes the Run and foundation scopes.
      return yield* Effect.raceFirst(
        Effect.raceFirst(
          use(observation),
          Deferred.await(hostStopRequested).pipe(
            Effect.andThen(Deferred.await(hostResultObserved)),
            Effect.andThen(Effect.yieldNow),
            Effect.andThen(Effect.interrupt)
          )
        ),
        Deferred.await(activationFailure)
      )
    })
  )
