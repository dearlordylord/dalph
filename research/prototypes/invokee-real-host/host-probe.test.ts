/* eslint-disable import/no-nodejs-modules, functional/no-let, functional/no-loop-statements, functional/immutable-data, max-lines -- Disposable OS-client host experiment. */
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha } from "@dalph/contracts"
import {
  CoordinatorLockHeld,
  GithubGraphqlClient,
  JournalStore,
  deliveryStatusOf,
  nodeGitCommandLayer,
  sqliteJournalStoreLayer,
  type GithubGraphqlRequest
} from "@dalph/orchestrator"
import { createServer, type ServerResponse } from "node:http"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  productionRepositoryHostGraph,
  withDecodedProductionRepositoryHost,
  type ProductionHostObservation,
  type ProductionRepositoryHostBoundary
} from "@dalph/dalph"
import { CodexAppServer } from "../../../packages/dalph/src/application/codex-app-server.js"
import { makeHermeticProviderState } from "../../../packages/dalph/test-support/production-hermetic-provider-state.js"
import { createHermeticFixture } from "../../../packages/dalph/test-support/production-hermetic-fixture.js"

const builtEntry = fileURLToPath(new URL("../../../packages/dalph/dist/bin/dalph.js", import.meta.url))
const sourceBaseSha = GitCommitSha.make("1ff575e01606b1b688201153d7f1dc08f6369d95")
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

const snapshotOf = Effect.fn("InvokeeRealHost.snapshot")(function* (observation: ProductionHostObservation) {
  const runId = observation.selection.runId
  const [cursor, runtime] = yield* Effect.all([observation.acceptedHistory.get, observation.current.get])
  const ready = runtime._tag === "Ready" ? runtime : runtime._tag === "Closed" ? runtime.final : null
  const graphState = ready?.evaluation.current.trackerGraph
  const graph = graphState?._tag === "GraphEstablished" ? graphState.observation.snapshot.toWire() : null
  return {
    runId,
    acceptedAt: cursor.position,
    graph,
    statuses: {
      run: deliveryStatusOf({ _tag: "Run", runId }, runtime),
      tasks:
        graph?.tasks.map((task) => ({
          taskId: task.id,
          status: deliveryStatusOf({ _tag: "Task", runId, taskId: task.id }, runtime)
        })) ?? []
    }
  }
})

type ClientHandle = {
  readonly child: ChildProcessWithoutNullStreams
  readonly firstLine: Promise<string>
  readonly exited: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>
}

const startClient = (mode: "snapshot" | "watch", endpoint: string): ClientHandle => {
  const child = spawn(process.execPath, [clientEntry, mode, endpoint], { stdio: ["ignore", "pipe", "pipe"] })
  let buffered = ""
  const firstLine = new Promise<string>((resolve, reject) => {
    let observed = false
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk
      const newline = buffered.indexOf("\n")
      if (newline >= 0 && !observed) {
        observed = true
        resolve(buffered.slice(0, newline))
      }
    })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (!observed) reject(new Error(`observation client exited before its first snapshot: ${code ?? signal}`))
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      if (chunk.trim().length > 0) reject(new Error(chunk))
    })
  })
  const exited = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code, signal) => resolve({ code, signal }))
    }
  )
  return { child, firstLine, exited }
}

const startObservationServer = Effect.fn("InvokeeRealHost.server")(function* (observation: ProductionHostObservation) {
  const watchers = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    void Effect.runPromise(snapshotOf(observation)).then(
      (snapshot) => {
        response.statusCode = 200
        response.setHeader("content-type", request.url === "/watch" ? "application/x-ndjson" : "application/json")
        if (request.url === "/watch") {
          watchers.add(response)
          response.once("close", () => watchers.delete(response))
          response.write(`${JSON.stringify(snapshot)}\n`)
          return
        }
        if (request.url === "/snapshot") {
          response.end(JSON.stringify(snapshot))
          return
        }
        response.statusCode = 404
        response.end()
      },
      (failure) => {
        response.statusCode = 500
        response.end(String(failure))
      }
    )
  })
  yield* Effect.addFinalizer(() =>
    Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          for (const watcher of watchers) watcher.destroy()
          if (!server.listening) return resolve()
          server.close(() => resolve())
        })
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
  return `http://127.0.0.1:${port}`
})

