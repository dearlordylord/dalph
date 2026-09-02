import type { PlannedAttemptExecutorCorrelation, TaskId } from "@dalph/contracts"
import { Option, Schema } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { DeliveryProposalId } from "./delivery-action-proposal.js"
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
export type NonEmptyProposalFrontier = Omit<AvailableProposalFrontier, "proposals"> & {
  readonly proposals: readonly [
    AvailableProposalFrontier["proposals"][number],
    ...AvailableProposalFrontier["proposals"]
  ]
}
type EstablishedTrackerGraph = Extract<TrackerGraphState, { readonly _tag: "GraphEstablished" }>
type EstablishedRuntimeSnapshot = Omit<DeliveryRuntimeSnapshot, "trackerGraph"> & {
  readonly trackerGraph: EstablishedTrackerGraph
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

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.runId === right.runId && left.attemptId === right.attemptId

const sameHeldPosition = (
  left: DeliveryTaskWorkAdmissionBasis["held"][number],
  right: DeliveryTaskWorkAdmissionBasis["held"][number]
): boolean => left.taskId === right.taskId && sameCorrelation(left.correlation, right.correlation)

const heldPositionBelongsToCurrentPostG2Basis = (
  current: DeliveryRuntimeEvaluation,
  held: DeliveryTaskWorkAdmissionBasis["held"][number],
  appliedTaskWorkOutcomes: ReadonlyArray<AppliedPostG2TaskWorkOutcome>
): boolean =>
  current.activeRefreshBoundary?.reconciledAttempts.some((subject) => sameCorrelation(subject, held.correlation)) ===
    true ||
  appliedTaskWorkOutcomes.some(
    (outcome) => outcome.taskId === held.taskId && sameCorrelation(outcome.correlation, held.correlation)
  )

/** Classifies only the current applied post-G2 outcome and current complete capacity-denial set. */
export const classifyPostG2TaskWorkAdmissionStalledRuntimeQuiescence = (
  current: DeliveryRuntimeEvaluation,
  taskWork: DeliveryTaskWorkAdmissionBasis,
  proposedActions: AvailableProposalFrontier,
  capacityDeniedProposalIds: ReadonlySet<DeliveryProposalId>,
  appliedTaskWorkOutcomes: ReadonlyArray<AppliedPostG2TaskWorkOutcome>
): Option.Option<PostG2TaskWorkAdmissionStalledRuntimeQuiescence> => {
  const [first, ...rest] = proposedActions.proposals
  if (
    first === undefined ||
    current.acceptedAt === null ||
    current.activeRefreshBoundary === undefined ||
    current.current.trackerGraph._tag !== "GraphEstablished" ||
    current.quiescence._tag !== "TrackerReconfirmationAllowed" ||
    taskWork.held.length !== Number(taskWork.capacity) ||
    taskWork.held.length !== current.taskWork.held.length ||
    !taskWork.held.every(
      (held) =>
        current.taskWork.held.some((currentHeld) => sameHeldPosition(held, currentHeld)) &&
        heldPositionBelongsToCurrentPostG2Basis(current, held, appliedTaskWorkOutcomes)
    )
  ) {
    return Option.none()
  }
  const retained: NonEmptyProposalFrontier = { ...proposedActions, proposals: [first, ...rest] }
  const everyRetainedProposalWasDeniedByCurrentCapacity = retained.proposals.every(({ admission, id }) => {
    if (
      !capacityDeniedProposalIds.has(id) ||
      admission.taskWorkPosition._tag !== "TaskWorkPositionRequired" ||
      admission.taskWorkPosition.mode !== "ReserveOrReuse" ||
      admission.plannedAttemptProtocol._tag !== "PlannedAttemptProtocolRequired"
    ) {
      return false
    }
    const requested = admission.plannedAttemptProtocol.correlation
    return !taskWork.held.some(({ correlation }) => sameCorrelation(correlation, requested))
  })
  const aNewlyAppliedOutcomeStillHoldsItsExactPosition = appliedTaskWorkOutcomes.some(
    (outcome) =>
      !current.activeRefreshBoundary.reconciledAttempts.some((subject) =>
        sameCorrelation(subject, outcome.correlation)
      ) &&
      taskWork.held.some(
        (held) => held.taskId === outcome.taskId && sameCorrelation(held.correlation, outcome.correlation)
      )
  )
  return everyRetainedProposalWasDeniedByCurrentCapacity && aNewlyAppliedOutcomeStillHoldsItsExactPosition
    ? Option.some({
        _tag: "PostG2TaskWorkAdmissionStalledRuntimeQuiescence",
        acceptedAt: current.acceptedAt,
        activeRefreshBoundary: current.activeRefreshBoundary,
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
