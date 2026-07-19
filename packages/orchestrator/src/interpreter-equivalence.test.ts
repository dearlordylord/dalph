import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import type { CapabilityAudit, TraceItem, TrackerGraphReader, WorkflowInterpreter } from "./index.js"
import {
  CapabilityAuditTest,
  capabilityAuditTestLayer,
  deterministicTestWorkflowInterpreterLayer,
  dryRunWorkflowInterpreterLayer,
  FixtureTarget,
  liveFakeWorkflowInterpreterLayer,
  runWorkflow,
  semanticTrace,
  TaskExecution,
  TaskExecutionCapacity,
  trackerGraphReaderFileLayer,
  WorkflowTrace,
  WriteAuthority
} from "./index.js"

type IsExactly<A, B> = [A] extends [B] ? [B] extends [A] ? true
  : false
  : false
type Assert<T extends true> = T
type DryRunHasOnlyReadAndAuditRequirements = Assert<
  IsExactly<
    Layer.Services<typeof dryRunWorkflowInterpreterLayer>,
    CapabilityAudit | TrackerGraphReader
  >
>

const dryRunRequirementsAreReadOnly: DryRunHasOnlyReadAndAuditRequirements = true

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
    CapabilityAudit | TrackerGraphReader
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
      const liveFake = yield* runWith(target, liveFakeLayer).pipe(
        Effect.provide(capabilityAuditTestLayer)
      )
      const dryRun = yield* runWith(target, dryRunWorkflowInterpreterLayer).pipe(
        Effect.provide(capabilityAuditTestLayer)
      )
      const deterministicTest = yield* runWith(
        target,
        deterministicTestLayer
      ).pipe(Effect.provide(capabilityAuditTestLayer))

      expect(dryRun).toEqual(liveFake)
      expect(deterministicTest).toEqual(liveFake)
    }))
}

it.effect("dry-run audits no authority writes across the complete retained graph", () =>
  Effect.gen(function*() {
    const audit = yield* CapabilityAuditTest

    yield* runWith(
      fixture("wayfinder-105"),
      dryRunWorkflowInterpreterLayer
    )

    const entries = yield* audit.entries()
    const writes = entries.filter((entry) => entry._tag === "WriteAttempted")
    expect(dryRunRequirementsAreReadOnly).toBe(true)
    expect(writes).toEqual([])
    expect(WriteAuthority.literals).toEqual([
      "Journal",
      "Filesystem",
      "Git",
      "TrackerMutation",
      "Process",
      "Evidence",
      "Cleanup",
      "Lock",
      "PolicyWrite"
    ])
  }).pipe(Effect.provide(capabilityAuditTestLayer)))
