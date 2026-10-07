import { CoordinatorOwnership, makeApplicationExitShell } from "@dalph/orchestrator"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Clock, Deferred, Effect, Fiber, Option, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { CodexAttemptStore, CodexServerIncarnation, memoryCodexAttemptStoreLayer } from "./codex-attempt-store.js"
import {
  CodexProviderHomeNamespace,
  CodexServerStartupRecord,
  codexStartupLimitMilliseconds
} from "./codex-server-startup-record.js"
import {
  boundCodexServerStartup,
  prepareCodexServerStartup,
  reconcileCodexServerStartup
} from "./codex-server-startup.js"

const home = CodexProviderHomeNamespace.make("/tmp/startup-home")

it.effect("Exit timeout cannot abandon initialized startup scope finalizers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* CodexAttemptStore
      const startup = yield* prepareCodexServerStartup(store, home)
      const cleanupStarted = yield* Deferred.make<void>()
      const permitCleanup = yield* Deferred.make<void>()
      const allReleased = yield* Deferred.make<void>()
      const released = yield* Ref.make(0)
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      yield* boundCodexServerStartup(
        startup,
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.void, () =>
            Ref.update(released, (count) => count + 1).pipe(Effect.andThen(Deferred.succeed(allReleased, undefined)))
          )
          yield* Effect.acquireRelease(Effect.void, () =>
            Deferred.succeed(cleanupStarted, undefined).pipe(
              Effect.andThen(Deferred.await(permitCleanup)),
              Effect.andThen(Ref.update(released, (count) => count + 1))
            )
          )
          return "initialized"
        }),
        {
          requested: shell.awaitExitRequested,
          registerDrain: (close) => shell.registerProcessLocalDrain({ closeProcessLocalResources: close })
        }
      )
      yield* Effect.gen(function* () {
        const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        yield* Deferred.await(cleanupStarted)
        yield* TestClock.adjust("5 seconds")
        expect((yield* Fiber.join(exiting))._tag).toBe("TimedOut")
        expect(yield* Ref.get(released)).toBe(0)
        const completion = yield* Deferred.await(allReleased).pipe(Effect.timeoutOption("1 second"), Effect.forkChild)
        yield* Deferred.succeed(permitCleanup, undefined)
        yield* TestClock.adjust("1 second")
        expect(Option.isSome(yield* Fiber.join(completion))).toBe(true)
        expect(yield* Ref.get(released)).toBe(2)
      }).pipe(Effect.ensuring(Deferred.succeed(permitCleanup, undefined)))
    })
  ).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("expired startup reconciles its prior launch before refusing without a new deadline", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const original = yield* prepareCodexServerStartup(store, home)
    const launch = {
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("prior"),
      phase: "Launching" as const,
      pid: null
    }
    yield* store.writeServerLaunch(launch)
    yield* TestClock.adjust("30 seconds")
    const reconcile = Effect.gen(function* () {
      expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
      yield* store.clearServerLaunch(launch.incarnation)
    })
    const outcome = yield* reconcileCodexServerStartup(store, home, reconcile).pipe(Effect.result)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ kind: "Deadline" })
    expect(yield* store.readServerLaunch()).toEqual(Option.none())
    expect(yield* store.readServerStartup()).toEqual(Option.some(original))
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("a changed home forbids prior-launch reconciliation even after startup expires", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const original = yield* prepareCodexServerStartup(store, home)
    const launch = {
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("prior"),
      phase: "Launching" as const,
      pid: null
    }
    yield* store.writeServerLaunch(launch)
    yield* TestClock.adjust("30 seconds")
    const outcome = yield* reconcileCodexServerStartup(
      store,
      CodexProviderHomeNamespace.make("/tmp/changed-home"),
      Effect.die("changed home must prevent process effects")
    ).pipe(Effect.result)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ kind: "Namespace" })
    expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
    expect(yield* store.readServerStartup()).toEqual(Option.some(original))
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("legacy launch without a home binding refuses before rewriting its execution evidence", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const launch = {
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("legacy"),
      phase: "Launching" as const,
      pid: null
    }
    yield* store.writeServerLaunch(launch)
    const outcome = yield* prepareCodexServerStartup(store, home).pipe(Effect.result)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ kind: "Namespace" })
    expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
    expect(yield* store.readServerStartup()).toEqual(Option.none())
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("missing retained-attempt authority cannot establish a fresh provider-home binding", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const { hasRetainedAttempts, ...uninspectable } = store
    expect(hasRetainedAttempts).toBeDefined()
    const outcome = yield* prepareCodexServerStartup(uninspectable, home).pipe(Effect.result)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ kind: "Custody" })
    expect(yield* store.readServerStartup()).toEqual(Option.none())
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("startup recovery keeps its original intent and remaining queue budget", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const initial = yield* prepareCodexServerStartup(store, home)
    expect(initial.intendedAtMilliseconds).toBe(yield* Clock.currentTimeMillis)
    expect(initial.deadlineMilliseconds - initial.intendedAtMilliseconds).toBe(codexStartupLimitMilliseconds)
    yield* TestClock.adjust("10 seconds")
    const recovered = yield* prepareCodexServerStartup(store, home)
    expect(recovered).toEqual(initial)
    expect(yield* store.readServerStartup()).toEqual(Option.some(initial))
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("expired startup recovery refuses without replacing its intent or deadline", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const initial = yield* prepareCodexServerStartup(store, home)
    yield* TestClock.adjust("30 seconds")
    const outcome = yield* prepareCodexServerStartup(store, home).pipe(Effect.result)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ kind: "Deadline" })
    expect(yield* store.readServerStartup()).toEqual(Option.some(initial))
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("startup recovery refuses a changed home before recording another intent", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const initial = yield* prepareCodexServerStartup(store, home)
    const foreign = yield* Schema.decodeUnknownEffect(CodexProviderHomeNamespace)("/tmp/foreign-home")
    const outcome = yield* prepareCodexServerStartup(store, foreign).pipe(Effect.result)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ kind: "Namespace" })
    expect(yield* store.readServerStartup()).toEqual(Option.some(initial))
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("a deliberate startup after observed initialization records a distinct bounded intent", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    const initial = yield* prepareCodexServerStartup(store, home)
    const initialized = yield* Schema.decodeUnknownEffect(CodexServerStartupRecord)({
      ...initial,
      _tag: "Initialized",
      initializedAtMilliseconds: yield* Clock.currentTimeMillis
    })
    yield* store.writeServerStartup(initialized)
    yield* TestClock.adjust("40 seconds")
    const next = yield* prepareCodexServerStartup(store, home)
    expect(next.startupId).not.toBe(initial.startupId)
    expect(next.intendedAtMilliseconds).toBe(yield* Clock.currentTimeMillis)
    expect(next.deadlineMilliseconds - next.intendedAtMilliseconds).toBe(codexStartupLimitMilliseconds)
    expect(yield* store.readServerStartup()).toEqual(Option.some(next))
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("the original startup deadline closes acquired resources when a pre-initialize boundary stalls", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* CodexAttemptStore
      const startup = yield* prepareCodexServerStartup(store, home)
      yield* TestClock.adjust("10 seconds")
      const acquired = yield* Deferred.make<void>()
      const stopped = yield* Ref.make(false)
      const initializeCalls = yield* Ref.make(0)
      const boundary = Effect.gen(function* () {
        yield* Effect.acquireRelease(Deferred.succeed(acquired, undefined), () => Ref.set(stopped, true))
        return yield* Effect.never.pipe(Effect.andThen(Ref.update(initializeCalls, (count) => count + 1)))
      })
      const waiting = yield* boundCodexServerStartup(startup, boundary).pipe(Effect.result, Effect.forkChild)
      yield* Deferred.await(acquired)
      yield* TestClock.adjust("20 seconds")
      const outcome = yield* Fiber.join(waiting)
      expect(outcome._tag).toBe("Failure")
      if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ kind: "Deadline" })
      expect(yield* Ref.get(stopped)).toBe(true)
      expect(yield* Ref.get(initializeCalls)).toBe(0)
      expect(yield* store.readServerStartup()).toEqual(Option.some(startup))
      const expired = yield* boundCodexServerStartup(
        startup,
        Ref.update(initializeCalls, (count) => count + 1)
      ).pipe(Effect.result)
      expect(expired._tag).toBe("Failure")
      expect(yield* Ref.get(initializeCalls)).toBe(0)
    })
  ).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)

