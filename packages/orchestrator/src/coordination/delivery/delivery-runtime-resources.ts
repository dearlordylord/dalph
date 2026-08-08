import { Context, Effect, Layer } from "effect"
import {
  makeIntegrationTargetResourceController,
  type IntegrationTargetResourceController
} from "../admission/integration-target-resource.js"

export interface DeliveryRuntimeResourcesService {
  readonly integrationTargets: IntegrationTargetResourceController
}

/** The one process-local resource owner shared by relation reconciliation and runtime admission. */
export class DeliveryRuntimeResources extends Context.Service<
  DeliveryRuntimeResources,
  DeliveryRuntimeResourcesService
>()("@dalph/DeliveryRuntimeResources") {}

export const deliveryRuntimeResourcesLayer = Layer.effect(
  DeliveryRuntimeResources,
  Effect.map(makeIntegrationTargetResourceController(), (integrationTargets) =>
    DeliveryRuntimeResources.of({ integrationTargets })
  )
)
