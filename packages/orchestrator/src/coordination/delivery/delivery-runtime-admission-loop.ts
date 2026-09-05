import { Effect, Option, Ref, Schema } from "effect"
import type { Semaphore } from "effect"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import type { DeliverySemanticTraceEvent } from "./delivery-action-executor.js"
import type { DeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import {
  DeliveryProposalId,
  isExistingResponsibilityDeliveryProposal,
  type DeliveryActionProposal
} from "./delivery-action-proposal.js"
import type { DeliveryRuntimeLiveOwnerSource } from "./delivery-runtime-observation.js"
import {
  liveActionKeyOf,
  liveActionIsPresent,
  type LiveDeliveryActionKey,
  proposalIsAvailable
} from "./live-delivery-action.js"
import {
  freshTaskCandidateObservationOf,
  type DeliveryProposalFrontier,
  type DeliveryRuntimeEvaluation
} from "./relations.js"
import type { DeliveryRuntimeLocalDeferral } from "./delivery-runtime-local-deferral.js"
import type { FreshTaskCandidateFrontier } from "./fresh-task-candidate.js"

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

type DeliveryRuntimeAdmissionLoopEvaluation = Pick<
  DeliveryRuntimeEvaluation,
  "acceptedAt" | "proposedActions" | "taskWork"
>

type DeliveryRuntimeAdmissionLoopState<Evaluation extends DeliveryRuntimeAdmissionLoopEvaluation> = {
  readonly admission: Pick<DeliveryRuntimeAdmissionController, "synchronize">
  readonly localDeferrals: Ref.Ref<ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>>
  readonly latest: Ref.Ref<Option.Option<Evaluation>>
  readonly owners: Ref.Ref<ReadonlyMap<DeliveryProposalId, LiveOwner>>
  readonly selectionGate: Semaphore.Semaphore
}

type DeliveryRuntimeAdmissionLoopActions = {
  readonly emit: (event: DeliverySemanticTraceEvent) => Effect.Effect<void>
  readonly publishRuntimeObservationInsideGate: () => Effect.Effect<void>
  readonly reserveAndStart: (
    proposal: DeliveryActionProposal
  ) => Effect.Effect<DeliveryRuntimeReservationResult, ApplicationExiting>
  readonly reserveFreshAndStart: (
    frontier: FreshTaskCandidateFrontier
  ) => Effect.Effect<DeliveryRuntimeReservationResult, ApplicationExiting>
}

type DeliveryRuntimeAdmissionLoopDependencies<Evaluation extends DeliveryRuntimeAdmissionLoopEvaluation> =
  DeliveryRuntimeAdmissionLoopState<Evaluation> & DeliveryRuntimeAdmissionLoopActions

type FreshAdmissionDecision =
  | { readonly _tag: "FreshAdmissionAllowed" }
  | { readonly _tag: "FreshAdmissionBlocked"; readonly reason: "ExistingResponsibilityDeferred" }

type LaterProposalAdmissionResult =
  | { readonly _tag: "LaterProposalStarted"; readonly started: boolean }
  | { readonly _tag: "NoLaterProposalStarted"; readonly freshAdmission: FreshAdmissionDecision }

type OrdinaryProposalAdmissionResult =
  | { readonly _tag: "OrdinaryProposalStarted"; readonly started: boolean }
  | FreshAdmissionDecision

type DeliveryRuntimeAdmissionLoopObservation = {
  readonly admitPass: () => Effect.Effect<boolean, ApplicationExiting | DeliveryRuntimeProposalOwnershipConflict>
}

type DeliveryRuntimeAdmissionLoopCleanup = {
  readonly pruneSettledOwners: (frontier: DeliveryProposalFrontier) => Effect.Effect<void>
}

type DeliveryRuntimeAdmissionLoop = DeliveryRuntimeAdmissionLoopObservation & DeliveryRuntimeAdmissionLoopCleanup

/** Coordinates proposal admission, process-local ownership, and target-resource cleanup. */
export const makeDeliveryRuntimeAdmissionLoop = Effect.fn("DeliveryRuntimeAdmissionLoop.make")(<
  Evaluation extends DeliveryRuntimeAdmissionLoopEvaluation
>(
  dependencies: DeliveryRuntimeAdmissionLoopDependencies<Evaluation>
) => {
  const {
    admission,
    emit,
    latest,
    localDeferrals,
    owners,
    publishRuntimeObservationInsideGate,
    reserveAndStart,
    reserveFreshAndStart,
    selectionGate
  } = dependencies

  const admitLaterAvailableProposal = Effect.fn("DeliveryRuntimeAdmissionLoop.admitLaterAvailableProposal")(function* (
    proposals: ReadonlyArray<DeliveryActionProposal>,
    deferredIndex: number,
    live: ReadonlyMap<DeliveryProposalId, LiveOwner>,
    liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
    liveOperationIds: ReadonlySet<OperationId>,
    deferred: ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>,
    acceptedAt: JournalPosition | null
  ): Effect.fn.Return<LaterProposalAdmissionResult, ApplicationExiting> {
    let freshAdmission: FreshAdmissionDecision = { _tag: "FreshAdmissionAllowed" }
    for (const independent of proposals.slice(deferredIndex + 1)) {
      if (!proposalIsAvailable(independent, live, liveActionKeys, liveOperationIds, deferred, acceptedAt)) {
        continue
      }
      const laterReservation = yield* reserveAndStart(independent)
      if (laterReservation._tag === "Started") {
        return { _tag: "LaterProposalStarted", started: laterReservation.started }
      }
      yield* emit({ _tag: "ProposalDeferred", proposalId: independent.id, reason: laterReservation.reason })
      if (isExistingResponsibilityDeliveryProposal(independent)) {
        freshAdmission = { _tag: "FreshAdmissionBlocked", reason: "ExistingResponsibilityDeferred" }
      }
    }
    return { _tag: "NoLaterProposalStarted", freshAdmission }
  })

  const admitAvailableProposal = Effect.fn("DeliveryRuntimeAdmissionLoop.admitAvailableProposal")(function* (
    proposals: ReadonlyArray<DeliveryActionProposal>,
    live: ReadonlyMap<DeliveryProposalId, LiveOwner>,
    liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
    liveOperationIds: ReadonlySet<OperationId>,
    deferred: ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>,
    acceptedAt: JournalPosition | null
  ): Effect.fn.Return<OrdinaryProposalAdmissionResult, ApplicationExiting> {
    const proposal = proposals.find((candidate) =>
      proposalIsAvailable(candidate, live, liveActionKeys, liveOperationIds, deferred, acceptedAt)
    )
    if (proposal === undefined) return { _tag: "FreshAdmissionAllowed" }
    const reservation = yield* reserveAndStart(proposal)
    if (reservation._tag === "Started") {
      return { _tag: "OrdinaryProposalStarted", started: reservation.started }
    }
    yield* emit({ _tag: "ProposalDeferred", proposalId: proposal.id, reason: reservation.reason })
    const freshAdmission: FreshAdmissionDecision = isExistingResponsibilityDeliveryProposal(proposal)
      ? { _tag: "FreshAdmissionBlocked", reason: "ExistingResponsibilityDeferred" }
      : { _tag: "FreshAdmissionAllowed" }
    const laterStarted = yield* admitLaterAvailableProposal(
      proposals,
      proposals.findIndex(({ id }) => id === proposal.id),
      live,
      liveActionKeys,
      liveOperationIds,
      deferred,
      acceptedAt
    )
    if (laterStarted._tag === "LaterProposalStarted") {
      return { _tag: "OrdinaryProposalStarted", started: laterStarted.started }
    }
    if (laterStarted.freshAdmission._tag === "FreshAdmissionBlocked") return laterStarted.freshAdmission
    return freshAdmission
  })

  const admitFreshCandidate = Effect.fn("DeliveryRuntimeAdmissionLoop.admitFreshCandidate")(function* (
    proposedActions: Extract<DeliveryProposalFrontier, { readonly _tag: "DeliveryProposalsAvailable" }>
  ) {
    const freshFrontier = freshTaskCandidateObservationOf(proposedActions)
    if (freshFrontier._tag === "FreshTaskCandidateObservationUnavailable") return false
    const freshReservation = yield* reserveFreshAndStart(freshFrontier)
    return freshReservation._tag === "Started" ? freshReservation.started : false
  })

  const admitPass = Effect.fn("DeliveryRuntimeAdmissionLoop.admitPass")(function* () {
    return yield* selectionGate.withPermit(
      Effect.gen(function* () {
        const current = Option.getOrThrow(yield* Ref.get(latest))
        yield* admission.synchronize(current.taskWork, freshTaskCandidateObservationOf(current.proposedActions))
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
        const ordinary = yield* admitAvailableProposal(
          proposedActions.proposals,
          live,
          liveActionKeys,
          liveOperationIds,
          deferred,
          current.acceptedAt
        )
        if (ordinary._tag === "OrdinaryProposalStarted") return ordinary.started
        if (ordinary._tag === "FreshAdmissionBlocked") return false
        return yield* admitFreshCandidate(proposedActions)
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
