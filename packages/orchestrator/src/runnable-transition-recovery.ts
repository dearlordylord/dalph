import { Effect, Match } from "effect"
import type { RunId } from "./domain.js"
import type { RunnableFrontierTransition } from "./runnable-frontier.js"
import {
  recoverImplementationEvidenceSealings,
  recoverImplementationReviews,
  recoverReviewFindingsHandbacks,
  recoverTaskClaimAcquisitions,
  recoverTaskExecutions,
  recoverTaskWorkSessionEstablishments,
  recoverTaskWorktreeReconciliations
} from "./workflow-operation-recovery.js"

/**
 * Executes the one already-intended workflow operation named by a recovered
 * frontier transition. Each recovery helper is filtered by exact OperationId,
 * so an owner cannot consume an independent responsibility.
 */
export const recoverRunnableTransition = Effect.fn(
  "WorkflowRecovery.recoverRunnableTransition"
)(function*(runId: RunId, transition: RunnableFrontierTransition) {
  yield* Match.value(transition).pipe(
    Match.tagsExhaustive({
      CheckTaskClaim: ({ operationId }) => recoverTaskClaimAcquisitions(runId, operationId),
      CheckTaskWorkSession: ({ operationId }) => recoverTaskWorkSessionEstablishments(runId, operationId),
      CommitFreshTaskClaimIntent: () => Effect.void,
      ContinueFreshWorkflowOperation: () => Effect.void,
      ContinueImplementationEvidenceSealing: ({ operationId }) =>
        recoverImplementationEvidenceSealings(runId, operationId),
      ContinueImplementationReview: ({ operationId }) => recoverImplementationReviews(runId, operationId),
      ContinueReviewFindingsHandback: ({ operationId }) => recoverReviewFindingsHandbacks(runId, operationId),
      ContinueTaskExecution: ({ operationId }) => recoverTaskExecutions(runId, operationId),
      ReconcileTaskClaim: ({ operationId }) => recoverTaskClaimAcquisitions(runId, operationId),
      ReconcileTaskWorktree: ({ operationId }) => recoverTaskWorktreeReconciliations(runId, operationId)
    })
  )
})
