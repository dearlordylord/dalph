/* eslint-disable import/no-nodejs-modules, functional/no-let, functional/no-loop-statements, functional/immutable-data, max-lines -- Disposable changing-graph experiment. */
import { GitCommitSha } from "@dalph/contracts"
import {
  GithubGraphqlClient,
  GithubIssueNodeId,
  JournalStore,
  attachCurrentSignal,
  deliveryStatusOf,
  githubTaskIdFor,
  nodeGitCommandLayer,
  sqliteJournalStoreLayer,
  type DeliveryRuntimeObservationState,
  type DeliveryRuntimeReadyObservation,
  type GithubGraphqlRequest
} from "@dalph/orchestrator"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createServer, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Ref, Stream } from "effect"
import { expect } from "vitest"
import {
  productionRepositoryHostGraph,
  withDecodedProductionRepositoryHost,
  type ProductionHostObservation
} from "@dalph/dalph"
import {
  CodexAppServer,
  CodexThreadListSummary,
  type CodexThreadSnapshot
} from "../../../packages/dalph/src/application/codex-app-server.js"
import { makeHermeticProviderState } from "../../../packages/dalph/test-support/production-hermetic-provider-state.js"
import { createHermeticFixture } from "../../../packages/dalph/test-support/production-hermetic-fixture.js"
import { hermeticQualificationTrackerIdentity } from "../../../packages/dalph/src/application/production-hermetic-contract.js"

const builtEntry = fileURLToPath(new URL("../../../packages/dalph/dist/bin/dalph.js", import.meta.url))
const sourceBaseSha = GitCommitSha.make("f99a2343f5b5d90c08e84b536ffab4a8d562b1fb")
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const clientEntry = fileURLToPath(new URL("./client.mjs", import.meta.url))

const providerBodyFor = (request: GithubGraphqlRequest) => {
  if (request._tag === "ResolveIssue") {
    return {
      query: "query ResolveIssue($fixture: String!) { fixture }",
      variables: {
        owner: request.target.owner,
        repository: request.target.repository,
        issueNumber: request.target.issueNumber
      }
    }
  }
  const { _tag, ...variables } = request
  return { query: `query ${_tag}($fixture: String!) { fixture }`, variables }
}

type WirePublication = {
  readonly _tag: "NotReady" | "Ready" | "Closed"
  readonly runId: string
  readonly acceptedAt?: number | null
  readonly graph?: unknown
  readonly frontier?: unknown
  readonly placements?: unknown
  readonly statuses?: unknown
  readonly final?: WirePublication | null
}

const readyProjection = (
  runId: ProductionHostObservation["selection"]["runId"],
  ready: DeliveryRuntimeReadyObservation,
  statusState: DeliveryRuntimeObservationState
): WirePublication => {
  const graphState = ready.evaluation.current.trackerGraph
  const snapshot = graphState._tag === "GraphEstablished" ? graphState.observation.snapshot : null
  const graph = snapshot?.toWire() ?? null
  return {
    _tag: "Ready",
    runId,
    acceptedAt: ready.evaluation.acceptedAt,
    graph: snapshot === null ? null : { rootTaskId: snapshot.rootTaskId ?? null, snapshot: graph },
    frontier: ready.evaluation.current.ticketDeliveries.source.source.standings,
    placements: ready.evaluation.current.ticketDeliveries.source.placements,
    statuses: {
      run: deliveryStatusOf({ _tag: "Run", runId }, statusState),
      tasks:
        graph?.tasks.map((task) => ({
          taskId: task.id,
          status: deliveryStatusOf({ _tag: "Task", runId, taskId: task.id }, statusState)
        })) ?? []
    }
  }
}

const publicationOf = (
  runId: ProductionHostObservation["selection"]["runId"],
  state: DeliveryRuntimeObservationState
): WirePublication => {
  if (state._tag === "NotReady") return { _tag: "NotReady", runId }
  if (state._tag === "Ready") return readyProjection(runId, state, state)
  return {
    _tag: "Closed",
    runId,
    final: state.final === null ? null : readyProjection(runId, state.final, state)
  }
}

