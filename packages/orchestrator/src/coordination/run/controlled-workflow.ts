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
import { attemptChoiceControlLayer } from "../../workflow/protocols/attempt-choice/control.js"
import { OperationIdAllocator } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { journaledRunBootstrapLayer, type JournaledRuntimeLayerInput } from "./journaled-run-bootstrap.js"
import { AllocatedWorkflowRunId } from "./fresh-run-identity.js"
import { runWorkflow } from "./run.js"
import { validatedRunActivationLayer } from "./startup-recovery.js"
import { preservingDispositionCleanupBoundaryLayer } from "../../workflow/protocols/disposition-cleanup/boundaries.js"
import { ApplicationExitRequestBoundary, makeApplicationExitShell } from "../application-exit/application-shell.js"

const controlledOwnership = CoordinatorOwnership.of({
  /* v8 ignore next -- #167 owns controlled coordinator-lock behavior; #195 only installs the ordinary capability. */
  release: Effect.void,
  runMutation: (mutation) => mutation
})
const controlledOwnershipLayer = Layer.succeed(CoordinatorOwnership, controlledOwnership)

/** Installs an in-memory journal around otherwise ordinary workflow boundary implementations. */
const controlledJournaledRunLayer = (runId: RunId) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const operationIdAllocator = yield* OperationIdAllocator
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const applicationExit = yield* makeApplicationExitShell(controlledOwnership, { requestEnd: () => Effect.void })
      const runtimeLayer = ({ runId: activeRunId }: JournaledRuntimeLayerInput) => {
        const controls = Layer.mergeAll(
          attemptChoiceControlLayer,
          controlDirectionApplicationLayer,
          taskClaimReacquisitionControlLayer,
          taskWorkCapacityControlLayer
        )
        return validatedRunActivationLayer(
          activeRunId,
          undefined,
          undefined,
          undefined,
          undefined,
          preservingDispositionCleanupBoundaryLayer
        ).pipe(
          Layer.provide(
            journaledWorkflowInterpreterLayer(activeRunId, Layer.succeed(WorkflowInterpreter, interpreter))
          ),
          Layer.provide(controls),
          Layer.provide(Layer.succeed(OperationIdAllocator, operationIdAllocator)),
          Layer.provide(Layer.succeed(PlannedAttemptExecutor, executor)),
          Layer.provide(Layer.succeed(WorkflowTrace, trace))
        )
      }
      return Layer.merge(
        journaledRunBootstrapLayer(runId, runtimeLayer, applicationExit).pipe(
          Layer.provide(memoryJournalStoreLayer),
          Layer.provide(controlledOwnershipLayer)
        ),
        Layer.succeed(ApplicationExitRequestBoundary, applicationExit.requestBoundary)
      )
    })
  )

/** Selects controlled implementations only outside the ordinary public workflow. */
export const runControlledWorkflow = (
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy,
  runId: RunId
) =>
  runWorkflow(target, Effect.succeed(initialControlPolicy), AllocatedWorkflowRunId.make(runId)).pipe(
    Effect.provide(controlledJournaledRunLayer(runId))
  )
