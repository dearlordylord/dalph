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
    const run = (operation: string) =>
      requestCircuit.run(
        operation,
        Ref.update(requests, (current) => [...current, operation])
      )

    yield* run("tracker.read-1")
    yield* run("tracker.read-2")
    const failure = yield* run("tracker.read-3").pipe(Effect.flip)

    expect(failure).toEqual({ _tag: "CircuitOpen", operation: "tracker.read-3" })
    expect(yield* Ref.get(requests)).toEqual(["tracker.read-1", "tracker.read-2"])
  })
)

it.effect("admits a request after cooldown and starts a fresh window", () =>
  Effect.gen(function* () {
    const requestCircuit = yield* circuit()
    yield* requestCircuit.run("executor.begin-1", Effect.void)
    yield* requestCircuit.run("executor.begin-2", Effect.void)
    yield* requestCircuit.run("executor.begin-3", Effect.void).pipe(Effect.flip)

    yield* TestClock.adjust("30 seconds")
    yield* requestCircuit.run("executor.begin-4", Effect.void)
    yield* requestCircuit.run("executor.begin-5", Effect.void)
    const failure = yield* requestCircuit.run("executor.begin-6", Effect.void).pipe(Effect.flip)

    expect(failure).toEqual({ _tag: "CircuitOpen", operation: "executor.begin-6" })
  })
)

it.effect("atomically bounds concurrent requests", () =>
  Effect.gen(function* () {
    const requestCircuit = yield* makeRequestCircuit({
      onOpen: (operation: string) => operation,
      policy: { ...policy, maxRequests: 3 }
    })
    const results = yield* Effect.forEach(
      ["a", "b", "c", "d", "e"],
      (operation) => requestCircuit.run(operation, Effect.void).pipe(Effect.result),
      { concurrency: "unbounded" }
    )

    expect(results.filter((result) => result._tag === "Success")).toHaveLength(3)
    expect(results.filter((result) => result._tag === "Failure")).toHaveLength(2)
  })
)

it.effect("rejects before running the wrapped outbound transport", () =>
  Effect.gen(function* () {
    const transportCalls = yield* Ref.make(0)
    const requestCircuit = yield* makeRequestCircuit({
      onOpen: (operation: string) => ({ _tag: "CircuitOpen" as const, operation }),
      policy: { ...policy, maxRequests: 1 }
    })
    const request = (operation: string) =>
      requestCircuit.run(
        operation,
        Ref.update(transportCalls, (current) => current + 1)
      )

    yield* request("first")
    const failure = yield* request("second").pipe(Effect.flip)

    expect(failure).toEqual({ _tag: "CircuitOpen", operation: "second" })
    expect(yield* Ref.get(transportCalls)).toBe(1)
  })
)

it.effect("keeps request state separate for each circuit instance", () =>
  Effect.gen(function* () {
    const first = yield* makeRequestCircuit({
      onOpen: (operation: string) => ({ _tag: "CircuitOpen" as const, operation }),
      policy: { ...policy, maxRequests: 1 }
    })
    const second = yield* makeRequestCircuit({
      onOpen: (operation: string) => ({ _tag: "CircuitOpen" as const, operation }),
      policy: { ...policy, maxRequests: 1 }
    })

    yield* first.run("first-1", Effect.void)
    yield* second.run("second-1", Effect.void)
    const firstFailure = yield* first.run("first-2", Effect.void).pipe(Effect.flip)
    const secondFailure = yield* second.run("second-2", Effect.void).pipe(Effect.flip)

    expect(firstFailure).toEqual({ _tag: "CircuitOpen", operation: "first-2" })
    expect(secondFailure).toEqual({ _tag: "CircuitOpen", operation: "second-2" })
  })
)
