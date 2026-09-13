/* eslint-disable import/no-nodejs-modules, functional/no-let, functional/no-loop-statements, functional/immutable-data, max-lines -- Disposable graph stream experiment. */
import { GitCommitSha } from "@dalph/contracts"
import {
  GithubGraphqlClient,
  JournalStore,
  attachCurrentSignal,
  currentSignalFromCurrentFirstStream,
  deliveryStatusOf,
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
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Ref, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import {
  productionRepositoryHostGraph,
  withDecodedProductionRepositoryHost,
  type ProductionHostObservation
} from "@dalph/dalph"
import { CodexAppServer } from "../../../packages/dalph/src/application/codex-app-server.js"
import { makeHermeticProviderState } from "../../../packages/dalph/test-support/production-hermetic-provider-state.js"
import { createHermeticFixture } from "../../../packages/dalph/test-support/production-hermetic-fixture.js"

const builtEntry = fileURLToPath(new URL("../../../packages/dalph/dist/bin/dalph.js", import.meta.url))
const sourceBaseSha = GitCommitSha.make("684aba853903cf1d1fc7f33e6af666f2bf37c915")
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
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
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
  "streams one production host current-first through change and truthful closure",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        yield* Effect.addFinalizer(() =>
          fileSystem.remove(fixture.container, { force: true, recursive: true }).pipe(Effect.orDie)
        )
        const turnEntered = yield* Deferred.make<void>()
        const releaseTurn = yield* Deferred.make<void>()
        const completionEntered = yield* Deferred.make<void>()
        const releaseCompletion = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() =>
          Effect.all([Deferred.succeed(releaseTurn, undefined), Deferred.succeed(releaseCompletion, undefined)]).pipe(
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
        const codex = CodexAppServer.of({
          ...provider.codex,
          startTurn: (...args) =>
            Deferred.succeed(turnEntered, undefined).pipe(
              Effect.andThen(Deferred.await(releaseTurn)),
              Effect.andThen(provider.codex.startTurn(...args))
            )
        })
        const github = GithubGraphqlClient.of({
          execute: (request: GithubGraphqlRequest) =>
            provider.github(providerBodyFor(request)).pipe(
              Effect.orDie,
              Effect.flatMap((response) =>
                response.status === 200
                  ? Effect.succeed({ body: response.body })
                  : Effect.die(`controlled GitHub provider returned HTTP ${response.status}`)
              )
            )
        })
        const applicationExitRequests = yield* Ref.make(0)
        const graph = productionRepositoryHostGraph({
          applicationExitRequestObserver: () => Ref.update(applicationExitRequests, (count) => count + 1),
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
        console.log(JSON.stringify({ stage: "turn-held", runId: observation.selection.runId }))
        const observationServer = yield* startObservationServer(observation)

        const clients = new Set<ClientHandle>()
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            for (const client of clients)
              if (client.child.exitCode === null && client.child.signalCode === null) client.child.kill()
            const exited = await Promise.allSettled([...clients].map((client) => client.exited))
            const rejection = exited.find(
              (result): result is PromiseRejectedResult => result.status === "rejected"
            )
            if (rejection !== undefined) throw rejection.reason
          })
        )
        const firstClient = startClient(observationServer.endpoint)
        clients.add(firstClient)
        const initial = yield* Effect.promise(() => firstClient.next()).pipe(Effect.timeout("15 seconds"))
        expect(initial._tag).toBe("Ready")
        expect(initial.runId).toBe(observation.selection.runId)
        expect(JSON.stringify(initial)).toBe(JSON.stringify(observationServer.attachedPublications[0]))
        expect((initial.graph as { readonly snapshot: { readonly tasks: ReadonlyArray<unknown> } }).snapshot.tasks).toHaveLength(1)
        console.log(
          JSON.stringify({
            stage: "initial",
            acceptedAt: initial.acceptedAt,
            statusClassifications: statusClassificationsOf(initial)
          })
        )

        yield* Deferred.succeed(releaseTurn, undefined)
        yield* Deferred.await(completionEntered).pipe(Effect.timeout("40 seconds"))
        console.log(JSON.stringify({ stage: "completion-held" }))
        const later = yield* nextMatching(
          firstClient,
          (item) =>
            item._tag === "Ready" &&
            JSON.stringify(statusClassificationsOf(item)) !== JSON.stringify(statusClassificationsOf(initial))
        ).pipe(Effect.timeout("20 seconds"))
        console.log(
          JSON.stringify({
            stage: "later",
            acceptedAt: later.acceptedAt,
            statusClassifications: statusClassificationsOf(later)
          })
        )

        expect(firstClient.child.kill("SIGTERM")).toBe(true)
        const firstExit = yield* Effect.promise(() => firstClient.exited)
        clients.delete(firstClient)
        expect(firstExit.signal).toBe("SIGTERM")
        expect(hostFiber.pollUnsafe()).toBeUndefined()
        expect(yield* Ref.get(applicationExitRequests)).toBe(0)

        const secondClient = startClient(observationServer.endpoint)
        clients.add(secondClient)
        const reattached = yield* Effect.promise(() => secondClient.next()).pipe(Effect.timeout("15 seconds"))
        expect(reattached._tag).toBe("Ready")
        expect(reattached.runId).toBe(initial.runId)
        expect(JSON.stringify(reattached)).toBe(JSON.stringify(observationServer.attachedPublications[1]))
        console.log(
          JSON.stringify({
            stage: "reattached",
            acceptedAt: reattached.acceptedAt,
            statusClassifications: statusClassificationsOf(reattached)
          })
        )

        yield* Deferred.succeed(releaseCompletion, undefined)
        const termination = yield* observation.runTermination.await.pipe(Effect.timeout("40 seconds"))
        expect(termination.disposition).toBe("Completed")
        console.log(JSON.stringify({ stage: "terminal", disposition: termination.disposition }))
        yield* Deferred.succeed(releaseHost, undefined)
        const closed = yield* nextMatching(secondClient, (item) => item._tag === "Closed").pipe(
          Effect.timeout("20 seconds")
        )
        expect(closed.runId).toBe(initial.runId)
        expect(closed.final?._tag).toBe("Ready")
        const retainedClosed = publicationOf(observation.selection.runId, yield* observation.current.get)
        expect(JSON.stringify(closed)).toBe(JSON.stringify(retainedClosed))
        console.log(JSON.stringify({ stage: "closed", final: closed.final?._tag }))
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
        expect(
          journal.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkTerminal" &&
              event.report.result._tag === "Accepted"
          )
        ).toBe(true)
        expect(journal.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(true)
        expect(
          journal.some(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" &&
              event.observation._tag === "FocusedTaskCompletionFacts" &&
              event.observation.purpose._tag === "Confirmation" &&
              event.observation.facts.lifecycle === "CompletedSuccessfully"
          )
        ).toBe(true)

        console.log(
          JSON.stringify({
            runId: initial.runId,
            initialAcceptedAt: initial.acceptedAt,
            laterAcceptedAt: later.acceptedAt,
            reattachedAcceptedAt: reattached.acceptedAt,
            firstClientSignal: firstExit.signal,
            secondClientExit: secondExit,
            closedFinal: closed.final?._tag,
            applicationExitRequests: yield* Ref.get(applicationExitRequests)
          })
        )
      })
    ).pipe(Effect.provide(fixtureLayer)),
  90_000
)

