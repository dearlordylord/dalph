import type { RunId } from "@dalph/contracts"
import { Context, type Effect } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryRelationSourceError } from "./relations.js"

/** Activation-local proof that delivery planning published one exact Run's Journal prefix through this position. */
export interface DeliveryAcceptedPublicationBoundary {
  readonly _tag: "DeliveryAcceptedPublicationBoundary"
  readonly acceptedThrough: JournalPosition
  readonly runId: RunId
}

/**
 * Boundary the runtime calls after an executor action returns its ordinary
 * result. It completes after delivery planning publishes every accepted fact
 * through the returned position, closing the journal-to-relation interval
 * before the runtime enqueues that result as an action completion.
 */
export interface DeliveryAcceptedFactPublicationService {
  readonly awaitCurrent: Effect.Effect<DeliveryAcceptedPublicationBoundary, DeliveryRelationSourceError>
}

export class DeliveryAcceptedFactPublication extends Context.Service<
  DeliveryAcceptedFactPublication,
  DeliveryAcceptedFactPublicationService
>()("@dalph/DeliveryAcceptedFactPublication") {}
