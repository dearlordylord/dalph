import { Effect, Layer } from "effect"
import type { GitCommonDirectoryTarget, RunId } from "./domain.js"
import {
  journaledWorkflowInterpreterLayer,
  recoverTaskWorkSessionEstablishments
} from "./journaled-workflow-interpreter.js"
import { coordinatorOwnedTaskRunnerLayer, productionCoordinatorOwnershipLayer } from "./live-task-work-start.js"
import { productionJournalStoreLayer } from "./sqlite-journal-store.js"
import type { TaskRunner } from "./task-work-start.js"
import { taskRunnerWorkflowInterpreterLayer } from "./workflow-interpreters.js"
import { WorkflowInterpreter } from "./workflow.js"

/**
 * Composes one scoped production coordinator: OS ownership, configured SQLite,
 * the guarded task runner, and the recovering workflow interpreter.
 */
export const productionWorkflowInterpreterLayer = <E, R>(
  runId: RunId,
  target: GitCommonDirectoryTarget,
  taskRunnerAdapterLayer: Layer.Layer<TaskRunner, E, R>
) => {
  const ownershipLayer = productionCoordinatorOwnershipLayer(target)
  const taskRunnerLayer = coordinatorOwnedTaskRunnerLayer(
    taskRunnerAdapterLayer
  ).pipe(Layer.provide(ownershipLayer))
  const journalLayer = productionJournalStoreLayer.pipe(
    Layer.provide(ownershipLayer)
  )
  const baseInterpreterLayer = taskRunnerWorkflowInterpreterLayer.pipe(
    Layer.provide(taskRunnerLayer)
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
      yield* recoverTaskWorkSessionEstablishments(runId)
      return interpreter
    })
  ).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(journalLayer)
  )
}
