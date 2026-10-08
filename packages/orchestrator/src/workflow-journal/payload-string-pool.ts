/* eslint-disable functional/immutable-data -- One decoding batch owns this synchronous parser's private scratch table. */
import { Effect } from "effect"

/** Shares equal primitive strings while decoding one batch; it never changes a JSON value or owns workflow facts. */
export class JournalPayloadStringPool {
  readonly #strings = new Map<string, string>()

  /** JSON syntax failures are mapped by the event decoder's existing typed boundary. */
  parse(payloadJson: string): unknown {
    return JSON.parse(payloadJson, (_key: string, value: unknown): unknown => {
      if (typeof value !== "string") return value
      const retained = this.#strings.get(value)
      if (retained !== undefined) return retained
      this.#strings.set(value, value)
      return value
    })
  }

  clear(): void {
    this.#strings.clear()
  }
}

/** Releases the batch's scratch references on success, typed failure, defect or interruption. */
export const withJournalPayloadStringPool = <A, E, R>(
  use: (pool: JournalPayloadStringPool) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => new JournalPayloadStringPool()),
    use,
    (pool) => Effect.sync(() => pool.clear())
  )
