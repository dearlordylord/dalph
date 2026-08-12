import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { expect } from "vitest"
import { OperationId } from "../../workflow/identity.js"
import { InterruptibleWorkflowBoundaryIntent } from "../../workflow/interpretation/interpreter.js"
import { ApplicationExitResult } from "./lifecycle-decision.js"
import { makeApplicationExitLifecycle } from "./lifecycle.js"

const trackerIntent = InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
  family: "TaskTracker",
  operationId: OperationId.make("application-exit-tracker-boundary")
})

const gitIntent = InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
  family: "Git",
  operationId: OperationId.make("application-exit-git-boundary")
})

it.effect("rolls back a preparing reservation when Exit closes admission before owner registration", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const preparation = yield* lifecycle.admission.prepareForwardOwner("InterruptibleBoundary")
    const reservationPrepared = yield* Deferred.make<void>()
    const allowRegistration = yield* Deferred.make<void>()
    let reservationHeld = false

    const admission = yield* Effect.gen(function* () {
      reservationHeld = true
      yield* Deferred.succeed(reservationPrepared, undefined)
      yield* Deferred.await(allowRegistration)
      return yield* preparation.register.pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            reservationHeld = false
          }).pipe(Effect.andThen(preparation.cancel))
        )
      )
    }).pipe(Effect.forkChild)

    yield* Deferred.await(reservationPrepared)
    yield* lifecycle.requestExit
    yield* Deferred.succeed(allowRegistration, undefined)
    expect((yield* Fiber.await(admission))._tag).toBe("Failure")
    expect(reservationHeld).toBe(false)
    expect(yield* lifecycle.admission.snapshot).toEqual({
      cutoffClosed: true,
      preparingOwnerCount: 0,
      registeredOwnerCount: 0
    })
  })
)

it.effect("joins repeated Exit requests to one result and never registers a later owner", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const first = yield* lifecycle.requestExit
    const repeated = yield* lifecycle.requestExit

    expect(first.first).toBe(true)
    expect(repeated.first).toBe(false)
    expect(repeated.cutoffAt).toBe(first.cutoffAt)
    expect(repeated.result).toBe(first.result)
    expect((yield* lifecycle.admission.prepareForwardOwner("AtomicBoundary").pipe(Effect.flip))._tag).toBe(
      "ApplicationExiting"
    )
    expect(yield* lifecycle.admission.snapshot).toEqual({
      cutoffClosed: true,
      preparingOwnerCount: 0,
      registeredOwnerCount: 0
    })

    const succeeded = ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })
    expect(yield* lifecycle.completeExit(succeeded)).toBe(true)
    expect(yield* Deferred.await(first.result)).toEqual(succeeded)
    expect(yield* Deferred.await(repeated.result)).toEqual(succeeded)
  })
)

it.effect("leaves an interrupted tracker request behind its exact acknowledged intent", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
    const callStarted = yield* Deferred.make<void>()
    const callInterrupted = yield* Deferred.make<void>()
    const request = yield* owner
      .run(
        trackerIntent,
        Deferred.succeed(callStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(callInterrupted, undefined))
        ),
        () => Effect.die("an interrupted request has no normalized result to record")
      )
      .pipe(Effect.forkChild)

    yield* Deferred.await(callStarted)
    yield* lifecycle.requestExit
    yield* Deferred.await(callInterrupted)

    expect((yield* Fiber.await(request))._tag).toBe("Failure")
    expect(yield* owner.snapshot).toEqual({ _tag: "RecoverableAmbiguity", intent: trackerIntent })
    yield* owner.release
    yield* lifecycle.awaitForwardOwnersReleased
  })
)

it.effect("records immediately available tracker and Git results before releasing their owners under Exit", () =>
  Effect.forEach([trackerIntent, gitIntent], (intent) =>
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
      const resultProduced = yield* Deferred.make<void>()
      const recordMayFinish = yield* Deferred.make<void>()
      const recorded = yield* Ref.make<ReadonlyArray<string>>([])
      const result = `ready-${intent.family}`
      const request = yield* owner
        .run(intent, Effect.succeed(result), (produced) =>
          Deferred.succeed(resultProduced, undefined).pipe(
            Effect.andThen(Deferred.await(recordMayFinish)),
            Effect.andThen(Ref.update(recorded, (values) => [...values, produced])),
            Effect.as(produced)
          )
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(resultProduced)
      yield* lifecycle.requestExit
      expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultProduced", intent })
      yield* Deferred.succeed(recordMayFinish, undefined)

      expect((yield* Fiber.await(request))._tag).toBe("Failure")
      expect(yield* Ref.get(recorded)).toEqual([result])
      expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultRecorded", intent })
      yield* owner.release
      yield* lifecycle.awaitForwardOwnersReleased
    })
  )
)

it.effect("starts no tracker or Git call whose acknowledged intent reaches the owner after cutoff", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
    const calls = yield* Ref.make(0)
    yield* lifecycle.requestExit

    const result = yield* owner
      .run(
        trackerIntent,
        Ref.update(calls, (count) => count + 1),
        () => Effect.void
      )
      .pipe(Effect.exit)

    expect(result._tag).toBe("Failure")
    expect(yield* Ref.get(calls)).toBe(0)
    expect(yield* owner.snapshot).toEqual({ _tag: "NoBoundaryCall" })
    yield* owner.release
  })
)

it.effect("lets an admitted atomic section return under Exit and starts no successor phase", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("AtomicBoundary")
    if (owner.kind !== "AtomicBoundary") return yield* Effect.die("wrong owner kind")
    const entered = yield* Deferred.make<void>()
    const mayReturn = yield* Deferred.make<void>()
    const successors = yield* Ref.make(0)
    const running = yield* owner
      .run(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(mayReturn))))
      .pipe(
        Effect.andThen(Ref.update(successors, (count) => count + 1)),
        Effect.ensuring(owner.release),
        Effect.forkChild
      )

    yield* Deferred.await(entered)
    yield* lifecycle.requestExit
    yield* Deferred.succeed(mayReturn, undefined)

    expect((yield* Fiber.await(running))._tag).toBe("Failure")
    expect(yield* Ref.get(successors)).toBe(0)
    yield* lifecycle.awaitForwardOwnersReleased
  })
)

it.effect("keeps a stuck atomic section owned after the application Exit cutoff", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("AtomicBoundary")
    if (owner.kind !== "AtomicBoundary") return yield* Effect.die("wrong owner kind")
    const entered = yield* Deferred.make<void>()
    const mayReturn = yield* Deferred.make<void>()
    const running = yield* owner
      .run(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(mayReturn))))
      .pipe(Effect.ensuring(owner.release), Effect.forkChild)

    yield* Deferred.await(entered)
    yield* lifecycle.requestExit

    expect(yield* lifecycle.admission.snapshot).toEqual({
      cutoffClosed: true,
      preparingOwnerCount: 0,
      registeredOwnerCount: 1
    })
    yield* Deferred.succeed(mayReturn, undefined)
    expect((yield* Fiber.await(running))._tag).toBe("Failure")
  })
)

it.effect("starts no atomic integration section after the application Exit cutoff", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("AtomicBoundary")
    if (owner.kind !== "AtomicBoundary") return yield* Effect.die("wrong owner kind")
    const calls = yield* Ref.make(0)
    yield* lifecycle.requestExit

    expect((yield* owner.run(Ref.update(calls, (count) => count + 1)).pipe(Effect.exit))._tag).toBe("Failure")
    expect(yield* Ref.get(calls)).toBe(0)
    yield* owner.release
  })
)
