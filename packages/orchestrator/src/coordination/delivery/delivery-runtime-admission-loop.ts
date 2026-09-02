import { Effect, Option, Ref, Schema } from "effect"
import { samePlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import type { Semaphore } from "effect"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import type { DeliverySemanticTraceEvent } from "./delivery-action-executor.js"
import {
  deliveryTaskWorkAdmissionBasisOf,
  type DeliveryRuntimeAdmissionController
} from "./delivery-runtime-admission.js"
import { DeliveryProposalId, type DeliveryActionProposal } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSource } from "./delivery-runtime-observation.js"
import { liveActionKeyOf, liveActionIsPresent, proposalIsAvailable } from "./live-delivery-action.js"
import type {
  DeliveryProposalFrontier,
  DeliveryRuntimeEvaluation,
  DeliveryTaskWorkAdmissionBasis
} from "./relations.js"
import type { DeliveryRuntimeLocalDeferral } from "./delivery-runtime-local-deferral.js"

/** Two lower relations claim the same proposal identity, so no action is authorized. */
export class DeliveryRuntimeProposalOwnershipConflict extends Schema.TaggedError<DeliveryRuntimeProposalOwnershipConflict>()(
  "DeliveryRuntimeProposalOwnershipConflict",
  { proposalIds: Schema.Array(DeliveryProposalId) }
) {}

type LiveOwner = DeliveryRuntimeLiveOwnerSource
type DeliveryAdmissionResult = Effect.Success<ReturnType<DeliveryRuntimeAdmissionController["tryReserve"]>>
type DeferredAdmissionResult = Extract<DeliveryAdmissionResult, { readonly _tag: "Deferred" }>

type DeliveryRuntimeReservationResult =
  | DeferredAdmissionResult
  | { readonly _tag: "Started"; readonly started: boolean }

type DeliveryRuntimeAdmissionLoopState = {
  readonly admission: DeliveryRuntimeAdmissionController
  readonly deferNewPositionUntilLiveOwnersSettle: boolean
  readonly localDeferrals: Ref.Ref<ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>>
  readonly latest: Ref.Ref<Option.Option<DeliveryRuntimeEvaluation>>
  readonly owners: Ref.Ref<ReadonlyMap<DeliveryProposalId, LiveOwner>>
  readonly selectionGate: Semaphore.Semaphore
}

type DeliveryRuntimeAdmissionLoopActions = {
  readonly emit: (event: DeliverySemanticTraceEvent) => Effect.Effect<void>
  readonly publishRuntimeObservationInsideGate: () => Effect.Effect<void>
  readonly reserveAndStart: (
    proposal: DeliveryActionProposal
  ) => Effect.Effect<DeliveryRuntimeReservationResult, ApplicationExiting>
}

type DeliveryRuntimeAdmissionLoopDependencies = DeliveryRuntimeAdmissionLoopState & DeliveryRuntimeAdmissionLoopActions

interface DeliveryRuntimeAdmissionDeferral {
  readonly proposalId: DeliveryProposalId
  readonly reason: DeferredAdmissionResult["reason"]
}

/** A live owner may still settle or roll back its position, so a new exact position request waits instead of denying early. */
const proposalWaitsForLiveOwnerToSettleAtFullCapacity = (
  proposal: DeliveryActionProposal,
  taskWork: DeliveryTaskWorkAdmissionBasis,
  liveOwnerCount: number
): boolean => {
  const position = proposal.admission.taskWorkPosition
  const protocol = proposal.admission.plannedAttemptProtocol
  return (
    liveOwnerCount > 0 &&
    taskWork.held.length >= Number(taskWork.capacity) &&
    position._tag === "TaskWorkPositionRequired" &&
    position.mode === "ReserveOrReuse" &&
    protocol._tag === "PlannedAttemptProtocolRequired" &&
    !taskWork.held.some(({ correlation }) => samePlannedAttemptExecutorCorrelation(correlation, protocol.correlation))
  )
}

export interface DeliveryRuntimeAdmissionPassResult {
  readonly deferrals: ReadonlyArray<DeliveryRuntimeAdmissionDeferral>
  readonly started: boolean
}

