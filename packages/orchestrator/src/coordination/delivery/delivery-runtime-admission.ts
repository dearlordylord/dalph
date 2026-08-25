/* eslint-disable functional/immutable-data -- Admission updates copy one local map inside each atomic Ref transition. */
/* eslint-disable max-lines -- Exact task-work position binding and lifecycle cleanup remain one admission boundary. */
import type { PlannedAttemptExecutorCorrelation, TaskId } from "@dalph/contracts"
import { Effect, Option, Ref } from "effect"
import type { DeliveryProposalId, DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import type { OperationId } from "../../workflow/identity.js"
import type {
  IntegrationTargetResourceController,
  IntegrationTargetResourceResponsibility
} from "../admission/integration-target-resource.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  type ApplicationExitAdmissionService,
  type AtomicForwardOwnerLease,
  type InterruptibleForwardOwnerLease
} from "../application-exit/lifecycle.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import { integrationExitBoundaryFamilyFor } from "./integration-exit-boundary.js"
import {
  failExecutorPlanBinding,
  failPreStartClaimBinding,
  failPreStartPlanBinding,
  isPreStartRequirement,
  positionCorrelationOf,
  preStartPositionOf,
  reserveTaskPositionState,
  sameCorrelation,
  sameOperationId,
  type AdmissionState,
  type DeliveryTaskWorkPositionBindingContradiction,
  type TaskWorkPosition
} from "./delivery-runtime-task-work-position.js"

const DeliveryAdmissionReservationTypeId: unique symbol = Symbol.for("@dalph/DeliveryAdmissionReservation")

type DeliveryForwardOwnerLease = AtomicForwardOwnerLease | InterruptibleForwardOwnerLease

type PreStartClaimBindingFailure = Parameters<typeof failPreStartClaimBinding>[0]
type PreStartPlanBindingFailure = Parameters<typeof failPreStartPlanBinding>[0]
type ExecutorPlanBindingFailure = Parameters<typeof failExecutorPlanBinding>[0]
type BindingResult<Failure> = { readonly _tag: "Success" } | { readonly _tag: "Failure"; readonly failure: Failure }

interface DeliveryAdmissionReservationBase {
  readonly [DeliveryAdmissionReservationTypeId]: typeof DeliveryAdmissionReservationTypeId
  readonly acquiredIntegrationResponsibility: IntegrationTargetResourceResponsibility | null
  readonly createdTaskPositionFor: TaskId | null
  readonly forwardOwner: DeliveryForwardOwnerLease
}

/** Opaque admission ownership is either exact-attempt guarded or carries no protocol resource. */
export type DeliveryAdmissionReservation =
  | (DeliveryAdmissionReservationBase & {
      readonly _tag: "PlannedAttemptProtocolAdmission"
      readonly permit: PlannedAttemptProtocolPermit
      readonly proposal: DeliveryActionProposal
    })
  | (DeliveryAdmissionReservationBase & {
      readonly _tag: "NoPlannedAttemptProtocolAdmission"
      readonly proposal: DeliveryActionProposal
    })

