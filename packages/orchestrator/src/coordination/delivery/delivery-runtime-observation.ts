import { Context, Data, Effect, Match, Option, Ref, Stream, SubscriptionRef } from "effect"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryAdmissionReservation, DeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { currentSignalFromCurrentFirstStream, type CurrentSignal, type DeliveryRuntimeEvaluation } from "./relations.js"
import type { DeliveryActionProposal, DeliveryProposalId } from "./delivery-action-proposal.js"
import { deliveryProposalOrderTaskId } from "./delivery-action-proposal.js"
import {
  DeliveryActionProtocolAdmissionMissing,
  type DeliveryActionExecutionLease
} from "./delivery-action-executor.js"
import { withPlannedAttemptProtocolPermit } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  failExecutorPlanBinding,
  failPreStartClaimBinding,
  failPreStartPlanBinding
} from "./delivery-runtime-task-work-position.js"

/** The process-local action's intent state after its exact OperationId exists. */
export type DeliveryRuntimeActionIntent = "IntentNotRecorded" | "IntentRecorded"

type DeliveryRuntimeLiveOwnerLifecycle = Data.TaggedEnum<{
  AdmittedDeliveryAction: Record<never, never>
  MaterializedDeliveryAction: { readonly intent: DeliveryRuntimeActionIntent; readonly operationId: OperationId }
  SettledBeforeMaterialization: Record<never, never>
  SettledMaterializedDeliveryAction: { readonly intent: DeliveryRuntimeActionIntent; readonly operationId: OperationId }
}>

const DeliveryRuntimeLiveOwnerLifecycle = Data.taggedEnum<DeliveryRuntimeLiveOwnerLifecycle>()

/** The exhaustive process-local state retained for one action owner without exposing mutable refs. */
export type DeliveryRuntimeLiveOwnerSnapshot = Data.TaggedEnum<{
  AdmittedDeliveryAction: { readonly proposal: DeliveryActionProposal }
  MaterializedDeliveryAction: {
    readonly intent: DeliveryRuntimeActionIntent
    readonly operationId: OperationId
    readonly proposal: DeliveryActionProposal
  }
  SettledBeforeMaterialization: { readonly proposal: DeliveryActionProposal }
  SettledMaterializedDeliveryAction: {
    readonly intent: DeliveryRuntimeActionIntent
    readonly operationId: OperationId
    readonly proposal: DeliveryActionProposal
  }
}>

export const DeliveryRuntimeLiveOwnerSnapshot = Data.taggedEnum<DeliveryRuntimeLiveOwnerSnapshot>()

/** One process-local owner whose lifecycle transitions and snapshots each read or write one Ref atomically. */
export interface DeliveryRuntimeLiveOwnerSource {
  readonly intentRecorded: Effect.Effect<boolean>
  readonly isSettled: Effect.Effect<boolean>
  readonly materialize: (operationId: OperationId) => Effect.Effect<void>
  readonly operationId: Effect.Effect<Option.Option<OperationId>>
  readonly proposal: DeliveryActionProposal
  readonly recordIntent: (operationId: OperationId) => Effect.Effect<boolean>
  readonly reservation: DeliveryAdmissionReservation
  readonly settle: Effect.Effect<void>
  readonly snapshot: Effect.Effect<DeliveryRuntimeLiveOwnerSnapshot>
}

const lifecycleOperationId = Match.type<DeliveryRuntimeLiveOwnerLifecycle>().pipe(
  Match.tagsExhaustive({
    AdmittedDeliveryAction: () => Option.none<OperationId>(),
    MaterializedDeliveryAction: ({ operationId }) => Option.some(operationId),
    SettledBeforeMaterialization: () => Option.none<OperationId>(),
    SettledMaterializedDeliveryAction: ({ operationId }) => Option.some(operationId)
  })
)