type DeliveryRuntimeAdmissionLoopObservation = {
  readonly admitPass: () => Effect.Effect<
    DeliveryRuntimeAdmissionPassResult,
    ApplicationExiting | DeliveryRuntimeProposalOwnershipConflict
  >
}

type DeliveryRuntimeAdmissionLoopCleanup = {
  readonly pruneSettledOwners: (frontier: DeliveryProposalFrontier) => Effect.Effect<void>
}

type DeliveryRuntimeAdmissionLoop = DeliveryRuntimeAdmissionLoopObservation & DeliveryRuntimeAdmissionLoopCleanup

/** Coordinates proposal admission, process-local ownership, and target-resource cleanup. */
export const makeDeliveryRuntimeAdmissionLoop = Effect.fn("DeliveryRuntimeAdmissionLoop.make")((
  dependencies: DeliveryRuntimeAdmissionLoopDependencies
) => {
  const {
    admission,
    deferNewPositionUntilLiveOwnersSettle,
    emit,
    latest,
    localDeferrals,
    owners,
    publishRuntimeObservationInsideGate,
    reserveAndStart,
    selectionGate
  } = dependencies
  const admitPass = Effect.fn("DeliveryRuntimeAdmissionLoop.admitPass")(function* () {
    return yield* selectionGate.withPermit(
      Effect.gen(function* () {
        const current = Option.getOrThrow(yield* Ref.get(latest))
        yield* admission.synchronize(current.taskWork)
        const taskWorkBasis = deliveryTaskWorkAdmissionBasisOf(yield* admission.snapshot)
        const proposedActions = current.proposedActions
        if (proposedActions._tag === "DeliveryProposalOwnershipConflict") {
          return yield* new DeliveryRuntimeProposalOwnershipConflict({
            proposalIds: proposedActions.conflicts.map(({ id }) => id)
          })
        }
        const live = yield* Ref.get(owners)
        const deferred = yield* Ref.get(localDeferrals)
        const liveActionKeys = new Set([...live.values()].map(({ proposal }) => liveActionKeyOf(proposal)))
        const liveOperationIds = new Set(
          (yield* Effect.forEach(live.values(), ({ operationId }) => operationId)).flatMap(Option.toArray)
        )
        let deferrals: ReadonlyArray<DeliveryRuntimeAdmissionDeferral> = []
        for (const proposal of proposedActions.proposals) {
          if (!proposalIsAvailable(proposal, live, liveActionKeys, liveOperationIds, deferred, current.acceptedAt)) {
            continue
          }
          if (
            deferNewPositionUntilLiveOwnersSettle &&
            proposalWaitsForLiveOwnerToSettleAtFullCapacity(proposal, taskWorkBasis, live.size)
          ) {
            continue
          }
          const reservation = yield* reserveAndStart(proposal)
          if (reservation._tag === "Started") {
            return { deferrals, started: reservation.started } satisfies DeliveryRuntimeAdmissionPassResult
          }
          const deferral = { proposalId: proposal.id, reason: reservation.reason }
          deferrals = [...deferrals, deferral]
          yield* emit({ _tag: "ProposalDeferred", ...deferral })
        }
        return { deferrals, started: false } satisfies DeliveryRuntimeAdmissionPassResult
      })
    )
  })

  const pruneSettledOwners = Effect.fn("DeliveryRuntimeAdmissionLoop.pruneSettledOwners")(function* (
    frontier: DeliveryProposalFrontier
  ) {
    const current = yield* Ref.get(owners)
    const removable = (yield* Effect.forEach(current.values(), (owner) =>
      Effect.map(owner.isSettled, (isSettled) =>
        isSettled && !liveActionIsPresent(frontier, owner.proposal) ? owner : undefined
      )
    )).filter((owner): owner is LiveOwner => owner !== undefined)
    if (removable.length === 0) return
    const removableIds = new Set(removable.map(({ proposal }) => proposal.id))
    yield* Ref.update(owners, (current) => new Map([...current].filter(([id]) => !removableIds.has(id))))
    yield* publishRuntimeObservationInsideGate()
  })

  return Effect.succeed({ admitPass, pruneSettledOwners } satisfies DeliveryRuntimeAdmissionLoop)
})
