import { acquireProductionHost } from "./production-host-acquisition.js"
import { readRunningHostWatchCurrent } from "./running-host-watch-diagnostics.js"
/* eslint-disable max-lines -- Production host composition keeps one scoped lifecycle and its qualification seams auditable. */
import { NodeCrypto, NodeHttpClient, NodeServices } from "@effect/platform-node"
import {
  type GitCommitSha,
  type PlannedAttemptExecutorCorrelation,
  IntegrationTarget,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorWriterCustody,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type RunId
} from "@dalph/contracts"
import {
  publicApplicationExitResult,
  ApplicationExiting,
  type ApplicationExitResult,
  defaultJournalMaintenanceObservation,
  observeArchiveRetention,
  AcceptedJournalReader,
  currentSignalFromCurrentFirstStream,
  projectDeliveryDiagnostics,
  type AcceptedRunControlDirection,
  acceptedJournalRecordsForKind,
  journalRecordAt,
  type JournaledRunTermination,
  type RunCompletion,
  type RunCompletionInspection,
  GithubGraphqlClient,
  type GithubGraphqlExecution,
  GithubGraphqlRequestError,
  type GithubGraphqlMutationExecution,
  type GithubGraphqlMutationRequest,
  type GithubGraphqlReadExecution,
  type GithubGraphqlReadRequest,
  type GithubGraphqlRequest,
  RunReactivationOwner,
  RunReactivationHint,
  type ApplicationExitAdmissionService,
  type ApplicationExitRequestBoundaryService,
  type ProductionHostApplicationExitShellService,
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
  IntegrationResponsibilityIdentity,
  JournalPosition,
  type RemotePublicationRetainedCause,
  type RemotePublicationRequestId,
  type GitCommandService,
  InitialControlPolicy,
  Integrator,
  IntegratorCandidateProviderAuthority,
  type JournaledRunTerminationSource,
  JournaledRunObservationSource,
  JournaledRunBootstrap,
  JournalStore,
  RunLifecycleJournal,
  type RemoteBaselineGit,
  type RemotePublicationGit,
  TargetPromotionGit,
  type TargetPromotionGitRequest,
  TrackerGraphReader,
  TrackerMutation,
  WorkflowTrace,
  githubDeliveryAuthorityLayer,
  githubGraphqlClientLayer,
  journalStoreCapabilities,
  makeRequestCircuit,
  nodeEvidenceStoreLayer,
  nodeGitCommandLayer,
  nodeGitTargetPromotionLayer,
  productionCoordinatorOwnershipLayer,
  sqliteJournalStoreLayer,
  taskClaimAcquisitionPlannerLayer,
  type ProductionRunSelection,
  TraceCursor,
  type JournalRecord,
  TraceReader,
  TraceReaderLayer,
  type TraceReaderService,
  type RequestCircuitPolicy,
  asApplicationExitShellService,
  discoverProductionRun,
  discoverProductionCancellationRun,
  makeProductionHostApplicationExitShell,
  selectDiscoveredProductionRun
} from "@dalph/orchestrator"
import { makeHostArchiveMaintenance } from "./host-archive-maintenance.js"
import {
  Context,
  Crypto,
  Encoding,
  Result,
  Deferred,
  Effect,
  Layer,
  Logger,
  Option,
  Ref,
  Schema,
  Semaphore,
  Stream,
  type Scope
} from "effect"
// eslint-disable-next-line import/no-nodejs-modules -- The production host selects its own Node executable for task preparation.
import nodeProcess from "node:process"
import { isolatedPlannedAttemptExecutorLayer } from "./isolated-planned-attempt-executor.js"
import { runningHostInspectionFromServices, type RunningHostInspectionService } from "./running-host-inspection.js"
import {
  CodexAppServer,
  CodexAppServerFailure,
  type CodexAppServerService,
  codexAppServerNodeLayer,
  codexOwnedActivityCensusLayer,
  type CodexAppServerRequestBoundary,
  type CodexAppServerRequestOperation
} from "./codex-app-server.js"
import {
  ExecutorModelAlias,
  ExecutorProfile,
  ExecutorProfileId,
  ExecutorProviderConfigReference,
  resolveExecutorProfileLocator
} from "./executor-profile.js"
import {
  type CodexAttemptStoreFailure,
  CodexAttemptStore,
  type CodexAttemptStoreService,
  nodeCodexAttemptStoreLayer
} from "./codex-attempt-store.js"
import { nodeCodexProcessNativeService, type CodexProcessNativeService } from "./codex-process-native.js"
import {
  defaultCodexTaskInstructions,
  nodeCodexPlannedAttemptExecutorLayerWithOptions
} from "./codex-planned-attempt-executor.js"
import {
  nodeAttemptWorktreePreparationService,
  preparedPlannedAttemptExecutor,
  type AttemptWorktreePreparationService
} from "./attempt-worktree-preparation.js"
import { nodeKimiAcpClientLayer } from "./kimi-acp.js"
import { nodeKimiAttemptPrivateStoreLayer } from "./kimi-attempt-store.js"
import { kimiPlannedAttemptExecutorLayer } from "./kimi-planned-attempt-executor.js"
import { nodeCodexIntegratorLayer } from "./codex-integrator.js"
import { nodeKimiIntegratorLayer } from "./kimi-integrator-provider.js"
import {
  CodexIntegratorConfiguration,
  IntegratorPrivateStoreLocator,
  inspectCodexIntegratorRetainedThreads
} from "./codex-integrator-private-store.js"
import {
  type ProductionRepositoryHostConfiguration,
  ProductionCodexExecutorPrivateStateDirectory,
  decodeProductionRepositoryHostConfiguration,
  productionExecutorLocator,
  productionKimiExecutorPrivateStateDirectory,
  productionPlannedTaskAttemptLayer
} from "./production-configuration.js"
import {
  productionRunReactivationLayer,
  type ProductionNonRetryableActivationFailure,
  productionWorkflowInterpreterLayer,
  productionTargetGitCommands,
  type ProductionApplicationExitRequestObserver,
  type ProductionApplicationExitTraceObserver,
  type ProductionWorkflowCleanupObserver,
  type ProductionWorkflowGitCommandObserver,
  type ProductionRunReconstructionObservation
} from "./production.js"

import type { RunningHostCommandRequest, RunningHostCommandValue, RunningHostError } from "./running-host-contract.js"
import { makeRunningHostCapacity } from "./running-host-capacity.js"

/** Process-local signals and the host-owned lifecycle boundary exposed after one exact Run beginning is acknowledged. */
export interface ProductionHostObservation {
  readonly acceptedHistory: CurrentSignal<TraceCursor>
  readonly current: CurrentSignal<DeliveryRuntimeObservationState>
  /** Exact terminal Journal result, independent from history and current status. */
  readonly runTermination: JournaledRunTerminationSource
  readonly selection: ProductionRunSelection
  /** Read-only projection of an acknowledged cursor; it cannot append or poll an outside authority. */
  readonly traceReader: Pick<TraceReaderService, "readAt" | "snapshotAdmission"> &
    Partial<Pick<TraceReaderService, "readOccurrencesAt">>
  /** Exact lifecycle result reported before this host scope finalizes resources and ownership. */
  readonly readExitOwners?: ProductionHostApplicationExitShellService["readOwners"]
  readonly applicationExitRequestBoundary: ApplicationExitRequestBoundaryService
  /** Exact Run control, serialized by the established Journal and coordinator owner. */
  readonly resultRecoveryControl?: Pick<
    JournaledRunBootstrap["Service"]["operatorControl"],
    "applyResultRecoveryDirection" | "readResultRecoveryDirection"
  >
  readonly taskAttemptBaseRetryControl?: Pick<
    JournaledRunBootstrap["Service"]["operatorControl"],
    "readTaskAttemptBaseRetryRequest"
  >
  readonly remotePublicationControl?: Pick<
    JournaledRunBootstrap["Service"]["operatorControl"],
    "applyRemotePublicationResume" | "applyRemotePublicationBatchGrant"
  >
}

/** One immutable accepted-prefix read; it does not establish or publish Run state. */
export interface ProductionPassiveRunControl {
  readonly direction: "RunPaused" | "RunUnpaused" | "RunTerminated"
  readonly observedAt: TraceCursor
  readonly completionResult?: Extract<RunCompletionInspection, { readonly _tag: "CompletedRun" }>
  readonly completion?: RunCompletion
  readonly termination: JournaledRunTermination | null
}

export class ProductionPassiveControlUnavailable extends Schema.TaggedError<ProductionPassiveControlUnavailable>()(
  "ProductionPassiveControlUnavailable",
  {}
) {}

