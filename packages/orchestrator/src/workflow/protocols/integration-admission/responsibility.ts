import {
  plannedTaskAttemptEquivalence,
  type AcceptedResult,
  type IntegrationTarget,
  type PlannedTaskAttempt
} from "@dalph/contracts"

/** The exact immutable facts that identify one accepted-result integration responsibility. */
export interface IntegrationResponsibilityFacts {
  readonly acceptedResult: AcceptedResult
  readonly integrationTarget: IntegrationTarget
  readonly plannedAttempt: PlannedTaskAttempt
}

/** One canonical equality rule binds queue, cutoff, history, and occurrence relationships. */
export const integrationResponsibilityEquivalence = (
  left: IntegrationResponsibilityFacts,
  right: IntegrationResponsibilityFacts
): boolean =>
  plannedTaskAttemptEquivalence(left.plannedAttempt, right.plannedAttempt) &&
  left.acceptedResult.commit === right.acceptedResult.commit &&
  left.integrationTarget.repository === right.integrationTarget.repository &&
  left.integrationTarget.ref === right.integrationTarget.ref
