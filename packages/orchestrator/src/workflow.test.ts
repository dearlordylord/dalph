import { it } from "@effect/vitest"
import { Clock, Deferred, Duration, Effect, Fiber, Layer, Queue, Random, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import type { TraceItem } from "./index.js"
import {
  dryRunWorkflowInterpreterLayer,
  FixtureTarget,
  liveFakeWorkflowInterpreterLayer,
  makeTaskExecutionOperation,
  makeTrackerGraphObservationOperation,
  runWorkflow,
  TaskExecutionAdmitted,
  TaskExecutionCapacity,
  TaskExecutionOutcomeObserved,
  TaskExecutionStarted,
  TaskId,
  TaskWorkStart,
  TraceOutputError,
  TrackerExecutionAdmitted,
  trackerGraphReaderFileLayer,
  WorkflowTrace
} from "./index.js"

const fixture = (
  name: "diamond" | "singleton" | "wayfinder-105"
): FixtureTarget => FixtureTarget.make(new URL(`../fixtures/${name}.json`, import.meta.url).pathname)

const controlledExecutor = Effect.gen(function*() {
  const started = yield* Queue.unbounded<TaskId>()
  const releases = yield* Queue.unbounded<void>()
  const active = yield* Ref.make(0)
  const maximumActive = yield* Ref.make(0)
  const traces = yield* Ref.make<ReadonlyArray<TraceItem>>([])
  const admissionPrecededExecution = yield* Ref.make(true)
  const service = TaskWorkStart.of({
    request: Effect.fn("TaskWorkStart.Test.request")(function*(taskId) {
      const items = yield* Ref.get(traces)
      yield* Ref.update(
        admissionPrecededExecution,
        (valid) =>
          valid
          && items.some(
            (item) =>
              item._tag === "TaskExecutionAdmitted"
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
    admissionPrecededExecution,
    service,
    started,
    trace,
    traces
  } as const
})

it("decodes tracker admission, task admission, substrate start, and outcome observation as distinct events", () => {
  const readOperation = makeTrackerGraphObservationOperation(fixture("diamond"))
  const operation = makeTaskExecutionOperation(
    TaskId.make("task"),
    readOperation.operationId
  )

  expect(
    Schema.decodeUnknownSync(TrackerExecutionAdmitted)({
      _tag: "TrackerExecutionAdmitted",
      operation
    })._tag
  ).toBe("TrackerExecutionAdmitted")
  expect(
    Schema.decodeUnknownSync(TaskExecutionAdmitted)({
      _tag: "TaskExecutionAdmitted",
      operation
    })._tag
  ).toBe("TaskExecutionAdmitted")
  expect(
    Schema.decodeUnknownSync(TaskExecutionStarted)({
      _tag: "TaskExecutionStarted",
      operation
    })._tag
  ).toBe("TaskExecutionStarted")
  expect(
    Schema.decodeUnknownSync(TaskExecutionOutcomeObserved)({
      _tag: "TaskExecutionOutcomeObserved",
      operation,
      outcome: { _tag: "TaskExecuted" }
    })._tag
  ).toBe("TaskExecutionOutcomeObserved")
})

it.effect("capacity 2 admits both controlled tasks before either gate releases", () =>
  Effect.gen(function*() {
    const controlled = yield* controlledExecutor
    const run = yield* runWorkflow(
      fixture("diamond"),
      TaskExecutionCapacity.make(2)
    ).pipe(
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskWorkStart, controlled.service)),
      Effect.provide(Layer.succeed(WorkflowTrace, controlled.trace)),
      Effect.forkScoped
    )

    expect(yield* Queue.take(controlled.started)).toBe("group")
    expect(yield* Queue.take(controlled.started)).toBe("root")
    expect(yield* Ref.get(controlled.active)).toBe(2)
    expect(yield* Ref.get(controlled.maximumActive)).toBe(2)
    expect(yield* Ref.get(controlled.admissionPrecededExecution)).toBe(true)

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
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskWorkStart, controlled.service)),
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
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskWorkStart, controlled.service)),
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
    const traceTags: ReadonlyArray<string> = traces.map((item) => item._tag)
    expect(traceTags).not.toContain("RunCompleted")
    expect(traceTags).not.toContain("RunTerminated")
  }))

