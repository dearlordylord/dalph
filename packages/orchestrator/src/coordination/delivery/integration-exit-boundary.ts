import type { IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"

/** The actor-visible integration-family section whose current result must remain indivisible during Exit. */
export type IntegrationExitBoundaryFamily = "IntegratorPreparation" | "TargetPromotion"

/** Classifies #224's outer Integrator boundaries; every successor action needs admission after the Exit cutoff. */
export const integrationExitBoundaryFamilyFor = (
  transition: Pick<IdentityFreeWorkflowTransition, "_tag">
): IntegrationExitBoundaryFamily | null => {
  if (transition._tag === "RunIntegrator") return "IntegratorPreparation"
  if (transition._tag === "RunTargetPromotion" || transition._tag === "ReconcileTargetPromotionAttempt") {
    return "TargetPromotion"
  }
  return null
}
