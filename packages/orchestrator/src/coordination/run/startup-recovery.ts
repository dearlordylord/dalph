import { type IntegrationTarget, PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { JournalBoundaryDecodeIssue } from "../../workflow-journal/recovery-model.js"
import { InRunJournal, type RunLifecycleJournalService } from "../../workflow-journal/store.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { AttemptChoiceControl } from "../../workflow/protocols/attempt-choice/control.js"
import {
  makePlannedAttemptProtocolController,
  PlannedAttemptProtocolController
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { OperationIdAllocator } from "../../workflow/protocols/task-attempt-planning/plan.js"
import {
  hasUnfinishedRunResponsibility,
  makeRunRecoveryProjection,
  RunRecoveryProjection
} from "./recovery-activation.js"
import { Integrator, IntegratorGit } from "../../workflow/protocols/integrator/protocol.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  DuplicateUnfinishedTaskAttemptIssue,
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue
} from "../reconstruction/history-result.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { IntegrationTargetSelection } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  DeliveryRuntimeResourceCapabilityPair,
  DeliveryRuntimeResources,
  deliveryRuntimeResourceCapabilitiesOf
} from "../delivery/delivery-runtime-resources.js"
import { DeliveryRuntimeObservationPublication } from "../delivery/delivery-runtime-observation.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { EvidenceStore, type EvidenceStoreService } from "../../workflow/protocols/evidence-store.js"
import {
  TargetPromotionRuntime,
  type TargetPromotionRuntimeInput
} from "../../workflow/protocols/target-promotion/runtime.js"
import {
  CompletionClaimBoundary,
  type CompletionClaimBoundaryService,
  CompletionTaskBoundary,
  type CompletionTaskBoundaryService
} from "../../workflow/protocols/integration-finality/events.js"
import { ApplicationExitAdmission } from "../application-exit/lifecycle.js"
import {
  DispositionCleanupActivation,
  activateDispositionCleanup
} from "../../workflow/protocols/disposition-cleanup/loop.js"

export const StartupRecoveryIssue = Schema.Union([
  DuplicateUnfinishedTaskAttemptIssue,
  JournalBoundaryDecodeIssue,
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue,
  Schema.TaggedStruct("OtherUnfinishedRunIssue", { requestedRunId: RunId, unfinishedRunId: RunId })
])
export type StartupRecoveryIssue = typeof StartupRecoveryIssue.Type

/** Run establishment found preserved history that cannot be reconstructed safely. */
export class StartupRecoveryBlocked extends Schema.TaggedError<StartupRecoveryBlocked>()("StartupRecoveryBlocked", {
  issues: Schema.Array(StartupRecoveryIssue)
}) {}

const runBeganWithoutTermination = (
  reduction: Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { readonly _tag: "ValidWorkflowJournalHistory" }>
): boolean =>
  reduction.records.some(({ event }) => event._tag === "WorkflowRunBegan") &&
  !reduction.records.some(({ event }) => event._tag === "WorkflowRunTerminated")

/** Validates all preserved Runs and selects the requested Run without constructing an appending service. */
export const inspectStartupRecovery = Effect.fn("StartupRecovery.inspect")(function* (
  runId: RunId,
  journal: RunLifecycleJournalService
) {
  const scan = yield* journal.scan()
  const reductions = scan.runs.map((history) => reduceWorkflowJournalHistory(history.runId, history.records))
  const issues = [
    ...scan.issues,
    ...reductions.flatMap((reduction) => (reduction._tag === "InvalidWorkflowJournalHistory" ? reduction.issues : []))
  ]
  if (issues.length > 0) return yield* new StartupRecoveryBlocked({ issues })
  const otherUnfinishedRuns = reductions.filter(
    (reduction) =>
      reduction._tag === "ValidWorkflowJournalHistory" &&
      reduction.runId !== runId &&
      (runBeganWithoutTermination(reduction) || hasUnfinishedRunResponsibility(reduction.runState))
  )
  if (otherUnfinishedRuns.length > 0) {
    return yield* new StartupRecoveryBlocked({
      issues: otherUnfinishedRuns.map((unfinished) => ({
        _tag: "OtherUnfinishedRunIssue" as const,
        requestedRunId: runId,
        unfinishedRunId: unfinished.runId
      }))
    })
  }
  return reductions.find((reduction) => reduction._tag === "ValidWorkflowJournalHistory" && reduction.runId === runId)
})

interface RunActivationContextInput {
  readonly runId: RunId
  readonly integrationTarget: IntegrationTarget | undefined
  readonly targetPromotion: TargetPromotionRuntimeInput | undefined
  readonly integrationFinality: CompletionClaimBoundaryService | undefined
  readonly completionTask: CompletionTaskBoundaryService | undefined
  readonly acceptedResultEvidenceStore: EvidenceStoreService | undefined
}

