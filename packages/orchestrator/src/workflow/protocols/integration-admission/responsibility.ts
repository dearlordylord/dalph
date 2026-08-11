import {
  evidenceReferenceEquals,
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

/** One accepted result is exact only when its commit and complete sealed-evidence reference agree. */
export const acceptedResultEquivalence = (left: AcceptedResult, right: AcceptedResult): boolean =>
  left.commit === right.commit && evidenceReferenceEquals(left.evidenceManifest, right.evidenceManifest)

/** One canonical equality rule binds queue, cutoff, history, and occurrence relationships. */
export const integrationResponsibilityEquivalence = (
  left: IntegrationResponsibilityFacts,
  right: IntegrationResponsibilityFacts
): boolean =>
  plannedTaskAttemptEquivalence(left.plannedAttempt, right.plannedAttempt) &&
  acceptedResultEquivalence(left.acceptedResult, right.acceptedResult) &&
  left.integrationTarget.repository === right.integrationTarget.repository &&
  left.integrationTarget.ref === right.integrationTarget.ref
