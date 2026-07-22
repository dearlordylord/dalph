import { NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { EvidenceStoreLocator, type GitCommonDirectoryTarget, type RunId } from "./domain.js"
import { nodeGitCommandLayer } from "./git-command.js"
import { nodeImplementationEvidenceSourceLayer } from "./implementation-evidence.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"
import {
  coordinatorOwnedEvidenceStoreLayer,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedTaskExecutorLayer,
  coordinatorOwnedTaskRunnerLayer,
  coordinatorOwnedTrackerMutationLayer,
  productionCoordinatorOwnershipLayer
} from "./live-task-work-start.js"
import { nodeEvidenceStoreLayer } from "./node-evidence-store.js"
import { nodeGitWorktreeLayer } from "./node-git-worktree.js"
import { productionJournalStoreLayer } from "./sqlite-journal-store.js"
import type { TaskExecutor } from "./task-execution.js"
import type { TaskRunner } from "./task-work-start.js"
import type { TrackerMutation } from "./tracker-mutation.js"
import { trackerMutationWorkflowInterpreterLayer } from "./workflow-interpreters.js"
import {
  recoverImplementationEvidenceSealings,
  recoverTaskClaimAcquisitions,
  recoverTaskExecutions,
  recoverTaskWorkSessionEstablishments,
  recoverTaskWorktreeReconciliations
} from "./workflow-recovery.js"
import { WorkflowInterpreter } from "./workflow.js"

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
  TrackerRequirements
>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  taskExecutorAdapterLayer: Layer.Layer<TaskExecutor, ExecutorError, ExecutorRequirements>,
  taskRunnerAdapterLayer: Layer.Layer<TaskRunner, RunnerError, RunnerRequirements>,
  trackerMutationAdapterLayer: Layer.Layer<
    TrackerMutation,
    TrackerError,
    TrackerRequirements
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
  const baseInterpreterLayer = trackerMutationWorkflowInterpreterLayer.pipe(
    Layer.provide(taskRunnerLayer),
    Layer.provide(taskExecutorLayer),
    Layer.provide(gitWorktreeLayer),
    Layer.provide(trackerMutationLayer)
  )

  const interpreterLayer = journaledWorkflowInterpreterLayer(
    runId,
    baseInterpreterLayer,
    taskExecutorLayer,
    Layer.merge(evidenceStoreLayer, evidenceSourceLayer)
  ).pipe(
    Layer.provide(taskRunnerLayer),
    Layer.provide(journalLayer)
  )
  return Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      yield* recoverTaskClaimAcquisitions(runId)
      yield* recoverTaskWorktreeReconciliations(runId)
      yield* recoverTaskWorkSessionEstablishments(runId)
      yield* recoverTaskExecutions(runId)
      yield* recoverImplementationEvidenceSealings(runId)
      return interpreter
    })
  ).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(journalLayer)
  )
}
