import { it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { expect } from "vitest"
import type { AuthoredPlannedSuspensionBoundaryCorrelation } from "../../src/cassettes/authored-domain.js"
import { makePlannedSuspensionBoundaryGates } from "../../src/cassettes/planned-suspension-boundary-gates.js"

const suspension = (taskId: string): AuthoredPlannedSuspensionBoundaryCorrelation => ({
  attemptId: `attempt:${taskId}:0` as AuthoredPlannedSuspensionBoundaryCorrelation["attemptId"],
  request: "Suspend",
  taskId: taskId as AuthoredPlannedSuspensionBoundaryCorrelation["taskId"]
})

it.effect("waits for exact boundary readiness and releases no sibling gate", () =>
  Effect.gen(function* () {
    const gates = yield* makePlannedSuspensionBoundaryGates
    const a = suspension("A")
    const d = suspension("D")
    yield* gates.arm(a)
    yield* gates.arm(d)

    const earlyReleaseA = yield* gates.release(a).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(earlyReleaseA.pollUnsafe()).toBeUndefined()

    const boundaryA = yield* gates.awaitBoundary(a).pipe(Effect.forkChild)
    const boundaryD = yield* gates.awaitBoundary(d).pipe(Effect.forkChild)
    yield* Fiber.join(earlyReleaseA)
    yield* Fiber.join(boundaryA)
    expect(boundaryD.pollUnsafe()).toBeUndefined()

    yield* gates.release(d)
    yield* Fiber.join(boundaryD)
  })
)

it.effect("fails closed for a duplicate exact hold", () =>
  Effect.gen(function* () {
    const gates = yield* makePlannedSuspensionBoundaryGates
    const a = suspension("A")
    yield* gates.arm(a)
    expect((yield* Effect.exit(gates.arm(a)))._tag).toBe("Failure")
  })
)

it.effect("fails closed for a foreign exact release", () =>
  Effect.gen(function* () {
    const gates = yield* makePlannedSuspensionBoundaryGates
    yield* gates.arm(suspension("A"))
    expect((yield* Effect.exit(gates.release(suspension("D"))))._tag).toBe("Failure")
  })
)

it.effect("preserves concurrent exact arms and releases", () =>
  Effect.gen(function* () {
    const gates = yield* makePlannedSuspensionBoundaryGates
    const a = suspension("A")
    const d = suspension("D")
    yield* Effect.all([gates.arm(a), gates.arm(d)], { concurrency: "unbounded" })
    const boundaries = yield* Effect.all([gates.awaitBoundary(a), gates.awaitBoundary(d)], {
      concurrency: "unbounded",
      discard: true
    }).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Effect.all([gates.release(a), gates.release(d)], { concurrency: "unbounded", discard: true })
    yield* Fiber.join(boundaries)
  })
)

it.effect("keeps an exact gate armed when an early release waiter is interrupted", () =>
  Effect.gen(function* () {
    const gates = yield* makePlannedSuspensionBoundaryGates
    const a = suspension("A")
    yield* gates.arm(a)
    const interruptedRelease = yield* gates.release(a).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Fiber.interrupt(interruptedRelease)

    const boundary = yield* gates.awaitBoundary(a).pipe(Effect.forkChild)
    yield* gates.release(a)
    yield* Fiber.join(boundary)
  })
)
