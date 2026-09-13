/* eslint-disable import/no-nodejs-modules -- The settlement proof observes an original real Node child. */
import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { EvidenceDigest } from "@dalph/contracts"
import { Deferred, Effect, Fiber, HashSet, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import { HermeticRegistrationScopeId } from "../src/application/production-hermetic-contract.js"
import { makeHermeticRecordBindings, settleHermeticChild } from "./production-hermetic-child-lifetime.js"
import { makeHermeticChildOutput, HermeticChildOutputCanonicalFailure } from "./production-hermetic-child-output.js"

const firstScope = HermeticRegistrationScopeId.make("original-spawn-S1")
const secondScope = HermeticRegistrationScopeId.make("original-spawn-S2")
const unknownScope = HermeticRegistrationScopeId.make("unknown-spawn")
const digest = EvidenceDigest.make("a".repeat(64))
const pid = ChildProcessSpawner.ProcessId(123)

it.live("retains an observed real exit and its scope until both readers settle despite a rejected complete frame", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(nodeProcess.execPath, ["--eval", "process.stdout.write('not-json\\n')"])
      )
      const bindings = yield* makeHermeticRecordBindings()
      yield* bindings.begin(firstScope)
      yield* bindings.bind(firstScope, handle)
      yield* bindings.end(firstScope)
      const output = yield* makeHermeticChildOutput(handle, () => Effect.void)
      const stdout = yield* output.read().pipe(Effect.forkScoped)
      const stderrRelease = yield* Deferred.make<void>()
      const stderr = yield* handle.stderr.pipe(
        Stream.runDrain,
        Effect.andThen(Deferred.await(stderrRelease)),
        Effect.forkScoped
      )
      const observed = yield* Deferred.make<number>()
      const receipts: Array<number> = []
      const settling = yield* settleHermeticChild(
        { stdout, stderr },
        handle.exitCode,
        (status) => {
          receipts[0] = status
        },
        bindings.forget(firstScope, handle)
      ).pipe(Effect.forkScoped)
      yield* handle.exitCode.pipe(Effect.flatMap((status) => Deferred.succeed(observed, status)))
      yield* Deferred.await(observed)
      yield* Effect.yieldNow
      expect(receipts).toEqual([0])
      expect(yield* bindings.count).toBe(1)
      expect(settling.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(stderrRelease, undefined)
      expect(yield* Fiber.join(settling).pipe(Effect.flip)).toBeInstanceOf(HermeticChildOutputCanonicalFailure)
      expect(yield* bindings.count).toBe(0)
      expect(receipts).toEqual([0])
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("rejects retired and unknown scopes during a new same-PID spawn without digest adoption or cache", () =>
  Effect.gen(function* () {
    const bindings = yield* makeHermeticRecordBindings()
    const firstHandle = { pid }
    const secondHandle = { pid }
    yield* bindings.begin(firstScope)
    yield* bindings.bind(firstScope, firstHandle)
    yield* bindings.end(firstScope)
    yield* bindings.register(firstScope, { processId: pid, digest })
    expect(HashSet.has(yield* bindings.digestsFor(firstScope, firstHandle), digest)).toBe(true)
    yield* bindings.forget(firstScope, firstHandle)
    expect(yield* bindings.count).toBe(0)
    yield* bindings.begin(secondScope)
    yield* bindings.bind(secondScope, secondHandle)
    yield* bindings.forget(secondScope, firstHandle)
    for (const scope of [firstScope, unknownScope]) {
      const rejected = yield* bindings.register(scope, { processId: pid, digest }).pipe(Effect.result)
      expect(rejected._tag).toBe("Failure")
      expect(yield* bindings.count).toBe(1)
      expect(HashSet.size(yield* bindings.digestsFor(secondScope, secondHandle))).toBe(0)
    }
    yield* bindings.end(secondScope)
    yield* bindings.forget(secondScope, secondHandle)
    expect(yield* bindings.count).toBe(0)
  })
)

it.effect("holds the original owned scope registration until the real spawn continuation binds and finishes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const bindings = yield* makeHermeticRecordBindings()
      const handle = { pid }
      const started = yield* Deferred.make<void>()
      yield* bindings.begin(secondScope)
      const registering = yield* Deferred.succeed(started, undefined).pipe(
        Effect.andThen(bindings.register(secondScope, { processId: pid, digest })),
        Effect.forkScoped
      )
      yield* Deferred.await(started)
      yield* Effect.yieldNow
      expect(registering.pollUnsafe()).toBeUndefined()
      yield* bindings.bind(secondScope, handle)
      expect(registering.pollUnsafe()).toBeUndefined()
      yield* bindings.end(secondScope)
      yield* Fiber.join(registering)
      expect(Array.from(yield* bindings.digestsFor(secondScope, handle))).toEqual([digest])
      expect((yield* bindings.digestsFor(secondScope, { pid }).pipe(Effect.result))._tag).toBe("Failure")
      expect((yield* bindings.register(secondScope, { processId: pid + 1, digest }).pipe(Effect.result))._tag).toBe(
        "Failure"
      )
      yield* bindings.forget(secondScope, handle)
      expect(yield* bindings.count).toBe(0)
    })
  )
)
