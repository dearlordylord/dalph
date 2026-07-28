import { Effect } from "effect"
import type { OperationId } from "./domain.js"
import type {
  FreshImplementationConvergenceOptions,
  FreshImplementationConvergenceStage
} from "./implementation-convergence-stage.js"
import { freshImplementationTransition } from "./implementation-convergence-stage.js"
import { ImplementationConvergenceDispositionRecordedTrace } from "./implementation-convergence-trace.js"
import type { ImplementationConvergenceDisposition } from "./implementation-convergence.js"
import { TaskWorktreeExecutionModeContradiction } from "./task-worktree-reconciliation.js"
import { OperationSelected } from "./tracker-workflow-trace.js"
import { makeImplementationDispositionOperation } from "./workflow-operation.js"

/** Selects one exact durable terminal-disposition operation. */
export const makeImplementationDispositionStage = Effect.fn(
  "Workflow.makeImplementationDispositionStage"
)(function*(
  options: FreshImplementationConvergenceOptions,
  disposition: ImplementationConvergenceDisposition,
  predecessorOperationId: OperationId
): Effect.fn.Return<FreshImplementationConvergenceStage> {
  const operation = makeImplementationDispositionOperation(
    {
      _tag: "AuthorizedImplementationConvergenceDisposition",
      disposition,
      operationId: yield* options.allocator.allocate()
    },
    predecessorOperationId
  )
  return {
    transition: freshImplementationTransition(
      operation.request.operationId,
      options.task,
      "ImplementationDisposition"
    ),
    run: () =>
      Effect.gen(function*() {
        yield* options.emit(OperationSelected.make({ operation }))
        const result = yield* options.interpreter.recordImplementationDisposition(
          operation
        )
        if (
          result._tag !== "AuthoritativeImplementationConvergenceDisposition"
        ) {
          return yield* new TaskWorktreeExecutionModeContradiction({
            operationId: operation.request.operationId
          })
        }
        yield* options.emit(
          ImplementationConvergenceDispositionRecordedTrace.make({
            operation,
            result
          })
        )
        if (options.onCompleted !== undefined) {
          yield* options.onCompleted(result)
        }
      })
  }
})
