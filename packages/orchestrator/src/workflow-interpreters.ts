import { Effect, Layer } from "effect"
import { ProviderObservationId, ProviderRequestId, TaskWorkSessionId } from "./domain.js"
import type { TaskRunnerService } from "./task-work-start.js"
import { MatchingTaskWorkSessionReported, TaskRunner } from "./task-work-start.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { controlledTrackerMutationLayer, TrackerMutation } from "./tracker-mutation.js"
import {
  acquireTaskClaimThrough,
  emitTaskWorkSessionNonConvergence,
  runTaskWorkSessionEstablishmentProtocol,
  TaskClaimAcquisitionSimulated,
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
      const tracker = yield* TrackerMutation
      const trace = yield* WorkflowTrace
      const readTrackerGraph = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.readTrackerGraph`
      )(function*(operation) {
        return yield* reader.read(operation.target)
      })
      const acquireTaskClaim = Effect.fn(
        `WorkflowInterpreter.${operationPrefix}.acquireTaskClaim`
      )(function*(operation) {
        return yield* acquireTaskClaimThrough(tracker, operation)
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
      return WorkflowInterpreter.of({
        acquireTaskClaim,
        establishTaskWorkSession,
        readTrackerGraph
      })
    })
  )

export const deterministicTestWorkflowInterpreterLayer = taskRunnerInterpreterLayer(
  "DeterministicTest"
).pipe(Layer.provide(controlledTrackerMutationLayer))
export const trackerMutationWorkflowInterpreterLayer = taskRunnerInterpreterLayer(
  "TaskRunner"
)
export const taskRunnerWorkflowInterpreterLayer = trackerMutationWorkflowInterpreterLayer.pipe(
  Layer.provide(controlledTrackerMutationLayer)
)
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
      const acquireTaskClaim = Effect.fn(
        "WorkflowInterpreter.DryRun.acquireTaskClaim"
      )(function*(operation) {
        return TaskClaimAcquisitionSimulated.make({ operation })
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
      return WorkflowInterpreter.of({
        acquireTaskClaim,
        establishTaskWorkSession,
        readTrackerGraph
      })
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