/** Listener ownership survives delivery settlement and typed activation failure. */
export interface ProductionRunningHostObservation<E> extends ProductionHostObservation {
  /** Disposable watch preparation can refuse before allocating diagnostics. */
  readonly watchCurrent?: CurrentSignal<DeliveryRuntimeObservationState, RunningHostError>
  /** Acquires one listener-scoped inspection owner from the existing reader. */
  readonly inspection?: Effect.Effect<RunningHostInspectionService, never, Scope.Scope>
  readonly target: ProductionRepositoryHostConfiguration["target"]
  readonly readRunControl: Effect.Effect<ProductionPassiveRunControl, ProductionPassiveControlUnavailable>
  /** Compact terminal fence for commands; optional history is not an admission prerequisite. */
  readonly readCommandTermination?: Effect.Effect<JournaledRunTermination | null, ProductionPassiveControlUnavailable>
  readonly readAttachedCapacity?: ReturnType<typeof makeRunningHostCapacity>["read"]
  readonly activationFailure: Effect.Effect<Option.Option<E>>
  /** Host-owned failure notification; subscribers do not poll or reactivate work. */
  readonly awaitActivationFailure?: Effect.Effect<never, E>
  readonly closing: Effect.Effect<boolean>
  readonly commandAdmission: ApplicationExitAdmissionService
  readonly awaitExitResult: Effect.Effect<void>
  readonly registerObservationDrain: ProductionHostApplicationExitShellService["registerProcessLocalDrain"]
  readonly executeAttachedCommand: (
    request: RunningHostCommandRequest
  ) => Effect.Effect<RunningHostCommandValue, RunningHostError>
}

/** The exact retained publication address available to an Operator without starting delivery. */
export interface ProductionPublicationSubject {
  readonly runId: RunId
  readonly responsibility: IntegrationResponsibilityIdentity
  readonly retainedAt: JournalPosition
  readonly cause: RemotePublicationRetainedCause
  readonly candidateCommit: GitCommitSha
  readonly publicationRequestId: RemotePublicationRequestId
}

const laterPublicationBoundary = (record: JournalRecord, retained: JournalRecord): boolean => {
  if (retained.event._tag !== "RemotePublicationRetained" || record.position <= retained.position) return false
  const publicationId = retained.event.correlation.requestId
  if (
    record.event._tag === "RemotePublicationAttemptIntended" ||
    record.event._tag === "RemotePublicationRetained" ||
    record.event._tag === "RemotePublicationResumeRequested" ||
    record.event._tag === "RemotePublicationSucceeded"
  )
    return record.event.correlation.requestId === publicationId
  if (record.event._tag === "RemotePublicationBatchGrantApplied")
    return (
      record.event.request.responsibility.queuedAt ===
      retained.event.correlation.qualifiedCandidate.run.session.queuedAt
    )
  return false
}

/** Reads only validated Hot history under coordinator ownership; no Run owner or provider is acquired. */
export const inspectProductionPublicationSubjects = <ECodex = never, EGithub = never, ETrace = never>(
  configuration: ProductionRepositoryHostConfiguration,
  adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace> = {}
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const foundation = yield* Layer.build(productionRepositoryHostGraph(adapters).foundation(configuration))
      const discovery = yield* discoverProductionRun(configuration.target).pipe(Effect.provide(foundation))
      if (discovery._tag === "Fresh") {
        const subjects: ReadonlyArray<ProductionPublicationSubject> = []
        return { runId: null, subjects }
      }
      const records = yield* Context.get(foundation, JournalStore).read(discovery.runId)
      const subjects = records.flatMap((record): ReadonlyArray<ProductionPublicationSubject> => {
        if (record.event._tag !== "RemotePublicationRetained") return []
        if (records.some((later) => laterPublicationBoundary(later, record))) return []
        const session = record.event.correlation.qualifiedCandidate.run.session
        return [
          {
            runId: record.runId,
            responsibility: IntegrationResponsibilityIdentity.make({ runId: record.runId, queuedAt: session.queuedAt }),
            retainedAt: JournalPosition.make(record.position),
            cause: record.event.cause,
            candidateCommit: record.event.correlation.qualifiedCandidate.candidateCommit,
            publicationRequestId: record.event.correlation.requestId
          }
        ]
      })
      return { runId: discovery.runId, subjects }
    })
  )

/** The offline cancellation command found no unfinished Run for its exact target. */
export class ProductionCancellationRunNotFound extends Schema.TaggedError<ProductionCancellationRunNotFound>()(
  "ProductionCancellationRunNotFound",
  {}
) {}

type ProductionHostFoundation = CoordinatorOwnership | JournalStore | RunLifecycleJournal

/** Provider resources acquired once and retained until the enclosing host scope closes. */
type ProductionHostProviderAdmission =
  | {
      readonly _tag: "CodexAppServer"
      readonly appServer: CodexAppServerService
      readonly attemptStore: CodexAttemptStoreService
    }
  | { readonly _tag: "NonCodex" }

/** Construction-time taps for the one host shell; they cannot replace its authority or identity. */
interface ProductionRepositoryHostApplicationExitConstructionOptions {
  readonly requestObserver?: ProductionApplicationExitRequestObserver
  readonly traceObserver?: ProductionApplicationExitTraceObserver
}

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
  applicationExit: ApplicationExitShell["Service"]
) => Effect.Effect<void>

/**
 * Builds the live repository owner and Journal before selection, then builds
 * the one exact Run graph from those same scoped service instances.
 */
export interface ProductionRepositoryHostGraph<EFoundation, RFoundation, ERun, RRun, EActivation, EProvider> {
  /** Acquires and proves the exact provider instance that the selected Run will use. */
  readonly acquireProvider: (
    configuration: ProductionRepositoryHostConfiguration,
    applicationExit: ProductionHostApplicationExitShellService
  ) => Effect.Effect<ProductionHostProviderAdmission, EProvider, Scope.Scope>
  readonly foundation: (
    configuration: ProductionRepositoryHostConfiguration
  ) => Layer.Layer<ProductionHostFoundation, EFoundation, RFoundation>
  /** Builds the one host-scoped shell before the Run graph; no fallback shell is permitted. */
  readonly makeApplicationExit: () => Effect.Effect<ProductionHostApplicationExitShellService, never, Scope.Scope>
  readonly run: (
    configuration: ProductionRepositoryHostConfiguration,
    selection: ProductionRunSelection,
    onFailure: (failure: EActivation) => Effect.Effect<void>,
    applicationExit: ProductionHostApplicationExitShellService,
    provider: ProductionHostProviderAdmission,
    operation?: "Run" | "Cancel"
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
  /** Optional direct observation of graceful application lifecycle results/events. */
  readonly applicationExitTraceObserver?: ProductionApplicationExitTraceObserver
  /** Optional direct observation of workflow disposition cleanup calls. */
  readonly workflowCleanupObserver?: ProductionWorkflowCleanupObserver
  /** Controlled direct-publication Git authority for hermetic host qualification. */
  readonly remoteBaselineGitLayer?: Layer.Layer<RemoteBaselineGit>
  /** Controlled direct-publication Git authority for hermetic host qualification. */
  readonly remotePublicationGitLayer?: Layer.Layer<RemotePublicationGit>
  /** Optional observation of the process-local timer lifecycle. */
  readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
  /** Qualification-only observation of each registered Run owner control callback. */
  readonly onAcceptedRunControl?: (direction: AcceptedRunControlDirection) => Effect.Effect<void>
  /** Optional observation of each admitted activation finalization. */
  readonly onActivationFinalizationStart?: (kind: "Ordinary" | "ActiveWorkAuthorityRefresh") => Effect.Effect<void>
  /** Qualification-only observation of the existing owner idle handoff. */
  readonly onActivationHandoffIdle?: () => Effect.Effect<void>
  /** Qualification synchronization immediately before the real expected-head Git mutation. */
  readonly targetPromotionCompareAndSetObserver?: (request: TargetPromotionGitRequest) => Effect.Effect<void>
  /** Qualification-only process view shared by app-server ownership and attempt activity observations. */
  readonly codexProcessNative?: CodexProcessNativeService
  /**
   * Optional app-server layer factory. The request boundary is supplied when
   * the factory is called so construction-time initialization can opt into
   * the same admission state as the production default layer.
   */
  readonly codexAppServer?: (
    configuration: ProductionRepositoryHostConfiguration,
    requestBoundary?: CodexAppServerRequestBoundary
  ) => Layer.Layer<CodexAppServer, ECodex, ApplicationExitShell>
  readonly githubClient?: (
    configuration: ProductionRepositoryHostConfiguration
  ) => Layer.Layer<GithubGraphqlClient, EGithub>
  /** Qualification-only budget for controlled multi-task fixtures; production keeps the fixed default. */
  readonly githubRequestCircuitMaxRequests?: number
  readonly workflowTrace?: () => Layer.Layer<WorkflowTrace, ETrace>
}

const defaultWorkflowTraceLayer = Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))

const defaultGithubClientLayer = (configuration: ProductionRepositoryHostConfiguration) =>
  githubGraphqlClientLayer({ token: configuration.githubToken, endpoint: configuration.githubGraphqlEndpoint }).pipe(
    Layer.provide(NodeHttpClient.layerUndici)
  )

