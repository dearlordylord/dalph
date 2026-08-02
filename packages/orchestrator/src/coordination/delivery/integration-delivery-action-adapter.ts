import { Context, Effect, Option } from "effect"
import {
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationCandidateAgent,
  IntegrationCandidateGit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { runIntegrationCandidateConstruction } from "../run/integration-candidate-runtime.js"
import { IntegrationCandidateBoundaryUnavailable } from "../run/integration-transition-runtime.js"
import { deliveryActionCompleted } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { IdentityFreeWorkflowTransition } from "./delivery-action-proposal.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type IntegrationTransition = Exclude<
  IdentityFreeWorkflowTransition,
  { readonly _tag: "ContinuePlannedAttemptExecutorWork" | "SuspendPlannedAttemptExecutorWork" }
>
type ContinueIntegrationCandidate = Extract<
  IntegrationTransition,
  { readonly _tag: "ContinueStartedIntegrationCandidate" }
>

const continueIntegrationCandidate = Effect.fn("DeliveryAction.continueIntegrationCandidate")(function* (
  action: IdentityFreeAction,
  transition: ContinueIntegrationCandidate,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const agent = Context.getOption(context, IntegrationCandidateAgent)
  if (Option.isNone(agent)) return yield* new IntegrationCandidateBoundaryUnavailable({ boundary: "Agent" })
  const git = Context.getOption(context, IntegrationCandidateGit)
  if (Option.isNone(git)) return yield* new IntegrationCandidateBoundaryUnavailable({ boundary: "Git" })
  const state = yield* runIntegrationCandidateConstruction(
    transition.responsibility,
    transition.lineage,
    transition.correctionLimit,
    transition.continuationLimit,
    lease.integrationTargets
  ).pipe(
    Effect.provideService(IntegrationCandidateAgent, agent.value),
    Effect.provideService(IntegrationCandidateGit, git.value)
  )
  const resourceDisposition =
    state._tag === "CandidateCorrectionLimitReached" || state._tag === "CandidateContinuationLimitReached"
      ? ("Release" as const)
      : ("Retain" as const)
  return { _tag: "IntegrationCandidateAdvanced" as const, proposalId: action.proposal.id, resourceDisposition, state }
})

export const executeIntegrationAction = Effect.fn("DeliveryAction.executeIntegration")(function* (
  action: IdentityFreeAction,
  transition: IntegrationTransition,
  lease: DeliveryActionExecutionLease
) {
  if (transition._tag === "QueueAcceptedResultIntegrationResponsibility") {
    yield* queueAcceptedResultIntegrationResponsibility(
      transition.accepted.plannedAttempt,
      transition.accepted.acceptedResult,
      transition.integrationTarget
    )
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "StartQueuedIntegration") {
    yield* startQueuedIntegration(transition.responsibility)
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "AcquireStartedIntegrationTarget") return deliveryActionCompleted(action.proposal.id)
  if (transition._tag === "ReleaseStartedIntegrationTarget") {
    yield* lease.integrationTargets.release(transition.responsibility)
    return deliveryActionCompleted(action.proposal.id)
  }
  return yield* continueIntegrationCandidate(action, transition, lease)
})
