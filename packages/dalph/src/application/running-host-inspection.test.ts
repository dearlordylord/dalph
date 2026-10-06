import { it } from "@effect/vitest"
import { FixtureTarget, projectTrackerSnapshot, TrackerGraphReader, TrackerReadError } from "@dalph/orchestrator"
import { Context, Deferred, Effect, Fiber, Queue, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { makeRunningHostInspection, runningHostInspectionFromServices } from "./running-host-inspection.js"

const target = FixtureTarget.make("inspection-root")
const snapshot = Effect.sync(() =>
  projectTrackerSnapshot({
    revision: "inspection-graph",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
).pipe(Effect.flatMap((result) => (result._tag === "Valid" ? Effect.succeed(result.snapshot) : Effect.die(result))))
const unused = () => Effect.die("inspection must not read task instructions")

it.effect("coalesces manual reads and owns one thirty-second refresh", () =>
  Effect.gen(function* () {
    const graph = yield* snapshot
    const entered = yield* Queue.unbounded<void>()
    const release = yield* Deferred.make<void>()
    const calls = yield* Ref.make(0)
    const reader: TrackerGraphReader["Service"] = {
      read: (actual) =>
        Effect.gen(function* () {
          expect(actual).toEqual(target)
          yield* Ref.update(calls, (value) => value + 1)
          yield* Queue.offer(entered, undefined)
          yield* Deferred.await(release)
          return graph
        }),
      readTaskWorkSpecification: unused
    }
    const owner = yield* makeRunningHostInspection(reader, target)
    yield* Queue.take(entered)
    const clients = yield* Effect.all([owner.refresh, owner.refresh], { concurrency: "unbounded" }).pipe(
      Effect.forkChild
    )
    yield* TestClock.adjust("0 millis")
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(clients)
    expect(yield* Ref.get(calls)).toBe(1)
    expect((yield* owner.current)._tag).toBe("Ready")
    yield* TestClock.adjust("29 seconds")
    expect(yield* Ref.get(calls)).toBe(1)
    yield* TestClock.adjust("1 second")
    yield* Queue.take(entered)
    expect(yield* Ref.get(calls)).toBe(2)
  }).pipe(Effect.scoped)
)

it.effect(
  "scheduled inspection marks its process-local retained graph stale and reports initial failure as unavailable",
  () =>
    Effect.gen(function* () {
      const graph = yield* snapshot
      const failing = yield* Ref.make(true)
      const reader: TrackerGraphReader["Service"] = {
        read: () =>
          Ref.get(failing).pipe(
            Effect.flatMap((fail) =>
              fail
                ? Effect.fail(new TrackerReadError({ operation: "TrackerGraphReader.decode", detail: "incomplete" }))
                : Effect.succeed(graph)
            )
          ),
        readTaskWorkSpecification: unused
      }
      const owner = yield* makeRunningHostInspection(reader, target)
      yield* Stream.runHead(owner.changes.pipe(Stream.filter((state) => state._tag === "Unavailable")))
      expect((yield* owner.current)._tag).toBe("Unavailable")
      yield* Ref.set(failing, false)
      yield* TestClock.adjust("30 seconds")
      const complete = yield* owner.current
      expect(complete._tag).toBe("Ready")
      yield* Ref.set(failing, true)
      yield* TestClock.adjust("30 seconds")
      const stale = yield* owner.current
      expect(stale._tag).toBe("Stale")
      if (stale._tag === "Stale" && complete._tag === "Ready") expect(stale.value).toEqual(complete.value)
      yield* Ref.set(failing, false)
      yield* TestClock.adjust("30 seconds")
      expect((yield* owner.current)._tag).toBe("Ready")
    }).pipe(Effect.scoped)
)

it.effect("a disconnected observer does not cancel the host read, and Exit stops its writers", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    const reader: TrackerGraphReader["Service"] = {
      read: () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(stopped, undefined))
        ),
      readTaskWorkSpecification: unused
    }
    const owner = yield* makeRunningHostInspection(reader, target)
    yield* Deferred.await(entered)
    const observer = yield* owner.refresh.pipe(Effect.forkChild)
    yield* TestClock.adjust("0 millis")
    yield* Fiber.interrupt(observer)
    expect(yield* Deferred.isDone(stopped)).toBe(false)
    yield* owner.stop
    expect(yield* Deferred.isDone(stopped)).toBe(true)
  }).pipe(Effect.scoped)
)

it.effect("restart reconstructs without durable inspection state", () =>
  Effect.gen(function* () {
    const graph = yield* snapshot
    const calls = yield* Ref.make(0)
    const available = yield* Ref.make(true)
    const reader: TrackerGraphReader["Service"] = {
      read: (actual) => {
        expect(actual).toEqual(target)
        return Ref.update(calls, (value) => value + 1).pipe(
          Effect.andThen(Ref.get(available)),
          Effect.flatMap((value) =>
            value
              ? Effect.succeed(graph)
              : Effect.fail(
                  new TrackerReadError({ operation: "TrackerGraphReader.decode", detail: "unavailable after restart" })
                )
          )
        )
      },
      readTaskWorkSpecification: unused
    }
    const first = yield* makeRunningHostInspection(reader, target)
    yield* Stream.runHead(first.changes.pipe(Stream.filter((state) => state._tag === "Ready")))
    yield* first.stop
    yield* Ref.set(available, false)
    const restarted = yield* makeRunningHostInspection(reader, target)
    yield* TestClock.adjust("0 millis")

    expect((yield* restarted.current)._tag).toBe("Unavailable")
    expect(yield* Ref.get(calls)).toBe(2)
  }).pipe(Effect.scoped)
)

it.effect("inspection selects the exact composed reader and never constructs a fallback", () =>
  Effect.gen(function* () {
    const graph = yield* snapshot
    const calls = yield* Ref.make(0)
    const reader: TrackerGraphReader["Service"] = {
      read: (actual) => {
        expect(actual).toEqual(target)
        return Ref.update(calls, (count) => count + 1).pipe(Effect.as(graph))
      },
      readTaskWorkSpecification: unused
    }
    expect(runningHostInspectionFromServices(Context.empty(), target)._tag).toBe("None")
    const selected = runningHostInspectionFromServices(Context.make(TrackerGraphReader, reader), target)
    if (selected._tag === "None") return expect.fail("requires the composed reader")
    // The workflow's port and production inspection selector consume this one
    // counted service; no independent reader can produce these observations.
    yield* reader.read(target)
    const owner = yield* selected.value
    yield* TestClock.adjust("0 millis")
    expect((yield* owner.current)._tag).toBe("Ready")
    expect(yield* Ref.get(calls)).toBe(2)
  }).pipe(Effect.scoped)
)
