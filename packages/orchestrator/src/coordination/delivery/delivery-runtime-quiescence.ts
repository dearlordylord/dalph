import {
  type PlannedAttemptExecutorCorrelation,
  type RunId,
  samePlannedAttemptExecutorCorrelation,
  type TaskId
} from "@dalph/contracts"
import { Option, Schema } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { deliveryProposalOrderTaskId, type DeliveryProposalId } from "./delivery-action-proposal.js"
import { deliveryProposalPlannedAttemptSubject, type ActiveRefreshPreG2Subject } from "./delivery-runtime-phase.js"
import type {
  DeliveryProposalFrontier,
  DeliveryQuiescenceDisposition,
  DeliveryTaskWorkAdmissionBasis,
  DeliveryRuntimeEvaluation,
  DeliveryRuntimeSnapshot,
  TrackerGraphState
} from "./relations.js"

export type AvailableProposalFrontier = Extract<
  DeliveryProposalFrontier,
  { readonly _tag: "DeliveryProposalsAvailable" }
>
export type EmptyProposalFrontier = Omit<AvailableProposalFrontier, "proposals"> & { readonly proposals: readonly [] }
type NonEmptyProposalFrontier = Omit<AvailableProposalFrontier, "proposals"> & {
  readonly proposals: readonly [
    AvailableProposalFrontier["proposals"][number],
    ...AvailableProposalFrontier["proposals"]
  ]
}
type EstablishedTrackerGraph = Extract<TrackerGraphState, { readonly _tag: "GraphEstablished" }>
type EstablishedRuntimeSnapshot = Omit<DeliveryRuntimeSnapshot, "trackerGraph"> & {
  readonly trackerGraph: EstablishedTrackerGraph
}
type PostG2ClassifiableEvaluation = DeliveryRuntimeEvaluation & {
  readonly acceptedAt: JournalPosition
  readonly activeRefreshBoundary: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]>
  readonly current: EstablishedRuntimeSnapshot
  readonly quiescence: Extract<DeliveryQuiescenceDisposition, { readonly _tag: "TrackerReconfirmationAllowed" }>
}

/** Activation-local identity of one queued proof cut; it is never an authority revision or persisted fact. */
export const PostG2AdmissionStallCutToken = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("PostG2AdmissionStallCutToken")
)
export type PostG2AdmissionStallCutToken = typeof PostG2AdmissionStallCutToken.Type

/** One exact ReserveOrReuse action whose successful Executing outcome this post-G2 phase applied. */
export interface AppliedPostG2TaskWorkOutcome {
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly proposalId: DeliveryProposalId
  readonly taskId: TaskId
}

/**
 * Exact unfinished attempts hold every position while exact prepared attempts
 * still require one. A position bound by this activation can lead its
 * descriptive relation projection; after every local owner settles, the sole
 * activation owner must regain control without mistaking the Run for final.
 */
interface TaskWorkAdmissionStalledRuntimeQuiescence {
  readonly _tag: "TaskWorkAdmissionStalledRuntimeQuiescence"
  readonly acceptedAt: DeliveryRuntimeEvaluation["acceptedAt"]
  readonly current: DeliveryRuntimeSnapshot
  readonly disposition: DeliveryQuiescenceDisposition
  readonly proposedActions: AvailableProposalFrontier
  readonly taskWork: DeliveryRuntimeEvaluation["taskWork"]
}

/**
 * G2 admitted and completed exact task work that filled the available
 * capacity, and every retained exact proposal was denied by that current
 * capacity. The non-empty frontier remains descriptive input for a later
 * activation rather than being erased into generic reconfirmation.
 */
export interface PostG2TaskWorkAdmissionStalledRuntimeQuiescence {
  readonly _tag: "PostG2TaskWorkAdmissionStalledRuntimeQuiescence"
  readonly acceptedAt: JournalPosition
  readonly activeRefreshBoundary: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]>
  readonly current: EstablishedRuntimeSnapshot
  readonly disposition: Extract<DeliveryQuiescenceDisposition, { readonly _tag: "TrackerReconfirmationAllowed" }>
  readonly proposedActions: NonEmptyProposalFrontier
  readonly taskWork: DeliveryTaskWorkAdmissionBasis
}