it.live(
  "keeps one real production host delivering after an OS observation client disconnects",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const fixtureRemoved = yield* Ref.make(false)
        yield* Effect.addFinalizer(() =>
          Ref.get(fixtureRemoved).pipe(
            Effect.flatMap((removed) =>
              removed ? Effect.void : fileSystem.remove(fixture.container, { force: true, recursive: true }).pipe(Effect.orDie)
            )
          )
        )

        const turnEntered = yield* Deferred.make<void>()
        const releaseTurn = yield* Deferred.make<void>()
        const completionReached = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(releaseTurn, undefined).pipe(Effect.asVoid))
        const provider = yield* makeHermeticProviderState(
          fixture.configuration,
          (boundary) =>
            boundary._tag === "CompletionResponse"
              ? Deferred.succeed(completionReached, undefined).pipe(Effect.asVoid)
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
        const boundaries = yield* Ref.make<ReadonlyArray<ProductionRepositoryHostBoundary>>([])
        const applicationExitRequests = yield* Ref.make(0)
        const graph = productionRepositoryHostGraph({
          applicationExitRequestObserver: () => Ref.update(applicationExitRequests, (count) => count + 1),
          boundaryObserver: (boundary) => Ref.update(boundaries, (current) => [...current, boundary]),
          codexAppServer: () =>
            Layer.effect(
              CodexAppServer,
              Effect.addFinalizer(() => provider.codex.close.pipe(Effect.orDie)).pipe(Effect.as(codex))
            ),
          githubClient: () => Layer.succeed(GithubGraphqlClient, github)
        })

        const observationReady = yield* Deferred.make<{
          readonly endpoint: string
          readonly observation: ProductionHostObservation
        }>()
        const releaseHostCallback = yield* Deferred.make<void>()
        const host = withDecodedProductionRepositoryHost(fixture.configuration, graph, (observation) =>
          Effect.scoped(
            Effect.gen(function* () {
              const endpoint = yield* startObservationServer(observation)
              yield* Deferred.succeed(observationReady, { endpoint, observation })
              yield* Deferred.await(releaseHostCallback)
            })
          )
        )
        const hostFiber = yield* host.pipe(Effect.forkScoped)
        const { endpoint, observation } = yield* Deferred.await(observationReady).pipe(Effect.timeout("30 seconds"))
        yield* Deferred.await(turnEntered).pipe(Effect.timeout("30 seconds"))

        const clientProcesses = new Set<ClientHandle>()
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            for (const client of clientProcesses) {
              if (client.child.exitCode === null && client.child.signalCode === null) client.child.kill()
            }
            await Promise.allSettled([...clientProcesses].map(({ exited }) => exited))
          })
        )
        const firstClient = startClient("watch", endpoint)
        clientProcesses.add(firstClient)
        const firstSnapshot = JSON.parse(yield* Effect.promise(() => firstClient.firstLine))
        expect(firstSnapshot.runId).toBe(observation.selection.runId)
        expect(firstSnapshot.graph?.tasks).toHaveLength(1)

        const beforeCompetitor = yield* provider.snapshot()
        const firstCursor = yield* observation.acceptedHistory.get
        const competitor = yield* withDecodedProductionRepositoryHost(fixture.configuration, graph, () =>
          Effect.die("competing host must not expose an observation")
        ).pipe(Effect.flip, Effect.timeout("10 seconds"))
        expect(competitor).toBeInstanceOf(CoordinatorLockHeld)
        expect(yield* provider.snapshot()).toEqual(beforeCompetitor)
        expect((yield* observation.acceptedHistory.get).position).toBe(firstCursor.position)
        expect((yield* Ref.get(boundaries)).filter((boundary) => boundary === "coordinator.acquire")).toHaveLength(1)
        expect((yield* Ref.get(boundaries)).filter((boundary) => boundary === "journal.sqlite.open")).toHaveLength(1)

        expect(firstClient.child.kill("SIGTERM")).toBe(true)
        const firstExit = yield* Effect.promise(() => firstClient.exited)
        clientProcesses.delete(firstClient)
        expect(firstExit.signal).toBe("SIGTERM")
        const hostAfterFirstDisconnect = yield* Effect.sync(() => hostFiber.pollUnsafe())
        expect(hostAfterFirstDisconnect).toBeUndefined()

        yield* Deferred.succeed(releaseTurn, undefined)
        yield* Deferred.await(completionReached).pipe(Effect.timeout("40 seconds"))
        const termination = yield* observation.runTermination.await.pipe(Effect.timeout("40 seconds"))
        expect(termination.disposition).toBe("Completed")
        expect(termination.terminatedAt.runId).toBe(observation.selection.runId)

        const secondClient = startClient("snapshot", endpoint)
        clientProcesses.add(secondClient)
        const secondSnapshot = JSON.parse(yield* Effect.promise(() => secondClient.firstLine))
        const secondExit = yield* Effect.promise(() => secondClient.exited)
        clientProcesses.delete(secondClient)
        expect(secondExit).toEqual({ code: 0, signal: null })
        expect(secondSnapshot.runId).toBe(firstSnapshot.runId)
        expect(secondSnapshot.acceptedAt).toBeGreaterThan(firstSnapshot.acceptedAt)
        const exitRequestsThroughReconnect = yield* Ref.get(applicationExitRequests)
        expect(exitRequestsThroughReconnect).toBe(0)
        const hostAfterReconnect = yield* Effect.sync(() => hostFiber.pollUnsafe())
        expect(hostAfterReconnect).toBeUndefined()

        yield* Deferred.succeed(releaseHostCallback, undefined)
        yield* Fiber.join(hostFiber).pipe(Effect.timeout("20 seconds"))

        const journal = yield* Effect.scoped(
          Effect.gen(function* () {
            const journalContext = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: fixture.configuration.journalDatabase })
            )
            return yield* Context.get(journalContext, JournalStore).read(observation.selection.runId)
          })
        )
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(
          journal.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkTerminal" &&
              event.report.result._tag === "Accepted"
          )
        ).toBe(true)
        expect(
          journal.some(
            ({ event }) => event._tag === "IntegratorRunResultRecorded" && event.result._tag === "PreparedCandidate"
          )
        ).toBe(true)
        expect(
          journal.some(
            ({ event }) => event._tag === "IntegratorRunCandidateGitObserved" && event.observation._tag === "Commit"
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
        expect((yield* provider.snapshot()).taskLifecycle).toBe("Completed")

        console.log(
          JSON.stringify({
            firstClient: { acceptedAt: firstSnapshot.acceptedAt, exit: firstExit },
            secondClient: { acceptedAt: secondSnapshot.acceptedAt, exit: secondExit },
            runId: observation.selection.runId,
            coordinatorAcquisitions: (yield* Ref.get(boundaries)).filter(
              (boundary) => boundary === "coordinator.acquire"
            ).length,
            applicationExitRequests: yield* Ref.get(applicationExitRequests),
            workflowRunBeginnings: journal.filter(({ event }) => event._tag === "WorkflowRunBegan").length,
            terminalExecutorReport: true,
            integratorResultRecorded: true,
            integratorCandidateCommitObserved: true,
            targetPromotionObservedSuccess: true,
            trackerCompletionConfirmed: true
          })
        )

        yield* fileSystem.remove(fixture.container, { force: true, recursive: true })
        yield* Ref.set(fixtureRemoved, true)
        expect(yield* fileSystem.exists(fixture.container)).toBe(false)
      })
    ).pipe(Effect.provide(fixtureLayer)),
  90_000
)
