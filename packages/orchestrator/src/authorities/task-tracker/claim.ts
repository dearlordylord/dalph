import { Schema } from "effect"

/** Identifies the configured Dalph owner recorded in one task claim. */
export const ClaimOwner = Schema.NonEmptyString.pipe(Schema.brand("ClaimOwner"))
export type ClaimOwner = typeof ClaimOwner.Type

/** Authorizes changes to one exact task claim. */
export const ClaimToken = Schema.NonEmptyString.pipe(Schema.brand("ClaimToken"))
export type ClaimToken = typeof ClaimToken.Type
