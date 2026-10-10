import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  type ApplicationExitResult,
  type ApplicationExitShellService
} from "@dalph/orchestrator"
import { Cause, Deferred, Effect, Exit, Fiber, Ref, Scope } from "effect"

/** No selected observation was delivered; this does not assert that no Run was begun. */
export type ProductionHostAcquisition<A> =
  | { readonly _tag: "Acquired"; readonly value: A }
  | { readonly _tag: "ExitedBeforeObservation"; readonly result: ApplicationExitResult }

/**
 * The host owns acquisition before its transport can request Exit. Resources
 * acquired into the host scope survive acquisition completion and result reporting.
 * A timed-out result never releases the still-running acquisition's ownership.
 */
export const acquireProductionHost = <A, E, R, ETransport, RTransport>(
  shell: ApplicationExitShellService,
  acquire: Effect.Effect<A, E, R>,
  installTransport: Effect.Effect<void, ETransport, RTransport>
): Effect.Effect<ProductionHostAcquisition<A>, E | ETransport, R | RTransport | Scope.Scope> =>
  Effect.gen(function* () {
    const hostScope = yield* Effect.scope
    const registrationScope = yield* Scope.fork(hostScope)
    const start = yield* Deferred.make<void>()
    const requested = yield* Ref.make(false)
    const completion = yield* Deferred.make<Exit.Exit<A, E>>()
    const acquiring = yield* Deferred.await(start).pipe(
      Effect.andThen(acquire),
      Effect.tap((value) => Deferred.succeed(completion, Exit.succeed(value))),
      // Keep acquisition's fiber children alive after the observation is delivered.
      Effect.andThen(Effect.never),
      Effect.onExit((outcome) => Deferred.succeed(completion, outcome)),
      Effect.provideService(Scope.Scope, hostScope),
      Effect.forkIn(hostScope, { startImmediately: true })
    )
    // Register this observer before provider startup can register its own waiter.
    const stopping = yield* shell.awaitExitRequested.pipe(
      Effect.andThen(Ref.set(requested, true)),
      Effect.andThen(Fiber.interrupt(acquiring)),
      Effect.forkIn(hostScope, { startImmediately: true })
    )
    const isRequestedInterruption = (outcome: Exit.Exit<A, E>) =>
      Exit.isFailure(outcome) && Cause.hasInterruptsOnly(outcome.cause)
    yield* shell
      .registerProcessLocalDrain({
        closeProcessLocalResources: Fiber.await(acquiring).pipe(
          Effect.flatMap((outcome) =>
            Exit.isSuccess(outcome) || isRequestedInterruption(outcome)
              ? Effect.void
              : Effect.fail(
                  new ApplicationExitDrainFailure({
                    diagnostics: [ApplicationExitDiagnostic.make("Production host acquisition failed during Exit")]
                  })
                )
          )
        )
      })
      .pipe(Effect.provideService(Scope.Scope, registrationScope))
    const finalizeOwner = Fiber.interrupt(acquiring).pipe(
      Effect.andThen(Fiber.await(acquiring)),
      Effect.flatMap((outcome) =>
        Exit.isFailure(outcome) && !isRequestedInterruption(outcome)
          ? Effect.failCause(outcome.cause).pipe(Effect.orDie)
          : Effect.void
      )
    )
    yield* installTransport
    // A synchronous transport request may have arrived while the start was blocked.
    if (!(yield* Ref.get(requested))) yield* Deferred.succeed(start, undefined)
    const completed = yield* Effect.raceFirst(
      Deferred.await(completion).pipe(Effect.map((outcome) => ({ _tag: "Acquisition" as const, outcome }))),
      shell.awaitExitRequested.pipe(
        Effect.andThen(shell.awaitExitResult),
        Effect.map((result) => ({ _tag: "Exit" as const, result }))
      )
    )
    const exitBeforeObservation = (result: ApplicationExitResult) =>
      Effect.addFinalizer(() => finalizeOwner).pipe(Effect.as({ _tag: "ExitedBeforeObservation" as const, result }))
    if (completed._tag === "Exit") {
      const outcome = yield* Effect.sync(() => acquiring.pollUnsafe())
      if (outcome !== undefined && Exit.isFailure(outcome) && !isRequestedInterruption(outcome))
        return yield* Effect.failCause(outcome.cause)
      return yield* exitBeforeObservation(completed.result)
    }
    if (Exit.isFailure(completed.outcome)) {
      if (!(yield* Ref.get(requested)) || !isRequestedInterruption(completed.outcome))
        return yield* Effect.failCause(completed.outcome.cause)
      return yield* shell.awaitExitResult.pipe(Effect.flatMap(exitBeforeObservation))
    }
    yield* Fiber.interrupt(stopping)
    yield* Scope.close(registrationScope, Exit.void)
    if (yield* Ref.get(requested)) return yield* shell.awaitExitResult.pipe(Effect.flatMap(exitBeforeObservation))
    yield* Effect.addFinalizer(() => finalizeOwner)
    return { _tag: "Acquired", value: completed.outcome.value }
  })
