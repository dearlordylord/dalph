import type { IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"

/** The actor-visible integration-family section whose current result must remain indivisible during Exit. */
export type IntegrationExitBoundaryFamily =
  | "IntegrationCandidateConstruction"
  | "IntegratorPreparation"
  | "TargetPromotion"
  | "TargetVerificationAndEvidence"

/** Classifies only #207's boundary families; later integration-finality and cleanup actions keep their own protocols. */
export const integrationExitBoundaryFamilyFor = (
  transition: Pick<IdentityFreeWorkflowTransition, "_tag">
): IntegrationExitBoundaryFamily | null => {
  if (transition._tag === "ContinueStartedIntegrationCandidate") return "IntegrationCandidateConstruction"
  if (transition._tag === "RunIntegrator") return "IntegratorPreparation"
  if (transition._tag === "RunTargetPromotion") return "TargetPromotion"
  if (transition._tag === "RunTargetVerification") return "TargetVerificationAndEvidence"
  return null
}
