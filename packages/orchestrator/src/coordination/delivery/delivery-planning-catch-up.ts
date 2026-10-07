import type { RunId } from "@dalph/contracts"
import { Context, type Effect } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryRelationSourceError } from "./relations.js"

/** Activation-local proof that delivery planning incorporated one exact Run's Journal prefix through this position. */
export interface DeliveryPlanningCatchUpBoundary {
  readonly _tag: "DeliveryPlanningCatchUpBoundary"
  readonly acceptedThrough: JournalPosition
  readonly runId: RunId
}

/**
 * Boundary the runtime calls after an executor action returns its ordinary
 * result. It completes after delivery planning incorporates every accepted fact
 * through the returned position, closing the journal-to-relation interval
 * before the runtime enqueues that result as an action completion.
 */
export interface DeliveryPlanningCatchUpService {
  readonly awaitJournalPosition: Effect.Effect<DeliveryPlanningCatchUpBoundary, DeliveryRelationSourceError>
}

export class DeliveryPlanningCatchUp extends Context.Service<DeliveryPlanningCatchUp, DeliveryPlanningCatchUpService>()(
  "@dalph/DeliveryPlanningCatchUp"
) {}
