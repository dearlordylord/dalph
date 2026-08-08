import { Context, type Effect } from "effect"
import type { DeliveryRelationSourceError } from "./relations.js"

/**
 * Proof that delivery planning has published every journal fact accepted before
 * an action boundary returned. Runtime quiescence may rely on action completion
 * only after this proof closes the journal-to-relation publication interval.
 */
export interface DeliveryAcceptedFactPublicationService {
  readonly awaitCurrent: Effect.Effect<void, DeliveryRelationSourceError>
}

export class DeliveryAcceptedFactPublication extends Context.Service<
  DeliveryAcceptedFactPublication,
  DeliveryAcceptedFactPublicationService
>()("@dalph/DeliveryAcceptedFactPublication") {}
