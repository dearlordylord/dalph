import { Data } from "effect"
import {
  deliveryStatusOf,
  DeliveryStatusProjectionConflict,
  DeliveryStatusRunIdentityUnavailable,
  DeliveryStatusRunMismatch,
  type CurrentDeliveryStatus,
  type DeliveryRuntimeReadyObservation,
  type DeliveryStatusProjectionError,
  type DeliveryStatusSubject
} from "@dalph/orchestrator"

/** Explicit absence before the first observation, or one passive canonical read at its exact coherent runtime observation; never workflow authority. */
export type AuthoredDeliveryStatusRead = Data.TaggedEnum<{
  Unobserved: Record<never, never>
  Status: { readonly status: CurrentDeliveryStatus }
  ProjectionFailed: { readonly error: DeliveryStatusProjectionError }
}>
export const AuthoredDeliveryStatusRead = Data.taggedEnum<AuthoredDeliveryStatusRead>()

/** Retains the canonical value or exact typed failure without reconstructing a runtime observation. */
export const authoredDeliveryStatusReadOf = (
  subject: DeliveryStatusSubject,
  observation: DeliveryRuntimeReadyObservation
): AuthoredDeliveryStatusRead => {
  const projected = deliveryStatusOf(subject, observation)
  return projected instanceof DeliveryStatusProjectionConflict ||
    projected instanceof DeliveryStatusRunIdentityUnavailable ||
    projected instanceof DeliveryStatusRunMismatch
    ? AuthoredDeliveryStatusRead.ProjectionFailed({ error: projected })
    : AuthoredDeliveryStatusRead.Status({ status: projected })
}
