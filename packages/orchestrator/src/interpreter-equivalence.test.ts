import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import type { TraceItem, TrackerGraphReader, WorkflowInterpreter } from "./index.js"
import {
  deterministicTestWorkflowInterpreterLayer,
  dryRunWorkflowInterpreterLayer,
  FixtureTarget,
  liveFakeWorkflowInterpreterLayer,
  runWorkflow,
  semanticTrace,
  TaskExecution,
  TaskExecutionCapacity,
  trackerGraphReaderFileLayer,
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

const runWith = (
  target: FixtureTarget,
  interpreterLayer: Layer.Layer<
    WorkflowInterpreter,
    never,
    TrackerGraphReader
  >
) =>
  Effect.gen(function*() {
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({
        emit: Effect.fn("WorkflowTrace.Equivalence.emit")(function*(item) {
          yield* Ref.update(items, (current) => [...current, item])
        })
      })
    )

    yield* runWorkflow(target, TaskExecutionCapacity.make(2)).pipe(
      Effect.provide(traceLayer),
      Effect.provide(interpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer)
    )
    return semanticTrace(yield* Ref.get(items))
  })

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

it.effect("dry-run traverses the complete graph with only its read port", () =>
  Effect.gen(function*() {
    yield* runWith(
      fixture("wayfinder-105"),
      dryRunWorkflowInterpreterLayer
    )

    expect(dryRunRequirementsAreReadOnly).toBe(true)
  }))
