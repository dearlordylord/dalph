import { NodeServices } from "@effect/platform-node"
import { type IntegrationTarget, PlannedAttemptExecutor, type RunId } from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  type JournaledRunBootstrap,
  type JournaledRuntimeLayerInput,
  type TrackerGraphReader,
  attemptChoiceControlLayer,
  controlDirectionApplicationLayer,
  coordinatorOwnedGitWorktreeLayer,
  coordinatorOwnedTrackerMutationLayer,
  type GitCommonDirectoryTarget,
  type JournalStoreError,
  journaledRunBootstrapLayer,
  journaledWorkflowInterpreterLayer,
  ApplicationExitRequestBoundary,
  CoordinatorOwnership,
  makeApplicationExitShell,
  nodeGitCommandLayer,
  nodeGitTargetLineageLayer,
  nodeGitWorktreeLayer,
  freshOperationIdAllocatorLayer,
  productionCoordinatorOwnershipLayer,
  productionJournalStoreLayer,
  type TrackerMutation,
  validatedRunActivationLayer,
  taskWorkCapacityControlLayer,
  taskClaimReacquisitionControlLayer,
  workflowInterpreterLayer,
  WorkflowInterpreter,
  WorkflowTrace,
  type TargetVerificationRuntimeInput,
  type TargetPromotionRuntimeInput,
  type CompletionClaimBoundaryService,
  type CompletionTaskBoundaryService
} from "@dalph/orchestrator"
import type { FileSystem } from "effect"
import { Crypto, Effect, Layer } from "effect"

/**
 * Composes the production-shaped milestone with live tracker/Git boundaries
 * and one same-process coarse fake executor.
 */
type ProductionWorkflowLayer<TrackerError, TrackerRequirements> = Layer.Layer<
  ApplicationExitRequestBoundary | JournaledRunBootstrap,
  | TrackerError
  | JournalStoreError
  | Layer.Error<typeof productionJournalStoreLayer>
  | Layer.Error<ReturnType<typeof productionCoordinatorOwnershipLayer>>,
  Crypto.Crypto | FileSystem.FileSystem | TrackerGraphReader | TrackerRequirements | WorkflowTrace
>

export const productionWorkflowInterpreterLayer = <TrackerError, TrackerRequirements>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  integrationTarget: IntegrationTarget,
  trackerMutationAdapterLayer: Layer.Layer<TrackerMutation, TrackerError, TrackerRequirements>,
  targetVerification?: TargetVerificationRuntimeInput,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinality?: CompletionClaimBoundaryService,
  completionTask?: CompletionTaskBoundaryService
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
  const baseInterpreterLayer = workflowInterpreterLayer.pipe(
    Layer.provide(trackerMutationLayer),
    Layer.provide(gitTargetLineageLayer),
    Layer.provide(gitWorktreeLayer)
  )
  const nonJournaledRuntimeInputs = Layer.merge(baseInterpreterLayer, controlledFakePlannedAttemptExecutorLayer)

  return Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const crypto = yield* Crypto.Crypto
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const ownership = yield* CoordinatorOwnership
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const runtimeLayer = ({ runId: activeRunId }: JournaledRuntimeLayerInput) => {
        const interpreterLayer = journaledWorkflowInterpreterLayer(
          activeRunId,
          Layer.succeed(WorkflowInterpreter, interpreter)
        )
        const operatorControlLayer = Layer.mergeAll(
          attemptChoiceControlLayer,
          controlDirectionApplicationLayer,
          taskClaimReacquisitionControlLayer,
          taskWorkCapacityControlLayer
        )
        return validatedRunActivationLayer(
          activeRunId,
          integrationTarget,
          undefined,
          undefined,
          targetVerification,
          targetPromotion,
          integrationFinality,
          completionTask
        ).pipe(
          Layer.provide(interpreterLayer),
          Layer.provide(operatorControlLayer),
          Layer.provide(freshOperationIdAllocatorLayer.pipe(Layer.provide(Layer.succeed(Crypto.Crypto, crypto)))),
          Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace))
        )
      }
      return Layer.merge(
        journaledRunBootstrapLayer(runId, runtimeLayer, applicationExit).pipe(Layer.provide(journalLayer)),
        Layer.succeed(ApplicationExitRequestBoundary, applicationExit.requestBoundary)
      )
    })
  ).pipe(Layer.provide(nonJournaledRuntimeInputs), Layer.provide(ownershipLayer))
}
