import { PlannedAttemptExecutor, type RunId } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { InitialControlPolicy } from "../../control/policy.js"
import { taskWorkCapacityControlLayer } from "../../control/task-work-capacity.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { journaledImplicitCoverageTrackerGraphInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { controlDirectionApplicationLayer } from "../../workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { journaledRunBootstrapLayer, type JournaledRuntimeLayerInput } from "./journaled-run-bootstrap.js"
import { runSyntheticWorkflowWithBootstrap } from "./run.js"
import { validatedStartupRecoveryLayer } from "./startup-recovery.js"

const syntheticOwnershipLayer = Layer.succeed(
  CoordinatorOwnership,
  CoordinatorOwnership.of({ runMutation: (mutation) => mutation })
)

/** Ephemeral lifecycle and protocol services beneath the non-durable relation. */
const syntheticJournaledRunLayer = (runId: RunId) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const runtimeLayer = ({ runId: activeRunId, startup }: JournaledRuntimeLayerInput) => {
        const implicitCoverageGraphJournaledInterpreter = journaledImplicitCoverageTrackerGraphInterpreterLayer(
          activeRunId,
          Layer.succeed(WorkflowInterpreter, interpreter)
        )
        const controls = Layer.mergeAll(
          controlDirectionApplicationLayer,
          taskClaimReacquisitionControlLayer,
          taskWorkCapacityControlLayer
        )
        return validatedStartupRecoveryLayer(activeRunId, undefined, startup).pipe(
          Layer.provide(implicitCoverageGraphJournaledInterpreter),
          Layer.provide(controls),
          Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace))
        )
      }
      return journaledRunBootstrapLayer(runId, runtimeLayer).pipe(
        Layer.provide(memoryJournalStoreLayer),
        Layer.provide(syntheticOwnershipLayer)
      )
    })
  )

/** Explicit non-durable interpretation of the same public delivery program. */
export const runSyntheticWorkflow = (target: TrackerTarget, initialControlPolicy: InitialControlPolicy, runId: RunId) =>
  runSyntheticWorkflowWithBootstrap(target, initialControlPolicy, runId).pipe(
    Effect.provide(syntheticJournaledRunLayer(runId))
  )
