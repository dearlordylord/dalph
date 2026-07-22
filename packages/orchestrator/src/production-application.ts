import { Effect, Layer } from "effect"
import type { GitCommonDirectoryTarget, RunId } from "./domain.js"
import {
  journaledWorkflowInterpreterLayer,
  recoverTaskClaimAcquisitions,
  recoverTaskWorkSessionEstablishments
} from "./journaled-workflow-interpreter.js"
import {
  coordinatorOwnedTaskRunnerLayer,
  coordinatorOwnedTrackerMutationLayer,
  productionCoordinatorOwnershipLayer
} from "./live-task-work-start.js"
import { productionJournalStoreLayer } from "./sqlite-journal-store.js"
import type { TaskRunner } from "./task-work-start.js"
import type { TrackerMutation } from "./tracker-mutation.js"
import { trackerMutationWorkflowInterpreterLayer } from "./workflow-interpreters.js"
import { WorkflowInterpreter } from "./workflow.js"

/**
 * Composes one scoped production coordinator: OS ownership, configured SQLite,
 * the guarded task runner, and the recovering workflow interpreter.
 */
export const productionWorkflowInterpreterLayer = <
  RunnerError,
  RunnerRequirements,
  TrackerError,
  TrackerRequirements
>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
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
  const trackerMutationLayer = coordinatorOwnedTrackerMutationLayer(
    trackerMutationAdapterLayer
  ).pipe(Layer.provide(ownershipLayer))
  const journalLayer = productionJournalStoreLayer.pipe(
    Layer.provide(ownershipLayer)
  )
  const baseInterpreterLayer = trackerMutationWorkflowInterpreterLayer.pipe(
    Layer.provide(taskRunnerLayer),
    Layer.provide(trackerMutationLayer)
  )

  const interpreterLayer = journaledWorkflowInterpreterLayer(
    runId,
    baseInterpreterLayer
  ).pipe(
    Layer.provide(taskRunnerLayer),
    Layer.provide(journalLayer)
  )
  return Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      yield* recoverTaskClaimAcquisitions(runId)
      yield* recoverTaskWorkSessionEstablishments(runId)
      return interpreter
    })
  ).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(journalLayer)
  )
}
