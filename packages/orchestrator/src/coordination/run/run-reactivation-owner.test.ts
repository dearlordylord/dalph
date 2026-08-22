import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref, Schedule, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { currentSignalOf } from "../delivery/relations.js"
import { RunFinalityDecision } from "../frontier/frontier.js"
import {
  attachRunReactivationHintSource,
  makeRunReactivationOwner,
  RunReactivationHint
} from "./run-reactivation-owner.js"

class TestTrackerReadFailure extends Schema.TaggedError<TestTrackerReadFailure>()("TestTrackerReadFailure", {
  detail: Schema.String
}) {}

it.effect("rejects a non-positive reactivation interval at the owner boundary", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      makeRunReactivationOwner({
        activationInterval: "0 seconds",
        activate: Effect.succeed(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
      })
    )
    expect(result._tag).toBe("Failure")
  })
)

it.effect("rechecks an unterminated Run after a lost notification when TestClock fires", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const firstActivation = yield* Deferred.make<void>()
      const secondActivation = yield* Deferred.make<void>()
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 second",
        retrySchedule: Schedule.recurs(0),
        activate: Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(activations, (current) => current + 1)
          if (count === 1) yield* Deferred.succeed(firstActivation, undefined)
          if (count === 2) yield* Deferred.succeed(secondActivation, undefined)
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        })
      })
      const running = yield* owner.run.pipe(Effect.forkScoped)

      yield* Deferred.await(firstActivation)
      expect(yield* Ref.get(activations)).toBe(1)
      yield* TestClock.adjust("1 second")
      yield* Deferred.await(secondActivation)

      expect(yield* Ref.get(activations)).toBe(2)
      yield* owner.stop()
      yield* Fiber.join(running)
    })
  )
)

it.effect("keeps one activation owner while hints arrive concurrently", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const secondRelease = yield* Deferred.make<void>()
      const thirdStarted = yield* Deferred.make<void>()
      const thirdRelease = yield* Deferred.make<void>()
      const activationCount = yield* Ref.make(0)
      const concurrent = yield* Ref.make(0)
      const maximumConcurrent = yield* Ref.make(0)
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 hour",
        retrySchedule: Schedule.recurs(0),
        activate: Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(activationCount, (current) => current + 1)
          yield* Ref.update(concurrent, (current) => current + 1)
          const active = yield* Ref.get(concurrent)
          yield* Ref.update(maximumConcurrent, (current) => Math.max(current, active))
          if (count === 1) {
            yield* Deferred.succeed(firstStarted, undefined)
            yield* Deferred.await(firstRelease)
          } else if (count === 2) {
            yield* Deferred.succeed(secondStarted, undefined)
            yield* Deferred.await(secondRelease)
          } else {
            yield* Deferred.succeed(thirdStarted, undefined)
            yield* Deferred.await(thirdRelease)
          }
          yield* Ref.update(concurrent, (current) => current - 1)
          return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
        })
      })
      const running = yield* owner.run.pipe(Effect.forkScoped)
      yield* Deferred.await(firstStarted)

      yield* Effect.forEach(
        [
          RunReactivationHint.TrackerNotification(),
          RunReactivationHint.AcceptedFactPublication(),
          RunReactivationHint.OperatorWake()
        ],
        owner.hint
      )
      yield* Deferred.succeed(firstRelease, undefined)
      yield* Deferred.await(secondStarted)
      yield* Effect.forEach([RunReactivationHint.Timer(), RunReactivationHint.OperatorWake()], owner.hint)
      yield* Deferred.succeed(secondRelease, undefined)
      yield* Deferred.await(thirdStarted)
      yield* Deferred.succeed(thirdRelease, undefined)
      yield* Effect.yieldNow

      expect(yield* Ref.get(activationCount)).toBe(3)
      expect(yield* Ref.get(maximumConcurrent)).toBe(1)
      yield* owner.stop()
      yield* Fiber.join(running)
    })
  )
)

it.effect("rereads current facts after a transient failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const firstFailure = yield* Deferred.make<void>()
      const failures = yield* Ref.make(0)
      const recovered = yield* Deferred.make<void>()
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 hour",
        retrySchedule: Schedule.recurs(0),
        onFailure: () =>
          Ref.update(failures, (current) => current + 1).pipe(
            Effect.andThen(Deferred.succeed(firstFailure, undefined))
          ),
        activate: Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(activations, (current) => current + 1)
          if (count === 1) return yield* new TestTrackerReadFailure({ detail: "tracker unavailable" })
          yield* Deferred.succeed(recovered, undefined)
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        })
      })
      const running = yield* owner.run.pipe(Effect.forkScoped)

      yield* Deferred.await(firstFailure)
      expect(yield* Ref.get(activations)).toBe(1)
      expect(yield* Ref.get(failures)).toBe(1)
      yield* owner.hint(RunReactivationHint.OperatorWake())
      yield* Deferred.await(recovered)

      expect(yield* Ref.get(activations)).toBe(2)
      yield* owner.stop()
      yield* Fiber.join(running)
    })
  )
)

it.effect("uses the ordinary fresh-check boundary for a hint received before source attachment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const activated = yield* Deferred.make<void>()
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 hour",
        retrySchedule: Schedule.recurs(0),
        activate: Effect.gen(function* () {
          yield* Ref.update(activations, (current) => current + 1)
          yield* Deferred.succeed(activated, undefined)
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        })
      })

      // No source subscription exists yet. The hint is retained only as an
      // ephemeral trigger; activation still enters runWorkflow's fresh read.
      yield* owner.hint(RunReactivationHint.TrackerNotification())
      const running = yield* owner.run.pipe(Effect.forkScoped)
      yield* Deferred.await(activated)

      expect(yield* Ref.get(activations)).toBe(1)
      yield* owner.stop()
      yield* Fiber.join(running)
    })
  )
)

