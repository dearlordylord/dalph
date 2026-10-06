/* eslint-disable import/no-nodejs-modules -- The controlled provider lives outside both actual host processes. */
import { createServer, type IncomingMessage } from "node:http"
import { Deferred, Effect, FiberSet, Match, Ref, Schema } from "effect"
import {
  HermeticCodexRequest,
  HermeticControllerEndpoint
} from "../src/application/production-hermetic-provider-bridge.js"
import { type CodexThreadSnapshot, CodexThreadListSummary } from "../src/application/codex-app-server.js"
import { makeHermeticProviderState } from "./production-hermetic-provider-state.js"
import type { HermeticControllerFixture } from "./production-hermetic-controller.js"
import { makeRetainedTaskResultSelector } from "./production-running-host-result-cycle.js"

const providerFailureStatus = 500

const readBody = (request: IncomingMessage) =>
  Effect.tryPromise(
    () =>
      new Promise<unknown>((resolve, reject) => {
        let body = ""
        request.setEncoding("utf8")
        request.on("data", (chunk: string) => {
          body += chunk
        })
        request.on("error", reject)
        request.on("end", () => {
          try {
            resolve(JSON.parse(body))
          } catch (cause) {
            reject(cause)
          }
        })
      })
  )

/** This substrate retains live execution through SIGKILL; transport loss never changes its observations. */
export const makeHostDeathProvider = Effect.fn("HostDeathProvider.make")(function* (
  fixture: HermeticControllerFixture
) {
  const selectResult = yield* makeRetainedTaskResultSelector
  const provider = yield* makeHermeticProviderState(
    fixture.configuration,
    () => Effect.void,
    fixture.manifest.invocationId,
    selectResult
  )
  const calls = yield* Ref.make<ReadonlyArray<HermeticCodexRequest>>([])
  const githubCalls = yield* Ref.make<ReadonlyArray<unknown>>([])
  const stopped = yield* Ref.make(false)
  const reconciliationEntered = yield* Deferred.make<void>()
  const reconciliationRelease = yield* Deferred.make<void>()
  const gateReads = yield* Ref.make(false)
  const started = yield* Deferred.make<void>()
  const interruptEntered = yield* Deferred.make<void>()
  const interruptResponseRelease = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() => Deferred.succeed(interruptResponseRelease, undefined).pipe(Effect.asVoid))
  const mask = (thread: CodexThreadSnapshot, isStopped: boolean): CodexThreadSnapshot => ({
    ...thread,
    status: isStopped ? "idle" : "active",
    turns: thread.turns.map((turn, index) => ({
      ...turn,
      status: isStopped || index < thread.turns.length - 1 ? "interrupted" : "inProgress"
    }))
  })
  const read = (thread: CodexThreadSnapshot) =>
    Ref.get(stopped).pipe(Effect.map((isStopped) => mask(thread, isStopped)))
  const codex = Effect.fn("HostDeathProvider.codex")(function* (input: unknown) {
    const request = yield* Schema.decodeUnknownEffect(HermeticCodexRequest)(input)
    yield* Ref.update(calls, (all) => [...all, request])
    if (
      (request._tag === "ReadThread" || request._tag === "ResumeThread" || request._tag === "ListThreads") &&
      (yield* Ref.get(gateReads))
    ) {
      yield* Deferred.succeed(reconciliationEntered, undefined)
      yield* Deferred.await(reconciliationRelease)
    }
    return yield* Match.valueTags(request, {
      StartThread: (value) => provider.codex.startThread(value.cwd, value.ownedThreadToken),
      ReadThread: (value) => provider.codex.readThread(value.threadId).pipe(Effect.flatMap(read)),
      ResumeThread: (value) => provider.codex.resumeThread(value.threadId, value.cwd).pipe(Effect.flatMap(read)),
      StartTurn: (value) =>
        provider.codex.startTurn(value.threadId, value.cwd, value.text, value.ownedTurnToken).pipe(
          Effect.tap(() => Ref.set(stopped, false)),
          Effect.tap(() => Deferred.succeed(started, undefined)),
          Effect.map((turn) => ({ turn: { ...turn, status: "inProgress" }, completionNotifications: [] }))
        ),
      InterruptTurn: (value) =>
        provider.codex
          .interruptTurn(value.threadId, value.turnId)
          .pipe(
            Effect.andThen(Deferred.succeed(interruptEntered, undefined)),
            Effect.andThen(Deferred.await(interruptResponseRelease)),
            Effect.as({})
          ),
      ListThreads: (value) =>
        (provider.codex.listThreads?.(value.cwd) ?? Effect.die("fixture requires thread census")).pipe(
          Effect.flatMap((threads) =>
            Ref.get(stopped).pipe(
              Effect.map((isStopped) =>
                threads.map((thread) =>
                  thread._tag === "CompleteSummary"
                    ? CodexThreadListSummary.CompleteSummary({
                        ...thread,
                        summary: {
                          status: isStopped ? "idle" : "active",
                          turns: thread.summary.turns.map((turn, index) => ({
                            ...turn,
                            status:
                              isStopped || index < thread.summary.turns.length - 1
                                ? ("interrupted" as const)
                                : ("inProgress" as const)
                          }))
                        }
                      })
                    : thread
                )
              )
            )
          )
        ),
      ListBackgroundTerminals: (value) => provider.codex.listBackgroundTerminals(value.threadId),
      TerminateBackgroundTerminal: (value) =>
        provider.codex.terminateBackgroundTerminal(value.threadId, value.processId),
      Close: () => provider.codex.close.pipe(Effect.as({}))
    })
  })
  const fibers = yield* FiberSet.make()
  const run = yield* FiberSet.runtimePromise(fibers)<never>()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createServer((request, response) => {
        const dispatch = readBody(request).pipe(
          Effect.flatMap((body) =>
            request.url === "/codex"
              ? codex(body).pipe(Effect.map((result) => ({ status: 200, body: result })))
              : Ref.update(githubCalls, (all) => [...all, body]).pipe(Effect.andThen(provider.github(body)))
          )
        )
        run(dispatch).then(
          (result) => {
            response.writeHead(result.status, { "content-type": "application/json" })
            response.end(JSON.stringify(result.body))
          },
          () => {
            response.writeHead(providerFailureStatus)
            response.end("{}")
          }
        )
      })
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
          })
      )
  )
  const endpoint = yield* Effect.tryPromise(
    () =>
      new Promise<HermeticControllerEndpoint>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          const address = server.address()
          if (address === null || typeof address === "string") {
            reject(new Error("provider has no address"))
            return
          }
          resolve(HermeticControllerEndpoint.make(`http://127.0.0.1:${address.port}`))
        })
      })
  )
  yield* Effect.addFinalizer(() => Deferred.succeed(reconciliationRelease, undefined).pipe(Effect.asVoid))
  return {
    endpoint,
    calls,
    githubCalls,
    started,
    interruptEntered,
    provider,
    gateReconciliation: Ref.set(gateReads, true),
    reconciliationEntered,
    // The substrate now supplies exact interrupted-turn evidence; host death supplied none.
    releaseReconciliation: Ref.set(stopped, true).pipe(
      Effect.andThen(Deferred.succeed(reconciliationRelease, undefined)),
      Effect.asVoid
    )
  }
})
