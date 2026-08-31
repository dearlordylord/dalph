import { Option } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type {
  DeliveryProposalFrontier,
  DeliveryQuiescenceDisposition,
  DeliveryRuntimeEvaluation,
  DeliveryRuntimeSnapshot,
  TrackerGraphState
} from "./relations.js"

type AvailableProposalFrontier = Extract<DeliveryProposalFrontier, { readonly _tag: "DeliveryProposalsAvailable" }>
export type EmptyProposalFrontier = Omit<AvailableProposalFrontier, "proposals"> & { readonly proposals: readonly [] }
type EstablishedTrackerGraph = Extract<TrackerGraphState, { readonly _tag: "GraphEstablished" }>
type EstablishedRuntimeSnapshot = Omit<DeliveryRuntimeSnapshot, "trackerGraph"> & {
  readonly trackerGraph: EstablishedTrackerGraph
}

/**
 * Exact task attempts outside this activation hold every position while exact
 * prepared attempts still require one. No local owner can free capacity, so
 * the enclosing sole activation owner must regain control without mistaking
 * the Run for final.
 */
interface TaskWorkAdmissionStalledRuntimeQuiescence {
  readonly _tag: "TaskWorkAdmissionStalledRuntimeQuiescence"
  readonly acceptedAt: DeliveryRuntimeEvaluation["acceptedAt"]
  readonly current: DeliveryRuntimeSnapshot
  readonly disposition: DeliveryQuiescenceDisposition
  readonly proposedActions: AvailableProposalFrontier
  readonly taskWork: DeliveryRuntimeEvaluation["taskWork"]
}

/** Classifies only exact prepared attempts that cannot reuse any currently held position. */
export const classifyTaskWorkAdmissionStalledRuntimeQuiescence = (
  current: DeliveryRuntimeEvaluation,
  proposedActions: AvailableProposalFrontier
): Option.Option<TaskWorkAdmissionStalledRuntimeQuiescence> => {
  const stalled =
    current.taskWork.held.length >= Number(current.taskWork.capacity) &&
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
      return !current.taskWork.held.some(
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
        taskWork: current.taskWork
      })
    : Option.none()
}

/** The exact descriptive state observed after no executable or admitted action remains. */
export type DeliveryRuntimeQuiescence =
  | TaskWorkAdmissionStalledRuntimeQuiescence
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