export interface DeliveryRuntimeAdmissionController {
  readonly bindPreStartTaskWorkPosition: (
    taskId: TaskId,
    claimOperationId: OperationId
  ) => Effect.Effect<void, DeliveryTaskWorkPositionBindingContradiction>
  readonly bindPreStartPlannedAttemptPosition: (
    taskId: TaskId,
    claimOperationId: OperationId,
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<void, DeliveryTaskWorkPositionBindingContradiction>
  readonly bindPlannedAttemptPosition: (
    taskId: TaskId,
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<void, DeliveryTaskWorkPositionBindingContradiction>
  readonly releasePlannedAttemptPosition: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<void>
  readonly complete: (reservation: DeliveryAdmissionReservation) => Effect.Effect<void>
  readonly rollback: (
    reservation: DeliveryAdmissionReservation,
    retainTaskPositionAfterIntent: boolean
  ) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<AdmissionState>
  readonly synchronize: (basis: DeliveryTaskWorkAdmissionBasis) => Effect.Effect<void>
  readonly tryReserve: (
    proposal: DeliveryActionProposal
  ) => Effect.Effect<
    | { readonly _tag: "Admitted"; readonly reservation: DeliveryAdmissionReservation }
    | {
        readonly _tag: "Deferred"
        readonly reason:
          | "IntegrationTargetUnavailable"
          | "PlannedAttemptProtocolUnavailable"
          | "TaskWorkPositionUnavailable"
      },
    ApplicationExiting
  >
}

/** Integration-family actions own one indivisible protocol section; every other route retains interruptible calls. */
const forwardOwnerKindFor = (proposal: DeliveryActionProposal): DeliveryForwardOwnerLease["kind"] => {
  const route = proposal.route
  return route._tag === "IdentityFreeWorkflowRoute" && integrationExitBoundaryFamilyFor(route.transition) !== null
    ? "AtomicBoundary"
    : "InterruptibleBoundary"
}

type PlannedAttemptProtocolReservation =
  | { readonly _tag: "NoPlannedAttemptProtocolAdmission"; readonly proposal: DeliveryActionProposal }
  | {
      readonly _tag: "PlannedAttemptProtocolAdmitted"
      readonly permit: PlannedAttemptProtocolPermit
      readonly proposal: DeliveryActionProposal
    }
  | { readonly _tag: "PlannedAttemptProtocolUnavailable" }

/**
 * Owns proposal-native positions without inspecting action route tags. The
 * initial basis and later synchronization adopt the exact positions that
 * ordinary relation publication derives from accepted journal history.
 */
export const makeDeliveryRuntimeAdmissionController = Effect.fn("DeliveryRuntimeAdmission.make")(function* (
  initial: DeliveryTaskWorkAdmissionBasis,
  integrationTargets: IntegrationTargetResourceController,
  applicationExit: ApplicationExitAdmissionService
): Effect.fn.Return<DeliveryRuntimeAdmissionController, never, PlannedAttemptProtocolController> {
  const plannedAttemptProtocol = yield* PlannedAttemptProtocolController
  const state = yield* Ref.make<AdmissionState>({
    capacity: initial.capacity,
    positions: new Map([
      ...initial.preStart.map((position) => [position.taskId, preStartPositionOf(position)] as const),
      ...initial.held.map(
        ({ correlation, taskId }) =>
          [taskId, { _tag: "AcceptedAttemptPosition" as const, correlation } satisfies TaskWorkPosition] as const
      )
    ])
  })

  const synchronize = Effect.fn("DeliveryRuntimeAdmission.synchronize")((basis: DeliveryTaskWorkAdmissionBasis) =>
    Ref.update(state, (current) => {
      const accepted = new Map(basis.held.map(({ correlation, taskId }) => [taskId, correlation] as const))
      const preStart = new Map(basis.preStart.map((position) => [position.taskId, position] as const))
      const positions = new Map<TaskId, TaskWorkPosition>()
      for (const [taskId, position] of current.positions) {
        if (position._tag === "AcceptedAttemptPosition") {
          // A publication can be older than the executor report from which
          // this process reconstructed the position. Preserve exactly one
          // omission; a second consecutive omission is the authoritative release.
          positions.set(
            taskId,
            accepted.has(taskId) ? position : { ...position, _tag: "AcceptedAttemptPositionOmittedOnce" }
          )
        } else if (position._tag === "AcceptedAttemptPositionOmittedOnce") {
          if (accepted.has(taskId)) positions.set(taskId, { ...position, _tag: "AcceptedAttemptPosition" })
        } else if (position._tag === "DurablePreStartPosition") {
          const required = preStart.get(taskId)
          if (
            required?._tag === "UnplannedPreStartTaskWorkPosition" &&
            sameOperationId(required.claimOperationId, position.claimOperationId)
          )
            positions.set(taskId, position)
        } else if (position._tag === "DurablePlannedPreStartPosition") {
          const required = preStart.get(taskId)
          if (
            required?._tag === "PlannedPreStartTaskWorkPosition" &&
            sameOperationId(required.claimOperationId, position.claimOperationId) &&
            sameCorrelation(required.correlation, position.correlation)
          )
            positions.set(taskId, position)
        } else {
          // Live reservations remain authoritative until complete or rollback.
          positions.set(taskId, position)
        }
      }
      for (const [taskId, correlation] of accepted) {
        const currentPosition = positions.get(taskId)
        if (
          currentPosition === undefined ||
          currentPosition._tag === "AcceptedAttemptPosition" ||
          currentPosition._tag === "AcceptedAttemptPositionOmittedOnce" ||
          currentPosition._tag === "DurablePreStartPosition" ||
          currentPosition._tag === "DurablePlannedPreStartPosition" ||
          currentPosition._tag === "BoundPreStartRuntimePosition"
        ) {
          positions.set(taskId, { _tag: "AcceptedAttemptPosition", correlation })
        } else if (currentPosition._tag === "PendingRuntimePosition") {
          positions.set(taskId, { _tag: "BoundRuntimePosition", correlation, proposalId: currentPosition.proposalId })
        }
      }
      for (const [taskId, required] of preStart) {
        if (accepted.has(taskId)) continue
        const currentPosition = positions.get(taskId)
        if (currentPosition === undefined) {
          positions.set(taskId, preStartPositionOf(required))
        } else if (required._tag === "PlannedPreStartTaskWorkPosition") {
          if (currentPosition._tag === "PendingRuntimePosition") {
            positions.set(taskId, {
              _tag: "BoundPreStartRuntimePosition",
              claimOperationId: required.claimOperationId,
              proposalId: currentPosition.proposalId
            })
          } else if (currentPosition._tag === "BoundPreStartRuntimePosition") {
            if (sameOperationId(currentPosition.claimOperationId, required.claimOperationId)) {
              positions.set(taskId, {
                _tag: "DurablePlannedPreStartPosition",
                claimOperationId: required.claimOperationId,
                correlation: required.correlation
              })
            }
          } else if (
            currentPosition._tag === "DurablePreStartPosition" ||
            currentPosition._tag === "DurablePlannedPreStartPosition"
          ) {
            positions.set(taskId, preStartPositionOf(required))
          }
        } else if (currentPosition._tag === "DurablePlannedPreStartPosition") {
          if (sameOperationId(currentPosition.claimOperationId, required.claimOperationId)) {
            positions.set(taskId, { _tag: "DurablePreStartPosition", claimOperationId: required.claimOperationId })
          }
        }
      }
      return { ...current, capacity: basis.capacity, positions }
    })
  )

  const reservePlannedAttemptProtocol = Effect.fn("DeliveryRuntimeAdmission.reservePlannedAttemptProtocol")(function* (
    proposal: DeliveryActionProposal
  ): Effect.fn.Return<PlannedAttemptProtocolReservation> {
    const requirement = proposal.admission.plannedAttemptProtocol
    if (requirement._tag === "NoPlannedAttemptProtocol") {
      return { _tag: "NoPlannedAttemptProtocolAdmission", proposal }
    }
    const permit = yield* plannedAttemptProtocol.reserve(requirement.correlation)
    return Option.isSome(permit)
      ? { _tag: "PlannedAttemptProtocolAdmitted", permit: permit.value, proposal }
      : { _tag: "PlannedAttemptProtocolUnavailable" }
  })

  const reserveTaskPosition = (proposal: DeliveryActionProposal) =>
    Ref.modify(state, (current) => reserveTaskPositionState(proposal, current))

  const releaseTaskReservation = (taskId: TaskId, proposalId: DeliveryProposalId) =>
    Ref.update(state, (current) => {
      const position = current.positions.get(taskId)
      if (
        position === undefined ||
        position._tag === "AcceptedAttemptPosition" ||
        position._tag === "AcceptedAttemptPositionOmittedOnce" ||
        position._tag === "DurablePreStartPosition" ||
        position._tag === "DurablePlannedPreStartPosition" ||
        position.proposalId !== proposalId
      )
        return current
      const positions = new Map(current.positions)
      positions.delete(taskId)
      return { ...current, positions }
    })

  const retainCompletedPreStartReservation = (taskId: TaskId, proposalId: DeliveryProposalId) =>
    Ref.update(state, (current) => {
      const position = current.positions.get(taskId)
      if (
        position === undefined ||
        position._tag === "AcceptedAttemptPosition" ||
        position._tag === "AcceptedAttemptPositionOmittedOnce"
      )
        return current
      if (position._tag === "PendingRuntimePosition" && position.proposalId === proposalId) {
        return current
      }
      if (position._tag === "BoundPreStartRuntimePosition" && position.proposalId === proposalId) {
        const positions = new Map(current.positions)
        positions.set(taskId, { _tag: "DurablePreStartPosition", claimOperationId: position.claimOperationId })
        return { ...current, positions }
      }
      return current
    })

  const reserveIntegration = Effect.fn("DeliveryRuntimeAdmission.reserveIntegration")(function* (
    proposal: DeliveryActionProposal
  ) {
    const requirement = proposal.admission.integrationTarget
    if (requirement._tag === "NoIntegrationTargetResource") {
      return { admitted: true, acquired: null }
    }
    const responsibility = { integrationTarget: requirement.integrationTarget, queuedAt: requirement.queuedAt }
    if (requirement.access === "Acquire") {
      const result = yield* integrationTargets.acquire(responsibility).pipe(Effect.result)
      return result._tag === "Success"
        ? { admitted: true, acquired: responsibility }
        : { admitted: false, acquired: null }
    }
    const snapshot = yield* integrationTargets.snapshot
    return { admitted: snapshot.heldResponsibilityPositions.has(requirement.queuedAt), acquired: null }
  })

  const tryReserve = Effect.fn("DeliveryRuntimeAdmission.tryReserve")((proposal: DeliveryActionProposal) =>
    Effect.uninterruptible(
      // eslint-disable-next-line complexity -- One transaction reserves and rolls back every declared proposal resource before exact owner registration.
      Effect.gen(function* () {
        const forwardOwner = yield* applicationExit.prepareForwardOwner(forwardOwnerKindFor(proposal))
        const protocol = yield* reservePlannedAttemptProtocol(proposal)
        if (protocol._tag === "PlannedAttemptProtocolUnavailable") {
          yield* forwardOwner.cancel
          return { _tag: "Deferred" as const, reason: "PlannedAttemptProtocolUnavailable" as const }
        }
        const task = yield* reserveTaskPosition(proposal)
        if (!task.admitted) {
          if (protocol._tag === "PlannedAttemptProtocolAdmitted") yield* protocol.permit.release
          yield* forwardOwner.cancel
          return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
        }
        const integration = yield* reserveIntegration(proposal)
        if (!integration.admitted) {
          if (task.createdFor !== null) yield* releaseTaskReservation(task.createdFor, proposal.id)
          if (protocol._tag === "PlannedAttemptProtocolAdmitted") yield* protocol.permit.release
          yield* forwardOwner.cancel
          return { _tag: "Deferred" as const, reason: "IntegrationTargetUnavailable" as const }
        }
        const registeredOwner = yield* forwardOwner.register.pipe(
          Effect.onError(() =>
            Effect.gen(function* () {
              if (integration.acquired !== null) yield* integrationTargets.release(integration.acquired)
              if (task.createdFor !== null) yield* releaseTaskReservation(task.createdFor, proposal.id)
              if (protocol._tag === "PlannedAttemptProtocolAdmitted") yield* protocol.permit.release
              yield* forwardOwner.cancel
            })
          )
        )
        /* v8 ignore next -- @preserve ApplicationExitAdmission exposes only AtomicBoundary or InterruptibleBoundary forward owners. */
        if (registeredOwner.kind !== "AtomicBoundary" && registeredOwner.kind !== "InterruptibleBoundary") {
          return yield* Effect.die(`delivery admission registered unsupported owner ${registeredOwner.kind}`)
        }
        const base = {
          [DeliveryAdmissionReservationTypeId]: DeliveryAdmissionReservationTypeId,
          acquiredIntegrationResponsibility: integration.acquired,
          createdTaskPositionFor: task.createdFor,
          forwardOwner: registeredOwner
        } satisfies DeliveryAdmissionReservationBase
        return {
          _tag: "Admitted" as const,
          reservation:
            protocol._tag === "NoPlannedAttemptProtocolAdmission"
              ? ({ ...base, _tag: "NoPlannedAttemptProtocolAdmission", proposal: protocol.proposal } as const)
              : ({
                  ...base,
                  _tag: "PlannedAttemptProtocolAdmission",
                  permit: protocol.permit,
                  proposal: protocol.proposal
                } as const)
        }
      })
    )
  )

  const rollback = Effect.fn("DeliveryRuntimeAdmission.rollback")(function* (
    reservation: DeliveryAdmissionReservation,
    retainTaskPositionAfterIntent: boolean
  ) {
    if (reservation.createdTaskPositionFor !== null && !retainTaskPositionAfterIntent) {
      yield* releaseTaskReservation(reservation.createdTaskPositionFor, reservation.proposal.id)
    }
    if (reservation.acquiredIntegrationResponsibility !== null) {
      yield* integrationTargets.release(reservation.acquiredIntegrationResponsibility)
    }
    if (reservation._tag === "PlannedAttemptProtocolAdmission") yield* reservation.permit.release
    yield* reservation.forwardOwner.release
  })

  const complete = Effect.fn("DeliveryRuntimeAdmission.complete")(function* (
    reservation: DeliveryAdmissionReservation
  ) {
    if (reservation.createdTaskPositionFor !== null) {
      const requirement = reservation.proposal.admission.taskWorkPosition
      if (isPreStartRequirement(requirement)) {
        yield* retainCompletedPreStartReservation(reservation.createdTaskPositionFor, reservation.proposal.id)
      } else if (reservation.proposal.admission.plannedAttemptProtocol._tag === "NoPlannedAttemptProtocol") {
        yield* releaseTaskReservation(reservation.createdTaskPositionFor, reservation.proposal.id)
      }
    }
    if (reservation._tag === "PlannedAttemptProtocolAdmission") yield* reservation.permit.release
    yield* reservation.forwardOwner.release
  })

  const bindPreStartTaskWorkPosition = Effect.fn("DeliveryRuntimeAdmission.bindPreStartTaskWorkPosition")(function* (
    taskId: TaskId,
    claimOperationId: OperationId
  ) {
    const result = yield* Ref.modify(
      state,
      (current): readonly [BindingResult<PreStartClaimBindingFailure>, AdmissionState] => {
        const position = current.positions.get(taskId)
        if (position === undefined) {
          return [
            {
              _tag: "Failure" as const,
              failure: { claimOperationId, reason: "PositionMissing" as const, taskId, position }
            },
            current
          ] as const
        }
        if (position._tag === "PendingRuntimePosition") {
          return [
            { _tag: "Success" as const },
            {
              ...current,
              positions: new Map(current.positions).set(taskId, {
                _tag: "BoundPreStartRuntimePosition",
                claimOperationId,
                proposalId: position.proposalId
              })
            }
          ] as const
        }
        if (
          position._tag === "BoundPreStartRuntimePosition" ||
          position._tag === "DurablePreStartPosition" ||
          position._tag === "DurablePlannedPreStartPosition"
        ) {
          return sameOperationId(position.claimOperationId, claimOperationId)
            ? ([{ _tag: "Success" as const }, current] as const)
            : ([
                {
                  _tag: "Failure" as const,
                  failure: { claimOperationId, reason: "ClaimOperationMismatch" as const, taskId, position }
                },
                current
              ] as const)
        }
        return [
          {
            _tag: "Failure" as const,
            failure: { claimOperationId, reason: "UnexpectedPositionPhase" as const, taskId, position }
          },
          current
        ] as const
      }
    )
    return yield* result._tag === "Failure" ? failPreStartClaimBinding(result.failure) : Effect.void
  })

  const bindPreStartPlannedAttemptPosition = (
    taskId: TaskId,
    claimOperationId: OperationId,
    correlation: PlannedAttemptExecutorCorrelation
  ) =>
    Effect.gen(function* () {
      const result = yield* Ref.modify(
        state,
        (current): readonly [BindingResult<PreStartPlanBindingFailure>, AdmissionState] => {
          const position = current.positions.get(taskId)
          if (position === undefined) {
            return [
              {
                _tag: "Failure" as const,
                failure: { claimOperationId, correlation, reason: "PositionMissing" as const, taskId, position }
              },
              current
            ] as const
          }
          if (position._tag === "DurablePreStartPosition") {
            return sameOperationId(position.claimOperationId, claimOperationId)
              ? ([
                  { _tag: "Success" as const },
                  {
                    ...current,
                    positions: new Map(current.positions).set(taskId, {
                      _tag: "DurablePlannedPreStartPosition",
                      claimOperationId,
                      correlation
                    })
                  }
                ] as const)
              : ([
                  {
                    _tag: "Failure" as const,
                    failure: {
                      claimOperationId,
                      correlation,
                      reason: "ClaimOperationMismatch" as const,
                      taskId,
                      position
                    }
                  },
                  current
                ] as const)
          }
          if (position._tag === "DurablePlannedPreStartPosition") {
            if (!sameOperationId(position.claimOperationId, claimOperationId)) {
              return [
                {
                  _tag: "Failure" as const,
                  failure: {
                    claimOperationId,
                    correlation,
                    reason: "ClaimOperationMismatch" as const,
                    taskId,
                    position
                  }
                },
                current
              ] as const
            }
            return sameCorrelation(position.correlation, correlation)
              ? ([{ _tag: "Success" as const }, current] as const)
              : ([
                  {
                    _tag: "Failure" as const,
                    failure: {
                      claimOperationId,
                      correlation,
                      reason: "AttemptCorrelationMismatch" as const,
                      taskId,
                      position
                    }
                  },
                  current
                ] as const)
          }
          return [
            {
              _tag: "Failure" as const,
              failure: { claimOperationId, correlation, reason: "UnexpectedPositionPhase" as const, taskId, position }
            },
            current
          ] as const
        }
      )
      return yield* result._tag === "Failure" ? failPreStartPlanBinding(result.failure) : Effect.void
    })

  const bindPlannedAttemptPosition = Effect.fn("DeliveryRuntimeAdmission.bindPlannedAttemptPosition")(function* (
    taskId: TaskId,
    correlation: PlannedAttemptExecutorCorrelation
  ) {
    const result = yield* Ref.modify(
      state,
      (current): readonly [BindingResult<ExecutorPlanBindingFailure>, AdmissionState] => {
        const position = current.positions.get(taskId)
        if (position === undefined) {
          return [
            {
              _tag: "Failure" as const,
              failure: { correlation, reason: "PositionMissing" as const, taskId, position }
            },
            current
          ] as const
        }
        if (position._tag === "PendingRuntimePosition") {
          return [
            { _tag: "Success" as const },
            {
              ...current,
              positions: new Map(current.positions).set(taskId, {
                _tag: "BoundRuntimePosition",
                correlation,
                proposalId: position.proposalId
              })
            }
          ] as const
        }
        if (
          position._tag === "AcceptedAttemptPosition" ||
          position._tag === "AcceptedAttemptPositionOmittedOnce" ||
          position._tag === "BoundRuntimePosition" ||
          position._tag === "DurablePlannedPreStartPosition"
        ) {
          return sameCorrelation(positionCorrelationOf(position), correlation)
            ? ([{ _tag: "Success" as const }, current] as const)
            : ([
                {
                  _tag: "Failure" as const,
                  failure: { correlation, reason: "AttemptCorrelationMismatch" as const, taskId, position }
                },
                current
              ] as const)
        }
        return [
          {
            _tag: "Failure" as const,
            failure: { correlation, reason: "UnexpectedPositionPhase" as const, taskId, position }
          },
          current
        ] as const
      }
    )
    return yield* result._tag === "Failure" ? failExecutorPlanBinding(result.failure) : Effect.void
  })

  return {
    bindPreStartTaskWorkPosition,
    bindPreStartPlannedAttemptPosition,
    bindPlannedAttemptPosition,
    releasePlannedAttemptPosition: (correlation) =>
      Ref.update(state, (current) => {
        const found = [...current.positions].find(
          ([, position]) =>
            position._tag !== "PendingRuntimePosition" && sameCorrelation(positionCorrelationOf(position), correlation)
        )
        if (found === undefined) return current
        const positions = new Map(current.positions)
        positions.delete(found[0])
        return { ...current, positions }
      }),
    complete,
    rollback,
    snapshot: Ref.get(state),
    synchronize,
    tryReserve
  }
})
