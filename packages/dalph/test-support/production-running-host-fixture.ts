import { githubGraphqlBatchTestClient } from "../../orchestrator/src/authorities/task-tracker/github/graphql-client.test-fixture.js"
import { GitCommitSha, RemotePublicationTarget, RemotePublicationEndpoint, RunId } from "@dalph/contracts"
import {
  RunReactivationOwner,
  GithubIssueNodeId,
  githubTaskIdFor,
  GitCommand,
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
import type { CodexTurnId } from "../src/application/codex-attempt-store.js"
import { createHermeticFixture } from "./production-hermetic-fixture.js"
import { makeHermeticProviderState } from "./production-hermetic-provider-state.js"
import { ProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import { hermeticQualificationTrackerIdentity } from "../src/application/production-hermetic-contract.js"
import { ProductionRunReactivationInterval } from "../src/application/production.js"
import { productionRepositoryHostGraph } from "../src/application/production-host.js"
import { controlDirectionAppliedRecordKey } from "../../orchestrator/src/workflow-journal/record-key.js"

interface PausedRunningHostFixture {
  readonly afterInsert?: () => Effect.Effect<void>
  readonly afterCommit?: () => Effect.Effect<void, string>
  readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
  readonly onAcceptedRunControl?: (direction: "Pause" | "Unpause") => Effect.Effect<void>
}

const reactivationObserversFor = (paused: PausedRunningHostFixture | undefined) => ({
  ...(paused?.onTimerStateChange === undefined ? {} : { onTimerStateChange: paused.onTimerStateChange }),
  ...(paused?.onAcceptedRunControl === undefined ? {} : { onAcceptedRunControl: paused.onAcceptedRunControl })
})

export const runningHostFixtureLayer = nodeGitCommandLayer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.merge(NodeCrypto.layer)
)
const successfulHttpStatus = 200
const providerBodyFor = (request: GithubGraphqlRequest) => {
  if (request._tag === "ResolveIssue")
    return {
      query: "query ResolveIssue($fixture: String!) { fixture }",
      variables: {
        owner: request.target.owner,
        repository: request.target.repository,
        issueNumber: request.target.issueNumber
      }
    }
  const { _tag, ...variables } = request
  return { query: `query ${_tag}($fixture: String!) { fixture }`, variables }
}

/** One production composition keeps real Git/SQLite and substitutes only provider responses. */
export const makeRunningHostFixture = Effect.fn("RunningHostFixture.make")(function* (
  builtEntry: string,
  includeBlockedChildren = false,
  paused?: PausedRunningHostFixture,
  discovery?: {
    readonly startupIncludesE?: boolean
    readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
    readonly onRootGraphRead?: () => Effect.Effect<void>
    readonly onActivationIdle?: () => Effect.Effect<void>
  }
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
  const provider = yield* makeHermeticProviderState(
    configuration,
    (boundary) =>
      boundary._tag === "CompletionResponse"
        ? Deferred.succeed(completionEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseCompletion)))
        : Effect.void,
    fixture.manifest.invocationId
  )
  const maskThread = (thread: CodexThreadSnapshot, visible: boolean): CodexThreadSnapshot =>
    visible
      ? thread
      : {
          ...thread,
          status: "active" as const,
          turns: thread.turns.map((turn) => ({ ...turn, status: "inProgress" as const }))
        }
  const codex = CodexAppServer.of({
    ...provider.codex,
    unattendedPolicyAdmission: Effect.void,
    attachTurnCompletedHints: Effect.succeed(Stream.empty),
    attachExactTurnCompletedHints: (threadId, expectedTurnId) =>
      Effect.gen(function* () {
        const expected = yield* Deferred.make<CodexTurnId>()
        if (expectedTurnId !== undefined) yield* Deferred.succeed(expected, expectedTurnId)
        return {
          expectTurnId: (turnId: CodexTurnId) => Deferred.succeed(expected, turnId).pipe(Effect.asVoid),
          hints: Stream.fromEffect(
            Deferred.await(turnCompletedHint).pipe(
              Effect.andThen(Deferred.await(expected)),
              Effect.map((turnId) => ({ threadId, turnId }))
            )
          )
        }
      }),
    listThreads: () =>
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
      ),
    readThread: (id) =>
      provider.codex
        .readThread(id)
        .pipe(
          Effect.flatMap((thread) =>
            Ref.get(turnTerminalVisible).pipe(Effect.map((visible) => maskThread(thread, visible)))
          )
        ),
    resumeThread: (id, cwd) =>
      provider.codex
        .resumeThread(id, cwd)
        .pipe(
          Effect.flatMap((thread) =>
            Ref.get(turnTerminalVisible).pipe(Effect.map((visible) => maskThread(thread, visible)))
          )
        ),
    startTurn: (...args) =>
      provider.codex.startTurn(...args).pipe(
        Effect.tap(() => Deferred.succeed(turnEntered, undefined)),
        Effect.flatMap((turn) =>
          Ref.get(turnTerminalVisible).pipe(
            Effect.map((visible) => (visible ? turn : { ...turn, status: "inProgress" as const }))
          )
        )
      )
  })
  const rootNode = hermeticQualificationTrackerIdentity.issueNodeId
  const childB = GithubIssueNodeId.make("running-host-B")
  const childC = GithubIssueNodeId.make("running-host-C")
  const childE = GithubIssueNodeId.make("running-host-E")
  const includesE = yield* Ref.make(discovery?.startupIncludesE === true)
  const nodeIds = [rootNode, childB, childC, childE]
  const taskIds = nodeIds.map((node) => githubTaskIdFor(hermeticQualificationTrackerIdentity.repositoryNodeId, node))
  const trackerCalls = yield* Ref.make(0)
  const gitCalls = yield* Ref.make(0)
  const exitCalls = yield* Ref.make(0)
  const github = githubGraphqlBatchTestClient((request: GithubGraphqlRequest) =>
    Effect.gen(function* () {
      yield* Ref.update(trackerCalls, (count) => count + 1)
      const connection = (field: "subIssues" | "blockedBy", ids: ReadonlyArray<GithubIssueNodeId>) => ({
        body: {
          data: {
            node: {
              __typename: "Issue",
              id: "issueNodeId" in request ? request.issueNodeId : rootNode,
              [field]: { nodes: ids.map((id) => ({ id })), pageInfo: { endCursor: null, hasNextPage: false } }
            }
          }
        }
      })
      if (request._tag === "ReadSubIssues") {
        if (request.issueNodeId === rootNode && discovery?.onRootGraphRead !== undefined)
          yield* discovery.onRootGraphRead()
        return connection(
          "subIssues",
          includeBlockedChildren && request.issueNodeId === rootNode
            ? [childB, childC, ...((yield* Ref.get(includesE)) ? [childE] : [])]
            : []
        )
      }
      if (includeBlockedChildren && request._tag === "ReadBlockedBy")
        return connection(
          "blockedBy",
          request.issueNodeId === childC
            ? [rootNode, childB, ...((yield* Ref.get(includesE)) ? [childE] : [])]
            : request.issueNodeId === childE ? [rootNode] : []
        )
      if (includeBlockedChildren && request._tag === "ReadIssue" && request.issueNodeId !== rootNode)
        return {
          body: {
            data: {
              node: {
                __typename: "Issue",
                id: request.issueNodeId,
                parent: { id: rootNode },
                repository: { id: hermeticQualificationTrackerIdentity.repositoryNodeId },
                state: "OPEN",
                stateReason: null
              }
            }
          }

        }
      if (includeBlockedChildren && request._tag === "ReadTaskWorkSpecification" && request.issueNodeId !== rootNode) {
        return yield* Effect.die("blocked child must not reach a work-specification read")
      }
      return yield* provider.github(providerBodyFor(request)).pipe(
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
  const releaseObservationCut = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() => Deferred.succeed(releaseObservationCut, undefined).pipe(Effect.asVoid))
  const ownerReady = yield* Deferred.make<RunReactivationOwner["Service"]>()
  const productionGraph = productionRepositoryHostGraph({
    ...reactivationObserversFor(paused),
    ...(discovery?.onTimerStateChange === undefined ? {} : { onTimerStateChange: discovery.onTimerStateChange }),
    ...(discovery?.onActivationIdle === undefined ? {} : { onActivationHandoffIdle: discovery.onActivationIdle }),
    githubRequestCircuitMaxRequests: 2000,
    onActivationFinalizationStart: () =>
      Deferred.succeed(activationFinalizing, undefined).pipe(Effect.andThen(Deferred.await(releaseObservationCut))),
    workflowGitCommandObserver: () => Ref.update(gitCalls, (count) => count + 1),
    applicationExitRequestObserver: () => Ref.update(exitCalls, (count) => count + 1),
    onActivationFailure: (failure) => Ref.update(failures, (all) => [...all, failure]),
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
                    configuration.remotePublicationTarget
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
    graph,
    taskIds,
    authorE: Ref.set(includesE, true),
    bootstrap: Deferred.await(bootstrapReady),
    readHistory: (runId: RunId) => Deferred.await(pausedStore).pipe(Effect.flatMap((store) => store.read(runId))),
    readPausedHistory: Deferred.await(pausedStore).pipe(
      Effect.flatMap((store) => store.read(RunId.make("paused-client-run")))
    ),
    releaseObservationCut: Deferred.succeed(releaseObservationCut, undefined).pipe(Effect.asVoid),
    activationFinalizing,
    provider,
    failures,
    trackerCalls,
    gitCalls,
    exitCalls,
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
