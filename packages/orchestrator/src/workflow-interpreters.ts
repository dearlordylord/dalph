import { Effect, Layer } from "effect"
import { ProviderObservationId, ProviderRequestId, TaskWorkSessionId } from "./domain.js"
import type { TaskRunnerService } from "./task-work-start.js"
import { MatchingTaskWorkSessionReported, TaskRunner } from "./task-work-start.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import {
  emitTaskWorkSessionNonConvergence,
  runTaskWorkSessionEstablishmentProtocol,
  taskWorkSessionTraceObserver,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

const taskRunnerInterpreterLayer = (
  operationPrefix: "TaskRunner" | "DeterministicTest"
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const runner = yield* TaskRunner
      const trace = yield* WorkflowTrace
      const readTrackerGraph = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.readTrackerGraph`
      )(function*(operation) {
        return yield* reader.read(operation.target)
      })
      const establishTaskWorkSession = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.establishTaskWorkSession`
      )(function*(operation) {
        return yield* runTaskWorkSessionEstablishmentProtocol(
          runner,
          operation,
          true,
          taskWorkSessionTraceObserver(operation, trace)
        ).pipe(
          Effect.tapError((failure) => emitTaskWorkSessionNonConvergence(failure, operation, trace))
        )
      })
      return WorkflowInterpreter.of({ establishTaskWorkSession, readTrackerGraph })
    })
  )

export const deterministicTestWorkflowInterpreterLayer = taskRunnerInterpreterLayer("DeterministicTest")
export const taskRunnerWorkflowInterpreterLayer = taskRunnerInterpreterLayer("TaskRunner")
export const liveFakeWorkflowInterpreterLayer = taskRunnerWorkflowInterpreterLayer

export const makeDryRunWorkflowInterpreterLayer = (
  simulation: TaskRunnerService
): Layer.Layer<
  WorkflowInterpreter,
  never,
  TrackerGraphReader | WorkflowTrace
> =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const trace = yield* WorkflowTrace
      const readTrackerGraph = Effect.fn(
        "WorkflowInterpreter.DryRun.readTrackerGraph"
      )(function*(operation) {
        return yield* reader.read(operation.target)
      })
      const establishTaskWorkSession = Effect.fn(
        "WorkflowInterpreter.DryRun.establishTaskWorkSession"
      )(function*(operation) {
        return yield* runTaskWorkSessionEstablishmentProtocol(
          simulation,
          operation,
          true,
          taskWorkSessionTraceObserver(operation, trace)
        ).pipe(
          Effect.tapError((failure) => emitTaskWorkSessionNonConvergence(failure, operation, trace))
        )
      })
      return WorkflowInterpreter.of({ establishTaskWorkSession, readTrackerGraph })
    })
  )

const successfulDryRunSimulation = TaskRunner.of({
  lookupTaskWorkSession: Effect.fn("TaskRunner.DryRun.lookup")(function*(lookup) {
    return MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make(`lookup:${lookup.operationId}`),
      sessionId: TaskWorkSessionId.make(`session:${lookup.operationId}`),
      work: { _tag: "NoProviderWorkReported" }
    })
  }),
  requestTaskWorkStart: Effect.fn("TaskRunner.DryRun.request")(function*(request) {
    return {
      observationId: ProviderObservationId.make(`request-observation:${request.operationId}`),
      providerRequestId: ProviderRequestId.make(`request:${request.operationId}`)
    }
  })
})

export const dryRunWorkflowInterpreterLayer = makeDryRunWorkflowInterpreterLayer(
  successfulDryRunSimulation
)