it.effect("records task outcome observations in completion order", () =>
  Effect.gen(function*() {
    const firstGate = yield* Deferred.make<void>()
    const secondGate = yield* Deferred.make<void>()
    const firstOutcomeWriteStarted = yield* Deferred.make<void>()
    const releaseFirstOutcomeWrite = yield* Deferred.make<void>()
    const started = yield* Queue.unbounded<TaskId>()
    const capabilityOutcomes = yield* Queue.unbounded<TaskId>()
    const traces = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const outcomeWriteCount = yield* Ref.make(0)
    const service = TaskWorkStart.of({
      request: Effect.fn("TaskWorkStart.Test.reverseCompletion")(function*(taskId) {
        yield* Queue.offer(started, taskId)
        yield* Deferred.await(taskId === "group" ? firstGate : secondGate)
        yield* Queue.offer(capabilityOutcomes, taskId)
      })
    })
    const trace = WorkflowTrace.of({
      emit: Effect.fn("WorkflowTrace.Test.reverseCompletion")(function*(item) {
        if (item._tag === "TaskExecutionOutcomeObserved") {
          const writeIndex = yield* Ref.getAndUpdate(
            outcomeWriteCount,
            (count) => count + 1
          )
          if (writeIndex === 0) {
            yield* Deferred.succeed(firstOutcomeWriteStarted, undefined)
            yield* Deferred.await(releaseFirstOutcomeWrite)
          }
        }
        yield* Ref.update(traces, (items) => [...items, item])
      })
    })
    const run = yield* runWorkflow(
      fixture("diamond"),
      TaskExecutionCapacity.make(2)
    ).pipe(
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskWorkStart, service)),
      Effect.provide(Layer.succeed(WorkflowTrace, trace)),
      Effect.forkScoped
    )

    yield* Queue.take(started)
    yield* Queue.take(started)
    yield* Deferred.succeed(secondGate, undefined)
    expect(yield* Queue.take(capabilityOutcomes)).toBe("root")
    yield* Deferred.await(firstOutcomeWriteStarted)
    yield* Deferred.succeed(firstGate, undefined)
    expect(yield* Queue.take(capabilityOutcomes)).toBe("group")
    yield* Deferred.succeed(releaseFirstOutcomeWrite, undefined)
    yield* Fiber.join(run)
    const items = yield* Ref.get(traces)
    const admitted = items.flatMap((item) =>
      item._tag === "TaskExecutionAdmitted"
        ? [item.operation.taskId]
        : []
    )
    const observed = items.flatMap((item) =>
      item._tag === "TaskExecutionOutcomeObserved"
        ? [item.operation.taskId]
        : []
    )
    expect(admitted).toEqual(["group", "root"])
    expect(observed).toEqual(["root", "group"])
    expect(yield* Ref.get(outcomeWriteCount)).toBe(2)

    const taskEvents = items.filter(
      (item) =>
        item._tag === "TaskExecutionAdmitted"
        || item._tag === "TaskExecutionOutcomeObserved"
    )
    const graphOperationIds = items.flatMap((item) =>
      item._tag === "TrackerGraphOutcomeObserved"
        ? [item.operation.operationId]
        : []
    )
    expect(graphOperationIds).toHaveLength(1)
    for (const taskId of ["group", "root"] as const) {
      const operations = taskEvents.flatMap((item) => item.operation.taskId === taskId ? [item.operation] : [])
      expect(operations).toHaveLength(2)
      expect(operations[0]?.operationId).toBe(operations[1]?.operationId)
      expect(operations[0]?.predecessorOperationIds).toEqual(graphOperationIds)
    }
    expect(items.some((item) => item._tag === "TrackerExecutionAdmitted")).toBe(false)
    expect(items.some((item) => item._tag === "TaskExecutionStarted")).toBe(false)
  }))

