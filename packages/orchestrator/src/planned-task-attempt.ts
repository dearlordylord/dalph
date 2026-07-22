import { Schema } from "effect"
import { PlannedTaskAttempt } from "./domain.js"

/** Compares every immutable resource and identity captured by two planned task attempts. */
export const samePlannedTaskAttempt = (
  left: PlannedTaskAttempt,
  right: PlannedTaskAttempt
): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(PlannedTaskAttempt)(left))
    === JSON.stringify(Schema.encodeUnknownSync(PlannedTaskAttempt)(right))
