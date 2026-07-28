import {
  Effect,
  Layer
} from "../../../node_modules/effect/dist/index.js"
import {
  GitCommitSha,
  OperationId,
  RunId,
  TaskExecutorLocator,
  type TaskRevision,
  TaskWorkSessionLocator,
  WorktreeLocator,
  type Task
} from "../../../packages/orchestrator/src/domain.ts"
import { makeFreshTaskAttemptStage } from "../../../packages/orchestrator/src/fresh-task-attempt-stages.ts"
import type { FreshWorkflowStage } from "../../../packages/orchestrator/src/fresh-workflow-stage.ts"
import { taskRevisionFor } from "../../../packages/orchestrator/src/task-dag.ts"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  OperationIdAllocator,
  PlannedTaskAttemptPlanner
} from "../../../packages/orchestrator/src/task-work-planning.ts"
import type { ActiveTaskClaim } from "../../../packages/orchestrator/src/tracker-mutation.ts"
import {
  type TraceItem,
  WorkflowInterpreter
} from "../../../packages/orchestrator/src/workflow.ts"
import { makeDryRunWorkflowInterpreterLayer } from "../../../packages/orchestrator/src/workflow-interpreters.ts"
import { TrackerGraphReader } from "../../../packages/orchestrator/src/tracker-graph-reader.ts"

const productionWorkflowOperationOrder = [
  "AcquireTaskClaim",
  "ObserveClaimedTaskEligibility",
  "RecordTaskAttemptPlan",
  "ReconcileTaskWorktree",
  "EstablishTaskWorkSession",
  "ExecuteTaskWork",
  "SealImplementationEvidence",
  "ReviewImplementation",
  "RecordImplementationDisposition"
] as const

export const firstExecutorWorkflowStep = 5
export const completedExecutorWorkflowStep = productionWorkflowOperationOrder.length
export const executorInvocationCount =
  completedExecutorWorkflowStep - firstExecutorWorkflowStep

export type ClaimedTaskEligibility =
  | "Pending"
  | "Eligible"
  | "NotEligible"
  | "Unreadable"
  | "ClaimUnavailable"
export type ProductionWorkflowStatus =
  | "InProgress"
  | "ClaimedTaskNotEligible"
  | "TrackerReadFailed"
  | "ClaimAuthorityChanged"
  | "ExecutorCompleted"
  | "TaskSelectionUnavailable"

const outerMoveAt = (
  index: number,
  eligibility: ClaimedTaskEligibility
): string | null =>
  index < 2
    ? productionWorkflowOperationOrder[index] ?? null
    : eligibility !== "Eligible"
      ? null
      : index < firstExecutorWorkflowStep
        ? productionWorkflowOperationOrder[index] ?? null
        : index < productionWorkflowOperationOrder.length
    ? "StartExecutorInvocation"
    : null

export interface ProductionWorkflowProgress {
  readonly completedOperations: ReadonlyArray<string>
  readonly completedExecutorInvocations: number
  readonly executorInvocationCount: number
  readonly nextOperation: string | null
  readonly status: ProductionWorkflowStatus
  readonly taskId: string
  readonly taskRevision: TaskRevision | null
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
 * Replays the real production stage builders after the Lab driver's journaled
 * exact-claim and controlled tracker boundaries. Individual step controls cross
 * one downstream dry-run interpreter boundary; the coordinator control
 * deliberately repeats those selected stages until the outer outcome.
 */
export const replayProductionWorkflow = (
  task: Task,
  requestedSteps: number,
  eligibility: ClaimedTaskEligibility,
  activeClaim: ActiveTaskClaim | undefined,
  attemptPredecessorOperationId: OperationId
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
        completedExecutorInvocations: 0,
        executorInvocationCount,
        nextOperation: outerMoveAt(0, eligibility),
        status: "InProgress" as const,
        taskId: task.id,
        taskRevision: taskRevisionFor(task),
        trace
      }
    }

    if (activeClaim === undefined) {
      return {
        completedOperations,
        completedExecutorInvocations: 0,
        executorInvocationCount,
        nextOperation: null,
        status: "ClaimAuthorityChanged" as const,
        taskId: task.id,
        taskRevision: taskRevisionFor(task),
        trace: ["selected · AcquireTaskClaim", "failed · exact claim unavailable"]
      }
    }
    completedOperations.push("AcquireTaskClaim")
    trace.push(
      "selected · AcquireTaskClaim",
      `observed · AuthoritativeTaskClaimAcquired · ${activeClaim.operationId}`
    )

    if (requestedSteps < 2 || eligibility === "Pending") {
      return {
        completedOperations,
        completedExecutorInvocations: 0,
        executorInvocationCount,
        nextOperation: outerMoveAt(1, eligibility),
        status: "InProgress" as const,
        taskId: task.id,
        taskRevision: taskRevisionFor(task),
        trace
      }
    }

    trace.push("selected · ObserveClaimedTaskEligibility")
    if (eligibility === "Unreadable" || eligibility === "ClaimUnavailable") {
      const status: ProductionWorkflowStatus = eligibility === "ClaimUnavailable"
        ? "ClaimAuthorityChanged"
        : "TrackerReadFailed"
      return {
        completedOperations,
        completedExecutorInvocations: 0,
        executorInvocationCount,
        nextOperation: null,
        status,
        taskId: task.id,
        taskRevision: taskRevisionFor(task),
        trace
      }
    }
    completedOperations.push("ObserveClaimedTaskEligibility")
    trace.push(`observed · ${eligibility}`)
    if (eligibility === "NotEligible") {
      return {
        completedOperations,
        completedExecutorInvocations: 0,
        executorInvocationCount,
        nextOperation: null,
        status: "ClaimedTaskNotEligible" as const,
        taskId: task.id,
        taskRevision: taskRevisionFor(task),
        trace
      }
    }

    let stage: FreshWorkflowStage | undefined = yield* makeFreshTaskAttemptStage(
      { allocator, emit, interpreter, planner },
      task,
      activeClaim,
      attemptPredecessorOperationId
    )
    for (
      let completedStages = 2;
      completedStages < requestedSteps && stage !== undefined;
      completedStages += 1
    ) {
      currentOuterMove = outerMoveAt(completedStages, eligibility)
        ?? "ExecutorInvocationCompleted"
      completedOperations.push(currentOuterMove)
      stage = yield* stage.run(() => Effect.void)
    }

    const completedExecutorInvocations = completedOperations.filter(
      (operation) => operation === "StartExecutorInvocation"
    ).length
    const nextOperation = outerMoveAt(completedOperations.length, eligibility)
    const status: ProductionWorkflowStatus = nextOperation === null
      ? "ExecutorCompleted"
      : "InProgress"
    return {
      completedOperations,
      completedExecutorInvocations,
      executorInvocationCount,
      nextOperation,
      status,
      taskId: task.id,
      taskRevision: taskRevisionFor(task),
      trace
    }
  }).pipe(
    Effect.provide(environment)
  )
