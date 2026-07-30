// @effect-diagnostics lazyEffect:off
import { Effect, Layer } from "effect"
import { TaskAttemptPlanRecordingSimulated } from "../protocols/task-attempt-planning/record.js"
import { TrackerGraphReader } from "../../authorities/task-tracker/graph-reader.js"
import { controlledTrackerMutationLayer, TrackerMutation } from "../../authorities/task-tracker/claim-mutation.js"
import {
  acquireTaskClaimThrough,
  observeTaskClaimThrough,
  releaseTaskClaimThrough,
  TaskClaimAcquisitionSimulated,
  TaskClaimReleaseSimulated,
  TaskClaimObservationSimulated,
  PlannedAttemptWorktreeObservationSimulated,
  TargetLineageObservationSimulated,
  WorkflowInterpreter
} from "./interpreter.js"
import { TaskWorktreeReconciliationSimulated } from "../protocols/worktree-reconciliation/protocol.js"
import type { WorkflowOperation } from "../registry/operation.js"

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
      const readTaskClaim = Effect.fn(`WorkflowInterpreter.${operationPrefix}.readTaskClaim`)(function* (
        operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
      ) {
        return yield* observeTaskClaimThrough(tracker, operation)
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
      const releaseTaskClaim = Effect.fn(`WorkflowInterpreter.${operationPrefix}.releaseTaskClaim`)(function* (
        operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type
      ) {
        return yield* releaseTaskClaimThrough(tracker, operation)
      })
      return WorkflowInterpreter.of({
        acquireTaskClaim,
        readTaskClaim,
        readTaskWorktree: (operation) => Effect.succeed(PlannedAttemptWorktreeObservationSimulated.make({ operation })),
        /* v8 ignore next -- @preserve The simulated interpreter returns the selected operation without a Git boundary. */
        readTargetLineage: (operation) => Effect.succeed(TargetLineageObservationSimulated.make({ operation })),
        readTrackerGraph,
        readTaskWorkSpecification,
        releaseTaskClaim,
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
        readTaskClaim: (operation) => Effect.succeed(TaskClaimObservationSimulated.make({ operation })),
        readTaskWorktree: (operation) => Effect.succeed(PlannedAttemptWorktreeObservationSimulated.make({ operation })),
        /* v8 ignore next -- @preserve Dry-run records the selected target-lineage operation without observing Git. */
        readTargetLineage: (operation) => Effect.succeed(TargetLineageObservationSimulated.make({ operation })),
        readTrackerGraph: (operation) => reader.read(operation.target),
        readTaskWorkSpecification: (operation) => reader.readTaskWorkSpecification(operation.target, operation.taskId),
        releaseTaskClaim: (operation) => Effect.succeed(TaskClaimReleaseSimulated.make({ release: operation.release })),
        reconcileTaskWorktree: (operation) => Effect.succeed(TaskWorktreeReconciliationSimulated.make({ operation })),
        recordTaskAttemptPlan: (operation) => Effect.succeed(TaskAttemptPlanRecordingSimulated.make({ operation }))
      })
    })
  )
