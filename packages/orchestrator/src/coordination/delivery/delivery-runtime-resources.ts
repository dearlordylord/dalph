import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Context, Effect, Layer, Option, SynchronizedRef } from "effect"
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
import type { ApplicationExitAdmissionService } from "../application-exit/lifecycle.js"

export interface DeliveryRuntimeResourcesService {
  readonly applicationExitAdmission: ApplicationExitAdmissionService
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
  observation: DeliveryRuntimeObservationController,
  applicationExitAdmission: ApplicationExitAdmissionService,
  admissionController: SynchronizedRef.SynchronizedRef<Option.Option<DeliveryRuntimeAdmissionController>>
): DeliveryRuntimeResourcesService => {
  return {
    applicationExitAdmission,
    integrationTargets,
    makeAdmissionController: (initial) =>
      SynchronizedRef.modifyEffect(admissionController, (current) =>
        Option.match(current, {
          onNone: () =>
            makeDeliveryRuntimeAdmissionController(initial, integrationTargets, applicationExitAdmission).pipe(
              Effect.map((created) => [created, Option.some(created)] as const)
            ),
          onSome: (existing) => existing.synchronize(initial).pipe(Effect.as([existing, current] as const))
        })
      ),
    runtimeObservation: observation.signal
  }
}

// eslint-disable-next-line functional/no-mixed-types -- The inseparable pair carries read-only/publication resources and one internal release operation.
export interface DeliveryRuntimeResourceCapabilities {
  readonly observation: DeliveryRuntimeObservationController
  /** Internal process owner access; passive executor attachments receive only their publication sink. */
  readonly releasePlannedAttemptPosition: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<"Released" | "AlreadyAbsent">
  readonly resources: DeliveryRuntimeResourcesService
}

/** One inseparable process-local read/write resource pair shared by every ordinary activation. */
export class DeliveryRuntimeResourceCapabilityPair extends Context.Service<
  DeliveryRuntimeResourceCapabilityPair,
  DeliveryRuntimeResourceCapabilities
>()("@dalph/DeliveryRuntimeResourceCapabilityPair") {}

/** Constructs the read-only runtime resources and their separately typed publication capability together. */
export const deliveryRuntimeResourceCapabilitiesOf = Effect.fn("DeliveryRuntimeResources.makeCapabilities")(function* (
  integrationTargets: IntegrationTargetResourceController,
  applicationExitAdmission: ApplicationExitAdmissionService
) {
  const observation = yield* makeDeliveryRuntimeObservationController()
  const admissionController = yield* SynchronizedRef.make<Option.Option<DeliveryRuntimeAdmissionController>>(
    Option.none()
  )
  return {
    observation,
    releasePlannedAttemptPosition: (correlation: PlannedAttemptExecutorCorrelation) =>
      SynchronizedRef.get(admissionController).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed("AlreadyAbsent" as const),
            onSome: (controller) => controller.releasePlannedAttemptPosition(correlation)
          })
        )
      ),
    resources: deliveryRuntimeResourcesOf(
      integrationTargets,
      observation,
      applicationExitAdmission,
      admissionController
    )
  }
})

export const deliveryRuntimeResourceCapabilitiesLayer = (capabilities: DeliveryRuntimeResourceCapabilities) =>
  Layer.mergeAll(
    Layer.succeed(DeliveryRuntimeResources, DeliveryRuntimeResources.of(capabilities.resources)),
    Layer.succeed(
      DeliveryRuntimeObservationPublication,
      DeliveryRuntimeObservationPublication.of(capabilities.observation)
    ),
    Layer.succeed(DeliveryRuntimeResourceCapabilityPair, DeliveryRuntimeResourceCapabilityPair.of(capabilities))
  )

export const deliveryRuntimeResourcesLayer = (applicationExitAdmission: ApplicationExitAdmissionService) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(integrationTargets, applicationExitAdmission)
      yield* Effect.addFinalizer(() => capabilities.observation.close)
      return Context.empty().pipe(
        Context.add(DeliveryRuntimeResources, DeliveryRuntimeResources.of(capabilities.resources)),
        Context.add(
          DeliveryRuntimeObservationPublication,
          DeliveryRuntimeObservationPublication.of(capabilities.observation)
        ),
        Context.add(DeliveryRuntimeResourceCapabilityPair, DeliveryRuntimeResourceCapabilityPair.of(capabilities))
      )
    })
  )