const writeLine = (response: ServerResponse, value: unknown) =>
  Effect.suspend(() => {
    if (response.write(`${JSON.stringify(value)}\n`)) return Effect.void
    return Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          const finish = () => {
            response.off("drain", finish)
            response.off("close", finish)
            resolve()
          }
          response.once("drain", finish)
          response.once("close", finish)
        })
    )
  })

const statusClassificationsOf = (publication: WirePublication) => {
  const statuses = publication.statuses as
    | {
        readonly run?: { readonly entries?: ReadonlyArray<{ readonly classification?: string }> }
        readonly tasks?: ReadonlyArray<{
          readonly taskId: string
          readonly status: { readonly entries?: ReadonlyArray<{ readonly classification?: string }> }
        }>
      }
    | undefined
  return {
    run: statuses?.run?.entries?.map(({ classification }) => classification ?? null) ?? [],
    tasks:
      statuses?.tasks?.map(({ taskId, status }) => ({
        taskId,
        classifications: status.entries?.map(({ classification }) => classification ?? null) ?? []
      })) ?? []
  }
}

const startObservationServer = Effect.fn("InvokeeGraphStream.server")(function* (
  observation: ProductionHostObservation
) {
  const responses = new Set<ServerResponse>()
  const subscriptionFibers = new Set<Fiber.Fiber<void, unknown>>()
  const attachedPublications = new Array<WirePublication>()
  const server = createServer((request, response) => {
    if (request.url !== "/watch") {
      response.statusCode = 404
      response.end()
      return
    }
    response.statusCode = 200
    response.setHeader("content-type", "application/x-ndjson")
    responses.add(response)
    const stream = Effect.scoped(
      Effect.gen(function* () {
        const attachment = yield* attachCurrentSignal(observation.current)
        const attached = publicationOf(observation.selection.runId, attachment.current)
        attachedPublications.push(attached)
        yield* writeLine(response, attached)
        yield* attachment.changes.pipe(
          Stream.runForEach((state) => writeLine(response, publicationOf(observation.selection.runId, state)))
        )
        response.end()
      })
    )
    const fiber = Effect.runFork(stream)
    fiber.addObserver((exit) => {
      if (exit._tag === "Failure" && !response.destroyed) {
        response.destroy(new Error(String(exit.cause)))
      }
    })
    subscriptionFibers.add(fiber)
    response.once("close", () => {
      responses.delete(response)
      void Effect.runPromise(Fiber.interrupt(fiber))
    })
  })
  yield* Effect.addFinalizer(() =>
    Effect.promise(
      async () => {
        for (const response of responses) response.destroy()
        const interrupted = await Promise.allSettled(
          [...subscriptionFibers].map((fiber) => Effect.runPromise(Fiber.interrupt(fiber)))
        )
        await new Promise<void>((resolve) => {
          if (!server.listening) return resolve()
          server.close(() => resolve())
        })
        const rejection = interrupted.find(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        )
        if (rejection !== undefined) throw rejection.reason
      }
    )
  )
  const port = yield* Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          const address = server.address()
          if (address === null || typeof address === "string") return reject(new Error("missing server address"))
          resolve(address.port)
        })
      })
  )
  return { attachedPublications, endpoint: `http://127.0.0.1:${port}` }
})

type ClientHandle = {
  readonly child: ChildProcessWithoutNullStreams
  readonly next: () => Promise<WirePublication>
  readonly exited: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>
}

const startClient = (endpoint: string): ClientHandle => {
  const child = spawn(process.execPath, [clientEntry, endpoint], { stdio: ["ignore", "pipe", "pipe"] })
  const queued: Array<WirePublication> = []
  const waiters: Array<{ readonly resolve: (value: WirePublication) => void; readonly reject: (error: Error) => void }> = []
  let buffered = ""
  let terminal: Error | undefined
  const publish = (value: WirePublication) => {
    const waiter = waiters.shift()
    if (waiter === undefined) queued.push(value)
    else waiter.resolve(value)
  }
  const fail = (error: Error) => {
    terminal = error
    for (const waiter of waiters.splice(0)) waiter.reject(error)
  }
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk
    let boundary
    while ((boundary = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, boundary)
      buffered = buffered.slice(boundary + 1)
      if (line.trim()) publish(JSON.parse(line) as WirePublication)
    }
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    if (chunk.trim()) fail(new Error(chunk))
  })
  child.once("error", fail)
  const exited = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      fail(new Error(`graph stream client exited: ${code ?? signal}`))
      resolve({ code, signal })
    })
  })
  return {
    child,
    exited,
    next: () => {
      const value = queued.shift()
      if (value !== undefined) return Promise.resolve(value)
      if (terminal !== undefined) return Promise.reject(terminal)
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve: (value: WirePublication) => { clearTimeout(timer); resolve(value) },
          reject: (error: Error) => { clearTimeout(timer); reject(error) }
        }
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error("No graph frame for 12 seconds"))
        }, 12_000)
        waiters.push(waiter)
      })
    }
  }
}

