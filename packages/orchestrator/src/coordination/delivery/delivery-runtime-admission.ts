/* eslint-disable max-lines -- One atomic controller must reserve and roll back every proposal and fresh-entry resource together. */
import {
  plannedAttemptExecutorCorrelation,
  plannedTaskAttemptEquivalence,
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import { Effect, Option, Ref } from "effect"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryProposalId, DeliveryTaskWorkAdmissionBasis } from "./relations.js"
import {
  freshContinuationCommitmentRequirementOf,
  type DeliveryActionProposal,
  type FreshContinuationCommitmentRequirement,
  type TaskWorkPositionRequirement
} from "./delivery-action-proposal.js"
import {
  isAcceptedFreshTaskDeliveryProposalFor,
  type AcceptedFreshTaskDeliveryProposal
} from "./delivery-proposal-derivation.js"
import type {
  IntegrationTargetResourceController,
  IntegrationTargetResourceResponsibility
} from "../admission/integration-target-resource.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  isAcceptedPlannedAttemptExecutorResponsibility,
  type AcceptedPlannedAttemptExecutorResponsibility
} from "../../workflow/protocols/planned-attempt-executor-work/responsibility.js"
import {
  type ApplicationExitAdmissionService,
  type AtomicForwardOwnerLease,
  type InterruptibleForwardOwnerLease
} from "../application-exit/lifecycle.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import { integrationExitBoundaryFamilyFor } from "./integration-exit-boundary.js"
import {
  freshTaskCandidateObservationUnavailable,
  isFreshTaskCandidateFrontier,
  type FreshTaskCandidate,
  type FreshTaskCandidateFrontier,
  type FreshTaskCandidateObservation
} from "./fresh-task-candidate.js"
import {
  isFreshTaskAdmissionBasis,
  freshTaskAdmissionReleaseKey,
  sameFreshTaskCommitment,
  TaskAdmissionOccupancy,
  taskAdmissionOccupancyExecutorCorrelation,
  taskAdmissionOccupancyTaskId,
  type FreshTaskAdmissionBasis
} from "../admission/fresh-task-admission.js"
import { immutableSnapshot } from "../immutable-snapshot.js"

type FreshEntryOccupancy = Extract<TaskAdmissionOccupancy, { readonly _tag: "FreshEntryReserved" }>
type AcceptedTaskPosition = Exclude<TaskAdmissionOccupancy, FreshEntryOccupancy>

type FreshEntryActivity =
  | { readonly _tag: "AwaitingDurableCommitment"; readonly claimOperationId: OperationId }
  | {
      readonly _tag: "FreshClaimOperationBound"
      readonly claimOperationId: OperationId
      readonly proposalId: DeliveryProposalId
    }
  | { readonly _tag: "IdlePreIntent" }
  | { readonly _tag: "Owned"; readonly proposalId: DeliveryProposalId }
  | { readonly _tag: "PendingMaterialization" }

interface FreshEntryRuntimePosition {
  readonly _tag: "FreshEntryRuntimePosition"
  readonly activity: FreshEntryActivity
  readonly occupancy: FreshEntryOccupancy
}

/** Responsibility is accepted and bound locally while its relation publication catches up. */
interface LocallyAcceptedAttemptPosition {
  readonly _tag: "LocallyAcceptedAttemptPosition"
  /** Exact accepted responsibility boundary; only a later basis can own its released occupancy. */
  readonly responsibilityAcceptedAt: JournalPosition
  readonly handoff:
    | { readonly _tag: "ExistingAttemptHandoff" }
    | {
        readonly _tag: "FreshCommitmentHandoff"
        readonly commitment: Extract<TaskAdmissionOccupancy, { readonly _tag: "FreshTaskCommitted" }>["commitment"]
      }
  readonly plannedAttempt: PlannedTaskAttempt
}

type TaskWorkPosition =
  | AcceptedTaskPosition
  | {
      readonly _tag: "BoundRuntimePosition"
      readonly correlation: PlannedAttemptExecutorCorrelation
      readonly proposalId: DeliveryProposalId
    }
  | { readonly _tag: "PendingRuntimePosition"; readonly proposalId: DeliveryProposalId }
  | FreshEntryRuntimePosition
  | LocallyAcceptedAttemptPosition

const freshEntryRuntimePosition = (
  candidate: FreshTaskCandidate,
  activity: FreshEntryActivity
): FreshEntryRuntimePosition =>
  Object.freeze({
    _tag: "FreshEntryRuntimePosition",
    activity: Object.freeze({ ...activity }),
    occupancy: Object.freeze(TaskAdmissionOccupancy.FreshEntryReserved({ candidate }))
  })

const runtimePositionOf = (occupancy: TaskAdmissionOccupancy): TaskWorkPosition =>
  occupancy._tag === "FreshEntryReserved"
    ? freshEntryRuntimePosition(occupancy.candidate, { _tag: "IdlePreIntent" })
    : occupancy

const detachedSnapshotPosition = (position: TaskWorkPosition): TaskWorkPosition =>
  position._tag === "FreshEntryRuntimePosition"
    ? freshEntryRuntimePosition(immutableSnapshot(position.occupancy.candidate), immutableSnapshot(position.activity))
    : position._tag === "LocallyAcceptedAttemptPosition"
      ? Object.freeze({
          ...position,
          handoff:
            position.handoff._tag === "FreshCommitmentHandoff"
              ? Object.freeze({ ...position.handoff, commitment: position.handoff.commitment })
              : Object.freeze({ ...position.handoff }),
          plannedAttempt: immutableSnapshot(position.plannedAttempt)
        })
      : position._tag === "BoundRuntimePosition"
        ? Object.freeze({ ...position, correlation: immutableSnapshot(position.correlation) })
        : Object.freeze({ ...position })

interface AdmissionState {
  readonly acceptedBasis: FreshTaskAdmissionBasis
  readonly acceptedCandidateFrontier: FreshTaskCandidateFrontier | null
  readonly capacity: DeliveryTaskWorkAdmissionBasis["capacity"]
  readonly positions: ReadonlyMap<TaskId, TaskWorkPosition>
}

/**
 * One isolated process-local admission view. Its copied readonly map cannot
 * mutate the controller that produced it and grants no mutation authority.
 */
export interface DeliveryRuntimeAdmissionSnapshot {
  readonly acceptedBasis: FreshTaskAdmissionBasis
  readonly capacity: DeliveryTaskWorkAdmissionBasis["capacity"]
  readonly positions: ReadonlyMap<TaskId, TaskWorkPosition>
}

/**
 * Describes exact positions for quiescence without minting admission authority.
 * A locally accepted handoff may lead reactive publication, but its process-local
 * observation must never replace a canonical commitment in a reusable basis.
 */
