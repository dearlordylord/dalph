import { Context, Effect } from "effect"
import type { ExactClaim, RecoveredDecision } from "./contracts.ts"

export interface ExactTaskClaimReconciliationService {
  readonly exactClaim: Effect.Effect<ExactClaim | null>
}

/** Checks the task tracker before deciding whether the exact claim request is settled. */
export class ExactTaskClaimReconciliation extends Context.Service<
  ExactTaskClaimReconciliation,
  ExactTaskClaimReconciliationService
>()("@dalph/prototype/ExactTaskClaimReconciliation") {}

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
  CurrentTaskFactsRefresh | ExactTaskClaimReconciliation
> = Effect.gen(function* () {
  const claims = yield* ExactTaskClaimReconciliation
  const exactClaim = yield* claims.exactClaim
  if (exactClaim === null) return "Wait"

  const tasks = yield* CurrentTaskFactsRefresh
  const current = yield* tasks.currentTaskFacts
  return current.lifecycle === "Open" && current.targetMember ? "ContinueSameRun" : "Wait"
})