it.effect("attaches a CurrentSignal current value before listening for later publications", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const activated = yield* Deferred.make<void>()
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 hour",
        retrySchedule: Schedule.recurs(0),
        activate: Ref.update(activations, (current) => current + 1).pipe(
          Effect.tap(() => Deferred.succeed(activated, undefined)),
          Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
        )
      })
      yield* attachRunReactivationHintSource(owner, {
        signal: currentSignalOf("current-before-attachment"),
        hint: RunReactivationHint.AcceptedFactPublication()
      })
      const running = yield* owner.run.pipe(Effect.forkScoped)
      yield* Deferred.await(activated)
      expect(yield* Ref.get(activations)).toBe(1)
      yield* owner.stop()
      yield* Fiber.join(running)
    })
  )
)

it.effect("backs off a typed tracker read failure and waits for a later hint", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const firstAttempt = yield* Deferred.make<void>()
      const secondAttempt = yield* Deferred.make<void>()
      const exhausted = yield* Deferred.make<void>()
      const recovered = yield* Deferred.make<void>()
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 hour",
        retrySchedule: Schedule.exponential("1 second").pipe(Schedule.upTo({ times: 1 })),
        onFailure: () => Deferred.succeed(exhausted, undefined),
        activate: Effect.gen(function* () {
          const attempt = yield* Ref.updateAndGet(attempts, (current) => current + 1)
          if (attempt === 1) {
            yield* Deferred.succeed(firstAttempt, undefined)
            return yield* new TestTrackerReadFailure({ detail: "tracker unavailable" })
          }
          if (attempt === 2) {
            yield* Deferred.succeed(secondAttempt, undefined)
            return yield* new TestTrackerReadFailure({ detail: "tracker unavailable" })
          }
          yield* Deferred.succeed(recovered, undefined)
          return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        })
      })
      const running = yield* owner.run.pipe(Effect.forkScoped)

      yield* Deferred.await(firstAttempt)
      yield* TestClock.adjust("999 millis")
      expect(yield* Ref.get(attempts)).toBe(1)
      yield* TestClock.adjust("1 millis")
      yield* Deferred.await(secondAttempt)
      yield* Deferred.await(exhausted)
      expect(yield* Ref.get(attempts)).toBe(2)

      // The bounded retry is over; only a new hint may authorize another
      // current check, so the owner cannot hot-loop on the same failure.
      yield* owner.hint(RunReactivationHint.OperatorWake())
      yield* Deferred.await(recovered)
      expect(yield* Ref.get(attempts)).toBe(3)
      yield* owner.stop()
      yield* Fiber.join(running)
    })
  )
)

it.effect("suppresses polling while paused and checks once after Unpause", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const firstActivation = yield* Deferred.make<void>()
      const secondActivation = yield* Deferred.make<void>()
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 second",
        retrySchedule: Schedule.recurs(0),
        activate: Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(activations, (current) => current + 1)
          if (count === 1) yield* Deferred.succeed(firstActivation, undefined)
          if (count === 2) yield* Deferred.succeed(secondActivation, undefined)
          return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
        })
      })
      const running = yield* owner.run.pipe(Effect.forkScoped)
      yield* Deferred.await(firstActivation)
      yield* owner.pause()
      yield* TestClock.adjust("1 hour")
      yield* owner.hint(RunReactivationHint.TrackerNotification())
      expect(yield* Ref.get(activations)).toBe(1)
      yield* owner.unpause()
      yield* Deferred.await(secondActivation)
      expect(yield* Ref.get(activations)).toBe(2)
      yield* owner.stop()
      yield* Fiber.join(running)
    })
  )
)

it.effect("stops after Run termination and on an application Exit stop", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const terminated = yield* Deferred.make<void>()
      const owner = yield* makeRunReactivationOwner({
        activationInterval: "1 second",
        retrySchedule: Schedule.recurs(0),
        activate: Effect.gen(function* () {
          yield* Ref.update(activations, (current) => current + 1)
          yield* Deferred.succeed(terminated, undefined)
          return RunFinalityDecision.RunMayTerminate()
        })
      })
      const running = yield* owner.run.pipe(Effect.forkScoped)
      yield* Deferred.await(terminated)
      yield* owner.hint(RunReactivationHint.OperatorWake())
      yield* TestClock.adjust("1 hour")
      expect(yield* Ref.get(activations)).toBe(1)
      yield* Fiber.join(running)

      const exitStarted = yield* Deferred.make<void>()
      const exitRelease = yield* Deferred.make<void>()
      const exitOwner = yield* makeRunReactivationOwner({
        activationInterval: "1 second",
        retrySchedule: Schedule.recurs(0),
        activate: Ref.updateAndGet(activations, (current) => current + 1).pipe(
          Effect.tap(() => Deferred.succeed(exitStarted, undefined)),
          Effect.andThen(Deferred.await(exitRelease)),
          Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
        )
      })
      const exitRunning = yield* exitOwner.run.pipe(Effect.forkScoped)
      yield* Deferred.await(exitStarted)
      yield* exitOwner.stop()
      yield* Deferred.succeed(exitRelease, undefined)
      yield* Fiber.join(exitRunning)
      yield* TestClock.adjust("1 hour")
      expect(yield* Ref.get(activations)).toBe(2)
    })
  )
)