const nextMatching = (client: ClientHandle, predicate: (item: WirePublication) => boolean) =>
  Effect.promise(async () => {
    for (;;) {
      const item = await client.next()
      if (predicate(item)) return item
    }
  })

it.live(
  "streams changed graph, respects capacity, and exposes rejected terminal evidence",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        yield* Effect.addFinalizer(() =>
          fileSystem.remove(fixture.container, { force: true, recursive: true }).pipe(Effect.orDie)
        )
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
          fixture.configuration,
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
          attachTurnCompletedHints: Effect.succeed(Stream.fromEffect(Deferred.await(turnCompletedHint))),
          listThreads: () =>
            provider.codex.listThreads!().pipe(
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
            provider.codex.readThread(id).pipe(
              Effect.flatMap((thread) =>
                Ref.get(turnTerminalVisible).pipe(Effect.map((visible) => maskThread(thread, visible)))
              )
            ),
          resumeThread: (id, cwd) =>
            provider.codex.resumeThread(id, cwd).pipe(
              Effect.flatMap((thread) =>
                Ref.get(turnTerminalVisible).pipe(Effect.map((visible) => maskThread(thread, visible)))
              )
            ),
          startTurn: (...args) =>
            provider.codex.startTurn(...args).pipe(
              Effect.tap(() => Deferred.succeed(turnEntered, undefined)),
              Effect.flatMap((turn) => Ref.get(turnTerminalVisible).pipe(Effect.map(visible => visible ? turn : ({ ...turn, status: "inProgress" as const }))))
            )
        })
        const graphPhase = yield* Ref.make<"Initial" | "Expanded" | "Settled">("Initial")
        const changedGraphReads = yield* Ref.make(0)
        const changedGraphReadEntered = yield* Deferred.make<void>()
        const secondChangedGraphReadEntered = yield* Deferred.make<void>()
        const forbiddenChildWorkReads = yield* Ref.make<ReadonlyArray<string>>([])
        const activationFailures = yield* Ref.make<ReadonlyArray<string>>([])
        const terminationFailure = yield* Deferred.make<{readonly _tag: string; readonly detail: string}>()
        const rootNodeId = hermeticQualificationTrackerIdentity.issueNodeId
        const repositoryNodeId = hermeticQualificationTrackerIdentity.repositoryNodeId
        const childNodeId = GithubIssueNodeId.make("changing-graph-child")
        const blockerNodeId = GithubIssueNodeId.make("changing-graph-blocker")
        const independentNodeId = GithubIssueNodeId.make("changing-graph-independent")
        const rootTaskId = githubTaskIdFor(repositoryNodeId, rootNodeId)
        const childTaskId = githubTaskIdFor(repositoryNodeId, childNodeId)
        const blockerTaskId = githubTaskIdFor(repositoryNodeId, blockerNodeId)
        const independentTaskId = githubTaskIdFor(repositoryNodeId, independentNodeId)
        const delegateGithub = (request: GithubGraphqlRequest) =>
          provider.github(providerBodyFor(request)).pipe(
            Effect.orDie,
            Effect.flatMap((response) =>
              response.status === 200
                ? Effect.succeed({ body: response.body })
                : Effect.die(`controlled GitHub provider returned HTTP ${response.status}`)
            )
          )
        const connection = (issueNodeId: GithubIssueNodeId, field: "blockedBy" | "subIssues", ids: ReadonlyArray<GithubIssueNodeId>) => ({
          body: {
            data: {
              node: {
                __typename: "Issue",
                id: issueNodeId,
                [field]: { nodes: ids.map((id) => ({ id })), pageInfo: { endCursor: null, hasNextPage: false } }
              }
            }
          }
        })
        const github = GithubGraphqlClient.of({
          execute: (request: GithubGraphqlRequest) =>
            Effect.gen(function* () {
              const phase = yield* Ref.get(graphPhase)
              if (phase === "Initial") return yield* delegateGithub(request)
              if (request._tag === "ReadSubIssues") {
                if (request.issueNodeId === rootNodeId) {
                  const count = yield* Ref.updateAndGet(changedGraphReads, (current) => current + 1)
                  yield* Deferred.succeed(changedGraphReadEntered, undefined)
                  if (count >= 2) yield* Deferred.succeed(secondChangedGraphReadEntered, undefined)
                  return connection(rootNodeId, "subIssues", [childNodeId, independentNodeId])
                }
                return connection(request.issueNodeId, "subIssues", [])
              }
              if (request._tag === "ReadBlockedBy") {
                return connection(
                  request.issueNodeId,
                  "blockedBy",
                  request.issueNodeId === childNodeId ? [blockerNodeId] : []
                )
              }
              if (request._tag === "ReadIssue" && request.issueNodeId !== rootNodeId) {
                const isChild = request.issueNodeId === childNodeId
                const isIndependent = request.issueNodeId === independentNodeId
                if (!isChild && !isIndependent && request.issueNodeId !== blockerNodeId) {
                  return yield* Effect.die(`unexpected changing-graph issue ${request.issueNodeId}`)
                }
                return {
                  body: {
                    data: {
                      node: {
                        __typename: "Issue",
                        id: request.issueNodeId,
                        parent: isChild || isIndependent ? { id: rootNodeId } : null,
                        repository: { id: repositoryNodeId },
                        state: isChild || (isIndependent && phase === "Expanded") ? "OPEN" : "CLOSED",
                        stateReason: isChild || (isIndependent && phase === "Expanded") ? null : "NOT_PLANNED"
                      }
                    }
                  }
                }
              }
              if (request._tag === "ReadTaskWorkSpecification" && request.issueNodeId !== rootNodeId) {
                yield* Ref.update(forbiddenChildWorkReads, (current) => [...current, `${request._tag}:${request.issueNodeId}`])
                return yield* Effect.die("blocked or terminal task reached a work-specification read")
              }
              return yield* delegateGithub(request)
            })
        })
        const applicationExitRequests = yield* Ref.make(0)
        const graph = productionRepositoryHostGraph({
          applicationExitRequestObserver: () => Ref.update(applicationExitRequests, (count) => count + 1),
          onActivationFailure: (failure) => Effect.gen(function*(){
            yield* Ref.update(activationFailures, current => [...current,String(failure)])
            if (typeof failure === "object" && failure !== null && "_tag" in failure && failure._tag === "WorkflowRunTerminationEvidenceInvalid" && "detail" in failure && typeof failure.detail === "string")
              yield* Deferred.succeed(terminationFailure,{_tag:failure._tag,detail:failure.detail})
            else console.log(JSON.stringify({stage:"unexpected-activation-failure",failure}))
          }),
          codexAppServer: () =>
            Layer.effect(
              CodexAppServer,
              Effect.addFinalizer(() => provider.codex.close.pipe(Effect.orDie)).pipe(Effect.as(codex))
            ),
          githubClient: () => Layer.succeed(GithubGraphqlClient, github)
        })
        const observationReady = yield* Deferred.make<ProductionHostObservation>()
        const releaseHost = yield* Deferred.make<void>()
        const hostFiber = yield* withDecodedProductionRepositoryHost(fixture.configuration, graph, (observation) =>
          Deferred.succeed(observationReady, observation).pipe(Effect.andThen(Deferred.await(releaseHost)))
        ).pipe(Effect.forkScoped)
        const observation = yield* Deferred.await(observationReady).pipe(Effect.timeout("30 seconds"))
        yield* Deferred.await(turnEntered).pipe(Effect.timeout("30 seconds"))
        yield* observation.acceptedHistory.changes.pipe(
          Stream.mapEffect((cursor) => observation.traceReader.readAt(cursor)),
          Stream.filter((view) =>
            view.items.some(
              ({ occurrence }) =>
                occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
                occurrence.report._tag === "ExecutorWorkExecuting"
            )
          ),
          Stream.runHead,
          Effect.timeout("10 seconds")
        )
        const observationServer = yield* startObservationServer(observation)

        const clients = new Set<ClientHandle>()
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            for (const client of clients)
              if (client.child.exitCode === null && client.child.signalCode === null) client.child.kill()
            const exited = await Promise.allSettled([...clients].map((client) => client.exited))
            const rejection = exited.find((result): result is PromiseRejectedResult => result.status === "rejected")
            if (rejection !== undefined) throw rejection.reason
          })
        )
        const firstClient = startClient(observationServer.endpoint)
        clients.add(firstClient)
        const initial = yield* Effect.promise(() => firstClient.next()).pipe(Effect.timeout("15 seconds"))
        const initialGraph = initial.graph as {
          readonly rootTaskId: string
          readonly snapshot: { readonly tasks: ReadonlyArray<unknown> }
        }
        expect(initial._tag).toBe("Ready")
        expect(initial.runId).toBe(observation.selection.runId)
        expect(initialGraph.rootTaskId).toBe(rootTaskId)
        expect(initialGraph.snapshot.tasks).toHaveLength(1)
        expect(JSON.stringify(initial)).toBe(JSON.stringify(observationServer.attachedPublications[0]))
        console.log(JSON.stringify({ stage: "initial", acceptedAt: initial.acceptedAt }))

        yield* Ref.set(graphPhase, "Expanded")
        yield* Deferred.await(changedGraphReadEntered).pipe(Effect.timeout("10 seconds"))
        console.log(JSON.stringify({ stage: "changed-graph-read" }))
        const changed = yield* nextMatching(firstClient, (item) => {
          const graph = item.graph as { readonly snapshot?: { readonly tasks?: ReadonlyArray<unknown> } } | undefined
          return item._tag === "Ready" && graph?.snapshot?.tasks?.length === 4
        }).pipe(
          Effect.timeout("20 seconds"),
          Effect.tapError(() =>
            Effect.gen(function* () {
              const current = publicationOf(observation.selection.runId, yield* observation.current.get)
              console.log(
                JSON.stringify({
                  stage: "expanded-timeout",
                  current,
                  activationFailures: yield* Ref.get(activationFailures),
                  changedGraphReads: yield* Ref.get(changedGraphReads),
                  forbiddenChildWorkReads: yield* Ref.get(forbiddenChildWorkReads)
                })
              )
            })
          )
        )
        const changedGraph = changed.graph as {
          readonly rootTaskId: string
          readonly snapshot: {
            readonly tasks: ReadonlyArray<{
              readonly id: string
              readonly lifecycle: { readonly _tag: string }
              readonly parentTaskId: string | null
              readonly prerequisiteIds: ReadonlyArray<string>
            }>
          }
        }
        expect(changedGraph.rootTaskId).toBe(rootTaskId)
        const root = changedGraph.snapshot.tasks.find(({ id }) => id === rootTaskId)
        const child = changedGraph.snapshot.tasks.find(({ id }) => id === childTaskId)
        const blocker = changedGraph.snapshot.tasks.find(({ id }) => id === blockerTaskId)
        const independent = changedGraph.snapshot.tasks.find(({ id }) => id === independentTaskId)
        expect(root).toMatchObject({ id: rootTaskId, parentTaskId: null, prerequisiteIds: [] })
        expect(child).toMatchObject({ id: childTaskId, parentTaskId: rootTaskId, prerequisiteIds: [blockerTaskId] })
        expect(blocker).toMatchObject({
          id: blockerTaskId,
          lifecycle: { _tag: "TerminalWithoutSuccess" },
          parentTaskId: null,
          prerequisiteIds: []
        })
        expect(independent).toMatchObject({
          id: independentTaskId,
          lifecycle: { _tag: "Open" },
          parentTaskId: rootTaskId,
          prerequisiteIds: []
        })
        const frontier = changed.frontier as ReadonlyArray<{
          readonly _tag: string
          readonly taskId: string
          readonly reasons?: ReadonlyArray<{ readonly _tag: string; readonly prerequisiteTaskIds?: ReadonlyArray<string> }>
        }>
        expect(frontier.find(({ taskId }) => taskId === childTaskId)).toMatchObject({
          _tag: "Excluded",
          reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: [blockerTaskId] }]
        })
        expect(frontier.find(({ taskId }) => taskId === blockerTaskId)).toMatchObject({
          _tag: "Excluded",
          reasons: [{ _tag: "TerminalWithoutSuccess" }]
        })
        const placements = changed.placements as ReadonlyArray<{
          readonly taskId: string
          readonly placement: { readonly _tag: string; readonly rank?: number }
        }>
        expect(placements.filter(({ placement }) => placement._tag === "Selected")).toHaveLength(1)
        expect(placements.filter(({ placement }) => placement._tag === "EligibleOutsideBound")).toHaveLength(1)
        yield* Deferred.await(secondChangedGraphReadEntered).pipe(Effect.timeout("10 seconds"))
        const providerWhileHeld = yield* provider.snapshot()
        const operationCount = (tag: string) =>
          providerWhileHeld.operationCounts.find((entry) => entry.tag === tag)?.count ?? 0
        expect(operationCount("CodexStartThread")).toBe(1)
        expect(operationCount("CodexStartTurn")).toBe(1)
        expect(yield* Ref.get(forbiddenChildWorkReads)).toEqual([])
        expect(yield* Ref.get(changedGraphReads)).toBeGreaterThan(0)

        yield* Ref.set(graphPhase, "Settled")
        const settled = yield* nextMatching(firstClient, (item) => {
          const graph = item.graph as
            | {
                readonly snapshot?: {
                  readonly tasks?: ReadonlyArray<{ readonly id: string; readonly lifecycle: { readonly _tag: string } }>
                }
              }
            | undefined
          return (
            item._tag === "Ready" &&
            graph?.snapshot?.tasks?.find(({ id }) => id === independentTaskId)?.lifecycle._tag ===
              "TerminalWithoutSuccess"
          )
        }).pipe(Effect.timeout("20 seconds"))

        expect(firstClient.child.kill("SIGTERM")).toBe(true)
        const firstExit = yield* Effect.promise(() => firstClient.exited)
        clients.delete(firstClient)
        expect(firstExit.signal).toBe("SIGTERM")
        expect(hostFiber.pollUnsafe()).toBeUndefined()
        expect(yield* Ref.get(applicationExitRequests)).toBe(0)

        const secondClient = startClient(observationServer.endpoint)
        clients.add(secondClient)
        const reattachedCurrent = yield* Effect.promise(() => secondClient.next()).pipe(Effect.timeout("15 seconds"))
        expect(reattachedCurrent._tag).toBe("Ready")
        expect(reattachedCurrent.runId).toBe(initial.runId)
        expect(JSON.stringify(reattachedCurrent)).toBe(JSON.stringify(observationServer.attachedPublications[1]))
        const reattachedGraph =
          (reattachedCurrent.graph as { readonly snapshot?: { readonly tasks?: ReadonlyArray<unknown> } } | null)
            ?.snapshot?.tasks?.length === 4
            ? reattachedCurrent
            : yield* nextMatching(secondClient, (item) => {
                const graph = item.graph as
                  | { readonly snapshot?: { readonly tasks?: ReadonlyArray<unknown> } }
                  | null
                return item._tag === "Ready" && graph?.snapshot?.tasks?.length === 4
              }).pipe(Effect.timeout("20 seconds"))
        expect(reattachedGraph.runId).toBe(initial.runId)

        yield* Ref.set(turnTerminalVisible, true)
        yield* Deferred.succeed(turnCompletedHint, undefined)
        yield* Deferred.await(completionEntered).pipe(Effect.timeout("40 seconds"))
        yield* Deferred.succeed(releaseCompletion, undefined)
        const rejectedTermination = yield* Deferred.await(terminationFailure).pipe(Effect.timeout("20 seconds"))
        expect(rejectedTermination.detail).toBe("termination requires tracker graph observations to be causally comparable")
        expect(yield* Ref.get(forbiddenChildWorkReads)).toEqual([])
        const finalProvider = yield* provider.snapshot()
        expect(finalProvider.operationCounts.find(({ tag }) => tag === "CodexStartTurn")?.count).toBe(2) // task + integrator

        yield* Deferred.succeed(releaseHost, undefined)
        const closed = yield* nextMatching(secondClient, (item) => item._tag === "Closed").pipe(
          Effect.timeout("20 seconds")
        )
        const retainedClosed = publicationOf(observation.selection.runId, yield* observation.current.get)
        expect(JSON.stringify(closed)).toBe(JSON.stringify(retainedClosed))
        const secondExit = yield* Effect.promise(() => secondClient.exited)
        clients.delete(secondClient)
        expect(secondExit).toEqual({ code: 0, signal: null })
        yield* Fiber.join(hostFiber).pipe(Effect.timeout("20 seconds"))

        const journal = yield* Effect.scoped(
          Effect.gen(function* () {
            const journalContext = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: fixture.configuration.journalDatabase })
            )
            return yield* Context.get(journalContext, JournalStore).read(observation.selection.runId)
          })
        )
        const acceptedFourTaskGraph = journal.some(({event}) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies[0].taskIds.length === 4)
        expect(acceptedFourTaskGraph).toBe(true)
        expect(journal.filter(({event})=>event._tag==="WorkflowRunTerminated")).toHaveLength(0)
        expect(journal.filter(({event})=>event._tag==="PlannedAttemptExecutorWorkResponsibilityBegan")).toHaveLength(1)
        expect(journal.some(({event})=>event._tag==="TargetPromotionObservedSuccess")).toBe(true)
        expect(journal.some(({event})=>event._tag==="TaskTrackerFactsObserved" && event.observation._tag==="FocusedTaskCompletionFacts" && event.observation.purpose._tag==="Confirmation" && event.observation.facts.lifecycle==="CompletedSuccessfully")).toBe(true)
        const graphIntents = journal.flatMap(({event})=> event._tag==="TaskTrackerReadIntentRecorded" && event.operation._tag==="ReadTrackerGraph" ? [event.operation] : [])
        const operationLabel = (id:string) => {const index=graphIntents.findIndex(op=>op.operationId===id);return index<0?"other":`g${index+1}`}
        console.log(JSON.stringify({graphReadCausality:graphIntents.map(op=>({id:operationLabel(op.operationId),predecessors:op.predecessorOperationIds.map(operationLabel),cause:op.cause}))}))
        const taskLabel = (id:string) => id===rootTaskId?"A":id===childTaskId?"B":id===blockerTaskId?"C":id===independentTaskId?"D":"other"
        console.log(JSON.stringify({graphObservations:journal.flatMap(({position,event})=>
          event._tag!=="TaskTrackerFactsObserved" ? [] : event.observation._tag==="CompleteTaskTrackerFacts" ?
            [{id:operationLabel(event.operationId),position,lifecycles:event.observation.factFamilies[1].lifecycles.map(({taskId,lifecycle})=>({task:taskLabel(taskId),state:lifecycle._tag}))}] :
          event.observation._tag==="UnchangedTaskTrackerFactsReconfirmed" ?
            [{id:operationLabel(event.operationId),position,reconfirms:operationLabel(event.observation.priorFullObservationOperationId)}] : [])}))
        expect(
          journal.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkTerminal" &&
              event.report.result._tag === "Accepted"
          )
        ).toBe(true)

        console.log(
          JSON.stringify({
            runId: initial.runId,
            initialAcceptedAt: initial.acceptedAt,
            changedAcceptedAt: changed.acceptedAt,
            reattachedAcceptedAt: reattachedGraph.acceptedAt,
            settledAcceptedAt: settled.acceptedAt,
            changedTasks: changedGraph.snapshot.tasks.map(({ id, parentTaskId, prerequisiteIds }) => ({
              id,
              parentTaskId,
              prerequisiteIds
            })),
            frontier,
            placements,
            changedGraphReads: yield* Ref.get(changedGraphReads),
            codexStartTurns: finalProvider.operationCounts.find(({ tag }) => tag === "CodexStartTurn")?.count ?? 0,
            firstClientSignal: firstExit.signal,
            secondClientExit: secondExit,
            terminationRejected: rejectedTermination,
            applicationExitRequests: yield* Ref.get(applicationExitRequests)
          })
        )
      })
    ).pipe(Effect.provide(fixtureLayer)),
  90_000
)
