import { Clock, Effect, Ref } from "effect"
import { type GithubGraphqlOperation } from "./graphql-throttling.js"
import { GithubGraphqlRequestError } from "./graphql-response.js"

/** The process-local request budget is deliberately far below GitHub's hourly primary quota. */
const githubRequestRateWindowNanos = 60n * 1_000_000_000n
const githubRequestRateLimit = 120
const githubRequestCircuitCooldownNanos = 30n * 1_000_000_000n

export interface GithubRequestRateState {
  readonly openUntil: bigint | undefined
  readonly requests: ReadonlyArray<bigint>
}

const githubRequestCircuitOpen = (operation: GithubGraphqlOperation) =>
  new GithubGraphqlRequestError({
    detail: `GitHub request circuit is open after ${githubRequestRateLimit} requests in 60 seconds; retrying is locally deferred for 30 seconds`,
    kind: "CircuitOpen",
    operation
  })

/** Reserves one request or fails locally while the production tracker circuit is open. */
export const reserveGithubRequest = Effect.fn("GithubGraphqlClient.reserveRequest")(function* (
  state: Ref.Ref<GithubRequestRateState>,
  operation: GithubGraphqlOperation
) {
  const now = yield* Clock.monotonicTimeNanos
  const admitted = yield* Ref.modify(state, (current): readonly [boolean, GithubRequestRateState] => {
    if (current.openUntil !== undefined && now < current.openUntil) {
      const recent = current.requests.filter((startedAt) => now - startedAt < githubRequestRateWindowNanos)
      return [false, { ...current, requests: recent }]
    }
    // A full cooldown is a deliberate fresh admission window. Retaining the
    // old burst would reopen the circuit immediately after it closes.
    const recent =
      current.openUntil === undefined
        ? current.requests.filter((startedAt) => now - startedAt < githubRequestRateWindowNanos)
        : []
    if (recent.length >= githubRequestRateLimit) {
      return [false, { openUntil: now + githubRequestCircuitCooldownNanos, requests: recent }]
    }
    return [true, { openUntil: undefined, requests: [...recent, now] }]
  })
  if (!admitted) return yield* githubRequestCircuitOpen(operation)
})