const lifecycleIntentRecorded = Match.type<DeliveryRuntimeLiveOwnerLifecycle>().pipe(
  Match.tagsExhaustive({
    AdmittedDeliveryAction: () => false,
    MaterializedDeliveryAction: ({ intent }) => intent === "IntentRecorded",
    SettledBeforeMaterialization: () => false,
    SettledMaterializedDeliveryAction: ({ intent }) => intent === "IntentRecorded"
  })
)

const lifecycleIsSettled = Match.type<DeliveryRuntimeLiveOwnerLifecycle>().pipe(
  Match.tagsExhaustive({
    AdmittedDeliveryAction: () => false,
    MaterializedDeliveryAction: () => false,
    SettledBeforeMaterialization: () => true,
    SettledMaterializedDeliveryAction: () => true
  })
)

const ownerSnapshot = (
  proposal: DeliveryActionProposal,
  lifecycle: DeliveryRuntimeLiveOwnerLifecycle
): DeliveryRuntimeLiveOwnerSnapshot =>
  Match.valueTags(lifecycle, {
    AdmittedDeliveryAction: () => DeliveryRuntimeLiveOwnerSnapshot.AdmittedDeliveryAction({ proposal }),
    MaterializedDeliveryAction: ({ intent, operationId }) =>
      DeliveryRuntimeLiveOwnerSnapshot.MaterializedDeliveryAction({ intent, operationId, proposal }),
    SettledBeforeMaterialization: () => DeliveryRuntimeLiveOwnerSnapshot.SettledBeforeMaterialization({ proposal }),
    SettledMaterializedDeliveryAction: ({ intent, operationId }) =>
      DeliveryRuntimeLiveOwnerSnapshot.SettledMaterializedDeliveryAction({ intent, operationId, proposal })
  })

/** Creates the sole mutation authority for one admitted proposal's process-local owner lifecycle. */
export const makeDeliveryRuntimeLiveOwner = Effect.fn("DeliveryRuntime.makeLiveOwner")(function* (
  reservation: DeliveryAdmissionReservation
) {
  const lifecycle = yield* Ref.make<DeliveryRuntimeLiveOwnerLifecycle>(
    DeliveryRuntimeLiveOwnerLifecycle.AdmittedDeliveryAction()
  )
  const proposal = reservation.proposal

  const materialize = (operationId: OperationId) =>
    Ref.update(lifecycle, (current) =>
      current._tag === "AdmittedDeliveryAction"
        ? DeliveryRuntimeLiveOwnerLifecycle.MaterializedDeliveryAction({ intent: "IntentNotRecorded", operationId })
        : current
    )

  const recordIntent = (operationId: OperationId) =>
    Ref.modify(lifecycle, (current) =>
      current._tag === "MaterializedDeliveryAction" &&
      current.intent === "IntentNotRecorded" &&
      current.operationId === operationId
        ? [
            true,
            DeliveryRuntimeLiveOwnerLifecycle.MaterializedDeliveryAction({ intent: "IntentRecorded", operationId })
          ]
        : [false, current]
    )

  const settle = Ref.update(lifecycle, (current) =>
    Match.valueTags(current, {
      AdmittedDeliveryAction: () => DeliveryRuntimeLiveOwnerLifecycle.SettledBeforeMaterialization(),
      MaterializedDeliveryAction: ({ intent, operationId }) =>
        DeliveryRuntimeLiveOwnerLifecycle.SettledMaterializedDeliveryAction({ intent, operationId }),
      SettledBeforeMaterialization: () => current,
      SettledMaterializedDeliveryAction: () => current
    })
  )

  return {
    intentRecorded: Ref.get(lifecycle).pipe(Effect.map(lifecycleIntentRecorded)),
    isSettled: Ref.get(lifecycle).pipe(Effect.map(lifecycleIsSettled)),
    materialize,
    operationId: Ref.get(lifecycle).pipe(Effect.map(lifecycleOperationId)),
    proposal,
    recordIntent,
    reservation,
    settle,
    snapshot: Ref.get(lifecycle).pipe(Effect.map((current) => ownerSnapshot(proposal, current)))
  } satisfies DeliveryRuntimeLiveOwnerSource
})

