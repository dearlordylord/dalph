import type { DeliveryStatusEntry } from "@dalph/orchestrator"
import { Schema } from "effect"
import {
  DeliveryStatusEntryIdentity,
  deliveryStatusObligationReference,
  statusEntryIdentity
} from "@dalph/orchestrator"
import { ObligationReference, PublicTrackerWakeCondition } from "./production-cli-status-identity-schema.js"
import type { PublicDeliveryStatusEntry } from "./production-cli-status-schema.js"

type ExactWorkflowObligation = NonNullable<
  Extract<DeliveryStatusEntry, { readonly _tag: "TrackerFactWait" }>["responsibility"]
>
const obligationReference = (responsibility: ExactWorkflowObligation | null) =>
  responsibility === null ? null : ObligationReference.make(deliveryStatusObligationReference(responsibility))

const commonOf = (entry: DeliveryStatusEntry) => ({
  entryIdentity: DeliveryStatusEntryIdentity.make(statusEntryIdentity(entry)),
  subject: entry.subject
})

/** Exhaustive one-way identity projection; executable payload and private authority never cross this boundary. */
export const publicDeliveryStatusEntryOf = (entry: DeliveryStatusEntry): PublicDeliveryStatusEntry => {
  const common = commonOf(entry)
  switch (entry._tag) {
    case "DependencyWait":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        taskId: entry.taskId,
        prerequisiteTaskIds: entry.prerequisiteTaskIds,
        standingKind: entry.standing._tag,
        obligationReference:
          entry.standing._tag === "ResponsibilitySituation"
            ? obligationReference({
                _tag: "WorkflowResponsibility",
                responsibility: entry.standing.facts.responsibility
              })
            : null
      }
    case "TrackerFactWait":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        obligationReference: obligationReference(entry.responsibility),
        fact: { _tag: entry.fact._tag },
        standingKind: entry.standing._tag,
        wakeCondition: Schema.decodeUnknownSync(PublicTrackerWakeCondition)(entry.wakeCondition)
      }
    case "TaskWorkCapacityWait":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        taskId: entry.taskId,
        scope: entry.scope,
        rank: entry.placement.rank,
        holders: entry.holders
      }
    case "ProposedDeliveryAction":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        proposalId: entry.proposal.id,
        order: entry.proposal.order,
        waitsForLiveOperationId: entry.proposal.waitsForLiveOperationId,
        actionIdentity: entry.proposal.actionIdentity
      }
    case "LiveDeliveryAction": {
      const operationId =
        entry.owner._tag === "MaterializedDeliveryAction" || entry.owner._tag === "SettledMaterializedDeliveryAction"
          ? entry.owner.operationId
          : null
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        proposalId: entry.owner.proposal.id,
        lifecycle: entry.owner._tag,
        operationId
      }
    }
    case "AcceptedFactPublicationWait":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        proposalId: entry.owner.proposal.id,
        lifecycle: entry.owner._tag,
        operationId: entry.owner._tag === "SettledMaterializedDeliveryAction" ? entry.owner.operationId : null,
        acceptedAt: entry.acceptedAt
      }
    case "IntegrationTargetWait":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        plannedAttempt: entry.plannedAttempt,
        integrationTarget: entry.integrationTarget,
        obligationReference: ObligationReference.make(deliveryStatusObligationReference(entry.responsibility)),
        queuedAt: entry.responsibility.responsibility.queuedAt
      }
    case "EvidenceUnavailable": {
      const evidence =
        entry.evidence._tag === "ProposalDerivationIssue"
          ? {
              _tag: "ProposalDerivationIssue" as const,
              issueKind: entry.evidence.issue._tag,
              taskId: entry.evidence.issue.taskId
            }
          : entry.evidence._tag === "ResponsibilityFacts"
            ? {
                _tag: "ResponsibilityFacts" as const,
                responsibilityReference: ObligationReference.make(
                  deliveryStatusObligationReference({
                    _tag: "WorkflowResponsibility",
                    responsibility: entry.evidence.facts.responsibility
                  })
                )
              }
            : { _tag: entry.evidence._tag, plannedAttempt: entry.evidence.wait.plannedAttempt }
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        obligationReference: obligationReference(entry.responsibility),
        evidence
      }
    }
    case "EvidenceConflict":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        obligationReference: obligationReference(entry.responsibility),
        evidenceIdentities: entry.evidenceIdentities
      }
    case "Settlement":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        taskId: entry.subject.taskId,
        settlement:
          entry.settlement._tag === "DeliverySettlement"
            ? { _tag: entry.settlement._tag, attemptId: entry.settlement.attemptId }
            : {
                _tag: entry.settlement._tag,
                claimDisposition: entry.settlement.claimDisposition,
                obligationReference: ObligationReference.make(
                  deliveryStatusObligationReference({
                    _tag: "WorkflowResponsibility",
                    responsibility: entry.settlement.responsibility
                  })
                )
              }
      }
    case "Relinquishment":
      return {
        ...common,
        _tag: entry._tag,
        classification: entry.classification,
        obligationReference: ObligationReference.make(deliveryStatusObligationReference(entry.responsibility)),
        supporting: entry.supporting,
        reason: entry.reason
      }
  }
}
