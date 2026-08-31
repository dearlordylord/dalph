import type {
  DeliveryProposalFrontier,
  DeliveryQuiescenceDisposition,
  DeliveryRuntimeEvaluation,
  DeliveryRuntimeSnapshot
} from "./relations.js"

type AvailableProposalFrontier = Extract<DeliveryProposalFrontier, { readonly _tag: "DeliveryProposalsAvailable" }>

/**
 * Exact task attempts outside this activation hold every position while exact
 * prepared attempts still require one. No local owner can free capacity, so
 * the enclosing sole activation owner must regain control without mistaking
 * the Run for final.
 */
export interface TaskWorkAdmissionStalledRuntimeQuiescence {
  readonly _tag: "TaskWorkAdmissionStalledRuntimeQuiescence"
  readonly acceptedAt: DeliveryRuntimeEvaluation["acceptedAt"]
  readonly current: DeliveryRuntimeSnapshot
  readonly disposition: DeliveryQuiescenceDisposition
  readonly proposedActions: AvailableProposalFrontier
  readonly taskWork: DeliveryRuntimeEvaluation["taskWork"]
}

export const taskWorkAdmissionStalledRuntimeQuiescenceOf = (
  current: DeliveryRuntimeEvaluation,
  proposedActions: AvailableProposalFrontier
): TaskWorkAdmissionStalledRuntimeQuiescence => ({
  _tag: "TaskWorkAdmissionStalledRuntimeQuiescence",
  acceptedAt: current.acceptedAt,
  current: current.current,
  disposition: current.quiescence,
  proposedActions,
  taskWork: current.taskWork
})

/** Exact prepared attempts for which every position is held by another exact attempt. */
export const exactPreparedTaskWorkAdmissionIsStalled = (
  current: DeliveryRuntimeEvaluation,
  proposedActions: AvailableProposalFrontier
): boolean =>
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
