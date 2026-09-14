import { expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { TestClock } from "effect/testing"
import { makeRequestCircuit, type RequestCircuitPolicy } from "./request-circuit.js"

const policy: RequestCircuitPolicy = {
  cooldownNanos: 30n * 1_000_000_000n,
  maxRequests: 2,
  windowNanos: 60n * 1_000_000_000n
}

const circuit = Effect.fn("RequestCircuitTest.make")(() =>
  makeRequestCircuit({ onOpen: (operation: string) => ({ _tag: "CircuitOpen" as const, operation }), policy })
)

it.effect("admits up to the limit and rejects the next request locally", () =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<ReadonlyArray<string>>([])
    const requestCircuit = yield* circuit()
    const reserve = (operation: string) =>
      requestCircuit
        .reserve(operation)
        .pipe(Effect.tap(() => Ref.update(requests, (current) => [...current, operation])))

    yield* reserve("tracker.read-1")
    yield* reserve("tracker.read-2")
    const failure = yield* reserve("tracker.read-3").pipe(Effect.flip)

    expect(failure).toEqual({ _tag: "CircuitOpen", operation: "tracker.read-3" })
    expect(yield* Ref.get(requests)).toEqual(["tracker.read-1", "tracker.read-2"])
  })
)

it.effect("admits a request after cooldown and starts a fresh window", () =>
  Effect.gen(function* () {
    const requestCircuit = yield* circuit()
    yield* requestCircuit.reserve("executor.begin-1")
    yield* requestCircuit.reserve("executor.begin-2")
    yield* requestCircuit.reserve("executor.begin-3").pipe(Effect.flip)

    yield* TestClock.adjust("30 seconds")
    yield* requestCircuit.reserve("executor.begin-4")
    yield* requestCircuit.reserve("executor.begin-5")
    const failure = yield* requestCircuit.reserve("executor.begin-6").pipe(Effect.flip)

    expect(failure).toEqual({ _tag: "CircuitOpen", operation: "executor.begin-6" })
  })
)

it.effect("atomically bounds concurrent reservations", () =>
  Effect.gen(function* () {
    const requestCircuit = yield* makeRequestCircuit({
      onOpen: (operation: string) => operation,
      policy: { ...policy, maxRequests: 3 }
    })
    const results = yield* Effect.forEach(
      ["a", "b", "c", "d", "e"],
      (operation) => requestCircuit.reserve(operation).pipe(Effect.result),
      { concurrency: "unbounded" }
    )

    expect(results.filter((result) => result._tag === "Success")).toHaveLength(3)
    expect(results.filter((result) => result._tag === "Failure")).toHaveLength(2)
  })
)
