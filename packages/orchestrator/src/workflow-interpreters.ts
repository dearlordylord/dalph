import { Effect, Layer } from "effect"
import { emptyRunRecoveryActivationLayer } from "./run-recovery-activation.js"
import { controlledFakePlannedAttemptExecutorLayer } from "./planned-attempt-executor.js"
import { TaskAttemptPlanRecordingSimulated } from "./task-attempt-plan-recording.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { controlledTrackerMutationLayer, TrackerMutation } from "./tracker-mutation.js"
import {
  acquireTaskClaimThrough,
  TaskClaimAcquisitionSimulated,
  TaskWorktreeReconciliationSimulated,
  type WorkflowOperation,
  WorkflowInterpreter
} from "./workflow.js"

/** Live tracker operations with simulated plan and worktree boundaries for focused tests. */
export const makeLiveWorkflowInterpreterLayer = (operationPrefix: "ProductionBase" | "DeterministicTest") =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const reader = yield* TrackerGraphReader
      const tracker = yield* TrackerMutation
      const readTrackerGraph = Effect.fn(`WorkflowInterpreter.${operationPrefix}.readTrackerGraph`)(function* (
        operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
      ) {
        return yield* reader.read(operation.target)
      })
      const readTaskWorkSpecification = Effect.fn(`WorkflowInterpreter.${operationPrefix}.readTaskWorkSpecification`)(
        function* (operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type) {
          return yield* reader.readTaskWorkSpecification(operation.target, operation.taskId)
        }
      )
      const acquireTaskClaim = Effect.fn(`WorkflowInterpreter.${operationPrefix}.acquireTaskClaim`)(function* (
        operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
        onIntentRecorded: Effect.Effect<void> = Effect.void
      ) {
        yield* onIntentRecorded
        return yield* acquireTaskClaimThrough(tracker, operation)
      })
      return WorkflowInterpreter.of({
        acquireTaskClaim,
        readTrackerGraph,
        readTaskWorkSpecification,
        reconcileTaskWorktree: (operation) => Effect.succeed(TaskWorktreeReconciliationSimulated.make({ operation })),
        recordTaskAttemptPlan: (operation) => Effect.succeed(TaskAttemptPlanRecordingSimulated.make({ operation }))
      })
    })
  )

export const deterministicTestWorkflowInterpreterLayer = makeLiveWorkflowInterpreterLayer("DeterministicTest").pipe(
  Layer.provide(controlledTrackerMutationLayer)
)

export const makeDryRunWorkflowInterpreterLayer = (): Layer.Layer<WorkflowInterpreter, never, TrackerGraphReader> =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const reader = yield* TrackerGraphReader
      return WorkflowInterpreter.of({
        acquireTaskClaim: (operation, onIntentRecorded: Effect.Effect<void> = Effect.void) =>
          onIntentRecorded.pipe(Effect.as(TaskClaimAcquisitionSimulated.make({ operation }))),
        readTrackerGraph: (operation) => reader.read(operation.target),
        readTaskWorkSpecification: (operation) => reader.readTaskWorkSpecification(operation.target, operation.taskId),
        reconcileTaskWorktree: (operation) => Effect.succeed(TaskWorktreeReconciliationSimulated.make({ operation })),
        recordTaskAttemptPlan: (operation) => Effect.succeed(TaskAttemptPlanRecordingSimulated.make({ operation }))
      })
    })
  )

export const dryRunWorkflowInterpreterLayer = Layer.merge(
  makeDryRunWorkflowInterpreterLayer(),
  emptyRunRecoveryActivationLayer.pipe(Layer.provide(controlledFakePlannedAttemptExecutorLayer))
)
