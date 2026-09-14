import type { EvidenceDigest } from "@dalph/contracts"
import { Cause, Deferred, Effect, Exit, Fiber, HashSet, MutableHashMap, Option, Ref, Schema } from "effect"
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type { HermeticRegistrationScopeId } from "../src/application/production-hermetic-contract.js"
import type { HermeticExpectedRecordRegistration } from "../src/application/production-hermetic-provider-bridge.js"
import type { HermeticPublicChild } from "./production-hermetic-controller.js"

export class HermeticControllerFailure extends Schema.TaggedError<HermeticControllerFailure>()(
  "HermeticControllerFailure",
  { operation: Schema.NonEmptyString }
) {}

export const hermeticChildExitDiagnosticByteLimit = 4_096
const maximumUtf8CodePointBytes = 4

export const HermeticChildExitObservation = Schema.Union([
  Schema.TaggedStruct("Exited", { exitCode: Schema.Int }),
  Schema.TaggedStruct("ExitCodeUnavailable", {})
])
export type HermeticChildExitObservation = typeof HermeticChildExitObservation.Type

/** Distinguishes an owned child exit from every controller setup, transport and binding failure. */
export class HermeticChildExitedBeforeBoundary extends Schema.TaggedError<HermeticChildExitedBeforeBoundary>()(
  "HermeticChildExitedBeforeBoundary",
  {
    operation: Schema.Literal("child.exitedBeforeBoundary"),
    outcome: HermeticChildExitObservation,
    stderr: Schema.String,
    stderrTruncated: Schema.Boolean
  }
) {}

const decodeHermeticStderr = (chunks: ReadonlyArray<Uint8Array>) => {
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
  return chunks.map((chunk, index) => decoder.decode(chunk, { stream: index < chunks.length - 1 })).join("")
}

const redactExactValues = (text: string, sensitiveValues: ReadonlyArray<string>) =>
  Array.from(new Set(sensitiveValues.filter((value) => value.length > 0)))
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, value) => redacted.replaceAll(value, "[REDACTED]"), text)

const boundUtf8 = (text: string) => {
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength <= hermeticChildExitDiagnosticByteLimit) return { text, truncated: false }
  const prefixes = Array.from({ length: maximumUtf8CodePointBytes }, (_, removed) => removed).flatMap((removed) => {
    try {
      return [
        new TextDecoder("utf-8", { fatal: true }).decode(
          encoded.slice(0, hermeticChildExitDiagnosticByteLimit - removed)
        )
      ]
    } catch {
      return []
    }
  })
  return { text: prefixes[0] ?? "", truncated: true }
}

/** Makes an early child exit actionable without exposing controlled credentials or returning an unbounded diagnostic. */
export const hermeticChildExitedBeforeBoundary = (
  outcome: HermeticChildExitObservation,
  stderrChunks: ReadonlyArray<Uint8Array>,
  sensitiveValues: ReadonlyArray<string>
) => {
  const stderr = boundUtf8(redactExactValues(decodeHermeticStderr(stderrChunks), sensitiveValues))
  return new HermeticChildExitedBeforeBoundary({
    operation: "child.exitedBeforeBoundary",
    outcome,
    stderr: stderr.text,
    stderrTruncated: stderr.truncated
  })
}

/** Preserve the original exit receipt even when a public reader rejects a frame; retire its scope only after both readers settle. */
export const settleHermeticChild = <A, E, R>(
  child: Pick<HermeticPublicChild, "stdout" | "stderr">,
  observeExit: Effect.Effect<A, E, R>,
  recordExit: (receipt: A) => void,
  retireScope: Effect.Effect<void>
) =>
  Effect.gen(function* () {
    const processExit = yield* Effect.exit(observeExit)
    if (Exit.isSuccess(processExit)) yield* Effect.sync(() => recordExit(processExit.value))
    const readers = yield* Effect.all([Effect.exit(Fiber.join(child.stdout)), Effect.exit(Fiber.join(child.stderr))])
    yield* retireScope
    if (Exit.isFailure(processExit)) return yield* Effect.failCause(processExit.cause)
    for (const reader of readers) {
      if (Exit.isFailure(reader)) return yield* Effect.failCause(reader.cause)
    }
    return processExit.value
  })

/** Records the original owned child's observed exit, independently of whether its Run terminated. */
export type HermeticProcessOutcome =
  | { readonly _tag: "Exit"; readonly processId: number; readonly status: number }
  | { readonly _tag: "ControllerKilled"; readonly processId: number; readonly signal: "SIGKILL" }

