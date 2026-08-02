import type { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { deriveIntegrationAdmission } from "../../workflow/protocols/integration-admission/protocol.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "../activation/selected-transition.js"
import type { DeliveryProjectionEvidence } from "../frontier/delivery-projection-evidence.js"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-relation.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { acceptedOperationIdsOf, evaluateDeliveryRelation, symmetricDifference } from "./delivery-shadow.js"
import { recordDeliveryShadowComparison } from "./delivery-shadow-diagnostics.js"
import { journaledIntegrationEvidenceOf } from "./delivery-shadow-evidence.js"
import { TrackerGraphState, type TicketDeliveryEvidence } from "./relations.js"

export interface BoundaryDeliveryShadowInput {
  readonly acceptedBefore: JournalPosition | undefined
  readonly evidence: DeliveryProjectionEvidence
  readonly policy: CurrentDeliveryFrame["runControlPolicy"]
  readonly readAccepted: Effect.Effect<
    { readonly appliedPosition: JournalPosition; readonly records: ReadonlyArray<JournalRecord> } | null,
    unknown
  >
  readonly requiresAcceptedEpoch: boolean
  readonly runId: RunId
  readonly transitions: ReadonlyArray<RunnableFrontierTransition>
}

type AcceptedBoundaryState = Effect.Success<BoundaryDeliveryShadowInput["readAccepted"]>

const boundaryEpochMatches = (input: BoundaryDeliveryShadowInput, accepted: AcceptedBoundaryState): boolean => {
  if (!input.requiresAcceptedEpoch) return true
  if (input.acceptedBefore === undefined) return false
  if (accepted === null) return false
  if (accepted.appliedPosition !== input.acceptedBefore) return false
  return (
    input.evidence._tag === "AvailableDeliveryProjectionEvidence" &&
    input.evidence.acceptedAt === accepted.appliedPosition
  )
}

const acceptedBoundarySnapshot = (
  accepted: AcceptedBoundaryState
): { readonly acceptedAt: JournalPosition | null; readonly records: ReadonlyArray<JournalRecord> } =>
  accepted === null
    ? { acceptedAt: null, records: [] }
    : { acceptedAt: accepted.appliedPosition, records: accepted.records }

/** Runs recovery-boundary proposals through the literal relation while the old scheduler remains authoritative. */
export const observeBoundaryDeliveryShadow = (input: BoundaryDeliveryShadowInput) => {
  return Effect.gen(function* () {
    const accepted = yield* input.readAccepted
    if (input.evidence._tag !== "AvailableDeliveryProjectionEvidence") return
    if (!boundaryEpochMatches(input, accepted)) return
    const { acceptedAt, records } = acceptedBoundarySnapshot(accepted)
    const proposalContributions = deliveryProposalsOf({
      acceptedAt,
      acceptedOperationIds: acceptedOperationIdsOf(records),
      fresh: [],
      integrationResponsibilities: deriveIntegrationAdmission(records).responsibilities,
      responsibilities: input.evidence.facts.map(({ responsibility }) => responsibility),
      runId: input.runId,
      transitions: input.transitions
    })
    const exactEvidence = [
      ...input.evidence.facts.map((facts): TicketDeliveryEvidence => ({ _tag: "ResponsibilityFacts", facts })),
      ...input.evidence.integrationWaits.map((wait): TicketDeliveryEvidence => ({ _tag: "IntegrationWait", wait })),
      ...journaledIntegrationEvidenceOf(records)
    ]
    const { proposalFrontier } = yield* evaluateDeliveryRelation({
      exactEvidence,
      graph: TrackerGraphState.cases.GraphNotEstablished.make({}),
      policy: input.policy,
      proposalContributions
    })
    const legacyKeys = new Set(
      input.transitions.map((transition) =>
        selectedTransitionKey(makeSelectedTransitionIdentity(input.runId, transition))
      )
    )
    const proposedKeys = new Set(
      proposalFrontier._tag === "DeliveryProposalsAvailable" ? proposalContributions.selectedTransitionKeys : []
    )
    yield* recordDeliveryShadowComparison({
      _tag: "ComparedBoundaryDeliveryProposals" as const,
      acceptedAt,
      proposalFrontier,
      proposalPresenceDifferences: symmetricDifference(legacyKeys, proposedKeys)
    })
  }).pipe(Effect.ignoreCause)
}
