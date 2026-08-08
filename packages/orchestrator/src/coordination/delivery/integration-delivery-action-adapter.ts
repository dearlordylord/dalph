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
import { TargetVerificationBoundaryUnavailable } from "./target-verification-boundary.js"
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

const executeTargetVerification = Effect.fn("DeliveryAction.runTargetVerification")(function* (
  action: IdentityFreeAction,
  transition: RunTargetVerification,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const boundary = Context.getOption(context, TargetVerificationBoundary)
  /* v8 ignore next -- @preserve A RunTargetVerification proposal exists only when coherent startup input installed the wrapper and store together. */
  if (Option.isNone(boundary)) return yield* new TargetVerificationBoundaryUnavailable({ boundary: "PublicWrapper" })
  const evidence = Context.getOption(context, EvidenceStore)
  /* v8 ignore next -- @preserve Coherent target-verification startup input cannot install the wrapper without its evidence store. */
  if (Option.isNone(evidence)) return yield* new TargetVerificationBoundaryUnavailable({ boundary: "EvidenceStore" })
  yield* lease.integrationTargets.withPermit(
    transition.responsibility,
    runTargetVerification(transition.candidate, transition.plan).pipe(
      Effect.provideService(TargetVerificationBoundary, boundary.value),
      Effect.provideService(EvidenceStore, evidence.value)
    )
  )
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
  return yield* continueIntegrationCandidate(action, transition, lease)
})