const githubRequestCircuitPolicy: RequestCircuitPolicy = {
  cooldownNanos: 30n * 1_000_000_000n,
  maxRequests: 120,
  windowNanos: 60n * 1_000_000_000n
}

const githubRequestCircuitOpenDetail =
  "GitHub request circuit is open after 120 requests in 60 seconds; retrying is locally deferred for 30 seconds"

const codexRequestCircuitPolicy: RequestCircuitPolicy = {
  cooldownNanos: 30n * 1_000_000_000n,
  maxRequests: 240,
  windowNanos: 60n * 1_000_000_000n
}

const codexRequestCircuitOpenDetail =
  "Codex app-server request circuit is open after 240 requests in 60 seconds; retrying is locally deferred for 30 seconds"

type GuardedGithubClientService = {
  readonly execute: {
    (request: GithubGraphqlReadRequest): GithubGraphqlReadExecution
    (request: GithubGraphqlMutationRequest): GithubGraphqlMutationExecution
    (request: GithubGraphqlRequest): GithubGraphqlExecution
  }
}

/**
 * Builds the host-owned GitHub client decorator. The Layer remains private to
 * production composition; this service seam keeps its focused boundary test
 * from requiring an exported production Layer. The client owns request/error
 * typing; the host owns admission policy and creates one circuit state for
 * this provider instance.
 */
export const makeGuardedGithubClient = Effect.fn("ProductionHost.makeGuardedGithubClient")(function* (
  client: GuardedGithubClientService,
  maxRequests = githubRequestCircuitPolicy.maxRequests
): Effect.fn.Return<GuardedGithubClientService> {
  const requestCircuit = yield* makeRequestCircuit({
    onOpen: (operation: GithubGraphqlRequest["_tag"]) =>
      new GithubGraphqlRequestError({
        detail:
          maxRequests === githubRequestCircuitPolicy.maxRequests
            ? githubRequestCircuitOpenDetail
            : `GitHub request circuit is open after ${maxRequests} requests in 60 seconds; retrying is locally deferred for 30 seconds`,
        kind: "CircuitOpen",
        operation
      }),
    policy: { ...githubRequestCircuitPolicy, maxRequests }
  })
  function execute(request: GithubGraphqlReadRequest): GithubGraphqlReadExecution
  function execute(request: GithubGraphqlMutationRequest): GithubGraphqlMutationExecution
  function execute(request: GithubGraphqlRequest): GithubGraphqlExecution
  function execute(request: GithubGraphqlRequest) {
    return requestCircuit.run(request._tag, client.execute(request))
  }
  return GithubGraphqlClient.of({ execute })
})

/** Decorates the one production GitHub client after its transport is selected. */
const guardedGithubClientLayer = <E, R>(
  layer: Layer.Layer<GithubGraphqlClient, E, R>,
  maxRequests?: number
): Layer.Layer<GithubGraphqlClient, E, R> =>
  Layer.effect(
    GithubGraphqlClient,
    Effect.gen(function* () {
      return yield* makeGuardedGithubClient(yield* GithubGraphqlClient, maxRequests)
    })
  ).pipe(Layer.provide(layer))

/**
 * Decorates the exposed Codex app-server boundary after its process/session
 * transport is selected. Cleanup stays outside admission so scope finalizers
 * can always close the owned process.
 */
const guardedCodexAppServerLayer = <E, R>(
  layer: Layer.Layer<CodexAppServer, E, R>,
  requestBoundary: CodexAppServerRequestBoundary
): Layer.Layer<CodexAppServer, E, R> =>
  Layer.effect(
    CodexAppServer,
    Effect.gen(function* () {
      const appServer = yield* CodexAppServer
      const listThreads = appServer.listThreads
      const listThreadTurns = appServer.listThreadTurns
      const steerTurn = appServer.steerTurn
      return CodexAppServer.of({
        ...appServer,
        startThread: (cwd, ownedThreadToken) =>
          requestBoundary.run("thread/start", appServer.startThread(cwd, ownedThreadToken)),
        ...(listThreads === undefined
          ? {}
          : { listThreads: (cwd) => requestBoundary.run("thread/list", listThreads(cwd)) }),
        readThread: (threadId) => requestBoundary.run("thread/read", appServer.readThread(threadId)),
        resumeThread: (threadId, cwd) => requestBoundary.run("thread/resume", appServer.resumeThread(threadId, cwd)),
        ...(listThreadTurns === undefined
          ? {}
          : { listThreadTurns: (threadId) => requestBoundary.run("thread/turns/list", listThreadTurns(threadId)) }),
        startTurn: (threadId, cwd, text, ownedTurnToken) =>
          requestBoundary.run("turn/start", appServer.startTurn(threadId, cwd, text, ownedTurnToken)),
        ...(steerTurn === undefined
          ? {}
          : {
              steerTurn: (threadId, turnId, text, messageId) =>
                requestBoundary.run("turn/steer", steerTurn(threadId, turnId, text, messageId))
            }),
        interruptTurn: (threadId, turnId) =>
          requestBoundary.run("turn/interrupt", appServer.interruptTurn(threadId, turnId)),
        listBackgroundTerminals: (threadId) =>
          requestBoundary.run("thread/backgroundTerminals/list", appServer.listBackgroundTerminals(threadId)),
        terminateBackgroundTerminal: (threadId, processId) =>
          requestBoundary.run(
            "thread/backgroundTerminals/terminate",
            appServer.terminateBackgroundTerminal(threadId, processId)
          )
      })
    })
  ).pipe(Layer.provide(layer))

const defaultCodexAppServerLayer = (
  configuration: ProductionRepositoryHostConfiguration,
  profile: ExecutorProfile,
  attemptStore: Layer.Layer<CodexAttemptStore>,
  native: CodexProcessNativeService = nodeCodexProcessNativeService,
  requestBoundary: CodexAppServerRequestBoundary
) => {
  return codexAppServerNodeLayer(
    {
      executable: profile.adapter === "codex-app-server" ? profile.executable : configuration.codexExecutable,
      ...(profile.adapter === "codex-app-server" ? { model: profile.model } : {}),
      clientName: configuration.codexClientName,
      clientVersion: configuration.codexClientVersion,
      ...(configuration.codexHome === undefined ? {} : { environment: { CODEX_HOME: configuration.codexHome } }),
      requireUnattendedPolicy: true
    },
    native,
    requestBoundary
  ).pipe(Layer.provide(attemptStore), Layer.provide(NodeServices.layer))
}

const defaultProductionExecutorProfiles = (
  configuration: ProductionRepositoryHostConfiguration
): readonly [ExecutorProfile, ExecutorProfile] => [
  ExecutorProfile.make({
    adapter: "codex-app-server",
    executable: configuration.codexExecutable,
    id: ExecutorProfileId.make("codex/production"),
    model: ExecutorModelAlias.make("default"),
    permissionPolicy: "unattended",
    provider: "codex"
  }),
  ExecutorProfile.make({
    adapter: "kimi-acp",
    executable: "kimi",
    id: ExecutorProfileId.make("kimi/for-coding"),
    model: ExecutorModelAlias.make("kimi-code/kimi-for-coding"),
    permissionPolicy: "unattended",
    provider: "kimi",
    providerConfigRef: ExecutorProviderConfigReference.make("kimi-for-coding")
  })
]

const selectedProductionExecutorProfile = Effect.fn("ProductionRepositoryHost.selectedExecutorProfile")(function* (
  configuration: ProductionRepositoryHostConfiguration
) {
  const defaults = defaultProductionExecutorProfiles(configuration)
  const configuredProfiles = configuration.executorProfiles ?? defaults
  const executorLocator = productionExecutorLocator(configuration)
  return executorLocator.startsWith("codex:") && configuration.executorProfiles === undefined
    ? defaults[0]
    : yield* resolveExecutorProfileLocator(configuredProfiles, executorLocator)
})

const hexadecimalRadix = 16
const hexadecimalByteWidth = 2

