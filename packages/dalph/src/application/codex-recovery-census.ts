import { Duration, Effect, Option, Ref } from "effect"
import type { CodexOwnedActivityCensusProjection } from "./codex-app-server.js"

const maximumObservations = 5
const observationSpacingMilliseconds = 100
const observationSpacing = Duration.millis(observationSpacingMilliseconds)
const observationDeadline = Duration.seconds(1)

/**
 * Fresh provider startup can briefly expose an unassociated incarnation child.
 * Read-only reconciliation retains the custody fence until a complete census
 * proves absence. It never signals a process or retries a provider mutation.
 */
export const observeRecoveryWriterCensus = <E>(
  observe: Effect.Effect<CodexOwnedActivityCensusProjection, E>
): Effect.Effect<CodexOwnedActivityCensusProjection, E> =>
  Effect.gen(function* () {
    const last = yield* Ref.make<CodexOwnedActivityCensusProjection>({
      _tag: "Unreadable",
      detail: "recovery census observation deadline exceeded"
    })
    const result = yield* Effect.gen(function* () {
      for (let observation = 0; observation < maximumObservations; observation++) {
        const census = yield* observe
        yield* Ref.set(last, census)
        if (census._tag !== "Unreadable" || observation === maximumObservations - 1) return census
        yield* Effect.sleep(observationSpacing)
      }
      return yield* Ref.get(last)
    }).pipe(Effect.timeoutOption(observationDeadline))
    return Option.isSome(result) ? result.value : yield* Ref.get(last)
  })