export const deliveryRuntimeLiveOwnerSnapshots = Effect.fn("DeliveryRuntime.liveOwnerSnapshots")(function* (
  owners: ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLiveOwnerSource>
) {
  const snapshots = yield* Effect.forEach([...owners.values()], ({ snapshot }) => snapshot)
  return snapshots.toSorted((left, right) => left.proposal.id.localeCompare(right.proposal.id))
})

export const makeObservedDeliveryActionLease = (
  admission: DeliveryRuntimeAdmissionController,
  integrationTargets: DeliveryActionExecutionLease["integrationTargets"],
  owner: DeliveryRuntimeLiveOwnerSource,
  ownerChanged: Effect.Effect<void>
): DeliveryActionExecutionLease => ({
  acceptIntegrationTargetOwnership:
    owner.reservation.acquiredIntegrationResponsibility === null
      ? Effect.void
      : integrationTargets.publishAcceptedOwnership(owner.reservation.acquiredIntegrationResponsibility),
  bindPreStartTaskWorkPosition: (claimOperationId) => {
    const requirement = owner.proposal.admission.taskWorkPosition
    const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
    if (requirement._tag !== "PreStartTaskWorkPositionRequired") {
      return taskId === null
        ? Effect.die("pre-start claim binding requires a task-scoped delivery proposal")
        : failPreStartClaimBinding({ claimOperationId, reason: "UnexpectedPositionPhase", taskId, position: undefined })
    }
    if (requirement.mode === "ReuseExisting" && requirement.claimOperationId !== claimOperationId) {
      return failPreStartClaimBinding({
        claimOperationId,
        reason: "ClaimOperationMismatch",
        taskId: requirement.taskId,
        position: undefined
      })
    }
    return admission.bindPreStartTaskWorkPosition(requirement.taskId, claimOperationId)
  },
  bindPreStartPlannedAttemptPosition: (claimOperationId, correlation) => {
    const requirement = owner.proposal.admission.taskWorkPosition
    if (requirement._tag !== "PreStartTaskWorkPositionRequired" || requirement.mode !== "ReuseExisting") {
      const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
      return taskId === null
        ? Effect.die("pre-start plan binding requires a task-scoped delivery proposal")
        : failPreStartPlanBinding({
            claimOperationId,
            correlation,
            reason: "UnexpectedPositionPhase",
            taskId,
            position: undefined
          })
    }
    if (requirement.claimOperationId !== claimOperationId) {
      return failPreStartPlanBinding({
        claimOperationId,
        correlation,
        reason: "ClaimOperationMismatch",
        taskId: requirement.taskId,
        position: undefined
      })
    }
    return admission.bindPreStartPlannedAttemptPosition(requirement.taskId, claimOperationId, correlation)
  },
  bindPlannedAttemptPosition: (correlation) => {
    const requirement = owner.proposal.admission.taskWorkPosition
    return requirement._tag === "TaskWorkPositionRequired"
      ? admission.bindPlannedAttemptPosition(requirement.taskId, correlation)
      : (() => {
          const taskId = deliveryProposalOrderTaskId(owner.proposal.order)
          return taskId === null
            ? Effect.die("executor plan binding requires a task-scoped delivery proposal")
            : failExecutorPlanBinding({ correlation, reason: "UnexpectedPositionPhase", taskId, position: undefined })
        })()
  },
  integrationTargets,
  forwardBoundary:
    owner.reservation.forwardOwner.kind === "AtomicBoundary"
      ? { _tag: "AtomicBoundary", execution: owner.reservation.forwardOwner }
      : { _tag: "InterruptibleBoundary", execution: owner.reservation.forwardOwner },
  recordIntent: (operationId) =>
    owner
      .recordIntent(operationId)
      .pipe(
        Effect.flatMap((changed) =>
          changed ? ownerChanged : Effect.die(`live owner rejected intent transition for ${owner.proposal.id}`)
        )
      ),
  releasePlannedAttemptPosition: admission.releasePlannedAttemptPosition,
  withPlannedAttemptProtocol: (correlation, effect) => {
    const reservation = owner.reservation
    return reservation._tag === "NoPlannedAttemptProtocolAdmission"
      ? Effect.fail(new DeliveryActionProtocolAdmissionMissing({ correlation, proposalId: reservation.proposal.id }))
      : withPlannedAttemptProtocolPermit(reservation.permit, correlation, effect(reservation.permit))
  }
})

