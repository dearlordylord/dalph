import { Context, Effect } from "effect"
import type { ExactClaim, RecoveredDecision } from "./contracts.ts"

export interface ExactTaskClaimRecoveryService {
  readonly recoverExactClaim: Effect.Effect<ExactClaim | null>
}

/** Reads the tracker and, only from an absent claim, performs the already-authorized exact claim request. */
export class ExactTaskClaimRecovery extends Context.Service<
  ExactTaskClaimRecovery,
  ExactTaskClaimRecoveryService
>()("@dalph/prototype/ExactTaskClaimRecovery") {}

export interface CurrentTaskFacts {
  readonly lifecycle: "Open" | "Closed"
  readonly targetMember: boolean
}

export interface CurrentTaskFactsRefreshService {
  readonly currentTaskFacts: Effect.Effect<CurrentTaskFacts>
}

/** Reads the task tracker again before making a decision that depends on current task facts. */
export class CurrentTaskFactsRefresh extends Context.Service<
  CurrentTaskFactsRefresh,
  CurrentTaskFactsRefreshService
>()("@dalph/prototype/CurrentTaskFactsRefresh") {}

/** Continues the established Run only from an exact claim and current tracker facts. */
export const recoverCurrentRunDecision: Effect.Effect<
  RecoveredDecision,
  never,
  CurrentTaskFactsRefresh | ExactTaskClaimRecovery
> = Effect.gen(function* () {
  const claims = yield* ExactTaskClaimRecovery
  const exactClaim = yield* claims.recoverExactClaim
  if (exactClaim === null) return "Wait"

  const tasks = yield* CurrentTaskFactsRefresh
  const current = yield* tasks.currentTaskFacts
  return current.lifecycle === "Open" && current.targetMember ? "ContinueSameRun" : "Wait"
})
