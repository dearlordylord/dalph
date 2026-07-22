import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Queue, Ref } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  FixtureTarget,
  GitCommitSha,
  liveFakeWorkflowInterpreterLayer,
  MatchingTaskWorkSessionReported,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  runWorkflow,
  TaskRunner,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TraceOutputError,
  TrackerGraphReader,
  trackerGraphReaderFileLayer,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import type { TraceItem } from "./workflow.js"

const fixture = (name: "singleton" | "wayfinder-105") => new URL(`../fixtures/${name}.json`, import.meta.url).pathname

const planningLayers = [
  deterministicOperationIdAllocatorLayer("workflow-test"),
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
    runId: RunId.make("workflow-test"),
    worktreeRoot: WorktreeLocator.make("/tmp/dalph-workflow-test")
  })
] as const

const successfulTaskRunner = TaskRunner.of({
  lookupTaskWorkSession: Effect.fn("TaskRunner.WorkflowTest.lookup")(function*(lookup) {
    return MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make(`lookup:${lookup.operationId}`),
      sessionId: TaskWorkSessionId.make(`session:${lookup.operationId}`),
      work: { _tag: "NoProviderWorkReported" }
    })
  }),
  requestTaskWorkStart: Effect.fn("TaskRunner.WorkflowTest.start")(function*(request) {
    return {
      observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
      providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
    }
  })
})

const runLayered = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  traceLayer: Layer.Layer<WorkflowTrace>,
  runner = successfulTaskRunner
) =>
  effect.pipe(
    Effect.provide(liveFakeWorkflowInterpreterLayer),
    Effect.provide(traceLayer),
    Effect.provide(Layer.succeed(TaskRunner, runner)),
    Effect.provide(trackerGraphReaderFileLayer),
    Effect.provide(planningLayers[0]),
    Effect.provide(planningLayers[1])
  )

it.effect("emits every distinct task-work session-establishment phenomenon", () =>
  Effect.gen(function*() {
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({
        emit: (item) => Ref.update(items, (current) => [...current, item])
      })
    )
    yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("singleton")), TaskWorkCapacity.make(1)),
      traceLayer
    )

    expect((yield* Ref.get(items)).map((item) => item._tag)).toEqual([
      "OperationSelected",
      "TrackerGraphOutcomeObserved",
      "OperationSelected",
      "TrackerGraphOutcomeObserved",
      "TaskWorkCapacityReserved",
      "OperationSelected",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ])
  }))

it.effect("reserves no more than the configured task-work capacity", () =>
  Effect.gen(function*() {
    const started = yield* Queue.unbounded<string>()
    const release = yield* Deferred.make<void>()
    const runner = TaskRunner.of({
      ...successfulTaskRunner,
      requestTaskWorkStart: Effect.fn("TaskRunner.WorkflowTest.gatedStart")(function*(request) {
        yield* Queue.offer(started, request.task.id)
        yield* Deferred.await(release)
        return {
          observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
          providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
        }
      })
    })
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    )
    const fiber = yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("wayfinder-105")), TaskWorkCapacity.make(2)),
      traceLayer,
      runner
    ).pipe(Effect.forkScoped)

    yield* Queue.take(started)
    yield* Queue.take(started)
    expect(yield* Queue.size(started)).toBe(0)
    yield* Fiber.interrupt(fiber)
  }))

it.effect("does not send a start request when capacity trace output fails", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const runner = TaskRunner.of({
      ...successfulTaskRunner,
      requestTaskWorkStart: (request) =>
        Ref.update(requests, (count) => count + 1).pipe(
          Effect.as({
            observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
            providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
          })
        )
    })
    const failure = new TraceOutputError({ detail: "capacity trace failed" })
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({
        emit: (item) =>
          item._tag === "TaskWorkCapacityReserved"
            ? Effect.fail(failure)
            : Effect.void
      })
    )
    const observed = yield* runLayered(
      runWorkflow(FixtureTarget.make(fixture("singleton")), TaskWorkCapacity.make(1)),
      traceLayer,
      runner
    ).pipe(Effect.flip)

    expect(observed).toBe(failure)
    expect(yield* Ref.get(requests)).toBe(0)
  }))

it.effect("revalidates tracker eligibility immediately before task-work start", () =>
  Effect.gen(function*() {
    const reads = yield* Ref.make(0)
    const requests = yield* Ref.make(0)
    const initiallyEligible = validSnapshot({
      revision: "initially-eligible",
      tasks: [{
        id: "task-revalidation",
        lifecycle: { _tag: "Open" },
        parentTaskId: null,
        prerequisiteIds: []
      }]
    })
    const noLongerEligible = validSnapshot({
      revision: "no-longer-eligible",
      tasks: []
    })
    const readerLayer = Layer.succeed(
      TrackerGraphReader,
      TrackerGraphReader.of({
        read: () =>
          Ref.getAndUpdate(reads, (value) => value + 1).pipe(
            Effect.map((ordinal) => ordinal === 0 ? initiallyEligible : noLongerEligible)
          )
      })
    )
    const runnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("lookup must not run"),
        requestTaskWorkStart: () =>
          Ref.update(requests, (value) => value + 1).pipe(
            Effect.andThen(Effect.die("request must not run"))
          )
      })
    )
    yield* runWorkflow(
      FixtureTarget.make("revalidation-target"),
      TaskWorkCapacity.make(1)
    ).pipe(
      Effect.provide(liveFakeWorkflowInterpreterLayer),
      Effect.provide(readerLayer),
      Effect.provide(runnerLayer),
      Effect.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      )),
      Effect.provide(planningLayers[0]),
      Effect.provide(planningLayers[1])
    )

    expect(yield* Ref.get(reads)).toBe(2)
    expect(yield* Ref.get(requests)).toBe(0)
  }))