/** Acquires the process and private custody for one exact executor attempt. */
export const acquireProductionCodexAttemptProvider = <ECodex, EGithub, ETrace>(
  configuration: ProductionRepositoryHostConfiguration,
  applicationExit: ProductionHostApplicationExitShellService,
  correlation: PlannedAttemptExecutorCorrelation,
  adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace> = {}
) =>
  Effect.gen(function* () {
    const profile = yield* selectedProductionExecutorProfile(configuration)
    const native = adapters.codexProcessNative ?? nodeCodexProcessNativeService
    const crypto = yield* Crypto.Crypto
    const digest = yield* crypto.digest(
      "SHA-256",
      new TextEncoder().encode(plannedAttemptExecutorCorrelationKey(correlation))
    )
    const directory = yield* Schema.decodeUnknownEffect(ProductionCodexExecutorPrivateStateDirectory)(
      `${configuration.codexExecutorPrivateStateDirectory}/attempts/${Array.from(digest, (byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0")).join("")}`
    )
    const scopedConfiguration = {
      ...configuration,
      codexExecutable: profile.adapter === "codex-app-server" ? profile.executable : configuration.codexExecutable,
      codexExecutorPrivateStateDirectory: directory
    }
    const privateStore = nodeCodexAttemptStoreLayer({ stateDirectory: directory }).pipe(
      Layer.provide(NodeServices.layer)
    )
    const context = yield* Layer.build(privateStore)
    const store = Layer.succeed(CodexAttemptStore, Context.get(context, CodexAttemptStore))
    const requestBoundary = yield* makeRequestCircuit<CodexAppServerRequestOperation, CodexAppServerFailure>({
      onOpen: (operation) =>
        new CodexAppServerFailure({ detail: codexRequestCircuitOpenDetail, kind: "CircuitOpen", operation }),
      policy: codexRequestCircuitPolicy
    })
    const supplied = adapters.codexAppServer?.(scopedConfiguration, requestBoundary)
    const providerLayer: Layer.Layer<
      CodexAppServer,
      ECodex | CodexAppServerFailure | CodexAttemptStoreFailure,
      ApplicationExitShell
    > =
      supplied === undefined
        ? defaultCodexAppServerLayer(scopedConfiguration, profile, store, native, requestBoundary)
        : guardedCodexAppServerLayer(supplied, requestBoundary)
    const providerContext = yield* Layer.build(
      providerLayer.pipe(
        Layer.provide(Layer.succeed(ApplicationExitShell, asApplicationExitShellService(applicationExit)))
      )
    )
    const app = Context.get(providerContext, CodexAppServer)
    if (app.unattendedPolicyAdmission === undefined) {
      return yield* new CodexAppServerFailure({
        detail: "isolated provider did not expose unattended-policy admission",
        kind: "Protocol",
        operation: "config/read"
      })
    }
    yield* app.unattendedPolicyAdmission
    return { app, store, configuration: scopedConfiguration }
  }).pipe(Effect.provide(NodeCrypto.layer))

