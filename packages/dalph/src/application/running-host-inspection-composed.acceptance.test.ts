/* eslint-disable import/no-nodejs-modules -- The production composition consumes its exact built entry. */
import { fileURLToPath } from "node:url"
import { TrackerGraphReader } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Context, Deferred, Effect, Layer, Ref, Stream } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { serveRunningHost } from "./running-host-http.js"
import { callRunningHost } from "./running-host-client.js"
import { watchRunningHostInspection } from "./running-host-watch-client.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
it.live(
  "uses the composed reader and supplied root without workflow effects and exposes actual Run diagnostics",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, false, undefined, undefined, true)
        const composed = yield* Deferred.make<TrackerGraphReader["Service"]>()
        const graph = {
          ...fixture.graph,
          run: (...args: Parameters<typeof fixture.graph.run>) =>
            fixture.graph.run(...args).pipe(
              Layer.tap((context) => {
                const reader = Context.getOption(context, TrackerGraphReader)
                return reader._tag === "None"
                  ? Effect.die("production run must retain its existing reader")
                  : Deferred.succeed(composed, reader.value)
              })
            )
        }
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                const original = yield* Deferred.await(composed)
                yield* fixture.releaseObservationCut
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("5 seconds"))
                yield* observation.current.changes.pipe(
                  Stream.filter(
                    (state) =>
                      state._tag === "Ready" &&
                      state.evaluation.diagnostics?.tasks.some((task) => task.phase === "Executing") === true
                  ),
                  Stream.runHead,
                  Effect.timeout("5 seconds")
                )
                yield* Deferred.await(fixture.activationIdle).pipe(Effect.timeout("5 seconds"))
                const before = yield* fixture.readHistory(observation.selection.runId)
                const gitBefore = yield* Ref.get(fixture.gitCalls)
                yield* serveRunningHost(address, observation)
                const inspected = yield* watchRunningHostInspection(address, observation.selection.runId).pipe(
                  Stream.filter(
                    (frame) =>
                      frame.frame._tag === "Inspection" &&
                      frame.frame.value.inspection._tag === "Ready" &&
                      frame.frame.value.run._tag === "Ready"
                  ),
                  Stream.take(1),
                  Stream.runCollect
                )
                const frame = inspected[0]?.frame
                if (frame?._tag !== "Inspection" || frame.value.inspection._tag !== "Ready")
                  return expect.fail("requires complete inspection")
                const sameReaderSnapshot = yield* original.read(observation.target)
                expect(frame.value.inspection.value.graph).toEqual(sameReaderSnapshot.toWire())
                expect(frame.value.run._tag).toBe("Ready")
                if (frame.value.run._tag === "Ready")
                  expect(frame.value.run.delivery).toMatchObject({
                    _tag: "DeliveryStatusAvailable",
                    diagnostics: { tasks: expect.any(Array) }
                  })
                expect(
                  yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadRunControl" })
                ).toMatchObject({ result: { value: { _tag: "RunUnpaused" } } })
                const after = yield* fixture.readHistory(observation.selection.runId)
                // The independent activation may reconfirm its existing graph
                // while the executor is held. Inspection cannot add workflow
                // controls, claims, plans, sessions or durable UI observations.
                expect(
                  after
                    .slice(before.length)
                    .every(
                      ({ event }) =>
                        event._tag === "TaskTrackerReadIntentRecorded" || event._tag === "TaskTrackerFactsObserved"
                    )
                ).toBe(true)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(gitBefore)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(true)
              }).pipe(Effect.ensuring(observation.applicationExitRequestBoundary.requestExit.pipe(Effect.asVoid)))
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer), Effect.timeout("20 seconds")),
  30000
)

it.live(
  "inspection preserves paused history without scheduling or mutation effects",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, true, {})
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                const before = yield* fixture.readHistory(observation.selection.runId)
                yield* serveRunningHost(address, observation)
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                yield* watchRunningHostInspection(address, observation.selection.runId).pipe(
                  Stream.filter(
                    (frame) => frame.frame._tag === "Inspection" && frame.frame.value.inspection._tag === "Ready"
                  ),
                  Stream.take(1),
                  Stream.runDrain
                )
                expect(yield* fixture.readHistory(observation.selection.runId)).toEqual(before)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(0)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(false)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer), Effect.timeout("10 seconds")),
  15000
)
