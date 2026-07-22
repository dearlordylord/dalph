import { it } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Ref } from "effect"
import { expect } from "vitest"
import type { TrackerGraphReader, WorkflowInterpreter as WorkflowInterpreterService } from "./index.js"
import {
  ClaimOwner,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  deterministicTestWorkflowInterpreterLayer,
  dryRunWorkflowInterpreterLayer,
  FixtureTarget,
  GitCommitSha,
  liveFakeWorkflowInterpreterLayer,
  MatchingTaskWorkSessionReported,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  runWorkflow,
  semanticTrace,
  TaskExecutorLocator,
  TaskRunner,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  trackerGraphReaderFileLayer,
  WorkflowInterpreter,
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
    TrackerGraphReader
  >
>
const dryRunRequiresOnlyReadCapability: DryRunRequirements = true

const target = new URL("../fixtures/singleton.json", import.meta.url).pathname
const plannerLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
  executor: TaskExecutorLocator.make("executor:equivalence"),
  runId: RunId.make("equivalence"),
  sessionRoot: TaskWorkSessionLocator.make("session:equivalence"),
  worktreeRoot: WorktreeLocator.make("/tmp/dalph-equivalence")
})
const claimPlannerLayer = deterministicTaskClaimAcquisitionPlannerLayer({
  owner: ClaimOwner.make("equivalence"),
  tokenPrefix: "equivalence-claim"
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
      Effect.provide(claimPlannerLayer),
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

    expect(liveFake).toEqual(deterministic)
    expect(dry.result).toBe(deterministic.result)
    expect(dry.trace.map((item) => item._tag)).not.toContain(
      "TrackerExecutionAdmitted"
    )
    expect(dryRunRequiresOnlyReadCapability).toBe(true)
  }))

it.effect("never calls an injected task runner for a simulated attempt", () =>
  Effect.gen(function*() {
    const lookups = yield* Ref.make(0)
    const starts = yield* Ref.make(0)
    const defectingRunner = TaskRunner.of({
      lookupTaskWorkSession: () =>
        Ref.update(lookups, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("simulation must not look up provider sessions"))
        ),
      requestTaskWorkStart: () =>
        Ref.update(starts, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("simulation must not start provider sessions"))
        )
    })

    const simulated = yield* traceUnder(liveFakeWorkflowInterpreterLayer, defectingRunner)
    const simulation = simulated.trace.find(
      ({ _tag }) => _tag === "TaskWorkSessionEstablishmentSimulated"
    )

    expect(simulated.result).toBe("Success")
    expect(simulated.trace.map(({ _tag }) => _tag)).toContain(
      "TaskWorkSessionEstablishmentSimulated"
    )
    expect(simulated.trace.map(({ _tag }) => _tag)).not.toContain(
      "TaskWorkSessionEstablished"
    )
    expect(simulated.trace.map(({ _tag }) => _tag)).not.toContain("TaskWorkStartRequested")
    expect(simulated.trace.map(({ _tag }) => _tag)).not.toContain("TaskWorkSessionLookupRequested")
    expect(simulation).toBeDefined()
    if (simulation?._tag === "TaskWorkSessionEstablishmentSimulated") {
      expect(simulation.outcome.session).toBe(
        simulation.operation.request.plannedAttempt.session
      )
      const directEstablishment = yield* Effect.gen(function*() {
        const interpreter = yield* WorkflowInterpreter
        return yield* interpreter.establishTaskWorkSession(simulation.operation)
      }).pipe(
        Effect.provide(dryRunWorkflowInterpreterLayer),
        Effect.provide(trackerGraphReaderFileLayer),
        Effect.exit
      )
      expect(Exit.isFailure(directEstablishment)).toBe(true)
    }
    expect(yield* Ref.get(lookups)).toBe(0)
    expect(yield* Ref.get(starts)).toBe(0)
  }))
