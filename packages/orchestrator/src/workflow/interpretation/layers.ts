// @effect-diagnostics lazyEffect:off
import { Effect, Layer } from "effect"
import { TrackerGraphReader } from "../../authorities/task-tracker/graph-reader.js"
import { controlledTrackerMutationLayer, TrackerMutation } from "../../authorities/task-tracker/claim-mutation.js"
import {
  GitWorktree,
  gitWorktreeTestLayer,
  PlannedWorktreeAbsent,
  runGitWorktreeReconciliation
} from "../../authorities/git/worktree.js"
import { GitTaskAttemptBase } from "../../authorities/git/task-attempt-base.js"
import { TaskAttemptBaseObservation } from "../protocols/task-attempt-planning/base.js"
import { GitTargetLineage } from "../../authorities/git/target-lineage.js"
import {
  acquireTaskClaimThrough,
  observePlannedAttemptWorktreeThrough,
  observeTargetLineageThrough,
  observeTaskClaimThrough,
  releaseTaskClaimThrough,
  WorkflowInterpreter
} from "./interpreter.js"
import { AuthoritativeTaskWorktreeReady } from "../protocols/worktree-reconciliation/protocol.js"
import { TaskAttemptPlanRecordAcknowledged } from "../protocols/task-attempt-planning/record.js"
import type { WorkflowOperation } from "../registry/operation.js"

/** Ordinary pre-executor workflow operations assembled from tracker and Git authority ports. */
export const workflowInterpreterLayer = Layer.effect(
  WorkflowInterpreter,
  Effect.gen(function* () {
    const reader = yield* TrackerGraphReader
    const tracker = yield* TrackerMutation
    const gitWorktree = yield* GitWorktree
    const gitTargetLineage = yield* GitTargetLineage
    const gitTaskAttemptBase = yield* GitTaskAttemptBase
    return WorkflowInterpreter.of({
      acquireTaskClaim: <IntentError = never>(
        operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
        onIntentRecorded: Effect.Effect<void, IntentError> = Effect.void
      ) => onIntentRecorded.pipe(Effect.andThen(acquireTaskClaimThrough(tracker, operation))),
      readTaskClaim: (operation) => observeTaskClaimThrough(tracker, operation),
      readTaskWorktree: (operation) => observePlannedAttemptWorktreeThrough(gitWorktree, operation),
      readTaskAttemptBase: (operation) => gitTaskAttemptBase.read(operation.policy),
      readTargetLineage: (operation) => observeTargetLineageThrough(gitTargetLineage, operation),
      readTrackerGraph: (operation) => reader.read(operation.target),
      readTaskWorkSpecification: (operation) => reader.readTaskWorkSpecification(operation.target, operation.taskId),
      releaseTaskClaim: (operation) => releaseTaskClaimThrough(tracker, operation),
      reconcileTaskWorktree: (operation) =>
        runGitWorktreeReconciliation(gitWorktree, operation.plannedAttempt).pipe(
          Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
        ),
      recordTaskAttemptPlan: (operation) =>
        Effect.succeed(TaskAttemptPlanRecordAcknowledged.make({ plannedAttempt: operation.plannedAttempt }))
    })
  })
)

export const controlledTargetLineageLayer = Layer.succeed(
  GitTargetLineage,
  GitTargetLineage.of({
    read: (plannedBaseSha) =>
      Effect.succeed({ plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha, targetHeadSha: plannedBaseSha })
  })
)

/** Controlled construction only accepts the explicitly recorded fixed Base. */
export const controlledTaskAttemptBaseLayer = Layer.succeed(
  GitTaskAttemptBase,
  GitTaskAttemptBase.of({
    read: (policy) =>
      Effect.succeed(
        policy._tag === "ExplicitFixedBase"
          ? TaskAttemptBaseObservation.cases.Qualified.make({ baseSha: policy.baseSha })
          : TaskAttemptBaseObservation.cases.Refused.make({
              boundary: "TargetHead",
              detail: "Qualified current-head policy requires a Git authority"
            })
      )
  })
)

/** Controlled authority implementations installed at program initialization. */
export const controlledWorkflowInterpreterLayer = workflowInterpreterLayer.pipe(
  Layer.provide(controlledTrackerMutationLayer),
  Layer.provide(gitWorktreeTestLayer(PlannedWorktreeAbsent.make({}))),
  Layer.provide(controlledTargetLineageLayer),
  Layer.provide(controlledTaskAttemptBaseLayer)
)

/** Stable controlled interpreter used by tests that provide only tracker reads. */
export const deterministicTestWorkflowInterpreterLayer = controlledWorkflowInterpreterLayer