const makeRunActivationContext = Effect.fn("RunActivation.makeContext")(function* ({
  acceptedResultEvidenceStore,
  completionTask,
  integrationFinality,
  integrationTarget,
  runId,
  targetPromotion
}: RunActivationContextInput) {
  const ownership = yield* CoordinatorOwnership
  const inRunJournal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const executor = yield* PlannedAttemptExecutor
  const operationIdAllocator = yield* OperationIdAllocator
  const trace = yield* WorkflowTrace
  const taskWorkCapacityControl = yield* TaskWorkCapacityControl
  const controlDirectionApplication = yield* ControlDirectionApplication
  const taskClaimReacquisitionControl = yield* TaskClaimReacquisitionControl
  const attemptChoiceControl = yield* AttemptChoiceControl
  const plannedAttemptProtocolController = yield* makePlannedAttemptProtocolController()
  const ambient = yield* Effect.context<never>()
  const integrator = Context.getOption(ambient, Integrator)
  const integratorGit = Context.getOption(ambient, IntegratorGit)
  const ambientRuntimeCapabilities = Context.getOption(ambient, DeliveryRuntimeResourceCapabilityPair)
  /* v8 ignore start -- @preserve Production bootstrap always supplies the process-owned capability pair; the fallback only keeps isolated validated-activation adapters self-contained, while the pair factory and close behavior have focused tests. */
  const runtimeCapabilityOwnership = Option.isSome(ambientRuntimeCapabilities)
    ? { ownedByActivation: false as const, value: ambientRuntimeCapabilities.value }
    : yield* deliveryRuntimeResourceCapabilitiesOf(
        yield* makeIntegrationTargetResourceController(),
        yield* ApplicationExitAdmission
      ).pipe(Effect.map((value) => ({ ownedByActivation: true as const, value })))
  const runtimeResources = DeliveryRuntimeResources.of(runtimeCapabilityOwnership.value.resources)
  const observationPublication = DeliveryRuntimeObservationPublication.of(runtimeCapabilityOwnership.value.observation)
  if (runtimeCapabilityOwnership.ownedByActivation) yield* Effect.addFinalizer(() => observationPublication.close)
  /* v8 ignore stop -- @preserve */
  const integrationResources = runtimeResources.integrationTargets
  const recovery = yield* makeRunRecoveryProjection(
    runId,
    integrationTarget,
    integrationResources,
    targetPromotion,
    integrationFinality !== undefined,
    completionTask !== undefined
  )
  // Ordinary activation reconstructs cleanup authority from the exact Run
  // journal before the caller receives its workflow context.  No caller-made
  // resource candidate is admitted at this boundary; the composed cleanup
  // loop consumes this validated set (and family protocols revalidate it).
  const cleanupResponsibilities = yield* activateDispositionCleanup(runId)
  const evidenceStore = acceptedResultEvidenceStore
  const requiredContext = Context.empty().pipe(
    Context.add(WorkflowInterpreter, interpreter),
    Context.add(RunRecoveryProjection, recovery),
    Context.add(OperationIdAllocator, operationIdAllocator),
    Context.add(PlannedAttemptExecutor, executor),
    Context.add(InRunJournal, inRunJournal),
    Context.add(AttemptChoiceControl, attemptChoiceControl),
    Context.add(PlannedAttemptProtocolController, plannedAttemptProtocolController),
    Context.add(ControlDirectionApplication, controlDirectionApplication),
    Context.add(TaskWorkCapacityControl, taskWorkCapacityControl),
    Context.add(TaskClaimReacquisitionControl, taskClaimReacquisitionControl),
    Context.add(WorkflowTrace, trace),
    Context.add(CoordinatorOwnership, ownership),
    Context.add(
      DispositionCleanupActivation,
      DispositionCleanupActivation.of({ responsibilities: cleanupResponsibilities })
    )
  )
  const optionalContext = Context.empty().pipe(
    Context.add(DeliveryRuntimeResources, runtimeResources),
    Context.add(DeliveryRuntimeObservationPublication, observationPublication),
    Context.addOrOmit(Integrator, integrator),
    Context.addOrOmit(IntegratorGit, integratorGit),
    Context.addOrOmit(EvidenceStore, Option.fromUndefinedOr(evidenceStore).pipe(Option.map(EvidenceStore.of))),
    Context.addOrOmit(
      TargetPromotionRuntime,
      Option.fromUndefinedOr(targetPromotion).pipe(Option.map(TargetPromotionRuntime.of))
    ),
    Context.addOrOmit(
      CompletionClaimBoundary,
      Option.fromUndefinedOr(integrationFinality).pipe(Option.map(CompletionClaimBoundary.of))
    ),
    Context.addOrOmit(
      CompletionTaskBoundary,
      Option.fromUndefinedOr(completionTask).pipe(Option.map(CompletionTaskBoundary.of))
    ),
    Context.addOrOmit(IntegrationTargetSelection, Option.fromUndefinedOr(integrationTarget))
  )
  return Context.merge(requiredContext, optionalContext)
})

/** Builds ordinary in-Run services after bootstrap has already validated the complete accepted prefix. */
export const validatedRunActivationLayer = (
  runId: RunId,
  integrationTarget: IntegrationTarget | undefined,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinality?: CompletionClaimBoundaryService,
  completionTask?: CompletionTaskBoundaryService,
  acceptedResultEvidenceStore?: EvidenceStoreService
) =>
  Layer.effectContext(
    makeRunActivationContext({
      runId,
      integrationTarget,
      targetPromotion,
      integrationFinality,
      completionTask,
      acceptedResultEvidenceStore
    })
  )
