import { Deferred, Effect, Exit, Option, Ref } from "effect"

interface InFlightRequest {
  readonly completion: Deferred.Deferred<Exit.Exit<void, unknown>>
  readonly identity: string
}

/** Test-only ownership of one external operator request that may outlive a coordinator activation. */
type AuthoredOperatorRequestLifecycle = {
  readonly awaitInFlightAtBoundary: () => Effect.Effect<void>
  readonly pollInFlight: () => Effect.Effect<Option.Option<string>>
  readonly run: <A, E, R>(identity: string, request: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

/** Keeps request completion process-scoped while snapshotting only work already active at a callback return. */
export const makeAuthoredOperatorRequestLifecycle = Effect.fn("AuthoredCassette.makeOperatorRequestLifecycle")(
  function* (): Effect.fn.Return<AuthoredOperatorRequestLifecycle> {
    const active = yield* Ref.make<Option.Option<InFlightRequest>>(Option.none())

    return {
      awaitInFlightAtBoundary: () =>
        Ref.get(active).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: ({ completion }) =>
                Deferred.await(completion).pipe(
                  Effect.flatMap(
                    Exit.match({
                      onFailure: (cause) => Effect.failCause(cause).pipe(Effect.orDie),
                      onSuccess: Effect.succeed
                    })
                  )
                )
            })
          )
        ),
      pollInFlight: () => Ref.get(active).pipe(Effect.map(Option.map(({ identity }) => identity))),
      run: (identity, request) =>
        Effect.gen(function* () {
          const completion = yield* Deferred.make<Exit.Exit<void, unknown>>()
          const token = { completion, identity }
          const installed = yield* Ref.modify(active, (current) =>
            Option.isNone(current) ? [true, Option.some(token)] : [false, current]
          )
          if (!installed) return yield* Effect.die(`authored operator request ${identity} overlaps another request`)

          return yield* request.pipe(
            Effect.onExit((exit) =>
              Deferred.succeed(
                completion,
                Exit.map(exit, () => undefined)
              ).pipe(
                Effect.andThen(
                  Ref.update(active, (current) =>
                    Option.isSome(current) && current.value === token ? Option.none() : current
                  )
                )
              )
            )
          )
        })
    }
  }
)
