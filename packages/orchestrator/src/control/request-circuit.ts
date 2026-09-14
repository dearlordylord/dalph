import { Clock, Effect, Ref } from "effect"

/** Process-local admission policy for one external request driver. */
export interface RequestCircuitPolicy {
  /** Maximum number of request starts admitted during one sliding window. */
  readonly maxRequests: number
  /** Length of the sliding admission window, represented in monotonic nanoseconds. */
  readonly windowNanos: bigint
  /** Length of the fresh admission cooldown after the window is exhausted. */
  readonly cooldownNanos: bigint
}

/** Constructs the typed failure a caller observes when local admission is open. */
// eslint-disable-next-line functional/no-mixed-types -- The generic seam intentionally groups one policy with its typed failure constructor.
export interface RequestCircuitOptions<Operation, Failure> {
  readonly policy: RequestCircuitPolicy
  readonly onOpen: (operation: Operation) => Failure
}

/** One process-local request admission circuit owned by an external driver. */
export interface RequestCircuit<Operation, Failure> {
  /** Admits one request before running it, preserving the transport's typed failures. */
  readonly run: <A, E, R>(operation: Operation, request: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Failure, R>
}

interface RequestCircuitState {
  readonly openUntil: bigint | undefined
  readonly requests: ReadonlyArray<bigint>
}

/**
 * Creates one atomic process-local request circuit.
 *
 * The circuit counts request starts, not outcomes. A cooldown deliberately
 * discards the exhausted burst so the first request after it closes starts a
 * fresh window. The owning driver supplies the operation identity and typed
 * failure; this module does not know how requests are transported or retried.
 */
export const makeRequestCircuit = Effect.fn("RequestCircuit.make")(function* <Operation, Failure>(
  options: RequestCircuitOptions<Operation, Failure>
): Effect.fn.Return<RequestCircuit<Operation, Failure>> {
  const state = yield* Ref.make<RequestCircuitState>({ openUntil: undefined, requests: [] })
  const admit = Effect.fn("RequestCircuit.admit")(function* (operation: Operation) {
    const now = yield* Clock.monotonicTimeNanos
    const admitted = yield* Ref.modify(state, (current): readonly [boolean, RequestCircuitState] => {
      const recent = current.requests.filter((startedAt) => now - startedAt < options.policy.windowNanos)
      if (current.openUntil !== undefined && now < current.openUntil) {
        return [false, { ...current, requests: recent }]
      }
      // A full cooldown is a deliberate fresh admission window. Retaining the
      // old burst would reopen the circuit immediately after it closes.
      const available = current.openUntil === undefined ? recent : []
      if (available.length >= options.policy.maxRequests) {
        return [false, { openUntil: now + options.policy.cooldownNanos, requests: recent }]
      }
      return [true, { openUntil: undefined, requests: [...available, now] }]
    })
    if (!admitted) return yield* Effect.fail(options.onOpen(operation))
  })
  const run = <A, E, R>(operation: Operation, request: Effect.Effect<A, E, R>) =>
    admit(operation).pipe(Effect.andThen(request))
  return { run }
})
