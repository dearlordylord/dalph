import { Effect, Layer } from "effect"
import {
  GitWorktree,
  gitWorktreeTestLayer,
  PlannedWorktreeAbsent,
  runGitWorktreeReconciliation
} from "./git-worktree.js"
import { TaskAttemptPlanRecordingSimulated } from "./task-attempt-plan-recording.js"
import { TaskExecutionModeContradiction, TaskExecutor, taskExecutorTestLayer } from "./task-execution.js"
import { TaskRunner } from "./task-work-start.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { controlledTrackerMutationLayer, TrackerMutation } from "./tracker-mutation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
import {
  acquireTaskClaimThrough,
  AuthoritativeTaskWorktreeReady,
  emitTaskWorkSessionNonConvergence,
  runTaskExecutionProtocol,
  runTaskWorkSessionEstablishmentProtocol,
  TaskClaimAcquisitionSimulated,
  taskExecutionTraceObserver,
  taskWorkSessionTraceObserver,
  TaskWorktreeReconciliationSimulated,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

const simulateTaskWorkSession = Effect.fn(
  "WorkflowInterpreter.simulateTaskWorkSession"
)(function*(operation) {
  return WorkflowOutcome.cases.TaskWorkSessionEstablishmentSimulated.make({
    operationId: operation.request.operationId,
    session: operation.request.plannedAttempt.session
  })
})

const simulateTaskExecution = Effect.fn("WorkflowInterpreter.simulateTaskExecution")(
  function*(operation) {
    return WorkflowOutcome.cases.TaskExecutionSimulated.make({
      operationId: operation.request.operationId,
      session: operation.request.session._tag === "PlannedSession"
        ? operation.request.session.session
        : operation.request.plannedAttempt.session
    })
  }
)

const taskRunnerInterpreterLayer = (
  operationPrefix: "TaskRunner" | "DeterministicTest",
  worktreeMode: "Authoritative" | "Simulated"
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const runner = yield* TaskRunner
      const executor = yield* TaskExecutor
      const gitWorktree = yield* GitWorktree
      const tracker = yield* TrackerMutation
      const trace = yield* WorkflowTrace
      const readTrackerGraph = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.readTrackerGraph`
      )(function*(operation) {
        return yield* reader.read(operation.target)
      })
      const acquireTaskClaim = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.acquireTaskClaim`
      )(function*(operation) {
        return yield* acquireTaskClaimThrough(tracker, operation)
      })
      const establishTaskWorkSession = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.establishTaskWorkSession`
      )(function*(operation) {
        return yield* runTaskWorkSessionEstablishmentProtocol(
          runner,
          operation,
          true,
          taskWorkSessionTraceObserver(operation, trace)
        ).pipe(
          Effect.tapError((failure) => emitTaskWorkSessionNonConvergence(failure, operation, trace))
        )
      })
      const executeTaskWork = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.executeTaskWork`
      )(function*(operation) {
        if (operation.request.session._tag !== "EstablishedSession") {
          return yield* new TaskExecutionModeContradiction({
            operationId: operation.request.operationId
          })
        }
        const outcome = yield* runTaskExecutionProtocol(
          executor,
          operation,
          true,
          taskExecutionTraceObserver(operation, trace)
        )
        return WorkflowOutcome.cases.TaskExecutionObserved.make({ outcome })
      })
      const recordTaskAttemptPlan = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.recordTaskAttemptPlan`
      )(function*(operation) {
        return TaskAttemptPlanRecordingSimulated.make({ operation })
      })
      const reconcileTaskWorktree = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.reconcileTaskWorktree`
      )(function*(operation) {
        if (worktreeMode === "Simulated") {
          return TaskWorktreeReconciliationSimulated.make({ operation })
        }
        const proof = yield* runGitWorktreeReconciliation(
          gitWorktree,
          operation.plannedAttempt
        )
        return AuthoritativeTaskWorktreeReady.make({ proof })
      })
      return WorkflowInterpreter.of({
        acquireTaskClaim,
        establishTaskWorkSession,
        executeTaskWork,
        recordTaskAttemptPlan,
        reconcileTaskWorktree,
        readTrackerGraph,
        simulateTaskExecution,
        simulateTaskWorkSession
      })
    })
  )

export const deterministicTestWorkflowInterpreterLayer = taskRunnerInterpreterLayer(
  "DeterministicTest",
  "Simulated"
).pipe(
  Layer.provide(controlledTrackerMutationLayer),
  Layer.provide(taskExecutorTestLayer),
  Layer.provide(gitWorktreeTestLayer(PlannedWorktreeAbsent.make({})))
)
export const trackerMutationWorkflowInterpreterLayer = taskRunnerInterpreterLayer(
  "TaskRunner",
  "Authoritative"
)
export const taskRunnerWorkflowInterpreterLayer = taskRunnerInterpreterLayer(
  "TaskRunner",
  "Simulated"
).pipe(
  Layer.provide(controlledTrackerMutationLayer),
  Layer.provide(taskExecutorTestLayer),
  Layer.provide(gitWorktreeTestLayer(PlannedWorktreeAbsent.make({})))
)
export const liveFakeWorkflowInterpreterLayer = taskRunnerWorkflowInterpreterLayer

export const makeDryRunWorkflowInterpreterLayer = (): Layer.Layer<
  WorkflowInterpreter,
  never,
  TrackerGraphReader
> =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const readTrackerGraph = Effect.fn(
        "WorkflowInterpreter.DryRun.readTrackerGraph"
      )(function*(operation) {
        return yield* reader.read(operation.target)
      })
      const acquireTaskClaim = Effect.fn(
        "WorkflowInterpreter.DryRun.acquireTaskClaim"
      )(function*(operation) {
        return TaskClaimAcquisitionSimulated.make({ operation })
      })
      const recordTaskAttemptPlan = Effect.fn(
        "WorkflowInterpreter.DryRun.recordTaskAttemptPlan"
      )(function*(operation) {
        return TaskAttemptPlanRecordingSimulated.make({ operation })
      })
      const reconcileTaskWorktree = Effect.fn(
        "WorkflowInterpreter.DryRun.reconcileTaskWorktree"
      )(function*(operation) {
        return TaskWorktreeReconciliationSimulated.make({ operation })
      })
      return WorkflowInterpreter.of({
        acquireTaskClaim,
        establishTaskWorkSession: () => Effect.die("dry-run cannot establish a provider task-work session"),
        executeTaskWork: () => Effect.die("dry-run cannot execute provider task work"),
        recordTaskAttemptPlan,
        reconcileTaskWorktree,
        readTrackerGraph,
        simulateTaskExecution,
        simulateTaskWorkSession
      })
    })
  )

export const dryRunWorkflowInterpreterLayer = makeDryRunWorkflowInterpreterLayer()
