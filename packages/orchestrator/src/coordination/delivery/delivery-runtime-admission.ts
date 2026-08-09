import type { PlannedAttemptExecutorCorrelation, TaskId } from "@dalph/contracts"
import { Effect, Option, Ref } from "effect"
import type { DeliveryProposalId, DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import type { DeliveryActionProposal, TaskWorkPositionRequirement } from "./delivery-action-proposal.js"
import type {
  IntegrationTargetResourceController,
  IntegrationTargetResourceResponsibility
} from "../admission/integration-target-resource.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"

type TaskWorkPosition =
  | { readonly _tag: "AcceptedAttemptPosition"; readonly correlation: PlannedAttemptExecutorCorrelation }
  | {
      readonly _tag: "BoundRuntimePosition"
      readonly correlation: PlannedAttemptExecutorCorrelation
      readonly proposalId: DeliveryProposalId
    }
  | { readonly _tag: "PendingRuntimePosition"; readonly proposalId: DeliveryProposalId }

interface AdmissionState {
  readonly capacity: DeliveryTaskWorkAdmissionBasis["capacity"]
  readonly positions: ReadonlyMap<TaskId, TaskWorkPosition>
}

const DeliveryAdmissionReservationTypeId: unique symbol = Symbol.for("@dalph/DeliveryAdmissionReservation")

interface DeliveryAdmissionReservationBase {
  readonly [DeliveryAdmissionReservationTypeId]: typeof DeliveryAdmissionReservationTypeId
  readonly acquiredIntegrationResponsibility: IntegrationTargetResourceResponsibility | null
  readonly createdTaskPositionFor: TaskId | null
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
  readonly bindPlannedAttemptPosition: (
    taskId: TaskId,
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<void>
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
      }
  >
}

const sameCorrelation = (
  left: PlannedAttemptExecutorCorrelation | undefined,
  right: PlannedAttemptExecutorCorrelation
): boolean => left?.attemptId === right.attemptId && left.runId === right.runId

interface TaskPositionReservation {
  readonly admitted: boolean
  readonly createdFor: TaskId | null
}

type PlannedAttemptProtocolReservation =
  | { readonly _tag: "NoPlannedAttemptProtocolAdmission"; readonly proposal: DeliveryActionProposal }
  | {
      readonly _tag: "PlannedAttemptProtocolAdmitted"
      readonly permit: PlannedAttemptProtocolPermit
      readonly proposal: DeliveryActionProposal
    }
  | { readonly _tag: "PlannedAttemptProtocolUnavailable" }

type ExistingTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "Existing" }>
type ReusableTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "ReserveOrReuse" }>

