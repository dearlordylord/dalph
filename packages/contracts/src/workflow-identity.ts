import { Schema } from "effect"

/** Identifies one durable Dalph coordination run, not a task or operation. */
export const RunId = Schema.NonEmptyString.pipe(Schema.brand("RunId"))
export type RunId = typeof RunId.Type
