import { Context, Effect, Schema } from "effect"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationCandidateAgent,
  IntegrationCandidateGit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { runIntegrationCandidateConstruction } from "./integration-candidate-runtime.js"

export class IntegrationCandidateBoundaryUnavailable extends Schema.TaggedErrorClass<IntegrationCandidateBoundaryUnavailable>()(
  "IntegrationCandidateBoundaryUnavailable",
  { boundary: Schema.Literals(["Agent", "Git"]) }
) {}

/** Executes only integration transitions and tells the shared runner whether it owned the tag. */
export const runIntegrationTransition = Effect.fn("RunRecoveryActivation.runIntegrationTransition")(function* (
  transition: RunnableFrontierTransition,
  integrationResources: IntegrationTargetResourceController
) {
  if (transition._tag === "QueueAcceptedResultIntegrationResponsibility") {
    yield* queueAcceptedResultIntegrationResponsibility(
      transition.accepted.plannedAttempt,
      transition.accepted.acceptedResult,
      transition.integrationTarget
    )
    return true
  }
  if (transition._tag === "StartQueuedIntegration") {
    yield* integrationResources.acquire(transition.responsibility)
    yield* startQueuedIntegration(transition.responsibility).pipe(
      Effect.tapError(() => integrationResources.release(transition.responsibility))
    )
    return true
  }
  if (transition._tag === "AcquireStartedIntegrationTarget") {
    yield* integrationResources.acquire(transition.responsibility)
    return true
  }
  if (transition._tag === "ReleaseStartedIntegrationTarget") {
    yield* integrationResources.release(transition.responsibility)
    return true
  }
  if (transition._tag === "ContinueStartedIntegrationCandidate") {
    const context = yield* Effect.context<never>()
    const agent = Context.getOption(context, IntegrationCandidateAgent)
    if (agent._tag === "None") return yield* new IntegrationCandidateBoundaryUnavailable({ boundary: "Agent" })
    const git = Context.getOption(context, IntegrationCandidateGit)
    if (git._tag === "None") return yield* new IntegrationCandidateBoundaryUnavailable({ boundary: "Git" })
    yield* runIntegrationCandidateConstruction(
      transition.responsibility,
      transition.lineage,
      transition.correctionLimit,
      transition.continuationLimit,
      integrationResources
    ).pipe(
      Effect.provideService(IntegrationCandidateAgent, agent.value),
      Effect.provideService(IntegrationCandidateGit, git.value)
    )
    return true
  }
  return false
})
