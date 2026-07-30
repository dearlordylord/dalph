import { NodeServices } from "@effect/platform-node"
import { type IntegrationTarget, type RunId } from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  AuthoritativeTaskWorktreeReady,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedTrackerMutationLayer,
  type GitCommonDirectoryTarget,
  GitTargetLineage,
  GitWorktree,
  journaledWorkflowInterpreterLayer,
  nodeGitCommandLayer,
  nodeGitTargetLineageLayer,
  nodeGitWorktreeLayer,
  observePlannedAttemptWorktreeThrough,
  observeTargetLineageThrough,
  productionCoordinatorOwnershipLayer,
  productionJournalStoreLayer,
  runGitWorktreeReconciliation,
  type TrackerMutation,
  startupRecoveryLayer,
  taskWorkCapacityControlLayer,
  WorkflowInterpreter
} from "@dalph/orchestrator"
import { Effect, Layer } from "effect"
import { makeLiveWorkflowInterpreterLayer } from "./composition.js"

/**
 * Composes the production-shaped milestone with live tracker/Git boundaries
 * and one same-process coarse fake executor.
 */
export const productionWorkflowInterpreterLayer = <TrackerError, TrackerRequirements>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  integrationTarget: IntegrationTarget,
  trackerMutationAdapterLayer: Layer.Layer<TrackerMutation, TrackerError, TrackerRequirements>
) => {
  const ownershipLayer = productionCoordinatorOwnershipLayer(target)
  const trackerMutationLayer = coordinatorOwnedTrackerMutationLayer(trackerMutationAdapterLayer).pipe(
    Layer.provide(ownershipLayer)
  )
  const gitWorktreeLayer = coordinatorOwnedGitWorktreeLayer(
    nodeGitWorktreeLayer(target).pipe(Layer.provide(nodeGitCommandLayer), Layer.provide(NodeServices.layer))
  ).pipe(Layer.provide(ownershipLayer))
  const gitTargetLineageLayer = nodeGitTargetLineageLayer.pipe(
    Layer.provide(nodeGitCommandLayer),
    Layer.provide(NodeServices.layer)
  )
  const journalLayer = productionJournalStoreLayer.pipe(Layer.provide(ownershipLayer))
  const liveInterpreterLayer = makeLiveWorkflowInterpreterLayer("ProductionBase").pipe(
    Layer.provide(trackerMutationLayer)
  )
  const baseInterpreterLayer = Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const gitTargetLineage = yield* GitTargetLineage
      const gitWorktree = yield* GitWorktree
      return WorkflowInterpreter.of({
        ...interpreter,
        readTaskWorktree: (operation) => observePlannedAttemptWorktreeThrough(gitWorktree, operation),
        /* v8 ignore next -- @preserve Production target-lineage recovery is exercised through the identical authored composition. */
        readTargetLineage: (operation) => observeTargetLineageThrough(gitTargetLineage, operation),
        reconcileTaskWorktree: (operation) =>
          runGitWorktreeReconciliation(gitWorktree, operation.plannedAttempt).pipe(
            Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
          )
      })
    })
  ).pipe(Layer.provide(liveInterpreterLayer), Layer.provide(gitTargetLineageLayer), Layer.provide(gitWorktreeLayer))
  const interpreterLayer = journaledWorkflowInterpreterLayer(runId, baseInterpreterLayer).pipe(
    Layer.provide(journalLayer)
  )
  const controlPolicyLayer = taskWorkCapacityControlLayer.pipe(Layer.provide(journalLayer))

  return startupRecoveryLayer(runId, integrationTarget).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(controlPolicyLayer),
    Layer.provide(controlledFakePlannedAttemptExecutorLayer),
    Layer.provide(journalLayer),
    Layer.provide(ownershipLayer)
  )
}
