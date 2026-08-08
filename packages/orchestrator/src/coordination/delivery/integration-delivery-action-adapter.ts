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
import { IntegrationCandidateBoundaryUnavailable } from "./integration-candidate-boundary.js"
import { deliveryActionCompleted } from "./delivery-action-adapter-common.js"
import { EvidenceStore } from "../../workflow/protocols/target-verification/evidence-store.js"
import { TargetVerificationBoundary } from "../../workflow/protocols/target-verification/events.js"
import { runTargetVerification } from "../../workflow/protocols/target-verification/protocol.js"
import { TargetVerificationRuntime } from "../../workflow/protocols/target-verification/runtime.js"
import { TargetVerificationRuntimeUnavailable } from "./target-verification-boundary.js"
import { TargetPromotionGit } from "../../workflow/protocols/target-promotion/events.js"
import { runTargetPromotion } from "../../workflow/protocols/target-promotion/protocol.js"
import { TargetPromotionRuntime } from "../../workflow/protocols/target-promotion/runtime.js"
import { TargetPromotionRuntimeUnavailable } from "./target-promotion-boundary.js"
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
type RunTargetVerification = Extract<IntegrationTransition, { readonly _tag: "RunTargetVerification" }>
type RunTargetPromotion = Extract<IntegrationTransition, { readonly _tag: "RunTargetPromotion" }>

const executeTargetPromotion = Effect.fn("DeliveryAction.runTargetPromotion")(function* (
  action: IdentityFreeAction,
  transition: RunTargetPromotion,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const runtime = Context.getOption(context, TargetPromotionRuntime)
  if (Option.isNone(runtime)) return yield* new TargetPromotionRuntimeUnavailable()
  yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      runTargetPromotion(transition.candidate, transition.verification).pipe(
        Effect.provideService(TargetPromotionGit, runtime.value.git)
      )
    )
    .pipe(Effect.ensuring(lease.integrationTargets.release(transition.responsibility)))
  return deliveryActionCompleted(action.proposal.id)
})

const executeTargetVerification = Effect.fn("DeliveryAction.runTargetVerification")(function* (
  action: IdentityFreeAction,
  transition: RunTargetVerification,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const runtime = Context.getOption(context, TargetVerificationRuntime)
  if (Option.isNone(runtime)) return yield* new TargetVerificationRuntimeUnavailable()
  yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      runTargetVerification(transition.candidate, transition.plan).pipe(
        Effect.provideService(TargetVerificationBoundary, runtime.value.boundary),
        Effect.provideService(EvidenceStore, runtime.value.evidenceStore)
      )
    )
    .pipe(Effect.ensuring(lease.integrationTargets.release(transition.responsibility)))
  return deliveryActionCompleted(action.proposal.id)
})

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
    yield* lease.acceptIntegrationTargetOwnership
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "AcquireStartedIntegrationTarget") {
    yield* lease.acceptIntegrationTargetOwnership
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "ReleaseStartedIntegrationTarget") {
    yield* lease.integrationTargets.release(transition.responsibility)
    return deliveryActionCompleted(action.proposal.id)
  }
  if (transition._tag === "RunTargetVerification") return yield* executeTargetVerification(action, transition, lease)
  if (transition._tag === "RunTargetPromotion") return yield* executeTargetPromotion(action, transition, lease)
  return yield* continueIntegrationCandidate(action, transition, lease)
})