const sameHeldTaskWorkPosition = (
  left: DeliveryTaskWorkAdmissionBasis["held"][number],
  right: DeliveryTaskWorkAdmissionBasis["held"][number]
): boolean => left.taskId === right.taskId && samePlannedAttemptExecutorCorrelation(left.correlation, right.correlation)

/** Compares exact Run/attempt pairs as a duplicate-free structural set without inventing a string identity. */
export const sameExactPlannedAttemptCorrelationSet = (
  left: ReadonlyArray<ActiveRefreshPreG2Subject>,
  right: ReadonlyArray<ActiveRefreshPreG2Subject>
): boolean =>
  left.length === right.length &&
  left.every((subject) => right.some((candidate) => samePlannedAttemptExecutorCorrelation(subject, candidate))) &&
  left.every(
    (subject, index) =>
      left.findIndex((candidate) => samePlannedAttemptExecutorCorrelation(subject, candidate)) === index
  ) &&
  right.every(
    (subject, index) =>
      right.findIndex((candidate) => samePlannedAttemptExecutorCorrelation(subject, candidate)) === index
  )

const exactCorrelationSetIsUnique = (subjects: ReadonlyArray<ActiveRefreshPreG2Subject>): boolean =>
  subjects.every(
    (subject, index) =>
      subjects.findIndex((candidate) => samePlannedAttemptExecutorCorrelation(subject, candidate)) === index
  )

const exactCorrelationSetContains = (
  containing: ReadonlyArray<ActiveRefreshPreG2Subject>,
  contained: ReadonlyArray<ActiveRefreshPreG2Subject>
): boolean =>
  exactCorrelationSetIsUnique(containing) &&
  exactCorrelationSetIsUnique(contained) &&
  contained.every((subject) =>
    containing.some((candidate) => samePlannedAttemptExecutorCorrelation(subject, candidate))
  )

/** Compares the complete effective task-work capacity basis used by one admission decision. */
export const sameDeliveryTaskWorkAdmissionBasis = (
  left: DeliveryTaskWorkAdmissionBasis,
  right: DeliveryTaskWorkAdmissionBasis
): boolean =>
  left.capacity === right.capacity &&
  left.held.length === right.held.length &&
  left.held.every((position) => right.held.some((candidate) => sameHeldTaskWorkPosition(position, candidate))) &&
  left.held.every(
    (position, index) => left.held.findIndex((candidate) => sameHeldTaskWorkPosition(position, candidate)) === index
  ) &&
  right.held.every(
    (position, index) => right.held.findIndex((candidate) => sameHeldTaskWorkPosition(position, candidate)) === index
  )

const heldPositionBelongsToCurrentPostG2Basis = (
  phaseSubjects: ReadonlyArray<ActiveRefreshPreG2Subject>,
  held: DeliveryTaskWorkAdmissionBasis["held"][number],
  appliedTaskWorkOutcomes: ReadonlyArray<AppliedPostG2TaskWorkOutcome>
): boolean =>
  phaseSubjects.some((subject) => samePlannedAttemptExecutorCorrelation(subject, held.correlation)) ||
  appliedTaskWorkOutcomes.some(
    (outcome) =>
      outcome.taskId === held.taskId && samePlannedAttemptExecutorCorrelation(outcome.correlation, held.correlation)
  )

const proposalHasExactTaskWorkSubject = (
  expectedRunId: RunId,
  proposal: AvailableProposalFrontier["proposals"][number]
): boolean => {
  const position = proposal.admission.taskWorkPosition
  const protocol = proposal.admission.plannedAttemptProtocol
  const routeSubject = deliveryProposalPlannedAttemptSubject(proposal)
  const orderTaskId = deliveryProposalOrderTaskId(proposal.order)
  return (
    position._tag === "TaskWorkPositionRequired" &&
    position.mode === "ReserveOrReuse" &&
    protocol._tag === "PlannedAttemptProtocolRequired" &&
    routeSubject !== undefined &&
    routeSubject.runId === expectedRunId &&
    routeSubject.taskId === position.taskId &&
    orderTaskId === position.taskId &&
    samePlannedAttemptExecutorCorrelation(routeSubject, protocol.correlation)
  )
}

