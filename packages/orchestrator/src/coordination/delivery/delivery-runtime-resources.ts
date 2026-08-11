import { Context, Effect, Layer } from "effect"
import {
  makeIntegrationTargetResourceController,
  type IntegrationTargetResourceController
} from "../admission/integration-target-resource.js"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryRuntimeAdmissionController
} from "./delivery-runtime-admission.js"
import type { CurrentSignal, DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import type { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  makeDeliveryRuntimeObservationController,
  DeliveryRuntimeObservationPublication,
  type DeliveryRuntimeObservationController,
  type DeliveryRuntimeObservationState
} from "./delivery-runtime-observation.js"

export interface DeliveryRuntimeResourcesService {
  readonly integrationTargets: IntegrationTargetResourceController
  readonly makeAdmissionController: (
    initial: DeliveryTaskWorkAdmissionBasis
  ) => Effect.Effect<DeliveryRuntimeAdmissionController, never, PlannedAttemptProtocolController>
  /** A passive current-first view; only the delivery runtime retains its paired mutation capability. */
  readonly runtimeObservation: CurrentSignal<DeliveryRuntimeObservationState>
}

/** The one process-local resource owner shared by relation reconciliation and runtime admission. */
export class DeliveryRuntimeResources extends Context.Service<
  DeliveryRuntimeResources,
  DeliveryRuntimeResourcesService
>()("@dalph/DeliveryRuntimeResources") {}

export const deliveryRuntimeResourcesOf = (
  integrationTargets: IntegrationTargetResourceController,
  observation: DeliveryRuntimeObservationController
): DeliveryRuntimeResourcesService => {
  return {
    integrationTargets,
    makeAdmissionController: (initial) => makeDeliveryRuntimeAdmissionController(initial, integrationTargets),
    runtimeObservation: observation.signal
  }
}

export interface DeliveryRuntimeResourceCapabilities {
  readonly observation: DeliveryRuntimeObservationController
  readonly resources: DeliveryRuntimeResourcesService
}

/** One inseparable process-local read/write resource pair shared by every ordinary activation. */
export class DeliveryRuntimeResourceCapabilityPair extends Context.Service<
  DeliveryRuntimeResourceCapabilityPair,
  DeliveryRuntimeResourceCapabilities
>()("@dalph/DeliveryRuntimeResourceCapabilityPair") {}

/** Constructs the read-only runtime resources and their separately typed publication capability together. */
export const deliveryRuntimeResourceCapabilitiesOf = Effect.fn("DeliveryRuntimeResources.makeCapabilities")(function* (
  integrationTargets: IntegrationTargetResourceController
) {
  const observation = yield* makeDeliveryRuntimeObservationController()
  return { observation, resources: deliveryRuntimeResourcesOf(integrationTargets, observation) }
})

export const deliveryRuntimeResourceCapabilitiesLayer = ({
  observation,
  resources
}: DeliveryRuntimeResourceCapabilities) =>
  Layer.mergeAll(
    Layer.succeed(DeliveryRuntimeResources, DeliveryRuntimeResources.of(resources)),
    Layer.succeed(DeliveryRuntimeObservationPublication, DeliveryRuntimeObservationPublication.of(observation)),
    Layer.succeed(
      DeliveryRuntimeResourceCapabilityPair,
      DeliveryRuntimeResourceCapabilityPair.of({ observation, resources })
    )
  )

export const deliveryRuntimeResourcesLayer = Layer.effectContext(
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const { observation, resources } = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets)
    yield* Effect.addFinalizer(() => observation.close)
    return Context.empty().pipe(
      Context.add(DeliveryRuntimeResources, DeliveryRuntimeResources.of(resources)),
      Context.add(DeliveryRuntimeObservationPublication, DeliveryRuntimeObservationPublication.of(observation)),
      Context.add(
        DeliveryRuntimeResourceCapabilityPair,
        DeliveryRuntimeResourceCapabilityPair.of({ observation, resources })
      )
    )
  })
)
