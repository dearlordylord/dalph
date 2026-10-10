import { NodeCrypto } from "@effect/platform-node"
import { CodexAttemptStore, memoryCodexAttemptStoreLayer } from "./codex-attempt-store.js"
import { CodexProviderHomeNamespace } from "./codex-server-startup-record.js"
import { boundCodexServerStartup, prepareCodexServerStartup } from "./codex-server-startup.js"
import { makeProductionHostApplicationExitShell } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { acquireProductionHost } from "./production-host-acquisition.js"

it.effect("Exit before the acquisition start permits no boundary call", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeProductionHostApplicationExitShell()
      const calls = yield* Ref.make(0)
      const outcome = yield* acquireProductionHost(
        shell,
        Ref.update(calls, (value) => value + 1),
        shell.requestBoundary.requestExit.pipe(Effect.forkChild, Effect.andThen(shell.awaitExitRequested))
      )
      expect(outcome._tag).toBe("ExitedBeforeObservation")
      if (outcome._tag === "ExitedBeforeObservation") expect(outcome.result._tag).toBe("Succeeded")
      expect(yield* Ref.get(calls)).toBe(0)
    })
  )
)

it.effect("normal acquisition retires its drain without closing host resources", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeProductionHostApplicationExitShell()
      const closed = yield* Ref.make(false)
      const outcome = yield* acquireProductionHost(
        shell,
        Effect.acquireRelease(Effect.succeed("resource"), () => Ref.set(closed, true)),
        Effect.void
      )
      expect(outcome).toEqual({ _tag: "Acquired", value: "resource" })
      expect(yield* Ref.get(closed)).toBe(false)
      expect((yield* shell.requestBoundary.requestExit)._tag).toBe("Succeeded")
      expect(yield* Ref.get(closed)).toBe(false)
    })
  )
)

it.effect("acquired resources remain owned through lifecycle reporting", () =>
  Effect.gen(function* () {
    const closed = yield* Ref.make(false)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* makeProductionHostApplicationExitShell()
        const entered = yield* Deferred.make<void>()
        const acquiring = yield* acquireProductionHost(
          shell,
          Effect.acquireRelease(Effect.void, () => Ref.set(closed, true)).pipe(
            Effect.andThen(Deferred.succeed(entered, undefined)),
            Effect.andThen(Effect.never)
          ),
          Effect.void
        ).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        expect((yield* shell.requestBoundary.requestExit)._tag).toBe("Succeeded")
        expect((yield* Fiber.join(acquiring))._tag).toBe("ExitedBeforeObservation")
        expect(yield* Ref.get(closed)).toBe(false)
      })
    )
    expect(yield* Ref.get(closed)).toBe(true)
  })
)

it.effect("the lifecycle timeout remains observable while owned acquisition cleanup is pending", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeProductionHostApplicationExitShell()
      const entered = yield* Deferred.make<void>()
      const cleanup = yield* Deferred.make<void>()
      const permit = yield* Deferred.make<void>()
      const stopped = yield* Ref.make(false)
      const acquiring = yield* acquireProductionHost(
        shell,
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Deferred.succeed(cleanup, undefined).pipe(
              Effect.andThen(Deferred.await(permit)),
              Effect.andThen(Ref.set(stopped, true))
            )
          )
        ),
        Effect.void
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const request = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(cleanup)
      yield* TestClock.adjust("5 seconds")
      expect((yield* Fiber.join(request))._tag).toBe("TimedOut")
      const result = yield* Fiber.join(acquiring)
      expect(result._tag).toBe("ExitedBeforeObservation")
      if (result._tag === "ExitedBeforeObservation") expect(result.result._tag).toBe("TimedOut")
      expect(yield* Ref.get(stopped)).toBe(false)
      yield* Deferred.succeed(permit, undefined)
    })
  )
)

