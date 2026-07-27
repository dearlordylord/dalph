import { Effect } from "effect"
import {
  makeRecoveredSelectedExecutorStages,
  recoverSelectedExecutorInvocation,
  selectedExecutorProjectionFor,
  selectedExecutorReconstructionProtocol
} from "../../packages/orchestrator/src/selected-executor-protocol.js"
import type { ExecutorProtocol } from "./executor-protocol.js"

/** PROTOTYPE adapter around the executor implemented by issue #133. */
export const reviewCapableExecutor = {
  name: "review-capable",
  project: selectedExecutorProjectionFor,
  reconstruction: selectedExecutorReconstructionProtocol,
  recoverInvocation: recoverSelectedExecutorInvocation,
  recoveredStages: (runId) =>
    makeRecoveredSelectedExecutorStages(runId, false).pipe(
      Effect.map((stages) =>
        stages.map((stage) => ({
          run: (recordIntent) => stage.run(recordIntent).pipe(Effect.asVoid),
          transition: stage.transition
        }))
      )
    )
} satisfies ExecutorProtocol
