import type { PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import type { FrontierExplanation, RunnableFrontier } from "./frontier.js"

/** A region-local reason that accepted integration work cannot advance now. */
export type IntegrationDeliveryWait =
  | {
      readonly _tag: "IntegrationDependencyWait"
      readonly plannedAttempt: PlannedTaskAttempt
      readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
    }
  | { readonly _tag: "IntegrationConfigurationWait"; readonly plannedAttempt: PlannedTaskAttempt }
  | {
      readonly _tag: "IntegrationTaskClaimConstraint"
      readonly claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved"
      readonly plannedAttempt: PlannedTaskAttempt
    }
  | { readonly _tag: "IntegrationTrackerFactsWait"; readonly plannedAttempt: PlannedTaskAttempt }
  | { readonly _tag: "IntegrationTargetWait"; readonly plannedAttempt: PlannedTaskAttempt }
  | { readonly _tag: "TargetVerificationConfigurationWait"; readonly plannedAttempt: PlannedTaskAttempt }
  | { readonly _tag: "TargetPromotionConfigurationWait"; readonly plannedAttempt: PlannedTaskAttempt }

const integrationDeliveryWaitFrom = (explanation: FrontierExplanation): IntegrationDeliveryWait | undefined => {
  if (explanation._tag === "IntegrationDependencyWait") {
    return {
      _tag: explanation._tag,
      plannedAttempt: explanation.plannedAttempt,
      prerequisiteTaskIds: explanation.prerequisiteTaskIds
    }
  }
  if (explanation._tag === "IntegrationTaskClaimConstraint") {
    return { _tag: explanation._tag, claimState: explanation.claimState, plannedAttempt: explanation.plannedAttempt }
  }
  if (
    explanation._tag === "IntegrationConfigurationWait" ||
    explanation._tag === "IntegrationTrackerFactsWait" ||
    explanation._tag === "IntegrationTargetWait" ||
    explanation._tag === "TargetVerificationConfigurationWait" ||
    explanation._tag === "TargetPromotionConfigurationWait"
  ) {
    return { _tag: explanation._tag, plannedAttempt: explanation.plannedAttempt }
  }
  return undefined
}

/** Projects only integration waits from the lower integration relation, before scheduler merging. */
export const integrationDeliveryWaitsOf = (frontier: RunnableFrontier): ReadonlyArray<IntegrationDeliveryWait> =>
  frontier.explanations.flatMap((explanation) => {
    const wait = integrationDeliveryWaitFrom(explanation)
    return wait === undefined ? [] : [wait]
  })