it.effect("Exit cannot replace a conclusive acquisition failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeProductionHostApplicationExitShell()
      const failure = { _tag: "ExactAcquisitionFailure" }
      const entered = yield* Deferred.make<void>()
      const permit = yield* Deferred.make<void>()
      const acquiring = yield* acquireProductionHost(
        shell,
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(permit)),
          Effect.andThen(Effect.fail(failure)),
          Effect.uninterruptible
        ),
        Effect.void
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const request = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* shell.awaitExitRequested
      yield* Deferred.succeed(permit, undefined)
      const result = yield* Fiber.await(acquiring)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.findErrorOption(result.cause)).toEqual(Option.some(failure))
      expect((yield* Fiber.join(request))._tag).toBe("Failed")
    })
  )
)

it.effect("a cleanup defect after TimedOut remains a host finalization failure", () =>
  Effect.gen(function* () {
    const failure = { _tag: "ExactLateCleanupFailure" }
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* makeProductionHostApplicationExitShell()
        const entered = yield* Deferred.make<void>()
        const cleanup = yield* Deferred.make<void>()
        const permit = yield* Deferred.make<void>()
        const acquiring = yield* acquireProductionHost(
          shell,
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Deferred.succeed(cleanup, undefined).pipe(
                Effect.andThen(Deferred.await(permit)),
                Effect.andThen(Effect.die(failure))
              )
            )
          ),
          Effect.void
        ).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const request = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        yield* Deferred.await(cleanup)
        yield* TestClock.adjust("5 seconds")
        expect((yield* Fiber.join(request))._tag).toBe("TimedOut")
        expect((yield* Fiber.join(acquiring))._tag).toBe("ExitedBeforeObservation")
        yield* Deferred.succeed(permit, undefined)
      })
    ).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result))
      expect(result.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === failure)).toBe(true)
  })
)

it.effect("normal acquisition retains its fiber children until the host scope closes", () =>
  Effect.gen(function* () {
    const closed = yield* Ref.make(false)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* makeProductionHostApplicationExitShell()
        const childReady = yield* Deferred.make<void>()
        const outcome = yield* acquireProductionHost(
          shell,
          Effect.gen(function* () {
            yield* Deferred.succeed(childReady, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Ref.set(closed, true)),
              Effect.forkChild
            )
            yield* Deferred.await(childReady)
            return "selected"
          }),
          Effect.void
        )
        expect(outcome).toEqual({ _tag: "Acquired", value: "selected" })
        expect(yield* Ref.get(closed)).toBe(false)
      })
    )
    expect(yield* Ref.get(closed)).toBe(true)
  })
)

it.effect("early host Exit joins the existing provider startup cleanup exactly once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeProductionHostApplicationExitShell()
      const store = yield* CodexAttemptStore
      const startup = yield* prepareCodexServerStartup(store, CodexProviderHomeNamespace.make("/tmp/host-exit-startup"))
      const entered = yield* Deferred.make<void>()
      const stopped = yield* Ref.make(0)
      const acquiring = yield* acquireProductionHost(
        shell,
        boundCodexServerStartup(
          startup,
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Deferred.succeed(entered, undefined), () =>
              Ref.update(stopped, (count) => count + 1)
            )
            return yield* Effect.never
          }),
          {
            requested: shell.awaitExitRequested,
            registerDrain: (close) => shell.registerProcessLocalDrain({ closeProcessLocalResources: close })
          }
        ),
        Effect.void
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      expect((yield* shell.requestBoundary.requestExit)._tag).toBe("Succeeded")
      const outcome = yield* Fiber.join(acquiring)
      expect(outcome._tag).toBe("ExitedBeforeObservation")
      expect(yield* Ref.get(stopped)).toBe(1)
      expect(yield* store.readServerStartup()).toEqual(Option.some(startup))
    })
  ).pipe(Effect.provide(memoryCodexAttemptStoreLayer()), Effect.provide(NodeCrypto.layer))
)
