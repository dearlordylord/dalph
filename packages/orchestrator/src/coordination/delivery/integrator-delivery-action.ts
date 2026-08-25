import { Context, Effect, Option } from "effect"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import {
  Integrator,
  IntegratorGit,
  prepareIntegrationCandidateRun
} from "../../workflow/protocols/integrator/protocol.js"
import { appendInitialConclusiveIntegrationQuarantine } from "../../workflow/protocols/integration-quarantine/initial-conclusive.js"
import {
  appendProviderRunFailureQuarantine,
  reconcileProviderRunFailureQuarantine
} from "../../workflow/protocols/integration-quarantine/provider-failure.js"
import { appendRetryConclusiveIntegrationQuarantine } from "../../workflow/protocols/integration-quarantine/retry-conclusive.js"
import { appendPromotionStaleIntegrationQuarantine } from "../../workflow/protocols/integration-quarantine/promotion-stale.js"
import { deliveryActionCompleted, deliveryActionDeferred } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import { IntegratorBoundaryUnavailable } from "./integrator-boundary.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import { appendIntegratorSuccessorSessionIfNeeded } from "../../workflow/protocols/integrator/successor-session.js"

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type RunIntegrator = Extract<RunnableFrontierTransition, { readonly _tag: "RunIntegrator" }>
type RecordInitialConclusiveIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordInitialConclusiveIntegrationQuarantine" }
>
type RecordProviderRunFailureIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordProviderRunFailureIntegrationQuarantine" }
>
type RecordRetryConclusiveIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordRetryConclusiveIntegrationQuarantine" }
>
type RecordPromotionStaleIntegrationQuarantine = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "RecordPromotionStaleIntegrationQuarantine" }
>
type FixIntegratorSuccessorSession = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "FixIntegratorSuccessorSession" }
>

/** Appends the missing initial Q before releasing any held target responsibility. */
export const recordInitialConclusiveIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordInitialConclusiveIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordInitialConclusiveIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* appendInitialConclusiveIntegrationQuarantine(transition.result)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Finishes the absence-to-Q chronology after a crash without calling the provider again. */
export const recordProviderRunFailureIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordProviderRunFailureIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordProviderRunFailureIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* reconcileProviderRunFailureQuarantine(transition.input)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Appends Q2 for an already-recorded conclusive Retry result before releasing target ownership. */
export const recordRetryConclusiveIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordRetryConclusiveIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordRetryConclusiveIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* appendRetryConclusiveIntegrationQuarantine(transition.result)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Appends promotion-stale Q from the exact durable stale promotion fact before releasing target ownership. */
export const recordPromotionStaleIntegrationQuarantine = Effect.fn(
  "DeliveryAction.recordPromotionStaleIntegrationQuarantine"
)(function* (
  action: IdentityFreeAction,
  transition: RecordPromotionStaleIntegrationQuarantine,
  lease: DeliveryActionExecutionLease
) {
  yield* appendPromotionStaleIntegrationQuarantine(transition.input)
  yield* lease.integrationTargets.release(transition.responsibility)
  return deliveryActionCompleted(action.proposal.id)
})

/** Fixes or reconciles S2 after FullRerun's exact Q/D/fresh-lineage chronology; it retains the held target. */
export const fixIntegratorSuccessorSession = Effect.fn("DeliveryAction.fixIntegratorSuccessorSession")(function* (
  action: IdentityFreeAction,
  transition: FixIntegratorSuccessorSession
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(transition.responsibility.plannedAttempt.runId)
  yield* appendIntegratorSuccessorSessionIfNeeded(journal, transition.input, records)
  return deliveryActionCompleted(action.proposal.id)
})

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
      }).pipe(
        Effect.provideService(Integrator, integrator.value),
        Effect.provideService(IntegratorGit, git.value),
        Effect.tap((result) =>
          result._tag !== "NotPrepared" && result._tag !== "CandidateRejected"
            ? Effect.void
            : result.run.ordinal === 1
              ? appendInitialConclusiveIntegrationQuarantine(result)
              : appendRetryConclusiveIntegrationQuarantine(result)
        ),
        Effect.catchTag("IntegratorProviderActivityAbsent", (failure) =>
          appendProviderRunFailureQuarantine({ failure, run: transition.run })
        )
      )
    )
    .pipe(
      Effect.ensuring(lease.integrationTargets.release(transition.responsibility)),
      Effect.as(deliveryActionCompleted(action.proposal.id)),
      Effect.catchTag("IntegratorGitReadFailure", (failure) =>
        Effect.succeed(deliveryActionDeferred(action.proposal.id, failure))
      )
    )
})
