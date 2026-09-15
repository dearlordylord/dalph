import { TaskExecutorLocator } from "@dalph/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"

/** Stable operator-facing name for one executor configuration. */
export const ExecutorProfileId = Schema.NonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9._/-]*$/u, { description: "a lowercase executor profile id" })
).pipe(Schema.brand("ExecutorProfileId"))
export type ExecutorProfileId = typeof ExecutorProfileId.Type

/** Provider adapter selected by one profile; this is not a workflow state. */
export const ExecutorAdapterKind = Schema.Literals(["codex-app-server", "kimi-acp"])
export type ExecutorAdapterKind = typeof ExecutorAdapterKind.Type

/** Explicit policy for provider permission requests in a headless run. */
export const ExecutorPermissionPolicy = Schema.Literals(["unattended", "deny", "interactive"])
export type ExecutorPermissionPolicy = typeof ExecutorPermissionPolicy.Type

/** A provider-scoped model alias; the provider field prevents global-name ambiguity. */
export const ExecutorModelAlias = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    value.trim() === value ? undefined : "executor model alias must not contain edge whitespace"
  )
).pipe(Schema.brand("ExecutorModelAlias"))
export type ExecutorModelAlias = typeof ExecutorModelAlias.Type

/** Non-secret reference to provider configuration; credentials stay in the host environment. */
export const ExecutorProviderConfigReference = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    value.trim() === value ? undefined : "provider configuration reference must not contain edge whitespace"
  )
).pipe(Schema.brand("ExecutorProviderConfigReference"))
export type ExecutorProviderConfigReference = typeof ExecutorProviderConfigReference.Type

/** Complete validated profile resolved before a task claim or Begin command. */
export const ExecutorProfile = Schema.Struct({
  adapter: ExecutorAdapterKind,
  executable: Schema.NonEmptyString,
  id: ExecutorProfileId,
  model: ExecutorModelAlias,
  permissionPolicy: ExecutorPermissionPolicy,
  provider: Schema.NonEmptyString,
  providerConfigRef: Schema.optionalKey(ExecutorProviderConfigReference)
}).check(
  Schema.makeFilter((profile) =>
    profile.adapter === "kimi-acp" && profile.providerConfigRef === undefined
      ? "Kimi executor profiles require a provider configuration reference"
      : undefined
  )
)
export type ExecutorProfile = typeof ExecutorProfile.Type

/** Profile choice at the host boundary; explicit selection wins over host default. */
export const ExecutorProfileSelection = Schema.Struct({
  explicit: Schema.optionalKey(ExecutorProfileId),
  hostDefault: Schema.optionalKey(ExecutorProfileId)
})
export type ExecutorProfileSelection = typeof ExecutorProfileSelection.Type

export class ExecutorProfileResolutionFailure extends Schema.TaggedError<ExecutorProfileResolutionFailure>()(
  "ExecutorProfileResolutionFailure",
  {
    kind: Schema.Literals(["MissingSelection", "UnknownProfile", "DuplicateProfile"]),
    profileId: Schema.optionalKey(ExecutorProfileId),
    detail: Schema.NonEmptyString
  }
) {}

/** Resolves a stable attempt locator without exposing provider credentials. */
export const executorLocatorForProfile = (profile: ExecutorProfile): TaskExecutorLocator =>
  TaskExecutorLocator.make(`executor:${profile.id}`)

/** Resolves one persisted locator without constructing a branded id from unchecked bytes. */
export const resolveExecutorProfileLocator = (
  profiles: ReadonlyArray<ExecutorProfile>,
  locator: TaskExecutorLocator
): Effect.Effect<ExecutorProfile, ExecutorProfileResolutionFailure> => {
  const profile = profiles.find((candidate) => executorLocatorForProfile(candidate) === locator)
  if (profile !== undefined) return Effect.succeed(profile)
  const rawId = locator.replace(/^executor:/u, "")
  const profileId = Option.getOrUndefined(Schema.decodeUnknownOption(ExecutorProfileId)(rawId))
  return Effect.fail(
    new ExecutorProfileResolutionFailure({
      detail: `executor locator ${locator} has no configured profile`,
      kind: "UnknownProfile",
      ...(profileId === undefined ? {} : { profileId })
    })
  )
}

/** Application-level registry used by production and controlled compositions. */
export interface ExecutorProfileRegistryService {
  readonly resolve: (
    selection?: ExecutorProfileSelection
  ) => Effect.Effect<ExecutorProfile, ExecutorProfileResolutionFailure>
  readonly profileForLocator: (
    locator: TaskExecutorLocator
  ) => Effect.Effect<ExecutorProfile, ExecutorProfileResolutionFailure>
}

export class ExecutorProfileRegistry extends Context.Service<ExecutorProfileRegistry, ExecutorProfileRegistryService>()(
  "@dalph/ExecutorProfileRegistry"
) {}

/** Pure registry layer for a fixed, already-decoded profile set. */
export const executorProfileRegistryLayer = (
  profiles: ReadonlyArray<ExecutorProfile>,
  hostDefault?: ExecutorProfileId
): Layer.Layer<ExecutorProfileRegistry> =>
  Layer.effect(
    ExecutorProfileRegistry,
    Effect.sync(() => {
      const duplicate = profiles.find(
        (profile, index) => profiles.findIndex((candidate) => candidate.id === profile.id) !== index
      )
      const duplicateFailure =
        duplicate === undefined
          ? undefined
          : new ExecutorProfileResolutionFailure({
              detail: `executor profile ${duplicate.id} is declared more than once`,
              kind: "DuplicateProfile",
              profileId: duplicate.id
            })
      const resolve = (selection: ExecutorProfileSelection = {}) => {
        if (duplicateFailure !== undefined) return Effect.fail(duplicateFailure)
        const selected = selection.explicit ?? selection.hostDefault ?? hostDefault
        if (selected === undefined) {
          return Effect.fail(
            new ExecutorProfileResolutionFailure({
              detail: "no executor profile was selected and no host default is configured",
              kind: "MissingSelection"
            })
          )
        }
        const profile = profiles.find((candidate) => candidate.id === selected)
        return profile === undefined
          ? Effect.fail(
              new ExecutorProfileResolutionFailure({
                detail: `executor profile ${selected} is not configured`,
                kind: "UnknownProfile",
                profileId: selected
              })
            )
          : Effect.succeed(profile)
      }
      const profileForLocator = (locator: TaskExecutorLocator) => {
        return resolveExecutorProfileLocator(profiles, locator)
      }
      return ExecutorProfileRegistry.of({ resolve, profileForLocator })
    })
  )

/** Decodes raw profile documents before any process, tracker, or Git boundary. */
export const decodeExecutorProfiles = Effect.fn("ExecutorProfile.decodeMany")(function* (
  input: unknown
): Effect.fn.Return<ReadonlyArray<ExecutorProfile>, Schema.SchemaError> {
  return yield* Schema.decodeUnknownEffect(Schema.Array(ExecutorProfile))(input, {
    onExcessProperty: "error",
    reportInput: false
  })
})
