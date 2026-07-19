import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Queue, Ref } from "effect"
import { expect } from "vitest"
import type { TaskId, TraceItem } from "./index.js"
import {
  capabilityAuditLayer,
  FixtureTarget,
  runWorkflow,
  TaskExecution,
  TaskExecutionCapacity,
  trackerGraphReaderFileLayer,
  trackerWorkflowInterpreterLayer,
  WorkflowTrace
} from "./index.js"

const fixture = (name: "diamond" | "wayfinder-105"): FixtureTarget =>
  FixtureTarget.make(new URL(`../fixtures/${name}.json`, import.meta.url).pathname)

const controlledExecutor = Effect.gen(function*() {
  const started = yield* Queue.unbounded<TaskId>()
  const releases = yield* Queue.unbounded<void>()
  const active = yield* Ref.make(0)
  const maximumActive = yield* Ref.make(0)
  const traces = yield* Ref.make<ReadonlyArray<TraceItem>>([])
  const selectionPrecededExecution = yield* Ref.make(true)
  const service = TaskExecution.of({
    execute: Effect.fn("TaskExecution.Test.execute")(function*(taskId) {
      const items = yield* Ref.get(traces)
      yield* Ref.update(
        selectionPrecededExecution,
        (valid) =>
          valid
          && items.some(
            (item) =>
              item._tag === "OperationSelected"
              && item.operation._tag === "ExecuteTask"
              && item.operation.taskId === taskId
          )
      )
      yield* Ref.update(active, (count) => count + 1)
      const currentActive = yield* Ref.get(active)
      yield* Ref.update(maximumActive, (maximum) => Math.max(maximum, currentActive))
      yield* Queue.offer(started, taskId)
      yield* Queue.take(releases).pipe(
        Effect.ensuring(Ref.update(active, (count) => count - 1))
      )
    })
  })
  const trace = WorkflowTrace.of({
    emit: Effect.fn("WorkflowTrace.Test.emit")(function*(item) {
      yield* Ref.update(traces, (items) => [...items, item])
    })
  })

  return {
    active,
    maximumActive,
    releases,
    selectionPrecededExecution,
    service,
    started,
    trace,
    traces
  } as const
})

it.effect("capacity 2 admits both controlled tasks before either gate releases", () =>
  Effect.gen(function*() {
    const controlled = yield* controlledExecutor
    const run = yield* runWorkflow(
      fixture("diamond"),
      TaskExecutionCapacity.make(2)
    ).pipe(
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(capabilityAuditLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskExecution, controlled.service)),
      Effect.provide(Layer.succeed(WorkflowTrace, controlled.trace)),
      Effect.forkScoped
    )

    expect(yield* Queue.take(controlled.started)).toBe("group")
    expect(yield* Queue.take(controlled.started)).toBe("root")
    expect(yield* Ref.get(controlled.active)).toBe(2)
    expect(yield* Ref.get(controlled.maximumActive)).toBe(2)
    expect(yield* Ref.get(controlled.selectionPrecededExecution)).toBe(true)

    yield* Queue.offerAll(controlled.releases, [undefined, undefined])
    yield* Fiber.join(run)
  }))

it.effect("capacity 1 never holds two task permits", () =>
  Effect.gen(function*() {
    const controlled = yield* controlledExecutor
    const run = yield* runWorkflow(
      fixture("diamond"),
      TaskExecutionCapacity.make(1)
    ).pipe(
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(capabilityAuditLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskExecution, controlled.service)),
      Effect.provide(Layer.succeed(WorkflowTrace, controlled.trace)),
      Effect.forkScoped
    )

    expect(yield* Queue.take(controlled.started)).toBe("group")
    expect(yield* Queue.size(controlled.started)).toBe(0)
    expect(yield* Ref.get(controlled.active)).toBe(1)
    yield* Queue.offer(controlled.releases, undefined)
    expect(yield* Queue.take(controlled.started)).toBe("root")
    expect(yield* Ref.get(controlled.maximumActive)).toBe(1)
    yield* Queue.offer(controlled.releases, undefined)
    yield* Fiber.join(run)
  }))

it.effect("bounds and deterministically orders the wide retained frontier", () =>
  Effect.gen(function*() {
    const controlled = yield* controlledExecutor
    const run = yield* runWorkflow(
      fixture("wayfinder-105"),
      TaskExecutionCapacity.make(2)
    ).pipe(
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(capabilityAuditLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskExecution, controlled.service)),
      Effect.provide(Layer.succeed(WorkflowTrace, controlled.trace)),
      Effect.forkScoped
    )
    const admitted: Array<TaskId> = []

    admitted.push(yield* Queue.take(controlled.started))
    admitted.push(yield* Queue.take(controlled.started))
    expect(yield* Queue.size(controlled.started)).toBe(0)
    expect(yield* Ref.get(controlled.active)).toBe(2)

    while (admitted.length < 35) {
      yield* Queue.offer(controlled.releases, undefined)
      admitted.push(yield* Queue.take(controlled.started))
    }
    yield* Queue.offerAll(controlled.releases, [undefined, undefined])
    yield* Fiber.join(run)
    const traces = yield* Ref.get(controlled.traces)

    expect(admitted).toEqual([...admitted].sort())
    expect(new Set(admitted)).toHaveLength(35)
    expect(yield* Ref.get(controlled.maximumActive)).toBe(2)
    expect(traces.at(-1)?._tag).toBe("RunCompleted")
  }))

it.effect("keeps semantic trace order stable when tasks complete in reverse", () =>
  Effect.gen(function*() {
    const firstGate = yield* Deferred.make<void>()
    const secondGate = yield* Deferred.make<void>()
    const started = yield* Queue.unbounded<TaskId>()
    const traces = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const service = TaskExecution.of({
      execute: Effect.fn("TaskExecution.Test.reverseCompletion")(function*(taskId) {
        yield* Queue.offer(started, taskId)
        yield* Deferred.await(taskId === "group" ? firstGate : secondGate)
      })
    })
    const trace = WorkflowTrace.of({
      emit: Effect.fn("WorkflowTrace.Test.reverseCompletion")(function*(item) {
        yield* Ref.update(traces, (items) => [...items, item])
      })
    })
    const run = yield* runWorkflow(
      fixture("diamond"),
      TaskExecutionCapacity.make(2)
    ).pipe(
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(capabilityAuditLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskExecution, service)),
      Effect.provide(Layer.succeed(WorkflowTrace, trace)),
      Effect.forkScoped
    )

    yield* Queue.take(started)
    yield* Queue.take(started)
    yield* Deferred.succeed(secondGate, undefined)
    yield* Deferred.succeed(firstGate, undefined)
    yield* Fiber.join(run)
    const items = yield* Ref.get(traces)
    const selected = items.flatMap((item) =>
      item._tag === "OperationSelected" && item.operation._tag === "ExecuteTask"
        ? [item.operation.taskId]
        : []
    )
    const observed = items.flatMap((item) =>
      item._tag === "TaskExecutionOutcomeObserved"
        ? [item.operation.taskId]
        : []
    )
    const lastSelectionIndex = items.findLastIndex(
      (item) => item._tag === "OperationSelected"
    )
    const firstTaskObservationIndex = items.findIndex(
      (item) => item._tag === "TaskExecutionOutcomeObserved"
    )

    expect(selected).toEqual(["group", "root"])
    expect(observed).toEqual(["group", "root"])
    expect(firstTaskObservationIndex).toBeGreaterThan(lastSelectionIndex)
  }))
