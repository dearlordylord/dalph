import type { PlannedTaskAttempt } from "@dalph/contracts"
import { OperationId } from "../../identity.js"

/** One immutable identity bundle for all replacement authority witnesses. */
export const replacementFixtureIdsFor = (attempt: PlannedTaskAttempt) => {
  const prefix = `cleanup-provenance:${attempt.attemptId}`
  const predecessorOperationIds: readonly [
    OperationId,
    OperationId,
    OperationId,
    OperationId,
    OperationId,
    OperationId
  ] = [
    OperationId.make(`${prefix}:claim`),
    OperationId.make(`${prefix}:graph`),
    OperationId.make(`${prefix}:specification`),
    OperationId.make(`${prefix}:claim-observation`),
    OperationId.make(`${prefix}:worktree-observation`),
    OperationId.make(`${prefix}:target-lineage`)
  ]
  return Object.freeze({
    claimOperationId: predecessorOperationIds[0],
    graphObservationOperationId: predecessorOperationIds[1],
    specificationObservationOperationId: predecessorOperationIds[2],
    claimObservationOperationId: predecessorOperationIds[3],
    worktreeObservationOperationId: predecessorOperationIds[4],
    targetLineageObservationOperationId: predecessorOperationIds[5],
    requestNonce: prefix,
    successorPlanOperationId: OperationId.make(`${prefix}:successor-plan`),
    predecessorOperationIds
  })
}

/** Stable operation identities carried by one replacement event's authority chain. */
export const replacementPredecessorsFor = (
  attempt: PlannedTaskAttempt
): readonly [OperationId, OperationId, OperationId, OperationId, OperationId, OperationId] =>
  replacementFixtureIdsFor(attempt).predecessorOperationIds

/** The exact old-worktree read named by a replacement witness. */
export const replacementWorktreeObservationOperationIdFor = (attempt: PlannedTaskAttempt): OperationId =>
  replacementFixtureIdsFor(attempt).worktreeObservationOperationId
