import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { OperationId, RunId, TaskId, TaskRevision } from "./domain.js"
import { makeExecutorOuterInvocation, oneTaskWorkCapacityPosition } from "./executor-boundary.js"
import { memoryJournalStoreLayer } from "./journal-store.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { recoverRunnableTransition } from "./runnable-transition-recovery.js"
import { recoverSelectedExecutorInvocation } from "./selected-executor-protocol.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const unused = () => Effect.die("empty history must not invoke an interpreter")

it.effect("routes every recovered transition variant through its exact empty-history handler", () => {
  const runId = RunId.make("runnable-transition-routing")
  const taskId = TaskId.make("runnable-transition-task")
  const operationId = OperationId.make("runnable-transition-operation")
  const transitions = [
    RunnableFrontierTransition.CheckTaskClaim({ operationId, taskId }),
    RunnableFrontierTransition.CheckTaskWorkSession({ operationId, taskId }),
    RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId,
      taskRevision: TaskRevision.make("runnable-transition-revision")
    }),
    RunnableFrontierTransition.ContinueFreshWorkflowOperation({
      operationId,
      taskId
    }),
    RunnableFrontierTransition.StartExecutorInvocation({
      invocation: makeExecutorOuterInvocation(
        operationId,
        taskId,
        oneTaskWorkCapacityPosition
      )
    }),
    RunnableFrontierTransition.ContinueExecutorInvocation({
      invocation: makeExecutorOuterInvocation(
        operationId,
        taskId,
        oneTaskWorkCapacityPosition
      )
    }),
    RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId }),
    RunnableFrontierTransition.ReconcileTaskWorktree({ operationId, taskId })
  ]

  return Effect.gen(function*() {
    const results = yield* Effect.forEach(
      transitions,
      (transition) =>
        recoverRunnableTransition(
          runId,
          transition,
          recoverSelectedExecutorInvocation
        )
    )
    expect(results).toEqual(Array.from({ length: transitions.length }))
  }).pipe(
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        establishTaskWorkSession: unused,
        executeTaskWork: unused,
        handBackReviewFindings: unused,
        readTrackerGraph: unused,
        reconcileTaskWorktree: unused,
        recordImplementationDisposition: unused,
        recordTaskAttemptPlan: unused,
        reviewImplementation: unused,
        sealImplementationEvidence: unused,
        simulateTaskExecution: unused,
        simulateTaskWorkSession: unused
      })
    ),
    Effect.provideService(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
})
