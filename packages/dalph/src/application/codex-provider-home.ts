/* eslint-disable import/no-nodejs-modules -- Native realpath resolution binds the provider-home namespace before spawn. */
import { lstat, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { ConfigProvider } from "effect"
import { Config, Effect, Option, Schema } from "effect"
import { CodexProviderHomeNamespace } from "./codex-server-startup-record.js"

/** No startup or credential effects are permitted after an unproven home resolution. */
export class CodexProviderHomeResolutionFailure extends Schema.TaggedError<CodexProviderHomeResolutionFailure>()(
  "CodexProviderHomeResolutionFailure",
  { detail: Schema.String, code: Schema.String }
) {}

const resolutionFailure = (failure: unknown): CodexProviderHomeResolutionFailure =>
  new CodexProviderHomeResolutionFailure({
    detail: String(failure),
    code: typeof failure === "object" && failure !== null && "code" in failure ? String(failure.code) : ""
  })

const resolveAncestor = (
  ancestor: string,
  absentSuffix: ReadonlyArray<string>
): Effect.Effect<string, CodexProviderHomeResolutionFailure> =>
  Effect.gen(function* () {
    const canonical = yield* Effect.tryPromise({ try: () => realpath(ancestor), catch: resolutionFailure }).pipe(
      Effect.result
    )
    if (canonical._tag === "Success") {
      const observation = yield* Effect.tryPromise({ try: () => stat(canonical.success), catch: resolutionFailure })
      if (!observation.isDirectory()) {
        return yield* new CodexProviderHomeResolutionFailure({
          detail: "provider-home ancestor is not a directory",
          code: "ENOTDIR"
        })
      }
      return path.join(canonical.success, ...absentSuffix)
    }
    if (canonical.failure.code !== "ENOENT") return yield* canonical.failure
    // A present dangling symlink is an unresolved alias, not a missing directory.
    const observation = yield* Effect.tryPromise({ try: () => lstat(ancestor), catch: resolutionFailure }).pipe(
      Effect.result
    )
    if (observation._tag === "Success") return yield* canonical.failure
    if (observation.failure.code !== "ENOENT") return yield* observation.failure
    const parent = path.dirname(ancestor)
    if (parent === ancestor) return yield* canonical.failure
    return yield* resolveAncestor(parent, [path.basename(ancestor), ...absentSuffix])
  })

/** Resolve existing aliases and absent final directories without writing into the provider home. */
export const resolveCodexProviderHome = Effect.fn("CodexProviderHome.resolve")(function* (locator: string) {
  const normalized = yield* Schema.decodeUnknownEffect(CodexProviderHomeNamespace)(locator).pipe(
    Effect.mapError(resolutionFailure)
  )
  const resolved = yield* resolveAncestor(normalized, [])
  return yield* Schema.decodeUnknownEffect(CodexProviderHomeNamespace)(resolved).pipe(
    Effect.mapError(resolutionFailure)
  )
})

/** Select the home from the child's actual environment merge, including disabled inheritance. */
export const resolveChildCodexProviderHome = Effect.fn("CodexProviderHome.resolveChild")(function* (
  environment: Readonly<Record<string, string>>,
  inheritEnvironment: boolean,
  parentEnvironment: ConfigProvider.ConfigProvider,
  operatingSystemHome: string
) {
  const inheritedCodexHome = inheritEnvironment
    ? yield* Config.option(Config.string("CODEX_HOME"))
        .parse(parentEnvironment)
        .pipe(Effect.mapError(resolutionFailure))
    : Option.none<string>()
  const inheritedHome = inheritEnvironment
    ? yield* Config.option(Config.string("HOME")).parse(parentEnvironment).pipe(Effect.mapError(resolutionFailure))
    : Option.none<string>()
  const codexHome = environment["CODEX_HOME"] ?? Option.getOrUndefined(inheritedCodexHome)
  const home = environment["HOME"] ?? Option.getOrUndefined(inheritedHome) ?? operatingSystemHome
  return yield* resolveCodexProviderHome(codexHome ?? path.join(home, ".codex"))
})
