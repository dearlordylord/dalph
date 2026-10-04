import { Clock, Crypto, Duration, Effect, Exit, Option, Schema, Scope } from "effect"
import { type CodexAttemptStoreService } from "./codex-attempt-store.js"
import {
  type CodexProviderHomeNamespace,
  CodexServerStartupRecord,
  codexStartupLimitMilliseconds
} from "./codex-server-startup-record.js"

/** Startup refusal preserves the unit's private record and grants no workflow or process authority. */
export class CodexServerStartupFailure extends Schema.TaggedError<CodexServerStartupFailure>()(
  "CodexServerStartupFailure",
  { kind: Schema.Literals(["Deadline", "Namespace", "Custody"]), detail: Schema.String }
) {}

/** Validate the retained namespace before granting any prior-process reconciliation effects. */
const inspectCodexServerStartupNamespace = Effect.fn("CodexServerStartup.inspectNamespace")(function* (
  store: CodexAttemptStoreService,
  home: CodexProviderHomeNamespace
) {
  const previous = yield* store.readServerStartup()
  if (Option.isSome(previous) && previous.value.home !== home) {
    return yield* new CodexServerStartupFailure({
      kind: "Namespace",
      detail: "retained provider-home namespace differs from the configured home"
    })
  }
  if (Option.isNone(previous)) {
    const launch = yield* store.readServerLaunch()
    if (store.hasRetainedAttempts === undefined)
      return yield* new CodexServerStartupFailure({
        kind: "Custody",
        detail: "retained attempt inspection is unavailable for provider-home binding"
      })
    const retainedAttempts = yield* store.hasRetainedAttempts()
    if (Option.isSome(launch) || retainedAttempts)
      return yield* new CodexServerStartupFailure({
        kind: "Namespace",
        detail: "retained legacy execution has no proven provider-home namespace"
      })
  }
  return previous
})

/** Namespace refusal precedes reconciliation; an expired budget still permits exact prior-writer cleanup. */
export const reconcileCodexServerStartup = Effect.fn("CodexServerStartup.reconcile")(function* <E, R>(
  store: CodexAttemptStoreService,
  home: CodexProviderHomeNamespace,
  reconcilePriorLaunch: Effect.Effect<void, E, R>
) {
  yield* inspectCodexServerStartupNamespace(store, home)
  yield* reconcilePriorLaunch
  return yield* prepareCodexServerStartup(store, home)
})

/** Persist the original queue-plus-initialize budget before admission; recovery cannot replenish it. */
export const prepareCodexServerStartup = Effect.fn("CodexServerStartup.prepare")(function* (
  store: CodexAttemptStoreService,
  home: CodexProviderHomeNamespace
) {
  const previous = yield* inspectCodexServerStartupNamespace(store, home)
  const now = yield* Clock.currentTimeMillis
  if (Option.isSome(previous) && previous.value._tag === "Pending") {
    if (now >= previous.value.deadlineMilliseconds) {
      return yield* new CodexServerStartupFailure({
        kind: "Deadline",
        detail: "original queue-plus-initialize startup deadline expired"
      })
    }
    return previous.value
  }
  const crypto = yield* Crypto.Crypto
  const startupId = yield* crypto.randomUUIDv4.pipe(
    Effect.mapError(() => new CodexServerStartupFailure({ kind: "Custody", detail: "startup identity unavailable" }))
  )
  const intent = yield* Schema.decodeUnknownEffect(CodexServerStartupRecord)({
    _tag: "Pending",
    startupId,
    home,
    intendedAtMilliseconds: now,
    deadlineMilliseconds: now + codexStartupLimitMilliseconds
  }).pipe(
    Effect.mapError(() => new CodexServerStartupFailure({ kind: "Custody", detail: "startup intent is invalid" }))
  )
  yield* store.writeServerStartup(intent)
  return intent
})

/** Keep all startup acquisitions in one child scope and the original recorded budget. */
export const boundCodexServerStartup = Effect.fn("CodexServerStartup.bound")(function* <A, E, R>(
  startup: CodexServerStartupRecord | undefined,
  acquire: Effect.Effect<A, E, R>,
  exit?: {
    readonly requested: Effect.Effect<void>
    readonly registerDrain: (close: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>
  }
) {
  if (startup === undefined) return yield* acquire
  const remaining = startup.deadlineMilliseconds - (yield* Clock.currentTimeMillis)
  const expired = () =>
    new CodexServerStartupFailure({
      kind: "Deadline",
      detail: "original queue-plus-initialize startup deadline expired"
    })
  if (remaining <= 0) return yield* expired()
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope)
      const close = yield* Effect.cached(Scope.close(scope, Exit.void))
      if (exit !== undefined) yield* exit.registerDrain(close)
      const acquiring =
        exit === undefined
          ? acquire
          : Effect.raceFirst(
              acquire,
              exit.requested.pipe(
                Effect.andThen(
                  Effect.fail(
                    new CodexServerStartupFailure({
                      kind: "Custody",
                      detail: "application Exit closed startup before initialization completed"
                    })
                  )
                )
              )
            )
      return yield* restore(
        acquiring.pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.timeoutOrElse({ duration: Duration.millis(remaining), orElse: () => Effect.fail(expired()) })
        )
      ).pipe(Effect.onError(() => close))
    })
  )
})
