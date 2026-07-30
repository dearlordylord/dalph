import type { AttemptId, PlannedTaskAttempt, RunId, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import type { ClaimToken, OperationId, WorkflowOperation } from "@dalph/orchestrator"

export interface RecordedOperationIdentityMaps {
  readonly attemptIds: ReadonlyMap<AttemptId, AttemptId>
  readonly claimTokens: ReadonlyMap<ClaimToken, ClaimToken>
  readonly operationIds: ReadonlyMap<OperationId, OperationId>
  readonly runIds: ReadonlyMap<RunId, RunId>
  readonly taskBranchRefs: ReadonlyMap<TaskBranchRef, TaskBranchRef>
  readonly worktreeLocators: ReadonlyMap<WorktreeLocator, WorktreeLocator>
}

const renamed = <Identity>(value: Identity, map: ReadonlyMap<Identity, Identity>): Identity => map.get(value) ?? value

const renamePredecessors = (predecessors: ReadonlyArray<OperationId>, maps: RecordedOperationIdentityMaps) =>
  predecessors.map((operationId) => renamed(operationId, maps.operationIds))

export const renamePlannedAttempt = (
  attempt: PlannedTaskAttempt,
  maps: RecordedOperationIdentityMaps
): PlannedTaskAttempt => ({
  ...attempt,
  attemptId: renamed(attempt.attemptId, maps.attemptIds),
  branch: renamed(attempt.branch, maps.taskBranchRefs),
  runId: renamed(attempt.runId, maps.runIds),
  worktree: renamed(attempt.worktree, maps.worktreeLocators)
})

export const renameWorkflowOperation = (
  operation: WorkflowOperation,
  maps: RecordedOperationIdentityMaps
): WorkflowOperation => {
  switch (operation._tag) {
    case "AcquireTaskClaim":
      return {
        ...operation,
        acquisition: {
          ...operation.acquisition,
          operationId: renamed(operation.acquisition.operationId, maps.operationIds),
          token: renamed(operation.acquisition.token, maps.claimTokens)
        },
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }
    case "ReleaseTaskClaim":
      return {
        ...operation,
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps),
        release: {
          claim: {
            ...operation.release.claim,
            operationId: renamed(operation.release.claim.operationId, maps.operationIds),
            token: renamed(operation.release.claim.token, maps.claimTokens)
          },
          operationId: renamed(operation.release.operationId, maps.operationIds)
        }
      }
    case "ReadTaskClaim":
    case "ReadTaskWorkSpecification":
    case "ReadTrackerGraph":
      return {
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }
    case "RecordTaskAttemptPlan":
    case "ReconcileTaskWorktree":
      return {
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        plannedAttempt: renamePlannedAttempt(operation.plannedAttempt, maps),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }
  }
}
