import { Effect } from "effect"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"

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
  return false
})