export const killedProcessOutcome = (
  processId: number,
  exit: Exit.Exit<number, unknown>
): HermeticProcessOutcome | undefined => {
  if (Exit.isSuccess(exit)) return { _tag: "Exit", processId, status: exit.value }
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isNone(failure)) return undefined
  const decoded = Schema.decodeUnknownOption(
    Schema.Struct({
      _tag: Schema.Literal("PlatformError"),
      reason: Schema.Struct({
        _tag: Schema.Literal("Unknown"),
        module: Schema.Literal("ChildProcess"),
        method: Schema.Literal("exitCode"),
        cause: Schema.Unknown
      })
    })
  )(failure.value)
  if (
    Option.isNone(decoded) ||
    !(decoded.value.reason.cause instanceof Error) ||
    decoded.value.reason.cause.message !== "Process interrupted due to receipt of signal: 'SIGKILL'"
  )
    return undefined
  return { _tag: "ControllerKilled", processId, signal: "SIGKILL" }
}

type HermeticSpawnWindow =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Spawning"
      readonly scope: HermeticRegistrationScopeId
      readonly settled: Deferred.Deferred<void>
    }

/** Presentation-only bindings retain exact original handles; unknown requests and PID reuse create no binding. */
export const makeHermeticRecordBindings = Effect.fn("HermeticController.makeRecordBindings")(function* () {
  const owned = MutableHashMap.empty<
    HermeticRegistrationScopeId,
    {
      readonly handle: Pick<ChildProcessSpawner.ChildProcessHandle, "pid">
      readonly digests: HashSet.HashSet<EvidenceDigest>
    }
  >()
  const window = yield* Ref.make<HermeticSpawnWindow>({ _tag: "Idle" })
  const begin = Effect.fn("HermeticRecordBindings.begin")(function* (scope: HermeticRegistrationScopeId) {
    const settled = yield* Deferred.make<void>()
    const admitted = yield* Ref.modify(
      window,
      (current: HermeticSpawnWindow): readonly [boolean, HermeticSpawnWindow] =>
        current._tag === "Idle" ? [true, { _tag: "Spawning", scope, settled }] : [false, current]
    )
    if (!admitted) return yield* new HermeticControllerFailure({ operation: "child.concurrentSpawn" })
  })
  const end = Effect.fn("HermeticRecordBindings.end")(function* (scope: HermeticRegistrationScopeId) {
    const current = yield* Ref.get(window)
    if (current._tag === "Spawning" && current.scope === scope) {
      yield* Ref.set(window, { _tag: "Idle" })
      yield* Deferred.succeed(current.settled, undefined)
    }
  })
  const bind = Effect.fn("HermeticRecordBindings.bind")(function* (
    scope: HermeticRegistrationScopeId,
    handle: Pick<ChildProcessSpawner.ChildProcessHandle, "pid">
  ) {
    const current = yield* Ref.get(window)
    if (current._tag !== "Spawning" || current.scope !== scope)
      return yield* new HermeticControllerFailure({ operation: "record.foreignScope" })
    MutableHashMap.set(owned, scope, { handle, digests: HashSet.empty() })
  })
  const register = Effect.fn("HermeticRecordBindings.register")(function* (
    scope: HermeticRegistrationScopeId,
    registration: typeof HermeticExpectedRecordRegistration.Type
  ) {
    const current = yield* Ref.get(window)
    if (current._tag === "Spawning" && current.scope === scope) yield* Deferred.await(current.settled)
    const original = Option.getOrUndefined(MutableHashMap.get(owned, scope))
    if (original === undefined || original.handle.pid !== registration.processId)
      return yield* new HermeticControllerFailure({ operation: "record.foreignChild" })
    MutableHashMap.set(owned, scope, {
      handle: original.handle,
      digests: HashSet.add(original.digests, registration.digest)
    })
  })
  const digestsFor = Effect.fn("HermeticRecordBindings.digestsFor")(function* (
    scope: HermeticRegistrationScopeId,
    handle: Pick<ChildProcessSpawner.ChildProcessHandle, "pid">
  ) {
    const original = Option.getOrUndefined(MutableHashMap.get(owned, scope))
    if (original === undefined || original.handle !== handle)
      return yield* new HermeticControllerFailure({ operation: "record.foreignChild" })
    return original.digests
  })
  return {
    begin,
    end,
    bind,
    register,
    digestsFor,
    count: Effect.sync(() => MutableHashMap.size(owned)),
    forget: (scope: HermeticRegistrationScopeId, handle: Pick<ChildProcessSpawner.ChildProcessHandle, "pid">) =>
      Effect.sync(() => {
        if (Option.getOrUndefined(MutableHashMap.get(owned, scope))?.handle === handle)
          MutableHashMap.remove(owned, scope)
      })
  }
})
