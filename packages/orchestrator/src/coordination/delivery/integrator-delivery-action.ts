import { Context, Effect, Option } from "effect"
import {
  Integrator,
  IntegratorGit,
  prepareIntegrationCandidateRun
} from "../../workflow/protocols/integrator/protocol.js"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import { deliveryActionCompleted, deliveryActionDeferred } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import { IntegratorBoundaryUnavailable } from "./integrator-boundary.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type RunIntegrator = Extract<RunnableFrontierTransition, { readonly _tag: "RunIntegrator" }>

/** Executes one outer session under the exact target permit and always releases process-local ownership afterward. */
export const executeIntegratorAction = Effect.fn("DeliveryAction.runIntegrator")(function* (
  action: IdentityFreeAction,
  transition: RunIntegrator,
  lease: DeliveryActionExecutionLease
) {
  const context = yield* Effect.context<never>()
  const integrator = Context.getOption(context, Integrator)
  if (Option.isNone(integrator)) return yield* new IntegratorBoundaryUnavailable({ boundary: "Integrator" })
  const git = Context.getOption(context, IntegratorGit)
  if (Option.isNone(git)) return yield* new IntegratorBoundaryUnavailable({ boundary: "Git" })
  return yield* lease.integrationTargets
    .withPermit(
      transition.responsibility,
      prepareIntegrationCandidateRun({
        preparation: {
          responsibility: transition.responsibility,
          targetLineage: transition.lineage,
          targetLineageObservedAt: transition.lineageObservedAt
        },
        run: transition.run
      }).pipe(Effect.provideService(Integrator, integrator.value), Effect.provideService(IntegratorGit, git.value))
    )
    .pipe(
      Effect.ensuring(lease.integrationTargets.release(transition.responsibility)),
      Effect.as(deliveryActionCompleted(action.proposal.id)),
      Effect.catchTag("IntegratorGitReadFailure", (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure))
      )
    )
})
