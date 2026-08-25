import {
  PlannedAttemptExecutorCorrelation as PlannedAttemptExecutorCorrelationSchema,
  TaskId as TaskIdSchema,
  type PlannedAttemptExecutorCorrelation,
  type TaskId
} from "@dalph/contracts"
import { Effect, Schema } from "effect"
import type { DeliveryProposalId, DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import type { DeliveryActionProposal, TaskWorkPositionRequirement } from "./delivery-action-proposal.js"
import type { RequiredPreStartTaskWorkPosition } from "./task-work-position.js"
import { OperationId } from "../../workflow/identity.js"

const BindingPositionObservation = Schema.TaggedUnion({
  MissingPosition: {},
  ObservedPosition: {
    claimOperationId: Schema.NullOr(OperationId),
    correlation: Schema.NullOr(PlannedAttemptExecutorCorrelationSchema),
    phase: Schema.Literals([
      "AcceptedAttemptPosition",
      "AcceptedAttemptPositionOmittedOnce",
      "BoundRuntimePosition",
      "PendingRuntimePosition",
      "BoundPreStartRuntimePosition",
      "DurablePreStartPosition",
      "DurablePlannedPreStartPosition"
    ])
  }
})
type BindingPositionObservation = typeof BindingPositionObservation.Type

const BindingReason = Schema.Literals([
  "PositionMissing",
  "UnexpectedPositionPhase",
  "ClaimOperationMismatch",
  "AttemptCorrelationMismatch"
])
type BindingReason = typeof BindingReason.Type

/** A claim binding crossed a phase without the exact task-work position. */
export class PreStartClaimTaskWorkPositionBindingContradiction extends Schema.TaggedError<PreStartClaimTaskWorkPositionBindingContradiction>()(
  "PreStartClaimTaskWorkPositionBindingContradiction",
  { actual: BindingPositionObservation, claimOperationId: OperationId, reason: BindingReason, taskId: TaskIdSchema }
) {}

/** A plan binding crossed a phase without the exact claim operation and attempt. */
export class PreStartPlanTaskWorkPositionBindingContradiction extends Schema.TaggedError<PreStartPlanTaskWorkPositionBindingContradiction>()(
  "PreStartPlanTaskWorkPositionBindingContradiction",
  {
    actual: BindingPositionObservation,
    claimOperationId: OperationId,
    correlation: PlannedAttemptExecutorCorrelationSchema,
    reason: BindingReason,
    taskId: TaskIdSchema
  }
) {}

/** A recovered executor binding crossed a phase without the exact planned attempt. */
export class ExecutorPlanTaskWorkPositionBindingContradiction extends Schema.TaggedError<ExecutorPlanTaskWorkPositionBindingContradiction>()(
  "ExecutorPlanTaskWorkPositionBindingContradiction",
  {
    actual: BindingPositionObservation,
    correlation: PlannedAttemptExecutorCorrelationSchema,
    reason: BindingReason,
    taskId: TaskIdSchema
  }
) {}

export type DeliveryTaskWorkPositionBindingContradiction =
  | PreStartClaimTaskWorkPositionBindingContradiction
  | PreStartPlanTaskWorkPositionBindingContradiction
  | ExecutorPlanTaskWorkPositionBindingContradiction

export type TaskWorkPosition =
  | { readonly _tag: "AcceptedAttemptPosition"; readonly correlation: PlannedAttemptExecutorCorrelation }
  /** One stale publication omitted an accepted attempt; a second omission authoritatively releases its capacity. */
  | { readonly _tag: "AcceptedAttemptPositionOmittedOnce"; readonly correlation: PlannedAttemptExecutorCorrelation }
  | {
      readonly _tag: "BoundRuntimePosition"
      readonly correlation: PlannedAttemptExecutorCorrelation
      readonly proposalId: DeliveryProposalId
    }
  | { readonly _tag: "PendingRuntimePosition"; readonly proposalId: DeliveryProposalId }
  | {
      readonly _tag: "BoundPreStartRuntimePosition"
      readonly claimOperationId: OperationId
      readonly proposalId: DeliveryProposalId
    }
  | { readonly _tag: "DurablePreStartPosition"; readonly claimOperationId: OperationId }
  | {
      readonly _tag: "DurablePlannedPreStartPosition"
      readonly claimOperationId: OperationId
      readonly correlation: PlannedAttemptExecutorCorrelation
    }

export interface AdmissionState {
  readonly capacity: DeliveryTaskWorkAdmissionBasis["capacity"]
  readonly positions: ReadonlyMap<TaskId, TaskWorkPosition>
}

export const sameCorrelation = (
  left: PlannedAttemptExecutorCorrelation | undefined,
  right: PlannedAttemptExecutorCorrelation
): boolean => left?.attemptId === right.attemptId && left.runId === right.runId

export const sameOperationId = (left: OperationId | undefined, right: OperationId): boolean => left === right

interface TaskPositionReservation {
  readonly admitted: boolean
  readonly createdFor: TaskId | null
}

export const isPreStartRequirement = (
  requirement: TaskWorkPositionRequirement
): requirement is Extract<TaskWorkPositionRequirement, { readonly _tag: "PreStartTaskWorkPositionRequired" }> =>
  requirement._tag === "PreStartTaskWorkPositionRequired"

export const preStartPositionOf = (position: RequiredPreStartTaskWorkPosition): TaskWorkPosition =>
  position._tag === "UnplannedPreStartTaskWorkPosition"
    ? { _tag: "DurablePreStartPosition", claimOperationId: position.claimOperationId }
    : {
        _tag: "DurablePlannedPreStartPosition",
        claimOperationId: position.claimOperationId,
        correlation: position.correlation
      }

export const positionCorrelationOf = (position: TaskWorkPosition): PlannedAttemptExecutorCorrelation | undefined =>
  position._tag === "AcceptedAttemptPosition" ||
  position._tag === "AcceptedAttemptPositionOmittedOnce" ||
  position._tag === "BoundRuntimePosition" ||
  position._tag === "DurablePlannedPreStartPosition"
    ? position.correlation
    : undefined

const claimOperationIdOf = (position: TaskWorkPosition): OperationId | undefined =>
  position._tag === "BoundPreStartRuntimePosition" ||
  position._tag === "DurablePreStartPosition" ||
  position._tag === "DurablePlannedPreStartPosition"
    ? position.claimOperationId
    : undefined

const actualPositionObservation = (position: TaskWorkPosition | undefined): BindingPositionObservation =>
  position === undefined
    ? BindingPositionObservation.cases.MissingPosition.make({})
    : BindingPositionObservation.cases.ObservedPosition.make({
        claimOperationId: claimOperationIdOf(position) ?? null,
        correlation: positionCorrelationOf(position) ?? null,
        phase: position._tag
      })

export const failPreStartClaimBinding = (fields: {
  readonly claimOperationId: OperationId
  readonly reason: BindingReason
  readonly taskId: TaskId
  readonly position: TaskWorkPosition | undefined
}) =>
  Effect.fail(
    new PreStartClaimTaskWorkPositionBindingContradiction({
      actual: actualPositionObservation(fields.position),
      claimOperationId: fields.claimOperationId,
      reason: fields.reason,
      taskId: fields.taskId
    })
  )

export const failPreStartPlanBinding = (fields: {
  readonly claimOperationId: OperationId
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly reason: BindingReason
  readonly taskId: TaskId
  readonly position: TaskWorkPosition | undefined
}) =>
  Effect.fail(
    new PreStartPlanTaskWorkPositionBindingContradiction({
      actual: actualPositionObservation(fields.position),
      claimOperationId: fields.claimOperationId,
      correlation: fields.correlation,
      reason: fields.reason,
      taskId: fields.taskId
    })
  )

export const failExecutorPlanBinding = (fields: {
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly reason: BindingReason
  readonly taskId: TaskId
  readonly position: TaskWorkPosition | undefined
}) =>
  Effect.fail(
    new ExecutorPlanTaskWorkPositionBindingContradiction({
      actual: actualPositionObservation(fields.position),
      correlation: fields.correlation,
      reason: fields.reason,
      taskId: fields.taskId
    })
  )

type ExistingTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "Existing" }>
type ReusableTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "ReserveOrReuse" }>
type ReservableTaskPositionRequirement =
  | ReusableTaskPositionRequirement
  | Extract<TaskWorkPositionRequirement, { readonly _tag: "PreStartTaskWorkPositionRequired" }>

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
      sameCorrelation(positionCorrelationOf(existing), correlation),
    current
  )
}

const reserveReusableTaskPosition = (
  proposal: DeliveryActionProposal,
  requirement: ReservableTaskPositionRequirement,
  retainAs: PlannedAttemptExecutorCorrelation | undefined,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const existing = current.positions.get(requirement.taskId)
  if (existing !== undefined) {
    if (isPreStartRequirement(requirement)) {
      if (requirement.mode === "AcquireFresh") return unchangedTaskReservation(false, current)
      if (!sameOperationId(claimOperationIdOf(existing), requirement.claimOperationId)) {
        return unchangedTaskReservation(false, current)
      }
    }
    if (retainAs === undefined) return unchangedTaskReservation(true, current)
    if (existing._tag !== "PendingRuntimePosition") {
      return unchangedTaskReservation(sameCorrelation(positionCorrelationOf(existing), retainAs), current)
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
  if (isPreStartRequirement(requirement) && requirement.mode === "ReuseExisting") {
    return unchangedTaskReservation(false, current)
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

export const reserveTaskPositionState = (
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
