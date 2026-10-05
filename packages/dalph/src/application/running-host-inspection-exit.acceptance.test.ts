/* eslint-disable import/no-nodejs-modules -- The production host fixture consumes the exact built entry. */
import { fileURLToPath } from "node:url"
import { TrackerGraphReader } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Context, Deferred, Effect, Fiber, Layer, Ref, Stream } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { serveRunningHost } from "./running-host-http.js"
import { watchRunningHostInspection } from "./running-host-watch-client.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))

it.live(
  "Exit drains an in-flight production inspection read and its bounded watcher",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reading = yield* Deferred.make<void>()
        const stopped = yield* Deferred.make<void>()
        const fixture = yield* makeRunningHostFixture(builtEntry, true, {}, undefined, true)
        const reader: TrackerGraphReader["Service"] = {
          read: () =>
            Deferred.succeed(reading, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(stopped, undefined))
            ),
          readTaskWorkSpecification: () => Effect.die("inspection cannot read instructions")
        }
        const graph = {
          ...fixture.graph,
          run: (...args: Parameters<typeof fixture.graph.run>) =>
            Layer.effectContext(
              Layer.build(fixture.graph.run(...args)).pipe(
                Effect.map((context) => Context.add(context, TrackerGraphReader, reader))
              )
            )
        }
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* serveRunningHost(address, observation)
                const initial = yield* Deferred.make<void>()
                const frames = yield* Ref.make(0)
                const watcher = yield* watchRunningHostInspection(address, observation.selection.runId).pipe(
                  Stream.runForEach(() =>
                    Ref.update(frames, (count) => count + 1).pipe(Effect.andThen(Deferred.succeed(initial, undefined)))
                  ),
                  Effect.result,
                  Effect.forkChild
                )
                yield* Deferred.await(initial)
                yield* Deferred.await(reading)
                expect(yield* Deferred.isDone(stopped)).toBe(false)
                const result = yield* observation.applicationExitRequestBoundary.requestExit
                expect(result._tag).toBe("Succeeded")
                expect(yield* Deferred.isDone(stopped)).toBe(true)
                yield* Fiber.join(watcher)
                const afterExit = yield* Ref.get(frames)
                expect(afterExit).toBeGreaterThan(0)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(0)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(false)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
