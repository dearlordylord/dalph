import { Context, Effect } from "effect"
import { delivery } from "./delivery.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { currentSignalOf, type DeliveryRelationInputBundle } from "./relations.js"

/** Read-only ambient observation of one exact bundle successfully published by the reactive runtime. */
interface DeliveryRelationPublicationObservation {
  readonly observe: (bundle: DeliveryRelationInputBundle) => Effect.Effect<void>
}

/**
 * Optional observation seam. Production's default is inert; controlled callers
 * may override it without adding a required runtime dependency or failure.
 */
export const DeliveryRelationPublicationObserver = Context.Reference<DeliveryRelationPublicationObservation>(
  "@dalph/DeliveryRelationPublicationObserver",
  { defaultValue: () => ({ observe: () => Effect.void }) }
)

/** Evaluates one captured production bundle through the literal delivery composition. */
export const evaluateDeliveryRelationInputBundle = Effect.fn("DeliveryRelations.evaluatePublishedBundle")(function* (
  bundle: DeliveryRelationInputBundle
) {
  const coherent = currentSignalOf(bundle)
  const layer = makeDeliveryRelationsLayer({
    ...deterministicDeliveryRuntimeSupport(bundle.publication.policy),
    coherent
  })
  const signal = yield* delivery.pipe(Effect.provide(layer))
  return yield* signal.get
})
