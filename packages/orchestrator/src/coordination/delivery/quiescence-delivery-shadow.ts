import type { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryProjectionEvidence } from "../frontier/delivery-projection-evidence.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-relation.js"
import { trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { evaluateDeliveryRelation, ticketDeliveryEvidenceOf } from "./delivery-shadow.js"
import { recordDeliveryShadowComparison } from "./delivery-shadow-diagnostics.js"
import { TrackerGraphState, type TicketDeliveryEvidence } from "./relations.js"

export interface QuiescenceDeliveryShadowInput {
  readonly readAccepted: Effect.Effect<{ readonly appliedPosition: JournalPosition } | null, unknown>
  readonly readEvidence: Effect.Effect<DeliveryProjectionEvidence, unknown>
  readonly readFrame: Effect.Effect<CurrentDeliveryFrame, unknown>
  readonly runId: RunId
  readonly target: TrackerTarget
}

/** Represents the old scheduler's final graph reread in the same flat relation before cutover. */
export const observeQuiescenceDeliveryShadow = (input: QuiescenceDeliveryShadowInput) =>
  Effect.gen(function* () {
    const acceptedBefore = yield* input.readAccepted
    const frame = yield* input.readFrame
    const evidence = yield* input.readEvidence
    const acceptedAfter = yield* input.readAccepted
    if (
      acceptedBefore === null ||
      acceptedAfter === null ||
      acceptedBefore.appliedPosition !== acceptedAfter.appliedPosition ||
      frame._tag !== "JournaledCurrentDeliveryFrame" ||
      frame.acceptedAt !== acceptedAfter.appliedPosition ||
      evidence._tag !== "AvailableDeliveryProjectionEvidence" ||
      evidence.acceptedAt !== acceptedAfter.appliedPosition
    ) {
      return
    }
    const proposal = trackerGraphReadProposalOf({
      acceptedAt: acceptedAfter.appliedPosition,
      purpose: "QuiescenceProbe",
      runId: input.runId,
      target: input.target
    })
    const exactEvidence = [
      ...ticketDeliveryEvidenceOf(frame, evidence.facts),
      ...evidence.integrationWaits.map((wait): TicketDeliveryEvidence => ({ _tag: "IntegrationWait", wait }))
    ]
    const { proposalFrontier } = yield* evaluateDeliveryRelation({
      exactEvidence,
      graph: TrackerGraphState.cases.GraphEstablished.make({ snapshot: frame.currentGraph }),
      policy: frame.runControlPolicy,
      proposalContributions: { deliverySettlement: [], issues: [], selectedTransitionKeys: [], ticketDelivery: [] },
      trackerGraphProposals: [proposal]
    })
    yield* recordDeliveryShadowComparison({
      _tag: "ComparedQuiescenceDeliveryProposal",
      acceptedAt: acceptedAfter.appliedPosition,
      proposalFrontier
    })
  }).pipe(Effect.ignoreCause)
