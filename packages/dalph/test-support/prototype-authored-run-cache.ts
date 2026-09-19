/** PROTOTYPE ONLY: shared test-harness cache shape; not production runtime state. */
import { NodeCrypto } from "@effect/platform-node"
import { Crypto, Effect } from "effect"
import {
  runAuthoredScenarioCassette,
  type AuthoredScenarioCassetteFullRunOptions,
  type AuthoredScenarioCassetteRun,
  type AuthoredScenarioCassetteRunFailure
} from "../src/cassettes/authored-runner.js"
import { projectRecordedCassette } from "../src/cassettes/recorded.js"

export interface AuthoredRunCacheKey {
  readonly candidateRevision: string
  readonly cassetteIdentity: string
  readonly inputDigest: string
  readonly runtimeSchemaVersion: string
}

/**
 * Computes the input partition for a decoded authored cassette. The source
 * cassettes are plain schema values with deterministic property order; a
 * digest keeps the cache key compact without using object identity.
 */
const hexadecimalRadix = 16
const hexadecimalByteWidth = 2

export const authoredRunInputDigest = (input: unknown): string =>
  Effect.runSync(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(String(JSON.stringify(input))))
      return Array.from(digest, (byte) => byte.toString(hexadecimalRadix).padStart(hexadecimalByteWidth, "0")).join("")
    }).pipe(Effect.provide(NodeCrypto.layer))
  )

/*
 * The cache is deliberately keyed by a serialized tuple rather than a delimiter
 * joined string.  Candidate and cassette identities are normally simple labels,
 * but allowing an identity to contain the delimiter must never alias another key.
 */
const cacheKeyOf = (key: AuthoredRunCacheKey): string =>
  JSON.stringify([key.candidateRevision, key.cassetteIdentity, key.inputDigest, key.runtimeSchemaVersion])

export interface AuthoredRunCache<A, E, R> {
  readonly getOrRun: (key: AuthoredRunCacheKey, run: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly size: () => number
  readonly clear: () => void
}

interface SuccessfulCacheEntry<A> {
  readonly value: A
}

/** Cache only successful values. Failed runs never poison a later attempt. */
export const makeAuthoredRunCache = <A, E, R>(): AuthoredRunCache<A, E, R> => {
  // This Map is process-local test state. It is intentionally not persisted,
  // synchronized between workers, or used by production runtime code.
  const values = new Map<string, SuccessfulCacheEntry<A>>()

  return {
    // eslint-disable-next-line functional/immutable-data -- The process-local cache owns this bounded test-state mutation.
    clear: () => values.clear(),
    getOrRun: (key, run) => {
      const cacheKey = cacheKeyOf(key)
      const cached = values.get(cacheKey)
      if (cached !== undefined) {
        return Effect.succeed(cached.value)
      }
      return run.pipe(
        Effect.tap((value) =>
          // eslint-disable-next-line functional/immutable-data -- Store only a completed success in this local cache.
          Effect.sync(() => values.set(cacheKey, { value }))
        )
      )
    },
    size: () => values.size
  }
}

export type AuthoredScenarioRunCache = AuthoredRunCache<
  AuthoredScenarioCassetteRun,
  AuthoredScenarioCassetteRunFailure,
  Crypto.Crypto
>

/** One cache instance is shared by every test helper in this process. */
export const sharedAuthoredScenarioRunCache: AuthoredScenarioRunCache = makeAuthoredRunCache()

type RecordedCassetteProjection = Effect.Success<ReturnType<typeof projectRecordedCassette>>
const recordedCassetteProjectionCache = new WeakMap<object, RecordedCassetteProjection>()

/** Reuse successful projections for the same immutable record array in this process. */
export const runCachedRecordedCassette = (records: Parameters<typeof projectRecordedCassette>[0]) => {
  const cached = recordedCassetteProjectionCache.get(records)
  if (cached !== undefined) return Effect.succeed(cached)
  return projectRecordedCassette(records).pipe(
    Effect.tap((projected) => Effect.sync(() => recordedCassetteProjectionCache.set(records, projected)))
  )
}

const cacheArgument = (
  value: AuthoredScenarioCassetteFullRunOptions | AuthoredScenarioRunCache | undefined
): value is AuthoredScenarioRunCache => value !== undefined && "getOrRun" in value

const hasAuthoredRunOptions = (options: AuthoredScenarioCassetteFullRunOptions | undefined): boolean =>
  options !== undefined && Object.keys(options).length > 0

/**
 * Executes an authored cassette through the shared cache when no diagnostic
 * callbacks/options are requested. Option-bearing calls bypass the cache so a
 * callback is still invoked at its runner-defined boundary and an
 * onObservationMoment effect still runs in its own scope. The optional
 * cache-second form preserves the small prototype API used by focused tests.
 */
export function runCachedAuthoredScenarioCassette(
  key: AuthoredRunCacheKey,
  input: unknown,
  cache?: AuthoredScenarioRunCache
): Effect.Effect<AuthoredScenarioCassetteRun, AuthoredScenarioCassetteRunFailure, Crypto.Crypto>
export function runCachedAuthoredScenarioCassette(
  key: AuthoredRunCacheKey,
  input: unknown,
  options: AuthoredScenarioCassetteFullRunOptions,
  cache?: AuthoredScenarioRunCache
): Effect.Effect<AuthoredScenarioCassetteRun, AuthoredScenarioCassetteRunFailure, Crypto.Crypto>
export function runCachedAuthoredScenarioCassette(
  key: AuthoredRunCacheKey,
  input: unknown,
  optionsOrCache?: AuthoredScenarioCassetteFullRunOptions | AuthoredScenarioRunCache,
  suppliedCache?: AuthoredScenarioRunCache
): Effect.Effect<AuthoredScenarioCassetteRun, AuthoredScenarioCassetteRunFailure, Crypto.Crypto> {
  const options = cacheArgument(optionsOrCache) ? undefined : optionsOrCache
  const cache = cacheArgument(optionsOrCache) ? optionsOrCache : (suppliedCache ?? sharedAuthoredScenarioRunCache)
  const run = runAuthoredScenarioCassette(input, options)
  return hasAuthoredRunOptions(options) ? run : cache.getOrRun(key, run)
}
