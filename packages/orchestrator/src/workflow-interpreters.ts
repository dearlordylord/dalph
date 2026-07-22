import { Effect, Layer } from "effect"
import {
  GitWorktree,
  gitWorktreeTestLayer,
  PlannedWorktreeAbsent,
  runGitWorktreeReconciliation
} from "./git-worktree.js"
import { TaskAttemptPlanRecordingSimulated } from "./task-attempt-plan-recording.js"
import { TaskRunner } from "./task-work-start.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { controlledTrackerMutationLayer, TrackerMutation } from "./tracker-mutation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
import {
  acquireTaskClaimThrough,
  AuthoritativeTaskWorktreeReady,
  emitTaskWorkSessionNonConvergence,
  runTaskWorkSessionEstablishmentProtocol,
  TaskClaimAcquisitionSimulated,
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

const taskRunnerInterpreterLayer = (
  operationPrefix: "TaskRunner" | "DeterministicTest",
  worktreeMode: "Authoritative" | "Simulated"
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const runner = yield* TaskRunner
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
        recordTaskAttemptPlan,
        reconcileTaskWorktree,
        readTrackerGraph,
        simulateTaskWorkSession
      })
    })
  )

export const deterministicTestWorkflowInterpreterLayer = taskRunnerInterpreterLayer(
  "DeterministicTest",
  "Simulated"
).pipe(
  Layer.provide(controlledTrackerMutationLayer),
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
        recordTaskAttemptPlan,
        reconcileTaskWorktree,
        readTrackerGraph,
        simulateTaskWorkSession
      })
    })
  )

export const dryRunWorkflowInterpreterLayer = makeDryRunWorkflowInterpreterLayer()
