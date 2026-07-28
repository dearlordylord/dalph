import {
  Effect,
  Layer
} from "../../../node_modules/effect/dist/index.js"
import {
  ClaimOwner,
  ClaimToken,
  GitCommitSha,
  OperationId,
  RunId,
  TaskExecutorLocator,
  TaskWorkSessionLocator,
  WorktreeLocator,
  type Task
} from "../../../packages/orchestrator/src/domain.ts"
import { makeFreshTaskAttemptStage } from "../../../packages/orchestrator/src/fresh-task-attempt-stages.ts"
import type { FreshWorkflowStage } from "../../../packages/orchestrator/src/fresh-workflow-stage.ts"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  OperationIdAllocator,
  PlannedTaskAttemptPlanner
} from "../../../packages/orchestrator/src/task-work-planning.ts"
import { TaskClaimAcquisition } from "../../../packages/orchestrator/src/tracker-mutation.ts"
import {
  makeTaskClaimAcquisitionOperation,
  type TraceItem,
  WorkflowInterpreter
} from "../../../packages/orchestrator/src/workflow.ts"
import { makeDryRunWorkflowInterpreterLayer } from "../../../packages/orchestrator/src/workflow-interpreters.ts"
import { TrackerGraphReader } from "../../../packages/orchestrator/src/tracker-graph-reader.ts"

const selectedExecutorInternalOperationOrder = [
  "AcquireTaskClaim",
  "RecordTaskAttemptPlan",
  "ReconcileTaskWorktree",
  "EstablishTaskWorkSession",
  "ExecuteTaskWork",
  "SealImplementationEvidence",
  "ReviewImplementation",
  "RecordImplementationDisposition"
] as const

const outerMoveAt = (index: number): string | null =>
  index < 4
    ? selectedExecutorInternalOperationOrder[index] ?? null
    : index < selectedExecutorInternalOperationOrder.length
    ? "StartExecutorInvocation"
    : null

export interface ProductionWorkflowProgress {
  readonly completedOperations: ReadonlyArray<string>
  readonly nextOperation: string | null
  readonly taskId: string
  readonly trace: ReadonlyArray<string>
}

const runId = RunId.make("reducer-lab-run")

const environment = Layer.mergeAll(
  deterministicOperationIdAllocatorLayer("reducer-lab-workflow"),
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    executor: TaskExecutorLocator.make("executor:reducer-lab"),
    runId,
    sessionRoot: TaskWorkSessionLocator.make("session:reducer-lab"),
    worktreeRoot: WorktreeLocator.make("/reducer-lab")
  }),
  makeDryRunWorkflowInterpreterLayer().pipe(
    Layer.provide(Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({ read: () => Effect.die("workflow-stage replay does not read the tracker") })
    ))
  )
)

/**
 * Replays the real production stage builders through the production dry-run
 * interpreter. Each requested step crosses exactly one WorkflowInterpreter
 * boundary; no Lab-only workflow state machine chooses the next operation.
 */
export const replayProductionWorkflow = (
  task: Task,
  requestedSteps: number,
  predecessorOperationId: OperationId
): Effect.Effect<ProductionWorkflowProgress, unknown> =>
  Effect.gen(function*() {
    const allocator = yield* OperationIdAllocator
    const planner = yield* PlannedTaskAttemptPlanner
    const interpreter = yield* WorkflowInterpreter
    const trace = new Array<string>()
    let currentOuterMove = "AcquireTaskClaim"
    const emit = (item: TraceItem) => {
      trace.push(
        item._tag === "OperationSelected"
          ? `selected · ${currentOuterMove}`
          : `observed · ${currentOuterMove} outcome`
      )
      return Effect.void
    }
    const completedOperations = new Array<string>()
    if (requestedSteps <= 0) {
      return {
        completedOperations,
        nextOperation: outerMoveAt(0),
        taskId: task.id,
        trace
      }
    }

    const claimOperationId = yield* allocator.allocate()
    const claimOperation = makeTaskClaimAcquisitionOperation({
      acquisition: TaskClaimAcquisition.make({
        operationId: claimOperationId,
        owner: ClaimOwner.make("reducer-lab-owner"),
        taskId: task.id,
        token: ClaimToken.make(`reducer-lab-token:${task.id}`)
      }),
      predecessorOperationIds: [predecessorOperationId]
    })
    yield* interpreter.acquireTaskClaim(claimOperation)
    completedOperations.push("AcquireTaskClaim")
    trace.push("selected · AcquireTaskClaim", "observed · TaskClaimAcquisitionSimulated")

    let stage: FreshWorkflowStage | undefined = yield* makeFreshTaskAttemptStage(
      { allocator, emit, interpreter, planner },
      task,
      undefined,
      claimOperationId
    )
    for (
      let completedStages = 1;
      completedStages < requestedSteps && stage !== undefined;
      completedStages += 1
    ) {
      currentOuterMove = outerMoveAt(completedStages) ?? "ExecutorInvocationCompleted"
      completedOperations.push(currentOuterMove)
      stage = yield* stage.run(() => Effect.void)
    }

    return {
      completedOperations,
      nextOperation: outerMoveAt(completedOperations.length),
      taskId: task.id,
      trace
    }
  }).pipe(
    Effect.provide(environment)
  )
