import type { PlannedAttemptExecutorCorrelation, TaskId } from "@dalph/contracts"
import { Effect, Ref } from "effect"
import type { DeliveryProposalId, DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import type { DeliveryActionProposal, TaskWorkPositionRequirement } from "./delivery-action-proposal.js"
import type {
  IntegrationTargetResourceController,
  IntegrationTargetResourceResponsibility
} from "../admission/integration-target-resource.js"

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

export interface DeliveryAdmissionReservation {
  readonly acquiredIntegrationResponsibility: IntegrationTargetResourceResponsibility | null
  readonly createdTaskPositionFor: TaskId | null
  readonly proposal: DeliveryActionProposal
}

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
    | { readonly _tag: "Deferred"; readonly reason: "IntegrationTargetUnavailable" | "TaskWorkPositionUnavailable" }
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

type ExistingTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "Existing" }>
type ReusableTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "ReserveOrReuse" }>

const unchangedTaskReservation = (
  admitted: boolean,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => [{ admitted, createdFor: null }, current]

const reserveExistingTaskPosition = (
  requirement: ExistingTaskPositionRequirement,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const existing = current.positions.get(requirement.taskId)
  return unchangedTaskReservation(
    existing !== undefined &&
      existing._tag !== "PendingRuntimePosition" &&
      sameCorrelation(existing.correlation, requirement.correlation),
    current
  )
}

const reserveReusableTaskPosition = (
  proposal: DeliveryActionProposal,
  requirement: ReusableTaskPositionRequirement,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const existing = current.positions.get(requirement.taskId)
  if (existing !== undefined) {
    if (requirement.retainAs === undefined) return unchangedTaskReservation(true, current)
    if (existing._tag !== "PendingRuntimePosition") {
      return unchangedTaskReservation(sameCorrelation(existing.correlation, requirement.retainAs), current)
    }
    return [
      { admitted: true, createdFor: null },
      {
        ...current,
        positions: new Map(current.positions).set(requirement.taskId, {
          _tag: "BoundRuntimePosition",
          correlation: requirement.retainAs,
          proposalId: existing.proposalId
        })
      }
    ]
  }
  if (current.positions.size >= current.capacity) return unchangedTaskReservation(false, current)
  const position: TaskWorkPosition =
    requirement.retainAs === undefined
      ? { _tag: "PendingRuntimePosition", proposalId: proposal.id }
      : { _tag: "BoundRuntimePosition", correlation: requirement.retainAs, proposalId: proposal.id }
  return [
    { admitted: true, createdFor: requirement.taskId },
    { ...current, positions: new Map(current.positions).set(requirement.taskId, position) }
  ]
}

const reserveTaskPositionState = (
  proposal: DeliveryActionProposal,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const requirement = proposal.admission.taskWorkPosition
  if (requirement._tag === "NoTaskWorkPosition") return unchangedTaskReservation(true, current)
  return requirement.mode === "Existing"
    ? reserveExistingTaskPosition(requirement, current)
    : reserveReusableTaskPosition(proposal, requirement, current)
}

/** Owns proposal-native positions without inspecting action route tags. */
export const makeDeliveryRuntimeAdmissionController = Effect.fn("DeliveryRuntimeAdmission.make")(function* (
  initial: DeliveryTaskWorkAdmissionBasis,
  integrationTargets: IntegrationTargetResourceController
): Effect.fn.Return<DeliveryRuntimeAdmissionController> {
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
      return { capacity: basis.capacity, positions }
    })
  )

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

  const tryReserve = Effect.fn("DeliveryRuntimeAdmission.tryReserve")(function* (proposal: DeliveryActionProposal) {
    const task = yield* reserveTaskPosition(proposal)
    if (!task.admitted) {
      return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
    }
    const integration = yield* reserveIntegration(proposal)
    if (!integration.admitted) {
      if (task.createdFor !== null) yield* releaseTaskReservation(task.createdFor, proposal.id)
      return { _tag: "Deferred" as const, reason: "IntegrationTargetUnavailable" as const }
    }
    return {
      _tag: "Admitted" as const,
      reservation: {
        acquiredIntegrationResponsibility: integration.acquired,
        createdTaskPositionFor: task.createdFor,
        proposal
      }
    }
  })

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
    complete: (reservation) =>
      reservation.createdTaskPositionFor !== null &&
      reservation.proposal.admission.taskWorkPosition._tag === "TaskWorkPositionRequired" &&
      reservation.proposal.admission.taskWorkPosition.mode === "ReserveOrReuse" &&
      reservation.proposal.admission.taskWorkPosition.retainAs === undefined
        ? releaseTaskReservation(reservation.createdTaskPositionFor, reservation.proposal.id)
        : Effect.void,
    rollback,
    snapshot: Ref.get(state),
    synchronize,
    tryReserve
  }
})
