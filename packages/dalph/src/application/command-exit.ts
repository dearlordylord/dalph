import { Schema } from "effect"

/** The public CLI has already emitted its result; only the process status remains. */
export const requestFailureExitStatus = 2
export const transportFailureExitStatus = 3

export class DalphCommandExit extends Schema.TaggedError<DalphCommandExit>()("DalphCommandExit", {
  status: Schema.Literals([requestFailureExitStatus, transportFailureExitStatus])
}) {}
