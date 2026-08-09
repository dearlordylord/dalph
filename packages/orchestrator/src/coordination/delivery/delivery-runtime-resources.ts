import { Context, Effect, Layer } from "effect"
import {
  makeIntegrationTargetResourceController,
  type IntegrationTargetResourceController
} from "../admission/integration-target-resource.js"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryRuntimeAdmissionController
} from "./delivery-runtime-admission.js"
import type { DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import type { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"

export interface DeliveryRuntimeResourcesService {
  readonly integrationTargets: IntegrationTargetResourceController
  readonly makeAdmissionController: (
    initial: DeliveryTaskWorkAdmissionBasis
  ) => Effect.Effect<DeliveryRuntimeAdmissionController, never, PlannedAttemptProtocolController>
}

/** The one process-local resource owner shared by relation reconciliation and runtime admission. */
export class DeliveryRuntimeResources extends Context.Service<
  DeliveryRuntimeResources,
  DeliveryRuntimeResourcesService
>()("@dalph/DeliveryRuntimeResources") {}

export const deliveryRuntimeResourcesOf = (
  integrationTargets: IntegrationTargetResourceController
): DeliveryRuntimeResourcesService => ({
  integrationTargets,
  makeAdmissionController: (initial) => makeDeliveryRuntimeAdmissionController(initial, integrationTargets)
})

export const deliveryRuntimeResourcesLayer = Layer.effect(
  DeliveryRuntimeResources,
  Effect.map(makeIntegrationTargetResourceController(), (integrationTargets) =>
    DeliveryRuntimeResources.of(deliveryRuntimeResourcesOf(integrationTargets))
  )
)
