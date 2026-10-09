import { currentSignalFromCurrentFirstStream, type DeliveryRuntimeObservationState } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Queue, Ref, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { serveRunningHost } from "./running-host-http.js"
import { InspectionObservedAt, type RunningHostInspection } from "./running-host-inspection.js"
import { watchRunningHostInspection } from "./running-host-watch-client.js"
import { type RunningHostWatchFrame } from "./running-host-contract.js"

it.live("publishes inspection changes through bounded watch and reconnects to current state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const run = yield* SubscriptionRef.make<DeliveryRuntimeObservationState>({ _tag: "NotReady" })
      const inspection = yield* SubscriptionRef.make<RunningHostInspection>({ _tag: "Loading" })
      const released = yield* Deferred.make<void>()
      const address = yield* availableLocalHostAddress
      yield* serveRunningHost(address, {
        ...probe.observation,
        current: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(run)),
        inspection: Effect.succeed({
          current: SubscriptionRef.get(inspection),
          changes: SubscriptionRef.changes(inspection).pipe(Stream.ensuring(Deferred.succeed(released, undefined))),
          refresh: Effect.void,
          stop: Effect.void
        })
      })
      const frames = yield* Queue.unbounded<RunningHostWatchFrame>()
      const client = yield* watchRunningHostInspection(address, probe.runId).pipe(
        Stream.runForEach((frame) => Queue.offer(frames, frame)),
        Effect.forkChild
      )
      const initial = yield* Queue.take(frames)
      expect(initial.frame).toMatchObject({ _tag: "Inspection", value: { inspection: { _tag: "Loading" } } })
      yield* SubscriptionRef.set(run, { _tag: "Closed", final: null })
      yield* Queue.takeBetween(frames, 1, 100).pipe(
        Effect.repeat({
          while: (batch) =>
            !batch.some((frame) => frame.frame._tag === "Inspection" && frame.frame.value.run._tag === "Closed")
        })
      )
      const unavailable: RunningHostInspection = {
        _tag: "Unavailable",
        failedAt: InspectionObservedAt.make(0),
        reason: "IncompleteGraph"
      }
      yield* SubscriptionRef.set(inspection, unavailable)
      const updated = yield* Queue.takeBetween(frames, 1, 100).pipe(
        Effect.repeat({
          while: (batch) =>
            !batch.some(
              (frame) => frame.frame._tag === "Inspection" && frame.frame.value.inspection._tag === "Unavailable"
            )
        })
      )
      expect(updated.at(-1)?.frame).toMatchObject({
        _tag: "Inspection",
        value: { run: { _tag: "Closed" }, inspection: unavailable }
      })
      yield* Fiber.interrupt(client)
      yield* Deferred.await(released)
      const reconnect = yield* watchRunningHostInspection(address, probe.runId).pipe(Stream.take(1), Stream.runCollect)
      expect(reconnect[0]?.frame).toMatchObject({
        _tag: "Inspection",
        value: { run: { _tag: "Closed" }, inspection: unavailable }
      })
    })
  )
)

it.live(
  "An oversized required current inspection is refused whole, releases its slot and reconnects to latest state without workflow calls",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const inspection = yield* SubscriptionRef.make<RunningHostInspection>({
          _tag: "Unavailable",
          failedAt: InspectionObservedAt.make(0),
          reason: "x".repeat(2097152)
        })
        const releases = yield* Queue.unbounded<void>()
        const address = yield* availableLocalHostAddress
        yield* serveRunningHost(address, {
          ...probe.observation,
          current: {
            ...probe.observation.current,
            attach: Effect.acquireRelease(Effect.void, () => Queue.offer(releases, undefined)).pipe(
              Effect.as({ current: { _tag: "NotReady" as const }, changes: Stream.never })
            )
          },
          inspection: Effect.succeed({
            current: SubscriptionRef.get(inspection),
            changes: SubscriptionRef.changes(inspection),
            refresh: Effect.die("observer cannot refresh authority"),
            stop: Effect.void
          })
        })
        const refused = yield* watchRunningHostInspection(address, probe.runId).pipe(Stream.runCollect)
        expect(refused).toHaveLength(1)
        expect(refused[0]?.frame).toMatchObject({
          _tag: "Failure",
          error: { _tag: "FrameTooLarge", direction: "Outgoing", maximumBytes: 2097152 }
        })
        yield* Queue.take(releases)
        yield* SubscriptionRef.set(inspection, { _tag: "Loading" })
        const latest = yield* watchRunningHostInspection(address, probe.runId).pipe(Stream.take(1), Stream.runCollect)
        expect(latest[0]?.frame).toMatchObject({ _tag: "Inspection", value: { inspection: { _tag: "Loading" } } })
        yield* Queue.take(releases)
        expect(yield* probe.observation.current.get).toEqual({ _tag: "NotReady" })
        expect(yield* Ref.get(probe.reads)).toBe(0)
      })
    )
)
