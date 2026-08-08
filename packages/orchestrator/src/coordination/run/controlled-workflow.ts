import { PlannedAttemptExecutor, type RunId } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import { taskWorkCapacityControlLayer } from "../../control/task-work-capacity.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { controlDirectionApplicationLayer } from "../../workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { journaledRunBootstrapLayer, type JournaledRuntimeLayerInput } from "./journaled-run-bootstrap.js"
import { AllocatedFreshWorkflowRunId } from "./fresh-run-identity.js"
import { runWorkflow } from "./run.js"
import { validatedStartupRecoveryLayer } from "./startup-recovery.js"

const controlledOwnershipLayer = Layer.succeed(
  CoordinatorOwnership,
  /* v8 ignore next -- #167 owns controlled coordinator-lock behavior; #195 only installs the ordinary capability. */
  CoordinatorOwnership.of({ runMutation: (mutation) => mutation })
)

/** Installs an in-memory journal around otherwise ordinary workflow boundary implementations. */
const controlledJournaledRunLayer = (runId: RunId) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const runtimeLayer = ({ runId: activeRunId, startup }: JournaledRuntimeLayerInput) => {
        const controls = Layer.mergeAll(
          controlDirectionApplicationLayer,
          taskClaimReacquisitionControlLayer,
          taskWorkCapacityControlLayer
        )
        return validatedStartupRecoveryLayer(activeRunId, undefined, startup).pipe(
          Layer.provide(
            journaledWorkflowInterpreterLayer(activeRunId, Layer.succeed(WorkflowInterpreter, interpreter))
          ),
          Layer.provide(controls),
          Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace))
        )
      }
      return journaledRunBootstrapLayer(runId, runtimeLayer).pipe(
        Layer.provide(memoryJournalStoreLayer),
        Layer.provide(controlledOwnershipLayer)
      )
    })
  )

/** Selects controlled implementations only outside the ordinary public workflow. */
export const runControlledWorkflow = (
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy,
  runId: RunId
) =>
  runWorkflow(target, initialControlPolicy, AllocatedFreshWorkflowRunId.make(runId)).pipe(
    Effect.provide(controlledJournaledRunLayer(runId))
  )
