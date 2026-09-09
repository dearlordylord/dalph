import type { OperationId } from "../../src/workflow/identity.js"
import type { DeliveryActionProposal } from "../../src/coordination/delivery/delivery-action-proposal.js"
import {
  DeliveryRuntimeLiveOwnerSnapshot,
  issueTicketProposalAdmissionAuthorityForTest,
  type DeliveryRuntimeActionIntent,
  type DeliveryRuntimeLiveOwnerSnapshot as DeliveryRuntimeLiveOwnerSnapshotType
} from "../../src/coordination/delivery/delivery-runtime-observation.js"

type TicketOwnerStage =
  | { readonly _tag: "AdmittedDeliveryAction" }
  | {
      readonly _tag: "MaterializedDeliveryAction"
      readonly intent: DeliveryRuntimeActionIntent
      readonly operationId: OperationId
    }
  | { readonly _tag: "SettledBeforeMaterialization" }
  | {
      readonly _tag: "SettledMaterializedDeliveryAction"
      readonly intent: DeliveryRuntimeActionIntent
      readonly operationId: OperationId
    }

/** Issues a real passive witness without granting an executor or admission resource to projection tests. */
export const ticketOwnerSnapshotForTest = (
  proposal: DeliveryActionProposal,
  stage: TicketOwnerStage = { _tag: "AdmittedDeliveryAction" }
): DeliveryRuntimeLiveOwnerSnapshotType => {
  const admissionAuthority = issueTicketProposalAdmissionAuthorityForTest(proposal)
  if (stage._tag === "AdmittedDeliveryAction") {
    return DeliveryRuntimeLiveOwnerSnapshot.AdmittedDeliveryAction({ admissionAuthority, proposal })
  }
  if (stage._tag === "SettledBeforeMaterialization") {
    return DeliveryRuntimeLiveOwnerSnapshot.SettledBeforeMaterialization({ admissionAuthority, proposal })
  }
  return stage._tag === "MaterializedDeliveryAction"
    ? DeliveryRuntimeLiveOwnerSnapshot.MaterializedDeliveryAction({
        admissionAuthority,
        intent: stage.intent,
        operationId: stage.operationId,
        proposal
      })
    : DeliveryRuntimeLiveOwnerSnapshot.SettledMaterializedDeliveryAction({
        admissionAuthority,
        intent: stage.intent,
        operationId: stage.operationId,
        proposal
      })
}
