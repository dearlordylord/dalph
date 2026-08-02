import { NodeServices } from "@effect/platform-node"
import { type IntegrationTarget, PlannedAttemptExecutor, type RunId } from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  type JournaledRunBootstrap,
  type JournaledRuntimeLayerInput,
  type TrackerGraphReader,
  AuthoritativeTaskWorktreeReady,
  controlDirectionApplicationLayer,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedTrackerMutationLayer,
  type GitCommonDirectoryTarget,
  GitTargetLineage,
  GitWorktree,
  type JournalStoreError,
  journaledRunBootstrapLayer,
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
  validatedStartupRecoveryLayer,
  taskWorkCapacityControlLayer,
  taskClaimReacquisitionControlLayer,
  WorkflowInterpreter,
  WorkflowTrace
} from "@dalph/orchestrator"
import type { FileSystem } from "effect"
import { Effect, Layer } from "effect"
import { makeLiveWorkflowInterpreterLayer } from "./composition.js"

/**
 * Composes the production-shaped milestone with live tracker/Git boundaries
 * and one same-process coarse fake executor.
 */
type ProductionWorkflowLayer<TrackerError, TrackerRequirements> = Layer.Layer<
  JournaledRunBootstrap,
  | TrackerError
  | JournalStoreError
  | Layer.Error<typeof productionJournalStoreLayer>
  | Layer.Error<ReturnType<typeof productionCoordinatorOwnershipLayer>>,
  FileSystem.FileSystem | TrackerGraphReader | TrackerRequirements | WorkflowTrace
>

export const productionWorkflowInterpreterLayer = <TrackerError, TrackerRequirements>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  integrationTarget: IntegrationTarget,
  trackerMutationAdapterLayer: Layer.Layer<TrackerMutation, TrackerError, TrackerRequirements>
): ProductionWorkflowLayer<TrackerError, TrackerRequirements> => {
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
  const nonJournaledRuntimeInputs = Layer.merge(baseInterpreterLayer, controlledFakePlannedAttemptExecutorLayer)

  return Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const runtimeLayer = ({ runId: activeRunId, startup }: JournaledRuntimeLayerInput) => {
        const interpreterLayer = journaledWorkflowInterpreterLayer(
          activeRunId,
          Layer.succeed(WorkflowInterpreter, interpreter)
        )
        const operatorControlLayer = Layer.mergeAll(
          controlDirectionApplicationLayer,
          taskClaimReacquisitionControlLayer,
          taskWorkCapacityControlLayer
        )
        return validatedStartupRecoveryLayer(activeRunId, integrationTarget, startup).pipe(
          Layer.provide(interpreterLayer),
          Layer.provide(operatorControlLayer),
          Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace))
        )
      }
      return journaledRunBootstrapLayer(runId, runtimeLayer).pipe(
        Layer.provide(journalLayer),
        Layer.provide(ownershipLayer)
      )
    })
  ).pipe(Layer.provide(nonJournaledRuntimeInputs))
}
