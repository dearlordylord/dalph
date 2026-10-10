/* eslint-disable import/no-nodejs-modules, functional/immutable-data -- Native fixture locator and private read-side observation counters. */
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { JournalPosition, JournalStore, TraceCursor, makeTraceReader } from "@dalph/orchestrator"
import { Context, Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { serveRunningHost } from "./running-host-http.js"
import { callRunningHost } from "./running-host-client.js"
import { OccurrencePageCapacity } from "./running-host-occurrences-contract.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))

it.live(
  "disconnect interrupts native semantic history preparation without cancelling delivery or caching a partial history",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, true, undefined, { startupIncludesE: true })
        const storeReady = yield* Deferred.make<JournalStore["Service"]>()
        const graph = {
          ...fixture.graph,
          foundation: (...args: Parameters<typeof fixture.graph.foundation>) =>
            fixture.graph
              .foundation(...args)
              .pipe(Layer.tap((context) => Deferred.succeed(storeReady, Context.get(context, JournalStore))))
        }
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                const runId = observation.selection.runId
                const store = yield* Deferred.await(storeReady)
                yield* Deferred.await(fixture.turnEntered)
                yield* Deferred.await(fixture.activationFinalizing)
                yield* fixture.releaseObservationCut
                const bootstrap = yield* fixture.bootstrap
                for (let index = 0; index < 128; index++) {
                  yield* bootstrap.operatorControl.applyControlDirection({
                    direction: "Pause",
                    subject: { _tag: "Run", runId }
                  })
                }
                const records = yield* store.read(runId)
                const last = records.at(-1)
                if (last === undefined) return expect.fail("retained history required")
                const prefix = TraceCursor.make({ runId, position: last.position })
                // Measure only envelope inspections to distinguish semantic work from the initial yield.
                let prefixReads = 0
                const malformed = records.map((record, index) => ({
                  ...record,
                  position: JournalPosition.make(index === records.length - 1 ? records.length + 1 : index + 1),
                  get event() {
                    prefixReads += 1
                    return record.event
                  }
                }))
                yield* Effect.result(
                  makeTraceReader({ read: () => Effect.succeed(malformed) }).readOccurrencesAt(
                    TraceCursor.make({ runId, position: JournalPosition.make(records.length + 1) })
                  )
                )
                const entered = yield* Deferred.make<void>()
                const stopped = yield* Deferred.make<void>()
                let eventReads = 0
                let completed = false
                const observed = records.map((record) => ({
                  ...record,
                  get event() {
                    eventReads += 1
                    if (eventReads > prefixReads) Effect.runSync(Deferred.succeed(entered, undefined))
                    return record.event
                  }
                }))
                const reader = makeTraceReader({ read: () => Effect.succeed(observed) })
                const address = yield* availableLocalHostAddress
                yield* serveRunningHost(address, {
                  ...observation,
                  traceReader: {
                    ...observation.traceReader,
                    readOccurrencesAt: (cursor) =>
                      reader.readOccurrencesAt(cursor).pipe(
                        Effect.tap(() =>
                          Effect.sync(() => {
                            completed = true
                          })
                        ),
                        Effect.ensuring(Deferred.succeed(stopped, undefined))
                      )
                  }
                })
                const trackerCalls = yield* Ref.get(fixture.trackerCalls)
                const gitCalls = yield* Ref.get(fixture.gitCalls)
                const pending = yield* callRunningHost(address, runId, {
                  _tag: "ReadOccurrencePage",
                  prefix,
                  continuation: null,
                  capacityBytes: OccurrencePageCapacity.make(8192)
                }).pipe(Effect.forkScoped)
                yield* Deferred.await(entered)
                expect(eventReads).toBeGreaterThan(prefixReads)
                expect(completed).toBe(false)
                yield* Fiber.interrupt(pending)
                yield* Deferred.await(stopped).pipe(Effect.timeout("2 seconds"))
                expect(completed).toBe(false)
                const abandonedReads = eventReads
                const rebuilt = yield* reader.readOccurrencesAt(prefix)
                expect(eventReads).toBeGreaterThan(abandonedReads + records.length)
                expect(rebuilt.items).toEqual((yield* observation.traceReader.readAt(prefix)).items)
                expect(yield* reader.readOccurrencesAt(prefix)).toBe(rebuilt)
                expect(yield* store.read(runId)).toEqual(records)
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(trackerCalls)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(gitCalls)
                expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
                  result: { value: { _tag: "RunPaused" } }
                })
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer), Effect.timeout("20 seconds")),
  25000
)
