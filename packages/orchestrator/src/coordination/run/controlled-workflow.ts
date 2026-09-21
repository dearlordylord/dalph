import {
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget,
  type RunId
} from "@dalph/contracts"
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
import { attemptChoiceControlWithProvidedProtocolLayer } from "../../workflow/protocols/attempt-choice/control.js"
import { OperationIdAllocator } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { journaledRunBootstrapLayer, type JournaledRuntimeLayerInput } from "./journaled-run-bootstrap.js"
import { AllocatedWorkflowRunId } from "./fresh-run-identity.js"
import { runWorkflow } from "./run.js"
import { validatedRunActivationLayer } from "./startup-recovery.js"
import { preservingDispositionCleanupBoundaryLayer } from "../../workflow/protocols/disposition-cleanup/boundaries.js"
import { ApplicationExitRequestBoundary, makeApplicationExitShell } from "../application-exit/application-shell.js"
import { defaultJournalMaintenanceObservation } from "../../workflow-journal/maintenance.js"
import {
  RemotePublicationAdmissionObservation,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushResult
} from "../../workflow/protocols/direct-publication/events.js"
import {
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineObservation
} from "../../workflow/protocols/direct-publication/baseline-events.js"

const controlledOwnership = CoordinatorOwnership.of({
  /* v8 ignore next -- #167 owns controlled coordinator-lock behavior; #195 only installs the ordinary capability. */
  release: Effect.void,
  runMutation: (mutation) => mutation
})
const controlledOwnershipLayer = Layer.succeed(CoordinatorOwnership, controlledOwnership)
const controlledRemotePublicationTarget = RemotePublicationTarget.make({
  branch: RemotePublicationBranchRef.make("refs/heads/controlled"),
  endpoint: RemotePublicationEndpoint.make("file:///controlled/remote.git")
})
const gitShaHexLength = 40
const controlledRemotePublicationLayer = Layer.succeed(
  RemotePublicationGit,
  RemotePublicationGit.of({
    admit: () =>
      Effect.succeed(
        RemotePublicationAdmissionObservation.cases.ExistingBranch.make({
          remoteHead: GitCommitSha.make("0".repeat(gitShaHexLength))
        })
      ),
    observe: ({ candidateCommit }) =>
      Effect.succeed(RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead: candidateCommit })),
    prepareSenderCustody: () => Effect.void,
    reconcileSenderCustody: () => Effect.void,
    push: ({ candidateCommit }) =>
      Effect.succeed(RemotePublicationPushResult.cases.UpToDate.make({ remoteHead: candidateCommit }))
  })
)
const controlledRemoteBaselineLayer = Layer.succeed(
  RemoteBaselineGit,
  RemoteBaselineGit.of({
    catchUp: (_correlation, _expectedLocalHead, remoteHead) =>
      Effect.succeed(LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead })),
    observe: (correlation) => {
      const head = correlation.responsibility.plannedAttempt.baseSha
      return Effect.succeed(RemoteBaselineObservation.cases.Aligned.make({ localHead: head, remoteHead: head }))
    },
    reconcileCatchUp: (_correlation, _expectedLocalHead, remoteHead) =>
      Effect.succeed(LocalTargetCatchUpResult.cases.AlreadyCurrent.make({ currentHead: remoteHead }))
  })
)

/** Installs an in-memory journal around otherwise ordinary workflow boundary implementations. */
const controlledJournaledRunLayer = (runId: RunId) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const operationIdAllocator = yield* OperationIdAllocator
      const executor = yield* PlannedAttemptExecutor
      const lifecycleObservation = yield* PlannedAttemptExecutorLifecycleObservation
      const trace = yield* WorkflowTrace
      const applicationExit = yield* makeApplicationExitShell(controlledOwnership, { requestEnd: () => Effect.void })
      const runtimeLayer = ({ opportunity, runId: activeRunId }: JournaledRuntimeLayerInput) => {
        const controls = Layer.mergeAll(
          attemptChoiceControlWithProvidedProtocolLayer,
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
          preservingDispositionCleanupBoundaryLayer,
          undefined,
          true,
          opportunity
        ).pipe(
          Layer.provide(controlledRemoteBaselineLayer),
          Layer.provideMerge(controlledRemotePublicationLayer),
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
        journaledRunBootstrapLayer(
          runId,
          runtimeLayer,
          applicationExit,
          defaultJournalMaintenanceObservation,
          undefined,
          controlledRemotePublicationTarget
        ).pipe(
          Layer.provide(memoryJournalStoreLayer),
          Layer.provide(controlledOwnershipLayer),
          Layer.provide(Layer.succeed(PlannedAttemptExecutorLifecycleObservation, lifecycleObservation))
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
