import { Schema } from "effect"

/**
 * Process-local identity of an action that must not overlap itself. A recovered
 * observation keeps this identity when a newer causal predecessor changes its
 * proposal identity while the earlier boundary call or passive attachment is
 * still owned by this activation.
 */
export const LiveDeliveryActionKey = Schema.NonEmptyString.pipe(Schema.brand("LiveDeliveryActionKey"))
export type LiveDeliveryActionKey = typeof LiveDeliveryActionKey.Type

export const makeLiveDeliveryActionKey = (parts: ReadonlyArray<string | number>): LiveDeliveryActionKey =>
  LiveDeliveryActionKey.make(JSON.stringify(parts))
