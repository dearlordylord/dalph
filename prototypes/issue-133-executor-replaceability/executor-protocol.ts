import type { Effect } from "effect"
import type { OperationId, RunId, TechnicalRetryNotBefore } from "../../packages/orchestrator/src/domain.js"
import type {
  ExecutorOuterInvocation,
  ExecutorOuterInvocationProjection
} from "../../packages/orchestrator/src/executor-boundary.js"
import type { JournalRecord } from "../../packages/orchestrator/src/journal-store.js"
import type { ExecutorReconstructionProtocol } from "../../packages/orchestrator/src/reconstructed-managed-run.js"
import type { RunnableFrontierTransition } from "../../packages/orchestrator/src/runnable-frontier.js"

/** PROTOTYPE: executor-owned runtime behavior consumed by generic activation. */
export interface ExecutorProtocol {
  readonly name: string
  readonly reconstruction: ExecutorReconstructionProtocol
  readonly project: (
    records: ReadonlyArray<JournalRecord>,
    invocation: ExecutorOuterInvocation,
    now: TechnicalRetryNotBefore
  ) => ExecutorOuterInvocationProjection
  readonly recoverInvocation: (
    runId: RunId,
    invocationId: OperationId
  ) => Effect.Effect<void, unknown, unknown>
  readonly recoveredStages: (
    runId: RunId
  ) => Effect.Effect<
    ReadonlyArray<{
      readonly transition: RunnableFrontierTransition
      readonly run: (
        recordIntent: (operationId: OperationId) => Effect.Effect<void>
      ) => Effect.Effect<void, unknown, unknown>
    }>,
    unknown,
    unknown
  >
}

/**
 * PROTOTYPE: the generic composition selects a supplied protocol. It does not
 * import the review-capable adapter or know any executor-internal stage.
 */
export const makeExecutorActivationKernel = (protocol: ExecutorProtocol) => ({
  project: protocol.project,
  protocolName: protocol.name,
  reconstruction: protocol.reconstruction,
  recoverInvocation: protocol.recoverInvocation,
  recoveredStages: protocol.recoveredStages
})