const unchangedTaskReservation = (
  admitted: boolean,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => [{ admitted, createdFor: null }, current]

const reserveExistingTaskPosition = (
  requirement: ExistingTaskPositionRequirement,
  correlation: PlannedAttemptExecutorCorrelation,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const existing = current.positions.get(requirement.taskId)
  return unchangedTaskReservation(
    existing !== undefined &&
      existing._tag !== "PendingRuntimePosition" &&
      sameCorrelation(existing.correlation, correlation),
    current
  )
}

const reserveReusableTaskPosition = (
  proposal: DeliveryActionProposal,
  requirement: ReusableTaskPositionRequirement,
  retainAs: PlannedAttemptExecutorCorrelation | undefined,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const existing = current.positions.get(requirement.taskId)
  if (existing !== undefined) {
    if (retainAs === undefined) return unchangedTaskReservation(true, current)
    if (existing._tag !== "PendingRuntimePosition") {
      return unchangedTaskReservation(sameCorrelation(existing.correlation, retainAs), current)
    }
    return [
      { admitted: true, createdFor: null },
      {
        ...current,
        positions: new Map(current.positions).set(requirement.taskId, {
          _tag: "BoundRuntimePosition",
          correlation: retainAs,
          proposalId: existing.proposalId
        })
      }
    ]
  }
  if (current.positions.size >= current.capacity) return unchangedTaskReservation(false, current)
  const position: TaskWorkPosition =
    retainAs === undefined
      ? { _tag: "PendingRuntimePosition", proposalId: proposal.id }
      : { _tag: "BoundRuntimePosition", correlation: retainAs, proposalId: proposal.id }
  return [
    { admitted: true, createdFor: requirement.taskId },
    { ...current, positions: new Map(current.positions).set(requirement.taskId, position) }
  ]
}

const reserveTaskPositionState = (
  proposal: DeliveryActionProposal,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const admission = proposal.admission
  const requirement = admission.taskWorkPosition
  if (requirement._tag === "NoTaskWorkPosition") return unchangedTaskReservation(true, current)
  if (requirement.mode === "Existing") {
    /* v8 ignore start -- DeliveryAdmissionRequirements makes Existing without an exact correlation unconstructible. */
    if (admission.plannedAttemptProtocol._tag !== "PlannedAttemptProtocolRequired") {
      return unchangedTaskReservation(false, current)
    }
    /* v8 ignore stop */
    return reserveExistingTaskPosition(requirement, admission.plannedAttemptProtocol.correlation, current)
  }
  const retainAs =
    admission.plannedAttemptProtocol._tag === "PlannedAttemptProtocolRequired"
      ? admission.plannedAttemptProtocol.correlation
      : undefined
  return reserveReusableTaskPosition(proposal, requirement, retainAs, current)
}

/**
 * Owns proposal-native positions without inspecting action route tags.
 *
 * TODO: this is the adoption half of crash recovery — `initial.held` and
 * `synchronize` take the positions that `activeAttemptPositions` in
 * ./reactive-delivery-relations.ts derives from the journal. It is the only
 * production surface an MBT driver can observe crash recovery through, and the
 * existing driver
 * (packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts) always
 * constructs it with `held: []`, so restart-with-prior-allocations is never
 * exercised. `specs/plannedAttemptExecutor.qnt` has no crash action and holds
 * the correlation in constants, so it cannot express identity preserved across
 * a restart. See I8, I9 and I16 in research/verification-bakeoff/INVARIANTS.md.
 */
export const makeDeliveryRuntimeAdmissionController = Effect.fn("DeliveryRuntimeAdmission.make")(function* (
  initial: DeliveryTaskWorkAdmissionBasis,
  integrationTargets: IntegrationTargetResourceController
): Effect.fn.Return<DeliveryRuntimeAdmissionController, never, PlannedAttemptProtocolController> {
  const plannedAttemptProtocol = yield* PlannedAttemptProtocolController
  const state = yield* Ref.make<AdmissionState>({
    capacity: initial.capacity,
    positions: new Map(
      initial.held.map(({ correlation, taskId }) => [
        taskId,
        { _tag: "AcceptedAttemptPosition" as const, correlation } satisfies TaskWorkPosition
      ])
    )
  })

  const synchronize = Effect.fn("DeliveryRuntimeAdmission.synchronize")((basis: DeliveryTaskWorkAdmissionBasis) =>
    Ref.update(state, (current) => {
      const accepted = new Map(basis.held.map(({ correlation, taskId }) => [taskId, correlation] as const))
      const positions = new Map(
        [...current.positions].filter(
          ([taskId, position]) => position._tag !== "AcceptedAttemptPosition" || accepted.has(taskId)
        )
      )
      for (const [taskId, correlation] of accepted) {
        const currentPosition = positions.get(taskId)
        if (currentPosition === undefined || currentPosition._tag === "AcceptedAttemptPosition") {
          positions.set(taskId, { _tag: "AcceptedAttemptPosition", correlation })
        } else if (currentPosition._tag === "PendingRuntimePosition") {
          positions.set(taskId, { _tag: "BoundRuntimePosition", correlation, proposalId: currentPosition.proposalId })
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
      if (position === undefined || position._tag === "AcceptedAttemptPosition" || position.proposalId !== proposalId)
        return current
      const positions = new Map(current.positions)
      positions.delete(taskId)
      return { ...current, positions }
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
      Effect.gen(function* () {
        const protocol = yield* reservePlannedAttemptProtocol(proposal)
        if (protocol._tag === "PlannedAttemptProtocolUnavailable") {
          return { _tag: "Deferred" as const, reason: "PlannedAttemptProtocolUnavailable" as const }
        }
        const task = yield* reserveTaskPosition(proposal)
        if (!task.admitted) {
          if (protocol._tag === "PlannedAttemptProtocolAdmitted") yield* protocol.permit.release
          return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
        }
        const integration = yield* reserveIntegration(proposal)
        if (!integration.admitted) {
          if (task.createdFor !== null) yield* releaseTaskReservation(task.createdFor, proposal.id)
          if (protocol._tag === "PlannedAttemptProtocolAdmitted") yield* protocol.permit.release
          return { _tag: "Deferred" as const, reason: "IntegrationTargetUnavailable" as const }
        }
        const base = {
          [DeliveryAdmissionReservationTypeId]: DeliveryAdmissionReservationTypeId,
          acquiredIntegrationResponsibility: integration.acquired,
          createdTaskPositionFor: task.createdFor
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
  })

  const complete = Effect.fn("DeliveryRuntimeAdmission.complete")(function* (
    reservation: DeliveryAdmissionReservation
  ) {
    if (
      reservation.createdTaskPositionFor !== null &&
      reservation.proposal.admission.plannedAttemptProtocol._tag === "NoPlannedAttemptProtocol"
    ) {
      yield* releaseTaskReservation(reservation.createdTaskPositionFor, reservation.proposal.id)
    }
    if (reservation._tag === "PlannedAttemptProtocolAdmission") yield* reservation.permit.release
  })

  return {
    bindPlannedAttemptPosition: (taskId, correlation) =>
      Ref.update(state, (current) => {
        const position = current.positions.get(taskId)
        if (position === undefined || position._tag === "AcceptedAttemptPosition") return current
        return {
          ...current,
          positions: new Map(current.positions).set(taskId, {
            _tag: "BoundRuntimePosition",
            correlation,
            proposalId: position.proposalId
          })
        }
      }),
    releasePlannedAttemptPosition: (correlation) =>
      Ref.update(state, (current) => {
        const found = [...current.positions].find(
          ([, position]) =>
            position._tag !== "PendingRuntimePosition" && sameCorrelation(position.correlation, correlation)
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
