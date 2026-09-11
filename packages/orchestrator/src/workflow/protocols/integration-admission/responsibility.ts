import { Schema } from "effect"
import {
  evidenceReferenceEquals,
  plannedTaskAttemptEquivalence,
  AcceptedResult,
  IntegrationTarget,
  PlannedTaskAttempt,
  RunId
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

/**
 * Exact Run-local journal position that identifies one integration responsibility across concurrent Runs.
 * The integration target is a separately serialized resource, not part of this identity. The current Quint
 * delivery model is intentionally single-Run and uses globally distinct result ids, so this cross-Run process
 * collision is covered by executable controller and recovery/frontier tests rather than a model transition.
 */
export const IntegrationResponsibilityIdentity = Schema.Struct({ queuedAt: JournalPosition, runId: RunId }).pipe(
  Schema.brand("IntegrationResponsibilityIdentity")
)
export type IntegrationResponsibilityIdentity = typeof IntegrationResponsibilityIdentity.Type

export interface IntegrationResponsibilityIdentityFacts {
  readonly plannedAttempt: { readonly runId: RunId }
  readonly queuedAt: JournalPosition
}

export const integrationResponsibilityIdentity = (
  responsibility: IntegrationResponsibilityIdentityFacts
): IntegrationResponsibilityIdentity =>
  IntegrationResponsibilityIdentity.make({
    queuedAt: responsibility.queuedAt,
    runId: responsibility.plannedAttempt.runId
  })

export const integrationResponsibilityIdentityKey = (identity: IntegrationResponsibilityIdentity): string =>
  JSON.stringify([identity.runId, identity.queuedAt])

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
