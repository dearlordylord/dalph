import { makeCompleteDeliveryTracker } from "./production-complete-delivery-tracker.js"
import { makeRunningHostTrackerEdits } from "./production-running-host-tracker-edits.js"
import { runningHostProviderBody } from "./production-running-host-fixture-request.js"
import {
  attachControlledResultCompletions,
  makeRetainedTaskResultSelector
} from "./production-running-host-result-cycle.js"
import { isolatedCodexProcessNativeService } from "./isolated-codex-process-native.js"
import {
  type ControlledProviderDiagnostics,
  type PausedRunningHostFixture,
  reactivationObserversFor,
  projectControlledThread,
  failControlledGraphRead,
  failControlledIntegrationRead,
  failControlledProviderClose
} from "./production-running-host-provider-controls.js"
import { githubGraphqlBatchTestClient } from "../../orchestrator/src/authorities/task-tracker/github/graphql-client.test-fixture.js"
import { GitCommitSha, RemotePublicationTarget, RemotePublicationEndpoint, RunId } from "@dalph/contracts"
import {
  AttemptBasePolicy,
  type GithubGraphqlReadThrottled,
  type GithubGraphqlRequestError,
  RunReactivationOwner,
  GithubIssueNodeId,
  githubTaskIdFor,
  GitCommand,
  type RemotePublicationGit,
  GithubGraphqlClient,
  nodeGitCommandLayer,
  type GithubGraphqlRequest,
  JournalStore,
  journalStoreCapabilities,
  sqliteJournalTestLayer,
  productionCoordinatorOwnershipLayer,
  GitCommonDirectoryTarget,
  InitialControlPolicy,
  ControlDirectionAppliedEvent,
  ControlDirectionApplicationOrdinal,
  workflowJournalEventVersion,
  JournaledRunBootstrap
} from "@dalph/orchestrator"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { Context, Deferred, Duration, Effect, FileSystem, Layer, Ref, Stream } from "effect"
import {
  CodexAppServer,
  CodexThreadListSummary,
  type CodexThreadSnapshot
} from "../src/application/codex-app-server.js"
import { createHermeticFixture } from "./production-hermetic-fixture.js"
import { makeHermeticProviderState } from "./production-hermetic-provider-state.js"
import { ProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import { hermeticQualificationTrackerIdentity } from "../src/application/production-hermetic-contract.js"
import { ProductionRunReactivationInterval } from "../src/application/production.js"
import { productionRepositoryHostGraph } from "../src/application/production-host.js"
import { controlDirectionAppliedRecordKey } from "../../orchestrator/src/workflow-journal/record-key.js"

export const runningHostFixtureLayer = nodeGitCommandLayer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.merge(NodeCrypto.layer)
)
const successfulHttpStatus = 200

