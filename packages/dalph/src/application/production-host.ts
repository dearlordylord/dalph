import { NodeCrypto, NodeHttpClient, NodeServices } from "@effect/platform-node"
import { IntegrationTarget, PlannedAttemptExecutor } from "@dalph/contracts"
import {
  type GithubGraphqlClient,
  type RunReactivationOwner,
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  CoordinatorOwnership,
  type CurrentSignal,
  type DeliveryRuntimeObservationState,
  EvidenceStore,
  GitCommonDirectoryTarget,
  type GitCommand,
  InitialControlPolicy,
  Integrator,
  IntegratorCandidateProviderAuthority,
  JournaledRunObservationSource,
  JournalStore,
  RunLifecycleJournal,
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
import { productionRunReactivationLayer, productionWorkflowInterpreterLayer } from "./production.js"

/** Passive process-local state exposed only after one exact Run beginning is acknowledged. */
export interface ProductionHostObservation {
  readonly acceptedHistory: CurrentSignal<TraceCursor>
  readonly current: CurrentSignal<DeliveryRuntimeObservationState>
  readonly selection: ProductionRunSelection
}

type ProductionHostFoundation = CoordinatorOwnership | JournalStore | RunLifecycleJournal

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
    onFailure: (failure: EActivation) => Effect.Effect<void>
  ) => Layer.Layer<JournaledRunObservationSource | RunReactivationOwner, ERun, ProductionHostFoundation | RRun>
}

/** Low-level boundary substitution used by hermetic host qualification. */
export interface ProductionRepositoryHostAdapters<ECodex = never, EGithub = never, ETrace = never> {
  /**
   * Optional journal layer wrapper for qualification. The supplied default
   * remains the SQLite-backed production layer.
   */
  readonly journalStore?: (
    configuration: ProductionRepositoryHostConfiguration,
    defaultLayer: ReturnType<typeof sqliteJournalStoreLayer>
  ) => ReturnType<typeof sqliteJournalStoreLayer>
  /** Optional Git command boundary used by hermetic qualification. */
  readonly gitCommand?: () => Layer.Layer<GitCommand>
  /** Optional executor boundary used by hermetic qualification. */
  readonly plannedAttemptExecutor?: () => Layer.Layer<PlannedAttemptExecutor, never, CodexAppServer | GitCommand>
  /** Optional Integrator boundary used by hermetic qualification. */
  readonly integrator?: (
    configuration: CodexIntegratorConfiguration
  ) => Layer.Layer<
    Integrator | IntegratorCandidateProviderAuthority,
    never,
    CodexAppServer | GitCommand | CoordinatorOwnership
  >
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

/**
 * Complete production repository graph. Optional adapters replace only named
 * network, persistence, or process edges for qualification; the mutation
 * capability topology, one shared Codex service, and Run chronology remain unchanged.
 */
export const productionRepositoryHostGraph = <ECodex = never, EGithub = never, ETrace = never>(
  adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace> = {}
) => ({
  foundation: (configuration: ProductionRepositoryHostConfiguration) => {
    const ownership = productionCoordinatorOwnershipLayer(
      GitCommonDirectoryTarget.make(configuration.commonDirectory)
    ).pipe(Layer.provide(NodeServices.layer))
    const defaultJournalLayer = sqliteJournalStoreLayer({ filename: configuration.journalDatabase })
    const journalStoreLayer = adapters.journalStore?.(configuration, defaultJournalLayer) ?? defaultJournalLayer
    const journal = journalStoreCapabilities(journalStoreLayer)
    return journal.pipe(Layer.provideMerge(ownership))
  },
  run: (
    configuration: ProductionRepositoryHostConfiguration,
    selection: ProductionRunSelection,
    onFailure: (failure: unknown) => Effect.Effect<void>
  ) =>
    Layer.unwrap(
      // eslint-disable-next-line complexity -- One production graph resolves each optional qualification boundary while preserving one scoped service topology.
      Effect.gen(function* () {
        const ownership = yield* CoordinatorOwnership
        const journal = yield* JournalStore
        const lifecycle = yield* RunLifecycleJournal
        /* v8 ignore start -- @preserve Hermetic host tests replace the live GitHub boundary; this assignment retains the production-only provider default. */
        const githubClientLayer = adapters.githubClient?.(configuration) ?? defaultGithubClientLayer(configuration)
        /* v8 ignore stop */
        const githubAuthorityLayer = githubDeliveryAuthorityLayer.pipe(
          Layer.provide(githubClientLayer),
          Layer.provide(NodeCrypto.layer)
        )
        const evidenceLayer = nodeEvidenceStoreLayer(configuration.evidenceStoreRoot).pipe(
          Layer.provide(NodeServices.layer)
        )
        const attemptStoreLayer = nodeCodexAttemptStoreLayer({
          stateDirectory: configuration.codexStateDirectory
        }).pipe(Layer.provide(NodeServices.layer))
        /* v8 ignore start -- @preserve Hermetic host tests replace the process boundary; this assignment retains the production Codex app-server default. */
        const appLayer: Layer.Layer<
          CodexAppServer,
          ECodex | Layer.Error<ReturnType<typeof defaultCodexAppServerLayer>>
        > = adapters.codexAppServer?.(configuration) ?? defaultCodexAppServerLayer(configuration, attemptStoreLayer)
        /* v8 ignore stop */
        const gitCommandLayer = (adapters.gitCommand?.() ?? nodeGitCommandLayer).pipe(Layer.provide(NodeServices.layer))
        const activityCensusLayer = nodeCodexOwnedActivityCensusLayer.pipe(Layer.provide(appLayer))
        const executorLayer = (adapters.plannedAttemptExecutor?.() ?? nodeCodexPlannedAttemptExecutorLayer).pipe(
          Layer.provide(appLayer),
          Layer.provide(activityCensusLayer),
          Layer.provide(attemptStoreLayer),
          Layer.provide(evidenceLayer),
          Layer.provide(gitCommandLayer),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(NodeServices.layer)
        )
        const integratorConfiguration = CodexIntegratorConfiguration.make({
          candidateWorktreeRoot: configuration.integratorCandidateWorktreeRoot,
          commonDirectory: configuration.commonDirectory,
          privateStoreLocator: configuration.integratorPrivateStore,
          repository: configuration.repository
        })
        const integratorLayer = (
          adapters.integrator?.(integratorConfiguration) ?? nodeCodexIntegratorLayer(integratorConfiguration)
        ).pipe(
          Layer.provide(appLayer),
          Layer.provide(activityCensusLayer),
          Layer.provide(gitCommandLayer),
          Layer.provide(NodeServices.layer),
          Layer.provide(Layer.succeed(CoordinatorOwnership, ownership))
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
            journalStoreLayer: journalLayer
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
            onFailure
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
      const activationFailure = yield* Deferred.make<never, EActivation>()
      const run = yield* Layer.build(
        graph.run(configuration, selection, (failure) => Deferred.fail(activationFailure, failure).pipe(Effect.asVoid))
      ).pipe(Effect.provide(foundation))
      const source = Context.get(run, JournaledRunObservationSource)
      yield* Effect.raceFirst(source.awaitEstablished, Deferred.await(activationFailure))
      return yield* use({ acceptedHistory: source.acceptedHistory, current: source.current, selection })
    })
  )
