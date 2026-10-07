import { Context, Effect } from "effect"
import { delivery } from "./delivery.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { currentSignalOf, makeDeliveryConsequences, type DeliveryRelationInputBundle } from "./relations.js"

/** Read-only ambient observation of one exact bundle derived by reactive delivery planning. */
export interface DeliveryRelationInputObservation {
  readonly observe: (bundle: DeliveryRelationInputBundle) => Effect.Effect<void>
}

/**
 * Optional observation seam. Production's default is inert; controlled callers
 * may override it without adding a required runtime dependency or failure.
 */
export const DeliveryRelationInputObserver = Context.Reference<DeliveryRelationInputObservation>(
  "@dalph/DeliveryRelationInputObserver",
  { defaultValue: () => ({ observe: () => Effect.void }) }
)

/** Evaluates one captured production bundle through the literal delivery composition. */
export const evaluateDeliveryRelationInputBundle = Effect.fn("DeliveryRelations.evaluateCapturedBundle")(function* (
  bundle: DeliveryRelationInputBundle
) {
  const coherent = currentSignalOf(bundle)
  const layer = makeDeliveryRelationsLayer({
    ...deterministicDeliveryRuntimeSupport(bundle.graphView.policy),
    coherent
  })
  const signal = yield* delivery.pipe(Effect.provide(layer))
  return yield* signal.get
})

/** Evaluates the same captured bundle through descriptive delivery and downstream action planning. */
export const evaluateDeliveryRuntimeInputBundle = Effect.fn("DeliveryRelations.evaluateCapturedRuntimeBundle")(
  function* (bundle: DeliveryRelationInputBundle) {
    const coherent = currentSignalOf(bundle)
    const layer = makeDeliveryRelationsLayer({
      ...deterministicDeliveryRuntimeSupport(bundle.graphView.policy),
      coherent
    })
    const signal = yield* deliveryRuntime.pipe(Effect.provide(layer))
    return yield* signal.get
  }
)

/**
 * Evaluates one captured bundle once for both descriptive delivery and
 * downstream action planning. The runtime snapshot retains the complete
 * reflection-owned relation chain, so rebuilding consequences from it is
 * equivalent to evaluating `delivery` as a second independent composition.
 */
export const evaluateDeliveryRelationAndRuntimeInputBundle = Effect.fn(
  "DeliveryRelations.evaluateCapturedRelationAndRuntimeBundle"
)(function* (bundle: DeliveryRelationInputBundle) {
  const coherent = currentSignalOf(bundle)
  const layer = makeDeliveryRelationsLayer({
    ...deterministicDeliveryRuntimeSupport(bundle.graphView.policy),
    coherent
  })
  const signal = yield* deliveryRuntime.pipe(Effect.provide(layer))
  const runtime = yield* signal.get
  return { consequences: makeDeliveryConsequences(runtime.current.reflection), runtime }
})
