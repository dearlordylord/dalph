import { Context, Data, Effect, Match, Option, Ref, Stream, SubscriptionRef } from "effect"
import type { OperationId } from "../../workflow/identity.js"
import type { DeliveryAdmissionReservation, DeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { currentSignalFromCurrentFirstStream, type CurrentSignal, type DeliveryRuntimeEvaluation } from "./relations.js"
import type { DeliveryActionProposal, DeliveryProposalId } from "./delivery-action-proposal.js"
import type { FreshTaskCandidate } from "./fresh-task-candidate.js"
import {
  DeliveryActionProtocolAdmissionMissing,
  type DeliveryActionExecutionLease
} from "./delivery-action-executor.js"
import { withPlannedAttemptProtocolPermit } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"

/** The process-local action's intent state after its exact OperationId exists. */
export type DeliveryRuntimeActionIntent = "IntentNotRecorded" | "IntentRecorded"

const FreshTaskCandidateAdmissionAuthorityTypeId: unique symbol = Symbol("@dalph/FreshTaskCandidateAdmissionAuthority")
const TicketProposalAdmissionAuthorityTypeId: unique symbol = Symbol("@dalph/TicketProposalAdmissionAuthority")
const issuedFreshTaskCandidateAdmissions = new WeakMap<object, DeliveryActionProposal>()
const issuedTicketProposalAdmissions = new WeakMap<object, DeliveryActionProposal>()

/** Opaque proof that this process admitted one exact ticket-derived proposal. */
export interface TicketProposalAdmissionAuthority {
  readonly _tag: "TicketProposalAdmission"
  /** Present only on the runtime-issued witness; decoded and synthetic snapshots remain representable but untrusted. */
  readonly [TicketProposalAdmissionAuthorityTypeId]?: typeof TicketProposalAdmissionAuthorityTypeId
}

type IssuedTicketProposalAdmissionAuthority = TicketProposalAdmissionAuthority & {
  readonly [TicketProposalAdmissionAuthorityTypeId]: typeof TicketProposalAdmissionAuthorityTypeId
}

/** Exact authority under which runtime admitted a process-local action owner. */
export type DeliveryRuntimeLiveOwnerAdmissionAuthority =
  | {
      readonly _tag: "FreshTaskCandidateAdmission"
      readonly [FreshTaskCandidateAdmissionAuthorityTypeId]: typeof FreshTaskCandidateAdmissionAuthorityTypeId
      readonly candidate: FreshTaskCandidate
    }
  | TicketProposalAdmissionAuthority

const ticketProposalAdmissionAuthorityOf = (proposal: DeliveryActionProposal): TicketProposalAdmissionAuthority => {
  const authority: IssuedTicketProposalAdmissionAuthority = {
    _tag: "TicketProposalAdmission",
    [TicketProposalAdmissionAuthorityTypeId]: TicketProposalAdmissionAuthorityTypeId
  }
  Object.freeze(authority)
  issuedTicketProposalAdmissions.set(authority, proposal)
  return authority
}

/** Returns the exact proposal bound to an opaque process-local admission witness. */
export const admittedProposalFor = (
  authority: DeliveryRuntimeLiveOwnerAdmissionAuthority
): DeliveryActionProposal | undefined =>
  authority._tag === "TicketProposalAdmission"
    ? issuedTicketProposalAdmissions.get(authority)
    : issuedFreshTaskCandidateAdmissions.get(authority)

type DeliveryRuntimeLiveOwnerLifecycle = Data.TaggedEnum<{
  AdmittedDeliveryAction: Record<never, never>
  MaterializedDeliveryAction: { readonly intent: DeliveryRuntimeActionIntent; readonly operationId: OperationId }
  SettledBeforeMaterialization: Record<never, never>
  SettledMaterializedDeliveryAction: { readonly intent: DeliveryRuntimeActionIntent; readonly operationId: OperationId }
}>

const DeliveryRuntimeLiveOwnerLifecycle = Data.taggedEnum<DeliveryRuntimeLiveOwnerLifecycle>()

/** The exhaustive process-local state retained for one action owner without exposing mutable refs. */
export type DeliveryRuntimeLiveOwnerSnapshot = Data.TaggedEnum<{
  AdmittedDeliveryAction: {
    readonly admissionAuthority: DeliveryRuntimeLiveOwnerAdmissionAuthority
    readonly proposal: DeliveryActionProposal
  }
  MaterializedDeliveryAction: {
    readonly admissionAuthority: DeliveryRuntimeLiveOwnerAdmissionAuthority
    readonly intent: DeliveryRuntimeActionIntent
    readonly operationId: OperationId
    readonly proposal: DeliveryActionProposal
  }
  SettledBeforeMaterialization: {
    readonly admissionAuthority: DeliveryRuntimeLiveOwnerAdmissionAuthority
    readonly proposal: DeliveryActionProposal
  }
  SettledMaterializedDeliveryAction: {
    readonly admissionAuthority: DeliveryRuntimeLiveOwnerAdmissionAuthority
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
  admissionAuthority: DeliveryRuntimeLiveOwnerAdmissionAuthority,
  proposal: DeliveryActionProposal,
  lifecycle: DeliveryRuntimeLiveOwnerLifecycle
): DeliveryRuntimeLiveOwnerSnapshot => {
  return Match.valueTags(lifecycle, {
    AdmittedDeliveryAction: () =>
      DeliveryRuntimeLiveOwnerSnapshot.AdmittedDeliveryAction({ admissionAuthority, proposal }),
    MaterializedDeliveryAction: ({ intent, operationId }) =>
      DeliveryRuntimeLiveOwnerSnapshot.MaterializedDeliveryAction({
        admissionAuthority,
        intent,
        operationId,
        proposal
      }),
    SettledBeforeMaterialization: () =>
      DeliveryRuntimeLiveOwnerSnapshot.SettledBeforeMaterialization({ admissionAuthority, proposal }),
    SettledMaterializedDeliveryAction: ({ intent, operationId }) =>
      DeliveryRuntimeLiveOwnerSnapshot.SettledMaterializedDeliveryAction({
        admissionAuthority,
        intent,
        operationId,
        proposal
      })
  })
}

/** Creates the sole mutation authority for one admitted proposal's process-local owner lifecycle. */
export const makeDeliveryRuntimeLiveOwner = Effect.fn("DeliveryRuntime.makeLiveOwner")(function* (
  reservation: DeliveryAdmissionReservation
) {
  const lifecycle = yield* Ref.make<DeliveryRuntimeLiveOwnerLifecycle>(
    DeliveryRuntimeLiveOwnerLifecycle.AdmittedDeliveryAction()
  )
  const proposal = reservation.proposal
  const admissionAuthority: DeliveryRuntimeLiveOwnerAdmissionAuthority =
    reservation.freshTaskCandidate === null
      ? ticketProposalAdmissionAuthorityOf(proposal)
      : Object.freeze<DeliveryRuntimeLiveOwnerAdmissionAuthority>({
          _tag: "FreshTaskCandidateAdmission",
          [FreshTaskCandidateAdmissionAuthorityTypeId]: FreshTaskCandidateAdmissionAuthorityTypeId,
          candidate: reservation.freshTaskCandidate
        })
  if (admissionAuthority._tag === "FreshTaskCandidateAdmission") {
    issuedFreshTaskCandidateAdmissions.set(admissionAuthority, proposal)
  }

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
    snapshot: Ref.get(lifecycle).pipe(Effect.map((current) => ownerSnapshot(admissionAuthority, proposal, current)))
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
  bindPlannedAttemptPosition: (plannedAttempt, acceptedResponsibility) => {
    const requirement = owner.proposal.admission.taskWorkPosition
    return requirement._tag === "TaskWorkPositionRequired" && requirement.taskId === plannedAttempt.taskId
      ? admission.bindPlannedAttemptPosition(owner.reservation, plannedAttempt, acceptedResponsibility)
      : Effect.die(`planned-attempt position does not match proposal ${owner.proposal.id}`)
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

interface DeliveryRuntimeObservationObserverService {
  readonly observe: (observation: DeliveryRuntimeReadyObservation) => Effect.Effect<void>
}

/** Optional passive observer of each process-local runtime publication; production is inert by default. */
export const DeliveryRuntimeObservationObserver = Context.Reference<DeliveryRuntimeObservationObserverService>(
  "@dalph/DeliveryRuntimeObservationObserver",
  { defaultValue: () => ({ observe: () => Effect.void }) }
)

export type DeliveryRuntimeObservationState = Data.TaggedEnum<{
  Closed: { readonly final: DeliveryRuntimeReadyObservation | null }
  NotReady: Record<never, never>
  Ready: DeliveryRuntimeReadyFields
}>

export const DeliveryRuntimeObservationState = Data.taggedEnum<DeliveryRuntimeObservationState>()

export interface DeliveryRuntimeObservationPublicationService {
  readonly close: Effect.Effect<void>
  /** Observes an internal transition without publishing it as coherent current state. */
  readonly observe: (
    evaluation: DeliveryRuntimeEvaluation,
    liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
  ) => Effect.Effect<void>
  readonly publish: (
    evaluation: DeliveryRuntimeEvaluation,
    liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
  ) => Effect.Effect<void>
  /** Publishes a coherent current state already reported through observe. */
  readonly publishCurrent: (
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
    const observationOf = (
      evaluation: DeliveryRuntimeEvaluation,
      liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
    ) => DeliveryRuntimeObservationState.Ready({ evaluation, liveOwners: [...liveOwners] })
    const publishCurrent = (
      evaluation: DeliveryRuntimeEvaluation,
      liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
    ) =>
      SubscriptionRef.update(state, (current) =>
        current._tag === "Closed" ? current : observationOf(evaluation, liveOwners)
      )

    return {
      close: SubscriptionRef.update(state, (current) =>
        DeliveryRuntimeObservationState.Closed({
          final: Match.valueTags(current, {
            Closed: ({ final }) => final,
            NotReady: () => null,
            Ready: (ready) => ready
          })
        })
      ),
      observe: (evaluation, liveOwners) => observer.observe(observationOf(evaluation, liveOwners)),
      publish: (evaluation, liveOwners) =>
        Effect.gen(function* () {
          const observation = observationOf(evaluation, liveOwners)
          const published = yield* SubscriptionRef.modify(state, (current) =>
            current._tag === "Closed" ? [false, current] : [true, observation]
          )
          if (published) yield* observer.observe(observation)
        }),
      publishCurrent,
      signal: currentSignalFromCurrentFirstStream(
        SubscriptionRef.changes(state).pipe(Stream.takeUntil(({ _tag }) => _tag === "Closed"))
      )
    } satisfies DeliveryRuntimeObservationController
  }
)
