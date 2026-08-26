import { Effect, Option, Ref, Schema } from "effect"
import type { Semaphore } from "effect"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import type { DeliverySemanticTraceEvent } from "./delivery-action-executor.js"
import type { DeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { DeliveryProposalId, type DeliveryActionProposal } from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSource } from "./delivery-runtime-observation.js"
import {
  liveActionKeyOf,
  type LiveDeliveryActionKey,
  proposalOwnerIsRepresented,
  proposalIsAvailable
} from "./live-delivery-action.js"
import type { DeliveryProposalFrontier, DeliveryRuntimeEvaluation } from "./relations.js"

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
  readonly deferredAt: Ref.Ref<ReadonlyMap<DeliveryProposalId, JournalPosition | null>>
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

type DeliveryRuntimeAdmissionLoopObservation = {
  readonly admitPass: () => Effect.Effect<boolean, ApplicationExiting | DeliveryRuntimeProposalOwnershipConflict>
}

type DeliveryRuntimeAdmissionLoopCleanup = {
  readonly pruneSettledOwners: (frontier: DeliveryProposalFrontier) => Effect.Effect<void>
}

type DeliveryRuntimeAdmissionLoop = DeliveryRuntimeAdmissionLoopObservation & DeliveryRuntimeAdmissionLoopCleanup

const isPromotionStaleQuarantineProposal = (proposal: DeliveryActionProposal): boolean =>
  proposal.route._tag === "IdentityFreeWorkflowRoute" &&
  proposal.route.transition._tag === "RecordPromotionStaleIntegrationQuarantine"

const admissionPriority = (proposal: DeliveryActionProposal): number =>
  isPromotionStaleQuarantineProposal(proposal) ? 0 : 1

/** A stale promotion must be durably quarantined before unrelated recovered reads can consume the turn. */
const availableProposalOf = (
  proposals: ReadonlyArray<DeliveryActionProposal>,
  live: ReadonlyMap<DeliveryProposalId, LiveOwner>,
  liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
  liveOperationIds: ReadonlySet<OperationId>,
  deferred: ReadonlyMap<DeliveryProposalId, JournalPosition | null>,
  acceptedAt: JournalPosition | null
): DeliveryActionProposal | undefined => {
  const isAvailable = (proposal: DeliveryActionProposal) =>
    proposalIsAvailable(proposal, live, liveActionKeys, liveOperationIds, deferred, acceptedAt)
  const staleQuarantine = proposals.find(
    (proposal) => isPromotionStaleQuarantineProposal(proposal) && isAvailable(proposal)
  )
  return staleQuarantine ?? proposals.find(isAvailable)
}

/** Coordinates proposal admission, process-local ownership, and target-resource cleanup. */
export const makeDeliveryRuntimeAdmissionLoop = Effect.fn("DeliveryRuntimeAdmissionLoop.make")((
  dependencies: DeliveryRuntimeAdmissionLoopDependencies
) => {
  const {
    admission,
    deferredAt,
    emit,
    latest,
    owners,
    publishRuntimeObservationInsideGate,
    reserveAndStart,
    selectionGate
  } = dependencies

  const admitLaterAvailableProposal = Effect.fn("DeliveryRuntimeAdmissionLoop.admitLaterAvailableProposal")(function* (
    proposals: ReadonlyArray<DeliveryActionProposal>,
    deferredIndex: number,
    live: ReadonlyMap<DeliveryProposalId, LiveOwner>,
    liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
    liveOperationIds: ReadonlySet<OperationId>,
    deferred: ReadonlyMap<DeliveryProposalId, JournalPosition | null>,
    acceptedAt: JournalPosition | null
  ) {
    for (const independent of proposals
      .slice(deferredIndex + 1)
      .toSorted((left, right) => admissionPriority(left) - admissionPriority(right))) {
      if (!proposalIsAvailable(independent, live, liveActionKeys, liveOperationIds, deferred, acceptedAt)) continue
      const laterReservation = yield* reserveAndStart(independent)
      if (laterReservation._tag === "Started") return laterReservation.started
      yield* emit({ _tag: "ProposalDeferred", proposalId: independent.id, reason: laterReservation.reason })
    }
    return false
  })

  const admitPass = Effect.fn("DeliveryRuntimeAdmissionLoop.admitPass")(function* () {
    return yield* selectionGate.withPermit(
      Effect.gen(function* () {
        const current = Option.getOrThrow(yield* Ref.get(latest))
        yield* admission.synchronize(current.taskWork)
        const proposedActions = current.proposedActions
        if (proposedActions._tag === "DeliveryProposalOwnershipConflict") {
          return yield* new DeliveryRuntimeProposalOwnershipConflict({
            proposalIds: proposedActions.conflicts.map(({ id }) => id)
          })
        }
        const live = yield* Ref.get(owners)
        const deferred = yield* Ref.get(deferredAt)
        const liveActionKeys = new Set([...live.values()].map(({ proposal }) => liveActionKeyOf(proposal)))
        const liveOperationIds = new Set(
          (yield* Effect.forEach(live.values(), ({ operationId }) => operationId)).flatMap(Option.toArray)
        )
        const proposal = availableProposalOf(
          proposedActions.proposals,
          live,
          liveActionKeys,
          liveOperationIds,
          deferred,
          current.acceptedAt
        )
        if (proposal === undefined) return false
        const reservation = yield* reserveAndStart(proposal)
        if (reservation._tag === "Deferred") {
          yield* emit({ _tag: "ProposalDeferred", proposalId: proposal.id, reason: reservation.reason })
          return yield* admitLaterAvailableProposal(
            proposedActions.proposals,
            proposedActions.proposals.findIndex(({ id }) => id === proposal.id),
            live,
            liveActionKeys,
            liveOperationIds,
            deferred,
            current.acceptedAt
          )
        }
        return reservation.started
      })
    )
  })

  const pruneSettledOwners = Effect.fn("DeliveryRuntimeAdmissionLoop.pruneSettledOwners")(function* (
    frontier: DeliveryProposalFrontier
  ) {
    const current = yield* Ref.get(owners)
    const removable = (yield* Effect.forEach(current.values(), (owner) =>
      Effect.all({ isSettled: owner.isSettled, operationId: owner.operationId }).pipe(
        Effect.map(({ isSettled, operationId }) =>
          isSettled && !proposalOwnerIsRepresented(frontier, owner.proposal.id, Option.getOrNull(operationId))
            ? owner
            : undefined
        )
      )
    )).filter((owner): owner is LiveOwner => owner !== undefined)
    if (removable.length === 0) return
    const removableIds = new Set(removable.map(({ proposal }) => proposal.id))
    yield* Ref.update(owners, (current) => new Map([...current].filter(([id]) => !removableIds.has(id))))
    yield* publishRuntimeObservationInsideGate()
  })

  return Effect.succeed({ admitPass, pruneSettledOwners } satisfies DeliveryRuntimeAdmissionLoop)
})
