import type { FreshIdentityDeliveryProposal, NewRecoveredWorkflowAction } from "./delivery-action-proposal.js"

type FreshOperationIdentity = Extract<
  FreshIdentityDeliveryProposal["actionIdentity"],
  { readonly _tag: "FreshOperationIdRequired" }
>

export const freshOperationIdentity = (): FreshOperationIdentity => ({
  _tag: "FreshOperationIdRequired",
  source: { _tag: "Allocate" }
})

export const recoveredIdentityFor = (action: NewRecoveredWorkflowAction): FreshOperationIdentity =>
  action._tag === "ReadTrackerGraph" && action.operationIdSource._tag === "DeterministicOperationId"
    ? { _tag: "FreshOperationIdRequired", source: action.operationIdSource }
    : action._tag === "TaskClaimReacquisition"
      ? {
          _tag: "FreshOperationIdRequired",
          source: { _tag: "TaskClaimReacquisitionRequest", requestId: action.requestId }
        }
      : action._tag === "ReleaseExternallyCompletedTaskClaim"
        ? {
            _tag: "FreshOperationIdRequired",
            source: {
              _tag: "ExternalSuccessReleaseClaim",
              claimOperationId: action.operation.release.claim.operationId
            }
          }
        : { _tag: "FreshOperationIdRequired", source: { _tag: "Allocate" } }
