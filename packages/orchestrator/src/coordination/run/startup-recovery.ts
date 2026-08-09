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
  makeJournaledFreshRunRecoveryProjection,
  makeRunRecoveryProjection,
  RunRecoveryProjection
} from "./recovery-activation.js"
import {
  type CandidateContinuationLimit,
  type CandidateCorrectionLimit,
  IntegrationCandidateAgent,
  IntegrationCandidateGit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  DuplicateUnfinishedTaskAttemptIssue,
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue
} from "../reconstruction/history-result.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { IntegrationTargetSelection } from "../../workflow/protocols/integration-admission/protocol.js"
import { DeliveryRuntimeResources, deliveryRuntimeResourcesOf } from "../delivery/delivery-runtime-resources.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import {
  TargetVerificationRuntime,
  type TargetVerificationRuntimeInput
} from "../../workflow/protocols/target-verification/runtime.js"
import {
  TargetPromotionRuntime,
  type TargetPromotionRuntimeInput
} from "../../workflow/protocols/target-promotion/runtime.js"
import {
  CompletionClaimBoundary,
  type CompletionClaimBoundaryService
} from "../../workflow/protocols/integration-finality/events.js"

export const StartupRecoveryIssue = Schema.Union([
  DuplicateUnfinishedTaskAttemptIssue,
  JournalBoundaryDecodeIssue,
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue,
  Schema.TaggedStruct("OtherUnfinishedRunIssue", { requestedRunId: RunId, unfinishedRunId: RunId })
])
export type StartupRecoveryIssue = typeof StartupRecoveryIssue.Type

/** Startup found preserved history that cannot be reconstructed safely. */
export class StartupRecoveryBlocked extends Schema.TaggedErrorClass<StartupRecoveryBlocked>()(
  "StartupRecoveryBlocked",
  { issues: Schema.Array(StartupRecoveryIssue) }
) {}

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
  const otherUnfinishedRun = reductions.find(
    (reduction) =>
      reduction._tag === "ValidWorkflowJournalHistory" &&
      reduction.runId !== runId &&
      (runBeganWithoutTermination(reduction) || hasUnfinishedRunResponsibility(reduction.runState))
  )
  if (otherUnfinishedRun?._tag === "ValidWorkflowJournalHistory") {
    return yield* new StartupRecoveryBlocked({
      issues: [{ _tag: "OtherUnfinishedRunIssue", requestedRunId: runId, unfinishedRunId: otherUnfinishedRun.runId }]
    })
  }
  return reductions.find((reduction) => reduction._tag === "ValidWorkflowJournalHistory" && reduction.runId === runId)
})

const makeStartupRecoveryContext = Effect.fn("StartupRecovery.makeContext")(function* (
  runId: RunId,
  integrationTarget: IntegrationTarget | undefined,
  candidateCorrectionLimit: CandidateCorrectionLimit | undefined,
  candidateContinuationLimit: CandidateContinuationLimit | undefined,
  targetVerification: TargetVerificationRuntimeInput | undefined,
  targetPromotion: TargetPromotionRuntimeInput | undefined,
  integrationFinality: CompletionClaimBoundaryService | undefined,
  startup: "Fresh" | "Recovered"
) {
  yield* CoordinatorOwnership
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
  const candidateAgent = Context.getOption(ambient, IntegrationCandidateAgent)
  const candidateGit = Context.getOption(ambient, IntegrationCandidateGit)
  const deliveryRuntimeResources = Context.getOption(ambient, DeliveryRuntimeResources)
  const runtimeResources = Option.isSome(deliveryRuntimeResources)
    ? deliveryRuntimeResources.value
    : DeliveryRuntimeResources.of(deliveryRuntimeResourcesOf(yield* makeIntegrationTargetResourceController()))
  const integrationResources = runtimeResources.integrationTargets
  const recovery = yield* makeRecoveryProjection(
    runId,
    integrationTarget,
    candidateCorrectionLimit,
    candidateContinuationLimit,
    integrationResources,
    targetVerification,
    targetPromotion,
    integrationFinality !== undefined,
    startup
  )
  let context = Context.empty().pipe(
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
    Context.add(DeliveryRuntimeResources, runtimeResources)
  )
  if (candidateAgent._tag === "Some") context = Context.add(context, IntegrationCandidateAgent, candidateAgent.value)
  if (candidateGit._tag === "Some") context = Context.add(context, IntegrationCandidateGit, candidateGit.value)
  if (targetVerification !== undefined) {
    context = Context.add(context, TargetVerificationRuntime, TargetVerificationRuntime.of(targetVerification))
  }
  if (targetPromotion !== undefined) {
    context = Context.add(context, TargetPromotionRuntime, TargetPromotionRuntime.of(targetPromotion))
  }
  /* v8 ignore next -- @preserve Production supplies this service and planning flag from one input; the delivery-action route test exercises the configured boundary. */
  if (integrationFinality !== undefined) {
    context = Context.add(context, CompletionClaimBoundary, CompletionClaimBoundary.of(integrationFinality))
  }
  /* v8 ignore next -- @preserve Production startup installs its configured integration target; targetless composition is covered at frontier configuration wait. */
  return integrationTarget === undefined ? context : Context.add(context, IntegrationTargetSelection, integrationTarget)
})

const makeRecoveryProjection = Effect.fn("StartupRecovery.makeProjection")(function* (
  runId: RunId,
  integrationTarget: IntegrationTarget | undefined,
  candidateCorrectionLimit: CandidateCorrectionLimit | undefined,
  candidateContinuationLimit: CandidateContinuationLimit | undefined,
  integrationResources: ReturnType<typeof DeliveryRuntimeResources.of>["integrationTargets"],
  targetVerification: TargetVerificationRuntimeInput | undefined,
  targetPromotion: TargetPromotionRuntimeInput | undefined,
  integrationFinalityConfigured: boolean,
  startup: "Fresh" | "Recovered"
) {
  return startup === "Fresh"
    ? yield* makeJournaledFreshRunRecoveryProjection(
        runId,
        integrationTarget,
        candidateCorrectionLimit,
        candidateContinuationLimit,
        integrationResources,
        targetVerification,
        targetPromotion,
        integrationFinalityConfigured
      )
    : yield* makeRunRecoveryProjection(
        runId,
        integrationTarget,
        candidateCorrectionLimit,
        candidateContinuationLimit,
        integrationResources,
        targetVerification,
        targetPromotion,
        integrationFinalityConfigured
      )
})

/** Builds ordinary in-Run services after bootstrap has already validated the complete accepted prefix. */
export const validatedStartupRecoveryLayer = (
  runId: RunId,
  integrationTarget: IntegrationTarget | undefined,
  startup: "Fresh" | "Recovered",
  candidateCorrectionLimit?: CandidateCorrectionLimit,
  candidateContinuationLimit?: CandidateContinuationLimit,
  targetVerification?: TargetVerificationRuntimeInput,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinality?: CompletionClaimBoundaryService
) =>
  Layer.effectContext(
    makeStartupRecoveryContext(
      runId,
      integrationTarget,
      candidateCorrectionLimit,
      candidateContinuationLimit,
      targetVerification,
      targetPromotion,
      integrationFinality,
      startup
    )
  )