export interface DeliveryRuntimeTaskWorkSnapshot {
  readonly capacity: DeliveryTaskWorkAdmissionBasis["capacity"]
  readonly held: DeliveryTaskWorkAdmissionBasis["held"]
}

export const deliveryRuntimeTaskWorkSnapshotOf = (
  snapshot: DeliveryRuntimeAdmissionSnapshot
): DeliveryRuntimeTaskWorkSnapshot => {
  const held = Object.freeze(
    [...snapshot.positions.entries()].flatMap(([taskId, position]) =>
      position._tag === "ExactAttemptHeld" || position._tag === "LocallyAcceptedAttemptPosition"
        ? [immutableSnapshot({ correlation: plannedAttemptExecutorCorrelation(position.plannedAttempt), taskId })]
        : []
    )
  )
  return Object.freeze({ capacity: snapshot.capacity, held })
}

/** Counts every closed runtime occupancy form, including identity-free fresh-entry reservations. */
export const deliveryTaskWorkAdmissionOccupiedCountOf = (snapshot: DeliveryRuntimeAdmissionSnapshot): number =>
  snapshot.positions.size

const AcceptedFreshTaskAdmissionTypeId: unique symbol = Symbol("@dalph/AcceptedFreshTaskAdmission")

/** Opaque proof that runtime reserved this exact revision-bound candidate before proposal construction. */
export interface AcceptedFreshTaskAdmission {
  readonly [AcceptedFreshTaskAdmissionTypeId]: typeof AcceptedFreshTaskAdmissionTypeId
  readonly candidate: FreshTaskCandidate
}

/** Whether a failed action reached the durable claim-intent cut that keeps its task admission occupied. */
export type DeliveryAdmissionRollbackDisposition = "BeforeDurableClaimIntent" | "AfterDurableClaimIntentOrAmbiguity"

const DeliveryAdmissionReservationTypeId: unique symbol = Symbol("@dalph/DeliveryAdmissionReservation")

type DeliveryForwardOwnerLease = AtomicForwardOwnerLease | InterruptibleForwardOwnerLease

interface DeliveryAdmissionReservationBase {
  readonly [DeliveryAdmissionReservationTypeId]: typeof DeliveryAdmissionReservationTypeId
  readonly acquiredIntegrationResponsibility: IntegrationTargetResourceResponsibility | null
  readonly createdTaskPositionFor: TaskId | null
  readonly freshEntryPrevious: FreshEntryRuntimePosition | null
  readonly freshTaskCandidate: FreshTaskCandidate | null
  readonly forwardOwner: DeliveryForwardOwnerLease
}

type DeliveryAdmissionReservationBinding =
  | { readonly _tag: "FreshClaimOperationBinding"; readonly operationId: OperationId }
  | { readonly _tag: "NoReservationBinding" }
  | { readonly _tag: "PlannedAttemptHandoffBinding"; readonly plannedAttempt: PlannedTaskAttempt }

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

const isDeliveryAdmissionReservation = (value: unknown): value is DeliveryAdmissionReservation =>
  typeof value === "object" &&
  value !== null &&
  Reflect.get(value, DeliveryAdmissionReservationTypeId) === DeliveryAdmissionReservationTypeId &&
  Object.isFrozen(value)

