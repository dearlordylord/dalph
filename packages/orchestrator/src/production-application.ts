/* eslint-disable functional/immutable-data -- Startup collects preserved run issues before failing closed. */
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import { CoordinatorOwnership } from "./coordinator-lock.js"
import { EvidenceStoreLocator, type GitCommonDirectoryTarget, type RunId } from "./domain.js"
import { nodeGitCommandLayer } from "./git-command.js"
import { GitWorktree, runGitWorktreeReconciliation } from "./git-worktree.js"
import { nodeImplementationEvidenceSourceLayer } from "./implementation-evidence.js"
import type { ImplementationReviewer, ReviewFindingsHandback } from "./implementation-review.js"
import { unavailableImplementationReviewLayer } from "./implementation-review.js"
import { JournalBoundaryDecodeIssue } from "./journal-recovery-model.js"
import { JournalStore } from "./journal-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"
import {
  coordinatorOwnedEvidenceStoreLayer,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedImplementationReviewLayer,
  coordinatorOwnedTaskExecutorLayer,
  coordinatorOwnedTaskRunnerLayer,
  coordinatorOwnedTrackerMutationLayer,
  productionCoordinatorOwnershipLayer
} from "./live-task-work-start.js"
import { ManagedHistoryIdentityIssue, ManagedHistorySemanticIssue, reduceManagedHistory } from "./managed-history.js"
import { nodeEvidenceStoreLayer } from "./node-evidence-store.js"
import { nodeGitWorktreeLayer } from "./node-git-worktree.js"
import { productionJournalStoreLayer } from "./sqlite-journal-store.js"
import type { TaskExecutor } from "./task-execution.js"
import type { TaskRunner } from "./task-work-start.js"
import type { TrackerMutation } from "./tracker-mutation.js"
import { makeTaskRunnerWorkflowInterpreterLayer } from "./workflow-interpreters.js"
import {
  observeManagedRunAuthorities,
  recoverExactRunAfterCoordinatorDeath,
  RecoveryOwnershipIssue,
  RecoveryProgressIssue,
  RecoveryReconciliationIssue
} from "./workflow-recovery.js"
import { RecoveryTaskEligibilityIssue } from "./workflow-stage-recovery.js"
import { AuthoritativeTaskWorktreeReady, WorkflowInterpreter } from "./workflow.js"

/** Startup found preserved history or resources that cannot be resumed safely. */
export const StartupRecoveryIssue = Schema.Union([
  JournalBoundaryDecodeIssue,
  ManagedHistoryIdentityIssue,
  ManagedHistorySemanticIssue,
  RecoveryOwnershipIssue,
  RecoveryProgressIssue,
  RecoveryTaskEligibilityIssue,
  RecoveryReconciliationIssue
])
export type StartupRecoveryIssue = typeof StartupRecoveryIssue.Type

export class StartupRecoveryBlocked extends Schema.TaggedErrorClass<StartupRecoveryBlocked>()(
  "StartupRecoveryBlocked",
  { issues: Schema.Array(StartupRecoveryIssue) }
) {}

/**
 * Composes one scoped production coordinator: OS ownership, configured SQLite,
 * the guarded task runner, and the recovering workflow interpreter.
 */
export const productionWorkflowInterpreterLayer = <
  ExecutorError,
  ExecutorRequirements,
  RunnerError,
  RunnerRequirements,
  TrackerError,
  TrackerRequirements,
  ReviewError = never,
  ReviewRequirements = never