/** The activation has either not evaluated delivery yet or exposes its latest coherent runtime facts. */
interface DeliveryRuntimeReadyFields {
  readonly evaluation: DeliveryRuntimeEvaluation
  readonly liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
}

export interface DeliveryRuntimeReadyObservation extends DeliveryRuntimeReadyFields {
  readonly _tag: "Ready"
}

type DeliveryRuntimeNotReadyObservation = { readonly _tag: "NotReady" }
type DeliveryRuntimeFinalObservation = DeliveryRuntimeReadyObservation | DeliveryRuntimeNotReadyObservation

interface DeliveryRuntimeObservationObserverService {
  readonly observe: (observation: DeliveryRuntimeReadyObservation) => Effect.Effect<void>
}

/** Optional passive observer of each process-local runtime publication; production is inert by default. */
export const DeliveryRuntimeObservationObserver = Context.Reference<DeliveryRuntimeObservationObserverService>(
  "@dalph/DeliveryRuntimeObservationObserver",
  { defaultValue: () => ({ observe: () => Effect.void }) }
)

export type DeliveryRuntimeObservationState = Data.TaggedEnum<{
  Closed: { readonly final: DeliveryRuntimeFinalObservation | null }
  NotReady: Record<never, never>
  Ready: DeliveryRuntimeReadyFields
}>

export const DeliveryRuntimeObservationState = Data.taggedEnum<DeliveryRuntimeObservationState>()

export interface DeliveryRuntimeObservationPublicationService {
  readonly close: Effect.Effect<void>
  readonly publish: (
    evaluation: DeliveryRuntimeEvaluation,
    liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
  ) => Effect.Effect<void>
}

/** Internal mutation authority paired with the read-only signal exposed by runtime resources. */
export interface DeliveryRuntimeObservationController extends DeliveryRuntimeObservationPublicationService {
  readonly signal: CurrentSignal<DeliveryRuntimeObservationState>
}

/** Write capability retained by the delivery runtime; passive observers receive only the paired signal. */
export class DeliveryRuntimeObservationPublication extends Context.Service<
  DeliveryRuntimeObservationPublication,
  DeliveryRuntimeObservationPublicationService
>()("@dalph/DeliveryRuntimeObservationPublication") {}

export const makeDeliveryRuntimeObservationController = Effect.fn("DeliveryRuntimeObservation.makeController")(
  function* () {
    const state = yield* SubscriptionRef.make<DeliveryRuntimeObservationState>(
      DeliveryRuntimeObservationState.NotReady()
    )
    const observer = yield* DeliveryRuntimeObservationObserver

    return {
      close: SubscriptionRef.update(state, (current) =>
        DeliveryRuntimeObservationState.Closed({
          final: Match.valueTags(current, {
            Closed: ({ final }) => final,
            NotReady: () => DeliveryRuntimeObservationState.NotReady(),
            Ready: (ready) => ready
          })
        })
      ),
      publish: (evaluation, liveOwners) =>
        Effect.gen(function* () {
          const observation = DeliveryRuntimeObservationState.Ready({ evaluation, liveOwners: [...liveOwners] })
          const published = yield* SubscriptionRef.modify(state, (current) =>
            current._tag === "Closed" ? [false, current] : [true, observation]
          )
          if (published) yield* observer.observe(observation)
        }),
      signal: currentSignalFromCurrentFirstStream(
        SubscriptionRef.changes(state).pipe(Stream.takeUntil(({ _tag }) => _tag === "Closed"))
      )
    } satisfies DeliveryRuntimeObservationController
  }
)