const exactPostG2ContextIsPresent = (
  expectedRunId: RunId,
  phaseSubjects: ReadonlyArray<ActiveRefreshPreG2Subject>,
  current: DeliveryRuntimeEvaluation
): boolean => {
  const boundary = current.activeRefreshBoundary
  if (boundary === undefined) return false
  const checks = [
    current.acceptedAt !== null,
    current.current.runId === expectedRunId,
    boundary.runId === expectedRunId,
    phaseSubjects.every(({ runId }) => runId === expectedRunId),
    boundary.reconciledAttempts.every(({ runId }) => runId === expectedRunId),
    exactCorrelationSetContains(phaseSubjects, boundary.reconciledAttempts),
    current.current.trackerGraph._tag === "GraphEstablished",
    current.quiescence._tag === "TrackerReconfirmationAllowed"
  ]
  return checks.every(Boolean)
}

const isPostG2ClassifiableEvaluation = (current: DeliveryRuntimeEvaluation): current is PostG2ClassifiableEvaluation =>
  current.acceptedAt !== null &&
  current.activeRefreshBoundary !== undefined &&
  current.current.trackerGraph._tag === "GraphEstablished" &&
  current.quiescence._tag === "TrackerReconfirmationAllowed"

const exactHeldPostG2BasisIsPresent = (
  expectedRunId: RunId,
  phaseSubjects: ReadonlyArray<ActiveRefreshPreG2Subject>,
  current: DeliveryRuntimeEvaluation,
  taskWork: DeliveryTaskWorkAdmissionBasis,
  appliedTaskWorkOutcomes: ReadonlyArray<AppliedPostG2TaskWorkOutcome>
): boolean => {
  const checks = [
    taskWork.held.length === Number(taskWork.capacity),
    taskWork.held.length === current.taskWork.held.length,
    taskWork.held.every(({ correlation }) => correlation.runId === expectedRunId),
    taskWork.held.every(
      (held) =>
        current.taskWork.held.some((currentHeld) => sameHeldTaskWorkPosition(held, currentHeld)) &&
        heldPositionBelongsToCurrentPostG2Basis(phaseSubjects, held, appliedTaskWorkOutcomes)
    )
  ]
  return checks.every(Boolean)
}

const everyRetainedProposalHasCurrentCapacityDenial = (
  expectedRunId: RunId,
  retained: NonEmptyProposalFrontier,
  taskWork: DeliveryTaskWorkAdmissionBasis,
  capacityDeniedProposalIds: ReadonlySet<DeliveryProposalId>
): boolean =>
  retained.proposals.every((proposal) => {
    const { admission, id } = proposal
    if (
      !capacityDeniedProposalIds.has(id) ||
      !proposalHasExactTaskWorkSubject(expectedRunId, proposal) ||
      admission.plannedAttemptProtocol._tag !== "PlannedAttemptProtocolRequired"
    ) {
      return false
    }
    const requested = admission.plannedAttemptProtocol.correlation
    return !taskWork.held.some(({ correlation }) => samePlannedAttemptExecutorCorrelation(correlation, requested))
  })

const newlyAppliedOutcomeStillHoldsPosition = (
  expectedRunId: RunId,
  phaseSubjects: ReadonlyArray<ActiveRefreshPreG2Subject>,
  taskWork: DeliveryTaskWorkAdmissionBasis,
  outcomes: ReadonlyArray<AppliedPostG2TaskWorkOutcome>
): boolean =>
  outcomes.some(
    (outcome) =>
      outcome.correlation.runId === expectedRunId &&
      !phaseSubjects.some((subject) => samePlannedAttemptExecutorCorrelation(subject, outcome.correlation)) &&
      taskWork.held.some(
        (held) =>
          held.taskId === outcome.taskId && samePlannedAttemptExecutorCorrelation(held.correlation, outcome.correlation)
      )
  )

