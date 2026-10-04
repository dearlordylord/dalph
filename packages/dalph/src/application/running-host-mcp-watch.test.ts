import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Deferred, Effect, Queue, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  LocalHostAddress,
  RequestId,
  SubscriptionId,
  WatchSequence,
  type RunningHostWatchFrame,
  runningHostLimits
} from "./running-host-contract.js"
import { makeRunningHostMcpWatches } from "./running-host-mcp-watch.js"

const runId = RunId.make("R")
const address = LocalHostAddress.make("http://127.0.0.1:43127")
const frame = (closed = false): RunningHostWatchFrame => ({
  protocolVersion: 1,
  requestId: RequestId.make("watch"),
  runId,
  subscriptionId: SubscriptionId.make("host-watch"),
  sequence: WatchSequence.make(0),
  frame: { _tag: "Snapshot", value: closed ? { _tag: "Closed", runId, final: null } : { _tag: "NotReady", runId } }
})

it.effect(
  "MCP pins current, coalesces pending hints, retains Closed after upstream release, repeats reads and expires resources",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const values = yield* Queue.unbounded<RunningHostWatchFrame>()
        const drained = yield* Queue.unbounded<void>()
        const hints = yield* Queue.unbounded<string>()
        const releases = yield* Ref.make(0)
        const watches = yield* makeRunningHostMcpWatches(
          address,
          runId,
          (uri) => Queue.offer(hints, uri).pipe(Effect.asVoid),
          () =>
            Stream.concat(Stream.make(frame()), Stream.fromQueue(values)).pipe(
              Stream.tap(() => Queue.offer(drained, undefined)),
              Stream.ensuring(Ref.update(releases, (count) => count + 1))
            )
        )
        const opened = yield* watches.open()
        yield* Queue.take(drained)
        yield* Queue.offer(values, frame())
        yield* Queue.take(drained)
        yield* Queue.offer(values, frame(true))
        yield* Queue.take(drained)
        yield* watches.subscribe(opened.uri)
        expect(yield* Queue.take(hints)).toBe(opened.uri)
        const current = yield* watches.read(opened.uri)
        expect(current.frame).toEqual(frame().frame)
        const closed = yield* watches.read(opened.uri)
        expect(closed.frame).toEqual(frame(true).frame)
        expect(closed.sequence).toBe(1)
        expect(yield* Ref.get(releases)).toBe(1)
        expect(yield* watches.read(opened.uri)).toEqual(closed)
        yield* TestClock.adjust(runningHostLimits.closedResourceMillis)
        expect(yield* watches.read(opened.uri).pipe(Effect.flip)).toMatchObject({ _tag: "InvalidRequest" })
        expect(yield* Ref.get(releases)).toBe(1)
      })
    )
)

it.effect(
  "MCP reserves eight resources before source acquisition and close/unsubscribe release only their own source",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const acquired = yield* Ref.make(0)
        const released = yield* Ref.make(0)
        const watches = yield* makeRunningHostMcpWatches(
          address,
          runId,
          () => Effect.void,
          () =>
            Stream.unwrap(
              Ref.update(acquired, (count) => count + 1).pipe(
                Effect.as(Stream.concat(Stream.make(frame()), Stream.never))
              )
            ).pipe(Stream.ensuring(Ref.update(released, (count) => count + 1)))
        )
        const opened = yield* Effect.forEach(Array.from({ length: 8 }), () => watches.open())
        expect(yield* watches.open().pipe(Effect.flip)).toMatchObject({
          _tag: "SubscriptionLimitExceeded",
          scope: "McpSession",
          limit: 8,
          current: 8
        })
        expect(yield* Ref.get(acquired)).toBe(8)
        const first = opened[0]
        if (first === undefined) return expect.fail("requires initial resource")
        yield* watches.close(first.subscriptionId)
        yield* watches.close(first.subscriptionId)
        expect(yield* Ref.get(released)).toBe(1)
        yield* watches.open()
        expect(yield* Ref.get(acquired)).toBe(9)
        const second = opened[1]
        if (second === undefined) return expect.fail("requires independent resource")
        yield* watches.unsubscribe(second.uri)
        expect(yield* Ref.get(released)).toBe(2)
        const third = opened[2]
        if (third === undefined) return expect.fail("requires surviving resource")
        expect((yield* watches.read(third.uri)).frame).toEqual(frame().frame)
      })
    )
)

it.effect(
  "An unread initial expires at thirty seconds, releases upstream, and leaves a typed failure until final expiry",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const released = yield* Ref.make(0)
        const watches = yield* makeRunningHostMcpWatches(
          address,
          runId,
          () => Effect.void,
          () =>
            Stream.concat(Stream.make(frame()), Stream.never).pipe(
              Stream.ensuring(Ref.update(released, (count) => count + 1))
            )
        )
        const opened = yield* watches.open()
        yield* TestClock.adjust(29999)
        expect(yield* Ref.get(released)).toBe(0)
        yield* TestClock.adjust(1)
        expect(yield* Ref.get(released)).toBe(1)
        expect((yield* watches.read(opened.uri)).frame).toMatchObject({
          _tag: "Failure",
          error: { _tag: "TransportFailed", reason: "WatchExpired" }
        })
        yield* TestClock.adjust(30000)
        expect(yield* watches.read(opened.uri).pipe(Effect.flip)).toMatchObject({ _tag: "InvalidRequest" })
      })
    )
)

