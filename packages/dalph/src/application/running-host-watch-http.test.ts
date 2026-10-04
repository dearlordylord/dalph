import { currentSignalFromCurrentFirstStream, type DeliveryRuntimeObservationState } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { TestClock } from "effect/testing"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { serveRunningHost } from "./running-host-http.js"
import { writeRunningHostWatchFrame } from "./running-host-http-watch.js"
import { watchRunningHost } from "./running-host-watch-client.js"
import { runningHostLimits, watchFrameEnds } from "./running-host-contract.js"

it.live(
  "HTTP preserves initial while a blocked writer drains and releases before Closed, then reconnects from current Closed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const state = yield* SubscriptionRef.make<DeliveryRuntimeObservationState>({ _tag: "NotReady" })
        const attached = yield* Ref.make(0)
        const released = yield* Deferred.make<void>()
        const source = currentSignalFromCurrentFirstStream(
          SubscriptionRef.changes(state).pipe(Stream.ensuring(Deferred.succeed(released, undefined)))
        )
        const current = {
          ...source,
          attach: source.attach.pipe(Effect.tap(() => Ref.update(attached, (count) => count + 1)))
        }
        const writing = yield* Deferred.make<void>()
        const resume = yield* Deferred.make<void>()
        const address = yield* availableLocalHostAddress
        yield* serveRunningHost(address, { ...probe.observation, current }, (response, frame) =>
          Effect.gen(function* () {
            if (frame.sequence === 0 && frame.frame._tag === "Snapshot" && frame.frame.value._tag !== "Closed") {
              yield* Deferred.succeed(writing, undefined)
              yield* Deferred.await(resume)
            }
            yield* writeRunningHostWatchFrame(response, frame)
          })
        )
        const client = yield* watchRunningHost(address, probe.runId).pipe(Stream.runCollect, Effect.forkChild)
        yield* Deferred.await(writing)
        for (let index = 0; index < 100; index += 1) yield* SubscriptionRef.set(state, { _tag: "NotReady" })
        yield* SubscriptionRef.set(state, { _tag: "Closed", final: null })
        yield* Deferred.await(released)
        expect(yield* Ref.get(attached)).toBe(1)
        yield* Deferred.succeed(resume, undefined)
        const frames = yield* Fiber.join(client)
        expect(frames.map(({ frame }) => frame)).toEqual([
          { _tag: "Snapshot", value: { _tag: "NotReady", runId: probe.runId } },
          { _tag: "Snapshot", value: { _tag: "Closed", runId: probe.runId, final: null } }
        ])
        const reconnect = yield* watchRunningHost(address, probe.runId).pipe(Stream.runCollect)
        expect(reconnect).toHaveLength(1)
        const final = reconnect[0]
        if (final === undefined) return expect.fail("requires Closed reconnect")
        expect(watchFrameEnds(final)).toBe(true)
        expect(yield* Ref.get(probe.reads)).toBe(0)
      })
    )
)

for (const recover of [true, false])
  it.effect(
    `A blocked HTTP frame ${recover ? "recovers before" : "fails at"} the finite deadline and releases its exact source`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const probe = yield* makeRunningHostReadProbe()
          const released = yield* Ref.make(0)
          const source = currentSignalFromCurrentFirstStream(
            Stream.concat(
              Stream.fromIterable<DeliveryRuntimeObservationState>([{ _tag: "NotReady" }]),
              Stream.never
            ).pipe(Stream.ensuring(Ref.update(released, (count) => count + 1)))
          )
          const blocked = yield* Deferred.make<void>()
          const resume = yield* Deferred.make<void>()
          const address = yield* availableLocalHostAddress
          yield* serveRunningHost(address, { ...probe.observation, current: source }, (response, frame) =>
            Deferred.succeed(blocked, undefined).pipe(
              Effect.andThen(Deferred.await(resume)),
              Effect.andThen(writeRunningHostWatchFrame(response, frame))
            )
          )
          const client = yield* watchRunningHost(address, probe.runId).pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.result,
            Effect.forkChild
          )
          yield* Deferred.await(blocked)
          yield* TestClock.adjust(4999)
          expect(yield* Ref.get(released)).toBe(0)
          if (recover) yield* Deferred.succeed(resume, undefined)
          else yield* TestClock.adjust(1)
          const result = yield* Fiber.join(client)
          expect(result._tag).toBe(recover ? "Success" : "Failure")
          if (!recover && result._tag === "Failure") expect(result.failure).toMatchObject({ _tag: "TransportFailed" })
        })
      )
  )

it.live(
  "Host reserves thirty-two independent source leases and rejects the next watch before upstream allocation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const count = yield* Ref.make(0)
        const source = currentSignalFromCurrentFirstStream(
          Stream.concat(
            Stream.fromIterable<DeliveryRuntimeObservationState>([{ _tag: "NotReady" }]),
            Stream.never
          ).pipe(Stream.ensuring(Ref.update(count, (current) => current - 1)))
        )
        const current = {
          ...source,
          attach: source.attach.pipe(Effect.tap(() => Ref.update(count, (current) => current + 1)))
        }
        const address = yield* availableLocalHostAddress
        yield* serveRunningHost(address, { ...probe.observation, current })
        const clients = []
        for (let index = 0; index < runningHostLimits.hostSubscriptions; index += 1) {
          const initial = yield* Deferred.make<void>()
          clients.push(
            yield* watchRunningHost(address, probe.runId).pipe(
              Stream.tap(() => Deferred.succeed(initial, undefined)),
              Stream.runDrain,
              Effect.forkChild
            )
          )
          yield* Deferred.await(initial)
        }
        expect(yield* Ref.get(count)).toBe(32)
        const rejected = yield* watchRunningHost(address, probe.runId).pipe(Stream.runHead)
        expect(rejected).toMatchObject({
          _tag: "Some",
          value: {
            frame: {
              _tag: "Failure",
              error: { _tag: "SubscriptionLimitExceeded", scope: "Host", limit: 32, current: 32 }
            }
          }
        })
        expect(yield* Ref.get(count)).toBe(32)
        const first = clients[0]
        if (first === undefined) return expect.fail("requires first client")
        yield* Fiber.interrupt(first)
        // A replacement's successful attachment proves the disconnected exact slot returned.
        const initial = yield* Deferred.make<void>()
        const replacement = yield* watchRunningHost(address, probe.runId).pipe(
          Stream.tap(() => Deferred.succeed(initial, undefined)),
          Stream.runDrain,
          Effect.forkChild
        )
        yield* Deferred.await(initial)
        expect(yield* Ref.get(count)).toBe(32)
        yield* Fiber.interrupt(replacement)
      })
    )
)
