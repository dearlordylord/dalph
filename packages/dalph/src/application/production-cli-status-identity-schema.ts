import { Schema } from "effect"
import type { DeliveryStatusWakeCondition } from "@dalph/orchestrator"

/** Stable reference to one exact obligation; this descriptive identity grants no workflow authority. */
export const ObligationReference = Schema.NonEmptyString.pipe(Schema.brand("DeliveryStatusObligationReference"))

/** Exhaustive tracker wake vocabulary that can occur on a public tracker-fact wait. */
const publicTrackerWakeConditions = [
  "BoundaryRereadSucceeded",
  "ExplicitAppliedTaskClaimReacquisitionDirection",
  "TaskClaimFactsObserved",
  "TaskTrackerFactsObserved"
] as const satisfies ReadonlyArray<DeliveryStatusWakeCondition>
export const PublicTrackerWakeCondition = Schema.Literals(publicTrackerWakeConditions)