>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  taskExecutorAdapterLayer: Layer.Layer<TaskExecutor, ExecutorError, ExecutorRequirements>,
  taskRunnerAdapterLayer: Layer.Layer<TaskRunner, RunnerError, RunnerRequirements>,
  trackerMutationAdapterLayer: Layer.Layer<
    TrackerMutation,
    TrackerError,
    TrackerRequirements
  >,
  reviewAdapterLayer?: Layer.Layer<
    ImplementationReviewer | ReviewFindingsHandback,
    ReviewError,
    ReviewRequirements
  >
) => {
  const ownershipLayer = productionCoordinatorOwnershipLayer(target)
  const taskRunnerLayer = coordinatorOwnedTaskRunnerLayer(
    taskRunnerAdapterLayer
  ).pipe(Layer.provide(ownershipLayer))
  const taskExecutorLayer = coordinatorOwnedTaskExecutorLayer(
    taskExecutorAdapterLayer
  ).pipe(Layer.provide(ownershipLayer))
  const trackerMutationLayer = coordinatorOwnedTrackerMutationLayer(
    trackerMutationAdapterLayer
  ).pipe(Layer.provide(ownershipLayer))
  const gitWorktreeLayer = coordinatorOwnedGitWorktreeLayer(
    nodeGitWorktreeLayer(target).pipe(
      Layer.provide(nodeGitCommandLayer),
      Layer.provide(NodeServices.layer)
    )
  ).pipe(Layer.provide(ownershipLayer))
  const journalLayer = productionJournalStoreLayer.pipe(
    Layer.provide(ownershipLayer)
  )
  const evidenceStoreLayer = coordinatorOwnedEvidenceStoreLayer(
    nodeEvidenceStoreLayer(
      EvidenceStoreLocator.make(`${target}/dalph-evidence`)
    ).pipe(Layer.provide(NodeServices.layer))
  ).pipe(Layer.provide(ownershipLayer))
  const evidenceSourceLayer = nodeImplementationEvidenceSourceLayer().pipe(
    Layer.provide(nodeGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const reviewLayer = coordinatorOwnedImplementationReviewLayer(
    reviewAdapterLayer ?? unavailableImplementationReviewLayer
  ).pipe(Layer.provide(ownershipLayer))
  const taskRunnerInterpreterLayer = makeTaskRunnerWorkflowInterpreterLayer(
    "TaskRunner"
  ).pipe(
    Layer.provide(taskRunnerLayer),
    Layer.provide(taskExecutorLayer),
    Layer.provide(trackerMutationLayer)
  )
  const baseInterpreterLayer = Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const gitWorktree = yield* GitWorktree
      const reconcileTaskWorktree = Effect.fn(
        "WorkflowInterpreter.ProductionBase.reconcileTaskWorktree"
      )(function*(operation) {
        const proof = yield* runGitWorktreeReconciliation(
          gitWorktree,
          operation.plannedAttempt
        )
        return AuthoritativeTaskWorktreeReady.make({ proof })
      })
      return WorkflowInterpreter.of({
        ...interpreter,
        reconcileTaskWorktree
      })
    })
  ).pipe(
    Layer.provide(taskRunnerInterpreterLayer),
    Layer.provide(gitWorktreeLayer)
  )

  const interpreterLayerFor = (journalRunId: RunId) =>
    journaledWorkflowInterpreterLayer(
      journalRunId,
      baseInterpreterLayer,
      taskExecutorLayer,
      Layer.merge(evidenceStoreLayer, evidenceSourceLayer),
      reviewLayer
    ).pipe(
      Layer.provide(taskRunnerLayer),
      Layer.provide(journalLayer)
    )
  const interpreterLayer = interpreterLayerFor(runId)
  const recoveryAuthorityLayer = Layer.mergeAll(
    taskRunnerLayer,
    taskExecutorLayer,
    trackerMutationLayer,
    gitWorktreeLayer,
    evidenceStoreLayer
  )
  return Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      yield* CoordinatorOwnership
      const journal = yield* JournalStore
      const interpreter = yield* WorkflowInterpreter
      const scan = yield* journal.scan()
      const issues = new Array<StartupRecoveryIssue>(...scan.issues)
      for (const history of scan.runs) {
        const reduction = reduceManagedHistory(history.runId, history.records)
        if (reduction._tag === "InvalidManagedHistory") issues.push(...reduction.issues)
        const observationIssues = yield* observeManagedRunAuthorities(
          history.runId,
          history.records
        )
        issues.push(...observationIssues)
        if (
          reduction._tag === "InvalidManagedHistory"
          || observationIssues.length > 0
          || scan.issues.some((issue) => issue.runId === history.runId)
        ) continue
        const runIssues = yield* recoverExactRunAfterCoordinatorDeath(
          history.runId,
          history.records
        ).pipe(Effect.provide(interpreterLayerFor(history.runId)))
        issues.push(...runIssues)
      }
      if (issues.length > 0) return yield* new StartupRecoveryBlocked({ issues })
      return interpreter
    })
  ).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(recoveryAuthorityLayer),
    Layer.provide(journalLayer),
    Layer.provide(ownershipLayer)
  )
}
