import { it } from "@effect/vitest"
import { TaskExecutorLocator } from "@dalph/contracts"
import { Cause, Effect, Exit, Option } from "effect"
import { expect } from "vitest"
import {
  ExecutorProfile,
  ExecutorProfileId,
  ExecutorModelAlias,
  ExecutorProviderConfigReference,
  ExecutorProfileRegistry,
  ExecutorProfileResolutionFailure,
  executorLocatorForProfile,
  executorProfileRegistryLayer,
  resolveExecutorProfileLocator
} from "./executor-profile.js"

const codex = ExecutorProfile.make({
  adapter: "codex-app-server",
  executable: "codex",
  id: ExecutorProfileId.make("codex/default"),
  model: ExecutorModelAlias.make("default"),
  permissionPolicy: "unattended",
  provider: "codex"
})

const kimi = ExecutorProfile.make({
  adapter: "kimi-acp",
  executable: "kimi",
  id: ExecutorProfileId.make("kimi/for-coding"),
  model: ExecutorModelAlias.make("kimi-code/kimi-for-coding"),
  permissionPolicy: "deny",
  provider: "kimi",
  providerConfigRef: ExecutorProviderConfigReference.make("kimi-for-coding")
})

it.effect("resolves an explicit Kimi profile before a host Codex default", () =>
  Effect.gen(function* () {
    const registry = yield* ExecutorProfileRegistry
    const selected = yield* registry.resolve({ explicit: kimi.id, hostDefault: codex.id })
    expect(selected).toEqual(kimi)
    expect(executorLocatorForProfile(selected)).toBe("executor:kimi/for-coding")
    expect(yield* registry.profileForLocator(executorLocatorForProfile(kimi))).toEqual(kimi)
  }).pipe(Effect.provide(executorProfileRegistryLayer([codex, kimi], codex.id)))
)

it.effect("returns typed failures for missing and unknown profile selections", () =>
  Effect.gen(function* () {
    const registry = yield* ExecutorProfileRegistry
    const missing = yield* registry.resolve().pipe(Effect.exit)
    expect(Exit.isFailure(missing)).toBe(true)
    if (Exit.isFailure(missing)) {
      const error = Cause.findErrorOption(missing.cause)
      expect(Option.isSome(error) && error.value).toBeInstanceOf(ExecutorProfileResolutionFailure)
    }
    const unknown = yield* registry.resolve({ explicit: ExecutorProfileId.make("kimi/missing") }).pipe(Effect.exit)
    expect(Exit.isFailure(unknown)).toBe(true)
    if (Exit.isFailure(unknown)) {
      const error = Cause.findErrorOption(unknown.cause)
      expect(Option.isSome(error) && error.value).toMatchObject({ kind: "UnknownProfile" })
    }
  }).pipe(Effect.provide(executorProfileRegistryLayer([codex])))
)

it.effect("fails closed when profile identifiers collide", () =>
  Effect.gen(function* () {
    const registry = yield* ExecutorProfileRegistry
    const result = yield* registry.resolve({ explicit: codex.id }).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const error = Cause.findErrorOption(result.cause)
      expect(Option.isSome(error) && error.value).toMatchObject({ kind: "DuplicateProfile" })
    }
  }).pipe(Effect.provide(executorProfileRegistryLayer([codex, codex])))
)

it.effect("rejects duplicate configured profiles before locator resolution", () =>
  Effect.gen(function* () {
    const result = yield* resolveExecutorProfileLocator([codex, codex], executorLocatorForProfile(codex)).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const error = Cause.findErrorOption(result.cause)
      expect(Option.isSome(error) && error.value).toMatchObject({ kind: "DuplicateProfile" })
    }
  })
)

it.effect("rejects malformed locator ids without constructing an invalid brand", () =>
  Effect.gen(function* () {
    const result = yield* resolveExecutorProfileLocator(
      [codex],
      TaskExecutorLocator.make("executor:Codex Profile")
    ).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const error = Cause.findErrorOption(result.cause)
      expect(Option.isSome(error) && error.value).toMatchObject({ kind: "UnknownProfile" })
      if (Option.isSome(error)) expect(error.value.profileId).toBeUndefined()
    }
  })
)