it.effect("MCP preserves established request correlation after an abrupt source disconnect", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const disconnected = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      const watches = yield* makeRunningHostMcpWatches(
        address,
        runId,
        () => Effect.void,
        () =>
          Stream.concat(
            Stream.make(frame()),
            Stream.fromEffect(
              Deferred.await(disconnected).pipe(
                Effect.andThen(
                  Effect.fail({ _tag: "TransportFailed" as const, phase: "Watch" as const, reason: "AbruptDisconnect" })
                )
              )
            )
          ).pipe(Stream.ensuring(Deferred.succeed(released, undefined)))
      )
      const opened = yield* watches.open()
      const initial = yield* watches.read(opened.uri)
      yield* Deferred.succeed(disconnected, undefined)
      yield* Deferred.await(released)
      yield* Effect.yieldNow
      const failed = yield* watches.read(opened.uri)
      expect(failed.frame).toMatchObject({ _tag: "Failure", error: { reason: "AbruptDisconnect" } })
      expect(failed.requestId).toBe(initial.requestId)
      expect(failed.subscriptionId).toBe(initial.subscriptionId)
      expect(failed.sequence).toBe(1)
    })
  )
)

for (const timelyRead of [false, true])
  it.effect(
    `Subscribed unread pending expires without replacement resetting its timer${timelyRead ? "; timely consumption starts the next pending interval" : ""}`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const values = yield* Queue.unbounded<RunningHostWatchFrame>()
          const hints = yield* Queue.unbounded<string>()
          const drained = yield* Queue.unbounded<void>()
          const released = yield* Ref.make(0)
          const watches = yield* makeRunningHostMcpWatches(
            address,
            runId,
            (uri) => Queue.offer(hints, uri).pipe(Effect.asVoid),
            () =>
              Stream.concat(Stream.make(frame()), Stream.fromQueue(values)).pipe(
                Stream.tap(() => Queue.offer(drained, undefined)),
                Stream.ensuring(Ref.update(released, (count) => count + 1))
              )
          )
          const opened = yield* watches.open()
          yield* Queue.take(drained)
          yield* watches.read(opened.uri)
          yield* watches.subscribe(opened.uri)
          const publish = Queue.offer(values, frame()).pipe(
            Effect.andThen(Queue.take(drained)),
            Effect.andThen(Queue.take(hints))
          )
          yield* publish
          yield* TestClock.adjust(10000)
          yield* publish
          yield* TestClock.adjust(19999)
          expect(yield* Ref.get(released)).toBe(0)
          if (timelyRead) {
            expect((yield* watches.read(opened.uri)).frame._tag).toBe("Snapshot")
            yield* TestClock.adjust(1)
            expect(yield* Ref.get(released)).toBe(0)
            yield* publish
            yield* TestClock.adjust(29999)
            expect(yield* Ref.get(released)).toBe(0)
          }
          yield* TestClock.adjust(1)
          expect(yield* Ref.get(released)).toBe(1)
          expect((yield* watches.read(opened.uri)).frame).toMatchObject({
            _tag: "Failure",
            error: { _tag: "TransportFailed", reason: "WatchExpired" }
          })
        })
      )
  )

it.effect(
  "Eight retained final resources occupy reservations until their exact expiry; failed allocation rolls back",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const acquired = yield* Ref.make(0)
        const released = yield* Ref.make(0)
        const watches = yield* makeRunningHostMcpWatches(
          address,
          runId,
          () => Effect.void,
          () =>
            Stream.unwrap(
              Ref.updateAndGet(acquired, (count) => count + 1).pipe(
                Effect.map((count) =>
                  count === 1
                    ? Stream.fail({
                        _tag: "TransportFailed" as const,
                        phase: "Watch" as const,
                        reason: "FailedAllocation"
                      })
                    : Stream.make(frame(true))
                )
              )
            ).pipe(Stream.ensuring(Ref.update(released, (count) => count + 1)))
        )
        expect(yield* watches.open().pipe(Effect.flip)).toMatchObject({ reason: "FailedAllocation" })
        const finals = yield* Effect.forEach(Array.from({ length: 8 }), () => watches.open())
        for (const resource of finals) expect((yield* watches.read(resource.uri)).frame).toEqual(frame(true).frame)
        expect(yield* watches.open().pipe(Effect.flip)).toMatchObject({ _tag: "SubscriptionLimitExceeded", current: 8 })
        expect(yield* Ref.get(acquired)).toBe(9)
        expect(yield* Ref.get(released)).toBe(9)
        yield* TestClock.adjust(29999)
        expect(yield* watches.open().pipe(Effect.flip)).toMatchObject({ _tag: "SubscriptionLimitExceeded" })
        yield* TestClock.adjust(1)
        for (const resource of finals)
          expect(yield* watches.read(resource.uri).pipe(Effect.flip)).toMatchObject({ _tag: "InvalidRequest" })
        yield* watches.open()
        expect(yield* Ref.get(acquired)).toBe(10)
        expect(yield* Ref.get(released)).toBe(10)
      })
    )
)
