import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  FixtureTarget,
  GitCommitSha,
  MatchingTaskWorkSessionReported,
  OperationId,
  OperationIdAllocator,
  PlannedTaskAttempt,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskLifecycle,
  TaskRunner,
  taskRunnerTestLayer,
  TaskWorkSessionId,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequest,
  TestTaskRunner,
  TestTrackerGraphReader,
  TrackerGraphReader,
  trackerGraphReaderTestLayer,
  WorkflowOperation,
  WorktreeLocator
} from "./index.js"
import { freshOperationIdAllocatorLayer } from "./task-work-planning.js"

const taskId = TaskId.make("test-layer-task")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("test-layer-attempt"),
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  branch: TaskBranchRef.make("refs/heads/test-layer-task"),
  runId: RunId.make("test-layer-run"),
  taskId,
  worktree: WorktreeLocator.make("/tmp/test-layer-task")
})
const request = TaskWorkStartRequest.make({
  operationId: OperationId.make("test-layer-operation"),
  plannedAttempt,
  task: {
    id: taskId,
    lifecycle: TaskLifecycle.cases.Open.make({}),
    parentTaskId: null,
    prerequisiteIds: []
  }
})
const lookup = { operationId: request.operationId, plannedAttempt }

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

it("rejects a start request whose planned attempt belongs to another task", () => {
  expect(() =>
    Schema.decodeUnknownSync(TaskWorkStartRequest)({
      ...request,
      plannedAttempt: {
        ...plannedAttempt,
        taskId: TaskId.make("another-task")
      }
    })
  ).toThrow("planned attempt task identity must match the requested task")
})
