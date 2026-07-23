import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  FailedProcessExitCode,
  FailedTaskExecutionReported,
  FixtureTarget,
  GitCommitSha,
  MatchingTaskWorkSessionReported,
  OperationId,
  OperationIdAllocator,
  PlannedTaskAttempt,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskExecutionLookup,
  TaskExecutionObservationFailure,
  TaskExecutionRequest,
  TaskExecutionSessionBinding,
  TaskExecutor,
  TaskExecutorLocator,
  taskExecutorTestLayer,
  TaskId,
  TaskLifecycle,
  taskRevisionFor,
  TaskRunner,
  taskRunnerTestLayer,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest,
  TestTaskExecutor,
  TestTaskRunner,
  TestTrackerGraphReader,
  TrackerGraphReader,
  trackerGraphReaderTestLayer,
  WorkerProcessId,
  WorkflowOperation,
  workflowOperationId,
  WorktreeLocator
} from "./index.js"
import { freshOperationIdAllocatorLayer } from "./task-work-planning.js"

const taskId = TaskId.make("test-layer-task")
const task = {
  id: taskId,
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("test-layer-attempt"),
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  branch: TaskBranchRef.make("refs/heads/test-layer-task"),
  executor: TaskExecutorLocator.make("executor:test-layer"),
  runId: RunId.make("test-layer-run"),
  session: TaskWorkSessionLocator.make("session:test-layer"),
  taskId,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/test-layer-task")
})
const request = TaskWorkStartRequest.make({
  operationId: OperationId.make("test-layer-operation"),
  plannedAttempt,
  task
})
const lookup = { operationId: request.operationId, plannedAttempt }

const executionRequest = TaskExecutionRequest.make({
  operationId: OperationId.make("test-layer-execution-operation"),
  plannedAttempt,
  session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
    sessionId: TaskWorkSessionId.make("test-layer-execution-session")
  }),
  task
})
const executionLookup = TaskExecutionLookup.make({
  operationId: executionRequest.operationId,
  plannedAttempt,
  sessionId: TaskWorkSessionId.make("test-layer-execution-session")
})

it.effect("injects one controllable task runner through its production and test roles", () =>
  Effect.gen(function*() {
    const runner = yield* TaskRunner
    const control = yield* TestTaskRunner
    const matching = MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make("controlled-match"),
      sessionId: TaskWorkSessionId.make("controlled-session"),
      work: { _tag: "NoProviderWorkReported" }
    })
    const unreadable = new TaskWorkSessionLookupFailure({
      detail: "controlled unreadable registry",
      observationId: ProviderObservationId.make("controlled-unreadable")
    })
    yield* control.setLookupResults([matching, unreadable])

    expect(yield* runner.requestTaskWorkStart(request)).toMatchObject({
      providerRequestId: "test-request:test-layer-operation:1"
    })
    expect(yield* runner.lookupTaskWorkSession(lookup)).toEqual(matching)
    expect(yield* runner.lookupTaskWorkSession(lookup).pipe(Effect.flip)).toEqual(unreadable)
    expect(yield* runner.lookupTaskWorkSession(lookup).pipe(Effect.flip)).toBeInstanceOf(
      TaskWorkSessionLookupFailure
    )
    expect(yield* control.requests()).toEqual([request])
    expect(yield* control.lookups()).toEqual([lookup, lookup, lookup])
  }).pipe(Effect.provide(taskRunnerTestLayer)))