/** One production composition keeps real Git/SQLite and substitutes only provider responses. */
export const makeRunningHostFixture = Effect.fn("RunningHostFixture.make")(function* (
  builtEntry: string,
  includeBlockedChildren = false,
  paused?: PausedRunningHostFixture,
  discovery?: {
    readonly completeDelivery?: boolean
    readonly remotePublicationGitLayer?: (
      configuration: ProductionRepositoryHostConfiguration
    ) => Layer.Layer<RemotePublicationGit>
    readonly startupIncludesE?: boolean
    readonly independentB?: boolean
    readonly authoredIntermediateD?: boolean
    readonly onExecutorTurnStarted?: () => Effect.Effect<void>
    readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
    readonly onRootGraphRead?: () => Effect.Effect<void>
    readonly onActivationIdle?: () => Effect.Effect<void>
    readonly beforeArchiveCommit?: () => Effect.Effect<void, string>
    readonly onActivationFailure?: () => Effect.Effect<void>
  },
  interruptStopsTurn = false,
  diagnostics?: ControlledProviderDiagnostics
) {
  const fileSystem = yield* FileSystem.FileSystem
  const git = yield* GitCommand
  const fixture = yield* createHermeticFixture(
    builtEntry,
    GitCommitSha.make("700d3110d13dc132175d34720484285f9c0cf83f")
  )
  yield* Effect.addFinalizer(() =>
    fileSystem.remove(fixture.container, { force: true, recursive: true }).pipe(Effect.orDie)
  )
  const remoteRepository = `${fixture.container}/remote.git`
  const cloned = yield* git.runInWorktree(fixture.configuration.repository, [
    "clone",
    "--bare",
    fixture.configuration.repository,
    remoteRepository
  ])
  if (cloned.exitCode !== 0) return yield* Effect.die("fixture bare clone failed")
  const configuration = ProductionRepositoryHostConfiguration.make({
    ...fixture.configuration,
    activationInterval: ProductionRunReactivationInterval.make(Duration.minutes(1)),
    remotePublicationTarget: RemotePublicationTarget.make({
      endpoint: RemotePublicationEndpoint.make(remoteRepository),
      branch: fixture.configuration.remotePublicationTarget.branch
    })
  })
  const turnEntered = yield* Deferred.make<void>()
  const turnCompletedHint = yield* Deferred.make<void>()
  const turnTerminalVisible = yield* Ref.make(false)
  const completionEntered = yield* Deferred.make<void>()
  const releaseCompletion = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() =>
    Effect.all([Deferred.succeed(turnCompletedHint, undefined), Deferred.succeed(releaseCompletion, undefined)]).pipe(
      Effect.asVoid
    )
  )
  const closeFailureEnabled = yield* Ref.make(false)
  const rejectResult = yield* Ref.make(diagnostics?.rejectResult === true)
  const selectRetainedTaskResult = yield* makeRetainedTaskResultSelector
  const provider = yield* makeHermeticProviderState(
    configuration,
    (boundary) =>
      boundary._tag === "CompletionResponse"
        ? Deferred.succeed(completionEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseCompletion)))
        : Effect.void,
    fixture.manifest.invocationId,
    diagnostics?.rejectResult !== true ? undefined : selectRetainedTaskResult
  )
  // The shutdown fixture acknowledges interrupt, then reconciliation observes an idle interrupted turn.
  const interrupted = yield* Ref.make(false)
  const maskThread = (thread: CodexThreadSnapshot, visible: boolean, stopped: boolean, rejected: boolean) =>
    projectControlledThread(thread, visible, stopped, rejected)
  const integrationCensusCalls = yield* Ref.make(0)
  const codex = CodexAppServer.of({
    ...provider.codex,
    interruptTurn: (threadId, turnId) =>
      provider.codex
        .interruptTurn(threadId, turnId)
        .pipe(Effect.andThen(interruptStopsTurn ? Ref.set(interrupted, true) : Effect.void)),
    unattendedPolicyAdmission: Effect.void,
    attachTurnCompletedHints: Effect.succeed(Stream.empty),
    attachExactTurnCompletedHints: attachControlledResultCompletions(turnCompletedHint),
    listThreads: (cwd) =>
      failControlledIntegrationRead(
        cwd,
        configuration.integratorCandidateWorktreeRoot,
        diagnostics?.integratorReadFailure,
        integrationCensusCalls
      ).pipe(
        Effect.andThen(
          (provider.codex.listThreads ?? (() => Effect.die("fixture requires thread listing")))().pipe(
            Effect.zip(Ref.get(turnTerminalVisible)),
            Effect.map(([threads, visible]) =>
              visible
                ? threads
                : threads.map((thread) =>
                    thread._tag === "CompleteSummary"
                      ? CodexThreadListSummary.CompleteSummary({
                          ...thread,
                          summary: {
                            status: "active",
                            turns: thread.summary.turns.map((turn) => ({ ...turn, status: "inProgress" as const }))
                          }
                        })
                      : thread
                  )
            )
          )
        )
      ),
    readThread: (id) =>
      provider.codex
        .readThread(id)
        .pipe(
          Effect.flatMap((thread) =>
            Effect.all([Ref.get(turnTerminalVisible), Ref.get(interrupted), Ref.get(rejectResult)]).pipe(
              Effect.map(([visible, stopped, rejected]) => maskThread(thread, visible, stopped, rejected))
            )
          )
        ),
    resumeThread: (id, cwd) =>
      provider.codex
        .resumeThread(id, cwd)
        .pipe(
          Effect.flatMap((thread) =>
            Effect.all([Ref.get(turnTerminalVisible), Ref.get(interrupted), Ref.get(rejectResult)]).pipe(
              Effect.map(([visible, stopped, rejected]) => maskThread(thread, visible, stopped, rejected))
            )
          )
        ),
    startTurn: (...args) =>
      provider.codex.startTurn(...args).pipe(
        Effect.tap(() => Ref.update(trackerEdits.observationOrder, (all) => [...all, "ExecutorBegin"])),
        Effect.tap(() => discovery?.onExecutorTurnStarted?.() ?? Effect.void),
        Effect.tap(() => Deferred.succeed(turnEntered, undefined)),
        Effect.flatMap((turn) =>
          Ref.get(turnTerminalVisible).pipe(
            Effect.map((visible) => (visible ? turn : { ...turn, status: "inProgress" as const }))
          )
        )
      )
  })
  const rootNode = hermeticQualificationTrackerIdentity.issueNodeId
  const childB =
    discovery?.independentB === true
      ? hermeticQualificationTrackerIdentity.dependantIssueNodeId
      : GithubIssueNodeId.make("running-host-B")
  const childC = GithubIssueNodeId.make("running-host-C")
  const childE = GithubIssueNodeId.make("running-host-E")
  const trackerEdits = yield* makeRunningHostTrackerEdits(
    rootNode,
    childB,
    childC,
    childE,
    includeBlockedChildren,
    discovery
  )
  const completeDelivery =
    discovery?.completeDelivery === true
      ? yield* makeCompleteDeliveryTracker(rootNode, childC, childB, childE, discovery.onRootGraphRead)
      : undefined
  const nodeIds = [rootNode, childB, childC, childE]
  const taskIds = nodeIds.map((node) => githubTaskIdFor(hermeticQualificationTrackerIdentity.repositoryNodeId, node))
  const trackerCalls = yield* Ref.make(0)
  const gitCalls = yield* Ref.make(0)
  const gitInvocations = yield* Ref.make<
    ReadonlyArray<{ readonly locator: string; readonly args: ReadonlyArray<string> }>
  >([])
  const exitCalls = yield* Ref.make(0)
  const exitEvents = yield* Ref.make<ReadonlyArray<unknown>>([])
  const graphReadFailure = yield* Ref.make<GithubGraphqlReadThrottled | GithubGraphqlRequestError | null>(null)
  const github = githubGraphqlBatchTestClient((request: GithubGraphqlRequest) =>
    Effect.gen(function* () {
      yield* Ref.update(trackerCalls, (count) => count + 1)
      yield* Ref.update(trackerEdits.observationOrder, (all) => [
        ...all,
        `${request._tag}:${"issueNodeId" in request ? request.issueNodeId : "root"}`
      ])
      yield* failControlledGraphRead(request, graphReadFailure)
      const authored = yield* completeDelivery?.respond(request) ?? trackerEdits.respond(request)
      if (authored !== undefined) return authored
      return yield* provider.github(runningHostProviderBody(request)).pipe(
        Effect.orDie,
        Effect.flatMap((response) =>
          response.status === successfulHttpStatus
            ? Effect.succeed({ body: response.body })
            : Effect.die(`controlled GitHub returned ${response.status}`)
        )
      )
    })
  )
  const failures = yield* Ref.make<ReadonlyArray<unknown>>([])
  const activationFinalizing = yield* Deferred.make<void>()
  const activationIdle = yield* Deferred.make<void>()
  const releaseObservationCut = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() => Deferred.succeed(releaseObservationCut, undefined).pipe(Effect.asVoid))
  const ownerReady = yield* Deferred.make<RunReactivationOwner["Service"]>()
  const productionGraph = productionRepositoryHostGraph({
    ...reactivationObserversFor(paused),
    ...(discovery?.remotePublicationGitLayer === undefined
      ? {}
      : { remotePublicationGitLayer: discovery.remotePublicationGitLayer(configuration) }),
    ...(discovery?.onTimerStateChange === undefined ? {} : { onTimerStateChange: discovery.onTimerStateChange }),
    githubRequestCircuitMaxRequests: 2000,
    ...(diagnostics?.rejectResult !== true ? {} : { codexProcessNative: isolatedCodexProcessNativeService }),
    onActivationFinalizationStart: () =>
      Deferred.succeed(activationFinalizing, undefined).pipe(Effect.andThen(Deferred.await(releaseObservationCut))),
    onActivationHandoffIdle: () =>
      Deferred.succeed(activationIdle, undefined).pipe(
        Effect.andThen(discovery?.onActivationIdle?.() ?? Effect.void),
        Effect.asVoid
      ),
    workflowGitCommandObserver: (_method, invocation) =>
      Ref.update(gitCalls, (count) => count + 1).pipe(
        Effect.andThen(Ref.update(gitInvocations, (all) => [...all, invocation]))
      ),
    applicationExitRequestObserver: () => Ref.update(exitCalls, (count) => count + 1),
    applicationExitTraceObserver: (event) => Ref.update(exitEvents, (events) => [...events, event]),
    onActivationFailure: (failure) =>
      Ref.update(failures, (all) => [...all, failure]).pipe(
        Effect.andThen(discovery?.onActivationFailure?.() ?? Effect.void)
      ),
    codexAppServer: () =>
      Layer.effect(
        CodexAppServer,
        Effect.addFinalizer(() => provider.codex.close.pipe(Effect.orDie)).pipe(Effect.as(codex))
      ),
    githubClient: () => Layer.succeed(GithubGraphqlClient, github)
  })
  const bootstrapReady = yield* Deferred.make<JournaledRunBootstrap["Service"]>()
  const pausedStore = yield* Deferred.make<JournalStore["Service"]>()
  const afterInsert = paused?.afterInsert
  const graph = {
    ...productionGraph,
    ...(diagnostics?.failClose !== true
      ? {}
      : {
          acquireProvider: (...args: Parameters<typeof productionGraph.acquireProvider>) =>
            productionGraph
              .acquireProvider(...args)
              .pipe(Effect.tap(() => Effect.addFinalizer(() => failControlledProviderClose(closeFailureEnabled))))
        }),
    ...(paused === undefined
      ? {
          foundation: (configuration: ProductionRepositoryHostConfiguration) =>
            productionGraph
              .foundation(configuration)
              .pipe(Layer.tap((context) => Deferred.succeed(pausedStore, Context.get(context, JournalStore))))
        }
      : {
          foundation: (configuration: ProductionRepositoryHostConfiguration) =>
            journalStoreCapabilities(
              sqliteJournalTestLayer({
                filename: configuration.journalDatabase,
                ...(discovery?.beforeArchiveCommit === undefined
                  ? {}
                  : { beforeArchiveCommit: discovery.beforeArchiveCommit }),
                ...(afterInsert === undefined ? {} : { onAppendInserted: () => afterInsert() }),
                ...(paused.afterCommit === undefined ? {} : { afterAppendCommit: paused.afterCommit })
              })
            ).pipe(
              Layer.provideMerge(
                productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(configuration.commonDirectory)).pipe(
                  Layer.provide(NodeServices.layer)
                )
              ),
              Layer.tap((context) =>
                Effect.gen(function* () {
                  const store = Context.get(context, JournalStore)
                  yield* Deferred.succeed(pausedStore, store)
                  const runId = RunId.make("paused-client-run")
                  yield* store.beginRun(
                    runId,
                    configuration.target,
                    InitialControlPolicy.make({ taskExecutionCapacity: configuration.taskWorkCapacity }),
                    configuration.remotePublicationTarget,
                    AttemptBasePolicy.cases.QualifiedCurrentIntegrationHead.make({
                      executionRepository: configuration.repository,
                      integrationTarget: { repository: configuration.repository, ref: configuration.integrationRef },
                      lineageAnchor: configuration.plannedAttemptBaseSha
                    })
                  )
                  const ordinal = ControlDirectionApplicationOrdinal.make(1)
                  yield* store.append(
                    runId,
                    controlDirectionAppliedRecordKey(ordinal),
                    ControlDirectionAppliedEvent.make({
                      direction: "Pause",
                      initiatedBy: { _tag: "Operator" },
                      occurrenceClassification: "InitiatedAction",
                      ordinal,
                      subject: { _tag: "Run", runId },
                      version: workflowJournalEventVersion
                    })
                  )
                })
              )
            )
        }),
    run: (...args: Parameters<typeof productionGraph.run>) =>
      productionGraph.run(...args).pipe(
        Layer.tap((context) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(ownerReady, Context.get(context, RunReactivationOwner))
            const bootstrap = Context.getOption(context, JournaledRunBootstrap)
            if (bootstrap._tag === "Some") yield* Deferred.succeed(bootstrapReady, bootstrap.value)
          })
        )
      )
  }
  return {
    configuration,
    configurationPath: fixture.configurationPath,
    graph,
    enableCloseFailure: Ref.set(closeFailureEnabled, true),
    setGraphReadFailure: (failure: GithubGraphqlReadThrottled | GithubGraphqlRequestError | null) =>
      Ref.set(graphReadFailure, failure),
    taskIds,
    observationOrder: trackerEdits.observationOrder,
    authorD: trackerEdits.authorD,
    authorE: completeDelivery?.authorE ?? trackerEdits.authorE,
    setIncompleteEvidence: trackerEdits.setIncompleteEvidence,
    bootstrap: Deferred.await(bootstrapReady),
    retireHistory: (runId: RunId) =>
      Deferred.await(pausedStore).pipe(Effect.flatMap((store) => store.retireTerminalRun(runId))),
    maintainArchive: Deferred.await(pausedStore).pipe(Effect.flatMap((store) => store.maintainArchive())),
    readHistory: (runId: RunId) => Deferred.await(pausedStore).pipe(Effect.flatMap((store) => store.read(runId))),
    readPausedHistory: Deferred.await(pausedStore).pipe(
      Effect.flatMap((store) => store.read(RunId.make("paused-client-run")))
    ),
    releaseObservationCut: Deferred.succeed(releaseObservationCut, undefined).pipe(Effect.asVoid),
    activationFinalizing,
    activationIdle,
    provider,
    integrationCensusCalls,
    allowValidResult: Ref.set(rejectResult, false),
    failures,
    trackerCalls,
    gitCalls,
    gitInvocations,
    exitCalls,
    exitEvents,
    turnEntered,
    completionEntered,
    release: Deferred.succeed(releaseObservationCut, undefined).pipe(
      Effect.andThen(Ref.set(turnTerminalVisible, true)),
      Effect.andThen(Deferred.succeed(turnCompletedHint, undefined)),
      Effect.andThen(Deferred.succeed(releaseCompletion, undefined)),
      Effect.andThen(Deferred.await(ownerReady)),
      Effect.flatMap((owner) => owner.hint({ _tag: "Timer" })),
      Effect.asVoid
    )
  }
})
