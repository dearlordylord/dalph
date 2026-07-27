import { Effect, Match } from "effect"
import type { OperationId, RunId } from "./domain.js"
import type { RunnableFrontierTransition } from "./runnable-frontier.js"
import {
  recoverTaskClaimAcquisitions,
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
)(function*<E, R>(
  runId: RunId,
  transition: RunnableFrontierTransition,
  recoverExecutorInvocation: (
    runId: RunId,
    invocationId: OperationId
  ) => Effect.Effect<void, E, R>
) {
  yield* Match.value(transition).pipe(
    Match.tagsExhaustive({
      CheckTaskClaim: ({ operationId }) => recoverTaskClaimAcquisitions(runId, operationId),
      CheckTaskWorkSession: ({ operationId }) => recoverTaskWorkSessionEstablishments(runId, operationId),
      CommitFreshTaskClaimIntent: () => Effect.void,
      ContinueFreshWorkflowOperation: () => Effect.void,
      StartExecutorInvocation: () => Effect.void,
      ContinueExecutorInvocation: ({ invocation }) =>
        recoverExecutorInvocation(
          runId,
          invocation.correlation.invocationId
        ),
      ReconcileTaskClaim: ({ operationId }) => recoverTaskClaimAcquisitions(runId, operationId),
      ReconcileTaskWorktree: ({ operationId }) => recoverTaskWorktreeReconciliations(runId, operationId)
    })
  )
})
