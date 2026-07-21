import { it } from "@effect/vitest"
import { Clock, Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { expect } from "vitest"
import type { TraceItem } from "./index.js"
import {
  deterministicTestWorkflowInterpreterLayer,
  dryRunWorkflowInterpreterLayer,
  FixtureTarget,
  liveFakeWorkflowInterpreterLayer,
  runWorkflow,
  semanticTrace,
  TaskExecution,
  TaskExecutionCapacity,
  TaskId,
  TrackerGraphReader,
  trackerGraphReaderFileLayer,
  WorkflowInterpreter,
  WorkflowTrace
} from "./index.js"

type IsExactly<A, B> = [A] extends [B] ? [B] extends [A] ? true
  : false
  : false
type Assert<T extends true> = T
type DryRunHasOnlyReadRequirements = Assert<
  IsExactly<
    Layer.Services<typeof dryRunWorkflowInterpreterLayer>,
    TrackerGraphReader
  >
>

const dryRunRequirementsAreReadOnly: DryRunHasOnlyReadRequirements = true

const fixture = (
  name: "diamond" | "empty" | "singleton" | "wayfinder-105"
): FixtureTarget => FixtureTarget.make(new URL(`../fixtures/${name}.json`, import.meta.url).pathname)

const taskExecutionLayer = Layer.succeed(
  TaskExecution,
  TaskExecution.of({
    execute: Effect.fn("TaskExecution.Equivalence.execute")(function*() {
      yield* Effect.void
    })
  })
)

const liveFakeLayer = liveFakeWorkflowInterpreterLayer.pipe(
  Layer.provide(taskExecutionLayer)
)

const deterministicTestLayer = deterministicTestWorkflowInterpreterLayer.pipe(
  Layer.provide(taskExecutionLayer)
)

const makeCompletionController = (
  taskIds: ReadonlyArray<TaskId>
) =>
  Effect.gen(function*() {
    const entries = yield* Effect.forEach(
      taskIds,
      Effect.fn("CompletionController.makeGate")(function*(taskId) {
        const started = yield* Deferred.make<void>()
        const released = yield* Deferred.make<void>()
        return [taskId, { released, started }] as const
      })
    )
    const gates = new Map(entries)
    const gateFor = Effect.fn("CompletionController.gateFor")(function*(
      taskId: TaskId
    ) {
      const gate = gates.get(taskId)
      if (gate === undefined) {
        return yield* Effect.die(`missing completion gate for ${taskId}`)
      }
      return gate
    })
    const awaitRelease = Effect.fn(
      "CompletionController.awaitRelease"
    )(function*(taskId: TaskId) {
      const gate = yield* gateFor(taskId)
      yield* Deferred.succeed(gate.started, undefined)
      yield* Deferred.await(gate.released)
    })
    const release = Effect.fn("CompletionController.release")(function*(
      taskId: TaskId
    ) {
      const gate = yield* gateFor(taskId)
      yield* Deferred.await(gate.started)
      yield* Deferred.succeed(gate.released, undefined)
    })

    return { awaitRelease, release }
  })

const controlledInterpreterLayer = (
  interpreterLayer: Layer.Layer<
    WorkflowInterpreter,
    never,
    TrackerGraphReader
  >,
  awaitRelease: (taskId: TaskId) => Effect.Effect<void>
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const executeTask = Effect.fn(
        "WorkflowInterpreter.Controlled.executeTask"
      )(function*(taskId: TaskId) {
        const outcome = yield* interpreter.executeTask(taskId)
        yield* awaitRelease(taskId)
        return outcome
      })

      return WorkflowInterpreter.of({
        executeTask,
        readTrackerGraph: interpreter.readTrackerGraph
      })
    })
  ).pipe(Layer.provide(interpreterLayer))

const runWithCompletionOrder = (
  target: FixtureTarget,
  interpreterLayer: Layer.Layer<
    WorkflowInterpreter,
    never,
    TrackerGraphReader
  >,
  completionOrder: ReadonlyArray<TaskId>
) =>
  Effect.gen(function*() {
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const clock = yield* Clock.Clock
    const controlledClock = {
      ...clock,
      sleep: () => Effect.void
    }
    const completionController = yield* makeCompletionController(
      completionOrder
    )
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({
        emit: Effect.fn("WorkflowTrace.Equivalence.emit")(function*(item) {
          yield* Ref.update(items, (current) => [...current, item])
        })
      })
    )

    const run = yield* runWorkflow(target, TaskExecutionCapacity.make(2)).pipe(
      Effect.provide(traceLayer),
      Effect.provide(
        controlledInterpreterLayer(
          interpreterLayer,
          completionController.awaitRelease
        )
      ),
      Effect.provide(Layer.succeed(Clock.Clock, controlledClock)),
      Effect.forkScoped
    )
    yield* Effect.forEach(
      completionOrder,
      completionController.release,
      { discard: true }
    )
    yield* Fiber.join(run)
    return semanticTrace(yield* Ref.get(items))
  })

const runWith = (
  target: FixtureTarget,
  interpreterLayer: Layer.Layer<
    WorkflowInterpreter,
    never,
    TrackerGraphReader
  >
) =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const snapshot = yield* reader.read(target)
    return yield* runWithCompletionOrder(
      target,
      interpreterLayer,
      snapshot.eligibleTaskIds()
    )
  }).pipe(Effect.provide(trackerGraphReaderFileLayer))

for (const name of ["empty", "singleton", "diamond", "wayfinder-105"] as const) {
  it.effect(`${name} has one semantic trace under every interpreter`, () =>
    Effect.gen(function*() {
      const target = fixture(name)
      const liveFake = yield* runWith(target, liveFakeLayer)
      const dryRun = yield* runWith(target, dryRunWorkflowInterpreterLayer)
      const deterministicTest = yield* runWith(
        target,
        deterministicTestLayer
      )

      expect(dryRun).toEqual(liveFake)
      expect(deterministicTest).toEqual(liveFake)
    }))
}

it.effect("honors an explicit controlled completion order", () =>
  Effect.gen(function*() {
    const trace = yield* runWithCompletionOrder(
      fixture("diamond"),
      dryRunWorkflowInterpreterLayer,
      [TaskId.make("group"), TaskId.make("root")]
    ).pipe(Effect.provide(trackerGraphReaderFileLayer))
    const completionOrder = trace.flatMap((item) =>
      item._tag === "TaskExecutionOutcomeObserved"
        ? [item.operation.taskId]
        : []
    )

    expect(completionOrder).toEqual(["group", "root"])
  }))

it.effect("dry-run traverses the complete graph with only its read port", () =>
  Effect.gen(function*() {
    yield* runWith(
      fixture("wayfinder-105"),
      dryRunWorkflowInterpreterLayer
    )

    expect(dryRunRequirementsAreReadOnly).toBe(true)
  }))
