import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  controlledTrackerMutationLayer,
  deterministicTestWorkflowInterpreterLayer,
  FailedProcessExitCode,
  FailedTaskExecutionReported,
  GitCommitSha,
  makeTaskAttemptPlanOperation,
  makeTaskExecutionOperation,
  makeTaskWorktreeReconciliationOperation,
  MatchingTaskWorkSessionReported,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  TaskBranchRef,
  TaskExecutionModeContradiction,
  TaskExecutionRequest,
  TaskExecutionSessionBinding,
  TaskExecutor,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  taskRevisionFor,
  TaskRunner,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  trackerGraphReaderTestLayer,
  WorkerProcessId,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import { makeDryRunWorkflowInterpreterLayer, makeTaskRunnerWorkflowInterpreterLayer } from "./workflow-interpreters.js"

const runId = RunId.make("interpreter-coverage-run")
const sessionId = TaskWorkSessionId.make("interpreter-coverage-session")
const task = {
  id: TaskId.make("interpreter-coverage-task"),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("interpreter-coverage-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/interpreter-coverage"),
  executor: TaskExecutorLocator.make("executor:interpreter-coverage"),
  runId,
  session: TaskWorkSessionLocator.make("session:interpreter-coverage"),
  taskId: task.id,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/dalph-interpreter-coverage")
})
const establishedOperation = makeTaskExecutionOperation({
  predecessorOperationIds: [OperationId.make("interpreter-session-operation")],
  request: TaskExecutionRequest.make({
    operationId: OperationId.make("interpreter-execution-operation"),
    plannedAttempt,
    session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
    task
  })
})
const plannedOperation = makeTaskExecutionOperation({
  predecessorOperationIds: [],
  request: TaskExecutionRequest.make({
    ...establishedOperation.request,
    operationId: OperationId.make("interpreter-planned-operation"),
    session: TaskExecutionSessionBinding.cases.PlannedSession.make({
      session: plannedAttempt.session
    })
  })
})

const runner = TaskRunner.of({
  lookupTaskWorkSession: (lookup) =>
    Effect.succeed(MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make(`interpreter-lookup:${lookup.operationId}`),
      sessionId,
      work: { _tag: "NoProviderWorkReported" }
    })),
  requestTaskWorkStart: (request) =>
    Effect.succeed({
      observationId: ProviderObservationId.make(`interpreter-request:${request.operationId}`),
      providerRequestId: ProviderRequestId.make(`interpreter-provider-request:${request.operationId}`)
    })
})
const traceLayer = Layer.succeed(
  WorkflowTrace,
  WorkflowTrace.of({ emit: () => Effect.void })
)
const readerLayer = trackerGraphReaderTestLayer(validSnapshot({
  revision: "interpreter-coverage-revision",
  tasks: []
}))

it.effect("rejects provider execution in a simulated task-runner interpreter", () =>
  Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    expect(yield* interpreter.executeTaskWork(plannedOperation).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionModeContradiction)
    expect((yield* Effect.exit(interpreter.handBackReviewFindings(undefined as never)))._tag)
      .toBe("Failure")
  }).pipe(
    Effect.provide(deterministicTestWorkflowInterpreterLayer),
    Effect.provide(Layer.succeed(TaskRunner, runner)),
    Effect.provide(readerLayer),
    Effect.provide(traceLayer)
  ))

it.effect("independently controls simulated planning, Git, and executor boundaries", () =>
  Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    const recording = yield* interpreter.recordTaskAttemptPlan(
      makeTaskAttemptPlanOperation({
        operationId: OperationId.make("interpreter-plan-operation"),
        plannedAttempt,
        predecessorOperationIds: []
      })
    )
    const outcome = yield* interpreter.executeTaskWork(establishedOperation)
    expect(recording._tag).toBe("TaskAttemptPlanRecordingSimulated")
    expect(outcome.outcome).toMatchObject({ _tag: "Failed", exitCode: 31 })

    const reconciliation = yield* interpreter.reconcileTaskWorktree(
      makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("interpreter-worktree-operation"),
        plannedAttempt,
        predecessorOperationIds: []
      })
    )
    expect(reconciliation._tag).toBe("TaskWorktreeReconciliationSimulated")
  }).pipe(
    Effect.provide(makeTaskRunnerWorkflowInterpreterLayer("TaskRunner")),
    Effect.provide(controlledTrackerMutationLayer),
    Effect.provide(Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () =>
          Effect.succeed({
            observationId: ProviderObservationId.make("interpreter-execution-request"),
            providerRequestId: ProviderRequestId.make("interpreter-execution-provider-request")
          }),
        observeTaskExecution: (lookup) =>
          Effect.succeed(FailedTaskExecutionReported.make({
            exitCode: FailedProcessExitCode.make(31),
            observationId: ProviderObservationId.make("interpreter-execution-observation"),
            operationId: lookup.operationId,
            partialOutput: "interpreter partial output",
            processId: WorkerProcessId.make(501),
            sessionId: lookup.sessionId,
            wipPreserved: true
          }))
      })
    )),
    Effect.provide(Layer.succeed(TaskRunner, runner)),
    Effect.provide(readerLayer),
    Effect.provide(traceLayer)
  ))

it.effect("keeps dry-run simulation pure for both session binding variants", () =>
  Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    expect((yield* interpreter.simulateTaskExecution(establishedOperation)).session)
      .toBe(plannedAttempt.session)
    expect((yield* interpreter.simulateTaskExecution(plannedOperation)).session)
      .toBe(plannedAttempt.session)
    expect((yield* Effect.exit(interpreter.executeTaskWork(establishedOperation)))._tag)
      .toBe("Failure")
    expect((yield* Effect.exit(interpreter.handBackReviewFindings(undefined as never)))._tag)
      .toBe("Failure")
  }).pipe(
    Effect.provide(makeDryRunWorkflowInterpreterLayer()),
    Effect.provide(readerLayer)
  ))