it.effect("injects one controllable task executor through its production and test roles", () =>
  Effect.gen(function*() {
    const executor = yield* TaskExecutor
    const control = yield* TestTaskExecutor
    const failed = FailedTaskExecutionReported.make({
      exitCode: FailedProcessExitCode.make(23),
      observationId: ProviderObservationId.make("controlled-execution-report"),
      operationId: executionRequest.operationId,
      partialOutput: "controlled partial output",
      processId: WorkerProcessId.make(401),
      sessionId: executionLookup.sessionId,
      wipPreserved: true
    })
    const unreadable = new TaskExecutionObservationFailure({
      detail: "controlled execution observation failure",
      observationId: ProviderObservationId.make("controlled-execution-unreadable"),
      operationId: executionRequest.operationId
    })
    yield* control.setObservations([failed, unreadable])

    expect(yield* executor.requestTaskExecution(executionRequest)).toMatchObject({
      providerRequestId: "test-execution-provider-request:test-layer-execution-operation"
    })
    expect(yield* executor.observeTaskExecution(executionLookup)).toEqual(failed)
    expect(yield* executor.observeTaskExecution(executionLookup).pipe(Effect.flip)).toEqual(unreadable)
    expect(yield* executor.observeTaskExecution(executionLookup).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionObservationFailure)
    expect(yield* control.requests()).toEqual([executionRequest])
    expect(yield* control.lookups()).toEqual([executionLookup, executionLookup, executionLookup])
  }).pipe(Effect.provide(taskExecutorTestLayer)))

it.effect("injects an independently controllable tracker graph reader", () => {
  const first = validSnapshot({ revision: "first", tasks: [] })
  const second = validSnapshot({ revision: "second", tasks: [] })
  const target = FixtureTarget.make("controlled-fixture")
  return Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const control = yield* TestTrackerGraphReader
    expect(yield* reader.read(target)).toEqual(first)
    yield* control.setSnapshot(second)
    expect(yield* reader.read(target)).toEqual(second)
    expect(yield* control.requestedTargets()).toEqual([target, target])
  }).pipe(Effect.provide(trackerGraphReaderTestLayer(first)))
})

it.effect("allocates a distinct fresh operation identity for each selection", () =>
  Effect.gen(function*() {
    const allocator = yield* OperationIdAllocator
    const first = yield* allocator.allocate()
    const second = yield* allocator.allocate()
    expect(first).not.toBe(second)
  }).pipe(
    Effect.provide(freshOperationIdAllocatorLayer),
    Effect.provide(NodeCrypto.layer)
  ))

it("rejects an establishment operation that causally precedes itself", () => {
  expect(() =>
    Schema.decodeUnknownSync(WorkflowOperation)({
      _tag: "EstablishTaskWorkSession",
      predecessorOperationIds: [request.operationId],
      request
    })
  ).toThrow("an operation cannot causally precede itself")
})

it("rejects self-causal execution and projects its operation identity", () => {
  expect(() =>
    Schema.decodeUnknownSync(WorkflowOperation)({
      _tag: "ExecuteTaskWork",
      predecessorOperationIds: [executionRequest.operationId],
      request: executionRequest
    })
  ).toThrow("an operation cannot causally precede itself")
  expect(workflowOperationId(WorkflowOperation.cases.ExecuteTaskWork.make({
    predecessorOperationIds: [],
    request: executionRequest
  }))).toBe(executionRequest.operationId)
})

it("rejects a start request whose planned task attempt belongs to another task", () => {
  expect(() =>
    Schema.decodeUnknownSync(TaskWorkStartRequest)({
      ...request,
      plannedAttempt: {
        ...plannedAttempt,
        taskId: TaskId.make("another-task")
      }
    })
  ).toThrow("planned task attempt task identity must match the requested task")
})

it("rejects a start request after the task lifecycle changes", () => {
  expect(() =>
    Schema.decodeUnknownSync(TaskWorkStartRequest)({
      ...request,
      task: { ...task, lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}) }
    })
  ).toThrow("planned task attempt task revision (fingerprint) must match the requested task")
})

it("rejects a start request after task dependencies change", () => {
  expect(() =>
    Schema.decodeUnknownSync(TaskWorkStartRequest)({
      ...request,
      task: { ...task, prerequisiteIds: [TaskId.make("new-prerequisite")] }
    })
  ).toThrow("planned task attempt task revision (fingerprint) must match the requested task")
})