export interface DeliveryRuntimeAdmissionController {
  readonly bindFreshTaskClaimOperation: (
    reservation: DeliveryAdmissionReservation,
    operationId: OperationId
  ) => Effect.Effect<void>
  readonly bindPlannedAttemptPosition: (
    reservation: DeliveryAdmissionReservation,
    plannedAttempt: PlannedTaskAttempt,
    acceptedResponsibility?: AcceptedPlannedAttemptExecutorResponsibility
  ) => Effect.Effect<void>
  readonly releasePlannedAttemptPosition: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<"Released" | "AlreadyAbsent">
  readonly complete: (reservation: DeliveryAdmissionReservation) => Effect.Effect<void>
  readonly rollback: (
    reservation: DeliveryAdmissionReservation,
    disposition: DeliveryAdmissionRollbackDisposition
  ) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<DeliveryRuntimeAdmissionSnapshot>
  readonly synchronize: (
    basis: DeliveryTaskWorkAdmissionBasis,
    candidateObservation?: FreshTaskCandidateObservation
  ) => Effect.Effect<void>
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
  readonly tryReserveFresh: (
    frontier: FreshTaskCandidateFrontier,
    materialize: (accepted: AcceptedFreshTaskAdmission) => AcceptedFreshTaskDeliveryProposal
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

const sameCorrelation = (
  left: PlannedAttemptExecutorCorrelation | undefined,
  right: PlannedAttemptExecutorCorrelation
): boolean => left?.attemptId === right.attemptId && left.runId === right.runId

const exactFreshTaskRelease = (basis: FreshTaskAdmissionBasis, taskId: TaskId, claimOperationId: OperationId) =>
  basis.releaseEvidence.get(freshTaskAdmissionReleaseKey(taskId, claimOperationId))

const exactHandoffMatches = (
  basis: FreshTaskAdmissionBasis,
  taskId: TaskId,
  claimOperationId: OperationId,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const evidence = exactFreshTaskRelease(basis, taskId, claimOperationId)
  return (
    evidence?._tag === "ExactAttemptHandoffAccepted" &&
    plannedTaskAttemptEquivalence(evidence.plannedAttempt, plannedAttempt)
  )
}

const freshRuntimeClaimOperationId = (position: FreshEntryRuntimePosition): OperationId | undefined =>
  position.activity._tag === "AwaitingDurableCommitment" || position.activity._tag === "FreshClaimOperationBound"
    ? position.activity.claimOperationId
    : undefined

type PositionReconciliation =
  | { readonly _tag: "Contradiction" }
  | { readonly _tag: "Keep"; readonly position: TaskWorkPosition }
  | { readonly _tag: "Remove" }

const keptPosition = (position: TaskWorkPosition): PositionReconciliation => ({ _tag: "Keep", position })
const contradiction: PositionReconciliation = { _tag: "Contradiction" }

const reconcileFreshCommitment = (
  basis: FreshTaskAdmissionBasis,
  taskId: TaskId,
  position: Extract<TaskWorkPosition, { readonly _tag: "FreshTaskCommitted" }>,
  accepted: TaskAdmissionOccupancy | undefined
): PositionReconciliation => {
  const claimOperationId = position.commitment.operation.acquisition.operationId
  const release = exactFreshTaskRelease(basis, taskId, claimOperationId)
  if (accepted === undefined) return release === undefined ? { _tag: "Keep", position } : { _tag: "Remove" }
  if (accepted._tag === "FreshTaskCommitted") {
    return sameFreshTaskCommitment(accepted.commitment, position.commitment) || release !== undefined
      ? { _tag: "Keep", position: accepted }
      : { _tag: "Contradiction" }
  }
  return accepted._tag === "ExactAttemptHeld" &&
    exactHandoffMatches(basis, taskId, claimOperationId, accepted.plannedAttempt)
    ? { _tag: "Keep", position: accepted }
    : { _tag: "Contradiction" }
}

const reconcileFreshRuntimePosition = (
  basis: FreshTaskAdmissionBasis,
  candidateObservation: FreshTaskCandidateObservation,
  taskId: TaskId,
  position: FreshEntryRuntimePosition,
  accepted: TaskAdmissionOccupancy | undefined
): PositionReconciliation => {
  const claimOperationId = freshRuntimeClaimOperationId(position)
  const release = claimOperationId === undefined ? undefined : exactFreshTaskRelease(basis, taskId, claimOperationId)
  if (accepted === undefined) {
    if (release !== undefined) return { _tag: "Remove" }
    return freshIdleEntryWasOmitted(candidateObservation, taskId, position)
      ? { _tag: "Remove" }
      : keptPosition(position)
  }
  if (accepted._tag === "FreshTaskCommitted") {
    return freshRuntimeCommitmentMatches(claimOperationId, release, accepted) ? keptPosition(accepted) : contradiction
  }
  return freshRuntimeHandoffMatches(basis, taskId, claimOperationId, accepted) ? keptPosition(accepted) : contradiction
}

const freshIdleEntryWasOmitted = (
  candidateObservation: FreshTaskCandidateObservation,
  taskId: TaskId,
  position: FreshEntryRuntimePosition
): boolean =>
  isFreshTaskCandidateFrontier(candidateObservation) &&
  !candidateObservation.entryCapableTaskIds.has(taskId) &&
  position.activity._tag === "IdlePreIntent"

const freshRuntimeCommitmentMatches = (
  claimOperationId: OperationId | undefined,
  release: ReturnType<typeof exactFreshTaskRelease>,
  accepted: Extract<TaskAdmissionOccupancy, { readonly _tag: "FreshTaskCommitted" }>
): boolean => claimOperationId === accepted.commitment.operation.acquisition.operationId || release !== undefined

const freshRuntimeHandoffMatches = (
  basis: FreshTaskAdmissionBasis,
  taskId: TaskId,
  claimOperationId: OperationId | undefined,
  accepted: TaskAdmissionOccupancy
): accepted is Extract<TaskAdmissionOccupancy, { readonly _tag: "ExactAttemptHeld" }> =>
  accepted._tag === "ExactAttemptHeld" &&
  claimOperationId !== undefined &&
  exactHandoffMatches(basis, taskId, claimOperationId, accepted.plannedAttempt)

const acceptedAttemptMatchesLocal = (
  accepted: TaskAdmissionOccupancy,
  position: LocallyAcceptedAttemptPosition
): boolean =>
  (accepted._tag === "ExactAttemptHeld" || accepted._tag === "ExistingResponsibilityReserved") &&
  plannedTaskAttemptEquivalence(accepted.plannedAttempt, position.plannedAttempt)

const acceptedBasisAdvancedPastLocalHandoff = (
  acceptedAt: JournalPosition | null,
  position: LocallyAcceptedAttemptPosition
): boolean => acceptedAt !== null && acceptedAt > position.responsibilityAcceptedAt

const reconcileLocallyAcceptedAttempt = (
  basisAcceptedAt: JournalPosition | null,
  position: LocallyAcceptedAttemptPosition,
  accepted: TaskAdmissionOccupancy | undefined
): PositionReconciliation => {
  if (accepted === undefined) {
    return acceptedBasisAdvancedPastLocalHandoff(basisAcceptedAt, position)
      ? { _tag: "Remove" }
      : { _tag: "Keep", position }
  }
  if (accepted._tag === "FreshTaskCommitted") {
    return position.handoff._tag === "FreshCommitmentHandoff" &&
      sameFreshTaskCommitment(position.handoff.commitment, accepted.commitment)
      ? { _tag: "Keep", position }
      : { _tag: "Contradiction" }
  }
  if (acceptedAttemptMatchesLocal(accepted, position)) {
    // The privately registered local handoff is itself exact acceptance
    // evidence while relation publication catches up. A reconstructed process
    // has no such token and must instead supply the opaque Journal projection.
    return accepted._tag === "ExactAttemptHeld" ? { _tag: "Keep", position: accepted } : { _tag: "Keep", position }
  }
  return { _tag: "Contradiction" }
}

interface TaskPositionReservation {
  readonly admitted: boolean
  readonly createdFor: TaskId | null
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

type ExistingTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "Existing" }>
type ReusableTaskPositionRequirement = Extract<TaskWorkPositionRequirement, { readonly mode: "ReserveOrReuse" }>

const unchangedTaskReservation = (
  admitted: boolean,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => [{ admitted, createdFor: null }, current]

const positionCorrelation = (position: TaskWorkPosition): PlannedAttemptExecutorCorrelation | undefined => {
  if (position._tag === "BoundRuntimePosition") {
    return position.correlation
  }
  if (position._tag === "LocallyAcceptedAttemptPosition") {
    return { attemptId: position.plannedAttempt.attemptId, runId: position.plannedAttempt.runId }
  }
  if (position._tag === "ExistingResponsibilityReserved" || position._tag === "ExactAttemptHeld") {
    return taskAdmissionOccupancyExecutorCorrelation(position)
  }
  return undefined
}

const reserveExistingTaskPosition = (
  requirement: ExistingTaskPositionRequirement,
  correlation: PlannedAttemptExecutorCorrelation,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const existing = current.positions.get(requirement.taskId)
  const existingCorrelation = existing === undefined ? undefined : positionCorrelation(existing)
  return unchangedTaskReservation(
    existingCorrelation !== undefined && sameCorrelation(existingCorrelation, correlation),
    current
  )
}

const proposalReusesFreshCommitment = (
  proposal: DeliveryActionProposal,
  position: Extract<TaskWorkPosition, { readonly _tag: "FreshTaskCommitted" }>
): boolean => {
  const route = proposal.route
  return (
    route._tag === "FreshExecutorWorkflowRoute" &&
    route.step._tag === "BeginPlannedAttemptExecutorWork" &&
    route.step.claimOperationId === position.commitment.operation.acquisition.operationId
  )
}

const reserveOccupiedReusablePosition = (
  proposal: DeliveryActionProposal,
  requirement: ReusableTaskPositionRequirement,
  retainAs: PlannedAttemptExecutorCorrelation | undefined,
  existing: TaskWorkPosition,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  if (retainAs === undefined) {
    const reusable = existing._tag === "PendingRuntimePosition" || existing._tag === "FreshTaskCommitted"
    return unchangedTaskReservation(reusable, current)
  }
  if (existing._tag === "FreshTaskCommitted") {
    return unchangedTaskReservation(proposalReusesFreshCommitment(proposal, existing), current)
  }
  if (existing._tag !== "PendingRuntimePosition") {
    const existingCorrelation = positionCorrelation(existing)
    return unchangedTaskReservation(
      existingCorrelation !== undefined && sameCorrelation(existingCorrelation, retainAs),
      current
    )
  }
  const position: TaskWorkPosition = { _tag: "BoundRuntimePosition", correlation: retainAs, proposalId: proposal.id }
  return [
    { admitted: true, createdFor: null },
    { ...current, positions: new Map(current.positions).set(requirement.taskId, position) }
  ]
}

const reserveReusableTaskPosition = (
  proposal: DeliveryActionProposal,
  requirement: ReusableTaskPositionRequirement,
  retainAs: PlannedAttemptExecutorCorrelation | undefined,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  const existing = current.positions.get(requirement.taskId)
  if (existing !== undefined) {
    // The pure frontier admits at most one fresh pipeline per tracker task and
    // suppresses fresh same-task work while an exact responsibility exists.
    // Its next pre-attempt step may reuse that task's temporary position. A
    // position bound to an exact attempt is instead authority for that
    // AttemptId/RunId, never a task-id permit for replacement work.
    return reserveOccupiedReusablePosition(proposal, requirement, retainAs, existing, current)
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

const isFreshEntryRoute = (proposal: DeliveryActionProposal): boolean => {
  const route = proposal.route
  return (
    route._tag === "FreshWorkflowRoute" &&
    (route.step._tag === "ReadCurrentTaskGraph" || route.step._tag === "AcquireTaskClaim")
  )
}

const freshCommitmentMatchesPosition = (
  continuation: Extract<
    FreshContinuationCommitmentRequirement,
    { readonly _tag: "FreshContinuationCommitmentRequired" }
  >,
  current: AdmissionState
): boolean => {
  const required = continuation.commitment.operation.acquisition
  const existing = current.positions.get(required.taskId)
  return (
    existing?._tag === "FreshTaskCommitted" && sameFreshTaskCommitment(existing.commitment, continuation.commitment)
  )
}

const continuationCannotUseCommittedPosition = (
  continuation: FreshContinuationCommitmentRequirement,
  requirement: TaskWorkPositionRequirement,
  current: AdmissionState
): boolean => {
  const hasNoFreshCommitment =
    continuation._tag === "FreshContinuationCommitmentNotRequired" ||
    continuation._tag === "ReplacementContinuationRequired"
  return (
    hasNoFreshCommitment &&
    requirement._tag === "TaskWorkPositionRequired" &&
    current.positions.get(requirement.taskId)?._tag === "FreshTaskCommitted"
  )
}

const reserveRequiredTaskPosition = (
  proposal: DeliveryActionProposal,
  requirement: TaskWorkPositionRequirement,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  if (requirement._tag === "NoTaskWorkPosition") return unchangedTaskReservation(true, current)
  const protocol = proposal.admission.plannedAttemptProtocol
  if (requirement.mode === "Existing") {
    /* v8 ignore start -- DeliveryAdmissionRequirements makes Existing without an exact correlation unconstructible. */
    if (protocol._tag !== "PlannedAttemptProtocolRequired") return unchangedTaskReservation(false, current)
    /* v8 ignore stop */
    return reserveExistingTaskPosition(requirement, protocol.correlation, current)
  }
  const retainAs = protocol._tag === "PlannedAttemptProtocolRequired" ? protocol.correlation : undefined
  return reserveReusableTaskPosition(proposal, requirement, retainAs, current)
}

const reserveTaskPositionState = (
  proposal: DeliveryActionProposal,
  current: AdmissionState
): readonly [TaskPositionReservation, AdmissionState] => {
  if (isFreshEntryRoute(proposal)) return unchangedTaskReservation(false, current)
  const continuation = freshContinuationCommitmentRequirementOf(proposal)
  if (continuation._tag === "FreshContinuationCommitmentMissing") return unchangedTaskReservation(false, current)
  if (
    continuation._tag === "FreshContinuationCommitmentRequired" &&
    !freshCommitmentMatchesPosition(continuation, current)
  )
    return unchangedTaskReservation(false, current)
  const requirement = proposal.admission.taskWorkPosition
  if (continuationCannotUseCommittedPosition(continuation, requirement, current))
    return unchangedTaskReservation(false, current)
  return reserveRequiredTaskPosition(proposal, requirement, current)
}

const freshBeginAttemptOf = (proposal: DeliveryActionProposal): PlannedTaskAttempt | undefined => {
  const route = proposal.route
  return route._tag === "FreshExecutorWorkflowRoute" && route.step._tag === "BeginPlannedAttemptExecutorWork"
    ? route.step.plannedAttempt
    : undefined
}

const plannedAttemptReservationMatches = (
  proposal: DeliveryActionProposal,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const task = proposal.admission.taskWorkPosition
  const protocol = proposal.admission.plannedAttemptProtocol
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  return (
    task._tag === "TaskWorkPositionRequired" &&
    task.taskId === plannedAttempt.taskId &&
    protocol._tag === "PlannedAttemptProtocolRequired" &&
    sameCorrelation(protocol.correlation, correlation)
  )
}

const freshCommitmentHandoffMatches = (
  position: TaskWorkPosition | undefined,
  handoff: LocallyAcceptedAttemptPosition["handoff"],
  proposedAttempt: PlannedTaskAttempt | undefined,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  position?._tag !== "FreshTaskCommitted" ||
  (handoff._tag === "FreshCommitmentHandoff" &&
    sameFreshTaskCommitment(handoff.commitment, position.commitment) &&
    proposedAttempt !== undefined &&
    plannedTaskAttemptEquivalence(proposedAttempt, plannedAttempt))

const replacementHandoffMatches = (
  continuation: FreshContinuationCommitmentRequirement,
  proposedAttempt: PlannedTaskAttempt | undefined,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  continuation._tag !== "ReplacementContinuationRequired" ||
  (proposedAttempt !== undefined &&
    plannedTaskAttemptEquivalence(continuation.replacement.plannedAttempt, plannedAttempt) &&
    plannedTaskAttemptEquivalence(proposedAttempt, plannedAttempt))

const boundRuntimePositionMatches = (
  position: Extract<TaskWorkPosition, { readonly _tag: "BoundRuntimePosition" }>,
  proposalId: DeliveryProposalId,
  plannedAttempt: PlannedTaskAttempt
): boolean => position.proposalId === proposalId && sameCorrelation(position.correlation, plannedAttempt)

const acceptedPositionMatchesAttempt = (
  position: Extract<TaskWorkPosition, { readonly _tag: "ExistingResponsibilityReserved" | "ExactAttemptHeld" }>,
  plannedAttempt: PlannedTaskAttempt
): boolean => plannedTaskAttemptEquivalence(position.plannedAttempt, plannedAttempt)

const isUnboundFreshRuntimePosition = (
  position: TaskWorkPosition
): position is FreshEntryRuntimePosition | LocallyAcceptedAttemptPosition =>
  position._tag === "FreshEntryRuntimePosition" || position._tag === "LocallyAcceptedAttemptPosition"

const taskPositionMatchesAttempt = (
  position: TaskWorkPosition | undefined,
  proposalId: DeliveryProposalId,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  if (position === undefined) return false
  if (isUnboundFreshRuntimePosition(position)) return false
  switch (position._tag) {
    case "FreshTaskCommitted":
      return true
    case "PendingRuntimePosition":
      return position.proposalId === proposalId
    case "BoundRuntimePosition":
      return boundRuntimePositionMatches(position, proposalId, plannedAttempt)
    case "ExistingResponsibilityReserved":
    case "ExactAttemptHeld":
      return acceptedPositionMatchesAttempt(position, plannedAttempt)
  }
}

interface PlannedAttemptPositionBinding {
  readonly acceptedResponsibility: AcceptedPlannedAttemptExecutorResponsibility | undefined
  readonly continuation: FreshContinuationCommitmentRequirement
  readonly handoff: LocallyAcceptedAttemptPosition["handoff"]
  readonly plannedAttempt: PlannedTaskAttempt
  readonly proposal: DeliveryActionProposal
  readonly proposedAttempt: PlannedTaskAttempt | undefined
}

const acceptedResponsibilityMatchesHandoff = (binding: PlannedAttemptPositionBinding): boolean =>
  binding.acceptedResponsibility === undefined
    ? binding.handoff._tag !== "FreshCommitmentHandoff"
    : isAcceptedPlannedAttemptExecutorResponsibility(binding.acceptedResponsibility) &&
      plannedTaskAttemptEquivalence(binding.acceptedResponsibility.plannedAttempt, binding.plannedAttempt)

const plannedAttemptPositionBindingMatches = (
  position: TaskWorkPosition | undefined,
  binding: PlannedAttemptPositionBinding
): boolean =>
  plannedAttemptReservationMatches(binding.proposal, binding.plannedAttempt) &&
  taskPositionMatchesAttempt(position, binding.proposal.id, binding.plannedAttempt) &&
  freshCommitmentHandoffMatches(position, binding.handoff, binding.proposedAttempt, binding.plannedAttempt) &&
  replacementHandoffMatches(binding.continuation, binding.proposedAttempt, binding.plannedAttempt) &&
  acceptedResponsibilityMatchesHandoff(binding)

const responsibilityAcceptancePositionOf = (
  current: AdmissionState,
  binding: PlannedAttemptPositionBinding
): JournalPosition | null => binding.acceptedResponsibility?.acceptedAt ?? current.acceptedBasis.acceptedAt

const bindPlannedAttemptPositionState = (
  current: AdmissionState,
  binding: PlannedAttemptPositionBinding
): readonly [boolean, AdmissionState] => {
  const position = current.positions.get(binding.plannedAttempt.taskId)
  if (!plannedAttemptPositionBindingMatches(position, binding)) return [false, current]
  if (position?._tag === "ExactAttemptHeld") return [true, current]
  const responsibilityAcceptedAt = responsibilityAcceptancePositionOf(current, binding)
  if (responsibilityAcceptedAt === null) return [false, current]
  const local: LocallyAcceptedAttemptPosition = {
    _tag: "LocallyAcceptedAttemptPosition",
    handoff: binding.handoff,
    plannedAttempt: immutableSnapshot(binding.plannedAttempt),
    responsibilityAcceptedAt
  }
  return [true, { ...current, positions: new Map(current.positions).set(binding.plannedAttempt.taskId, local) }]
}

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
  if (!isFreshTaskAdmissionBasis(initial)) {
    return yield* Effect.die("delivery admission initialization requires an immutable accepted basis")
  }
  const state = yield* Ref.make<AdmissionState>({
    acceptedBasis: initial,
    acceptedCandidateFrontier: null,
    capacity: initial.capacity,
    positions: new Map(
      [...initial.occupied.values()].map((occupancy) => [
        taskAdmissionOccupancyTaskId(occupancy),
        runtimePositionOf(occupancy)
      ])
    )
  })
  const activeReservations = new WeakMap<DeliveryAdmissionReservation, DeliveryAdmissionReservationBinding>()

  const consumeReservation = (
    reservation: DeliveryAdmissionReservation
  ): Effect.Effect<DeliveryAdmissionReservationBinding | null> =>
    Effect.sync(() => {
      if (!isDeliveryAdmissionReservation(reservation)) return null
      const binding = activeReservations.get(reservation)
      if (binding === undefined) return null
      activeReservations.delete(reservation)
      return binding
    })

  const bindActiveReservation = (
    reservation: DeliveryAdmissionReservation,
    binding: Exclude<DeliveryAdmissionReservationBinding, { readonly _tag: "NoReservationBinding" }>
  ): Effect.Effect<boolean> =>
    Effect.sync(() => {
      if (!isDeliveryAdmissionReservation(reservation)) return false
      const current = activeReservations.get(reservation)
      if (current?._tag !== "NoReservationBinding") return false
      activeReservations.set(reservation, binding)
      return true
    })

  const synchronize = Effect.fn("DeliveryRuntimeAdmission.synchronize")(
    (
      basis: DeliveryTaskWorkAdmissionBasis,
      candidateObservation: FreshTaskCandidateObservation = freshTaskCandidateObservationUnavailable
    ) =>
      (isFreshTaskAdmissionBasis(basis)
        ? basis.runId !== initial.runId
          ? Effect.die("delivery admission synchronization requires the controller Run")
          : isFreshTaskCandidateFrontier(candidateObservation) &&
              (candidateObservation.runId !== initial.runId || candidateObservation.acceptedAt !== basis.acceptedAt)
            ? Effect.die("delivery admission synchronization requires one coherent basis and candidate frontier")
            : Ref.modify(state, (current) => {
                if (
                  current.acceptedBasis.acceptedAt !== null &&
                  (basis.acceptedAt === null || basis.acceptedAt < current.acceptedBasis.acceptedAt)
                ) {
                  return ["delivery admission synchronization rejected an older accepted Journal prefix", current]
                }
                const accepted = basis.occupied
                const reconciliations = [...current.positions].map(([taskId, position]) => {
                  const acceptedPosition = accepted.get(taskId)
                  const reconciliation =
                    position._tag === "FreshTaskCommitted"
                      ? reconcileFreshCommitment(basis, taskId, position, acceptedPosition)
                      : position._tag === "FreshEntryRuntimePosition"
                        ? reconcileFreshRuntimePosition(basis, candidateObservation, taskId, position, acceptedPosition)
                        : position._tag === "LocallyAcceptedAttemptPosition"
                          ? reconcileLocallyAcceptedAttempt(basis.acceptedAt, position, acceptedPosition)
                          : acceptedPosition !== undefined
                            ? ({ _tag: "Keep", position: runtimePositionOf(acceptedPosition) } as const)
                            : position._tag === "ExactAttemptHeld"
                              ? ({ _tag: "Remove" } as const)
                              : ({ _tag: "Keep", position } as const)
                  return { reconciliation, taskId }
                })
                const contradictoryTaskId = reconciliations.find(
                  ({ reconciliation }) => reconciliation._tag === "Contradiction"
                )?.taskId
                const reconciled = reconciliations.flatMap(
                  ({ reconciliation, taskId }): ReadonlyArray<readonly [TaskId, TaskWorkPosition]> =>
                    reconciliation._tag === "Keep" ? [[taskId, reconciliation.position]] : []
                )
                const existingTaskIds = new Set(current.positions.keys())
                const newlyAccepted = [...accepted]
                  .filter(([taskId]) => !existingTaskIds.has(taskId))
                  .map(([taskId, position]): readonly [TaskId, TaskWorkPosition] => [
                    taskId,
                    runtimePositionOf(position)
                  ])
                const positions = new Map([...reconciled, ...newlyAccepted])
                return contradictoryTaskId === undefined
                  ? [
                      null,
                      {
                        ...current,
                        acceptedBasis: basis,
                        acceptedCandidateFrontier: isFreshTaskCandidateFrontier(candidateObservation)
                          ? candidateObservation
                          : null,
                        capacity: basis.capacity,
                        positions
                      }
                    ]
                  : [`accepted task-work position contradicts locally accepted attempt ${contradictoryTaskId}`, current]
              })
        : Effect.die("delivery admission synchronization requires an immutable accepted basis")
      ).pipe(Effect.flatMap((problem) => (problem === null ? Effect.void : Effect.die(problem))))
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

  interface FreshTaskPositionReservation {
    readonly candidate: FreshTaskCandidate
    readonly previous: FreshEntryRuntimePosition | null
  }

  const freshActivityIsOwnedBy = (activity: FreshEntryActivity, proposalId: DeliveryProposalId): boolean =>
    (activity._tag === "Owned" || activity._tag === "FreshClaimOperationBound") && activity.proposalId === proposalId

  const freshReservationCanBeRestored = (
    position: TaskWorkPosition | undefined,
    reservation: FreshTaskPositionReservation,
    ownedByProposalId: DeliveryProposalId | null
  ): position is FreshEntryRuntimePosition => {
    if (position?._tag !== "FreshEntryRuntimePosition") return false
    if (position.occupancy.candidate.id !== reservation.candidate.id) return false
    return ownedByProposalId === null
      ? position.activity._tag === "PendingMaterialization"
      : freshActivityIsOwnedBy(position.activity, ownedByProposalId)
  }

  const reserveFreshTaskPosition = (frontier: FreshTaskCandidateFrontier) =>
    Ref.modify(state, (current): readonly [FreshTaskPositionReservation | null, AdmissionState] => {
      if (frontier.runId !== current.acceptedBasis.runId || current.acceptedCandidateFrontier !== frontier) {
        return [null, current]
      }
      const candidate = frontier.candidates.find((candidate) => {
        const existing = current.positions.get(candidate.taskId)
        return (
          existing === undefined ||
          (existing._tag === "FreshEntryRuntimePosition" &&
            existing.activity._tag === "IdlePreIntent" &&
            !current.acceptedBasis.occupied.has(candidate.taskId))
        )
      })
      if (candidate === undefined) return [null, current]
      const existing = current.positions.get(candidate.taskId)
      if (existing?._tag === "FreshEntryRuntimePosition") {
        const next = freshEntryRuntimePosition(candidate, { _tag: "PendingMaterialization" })
        return [
          { candidate, previous: existing },
          { ...current, positions: new Map(current.positions).set(candidate.taskId, next) }
        ]
      }
      if (current.positions.size >= current.capacity) return [null, current]
      const next = freshEntryRuntimePosition(candidate, { _tag: "PendingMaterialization" })
      return [
        { candidate, previous: null },
        { ...current, positions: new Map(current.positions).set(candidate.taskId, next) }
      ]
    })

  const releaseTaskReservation = (taskId: TaskId, proposalId: DeliveryProposalId) =>
    Ref.update(state, (current) => {
      const position = current.positions.get(taskId)
      if (
        position === undefined ||
        position._tag === "FreshTaskCommitted" ||
        position._tag === "ExistingResponsibilityReserved" ||
        position._tag === "ExactAttemptHeld" ||
        position._tag === "FreshEntryRuntimePosition" ||
        position._tag === "LocallyAcceptedAttemptPosition" ||
        position.proposalId !== proposalId
      )
        return current
      const positions = new Map([...current.positions].filter(([currentTaskId]) => currentTaskId !== taskId))
      return { ...current, positions }
    })

  const restoreFreshTaskReservation = (
    reservation: FreshTaskPositionReservation,
    ownedByProposalId: DeliveryProposalId | null
  ) =>
    Ref.update(state, (current) => {
      const position = current.positions.get(reservation.candidate.taskId)
      if (!freshReservationCanBeRestored(position, reservation, ownedByProposalId)) return current
      const positions = new Map(current.positions)
      if (reservation.previous === null) positions.delete(reservation.candidate.taskId)
      else positions.set(reservation.candidate.taskId, reservation.previous)
      return { ...current, positions }
    })

  const markFreshEntryActivity = (candidate: FreshTaskCandidate, activity: FreshEntryActivity): Effect.Effect<void> =>
    Ref.update(state, (current) => {
      const position = current.positions.get(candidate.taskId)
      if (position?._tag !== "FreshEntryRuntimePosition" || position.occupancy.candidate.id !== candidate.id) {
        return current
      }
      return {
        ...current,
        positions: new Map(current.positions).set(candidate.taskId, freshEntryRuntimePosition(candidate, activity))
      }
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

  const tryReservePrepared = Effect.fn("DeliveryRuntimeAdmission.tryReservePrepared")(
    (proposal: DeliveryActionProposal, freshTask: FreshTaskPositionReservation | null) =>
      Effect.uninterruptible(
        // eslint-disable-next-line complexity -- One transaction reserves and rolls back every declared proposal resource before exact owner registration.
        Effect.gen(function* () {
          const forwardOwner = yield* applicationExit.prepareForwardOwner(forwardOwnerKindFor(proposal))
          const protocol = yield* reservePlannedAttemptProtocol(proposal)
          if (protocol._tag === "PlannedAttemptProtocolUnavailable") {
            if (freshTask !== null) yield* restoreFreshTaskReservation(freshTask, proposal.id)
            yield* forwardOwner.cancel
            return { _tag: "Deferred" as const, reason: "PlannedAttemptProtocolUnavailable" as const }
          }
          const task =
            freshTask === null
              ? yield* reserveTaskPosition(proposal)
              : ({ admitted: true, createdFor: null } satisfies TaskPositionReservation)
          if (!task.admitted) {
            if (freshTask !== null) yield* restoreFreshTaskReservation(freshTask, proposal.id)
            if (protocol._tag === "PlannedAttemptProtocolAdmitted") yield* protocol.permit.release
            yield* forwardOwner.cancel
            return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
          }
          const integration = yield* reserveIntegration(proposal)
          if (!integration.admitted) {
            if (task.createdFor !== null) yield* releaseTaskReservation(task.createdFor, proposal.id)
            if (freshTask !== null) yield* restoreFreshTaskReservation(freshTask, proposal.id)
            if (protocol._tag === "PlannedAttemptProtocolAdmitted") yield* protocol.permit.release
            yield* forwardOwner.cancel
            return { _tag: "Deferred" as const, reason: "IntegrationTargetUnavailable" as const }
          }
          const registeredOwner = yield* forwardOwner.register.pipe(
            Effect.onError(() =>
              Effect.gen(function* () {
                if (integration.acquired !== null) yield* integrationTargets.release(integration.acquired)
                if (task.createdFor !== null) yield* releaseTaskReservation(task.createdFor, proposal.id)
                if (freshTask !== null) yield* restoreFreshTaskReservation(freshTask, proposal.id)
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
            freshEntryPrevious: freshTask?.previous ?? null,
            freshTaskCandidate: freshTask?.candidate ?? null,
            forwardOwner: registeredOwner
          } satisfies DeliveryAdmissionReservationBase
          // Continuation authority is intentionally tied to the exact object
          // minted by proposal derivation. Those proposals are already deeply
          // snapshotted and frozen; cloning here would discard the module-local
          // WeakSet identity and make an exact Begin handoff look untrusted.
          const continuation = freshContinuationCommitmentRequirementOf(protocol.proposal)
          const reservationProposal =
            continuation._tag === "FreshContinuationCommitmentRequired" ||
            continuation._tag === "ReplacementContinuationRequired"
              ? protocol.proposal
              : immutableSnapshot(protocol.proposal)
          const reservation: DeliveryAdmissionReservation =
            protocol._tag === "NoPlannedAttemptProtocolAdmission"
              ? { ...base, _tag: "NoPlannedAttemptProtocolAdmission", proposal: reservationProposal }
              : {
                  ...base,
                  _tag: "PlannedAttemptProtocolAdmission",
                  permit: protocol.permit,
                  proposal: reservationProposal
                }
          Object.defineProperty(reservation, DeliveryAdmissionReservationTypeId, {
            configurable: false,
            enumerable: false,
            value: DeliveryAdmissionReservationTypeId,
            writable: false
          })
          Object.freeze(reservation)
          activeReservations.set(reservation, { _tag: "NoReservationBinding" })
          return { _tag: "Admitted" as const, reservation }
        })
      )
  )

  const tryReserve = Effect.fn("DeliveryRuntimeAdmission.tryReserve")((proposal: DeliveryActionProposal) =>
    tryReservePrepared(proposal, null)
  )

  const freshFrontierMatchesRun = (frontier: FreshTaskCandidateFrontier, runId: RunId): boolean =>
    frontier.runId === runId && frontier.candidates.every((candidate) => candidate.runId === runId)

  const acceptedFreshProposalMatchesCandidate = (
    proposal: DeliveryActionProposal,
    candidate: FreshTaskCandidate
  ): proposal is AcceptedFreshTaskDeliveryProposal => {
    if (!isAcceptedFreshTaskDeliveryProposalFor(proposal, candidate)) return false
    const requirement = proposal.admission.taskWorkPosition
    return (
      requirement._tag === "TaskWorkPositionRequired" &&
      requirement.mode === "ReserveOrReuse" &&
      requirement.taskId === candidate.taskId
    )
  }

  const tryReserveFresh = Effect.fn("DeliveryRuntimeAdmission.tryReserveFresh")(
    (
      frontier: FreshTaskCandidateFrontier,
      materialize: (accepted: AcceptedFreshTaskAdmission) => AcceptedFreshTaskDeliveryProposal
    ) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (!isFreshTaskCandidateFrontier(frontier)) {
            return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
          }
          const currentRunId = (yield* Ref.get(state)).acceptedBasis.runId
          if (!freshFrontierMatchesRun(frontier, currentRunId)) {
            return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
          }
          const position = yield* reserveFreshTaskPosition(frontier)
          if (position === null) {
            return { _tag: "Deferred" as const, reason: "TaskWorkPositionUnavailable" as const }
          }
          const candidate = position.candidate
          const proposal = materialize({
            [AcceptedFreshTaskAdmissionTypeId]: AcceptedFreshTaskAdmissionTypeId,
            candidate
          })
          if (!acceptedFreshProposalMatchesCandidate(proposal, candidate)) {
            yield* restoreFreshTaskReservation(position, null)
            return yield* Effect.die(`accepted fresh proposal does not match candidate ${candidate.id}`)
          }
          yield* markFreshEntryActivity(candidate, { _tag: "Owned", proposalId: proposal.id })
          return yield* tryReservePrepared(proposal, position).pipe(
            Effect.onError(() => restoreFreshTaskReservation(position, proposal.id))
          )
        })
      )
  )

  const releaseRollbackResources = (reservation: DeliveryAdmissionReservation) => {
    const releaseIntegration =
      reservation.acquiredIntegrationResponsibility === null
        ? Effect.void
        : integrationTargets.release(reservation.acquiredIntegrationResponsibility)
    const releaseProtocol =
      reservation._tag === "PlannedAttemptProtocolAdmission" ? reservation.permit.release : Effect.void
    // Each independent capability is finalized even if another finalizer
    // defects. Settlement remains one-shot, while partial resource release is
    // not exposed as a retryable reservation.
    return reservation.forwardOwner.release.pipe(Effect.ensuring(releaseProtocol), Effect.ensuring(releaseIntegration))
  }

  const releaseCompletionResources = (reservation: DeliveryAdmissionReservation) =>
    reservation.forwardOwner.release.pipe(
      Effect.ensuring(reservation._tag === "PlannedAttemptProtocolAdmission" ? reservation.permit.release : Effect.void)
    )

  const rollback = Effect.fn("DeliveryRuntimeAdmission.rollback")(
    (reservation: DeliveryAdmissionReservation, disposition: DeliveryAdmissionRollbackDisposition) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const binding = yield* consumeReservation(reservation)
          if (binding === null) {
            return yield* Effect.die("delivery admission rollback requires the exact issued reservation")
          }
          yield* Effect.gen(function* () {
            if (reservation.createdTaskPositionFor !== null && disposition === "BeforeDurableClaimIntent") {
              yield* releaseTaskReservation(reservation.createdTaskPositionFor, reservation.proposal.id)
            }
            if (reservation.freshTaskCandidate !== null) {
              if (disposition === "BeforeDurableClaimIntent" || binding._tag !== "FreshClaimOperationBinding") {
                yield* restoreFreshTaskReservation(
                  { candidate: reservation.freshTaskCandidate, previous: reservation.freshEntryPrevious },
                  reservation.proposal.id
                )
              } else {
                yield* markFreshEntryActivity(reservation.freshTaskCandidate, {
                  _tag: "AwaitingDurableCommitment",
                  claimOperationId: binding.operationId
                })
              }
            }
          }).pipe(Effect.ensuring(releaseRollbackResources(reservation)))
        })
      )
  )

  const complete = Effect.fn("DeliveryRuntimeAdmission.complete")((reservation: DeliveryAdmissionReservation) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const binding = yield* consumeReservation(reservation)
        if (binding === null) {
          return yield* Effect.die("delivery admission completion requires the exact issued reservation")
        }
        yield* Effect.gen(function* () {
          if (reservation.freshTaskCandidate !== null) {
            const activity: FreshEntryActivity =
              reservation.freshTaskCandidate.decision.step._tag === "ReadCurrentTaskGraph"
                ? { _tag: "IdlePreIntent" }
                : binding._tag === "FreshClaimOperationBinding"
                  ? { _tag: "AwaitingDurableCommitment", claimOperationId: binding.operationId }
                  : yield* Effect.die("fresh claim completion requires its exact materialized operation binding")
            yield* markFreshEntryActivity(reservation.freshTaskCandidate, activity)
          }
          if (
            reservation.freshTaskCandidate === null &&
            reservation.createdTaskPositionFor !== null &&
            reservation.proposal.admission.plannedAttemptProtocol._tag === "NoPlannedAttemptProtocol"
          ) {
            yield* releaseTaskReservation(reservation.createdTaskPositionFor, reservation.proposal.id)
          }
        }).pipe(Effect.ensuring(releaseCompletionResources(reservation)))
      })
    )
  )

  const bindFreshTaskClaimOperation = Effect.fn("DeliveryRuntimeAdmission.bindFreshTaskClaimOperation")(function* (
    reservation: DeliveryAdmissionReservation,
    operationId: OperationId
  ) {
    const candidate = reservation.freshTaskCandidate
    if (candidate?.decision.step._tag !== "AcquireTaskClaim") {
      return yield* Effect.die("fresh claim operation binding requires an admitted fresh claim proposal")
    }
    if (!(yield* bindActiveReservation(reservation, { _tag: "FreshClaimOperationBinding", operationId }))) {
      return yield* Effect.die("fresh claim operation binding requires one exact active reservation")
    }
    const bound = yield* Ref.modify(state, (current) => {
      const position = current.positions.get(candidate.taskId)
      if (
        position?._tag !== "FreshEntryRuntimePosition" ||
        position.occupancy.candidate.id !== candidate.id ||
        position.activity._tag !== "Owned" ||
        position.activity.proposalId !== reservation.proposal.id
      ) {
        return [false, current]
      }
      return [
        true,
        {
          ...current,
          positions: new Map(current.positions).set(
            candidate.taskId,
            freshEntryRuntimePosition(candidate, {
              _tag: "FreshClaimOperationBound",
              claimOperationId: operationId,
              proposalId: reservation.proposal.id
            })
          )
        }
      ]
    })
    if (!bound) {
      activeReservations.set(reservation, { _tag: "NoReservationBinding" })
      return yield* Effect.die(`fresh claim operation rejected reservation ${reservation.proposal.id}`)
    }
  })

  const bindPlannedAttemptPosition = Effect.fn("DeliveryRuntimeAdmission.bindPlannedAttemptPosition")(function* (
    reservation: DeliveryAdmissionReservation,
    plannedAttempt: PlannedTaskAttempt,
    acceptedResponsibility?: AcceptedPlannedAttemptExecutorResponsibility
  ) {
    if (
      !(yield* bindActiveReservation(reservation, {
        _tag: "PlannedAttemptHandoffBinding",
        plannedAttempt: immutableSnapshot(plannedAttempt)
      }))
    ) {
      return yield* Effect.die("planned-attempt binding requires one exact active reservation")
    }
    const continuation = freshContinuationCommitmentRequirementOf(reservation.proposal)
    const handoff: LocallyAcceptedAttemptPosition["handoff"] =
      continuation._tag === "FreshContinuationCommitmentRequired"
        ? { _tag: "FreshCommitmentHandoff", commitment: continuation.commitment }
        : { _tag: "ExistingAttemptHandoff" }
    const bound = yield* Ref.modify(state, (current) =>
      bindPlannedAttemptPositionState(current, {
        acceptedResponsibility,
        continuation,
        handoff,
        plannedAttempt,
        proposal: reservation.proposal,
        proposedAttempt: freshBeginAttemptOf(reservation.proposal)
      })
    )
    if (!bound) {
      activeReservations.set(reservation, { _tag: "NoReservationBinding" })
      return yield* Effect.die(`planned-attempt position rejected reservation ${reservation.proposal.id}`)
    }
  })

  return {
    bindFreshTaskClaimOperation,
    bindPlannedAttemptPosition,
    releasePlannedAttemptPosition: (correlation) =>
      Ref.modify(state, (current) => {
        const found = [...current.positions].find(([, position]) => {
          const existingCorrelation = positionCorrelation(position)
          return existingCorrelation !== undefined && sameCorrelation(existingCorrelation, correlation)
        })
        if (found === undefined) return ["AlreadyAbsent" as const, current]
        const positions = new Map([...current.positions].filter(([taskId]) => taskId !== found[0]))
        return ["Released" as const, { ...current, positions }]
      }),
    complete,
    rollback,
    snapshot: Ref.get(state).pipe(
      Effect.map((current) => ({
        acceptedBasis: current.acceptedBasis,
        capacity: current.capacity,
        positions: new Map(
          [...current.positions].map(([taskId, position]) => [taskId, detachedSnapshotPosition(position)] as const)
        )
      }))
    ),
    synchronize,
    tryReserve,
    tryReserveFresh
  }
})
