import { Schema } from "effect"
import {
  evidenceReferenceEquals,
  plannedTaskAttemptEquivalence,
  AcceptedResult,
  IntegrationTarget,
  PlannedTaskAttempt
} from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"

/** Exact accepted-result responsibility after the Integrator boundary began. */
export const StartedIntegrationResponsibility = Schema.TaggedStruct("StartedIntegrationResponsibility", {
  acceptedResult: AcceptedResult,
  integrationTarget: IntegrationTarget,
  plannedAttempt: PlannedTaskAttempt,
  queuedAt: JournalPosition,
  startedAt: JournalPosition
})
export type StartedIntegrationResponsibility = typeof StartedIntegrationResponsibility.Type

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
