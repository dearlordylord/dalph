import { Schema } from "effect"

/** Stable reference to one exact obligation; this descriptive identity grants no workflow authority. */
export const ObligationReference = Schema.NonEmptyString.pipe(Schema.brand("DeliveryStatusObligationReference"))
