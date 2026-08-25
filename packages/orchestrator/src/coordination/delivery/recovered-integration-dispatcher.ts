import { Effect, Exit, Schema } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  DeliveryProposalId,
  type IdentityFreeDeliveryProposal,
  type IdentityFreeWorkflowTransition
} from "./delivery-action-proposal.js"
import { executeIntegrationAction } from "./integration-delivery-action-adapter.js"
import { makeDeliveryRuntimeLiveOwner, makeObservedDeliveryActionLease } from "./delivery-runtime-observation.js"
import type { DeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"

/** A recovered proposal could not obtain the same process-local resources as a live delivery owner. */
export class RecoveredIntegrationActionDeferred extends Schema.TaggedError<RecoveredIntegrationActionDeferred>()(
  "RecoveredIntegrationActionDeferred",
  {
    proposalId: DeliveryProposalId,
    reason: Schema.Literals([
      "IntegrationTargetUnavailable",
      "PlannedAttemptProtocolUnavailable",
      "TaskWorkPositionUnavailable"
    ])
  }
) {}

/** Dependencies owned by one ordinary delivery runtime activation. */
export interface RecoveredIntegrationDispatcherDependencies {
  readonly admission: DeliveryRuntimeAdmissionController
  readonly integrationTargets: IntegrationTargetResourceController
  /** Runtime publication remains optional for an isolated restart activation. */
  readonly ownerChanged?: Effect.Effect<void>
}

type IntegrationTransition = Parameters<typeof executeIntegrationAction>[1]
const integrationTransitionTags: ReadonlySet<string> = new Set([
  "AcquireStartedIntegrationTarget",
  "CompletePromotedTask",
  "DeleteCompletedTaskCompletionClaim",
  "FixIntegratorSuccessorSession",
  "ObserveFocusedTaskCompletion",
  "ObservePromotedCandidateAncestryAfterBlockerClear",
  "QueueAcceptedResultIntegrationResponsibility",
  "RecordChangedHeadRetryQuarantine",
  "RecordInitialConclusiveIntegrationQuarantine",
  "RecordPromotionStaleIntegrationQuarantine",
  "RecordProviderRunFailureIntegrationQuarantine",
  "RecordRetryConclusiveIntegrationQuarantine",
  "ReleaseStartedIntegrationTarget",
  "ReplacePromotedTaskClaim",
  "RunIntegrator",
  "RunTargetPromotion",
  "StartQueuedIntegration"
])

const isIntegrationTransition = (transition: IdentityFreeWorkflowTransition): transition is IntegrationTransition =>
  integrationTransitionTags.has(transition._tag)

/**
 * Dispatches one recovered integration proposal through the same admission,
 * owner, lease, and integration adapter used by the live delivery runtime.
 * The caller supplies only the pure proposal and runtime-owned capabilities;
 * this function obtains and releases the process-local admission itself.
 */
export const dispatchRecoveredIntegrationAction = Effect.fn("DeliveryAction.dispatchRecoveredIntegrationAction")(
  function* (
    proposal: IdentityFreeDeliveryProposal,
    target: TrackerTarget,
    dependencies: RecoveredIntegrationDispatcherDependencies
  ) {
    if (proposal.route._tag !== "IdentityFreeWorkflowRoute") {
      return yield* Effect.die("recovered integration dispatch requires an identity-free integration route")
    }
    if (!isIntegrationTransition(proposal.route.transition)) {
      return yield* Effect.die("recovered integration dispatch requires an integration transition")
    }
    const reservation = yield* dependencies.admission.tryReserve(proposal)
    if (reservation._tag === "Deferred") {
      return yield* new RecoveredIntegrationActionDeferred({ proposalId: proposal.id, reason: reservation.reason })
    }
    const owner = yield* makeDeliveryRuntimeLiveOwner(reservation.reservation)
    const lease = makeObservedDeliveryActionLease(
      dependencies.admission,
      dependencies.integrationTargets,
      owner,
      dependencies.ownerChanged ?? Effect.void
    )
    const action = { _tag: "IdentityFreeAction" as const, proposal }
    const result = yield* Effect.exit(executeIntegrationAction(action, proposal.route.transition, lease, target))
    const settleReservation = (cleanup: Effect.Effect<void>) =>
      Effect.uninterruptible(
        Effect.exit(cleanup).pipe(
          Effect.flatMap((cleanupResult) => {
            if (Exit.isSuccess(cleanupResult)) return Effect.void
            // Admission owns every reservation resource.  If its aggregate cleanup
            // fails part-way through, release the forward owner explicitly so an
            // application exit cannot wait forever for this recovered action.
            return reservation.reservation.forwardOwner.release.pipe(
              Effect.ignore,
              Effect.andThen(Effect.failCause(cleanupResult.cause))
            )
          })
        )
      )
    if (Exit.isFailure(result)) {
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* settleReservation(
            dependencies.admission.rollback(reservation.reservation, yield* owner.intentRecorded)
          )
        }).pipe(Effect.ensuring(owner.settle))
      )
      return yield* Effect.failCause(result.cause)
    }
    yield* Effect.uninterruptible(
      settleReservation(dependencies.admission.complete(reservation.reservation)).pipe(Effect.ensuring(owner.settle))
    )
    return result.value
  }
)
