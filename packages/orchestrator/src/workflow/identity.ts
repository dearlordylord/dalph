import { Schema } from "effect"

/**
 * Causally binds one workflow operation's intent and observations. It is not a
 * task identity, attempt identity, journal position, or trace position.
 */
export const OperationId = Schema.NonEmptyString.pipe(Schema.brand("OperationId"))
export type OperationId = typeof OperationId.Type