it.effect("retains a publication made at the attachment boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const source = yield* SubscriptionRef.make(0)
      const attachment = yield* attachCurrentSignal(currentSignalFromCurrentFirstStream(SubscriptionRef.changes(source)))
      yield* SubscriptionRef.set(source, 1)
      const next = yield* attachment.changes.pipe(Stream.runHead)
      expect(attachment.current).toBe(0)
      expect(next._tag).toBe("Some")
      if (next._tag === "Some") expect(next.value).toBe(1)
    })
  )
)

it.effect("buffers a bounded burst for an attached slow subscriber", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const source = yield* SubscriptionRef.make(0)
      const attachment = yield* attachCurrentSignal(currentSignalFromCurrentFirstStream(SubscriptionRef.changes(source)))
      const consumerStarted = yield* Deferred.make<void>()
      const firstEntered = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const consumer = yield* attachment.changes.pipe(
        Stream.onStart(Deferred.succeed(consumerStarted, undefined)),
        Stream.take(8),
        Stream.mapEffect((value) =>
          value === 1
            ? Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst)), Effect.as(value))
            : Effect.succeed(value)
        ),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Deferred.await(consumerStarted)
      yield* SubscriptionRef.set(source, 1)
      yield* Deferred.await(firstEntered)
      for (let value = 2; value <= 8; value++) yield* SubscriptionRef.set(source, value)
      yield* Deferred.succeed(releaseFirst, undefined)
      const values = Array.from(yield* Fiber.join(consumer))
      expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      console.log(JSON.stringify({ slowSubscriberObserved: values }))
    })
  )
)