it.effect("dry-run reproducibly varies completion order without varying admission", () =>
  Effect.gen(function*() {
    const testClock = yield* TestClock.testClockWith(Effect.succeed)
    const clock = yield* Clock.Clock
    const observe = Effect.fn("WorkflowTest.observeSeededDryRun")(function*(
      seed: number
    ) {
      const sleeps = yield* Queue.unbounded<number>()
      const admitted = yield* Queue.unbounded<TaskId>()
      const traces = yield* Ref.make<ReadonlyArray<TraceItem>>([])
      const controlledClock = {
        ...clock,
        sleep: (duration: Duration.Duration) =>
          Queue.offer(sleeps, Duration.toMillis(duration)).pipe(
            Effect.andThen(clock.sleep(duration))
          )
      }
      const trace = WorkflowTrace.of({
        emit: Effect.fn("WorkflowTrace.Test.seededDryRun")(function*(item) {
          yield* Ref.update(traces, (items) => [...items, item])
          if (item._tag === "TaskExecutionAdmitted") {
            yield* Queue.offer(admitted, item.operation.taskId)
          }
        })
      })
      const run = yield* runWorkflow(
        fixture("diamond"),
        TaskExecutionCapacity.make(2)
      ).pipe(
        Effect.provide(dryRunWorkflowInterpreterLayer),
        Effect.provide(trackerGraphReaderFileLayer),
        Effect.provide(Layer.succeed(WorkflowTrace, trace)),
        Effect.provide(Layer.succeed(Clock.Clock, controlledClock)),
        Random.withSeed(seed),
        Effect.forkScoped
      )
      const admissionOrder = [
        yield* Queue.take(admitted),
        yield* Queue.take(admitted)
      ]
      const durations = [yield* Queue.take(sleeps), yield* Queue.take(sleeps)]

      yield* testClock.adjust(Math.max(...durations))
      yield* Fiber.join(run)

      const items = yield* Ref.get(traces)
      return {
        admissionOrder,
        completionOrder: items.flatMap((item) =>
          item._tag === "TaskExecutionOutcomeObserved"
            ? [item.operation.taskId]
            : []
        ),
        durations,
        items
      }
    })

    const first = yield* observe(2)
    const repeated = yield* observe(2)
    const different = yield* observe(5)

    expect(first.admissionOrder).toEqual(["group", "root"])
    expect(repeated.admissionOrder).toEqual(first.admissionOrder)
    expect(different.admissionOrder).toEqual(first.admissionOrder)
    expect(first.completionOrder).toEqual(["root", "group"])
    expect(repeated.completionOrder).toEqual(first.completionOrder)
    expect(repeated.durations).toEqual(first.durations)
    expect(different.completionOrder).toEqual(["group", "root"])
    expect(different.completionOrder).not.toEqual(first.completionOrder)
    expect(first.items.some((item) => "duration" in item)).toBe(false)
  }))

it.effect("does not invoke execution when task admission output fails", () =>
  Effect.gen(function*() {
    const invoked = yield* Ref.make(false)
    const failure = new TraceOutputError({ detail: "admission output failed" })
    const service = TaskWorkStart.of({
      request: Effect.fn("TaskWorkStart.Test.admissionFailure")(function*() {
        yield* Ref.set(invoked, true)
      })
    })
    const trace = WorkflowTrace.of({
      emit: Effect.fn("WorkflowTrace.Test.admissionFailure")(function*(item) {
        if (item._tag === "TaskExecutionAdmitted") {
          return yield* Effect.fail(failure)
        }
      })
    })

    const observed = yield* runWorkflow(
      fixture("singleton"),
      TaskExecutionCapacity.make(1)
    ).pipe(
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskWorkStart, service)),
      Effect.provide(Layer.succeed(WorkflowTrace, trace)),
      Effect.flip
    )

    expect(observed).toBe(failure)
    expect(yield* Ref.get(invoked)).toBe(false)
  }))

