import { Schema } from "effect"
import { PlannedTaskAttempt } from "./domain.js"

/** Compares every immutable resource and identity captured by two planned task attempts. */
export const plannedTaskAttemptEquivalence = Schema.toEquivalence(PlannedTaskAttempt)

export const samePlannedTaskAttempt = plannedTaskAttemptEquivalence
