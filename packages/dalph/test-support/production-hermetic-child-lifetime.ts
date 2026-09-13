import type { EvidenceDigest } from "@dalph/contracts"
import { Cause, Deferred, Effect, Exit, Fiber, HashSet, Option, Ref, Schema } from "effect"
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import type { HermeticRegistrationScopeId } from "../src/application/production-hermetic-contract.js"
import type { HermeticExpectedRecordRegistration } from "../src/application/production-hermetic-provider-bridge.js"
import type { HermeticPublicChild } from "./production-hermetic-controller.js"

export class HermeticControllerFailure extends Schema.TaggedError<HermeticControllerFailure>()(
  "HermeticControllerFailure",
  { operation: Schema.NonEmptyString }
) {}

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
  const owned = new Map<
    HermeticRegistrationScopeId,
    { readonly handle: Pick<ChildProcessSpawner.ChildProcessHandle, "pid">; digests: HashSet.HashSet<EvidenceDigest> }
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
    owned.set(scope, { handle, digests: HashSet.empty() })
  })
  const register = Effect.fn("HermeticRecordBindings.register")(function* (
    scope: HermeticRegistrationScopeId,
    registration: typeof HermeticExpectedRecordRegistration.Type
  ) {
    const current = yield* Ref.get(window)
    if (current._tag === "Spawning" && current.scope === scope) yield* Deferred.await(current.settled)
    const original = owned.get(scope)
    if (original === undefined || original.handle.pid !== registration.processId)
      return yield* new HermeticControllerFailure({ operation: "record.foreignChild" })
    original.digests = HashSet.add(original.digests, registration.digest)
  })
  const digestsFor = Effect.fn("HermeticRecordBindings.digestsFor")(function* (
    scope: HermeticRegistrationScopeId,
    handle: Pick<ChildProcessSpawner.ChildProcessHandle, "pid">
  ) {
    const original = owned.get(scope)
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
    count: Effect.sync(() => owned.size),
    forget: (scope: HermeticRegistrationScopeId, handle: Pick<ChildProcessSpawner.ChildProcessHandle, "pid">) =>
      Effect.sync(() => {
        if (owned.get(scope)?.handle === handle) owned.delete(scope)
      })
  }
})
