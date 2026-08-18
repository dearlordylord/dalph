import { Effect } from "effect"
import { appendChangedHeadRetryQuarantine } from "../../workflow/protocols/integration-quarantine/changed-head-retry.js"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import { deliveryActionCompleted } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type RecordChangedHeadRetryQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordChangedHeadRetryQuarantine" }
>

/** Appends Retry's changed-head disposition without crossing an Integrator or other provider boundary. */
export const recordChangedHeadRetryQuarantine = Effect.fn("DeliveryAction.recordChangedHeadRetryQuarantine")(function* (
  action: IdentityFreeAction,
  transition: RecordChangedHeadRetryQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* appendChangedHeadRetryQuarantine(transition.request)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})
