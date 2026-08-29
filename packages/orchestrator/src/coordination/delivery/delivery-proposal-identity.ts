import type { FreshIdentityDeliveryProposal, NewRecoveredWorkflowAction } from "./delivery-action-proposal.js"
import type { OperationId } from "../../workflow/identity.js"

type FreshOperationIdentity = Extract<
  FreshIdentityDeliveryProposal["actionIdentity"],
  { readonly _tag: "FreshOperationIdRequired" }
>

export const freshOperationIdentity = (): FreshOperationIdentity => ({
  _tag: "FreshOperationIdRequired",
  source: { _tag: "Allocate" }
})

export const recoveredIdentityFor = (
  action: NewRecoveredWorkflowAction,
  preselectedOperationId?: OperationId,
  preservePreselectedOperationId = false
): FreshOperationIdentity => {
  if (action._tag === "TaskClaimReacquisition") {
    return {
      _tag: "FreshOperationIdRequired",
      source: { _tag: "TaskClaimReacquisitionRequest", requestId: action.requestId }
    }
  }
  if (action._tag === "ReleaseExternallyCompletedTaskClaim") {
    return {
      _tag: "FreshOperationIdRequired",
      source: { _tag: "ExternalSuccessReleaseClaim", claimOperationId: action.operation.release.claim.operationId }
    }
  }
  if (
    preservePreselectedOperationId &&
    preselectedOperationId !== undefined &&
    (action._tag === "ReadTaskWorktree" || action._tag === "ReadTargetLineage")
  ) {
    return { _tag: "FreshOperationIdRequired", source: { _tag: "Preserve", operationId: preselectedOperationId } }
  }
  if (action._tag === "ReadTrackerGraph" && preselectedOperationId?.startsWith("active-refresh:")) {
    return { _tag: "FreshOperationIdRequired", source: { _tag: "Preserve", operationId: preselectedOperationId } }
  }
  return { _tag: "FreshOperationIdRequired", source: { _tag: "Allocate" } }
}
