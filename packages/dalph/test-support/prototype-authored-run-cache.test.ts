import { NodeCrypto } from "@effect/platform-node"
import { Effect, Exit } from "effect"
import { expect, it } from "vitest"
import {
  makeAuthoredRunCache,
  runCachedAuthoredScenarioCassette,
  type AuthoredRunCacheKey,
  type AuthoredScenarioRunCache
} from "./prototype-authored-run-cache.js"

const key: AuthoredRunCacheKey = {
  candidateRevision: "candidate-A",
  cassetteIdentity: "delivery-cassette",
  inputDigest: "input-1",
  runtimeSchemaVersion: "prototype-v1"
}

it("reuses a successful authored-run result for the exact immutable key", async () => {
  const cache = makeAuthoredRunCache<number, never, never>()
  let executions = 0
  const run = Effect.sync(() => {
    executions += 1
    return 42
  })

  const first = await Effect.runPromise(cache.getOrRun(key, run))
  const second = await Effect.runPromise(cache.getOrRun(key, run))

  expect(first).toBe(42)
  expect(second).toBe(42)
  expect(executions).toBe(1)
  expect(cache.size()).toBe(1)
})

it("keeps candidate revisions in separate cache partitions", async () => {
  const cache = makeAuthoredRunCache<number, never, never>()
  let executions = 0
  const run = Effect.sync(() => ++executions)

  await Effect.runPromise(cache.getOrRun(key, run))
  await Effect.runPromise(cache.getOrRun({ ...key, candidateRevision: "candidate-B" }, run))

  expect(executions).toBe(2)
  expect(cache.size()).toBe(2)
})

it("keeps cassette identities, input digests, and runtime schema versions in separate partitions", async () => {
  const cache = makeAuthoredRunCache<number, never, never>()
  let executions = 0
  const run = Effect.sync(() => ++executions)

  await Effect.runPromise(cache.getOrRun(key, run))
  await Effect.runPromise(cache.getOrRun({ ...key, cassetteIdentity: "other-cassette" }, run))
  await Effect.runPromise(cache.getOrRun({ ...key, inputDigest: "input-2" }, run))
  await Effect.runPromise(cache.getOrRun({ ...key, runtimeSchemaVersion: "prototype-v2" }, run))

  expect(executions).toBe(4)
  expect(cache.size()).toBe(4)
})

it("does not alias keys when an identity contains the old delimiter", async () => {
  const cache = makeAuthoredRunCache<number, never, never>()
  let executions = 0
  const run = Effect.sync(() => ++executions)
  const first = { ...key, cassetteIdentity: "cassette\u0000one", inputDigest: "digest" }
  const second = { ...key, cassetteIdentity: "cassette", inputDigest: "one\u0000digest" }

  await Effect.runPromise(cache.getOrRun(first, run))
  await Effect.runPromise(cache.getOrRun(second, run))

  expect(executions).toBe(2)
  expect(cache.size()).toBe(2)
})

it("retains a successful undefined value as a cache hit", async () => {
  const cache = makeAuthoredRunCache<undefined, never, never>()
  let executions = 0
  const run = Effect.sync(() => {
    executions += 1
    return undefined
  })

  await Effect.runPromise(cache.getOrRun(key, run))
  await Effect.runPromise(cache.getOrRun(key, run))

  expect(executions).toBe(1)
  expect(cache.size()).toBe(1)
})

it("does not retain failed runs", async () => {
  const cache = makeAuthoredRunCache<number, string, never>()
  let executions = 0
  const run = Effect.suspend(() => {
    executions += 1
    return executions === 1 ? Effect.fail("transient") : Effect.succeed(7)
  })

  await expect(Effect.runPromise(cache.getOrRun(key, run))).rejects.toBe("transient")
  await expect(Effect.runPromise(cache.getOrRun(key, run))).resolves.toBe(7)
  expect(executions).toBe(2)
  expect(cache.size()).toBe(1)
})

it("clears successful values so a later call executes again", async () => {
  const cache = makeAuthoredRunCache<number, never, never>()
  let executions = 0
  const run = Effect.sync(() => ++executions)

  await Effect.runPromise(cache.getOrRun(key, run))
  cache.clear()
  await Effect.runPromise(cache.getOrRun(key, run))

  expect(executions).toBe(2)
  expect(cache.size()).toBe(1)
})

it("bypasses the shared cache when authored-run callbacks are requested", async () => {
  let cacheCalls = 0
  const cache = {
    clear: () => undefined,
    getOrRun: () => {
      cacheCalls += 1
      return Effect.die("cache must not be used for option-bearing runs")
    },
    size: () => 0
  } satisfies AuthoredScenarioRunCache

  const exit = await Effect.runPromise(
    Effect.exit(
      runCachedAuthoredScenarioCassette(
        key,
        { _tag: "not-an-authored-cassette" },
        { onObservationCapture: () => undefined },
        cache
      )
    ).pipe(Effect.provide(NodeCrypto.layer))
  )

  expect(Exit.isFailure(exit)).toBe(true)
  expect(cacheCalls).toBe(0)
})
