/* eslint-disable import/no-nodejs-modules -- Production fixture needs the exact built executor entry. */
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { Clock, Deferred, Effect, Fiber, Ref, Stream } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { attachWatchAdapters } from "../../test-support/running-host-watch-adapter-probe.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { serveRunningHost } from "./running-host-http.js"
import { writeRunningHostWatchFrame } from "./running-host-http-watch.js"
import { watchRunningHost } from "./running-host-watch-client.js"
import { projectRunningHostSnapshot } from "./running-host-projection.js"
import { type RunningHostSnapshot, type RunningHostWatchFrame } from "./running-host-contract.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))

for (const blocked of [false, true])
  it.live(
    `Production Exit ${blocked ? "fails a blocked final write without extending" : "delivers exact Closed before EOF within"} its original lifecycle budget`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* makeRunningHostFixture(builtEntry, false, undefined, undefined, true)
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const finalWriting = yield* Deferred.make<void>()
                  const first = yield* Deferred.make<void>()
                  const frames = yield* Ref.make<ReadonlyArray<RunningHostWatchFrame>>([])
                  const initial = yield* Ref.make<RunningHostSnapshot | null>(null)
                  yield* serveRunningHost(address, observation, (response, frame) =>
                    Effect.gen(function* () {
                      if (frame.frame._tag === "Snapshot" && frame.frame.value._tag === "Closed") {
                        yield* Deferred.succeed(finalWriting, undefined)
                        if (blocked) return yield* Effect.never
                      }
                      yield* writeRunningHostWatchFrame(response, frame)
                    })
                  )
                  const client = yield* watchRunningHost(address, observation.selection.runId).pipe(
                    Stream.tap((frame) =>
                      Ref.update(frames, (values) => [...values, frame]).pipe(
                        Effect.andThen(Deferred.succeed(first, undefined))
                      )
                    ),
                    Stream.runDrain,
                    Effect.result,
                    Effect.forkChild
                  )
                  const adapters = yield* attachWatchAdapters(address, observation.selection.runId)
                  yield* Deferred.await(first)
                  yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("20 seconds"))
                  yield* Ref.set(
                    initial,
                    yield* observation.current.get.pipe(
                      Effect.flatMap((state) => projectRunningHostSnapshot(observation.selection.runId, state))
                    )
                  )
                  expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
                  yield* fixture.releaseObservationCut
                  yield* Deferred.await(fixture.activationIdle).pipe(Effect.timeout("20 seconds"))
                  const started = yield* Clock.currentTimeMillis
                  const exiting = yield* observation.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
                  yield* Deferred.await(finalWriting).pipe(
                    Effect.timeout("6 seconds"),
                    Effect.onError(() =>
                      Effect.gen(function* () {
                        yield* Effect.logError(
                          JSON.stringify({
                            admission: yield* observation.commandAdmission.snapshot,
                            events: yield* Ref.get(fixture.exitEvents),
                            current: (yield* observation.current.get)._tag
                          })
                        )
                      })
                    )
                  )
                  const result = yield* Fiber.join(exiting)
                  const mcpFinal = yield* adapters.readTerminal().pipe(Effect.timeout("1 second"))
                  const cliExit = yield* Fiber.join(adapters.cli).pipe(Effect.timeout("1 second"))
                  const cliFinal = (yield* Ref.get(adapters.cliFrames)).at(-1)
                  expect(mcpFinal.requestId).toBe(adapters.initial.requestId)
                  expect(mcpFinal.subscriptionId).toBe(adapters.initial.subscriptionId)
                  expect(yield* Ref.get(adapters.notifications)).toBeGreaterThan(0)
                  yield* adapters.stop
                  expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(6500)
                  if (blocked) {
                    expect(result._tag).toBe("TimedOut")
                    expect(cliExit._tag).toBe("Failure")
                    expect(cliFinal?.frame._tag).toBe("Failure")
                    expect(mcpFinal.frame._tag).toBe("Failure")
                    expect(yield* Fiber.join(client)).toMatchObject({
                      _tag: "Failure",
                      failure: { _tag: "TransportFailed" }
                    })
                    // The lifecycle result ends observation ownership; no fresh write budget.
                  } else {
                    expect(result._tag).toBe("Succeeded")
                    expect(yield* Fiber.join(client)).toMatchObject({ _tag: "Success" })
                    const last = (yield* Ref.get(frames)).at(-1)
                    const closed = yield* observation.current.get.pipe(
                      Effect.flatMap((state) => projectRunningHostSnapshot(observation.selection.runId, state))
                    )
                    expect(last?.frame).toEqual({ _tag: "Snapshot", value: closed })
                    expect(cliExit._tag).toBe("Success")
                    expect(cliFinal?.frame).toEqual({ _tag: "Snapshot", value: closed })
                    expect(mcpFinal.frame).toEqual({ _tag: "Snapshot", value: closed })
                    expect(closed._tag).toBe("Closed")
                    if (closed._tag === "Closed") expect(closed.final?._tag).toBe("Ready")
                    expect(yield* Ref.get(initial)).not.toBeNull()
                  }
                  expect(yield* Ref.get(fixture.exitCalls)).toBe(1)
                })
              ),
            "Run",
            "Listening"
          )
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    45000
  )
