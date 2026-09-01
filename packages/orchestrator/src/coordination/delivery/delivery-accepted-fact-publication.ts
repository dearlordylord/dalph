import type { RunId } from "@dalph/contracts"
import { Context, type Effect } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryRelationSourceError } from "./relations.js"

/**
 * Activation-local proof that one exact action returned only after delivery
 * planning published the Journal prefix accepted through this position.
 */
export interface DeliveryAcceptedPublicationBoundary {
  readonly _tag: "DeliveryAcceptedPublicationBoundary"
  readonly acceptedThrough: JournalPosition
  readonly runId: RunId
}

/**
 * Proof that delivery planning has published every journal fact accepted before
 * an action boundary returned. Runtime quiescence may rely on action completion
 * only after this proof closes the journal-to-relation publication interval.
 */
export interface DeliveryAcceptedFactPublicationService {
  readonly awaitCurrent: Effect.Effect<DeliveryAcceptedPublicationBoundary, DeliveryRelationSourceError>
}

export class DeliveryAcceptedFactPublication extends Context.Service<
  DeliveryAcceptedFactPublication,
  DeliveryAcceptedFactPublicationService
>()("@dalph/DeliveryAcceptedFactPublication") {}
