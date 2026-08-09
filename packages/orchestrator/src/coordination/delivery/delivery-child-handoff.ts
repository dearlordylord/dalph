import { Deferred, Effect, type Scope } from "effect"

/** Installs interruption cleanup before an admitted delivery child may begin. */
export const installInterruptibleDeliveryChild = (
  scope: Scope.Scope,
  run: Effect.Effect<void>,
  release: Effect.Effect<void>
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const [ready, mayStart] = yield* Effect.all([Deferred.make<void>(), Deferred.make<void>()])
    const child = Deferred.succeed(ready, undefined).pipe(
      Effect.andThen(Deferred.await(mayStart)),
      Effect.andThen(run),
      Effect.onInterrupt(() => release),
      Effect.interruptible
    )
    yield* child.pipe(Effect.forkIn(scope))
    yield* Deferred.await(ready)
    return yield* Deferred.succeed(mayStart, undefined).pipe(
      Effect.andThen(Effect.yieldNow),
      Effect.as(true),
      Effect.interruptible
    )
  })