it.effect("Exit times out at its original five seconds while startup cleanup remains unresolved", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* CodexAttemptStore
      const startup = yield* prepareCodexServerStartup(store, home)
      const acquired = yield* Deferred.make<void>()
      const permitCleanup = yield* Deferred.make<void>()
      const stopped = yield* Ref.make(false)
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      const waiting = yield* boundCodexServerStartup(
        startup,
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Deferred.succeed(acquired, undefined), () =>
            Deferred.await(permitCleanup).pipe(Effect.andThen(Ref.set(stopped, true)))
          )
          return yield* Effect.never
        }),
        {
          requested: shell.awaitExitRequested,
          registerDrain: (close) => shell.registerProcessLocalDrain({ closeProcessLocalResources: close })
        }
      ).pipe(Effect.result, Effect.forkChild)
      yield* Deferred.await(acquired)
      yield* Effect.gen(function* () {
        const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        yield* TestClock.adjust("5 seconds")
        expect((yield* Fiber.join(exiting))._tag).toBe("TimedOut")
        expect(yield* Ref.get(stopped)).toBe(false)
        expect(yield* store.readServerStartup()).toEqual(Option.some(startup))
      }).pipe(Effect.ensuring(Deferred.succeed(permitCleanup, undefined)))
      yield* Deferred.succeed(permitCleanup, undefined)
      expect((yield* Fiber.join(waiting))._tag).toBe("Failure")
      expect(yield* Ref.get(stopped)).toBe(true)
    })
  ).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)