/** Classifies only the current applied post-G2 outcome and current complete capacity-denial set. */
export const classifyPostG2TaskWorkAdmissionStalledRuntimeQuiescence = (
  expectedRunId: RunId,
  phaseSubjects: ReadonlyArray<ActiveRefreshPreG2Subject>,
  current: DeliveryRuntimeEvaluation,
  taskWork: DeliveryTaskWorkAdmissionBasis,
  proposedActions: AvailableProposalFrontier,
  capacityDeniedProposalIds: ReadonlySet<DeliveryProposalId>,
  appliedTaskWorkOutcomes: ReadonlyArray<AppliedPostG2TaskWorkOutcome>
): Option.Option<PostG2TaskWorkAdmissionStalledRuntimeQuiescence> => {
  const [first, ...rest] = proposedActions.proposals
  if (
    first === undefined ||
    !isPostG2ClassifiableEvaluation(current) ||
    !exactPostG2ContextIsPresent(expectedRunId, phaseSubjects, current) ||
    !exactHeldPostG2BasisIsPresent(expectedRunId, phaseSubjects, current, taskWork, appliedTaskWorkOutcomes)
  ) {
    return Option.none()
  }
  const activeRefreshBoundary = current.activeRefreshBoundary
  const retained: NonEmptyProposalFrontier = { ...proposedActions, proposals: [first, ...rest] }
  const everyRetainedProposalWasDeniedByCurrentCapacity = everyRetainedProposalHasCurrentCapacityDenial(
    expectedRunId,
    retained,
    taskWork,
    capacityDeniedProposalIds
  )
  const aNewlyAppliedOutcomeStillHoldsItsExactPosition = newlyAppliedOutcomeStillHoldsPosition(
    expectedRunId,
    phaseSubjects,
    taskWork,
    appliedTaskWorkOutcomes
  )
  return everyRetainedProposalWasDeniedByCurrentCapacity && aNewlyAppliedOutcomeStillHoldsItsExactPosition
    ? Option.some({
        _tag: "PostG2TaskWorkAdmissionStalledRuntimeQuiescence",
        acceptedAt: current.acceptedAt,
        activeRefreshBoundary,
        current: { ...current.current, trackerGraph: current.current.trackerGraph },
        disposition: current.quiescence,
        proposedActions: retained,
        taskWork
      })
    : Option.none()
}

/** Classifies only exact prepared attempts that cannot reuse any currently held position. */
export const classifyTaskWorkAdmissionStalledRuntimeQuiescence = (
  current: DeliveryRuntimeEvaluation,
  taskWork: DeliveryTaskWorkAdmissionBasis,
  proposedActions: AvailableProposalFrontier
): Option.Option<TaskWorkAdmissionStalledRuntimeQuiescence> => {
  const stalled =
    taskWork.held.length >= Number(taskWork.capacity) &&
    proposedActions.proposals.length > 0 &&
    proposedActions.proposals.every(({ admission }) => {
      if (
        admission.taskWorkPosition._tag !== "TaskWorkPositionRequired" ||
        admission.taskWorkPosition.mode !== "ReserveOrReuse" ||
        admission.plannedAttemptProtocol._tag !== "PlannedAttemptProtocolRequired"
      ) {
        return false
      }
      const requested = admission.plannedAttemptProtocol.correlation
      return !taskWork.held.some(
        ({ correlation: held }) => held.runId === requested.runId && held.attemptId === requested.attemptId
      )
    })
  return stalled
    ? Option.some({
        _tag: "TaskWorkAdmissionStalledRuntimeQuiescence",
        acceptedAt: current.acceptedAt,
        current: current.current,
        disposition: current.quiescence,
        proposedActions,
        taskWork
      })
    : Option.none()
}

/** The exact descriptive state observed after no executable or admitted action remains. */
export type DeliveryRuntimeQuiescence =
  | TaskWorkAdmissionStalledRuntimeQuiescence
  | PostG2TaskWorkAdmissionStalledRuntimeQuiescence
  | {
      readonly _tag: "PassiveRuntimeQuiescence"
      readonly acceptedAt: DeliveryRuntimeEvaluation["acceptedAt"]
      readonly current: DeliveryRuntimeSnapshot
      readonly disposition: Extract<DeliveryQuiescenceDisposition, { readonly _tag: "QuiescencePassive" }>
      readonly proposedActions: EmptyProposalFrontier
      /** Active-refresh completion survives this quiescence until stabilization performs G2. */
      readonly activeRefreshBoundary?: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]>
    }
  | {
      readonly _tag: "TrackerReconfirmationQuiescence"
      readonly acceptedAt: JournalPosition
      readonly current: EstablishedRuntimeSnapshot
      readonly disposition: Extract<DeliveryQuiescenceDisposition, { readonly _tag: "TrackerReconfirmationAllowed" }>
      readonly proposedActions: EmptyProposalFrontier
      /** Active-refresh completion survives this quiescence until stabilization performs G2. */
      readonly activeRefreshBoundary?: NonNullable<DeliveryRuntimeEvaluation["activeRefreshBoundary"]>
    }