/** The production Codex executor and integrator use independent provider custody. */
export const productionCodexExecutionLayers = <ECodex, EGit, EEvidence>(options: {
  readonly configuration: ProductionRepositoryHostConfiguration
  readonly profile: ExecutorProfile
  readonly applicationExit: ProductionHostApplicationExitShellService
  readonly adapters: Pick<ProductionRepositoryHostAdapters<ECodex>, "codexAppServer" | "codexProcessNative">
  readonly app: Layer.Layer<CodexAppServer, CodexAppServerFailure>
  readonly git: Layer.Layer<GitCommand, EGit>
  readonly evidence: Layer.Layer<EvidenceStore, EEvidence>
  readonly ownership: CoordinatorOwnership["Service"]
}) => {
  const native = options.adapters.codexProcessNative ?? nodeCodexProcessNativeService
  const acquireExecutor = (correlation: PlannedAttemptExecutorCorrelation) =>
    Effect.gen(function* () {
      const { app, store } = yield* acquireProductionCodexAttemptProvider(
        options.configuration,
        options.applicationExit,
        correlation,
        options.adapters
      )
      const isolatedApp = Layer.succeed(CodexAppServer, app)
      return yield* Layer.build(
        nodeCodexPlannedAttemptExecutorLayerWithOptions({
          ...(options.configuration.codexToolEffectPolicy === undefined
            ? {}
            : { toolEffectPolicy: options.configuration.codexToolEffectPolicy }),
          ...(options.profile.worktreePreparation === undefined
            ? {}
            : {
                taskInstructions: [
                  "Dalph already prepared this exact worktree with its repository Node and frozen dependencies. Run every later Node and pnpm check through `mise exec --` so a login shell cannot select the host Node.",
                  ...defaultCodexTaskInstructions
                ]
              })
        }).pipe(
          Layer.provide(isolatedApp),
          Layer.provide(codexOwnedActivityCensusLayer(native).pipe(Layer.provide(isolatedApp))),
          Layer.provide(store),
          Layer.provide(options.evidence),
          Layer.provide(options.git),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(NodeServices.layer)
        )
      )
    }).pipe(Effect.provide(NodeCrypto.layer))
  const executor = isolatedPlannedAttemptExecutorLayer(
    acquireExecutor,
    () => "isolated Codex containment could not be acquired; retained custody must be reconciled",
    (plannedAttempt) =>
      Effect.gen(function* () {
        const context = yield* acquireExecutor(plannedAttemptExecutorCorrelation(plannedAttempt))
        const observe = Context.get(context, PlannedAttemptExecutor).observeWriterCustody
        return yield* observe === undefined
          ? Effect.succeed(
              PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                plannedAttempt,
                detail: "fresh Codex owner does not expose writer custody observation"
              })
            )
          : observe(plannedAttempt)
      })
  )
  const integratorConfiguration = CodexIntegratorConfiguration.make({
    candidateWorktreeRoot: options.configuration.integratorCandidateWorktreeRoot,
    commonDirectory: options.configuration.commonDirectory,
    privateStoreLocator: options.configuration.integratorPrivateStore,
    repository: options.configuration.repository
  })
  const integrator = nodeCodexIntegratorLayer(integratorConfiguration).pipe(
    Layer.provide(options.app),
    Layer.provide(codexOwnedActivityCensusLayer(native).pipe(Layer.provide(options.app))),
    Layer.provide(options.git),
    Layer.provide(NodeServices.layer),
    Layer.provide(Layer.succeed(CoordinatorOwnership, options.ownership))
  )
  return { executor, integrator, integratorConfiguration }
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
  layer: Layer.Layer<PlannedAttemptExecutor | PlannedAttemptExecutorLifecycleObservation, E, R>,
  observe: ProductionRepositoryHostBoundaryObserver | undefined,
  preparation?: AttemptWorktreePreparationService
) => {
  if (observe === undefined && preparation === undefined) return layer
  return Layer.fromBuildMemo((memoMap, scope) =>
    Layer.buildWithMemoMap(layer, memoMap, scope).pipe(
      Effect.flatMap((context) =>
        Effect.gen(function* () {
          if (observe !== undefined) yield* observe("executor.acquire")
          const executor = Context.get(context, PlannedAttemptExecutor)
          const prepared =
            preparation === undefined
              ? executor
              : yield* preparedPlannedAttemptExecutor(executor, preparation).pipe(Effect.provide(NodeCrypto.layer))
          return Context.add(
            context,
            PlannedAttemptExecutor,
            observe === undefined ? prepared : observedPlannedAttemptExecutor(prepared, observe)
          )
        })
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

const applicationExitDiagnosticLogger = Logger.withConsoleError(Logger.make(({ message }) => String(message)))

/**
 * Keeps the coordinator lock held until the host scope closes after its caller
 * reports the exact lifecycle result and returns. The application shell owns
 * the decision and bounded drain; scope finalization owns the final lock release.
 */
const makeHostApplicationExitShell = Effect.fn("ProductionRepositoryHost.makeApplicationExitShell")(function* (
  options: ProductionRepositoryHostApplicationExitConstructionOptions = {}
) {
  const trace = {
    emit: (event: Parameters<ProductionApplicationExitTraceObserver>[0]) =>
      Effect.gen(function* () {
        if (event._tag === "ExitResultReported" && event.result._tag !== "Succeeded") {
          yield* Effect.logError(
            JSON.stringify({
              _tag: "DalphApplicationExitDiagnostic",
              result: publicApplicationExitResult(event.result)
            })
          ).pipe(Effect.provide(Logger.layer([applicationExitDiagnosticLogger])))
        }
        yield* options.traceObserver?.(event) ?? Effect.void
      })
  }
  const shell: ProductionHostApplicationExitShellService = yield* makeProductionHostApplicationExitShell(
    { emit: trace.emit },
    options.requestObserver === undefined ? {} : { onRequest: options.requestObserver }
  )
  return shell
})

/**
 * Complete production repository graph. Optional adapters replace only named
 * network or process edges for qualification; the mutation capability topology,
 * exact provider custody, and Run chronology remain unchanged. The optional
 * boundary observer only taps those real production services.
 */
export const productionRepositoryHostGraph = <ECodex = never, EGithub = never, ETrace = never>(
  adapters: ProductionRepositoryHostAdapters<ECodex, EGithub, ETrace> = {}
) => ({
  acquireProvider: (
    configuration: ProductionRepositoryHostConfiguration,
    applicationExit: ProductionHostApplicationExitShellService
  ) =>
    Effect.gen(function* () {
      const selectedProfile = yield* selectedProductionExecutorProfile(configuration)
      if (selectedProfile.adapter !== "codex-app-server") return { _tag: "NonCodex" as const }
      const selectedConfiguration = { ...configuration, codexExecutable: selectedProfile.executable }
      const storeContext = yield* Layer.build(
        nodeCodexAttemptStoreLayer({ stateDirectory: configuration.codexExecutorPrivateStateDirectory }).pipe(
          Layer.provide(NodeServices.layer)
        )
      )
      const attemptStore = Context.get(storeContext, CodexAttemptStore)
      const startup = yield* attemptStore.readServerStartup()
      if (
        Option.isNone(startup) &&
        (yield* inspectCodexIntegratorRetainedThreads(configuration.integratorPrivateStore).pipe(
          Effect.provide(NodeServices.layer),
          Effect.mapError(
            (error) => new CodexAppServerFailure({ detail: error.detail, kind: "Ownership", operation: "initialize" })
          )
        ))
      )
        return yield* new CodexAppServerFailure({
          detail: "retained integrator threads have no proven provider-home namespace; no provider was started",
          kind: "Ownership",
          operation: "initialize"
        })
      if (attemptStore.hasRetainedAttempts === undefined || (yield* attemptStore.hasRetainedAttempts())) {
        return yield* new CodexAppServerFailure({
          detail:
            "retained shared-provider attempts have unresolved custody; resolve external writers before separately retiring obsolete development data or using an isolated fresh dataset; no provider was started",
          kind: "Ownership",
          operation: "initialize"
        })
      }
      const attemptStoreLayer = Layer.succeed(CodexAttemptStore, attemptStore)
      const codexProcessNative = adapters.codexProcessNative ?? nodeCodexProcessNativeService
      const requestBoundary = yield* makeRequestCircuit<CodexAppServerRequestOperation, CodexAppServerFailure>({
        onOpen: (operation) =>
          new CodexAppServerFailure({ detail: codexRequestCircuitOpenDetail, kind: "CircuitOpen", operation }),
        policy: codexRequestCircuitPolicy
      })
      const supplied = adapters.codexAppServer?.(selectedConfiguration, requestBoundary)
      const appLayerWithoutApplicationExit: Layer.Layer<
        CodexAppServer,
        ECodex | Layer.Error<ReturnType<typeof defaultCodexAppServerLayer>>,
        ApplicationExitShell
      > =
        supplied ??
        defaultCodexAppServerLayer(
          selectedConfiguration,
          selectedProfile,
          attemptStoreLayer,
          codexProcessNative,
          requestBoundary
        )
      const appLayerWithoutCircuit = appLayerWithoutApplicationExit.pipe(
        Layer.provide(Layer.succeed(ApplicationExitShell, asApplicationExitShellService(applicationExit)))
      )
      const appLayer =
        supplied === undefined
          ? appLayerWithoutCircuit
          : guardedCodexAppServerLayer(appLayerWithoutCircuit, requestBoundary)
      const context = yield* Layer.build(appLayer)
      const app = Context.get(context, CodexAppServer)
      if (app.unattendedPolicyAdmission === undefined) {
        return yield* Effect.fail(
          new CodexAppServerFailure({
            detail: "Codex app-server did not expose effective unattended-policy admission",
            kind: "Protocol",
            operation: "config/read"
          })
        )
      }
      yield* app.unattendedPolicyAdmission
      return { _tag: "CodexAppServer" as const, appServer: app, attemptStore }
    }),
  makeApplicationExit: () =>
    makeHostApplicationExitShell({
      ...(adapters.applicationExitRequestObserver === undefined
        ? {}
        : { requestObserver: adapters.applicationExitRequestObserver }),
      ...(adapters.applicationExitTraceObserver === undefined
        ? {}
        : { traceObserver: adapters.applicationExitTraceObserver })
    }),
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
    onFailure: (failure: ProductionNonRetryableActivationFailure) => Effect.Effect<void>,
    applicationExit: ProductionHostApplicationExitShellService,
    provider: ProductionHostProviderAdmission,
    operation: "Run" | "Cancel" = "Run"
  ) =>
    Layer.unwrap(
      // eslint-disable-next-line complexity -- One production graph resolves optional edge adapters and observation while preserving one scoped service topology.
      Effect.gen(function* () {
        const ownership = yield* CoordinatorOwnership
        const journal = yield* JournalStore
        const lifecycle = yield* RunLifecycleJournal
        const executorLocator = productionExecutorLocator(configuration)
        const selectedProfile = yield* selectedProductionExecutorProfile(configuration)
        const kimiPrivateStateDirectory = productionKimiExecutorPrivateStateDirectory(configuration)
        const workflowApplicationExitObserver = adapters.workflowApplicationExitObserver
        /* v8 ignore start -- @preserve Hermetic host tests replace the live GitHub boundary; this assignment retains the production-only provider default. */
        const githubClientLayer = guardedGithubClientLayer(
          adapters.githubClient?.(configuration) ?? defaultGithubClientLayer(configuration),
          adapters.githubRequestCircuitMaxRequests
        )
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
        if (selectedProfile.adapter === "codex-app-server" && provider._tag !== "CodexAppServer") {
          return yield* Effect.fail(
            new CodexAppServerFailure({
              detail: "Codex Run did not retain its admitted app-server instance",
              kind: "Protocol",
              operation: "config/read"
            })
          )
        }
        const appLayer =
          provider._tag === "CodexAppServer"
            ? Layer.succeed(CodexAppServer, provider.appServer)
            : Layer.effect(
                CodexAppServer,
                Effect.fail(
                  new CodexAppServerFailure({
                    detail: "non-Codex provider has no app-server instance",
                    kind: "Protocol",
                    operation: "initialize"
                  })
                )
              )
        const gitCommandLayer = observedGitCommandLayer(
          nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer)),
          adapters.boundaryObserver
        )
        // IntegrationTarget names the configured repository; Git's --git-dir
        // boundary needs its separately configured canonical common directory.
        const promotionCommands = Layer.effect(
          GitCommand,
          Effect.map(GitCommand, (commands) =>
            productionTargetGitCommands(
              commands,
              GitCommonDirectoryTarget.make(configuration.commonDirectory),
              configuration.repository
            )
          )
        ).pipe(Layer.provide(gitCommandLayer))
        const realPromotion = nodeGitTargetPromotionLayer.pipe(Layer.provide(promotionCommands))
        const observeCompareAndSet = adapters.targetPromotionCompareAndSetObserver
        const promotionLayer =
          observeCompareAndSet === undefined
            ? realPromotion
            : Layer.effect(
                TargetPromotionGit,
                Effect.map(TargetPromotionGit, (git) =>
                  TargetPromotionGit.of({
                    read: git.read,
                    compareAndSet: (request) =>
                      observeCompareAndSet(request).pipe(Effect.andThen(git.compareAndSet(request)))
                  })
                )
              ).pipe(Layer.provide(realPromotion))
        const codexLayers = productionCodexExecutionLayers({
          configuration,
          profile: selectedProfile,
          applicationExit,
          adapters,
          app: appLayer,
          git: gitCommandLayer,
          evidence: evidenceLayer,
          ownership
        })
        const executorLayer =
          selectedProfile.adapter === "kimi-acp"
            ? observedPlannedAttemptExecutorLayer(
                kimiPlannedAttemptExecutorLayer.pipe(
                  Layer.provide(
                    nodeKimiAcpClientLayer(selectedProfile, {
                      preflightCwd: configuration.repository,
                      preflightProtocol: true
                    }).pipe(Layer.provide(NodeServices.layer))
                  ),
                  Layer.provide(
                    nodeKimiAttemptPrivateStoreLayer({ stateDirectory: kimiPrivateStateDirectory }).pipe(
                      Layer.provide(NodeServices.layer)
                    )
                  ),
                  Layer.provide(evidenceLayer),
                  Layer.provide(gitCommandLayer),
                  Layer.provide(NodeCrypto.layer),
                  Layer.provide(NodeServices.layer)
                ),
                adapters.boundaryObserver
              )
            : observedPlannedAttemptExecutorLayer(
                codexLayers.executor,
                adapters.boundaryObserver,
                selectedProfile.worktreePreparation === undefined
                  ? undefined
                  : nodeAttemptWorktreePreparationService(configuration.codexExecutorPrivateStateDirectory, {
                      executable: nodeProcess.execPath,
                      args: ["scripts/prepare-attempt-worktree.mjs"]
                    })
              )
        const integratorConfiguration = codexLayers.integratorConfiguration
        const integratorLayer = observedIntegratorLayer(codexLayers.integrator, adapters.boundaryObserver)
        const selectedIntegratorLayer =
          selectedProfile.adapter === "kimi-acp"
            ? nodeKimiIntegratorLayer(
                CodexIntegratorConfiguration.make({
                  ...integratorConfiguration,
                  privateStoreLocator: IntegratorPrivateStoreLocator.make(
                    `${configuration.integratorPrivateStore}.kimi`
                  )
                }),
                nodeKimiAcpClientLayer(selectedProfile, {
                  preflightCwd: configuration.repository,
                  preflightProtocol: true
                }).pipe(Layer.provide(NodeServices.layer))
              ).pipe(
                Layer.provide(NodeServices.layer),
                Layer.provide(gitCommandLayer),
                Layer.provide(Layer.succeed(CoordinatorOwnership, ownership))
              )
            : integratorLayer
        const sharedServices = Layer.mergeAll(
          githubAuthorityLayer,
          evidenceLayer,
          executorLayer,
          selectedIntegratorLayer,
          promotionLayer,
          adapters.workflowTrace?.() ?? defaultWorkflowTraceLayer
        )
        const services = yield* Layer.build(sharedServices)
        const tracker = Context.get(services, TrackerMutation)
        const trackerReader = Context.get(services, TrackerGraphReader)
        const completionClaim = Context.get(services, CompletionClaimBoundary)
        const completionTask = Context.get(services, CompletionTaskBoundary)
        const evidence = Context.get(services, EvidenceStore)
        const executor = Context.get(services, PlannedAttemptExecutor)
        const executorLifecycle = Context.get(services, PlannedAttemptExecutorLifecycleObservation)
        const integrator = Context.get(services, Integrator)
        const targetPromotionGit = Context.get(services, TargetPromotionGit)
        const candidateAuthority = Context.get(services, IntegratorCandidateProviderAuthority)
        const trace = Context.get(services, WorkflowTrace)
        const journalLayer = Layer.merge(
          Layer.succeed(JournalStore, journal),
          Layer.succeed(RunLifecycleJournal, lifecycle)
        )
        const planningLayer = Layer.merge(
          productionPlannedTaskAttemptLayer(
            { ...configuration, plannedAttemptExecutor: executorLocator },
            selection.runId
          ),
          taskClaimAcquisitionPlannerLayer(configuration.claimOwner).pipe(Layer.provide(NodeCrypto.layer))
        )
        const workflowLayer = productionWorkflowInterpreterLayer(
          selection.runId,
          GitCommonDirectoryTarget.make(configuration.commonDirectory),
          configuration.repository,
          IntegrationTarget.make({ repository: configuration.repository, ref: configuration.integrationRef }),
          Layer.succeed(TrackerMutation, tracker),
          Layer.merge(
            Layer.succeed(PlannedAttemptExecutor, executor),
            Layer.succeed(PlannedAttemptExecutorLifecycleObservation, executorLifecycle)
          ),
          candidateAuthority,
          {
            attemptBasePolicy: {
              _tag: "QualifiedCurrentIntegrationHead",
              lineageAnchor: configuration.plannedAttemptBaseSha,
              integrationTarget: IntegrationTarget.make({
                repository: configuration.repository,
                ref: configuration.integrationRef
              }),
              executionRepository: configuration.repository
            },
            acceptedResultEvidenceStore: evidence,
            completionTask,
            coordinatorOwnership: ownership,
            integrationFinality: completionClaim,
            integrator,
            remotePublicationTarget: configuration.remotePublicationTarget,
            ...(adapters.remoteBaselineGitLayer === undefined
              ? {}
              : { remoteBaselineGitLayer: adapters.remoteBaselineGitLayer }),
            ...(adapters.remotePublicationGitLayer === undefined
              ? {}
              : { remotePublicationGitLayer: adapters.remotePublicationGitLayer }),
            targetPromotion: { git: targetPromotionGit },
            journalStoreLayer: journalLayer,
            applicationExit: { _tag: "SuppliedHostShell", shell: applicationExit },
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
          Layer.provideMerge(Layer.succeed(TrackerGraphReader, trackerReader)),
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
            ...(operation === "Cancel" ? { cancelBeforeDelivery: true } : {}),
            ...(adapters.onActivationFinalizationStart === undefined
              ? {}
              : { onActivationFinalizationStart: adapters.onActivationFinalizationStart }),
            ...(adapters.onActivationHandoffIdle === undefined
              ? {}
              : { onActivationHandoffIdle: adapters.onActivationHandoffIdle }),
            ...(adapters.onTimerStateChange === undefined ? {} : { onTimerStateChange: adapters.onTimerStateChange }),
            ...(adapters.onAcceptedRunControl === undefined
              ? {}
              : { onAcceptedRunControl: adapters.onAcceptedRunControl }),
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

/** The outer caller installs its transport before acquisition and reports an application-only Exit. */
export interface ProductionHostStartup<A, E, R> {
  readonly installTransport: (
    boundary: ApplicationExitRequestBoundaryService
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly presentResult: (result: ApplicationExitResult) => Effect.Effect<A, E, R>
}

/**
 * Alice invokes one configured production host. Configuration is decoded
 * before live acquisition; the callback receives a scoped observation only
 * after the selected Run's durable beginning has been acknowledged.
 */
export const withDecodedProductionRepositoryHost = <
  A,
  EUse,
  RUse,
  EFoundation,
  RFoundation,
  ERun,
  RRun,
  EActivation,
  EProvider,
  EStartup = never,
  RStartup = never
>(
  configuration: ProductionRepositoryHostConfiguration,
  graph: ProductionRepositoryHostGraph<EFoundation, RFoundation, ERun, RRun, EActivation, EProvider>,
  use: (observation: ProductionRunningHostObservation<EActivation>) => Effect.Effect<A, EUse, RUse>,
  operation: "Run" | "Cancel" = "Run",
  lifetime: "Invocation" | "Listening" = "Invocation",
  startup?: ProductionHostStartup<A, EStartup, RStartup>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const applicationExit = yield* graph.makeApplicationExit()
      const acquired = yield* acquireProductionHost(
        applicationExit,
        Effect.gen(function* () {
          const foundation = yield* Layer.build(graph.foundation(configuration))
          const discovery = yield* (
            operation === "Cancel"
              ? discoverProductionCancellationRun(configuration.target)
              : discoverProductionRun(configuration.target)
          ).pipe(Effect.provide(foundation))
          if (operation === "Cancel" && discovery._tag === "Fresh") {
            return yield* new ProductionCancellationRunNotFound()
          }
          const provider = yield* graph.acquireProvider(configuration, applicationExit)
          const selection = yield* selectDiscoveredProductionRun(configuration.target, discovery)
          const traceReaderContext = yield* Layer.build(TraceReaderLayer).pipe(Effect.provide(foundation))
          const traceReader = Context.get(traceReaderContext, TraceReader)
          const activationFailure = yield* Deferred.make<never, EActivation>()
          const retainedFailure = yield* Ref.make<Option.Option<EActivation>>(Option.none())
          const run = yield* Layer.build(
            graph.run(
              configuration,
              selection,
              (failure) =>
                Ref.set(retainedFailure, Option.some(failure)).pipe(
                  Effect.andThen(Deferred.fail(activationFailure, failure)),
                  Effect.asVoid
                ),
              applicationExit,
              provider,
              operation
            )
          ).pipe(Effect.provide(foundation))
          const source = Context.get(run, JournaledRunObservationSource)
          const bootstrap = Context.getOption(run, JournaledRunBootstrap)
          yield* Effect.raceFirst(source.awaitEstablished, Deferred.await(activationFailure))
          const archiveMaintenance = yield* makeHostArchiveMaintenance(() =>
            observeArchiveRetention(
              selection.runId,
              Context.get(foundation, RunLifecycleJournal),
              defaultJournalMaintenanceObservation
            )
          )
          yield* applicationExit.registerProcessLocalDrain({
            owner: { name: "ArchiveMaintenance", subject: { _tag: "Run", runId: selection.runId } },
            closeProcessLocalResources: archiveMaintenance.stop
          })
          // An uncertain append retains its boundary until this exact Journal is
          // reconstructed. Client request IDs never authorize replay.
          const attachedRunControlBoundary = yield* Ref.make<"Open" | "NeedsJournalReconciliation">("Open")
          const attachedRunControlCommands = yield* Semaphore.make(1)
          const acceptedReader = Context.getOption(run, AcceptedJournalReader)
          const completionReader = Context.get(foundation, RunLifecycleJournal)
          const readRunControl = Effect.gen(function* () {
            const completion = yield* completionReader
              .readCompletion(selection.runId)
              .pipe(Effect.mapError(() => new ProductionPassiveControlUnavailable({})))
            if (completion._tag === "CompletedRun") {
              const observedAt = TraceCursor.make({
                runId: selection.runId,
                position: completion.completion.terminatedAt
              })
              return {
                direction: "RunTerminated" as const,
                observedAt,
                completionResult: completion,
                completion: completion.completion,
                termination: { disposition: completion.completion.disposition, terminatedAt: observedAt }
              } satisfies ProductionPassiveRunControl
            }
            if (Option.isNone(acceptedReader)) return yield* new ProductionPassiveControlUnavailable({})
            const prefix = yield* acceptedReader.value
              .readAccepted(selection.runId)
              .pipe(Effect.mapError(() => new ProductionPassiveControlUnavailable({})))
            const last = journalRecordAt(prefix.records, prefix.records.length - 1)
            if (last === undefined || prefix.runId !== selection.runId) {
              return yield* new ProductionPassiveControlUnavailable({})
            }
            // The reader certifies this exact accepted prefix. Inspect only applied
            // control occurrences, without revalidating or copying workflow history.
            const controls = acceptedJournalRecordsForKind(prefix, "ControlDirectionApplied")
            let direction: "RunPaused" | "RunUnpaused" = "RunUnpaused"
            for (let index = controls.length - 1; index >= 0; index -= 1) {
              const control = journalRecordAt(controls, index)
              if (control?.event._tag === "ControlDirectionApplied" && control.event.subject._tag === "Run") {
                direction = control.event.direction === "Pause" ? "RunPaused" : "RunUnpaused"
                break
              }
            }
            const terminalRecords = acceptedJournalRecordsForKind(prefix, "WorkflowRunTerminated")
            const terminal = journalRecordAt(terminalRecords, terminalRecords.length - 1)
            return {
              direction: terminal?.event._tag === "WorkflowRunTerminated" ? ("RunTerminated" as const) : direction,
              observedAt: TraceCursor.make({ runId: selection.runId, position: last.position }),
              termination:
                terminal?.event._tag === "WorkflowRunTerminated"
                  ? {
                      disposition: terminal.event.disposition,
                      terminatedAt: TraceCursor.make({ runId: selection.runId, position: terminal.position })
                    }
                  : null
            } satisfies ProductionPassiveRunControl
          })
          // An activation may finish immediately after retaining a failed read.
          // Diagnostics follow accepted history even while execution is idle.
          const readDiagnosticCurrent = Effect.gen(function* () {
            const state = yield* source.current.get
            if (state._tag !== "Ready" || Option.isNone(acceptedReader)) return state
            const prefix = yield* acceptedReader.value.readAccepted(selection.runId).pipe(Effect.result)
            if (prefix._tag === "Failure") return state
            return {
              ...state,
              evaluation: {
                ...state.evaluation,
                diagnostics: projectDeliveryDiagnostics(
                  selection.runId,
                  prefix.success,
                  undefined,
                  configuration.target
                )
              }
            }
          })
          const diagnosticCurrent = currentSignalFromCurrentFirstStream(
            Stream.merge(
              source.current.changes.pipe(Stream.map(() => undefined)),
              source.acceptedHistory.changes.pipe(Stream.map(() => undefined))
            ).pipe(
              Stream.mapEffect(() => readDiagnosticCurrent),
              Stream.takeUntil((state) => state._tag === "Closed")
            )
          )
          const diagnosticWatchCurrent = currentSignalFromCurrentFirstStream(
            Stream.merge(
              (source.current.latest ?? source.current).changes.pipe(Stream.map(() => undefined)),
              (source.acceptedHistory.latest ?? source.acceptedHistory).changes.pipe(Stream.map(() => undefined))
            ).pipe(
              Stream.mapEffect(() =>
                readRunningHostWatchCurrent(
                  source.current.latest ?? source.current,
                  Option.getOrUndefined(acceptedReader),
                  selection.runId,
                  configuration.target
                )
              ),
              Stream.takeUntil((state) => state._tag === "Closed")
            )
          )
          const inspection = runningHostInspectionFromServices(run, configuration.target)
          const capacity = Option.isSome(bootstrap)
            ? makeRunningHostCapacity(selection.runId, bootstrap.value.operatorControl, readRunControl)
            : undefined
          const observation = {
            ...(capacity === undefined ? {} : { readAttachedCapacity: capacity.read }),
            ...(Option.isSome(inspection) ? { inspection: inspection.value } : {}),
            acceptedHistory: source.acceptedHistory,
            current: diagnosticCurrent,
            watchCurrent: diagnosticWatchCurrent,
            runTermination: source.runTermination,
            selection,
            traceReader,
            readExitOwners: applicationExit.readOwners,
            applicationExitRequestBoundary: applicationExit.requestBoundary,
            target: configuration.target,
            readRunControl,
            readCommandTermination: completionReader.readCompletion(selection.runId).pipe(
              Effect.map((completion) =>
                completion._tag === "CompletedRun"
                  ? {
                      disposition: completion.completion.disposition,
                      terminatedAt: TraceCursor.make({
                        runId: selection.runId,
                        position: completion.completion.terminatedAt
                      })
                    }
                  : null
              ),
              Effect.mapError(() => new ProductionPassiveControlUnavailable({}))
            ),
            activationFailure: Ref.get(retainedFailure),
            awaitActivationFailure: Deferred.await(activationFailure),
            closing: applicationExit.admission.snapshot.pipe(Effect.map((state) => state.cutoffClosed)),
            commandAdmission: applicationExit.admission,
            awaitExitResult: applicationExit.awaitExitResult.pipe(Effect.asVoid),
            registerObservationDrain: applicationExit.registerProcessLocalDrain,
            executeAttachedCommand: Effect.fn("ProductionHost.executeAttachedCommand")(function* (request) {
              if (request.operation._tag === "SetCapacity") {
                if (capacity === undefined)
                  return yield* Effect.fail<RunningHostError>({
                    _tag: "RunInactive",
                    runId: request.runId,
                    operation: "SetCapacity"
                  })
                return yield* capacity.set({ ...request, operation: request.operation })
              }
              const owner = Context.getOption(run, RunReactivationOwner)
              if (request.operation._tag === "SendExecutorGuidance") {
                const guidanceRequestId = request.operation.guidanceRequestId
                const send = Option.isSome(bootstrap) ? bootstrap.value.operatorControl.sendExecutorGuidance : undefined
                if (send === undefined)
                  return yield* Effect.fail<RunningHostError>({
                    _tag: "CommandFailed",
                    operation: "SendExecutorGuidance",
                    stage: "BeforeApplication",
                    causeTag: "RunOwnerUnavailable",
                    detail: "The guidance Run owner is unavailable."
                  })
                const decoded = Encoding.decodeBase64(request.operation.textBase64)
                if (Result.isFailure(decoded))
                  return yield* Effect.fail<RunningHostError>({
                    _tag: "InvalidRequest",
                    fieldPath: "/operation/text",
                    code: "GuidanceTextInvalid"
                  })
                const text = yield* Effect.try({
                  try: () => new TextDecoder("utf-8", { fatal: true }).decode(decoded.success),
                  catch: (): RunningHostError => ({
                    _tag: "InvalidRequest",
                    fieldPath: "/operation/text",
                    code: "GuidanceTextInvalid"
                  })
                })
                const disposition = yield* send({
                  attemptId: request.operation.attemptId,
                  requestId: request.operation.guidanceRequestId,
                  text
                }).pipe(
                  Effect.mapError(
                    (failure): RunningHostError =>
                      failure._tag === "SchemaError" ||
                      failure._tag === "ExecutorGuidanceIdentityContradiction" ||
                      failure._tag === "JournaledRunNotActive" ||
                      failure._tag === "ApplicationExiting"
                        ? {
                            _tag: "CommandFailed",
                            operation: "SendExecutorGuidance",
                            stage: "BeforeApplication",
                            causeTag: failure._tag,
                            detail: "The exact guidance request was refused."
                          }
                        : {
                            _tag: "CommandOutcomeUnknown",
                            operation: "SendExecutorGuidance",
                            requestId: request.requestId,
                            guidanceRequestId,
                            phase: "AdmittedCompletionUnconfirmed",
                            acceptedAt: null
                          }
                  )
                )
                return {
                  _tag: "ExecutorGuidanceResult" as const,
                  guidanceRequestId: request.operation.guidanceRequestId,
                  disposition
                }
              }
              if (request.operation._tag === "RetryTaskAttemptBase") {
                if (Option.isNone(bootstrap) || Option.isNone(owner))
                  return yield* Effect.fail<RunningHostError>({
                    _tag: "CommandFailed",
                    operation: "RetryTaskAttemptBase",
                    stage: "BeforeApplication",
                    causeTag: "RunOwnerUnavailable",
                    detail: "The Base retry Run owner is unavailable."
                  })
                const applied = yield* bootstrap.value.operatorControl
                  .retryTaskAttemptBase(request.operation.retry)
                  .pipe(
                    Effect.mapError(
                      (error): RunningHostError =>
                        error._tag === "TaskAttemptBaseRetryRejected" ||
                        error._tag === "SchemaError" ||
                        error._tag === "ApplicationExiting" ||
                        error._tag === "JournaledRunNotActive"
                          ? {
                              _tag: "CommandFailed",
                              operation: "RetryTaskAttemptBase",
                              stage: "BeforeApplication",
                              causeTag: error._tag,
                              detail: "The exact Base retry request was refused."
                            }
                          : {
                              _tag: "CommandOutcomeUnknown",
                              operation: "RetryTaskAttemptBase",
                              requestId: request.requestId,
                              phase: "AdmittedCompletionUnconfirmed",
                              acceptedAt: null
                            }
                    )
                  )
                const currentControl = yield* readRunControl.pipe(Effect.result)
                if (currentControl._tag === "Success" && currentControl.success.termination === null)
                  yield* owner.value.hint(RunReactivationHint.OperatorWake())
                return {
                  _tag: "TaskAttemptBaseRetryRecorded" as const,
                  retry: { requestId: applied.requestId, subject: applied.subject },
                  acceptedAt: TraceCursor.make({ runId: applied.subject.runId, position: applied.acceptedAt })
                }
              }
              if (request.operation._tag === "ApplyResultRecoveryDirection") {
                if (Option.isNone(bootstrap) || Option.isNone(owner))
                  return yield* Effect.fail<RunningHostError>({
                    _tag: "CommandFailed",
                    operation: "ApplyResultRecoveryDirection",
                    stage: "BeforeApplication",
                    causeTag: "RunOwnerUnavailable",
                    detail: "The result recovery Run owner is unavailable."
                  })
                const applied = yield* bootstrap.value.operatorControl
                  .applyResultRecoveryDirection(request.operation.recovery)
                  .pipe(
                    Effect.mapError(
                      (error): RunningHostError =>
                        error._tag === "ResultRecoveryNotAvailable" ||
                        error._tag === "ResultRecoveryRequestIdentityContradiction" ||
                        error._tag === "SchemaError" ||
                        error._tag === "ApplicationExiting" ||
                        error._tag === "JournaledRunNotActive"
                          ? {
                              _tag: "CommandFailed",
                              operation: "ApplyResultRecoveryDirection",
                              stage: "BeforeApplication",
                              causeTag: error._tag,
                              detail: "The exact result recovery direction was refused."
                            }
                          : {
                              _tag: "CommandOutcomeUnknown",
                              operation: "ApplyResultRecoveryDirection",
                              requestId: request.requestId,
                              phase: "AdmittedCompletionUnconfirmed",
                              acceptedAt: null
                            }
                    )
                  )
                yield* owner.value.hint(RunReactivationHint.OperatorWake())
                return {
                  _tag: "ResultRecoveryDirectionRecorded" as const,
                  recovery: {
                    direction: applied.event.direction,
                    requestId: applied.event.requestId,
                    subject: applied.event.subject
                  },
                  acceptedAt: TraceCursor.make({ runId: applied.runId, position: applied.position })
                }
              }
              if (request.operation._tag === "StartWork" || request.operation._tag === "Refresh") {
                if (Option.isNone(owner))
                  return yield* Effect.fail<RunningHostError>({
                    _tag: "CommandFailed",
                    operation: request.operation._tag,
                    stage: "BeforeApplication",
                    causeTag: "RunOwnerUnavailable",
                    detail: "The Run owner is unavailable."
                  })
                if (request.operation._tag === "Refresh") {
                  yield* owner.value.hint(RunReactivationHint.TrackerNotification())
                  return { _tag: "RefreshSubmitted" as const, interest: request.operation.interest }
                }
                yield* owner.value.hint(RunReactivationHint.OperatorWake())
                return { _tag: "WakeSubmitted" as const }
              }
              return yield* attachedRunControlCommands.withPermit(
                Effect.gen(function* () {
                  const operation = request.operation._tag
                  if (Option.isNone(bootstrap))
                    return yield* Effect.fail<RunningHostError>({
                      _tag: "CommandFailed",
                      operation,
                      stage: "BeforeApplication",
                      causeTag: "RunControlUnavailable",
                      detail: "The Run control boundary is unavailable."
                    })
                  if ((yield* Ref.get(attachedRunControlBoundary)) === "NeedsJournalReconciliation")
                    return yield* Effect.fail<RunningHostError>({
                      _tag: "CommandFailed",
                      operation,
                      stage: "BeforeApplication",
                      causeTag: "UnreconciledRunControl",
                      detail: "The previous Run control application requires Journal reconciliation."
                    })
                  if (operation === "Cancel") {
                    if (Option.isNone(owner))
                      return yield* Effect.fail<RunningHostError>({
                        _tag: "CommandFailed",
                        operation,
                        stage: "BeforeApplication",
                        causeTag: "RunOwnerUnavailable",
                        detail: "The Run cancellation owner is unavailable."
                      })
                    const applied = yield* bootstrap.value.operatorControl
                      .applyRunCancellation({ runId: request.runId })
                      .pipe(
                        Effect.catch((error) =>
                          error._tag === "ApplicationExiting" || error._tag === "JournaledRunNotActive"
                            ? Effect.fail<RunningHostError>({
                                _tag: "CommandFailed",
                                operation,
                                stage: "BeforeApplication",
                                causeTag: error._tag,
                                detail: "The Run cancellation boundary is unavailable."
                              })
                            : Ref.set(attachedRunControlBoundary, "NeedsJournalReconciliation").pipe(
                                Effect.andThen(
                                  Effect.fail<RunningHostError>({
                                    _tag: "CommandOutcomeUnknown",
                                    operation,
                                    requestId: request.requestId,
                                    phase: "AdmittedCompletionUnconfirmed",
                                    acceptedAt: null
                                  })
                                )
                              )
                        )
                      )
                    if (applied._tag === "RunCancellationRunTerminated")
                      return yield* Effect.fail<RunningHostError>({
                        _tag: "RunClosed",
                        runId: request.runId,
                        disposition: applied.disposition,
                        terminatedAt: TraceCursor.make({ runId: request.runId, position: applied.terminatedAt })
                      })
                    const acceptedAt = TraceCursor.make({ runId: request.runId, position: applied.appliedAt })
                    yield* owner.value.hint(RunReactivationHint.CancellationApplied())
                    return { _tag: "CancelApplied" as const, acceptedAt }
                  }
                  const applied = yield* bootstrap.value.operatorControl
                    .applyControlDirection({
                      direction: operation === "Pause" ? "Pause" : "Unpause",
                      subject: { _tag: "Run", runId: request.runId }
                    })
                    .pipe(
                      Effect.catchTag("AcceptedRunControlCallbackFailed", (error) =>
                        Effect.fail<RunningHostError>({
                          _tag: operation === "Pause" ? "PausePartiallyApplied" : "UnpausePartiallyApplied",
                          ordinal: error.ordinal,
                          acceptedAt: error.acceptedAt,
                          causeTag: error._tag,
                          detail: "The accepted Run control owner callback did not complete."
                        })
                      ),
                      Effect.catchTag("ApplicationExiting", () =>
                        Effect.fail<RunningHostError>({
                          _tag: "CommandFailed",
                          operation,
                          stage: "BeforeApplication",
                          causeTag: "ApplicationExiting",
                          detail: "The application cutoff prevented control application."
                        })
                      ),
                      Effect.catch((error) =>
                        error._tag === "UnpausePartiallyApplied" ||
                        error._tag === "PausePartiallyApplied" ||
                        error._tag === "CommandFailed"
                          ? Effect.fail(error)
                          : Ref.set(attachedRunControlBoundary, "NeedsJournalReconciliation").pipe(
                              Effect.andThen(
                                Effect.fail<RunningHostError>({
                                  _tag: "CommandOutcomeUnknown",
                                  operation,
                                  requestId: request.requestId,
                                  phase: "AdmittedCompletionUnconfirmed",
                                  acceptedAt: null
                                })
                              )
                            )
                      )
                    )
                  if (applied.event._tag !== "ControlDirectionApplied")
                    return yield* Effect.die("Run control application returned another event")
                  return {
                    _tag: operation === "Pause" ? ("PauseApplied" as const) : ("UnpauseApplied" as const),
                    ordinal: applied.event.ordinal,
                    acceptedAt: TraceCursor.make({ runId: applied.runId, position: applied.position })
                  }
                })
              )
            }),
            ...(Option.isSome(bootstrap)
              ? {
                  taskAttemptBaseRetryControl: bootstrap.value.operatorControl,
                  remotePublicationControl: bootstrap.value.operatorControl,
                  resultRecoveryControl: bootstrap.value.operatorControl
                }
              : {})
          } satisfies ProductionRunningHostObservation<EActivation>
          return { observation, activationFailure }
        }),
        startup?.installTransport(applicationExit.requestBoundary) ?? Effect.void
      )
      if (acquired._tag === "ExitedBeforeObservation") {
        if (startup === undefined) return yield* new ApplicationExiting({})
        return yield* startup.presentResult(acquired.result)
      }
      const { activationFailure, observation } = acquired.value
      // Invocation callers end their scope on an activation failure. A listening
      // host retains that failure for passive readers and keeps its existing
      // coordinator and listener until the caller requests application Exit.
      if (lifetime === "Listening") return yield* use(observation)
      return yield* Effect.raceFirst(use(observation), Deferred.await(activationFailure))
    })
  )

/** Raw callers cross the #259 schema authority exactly once before live acquisition. */
export const withProductionRepositoryHost = <
  A,
  EUse,
  RUse,
  EFoundation,
  RFoundation,
  ERun,
  RRun,
  EActivation,
  EProvider
>(
  input: unknown,
  graph: ProductionRepositoryHostGraph<EFoundation, RFoundation, ERun, RRun, EActivation, EProvider>,
  use: (observation: ProductionHostObservation) => Effect.Effect<A, EUse, RUse>
) =>
  decodeProductionRepositoryHostConfiguration(input).pipe(
    Effect.flatMap((configuration) => withDecodedProductionRepositoryHost(configuration, graph, use))
  )
