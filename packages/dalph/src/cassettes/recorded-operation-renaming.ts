import { Match } from "effect"
import type { AttemptId, PlannedTaskAttempt, RunId, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import {
  ActiveWorkAuthorityRefreshGitReadPurpose,
  completionTaskFocusedReadOperationIdFor,
  type ClaimToken,
  type CompletionTaskRequest,
  type OperationId,
  type WorkflowOperation
} from "@dalph/orchestrator"

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

const renameActiveWorkAuthorityRefreshGitReadPurpose = (
  purpose: typeof ActiveWorkAuthorityRefreshGitReadPurpose.Type,
  maps: RecordedOperationIdentityMaps
): typeof ActiveWorkAuthorityRefreshGitReadPurpose.Type =>
  ActiveWorkAuthorityRefreshGitReadPurpose.make({
    authority: {
      ...purpose.authority,
      attemptId: renamed(purpose.authority.attemptId, maps.attemptIds),
      runId: renamed(purpose.authority.runId, maps.runIds)
    },
    ordinal: purpose.ordinal
  })

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

// eslint-disable-next-line complexity -- Closed operation variants must explicitly declare which identities are renamed or preserved.
export const renameWorkflowOperation = (
  operation: WorkflowOperation,
  maps: RecordedOperationIdentityMaps,
  renameCompletionRequest: (request: CompletionTaskRequest) => CompletionTaskRequest
): WorkflowOperation =>
  Match.value(operation).pipe(
    Match.tagsExhaustive({
      AcquireTaskClaim: (operation) => ({
        ...operation,
        acquisition: {
          ...operation.acquisition,
          operationId: renamed(operation.acquisition.operationId, maps.operationIds),
          token: renamed(operation.acquisition.token, maps.claimTokens)
        },
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }),
      ReleaseTaskClaim: (operation) => ({
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
      }),
      ReadCompletionTaskFacts: (operation) => ({
        ...operation,
        operationId: completionTaskFocusedReadOperationIdFor(
          renameCompletionRequest(operation.request),
          operation.purpose
        ),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps),
        request: renameCompletionRequest(operation.request)
      }),
      ReadTaskClaim: (operation) => ({
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }),
      ReadTaskWorkSpecification: (operation) => ({
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }),
      ReadTrackerGraph: (operation) => ({
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }),
      RecordTaskAttemptPlan: (operation) => ({
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        plannedAttempt: renamePlannedAttempt(operation.plannedAttempt, maps),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }),
      ReadTargetLineage: (operation) => ({
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        plannedAttempt: renamePlannedAttempt(operation.plannedAttempt, maps),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps),
        ...(operation.purpose === undefined
          ? {}
          : { purpose: renameActiveWorkAuthorityRefreshGitReadPurpose(operation.purpose, maps) })
      }),
      ReadTaskWorktree: (operation) => ({
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        plannedAttempt: renamePlannedAttempt(operation.plannedAttempt, maps),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps),
        ...(operation.purpose === undefined
          ? {}
          : { purpose: renameActiveWorkAuthorityRefreshGitReadPurpose(operation.purpose, maps) })
      }),
      ReconcileTaskWorktree: (operation) => ({
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        plannedAttempt: renamePlannedAttempt(operation.plannedAttempt, maps),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      })
    })
  )
