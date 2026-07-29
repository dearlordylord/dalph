import { Schema } from "effect"

/** Identifies one exact user control command within a run's workflow journal. */
export const ControlCommandId = Schema.NonEmptyString.pipe(Schema.brand("ControlCommandId"))
export type ControlCommandId = typeof ControlCommandId.Type

/** Identifies the Dalph user proven by an authenticated transport boundary. */
export const AuthenticatedOperatorIdentity = Schema.NonEmptyString.pipe(Schema.brand("AuthenticatedOperatorIdentity"))
export type AuthenticatedOperatorIdentity = typeof AuthenticatedOperatorIdentity.Type
