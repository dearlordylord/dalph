import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Queue, Ref, Stream } from "effect"
import { expect } from "vitest"
import { makeRunningHostWatchStage } from "./running-host-watch-stage.js"
import type { RunningHostError } from "./running-host-contract.js"

const fail = (error: RunningHostError) => `Failure:${error._tag}`
it.effect(
  "Distinct complete runtime states at one accepted journal position remain eligible and Closed retains the exact final value",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        type State =
          | { _tag: "Ready"; acceptedAt: number; runtime: string }
          | { _tag: "Closed"; final: { _tag: "Ready"; acceptedAt: number; runtime: string } }
          | { _tag: "Failure" }
        const first: State = { _tag: "Ready", acceptedAt: 9, runtime: "Executing" }
        const later: Extract<State, { _tag: "Ready" }> = { _tag: "Ready", acceptedAt: 9, runtime: "Suspending" }
        const changes = yield* Queue.unbounded<State>()
        const consumed = yield* Queue.unbounded<void>()
        const stage = yield* makeRunningHostWatchStage(
          Stream.concat(Stream.make(first), Stream.fromQueue(changes)).pipe(
            Stream.tap(() => Queue.offer(consumed, undefined))
          ),
          (value) => value._tag === "Closed",
          (): State => ({ _tag: "Failure" })
        )
        expect(yield* stage.takeInitial).toEqual(first)
        yield* Queue.take(consumed)
        yield* Queue.offer(changes, later)
        yield* Queue.take(consumed)
        expect(yield* stage.take).toEqual(later)
        yield* Queue.offer(changes, { _tag: "Closed", final: later })
        yield* stage.awaitReleased
        expect(yield* stage.take).toEqual({ _tag: "Closed", final: later })
      })
    )
)
it.effect(
  "Attachment preserves initial while its independent pump drains latest and releases upstream before Closed is read",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<string>()
        const consumed = yield* Queue.unbounded<string>()
        const finalized = yield* Ref.make(0)
        const source = Stream.concat(Stream.make("current"), Stream.fromQueue(queue)).pipe(
          Stream.tap((value) => Queue.offer(consumed, value)),
          Stream.ensuring(Ref.update(finalized, (count) => count + 1))
        )
        const stage = yield* makeRunningHostWatchStage(source, (value) => value === "Closed", fail)
        expect(yield* stage.takeInitial).toBe("current")
        expect(yield* Queue.take(consumed)).toBe("current")
        for (const value of ["same-position-one", "same-position-two", "latest"]) {
          yield* Queue.offer(queue, value)
          expect(yield* Queue.take(consumed)).toBe(value)
        }
        expect(yield* stage.take).toBe("latest")
        yield* Queue.offer(queue, "ordinary")
        expect(yield* Queue.take(consumed)).toBe("ordinary")
        yield* Queue.offer(queue, "Closed")
        yield* stage.awaitReleased
        expect(yield* Ref.get(finalized)).toBe(1)
        expect(yield* stage.take).toBe("Closed")
        yield* stage.stop
        expect(yield* Ref.get(finalized)).toBe(1)
      })
    )
)

it.effect("Disconnect stops only its exact pump and pending waiter while another subscription delivers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const releases = yield* Ref.make<ReadonlyArray<string>>([])
      const make = (id: string) =>
        makeRunningHostWatchStage(
          Stream.concat(Stream.make(id), Stream.never).pipe(
            Stream.ensuring(Ref.update(releases, (values) => [...values, id]))
          ),
          () => false,
          fail
        )
      const first = yield* make("first")
      const second = yield* make("second")
      const waiting = yield* first.take.pipe(Effect.forkChild)
      yield* first.stop
      yield* Fiber.interrupt(waiting)
      expect(yield* Ref.get(releases)).toEqual(["first"])
      expect(yield* second.takeInitial).toBe("second")
      yield* second.stop
      expect(yield* Ref.get(releases)).toEqual(["first", "second"])
    })
  )
)

it.effect("Bare upstream EOF becomes transport failure and closed reconnect supplies Closed current", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const ended = yield* makeRunningHostWatchStage(Stream.make("current"), () => false, fail)
      yield* ended.awaitReleased
      expect(yield* ended.take).toBe("Failure:TransportFailed")
      const reconnect = yield* makeRunningHostWatchStage(Stream.make("Closed"), (value) => value === "Closed", fail)
      expect(yield* reconnect.takeInitial).toBe("Closed")
      const released = yield* Deferred.make<void>()
      yield* reconnect.awaitReleased.pipe(Effect.andThen(Deferred.succeed(released, undefined)))
      expect(yield* Deferred.isDone(released)).toBe(true)
    })
  )
)
