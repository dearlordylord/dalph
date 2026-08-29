import { Effect } from "effect"
import {
  OperationIdAllocator,
  PlannedTaskAttemptPlanner,
  PlannedTaskAttemptPlanRequest
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { OperationId } from "../../workflow/identity.js"
import type {
  AcceptedIdentityDeliveryProposal,
  DeliveryActionProposal,
  FreshIdentityDeliveryProposal,
  IdentityFreeDeliveryProposal
} from "./delivery-action-proposal.js"
import { acceptedWorkflowTransitionOperationId } from "./delivery-action-proposal.js"
import type { MaterializedDeliveryAction } from "./delivery-action-executor.js"

type FreshOperationProposal = Extract<
  FreshIdentityDeliveryProposal,
  { readonly actionIdentity: { readonly _tag: "FreshOperationIdRequired" } }
>

const isAcceptedOperationProposal = (proposal: DeliveryActionProposal): proposal is AcceptedIdentityDeliveryProposal =>
  proposal.actionIdentity._tag === "ExistingOperationId"

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const isFreshOperationProposal = (proposal: DeliveryActionProposal): proposal is FreshOperationProposal =>
  proposal.actionIdentity._tag === "FreshOperationIdRequired"

const operationIdFor = Effect.fn("DeliveryRuntime.materializeOperationId")(function* (
  proposal: FreshOperationProposal
) {
  const source = proposal.actionIdentity.source
  if (source._tag === "Preserve") return source.operationId
  if (source._tag === "TaskClaimReacquisitionRequest") {
    return taskClaimReacquisitionOperationId(source.requestId)
  }
  if (source._tag === "ExternalSuccessReleaseClaim") {
    return OperationId.make(`external-success-release:${source.claimOperationId}`)
  }
  return yield* (yield* OperationIdAllocator).allocate()
})

/** Allocates a genuinely fresh identity only after the proposal has been admitted. */
export const materializeDeliveryAction = Effect.fn("DeliveryRuntime.materializeAction")(function* (
  proposal: DeliveryActionProposal
) {
  if (isAcceptedOperationProposal(proposal)) return { _tag: "AcceptedOperationAction" as const, proposal }
  if (isIdentityFreeProposal(proposal)) return { _tag: "IdentityFreeAction" as const, proposal }
  if (isFreshOperationProposal(proposal)) {
    return { _tag: "FreshOperationAction" as const, operationId: yield* operationIdFor(proposal), proposal }
  }
  const allocator = yield* OperationIdAllocator
  const planner = yield* PlannedTaskAttemptPlanner
  return {
    _tag: "FreshAttemptAction" as const,
    operationId: yield* allocator.allocate(),
    plannedAttempt: yield* planner.plan(
      PlannedTaskAttemptPlanRequest.Fresh({ specification: proposal.route.step.specification })
    ),
    proposal
  }
})

export const materializedOperationId = (action: MaterializedDeliveryAction): OperationId | null =>
  action._tag === "AcceptedOperationAction"
    ? acceptedWorkflowTransitionOperationId(action.proposal.route.transition)
    : action._tag === "FreshOperationAction" || action._tag === "FreshAttemptAction"
      ? action.operationId
      : null
