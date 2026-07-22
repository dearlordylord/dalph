import { it } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Ref } from "effect"
import { expect } from "vitest"
import type {
  TaskWorkSessionReport,
  TrackerGraphReader,
  WorkflowInterpreter as WorkflowInterpreterService
} from "./index.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTestWorkflowInterpreterLayer,
  dryRunWorkflowInterpreterLayer,
  FixtureTarget,
  GitCommitSha,
  liveFakeWorkflowInterpreterLayer,
  makeDryRunWorkflowInterpreterLayer,
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  runWorkflow,
  semanticTrace,
  TaskRunner,
  TaskWorkCapacity,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionId,
  TaskWorkSessionLookupFailure,
  trackerGraphReaderFileLayer,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import type { TaskRunnerService } from "./task-work-start.js"
import type { TraceItem } from "./workflow.js"

type IsExactly<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
type Assert<T extends true> = T
type DryRunRequirements = Assert<
  IsExactly<
    Layer.Services<typeof dryRunWorkflowInterpreterLayer>,
    TrackerGraphReader | WorkflowTrace
  >
>
const dryRunRequiresOnlyReadAndTraceCapabilities: DryRunRequirements = true

const target = new URL("../fixtures/singleton.json", import.meta.url).pathname
const plannerLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  runId: RunId.make("equivalence"),
  worktreeRoot: WorktreeLocator.make("/tmp/dalph-equivalence")
})
const successfulRunner = TaskRunner.of({
  lookupTaskWorkSession: Effect.fn("TaskRunner.Equivalence.lookup")(function*(lookup) {
    return MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make(`lookup:${lookup.operationId}`),
      sessionId: TaskWorkSessionId.make(`session:${lookup.operationId}`),
      work: { _tag: "NoProviderWorkReported" }
    })
  }),
  requestTaskWorkStart: Effect.fn("TaskRunner.Equivalence.request")(function*(request) {
    return {
      observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
      providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
    }
  })
})

const traceUnder = (
  interpreterLayer: Layer.Layer<
    WorkflowInterpreterService,
    never,
    TrackerGraphReader | WorkflowTrace | TaskRunner
  >,
  runner: TaskRunnerService = successfulRunner
) =>
  Effect.gen(function*() {
    const items = yield* Ref.make<ReadonlyArray<TraceItem>>([])
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({
        emit: (item) => Ref.update(items, (current) => [...current, item])
      })
    )
    const program = runWorkflow(FixtureTarget.make(target), TaskWorkCapacity.make(1)).pipe(
      Effect.provide(interpreterLayer),
      Effect.provide(traceLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer("equivalence")),
      Effect.provide(plannerLayer),
      Effect.provide(Layer.succeed(TaskRunner, runner))
    )
    const result = yield* Effect.exit(program)
    const failure = Exit.isFailure(result) ? Cause.squash(result.cause) : undefined
    return {
      result: failure === undefined
        ? "Success"
        : typeof failure === "object" && failure !== null && "_tag" in failure
        ? String(failure._tag)
        : String(failure),
      trace: semanticTrace(yield* Ref.get(items))
    }
  })

it.effect("dry-run and deterministic-test emit one exact semantic projection", () =>
  Effect.gen(function*() {
    const dry = yield* traceUnder(dryRunWorkflowInterpreterLayer)
    const deterministic = yield* traceUnder(
      deterministicTestWorkflowInterpreterLayer
    )
    const liveFake = yield* traceUnder(liveFakeWorkflowInterpreterLayer)

    expect(deterministic).toEqual(dry)
    expect(liveFake).toEqual(dry)
    expect(dryRunRequiresOnlyReadAndTraceCapabilities).toBe(true)
  }))

type ScriptedLookup = TaskWorkSessionReport | TaskWorkSessionLookupFailure

const scriptedRunner = (results: ReadonlyArray<ScriptedLookup>): TaskRunnerService => {
  const remaining = [...results]
  return TaskRunner.of({
    lookupTaskWorkSession: Effect.fn("TaskRunner.Equivalence.scriptedLookup")(function*() {
      const result = remaining.shift()
      if (result === undefined) return yield* Effect.die("lookup script exhausted")
      return result instanceof TaskWorkSessionLookupFailure ? yield* result : result
    }),
    requestTaskWorkStart: Effect.fn("TaskRunner.Equivalence.scriptedRequest")(function*(request) {
      return {
        observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
        providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
      }
    })
  })
}

const lookupScenarios = [
  {
    name: "absence followed by a match",
    results: () => [
      NoMatchingTaskWorkSessionReported.make({
        observationId: ProviderObservationId.make("lookup:absence")
      }),
      MatchingTaskWorkSessionReported.make({
        observationId: ProviderObservationId.make("lookup:match"),
        sessionId: TaskWorkSessionId.make("session:match"),
        work: { _tag: "NoProviderWorkReported" }
      })
    ]
  },
  {
    name: "unreadable lookup exhaustion",
    results: () =>
      [1, 2, 3].map((attempt) =>
        new TaskWorkSessionLookupFailure({
          detail: "provider registry unavailable",
          observationId: ProviderObservationId.make(`lookup:unreadable:${attempt}`)
        })
      )
  },
  {
    name: "absence exhaustion",
    results: () =>
      [1, 2, 3].map((attempt) =>
        NoMatchingTaskWorkSessionReported.make({
          observationId: ProviderObservationId.make(`lookup:absence:${attempt}`)
        })
      )
  },
  {
    name: "provider correlation conflict",
    results: () => [
      TaskWorkSessionCorrelationConflict.make({
        conflicts: [{
          detail: "two provider sessions matched",
          sessionId: TaskWorkSessionId.make("session:conflict")
        }],
        observationId: ProviderObservationId.make("lookup:conflict")
      })
    ]
  }
] satisfies ReadonlyArray<{
  readonly name: string
  readonly results: () => ReadonlyArray<ScriptedLookup>
}>

for (const scenario of lookupScenarios) {
  it.effect(`keeps ${scenario.name} equivalent across all interpreters`, () =>
    Effect.gen(function*() {
      const dryRunner = scriptedRunner(scenario.results())
      const dry = yield* traceUnder(makeDryRunWorkflowInterpreterLayer(dryRunner), dryRunner)
      const deterministic = yield* traceUnder(
        deterministicTestWorkflowInterpreterLayer,
        scriptedRunner(scenario.results())
      )
      const liveFake = yield* traceUnder(
        liveFakeWorkflowInterpreterLayer,
        scriptedRunner(scenario.results())
      )

      expect(deterministic).toEqual(dry)
      expect(liveFake).toEqual(dry)
    }))
}
