import { Chunk, Effect, Option, Ref } from "effect"

export type AuthoredRunReactivationHint = "TrackerNotification" | "Timer"

/**
 * Owns the pending cassette hints for one authored Run execution. Taking a hint
 * atomically removes its persistent head so consumed nodes are not retained.
 */
export const makeAuthoredRunReactivationHintFifo = Effect.fn("AuthoredCassette.makeRunReactivationHintFifo")(
  function* () {
    const pending = yield* Ref.make(Chunk.empty<AuthoredRunReactivationHint>())

    return {
      offer: Effect.fn("AuthoredCassette.offerRunReactivationHint")((hint: AuthoredRunReactivationHint) =>
        Ref.update(pending, Chunk.append(hint))
      ),
      retainedHintCount: Ref.get(pending).pipe(Effect.map(Chunk.size)),
      take: Ref.modify(
        pending,
        (hints): [AuthoredRunReactivationHint | undefined, Chunk.Chunk<AuthoredRunReactivationHint>] =>
          Option.match(Chunk.head(hints), {
            onNone: () => [undefined, hints],
            onSome: (hint) => [hint, Chunk.drop(hints, 1)]
          })
      )
    }
  }
)