it.effect("keeps later work unadmitted while outcome output is blocked", () =>
  Effect.gen(function*() {
    const started = yield* Queue.unbounded<TaskId>()
    const admitted = yield* Queue.unbounded<TaskId>()
    const releases = yield* Queue.unbounded<void>()
    const capabilityOutcomes = yield* Queue.unbounded<TaskId>()
    const invocationCount = yield* Ref.make(0)
    const firstOutcomeWriteStarted = yield* Deferred.make<void>()
    const releaseFirstOutcomeWrite = yield* Deferred.make<void>()
    const outcomeWriteCount = yield* Ref.make(0)
    const service = TaskWorkStart.of({
      request: Effect.fn("TaskWorkStart.Test.outputBackpressure")(function*(taskId) {
        const invocationIndex = yield* Ref.getAndUpdate(
          invocationCount,
          (count) => count + 1
        )
        yield* Queue.offer(started, taskId)
        if (invocationIndex < 2) {
          yield* Queue.take(releases)
        }
        yield* Queue.offer(capabilityOutcomes, taskId)
      })
    })
    const trace = WorkflowTrace.of({
      emit: Effect.fn("WorkflowTrace.Test.outputBackpressure")(function*(item) {
        if (item._tag === "TaskExecutionAdmitted") {
          yield* Queue.offer(admitted, item.operation.taskId)
        }
        if (item._tag === "TaskExecutionOutcomeObserved") {
          const writeIndex = yield* Ref.getAndUpdate(
            outcomeWriteCount,
            (count) => count + 1
          )
          if (writeIndex === 0) {
            yield* Deferred.succeed(firstOutcomeWriteStarted, undefined)
            yield* Deferred.await(releaseFirstOutcomeWrite)
          }
        }
      })
    })
    const run = yield* runWorkflow(
      fixture("wayfinder-105"),
      TaskExecutionCapacity.make(2)
    ).pipe(
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskWorkStart, service)),
      Effect.provide(Layer.succeed(WorkflowTrace, trace)),
      Effect.forkScoped
    )

    yield* Queue.take(started)
    yield* Queue.take(started)
    yield* Queue.take(admitted)
    yield* Queue.take(admitted)
    yield* Queue.offer(releases, undefined)
    yield* Queue.take(capabilityOutcomes)
    yield* Deferred.await(firstOutcomeWriteStarted)
    yield* Queue.offer(releases, undefined)
    yield* Queue.take(capabilityOutcomes)

    expect(yield* Queue.size(admitted)).toBe(0)

    yield* Deferred.succeed(releaseFirstOutcomeWrite, undefined)
    yield* Fiber.join(run)
  }))

it.effect("interrupts concurrent execution when outcome output fails", () =>
  Effect.gen(function*() {
    const started = yield* Queue.unbounded<TaskId>()
    const invocationCount = yield* Ref.make(0)
    const releaseFirst = yield* Deferred.make<void>()
    const siblingInterrupted = yield* Deferred.make<void>()
    const failure = new TraceOutputError({ detail: "outcome output failed" })
    const service = TaskWorkStart.of({
      request: Effect.fn("TaskWorkStart.Test.outcomeFailure")(function*(taskId) {
        const invocationIndex = yield* Ref.getAndUpdate(
          invocationCount,
          (count) => count + 1
        )
        yield* Queue.offer(started, taskId)
        if (invocationIndex === 0) {
          yield* Deferred.await(releaseFirst)
        } else {
          yield* Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(siblingInterrupted, undefined).pipe(Effect.asVoid))
          )
        }
      })
    })
    const trace = WorkflowTrace.of({
      emit: Effect.fn("WorkflowTrace.Test.outcomeFailure")(function*(item) {
        if (item._tag === "TaskExecutionOutcomeObserved") {
          return yield* Effect.fail(failure)
        }
      })
    })
    const run = yield* runWorkflow(
      fixture("wayfinder-105"),
      TaskExecutionCapacity.make(2)
    ).pipe(
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(Layer.succeed(TaskWorkStart, service)),
      Effect.provide(Layer.succeed(WorkflowTrace, trace)),
      Effect.forkScoped
    )

    yield* Queue.take(started)
    yield* Queue.take(started)
    yield* Deferred.succeed(releaseFirst, undefined)

    expect(yield* Fiber.join(run).pipe(Effect.flip)).toBe(failure)
    yield* Deferred.await(siblingInterrupted)
    expect(yield* Queue.size(started)).toBe(0)
  }))
