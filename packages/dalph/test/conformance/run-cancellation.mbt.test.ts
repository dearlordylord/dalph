/* eslint-disable max-lines -- One driver keeps the cancellation model-to-runtime seam map auditable. */
/* eslint-disable functional/immutable-data -- The driver owns a short-lived mutable test projection. */
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  GitRepositoryLocator,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Scope, Stream } from "effect"
import { expect } from "vitest"
import { PlannedWorktreeReady } from "../../../orchestrator/src/authorities/git/worktree.js"
import { InitialControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { Journal } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { DeliveryRuntimeResources } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-resources.js"
import { deliveryRuntime } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-adapter.js"
import {
  DeliveryActionExecutor,
  type DeliveryActionExecutionLease
} from "../../../orchestrator/src/coordination/delivery/delivery-action-executor.js"
import { DeliveryAcceptedFactPublication } from "../../../orchestrator/src/coordination/delivery/delivery-accepted-fact-publication.js"
import { makeReactiveDeliveryRelationsLayer } from "../../../orchestrator/src/coordination/delivery/reactive-delivery-relations.js"
import { executeFreshTrackerGraphRead } from "../../../orchestrator/src/coordination/delivery/delivery-action-adapter-common.js"
import { executeIntegrationAction } from "../../../orchestrator/src/coordination/delivery/integration-delivery-action-adapter.js"
import { JournalPosition, type JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  journalStoreCapabilities,
  InRunJournal,
  JournalStore,
  JournalStoreContradiction,
  RunLifecycleJournal,
  type AppendableWorkflowJournalEvent,
  type JournalRecord,
  type JournalStoreService
} from "../../../orchestrator/src/workflow-journal/store.js"
import { CoordinatorOwnership } from "../../../orchestrator/src/authorities/coordinator-ownership/ownership.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import type { TrackerTarget } from "../../../orchestrator/src/authorities/task-tracker/target.js"
import { TrackerReadError } from "../../../orchestrator/src/authorities/task-tracker/graph-reader.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import type { TaskDagSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { TrackerRevision } from "../../../orchestrator/src/authorities/task-tracker/task.js"
import {
  type ApplicationExitShell,
  makeApplicationExitShell as makeExitShell
} from "../../../orchestrator/src/coordination/application-exit/application-shell.js"
import { journaledCurrentDeliveryFrameOf } from "../../../orchestrator/src/coordination/run/current-delivery-frame.js"
import { RunRecoveryProjection } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { journaledRunBootstrapLayer } from "../../../orchestrator/src/coordination/run/journaled-run-bootstrap.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "../../test-support/controlled-synchronous-planned-attempt-executor.js"
import { noopJournalMaintenanceObservation } from "../../../orchestrator/src/workflow-journal/maintenance.js"
import { JournaledRunBootstrap } from "../../../orchestrator/src/coordination/run/run.js"
import { runStabilizedDelivery } from "../../../orchestrator/src/coordination/run/run-stabilization.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { RunnableFrontierTransition } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import { type RunTerminationDisposition } from "../../../orchestrator/src/coordination/frontier/run-finality.js"
import { executePlannedAttemptTransition } from "../../../orchestrator/src/coordination/delivery/planned-attempt-delivery-action-adapter.js"
import { executeNewRecoveredAction } from "../../../orchestrator/src/coordination/delivery/recovered-delivery-action-adapter.js"
import {
  type DeliveryActionProposal,
  type IdentityFreeDeliveryProposal,
  type NewRecoveredWorkflowAction
} from "../../../orchestrator/src/coordination/delivery/delivery-action-proposal.js"
import { deliveryProposalsOf } from "../../../orchestrator/src/coordination/delivery/delivery-proposal-derivation.js"
import { newRecoveredActionOf } from "../../../orchestrator/src/coordination/delivery/delivery-proposal-route.js"
import {
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  AuthoritativeTaskClaimObserved,
  TaskClaimObservationUnreadable,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { AuthoritativeTaskClaimReleased } from "../../../orchestrator/src/workflow/protocols/task-claim-release/protocol.js"
import {
  decideWorkflowRunBeginning,
  decideWorkflowRunTermination,
  readRecoverableRunBeginning
} from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { attemptChoiceControlLayer } from "../../../orchestrator/src/workflow/protocols/attempt-choice/control.js"
import { controlDirectionApplicationLayer } from "../../../orchestrator/src/workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../../orchestrator/src/workflow/protocols/task-claim-reacquisition/control.js"
import { DispositionCleanupActivation } from "../../../orchestrator/src/workflow/protocols/disposition-cleanup/loop.js"
import { taskWorkCapacityControlLayer } from "../../../orchestrator/src/control/task-work-capacity.js"
import { deterministicTaskClaimAcquisitionPlannerLayer } from "../../../orchestrator/src/workflow/protocols/task-claim-acquisition/plan.js"
import {
  deterministicOperationIdAllocatorLayer,
  PlannedTaskAttemptPlanner
} from "../../../orchestrator/src/workflow/protocols/task-attempt-planning/plan.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskWorktreeReadyEvent,
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent,
  taskTrackerReadIntent
} from "../../../orchestrator/src/workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../../orchestrator/src/workflow/protocols/integration-admission/events.js"
import { TargetLineageObservation } from "../../../orchestrator/src/authorities/git/target-lineage.js"
import {
  attemptPlanRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { AllocatedWorkflowRunId } from "../../../orchestrator/src/coordination/run/fresh-run-identity.js"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import {
  Integrator,
  IntegratorGit,
  IntegratorResult,
  IntegratorNotPreparedDetail,
  IntegratorPreparationInput,
  integratorCorrelationFor,
  prepareIntegrationCandidateRun
} from "../../../orchestrator/src/workflow/protocols/integrator/protocol.js"
import {
  TargetPromotionGitReadObservation,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionGitReadFailure
} from "../../../orchestrator/src/workflow/protocols/target-promotion/events.js"
import { TargetPromotionRuntime } from "../../../orchestrator/src/workflow/protocols/target-promotion/runtime.js"
import { StartedIntegrationResponsibility } from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"

const RunIdVariant = Schema.Struct({ tag: Schema.Literals(["R1", "R2"]), value: Schema.Unknown })
const TargetVariant = Schema.Struct({ tag: Schema.Literals(["Target1", "Target2"]), value: Schema.Unknown })
const ActorVariant = Schema.Struct({ tag: Schema.Literals(["Operator", "DalphCoordinator"]), value: Schema.Unknown })
const PhaseVariant = Schema.Struct({
  tag: Schema.Literals([
    "New",
    "Active",
    "Cancelling",
    "ReadyForClassification",
    "ProcessLost",
    "Rejected",
    "TerminalHistory"
  ]),
  value: Schema.Unknown
})
const ExecutorVariant = Schema.Struct({
  tag: Schema.Literals(["NoExecutor", "Executing", "StopIntentRecorded", "SafelySuspended", "ExecutorUnreadable"]),
  value: Schema.Unknown
})
const ClaimVariant = Schema.Struct({
  tag: Schema.Literals(["NoClaim", "Held", "ReleaseIntentRecorded", "Released", "ForeignClaim", "ClaimUnreadable"]),
  value: Schema.Unknown
})
const IntegrationVariant = Schema.Struct({
  tag: Schema.Literals([
    "NoIntegration",
    "IntegrationOwned",
    "PromotionIntentRecorded",
    "PromotionAccepted",
    "IntegrationSettled",
    "IntegrationQuarantined",
    "IntegrationUnreadable"
  ]),
  value: Schema.Unknown
})
const GraphVariant = Schema.Struct({
  tag: Schema.Literals(["NoGraph", "AllSucceeded", "NotAllSucceeded", "TemporaryWait", "GraphUnreadable"]),
  value: Schema.Unknown
})
const TerminalVariant = Schema.Struct({
  tag: Schema.Literals(["NoTermination", "Completed", "Blocked", "Cancelled"]),
  value: Schema.Unknown
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    durable: Schema.Struct({
      runId: RunIdVariant,
      target: TargetVariant,
      cancellationApplied: Schema.Boolean,
      cancellationAppends: ITFBigInt,
      cancellationRedeliveries: ITFBigInt,
      cancellationActor: ActorVariant,
      executor: ExecutorVariant,
      claim: ClaimVariant,
      integration: IntegrationVariant,
      worktreePreserved: Schema.Boolean,
      logsPreserved: Schema.Boolean,
      evidencePreserved: Schema.Boolean,
      executorStopIntents: ITFBigInt,
      executorSafeReports: ITFBigInt,
      claimReleaseIntents: ITFBigInt,
      claimReleaseObservations: ITFBigInt,
      claimReleases: ITFBigInt,
      integrationIntents: ITFBigInt,
      integrationSettlements: ITFBigInt,
      promotionAccepted: Schema.Boolean,
      terminalHistory: TerminalVariant,
      processLosses: ITFBigInt,
      classificationReads: ITFBigInt
    }),
    process: Schema.Struct({
      phase: PhaseVariant,
      requestedRunId: RunIdVariant,
      requestedTarget: TargetVariant,
      paused: Schema.Boolean,
      admissionOpen: Schema.Boolean,
      exitCutoff: Schema.Boolean,
      executorPositionHeld: Schema.Boolean,
      responsibilitiesSettled: Schema.Boolean,
      graphRead: Schema.Boolean,
      graph: GraphVariant,
      forwardAdmissions: ITFBigInt,
      freshAfterRestart: Schema.Boolean,
      cancellationRejected: Schema.Boolean
    })
  })
})

type RunTag = "R1" | "R2"
type TargetTag = "Target1" | "Target2"
type ActorTag = "Operator" | "DalphCoordinator"
type PhaseTag =
  | "New"
  | "Active"
  | "Cancelling"
  | "ReadyForClassification"
  | "ProcessLost"
  | "Rejected"
  | "TerminalHistory"
type ExecutorTag = "NoExecutor" | "Executing" | "StopIntentRecorded" | "SafelySuspended" | "ExecutorUnreadable"
type ClaimTag = "NoClaim" | "Held" | "ReleaseIntentRecorded" | "Released" | "ForeignClaim" | "ClaimUnreadable"
type IntegrationTag =
  | "NoIntegration"
  | "IntegrationOwned"
  | "PromotionIntentRecorded"
  | "PromotionAccepted"
  | "IntegrationSettled"
  | "IntegrationQuarantined"
  | "IntegrationUnreadable"
type GraphTag = "NoGraph" | "AllSucceeded" | "NotAllSucceeded" | "TemporaryWait" | "GraphUnreadable"
type TerminalTag = "NoTermination" | "Completed" | "Blocked" | "Cancelled"

interface DurableProjection {
  readonly runId: RunTag
  readonly target: TargetTag
  readonly cancellationApplied: boolean
  readonly cancellationAppends: number
  readonly cancellationRedeliveries: number
  readonly cancellationActor: ActorTag
  readonly executor: ExecutorTag
  readonly claim: ClaimTag
  readonly integration: IntegrationTag
  readonly worktreePreserved: boolean
  readonly logsPreserved: boolean
  readonly evidencePreserved: boolean
  readonly executorStopIntents: number
  readonly executorSafeReports: number
  readonly claimReleaseIntents: number
  readonly claimReleaseObservations: number
  readonly claimReleases: number
  readonly integrationIntents: number
  readonly integrationSettlements: number
  readonly promotionAccepted: boolean
  readonly terminalHistory: TerminalTag
  readonly processLosses: number
  readonly classificationReads: number
}

interface ProcessProjection {
  readonly phase: PhaseTag
  readonly requestedRunId: RunTag
  readonly requestedTarget: TargetTag
  readonly paused: boolean
  readonly admissionOpen: boolean
  readonly exitCutoff: boolean
  readonly executorPositionHeld: boolean
  readonly responsibilitiesSettled: boolean
  readonly graphRead: boolean
  readonly graph: GraphTag
  readonly forwardAdmissions: number
  readonly freshAfterRestart: boolean
  readonly cancellationRejected: boolean
}

interface DriverProjection {
  readonly state: { readonly durable: DurableProjection; readonly process: ProcessProjection }
}

type SettlementPlannedTransition = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "SuspendPlannedAttemptExecutorWork"
      | "ReconcilePlannedAttemptExecutorWork"
      | "RelinquishCancelledAttemptImplementation"
      | "RecordCancelledAttemptClaimNoRelease"
  }
>

type RuntimeCommand =
  | {
      readonly _tag: "PublishGraph"
      readonly completed: Deferred.Deferred<"RunPaused" | "RunUnpaused">
      readonly operationNumber: number
    }
  | {
      readonly _tag: "PublishUnreadableGraph"
      readonly completed: Deferred.Deferred<void>
      readonly operationNumber: number
    }
  | { readonly _tag: "SeedExecutingAttempt"; readonly completed: Deferred.Deferred<void> }
  | {
      readonly _tag: "ExecutePlannedSettlement"
      readonly action: { readonly _tag: "IdentityFreeAction"; readonly proposal: IdentityFreeDeliveryProposal }
      readonly completed: Deferred.Deferred<void>
      readonly transition: SettlementPlannedTransition
    }
  | {
      readonly _tag: "ExecuteRecoveredSettlement"
      readonly action: NewRecoveredWorkflowAction
      readonly completed: Deferred.Deferred<void>
      readonly operationId: OperationId
    }
  | { readonly _tag: "PrepareIntegrationQualification"; readonly completed: Deferred.Deferred<void> }
  | { readonly _tag: "RunIntegrationPromotion"; readonly completed: Deferred.Deferred<void> }
  | { readonly _tag: "ObserveIntegrationPromotion"; readonly completed: Deferred.Deferred<void> }
  | { readonly _tag: "ObserveUnreadableExecutor"; readonly completed: Deferred.Deferred<void> }
  | { readonly _tag: "ObserveUnreadableIntegration"; readonly completed: Deferred.Deferred<void> }
  | { readonly _tag: "RecordIntegrationQuarantine"; readonly completed: Deferred.Deferred<void> }
  | { readonly _tag: "ReleaseIntegration"; readonly completed: Deferred.Deferred<void> }
  | {
      readonly _tag: "TerminateWithGraph"
      readonly completed: Deferred.Deferred<RunTerminationDisposition>
      readonly disposition: RunTerminationDisposition
      readonly graphLifecycle: "Open" | "CompletedSuccessfully"
      readonly operationNumber: number
      readonly useExistingRead: boolean
    }

const runId = RunId.make("run-cancellation-R1")
const target = FixtureTarget.make("run-cancellation-T1")
const taskId = TaskId.make("run-cancellation-task")
const cancellationTrackerRevision = TrackerRevision.make("run-cancellation-tracker-revision")
const taskSpecification = makeTaskWorkSpecification({
  body: "Cancellation conformance work",
  taskId,
  title: "Cancellation conformance task"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("run-cancellation-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/run-cancellation-task"),
  executor: TaskExecutorLocator.make("executor:run-cancellation-fake"),
  runId,
  taskId,
  taskRevision: taskSpecification.fingerprint,
  worktree: WorktreeLocator.make("/tmp/dalph-run-cancellation-task")
})
const integrationPlannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("run-cancellation-integration-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/run-cancellation-integration-task"),
  executor: TaskExecutorLocator.make("executor:run-cancellation-integration-fake"),
  runId,
  taskId: TaskId.make("run-cancellation-integration-task"),
  taskRevision: taskSpecification.fingerprint,
  worktree: WorktreeLocator.make("/tmp/dalph-run-cancellation-integration-task")
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/tmp/dalph-run-cancellation-integration.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const integrationAcceptedResult = AcceptedResult.make({
  commit: GitCommitSha.make("2".repeat(40)),
  evidenceManifest: { byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) }
})
const quarantinePlannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("run-cancellation-quarantine-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/run-cancellation-quarantine-task"),
  executor: TaskExecutorLocator.make("executor:run-cancellation-quarantine-fake"),
  runId,
  taskId: TaskId.make("run-cancellation-quarantine-task"),
  taskRevision: taskSpecification.fingerprint,
  worktree: WorktreeLocator.make("/tmp/dalph-run-cancellation-quarantine-task")
})
const quarantineAcceptedResult = AcceptedResult.make({
  commit: GitCommitSha.make("4".repeat(40)),
  evidenceManifest: { byteLength: 1, digest: EvidenceDigest.make("b".repeat(64)) }
})
const integrationExpectedTargetHead = GitCommitSha.make("1".repeat(40))
const integrationCandidateCommit = GitCommitSha.make("3".repeat(40))
const integrationCandidateText = IntegratorCandidateText.make("refs/heads/dalph/run-cancellation-candidate")

interface IntegrationFixture {
  readonly responsibility: StartedIntegrationResponsibility
  readonly lineage: TargetLineageObservation
  readonly run: ReturnType<typeof RunnableFrontierTransition.RunIntegrator>["run"]
  readonly candidate: IntegratorRunQualifiedCandidate
}

interface IntegrationQuarantineFixture {
  readonly responsibility: StartedIntegrationResponsibility
  readonly lineage: TargetLineageObservation
  readonly lineageObservedAt: JournalPosition
  readonly run: ReturnType<typeof RunnableFrontierTransition.RunIntegrator>["run"]
}

const integrationRunTransitionFor = (fixture: IntegrationFixture) =>
  RunnableFrontierTransition.RunIntegrator({
    lineage: fixture.lineage,
    lineageObservedAt: fixture.run.session.targetLineageObservedAt,
    responsibility: fixture.responsibility,
    run: fixture.run
  })

type ClassificationGraph = {
  readonly operation: ReturnType<typeof makeTrackerGraphObservationOperation>
  readonly snapshot: TaskDagSnapshot
  readonly observedAt: JournalPosition
}

const acceptedAttemptGraphFor = (attempt: PlannedTaskAttempt): TaskDagSnapshot => {
  const projected = projectTrackerSnapshot({
    revision: cancellationTrackerRevision,
    rootTaskId: attempt.taskId,
    tasks: [{ id: attempt.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  if (projected._tag !== "Valid")
    return Effect.runSync(Effect.die(`invalid cancellation lineage graph: ${JSON.stringify(projected.issues)}`))
  return projected.snapshot
}

const acceptedAttemptSpecificationFor = (attempt: PlannedTaskAttempt) =>
  makeTaskWorkSpecification({ body: taskSpecification.body, taskId: attempt.taskId, title: taskSpecification.title })

const identityFreeIntegrationActionFor = (
  transition: RunnableFrontierTransition,
  responsibility: StartedIntegrationResponsibility
): { readonly _tag: "IdentityFreeAction"; readonly proposal: IdentityFreeDeliveryProposal } => {
  const derived = deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    integrationResponsibilities: [responsibility],
    responsibilities: [],
    runId,
    transitions: [transition]
  })
  const proposal = [...derived.ticketDelivery, ...derived.deliverySettlement][0]
  if (proposal === undefined) return expect.fail(`missing integration proposal for ${transition._tag}`)
  if (proposal.actionIdentity._tag !== "NoWorkflowOperationIdentity") {
    return expect.fail(`missing identity-free integration proposal for ${transition._tag}`)
  }
  return { _tag: "IdentityFreeAction", proposal: proposal as IdentityFreeDeliveryProposal }
}
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("run-cancellation-claim-acquisition"),
  owner: ClaimOwner.make("dalph-run-cancellation"),
  taskId,
  token: ClaimToken.make("run-cancellation-claim-token")
})
const foreignClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("run-cancellation-foreign-claim-acquisition"),
  owner: ClaimOwner.make("other-run-owner"),
  taskId,
  token: ClaimToken.make("other-run-claim-token")
})
const claimAcquisitionOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: activeClaim.operationId,
    owner: activeClaim.owner,
    taskId: activeClaim.taskId,
    token: activeClaim.token
  },
  predecessorOperationIds: []
})
const graphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("run-cancellation-post-claim-graph"),
  target,
  [claimAcquisitionOperation.acquisition.operationId],
  [plannedAttempt.taskId]
)
const specificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("run-cancellation-specification"),
  target,
  plannedAttempt.taskId,
  [graphOperation.operationId]
)
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("run-cancellation-attempt-plan"),
  plannedAttempt,
  predecessorOperationIds: [specificationOperation.operationId]
})
const integrationClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("run-cancellation-integration-claim-acquisition"),
  owner: ClaimOwner.make("dalph-run-cancellation-integration"),
  taskId: integrationPlannedAttempt.taskId,
  token: ClaimToken.make("run-cancellation-integration-claim-token")
})
const integrationClaimAcquisitionOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: integrationClaim.operationId,
    owner: integrationClaim.owner,
    taskId: integrationClaim.taskId,
    token: integrationClaim.token
  },
  predecessorOperationIds: []
})
const integrationGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("run-cancellation-integration-post-claim-graph"),
  target,
  [integrationClaim.operationId],
  [integrationPlannedAttempt.taskId]
)
const integrationSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("run-cancellation-integration-specification"),
  target,
  integrationPlannedAttempt.taskId,
  [integrationGraphOperation.operationId]
)
const integrationPlanOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("run-cancellation-integration-attempt-plan"),
  plannedAttempt: integrationPlannedAttempt,
  predecessorOperationIds: [integrationSpecificationOperation.operationId]
})
const quarantineClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("run-cancellation-quarantine-claim-acquisition"),
  owner: ClaimOwner.make("dalph-run-cancellation-quarantine"),
  taskId: quarantinePlannedAttempt.taskId,
  token: ClaimToken.make("run-cancellation-quarantine-claim-token")
})
const quarantineClaimAcquisitionOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: quarantineClaim.operationId,
    owner: quarantineClaim.owner,
    taskId: quarantineClaim.taskId,
    token: quarantineClaim.token
  },
  predecessorOperationIds: []
})
const quarantineGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("run-cancellation-quarantine-post-claim-graph"),
  target,
  [quarantineClaim.operationId],
  [quarantinePlannedAttempt.taskId]
)
const quarantineSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("run-cancellation-quarantine-specification"),
  target,
  quarantinePlannedAttempt.taskId,
  [quarantineGraphOperation.operationId]
)
const quarantineIntegrationPlanOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("run-cancellation-quarantine-attempt-plan"),
  plannedAttempt: quarantinePlannedAttempt,
  predecessorOperationIds: [quarantineSpecificationOperation.operationId]
})
const claimReadOperationId = OperationId.make("run-cancellation-claim-read")
const claimReadOperation = makeTaskClaimObservationOperation(claimReadOperationId, target, taskId, [
  activeClaim.operationId
])
const foreignClaimReadOperationId = OperationId.make("run-cancellation-foreign-claim-read")
const foreignClaimReadOperation = makeTaskClaimObservationOperation(foreignClaimReadOperationId, target, taskId, [
  claimReadOperationId
])
const unreadableClaimReadOperationId = OperationId.make("run-cancellation-unreadable-claim-read")
const unreadableClaimReadOperation = makeTaskClaimObservationOperation(unreadableClaimReadOperationId, target, taskId, [
  claimReadOperationId
])
const absentClaimReadOperationId = OperationId.make("run-cancellation-absent-claim-read")
const absentClaimReadOperation = makeTaskClaimObservationOperation(absentClaimReadOperationId, target, taskId, [
  activeClaim.operationId
])
const claimReleaseOperationId = OperationId.make("run-cancellation-claim-release")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
let runCancellationMbtScope: Scope.Scope | undefined

const assertIdentityFreeProposal: (
  proposal: DeliveryActionProposal,
  transition: SettlementPlannedTransition
) => asserts proposal is IdentityFreeDeliveryProposal = (proposal, transition) => {
  if (proposal.actionIdentity._tag !== "NoWorkflowOperationIdentity") {
    expect.fail(`missing identity-free cancellation proposal for ${transition._tag}`)
  }
}

const identityFreeActionFor = (
  transition: SettlementPlannedTransition
): { readonly _tag: "IdentityFreeAction"; readonly proposal: IdentityFreeDeliveryProposal } => {
  const derived = deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    integrationResponsibilities: [],
    responsibilities: [
      { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(1), plannedAttempt }
    ],
    runId,
    transitions: [transition]
  })
  const proposal = [...derived.ticketDelivery, ...derived.deliverySettlement][0]
  if (proposal === undefined) return expect.fail(`missing identity-free cancellation proposal for ${transition._tag}`)
  assertIdentityFreeProposal(proposal, transition)
  return { _tag: "IdentityFreeAction", proposal }
}

const projectionOf = (durable: DurableProjection, process: ProcessProjection): DriverProjection => ({
  state: { durable, process }
})

const makeInitialDurable = (): DurableProjection => ({
  runId: "R1",
  target: "Target1",
  cancellationApplied: false,
  cancellationAppends: 0,
  cancellationRedeliveries: 0,
  cancellationActor: "Operator",
  executor: "NoExecutor",
  claim: "NoClaim",
  integration: "NoIntegration",
  worktreePreserved: true,
  logsPreserved: true,
  evidencePreserved: true,
  executorStopIntents: 0,
  executorSafeReports: 0,
  claimReleaseIntents: 0,
  claimReleaseObservations: 0,
  claimReleases: 0,
  integrationIntents: 0,
  integrationSettlements: 0,
  promotionAccepted: false,
  terminalHistory: "NoTermination",
  processLosses: 0,
  classificationReads: 0
})

const makeInitialProcess = (): ProcessProjection => ({
  phase: "Active",
  requestedRunId: "R1",
  requestedTarget: "Target1",
  paused: false,
  admissionOpen: true,
  exitCutoff: false,
  executorPositionHeld: false,
  responsibilitiesSettled: true,
  graphRead: false,
  graph: "NotAllSucceeded",
  forwardAdmissions: 0,
  freshAfterRestart: false,
  cancellationRejected: false
})

const makeRunCancellationActions = {
  init: {},
  selectIdleRun: {},
  selectAlreadyPausedRun: {},
  selectExecutingExecutor: {},
  selectIntegrationOwned: {},
  selectTemporaryWait: {},
  selectApplicationExitCutoff: {},
  selectForeignRunRequest: {},
  selectTerminalHistory: {},
  applyCancellation: {},
  redeliverCancellation: {},
  recordExecutorStopIntent: {},
  reportExecutorSafe: {},
  recordClaimReleaseIntent: {},
  observeAndReleaseClaim: {},
  observeForeignClaim: {},
  observeAbsentClaim: {},
  markClaimUnreadable: {},
  recordIntegrationIntent: {},
  observePromotedIntegration: {},
  settlePromotedIntegration: {},
  readFreshClassificationGraph: {},
  readTemporaryWaitGraph: {},
  handoffToFreshClassification: {},
  crashBeforeSettlement: {},
  restartCancellation: {},
  reconcileExecutorAfterRestart: {},
  reconcileClaimAfterRestart: {},
  reconcileIntegrationAfterRestart: {},
  settleAfterIdleCancellation: {},
  markExecutorUnreadable: {},
  markIntegrationUnreadable: {},
  markIntegrationQuarantined: {},
  markGraphUnreadable: {},
  rejectCancellationAtExit: {},
  rejectForeignCancellation: {},
  rejectTerminalHistory: {},
  admitForwardWork: {}
} as const

const settlementLeaseOf = (controller: PlannedAttemptProtocolController["Service"]): DeliveryActionExecutionLease => ({
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: {
    _tag: "InterruptibleBoundary",
    execution: { run: (_intent, call, recordResult) => call.pipe(Effect.flatMap(recordResult)) }
  },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: (correlation, effect) => controller.withPermit(correlation, effect)
})

const runtimeLayer = (
  activeRunId: RunId,
  executor: PlannedAttemptExecutor["Service"],
  interpreter: WorkflowInterpreter["Service"]
) =>
  Layer.mergeAll(
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    Layer.succeed(PlannedAttemptExecutor, executor),
    Layer.mock(RunRecoveryProjection, {
      _tag: "AuthoritativeRunRecoveryProjection" as const,
      runId: activeRunId,
      projectDeliveryFrom: (runState) =>
        Effect.succeed({
          evidence: {
            _tag: "AvailableDeliveryProjectionEvidence" as const,
            acceptedAt: runState.appliedThrough,
            facts: [],
            integrationWaits: []
          },
          frontier: { explanations: [], transitions: [] }
        }),
      readDeliveryProjection: Effect.succeed({
        evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
        frontier: { explanations: [], transitions: [] }
      }),
      reconstructedPlannedAttemptPositions: []
    }),
    taskWorkCapacityControlLayer,
    taskClaimReacquisitionControlLayer,
    deterministicOperationIdAllocatorLayer(`run-cancellation:${activeRunId}`),
    plannedAttemptProtocolControllerLayer,
    journaledWorkflowInterpreterLayer(activeRunId, Layer.succeed(WorkflowInterpreter, interpreter)),
    Layer.mock(WorkflowTrace, { emit: () => Effect.void }),
    Layer.succeed(
      DispositionCleanupActivation,
      DispositionCleanupActivation.of({
        responsibilities: { branch: [], candidate: [], worktree: [] },
        run: Effect.succeed({
          branch: undefined,
          branchOutcomes: [],
          candidate: undefined,
          candidateOutcomes: [],
          selected: { branch: undefined, candidate: undefined, worktree: undefined },
          worktree: undefined,
          worktreeOutcomes: []
        })
      })
    )
  )

const makeStorage = (
  readRecords: () => ReadonlyArray<JournalRecord>,
  writeRecords: (records: ReadonlyArray<JournalRecord>) => void
): JournalStoreService => {
  const append = (eventRunId: RunId, key: JournalRecordKey, event: AppendableWorkflowJournalEvent) =>
    Effect.suspend(() => {
      const records = readRecords()
      const existing = records.find((record) => record.key === key)
      if (existing !== undefined) {
        return JSON.stringify(existing.event) === JSON.stringify(event)
          ? Effect.succeed(existing)
          : Effect.fail(new JournalStoreContradiction({ existingPosition: existing.position, key, runId: eventRunId }))
      }
      const record = {
        event,
        key,
        position: JournalPosition.make(records.length + 1),
        runId: eventRunId
      } satisfies JournalRecord
      writeRecords([...records, record])
      return Effect.succeed(record)
    })

  const beginRun = (eventRunId: RunId, eventTarget: TrackerTarget, policy: InitialControlPolicy) =>
    Effect.sync(() => {
      const decision = decideWorkflowRunBeginning(readRecords(), eventRunId, eventTarget, policy)
      if (decision._tag !== "LifecycleTransitionAccepted") {
        expect.fail(JSON.stringify(decision.failure))
      }
      writeRecords([...readRecords(), decision.record])
      return decision.record
    })

  const readRunForRecovery = (eventRunId: RunId, eventTarget: TrackerTarget) =>
    readRecoverableRunBeginning(readRecords(), eventRunId, eventTarget)

  const terminateRun = (
    eventRunId: RunId,
    disposition: Parameters<JournalStoreService["terminateRun"]>[1],
    evidence: Parameters<JournalStoreService["terminateRun"]>[2]
  ) =>
    Effect.sync(() => {
      const decision = decideWorkflowRunTermination(readRecords(), eventRunId, disposition, evidence)
      if (decision._tag !== "LifecycleTransitionAccepted") {
        expect.fail(JSON.stringify(decision.failure))
      }
      writeRecords([...readRecords(), decision.record])
      return decision.record
    })

  return {
    append,
    beginRun,
    read: () => Effect.succeed(readRecords()),
    readRunForRecovery,
    scanHot: () =>
      Effect.succeed({ issues: [], runs: readRecords().length === 0 ? [] : [{ records: readRecords(), runId }] }),
    auditAll: () => Effect.succeed({ issues: [], runs: [] }),
    retireTerminalRun: (eventRunId) =>
      Effect.succeed({ _tag: "AlreadyRetired", partition: "Cold", runId: eventRunId } as const),
    terminateRun
  }
}

const makeCancellationDriverImplementation = () => {
  let records: ReadonlyArray<JournalRecord> = []
  const storage = makeStorage(
    () => records,
    (next) => (records = next)
  )
  let bootstrap: JournaledRunBootstrap["Service"] | undefined
  let applicationExit: ApplicationExitShell["Service"] | undefined
  let runtimeFiber: Fiber.Fiber<unknown, unknown> | undefined
  let applicationExitFiber: Fiber.Fiber<unknown, unknown> | undefined
  let runtimeCommands: Queue.Queue<RuntimeCommand> | undefined
  let durable = makeInitialDurable()
  let process = makeInitialProcess()
  let effectivePause: "RunPaused" | "RunUnpaused" | undefined
  let executorAuthority: "Executing" | "SafelySuspended" | "Unreadable" = "Executing"
  let claimHeld = true
  let claimObservationMode: "Absent" | "Exact" | "Foreign" | "Unreadable" = "Exact"
  let promotionReadCount = 0
  let promotionReadMode: "Exact" | "Unreadable" = "Exact"
  let graphLifecycle: "Open" | "CompletedSuccessfully" | "Unreadable" = "Open"
  let latestClassificationGraph: ClassificationGraph | undefined
  let graphRevisionObservations: ReadonlyArray<{
    readonly operationId: OperationId
    readonly revision: TrackerRevision
  }> = []
  let integratorOutcomeMode: "Prepared" | "NotPrepared" = "Prepared"
  let integrationFixture: IntegrationFixture | undefined
  let integrationQuarantineFixture: IntegrationQuarantineFixture | undefined

  const targetPromotionGit: TargetPromotionRuntime["Service"]["git"] = {
    compareAndSet: (request) =>
      Effect.fail(
        new TargetPromotionCompareAndSetFailure({
          candidateCommit: request.candidateCommit,
          detail: "controlled cancellation conformance promotion response is ambiguous",
          expectedHead: request.expectedTargetHead,
          target: request.integrationTarget
        })
      ),
    read: (request) =>
      promotionReadMode === "Unreadable"
        ? Effect.fail(
            new TargetPromotionGitReadFailure({
              candidateCommit: request.candidateCommit,
              detail: "controlled cancellation conformance promotion read is unreadable",
              target: request.integrationTarget
            })
          )
        : Effect.sync(() => {
            promotionReadCount += 1
            return promotionReadCount === 1
              ? TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                  currentHeadSha: request.expectedTargetHead
                })
              : TargetPromotionGitReadObservation.cases.CandidateCurrent.make({
                  currentHeadSha: request.candidateCommit
                })
          })
  }
  const integrator = Integrator.of({
    prepare: (request) =>
      integratorOutcomeMode === "NotPrepared"
        ? Effect.succeed(
            IntegratorResult.cases.NotPrepared.make({
              correlation: request.correlation,
              detail: IntegratorNotPreparedDetail.make(
                "controlled cancellation conformance Integrator run was not prepared"
              )
            })
          )
        : Effect.succeed(
            IntegratorResult.cases.PreparedCandidate.make({
              candidateText: integrationCandidateText,
              correlation: request.correlation
            })
          )
  })
  const integratorGit = IntegratorGit.of({
    readCandidate: (_target, candidateText) =>
      Effect.succeed(
        IntegratorGitObservation.cases.Commit.make({
          candidateText,
          commit: integrationCandidateCommit,
          directParents: [integrationExpectedTargetHead, integrationAcceptedResult.commit]
        })
      )
  })

  const executorReportFor = (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
    executorAuthority === "Executing"
      ? PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      : PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })

  const executorForSettlement = PlannedAttemptExecutor.of({
    observe: (correlation) =>
      executorAuthority === "Unreadable"
        ? Effect.succeed(PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation }))
        : Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report: executorReportFor(correlation) })),
    requestSuspension: (attempt) =>
      Effect.succeed(
        PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: plannedAttemptExecutorCorrelation(attempt)
        })
      ),
    resume: () => Effect.die("cancellation conformance must not resume executor work"),
    begin: () => Effect.die("cancellation conformance must not continue executor work")
  })

  const graphSnapshotFor = (operation: ReturnType<typeof makeTrackerGraphObservationOperation>) => {
    const projected = projectTrackerSnapshot({
      revision: cancellationTrackerRevision,
      rootTaskId: taskId,
      tasks: [{ id: taskId, lifecycle: { _tag: graphLifecycle }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (projected._tag === "Valid") {
      graphRevisionObservations = [
        ...graphRevisionObservations,
        { operationId: operation.operationId, revision: projected.snapshot.revision }
      ]
    }
    return projected
  }

  const workflowInterpreterForSettlement = WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("cancellation conformance must not acquire a successor claim"),
    readTaskClaim: () =>
      Effect.succeed(
        claimObservationMode === "Unreadable"
          ? TaskClaimObservationUnreadable.make({ attempts: 3, taskId })
          : claimObservationMode === "Foreign"
            ? AuthoritativeTaskClaimObserved.make({ observation: foreignClaim })
            : claimObservationMode !== "Absent" && claimHeld
              ? AuthoritativeTaskClaimObserved.make({ observation: activeClaim })
              : AuthoritativeTaskClaimObserved.make({ observation: UnclaimedTask.make({ taskId }) })
      ),
    readTaskWorktree: () => Effect.die("cancellation conformance does not read worktrees"),
    readTargetLineage: () => Effect.die("cancellation conformance does not read target lineage"),
    readTrackerGraph: (operation) => {
      if (graphLifecycle === "Open" || graphLifecycle === "CompletedSuccessfully") {
        const projected = graphSnapshotFor(operation)
        if (projected._tag === "Valid") return Effect.succeed(projected.snapshot)
        return Effect.die("cancellation graph fixture was invalid")
      }
      return Effect.fail(
        new TrackerReadError({
          operation: "TrackerGraphReader.decode",
          detail: "controlled cancellation conformance graph response is unreadable"
        })
      )
    },
    readTaskWorkSpecification: () => Effect.succeed(taskSpecification),
    releaseTaskClaim: (operation) =>
      Effect.sync(() => {
        claimHeld = false
        return AuthoritativeTaskClaimReleased.make({ release: operation.release })
      }),
    reconcileTaskWorktree: () => Effect.die("cancellation conformance does not reconcile worktrees"),
    recordTaskAttemptPlan: () => Effect.die("cancellation conformance seeds the exact attempt plan")
  })

  const productionBootstrap = Effect.gen(function* () {
    const scope = yield* Scope.make()
    yield* Scope.addFinalizer(scope, Scope.close(scope, Exit.void))
    const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage))).pipe(
      Effect.provideService(Scope.Scope, scope)
    )
    const dependencies = Layer.mergeAll(
      Layer.succeed(JournalStore, storage),
      Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
      Layer.succeed(CoordinatorOwnership, ownership)
    )
    const executorLayer = controlledSynchronousPlannedAttemptExecutorLayer(
      Layer.succeed(PlannedAttemptExecutor, executorForSettlement)
    )
    const exitShell = yield* makeExitShell(ownership, { requestEnd: () => Effect.void }).pipe(
      Effect.provideService(Scope.Scope, scope)
    )
    const context = yield* Layer.build(
      journaledRunBootstrapLayer(
        runId,
        ({ runId: activeRunId }) => runtimeLayer(activeRunId, executorForSettlement, workflowInterpreterForSettlement),
        exitShell,
        noopJournalMaintenanceObservation
      ).pipe(Layer.provide(dependencies), Layer.provide(executorLayer))
    ).pipe(Effect.provideService(Scope.Scope, scope))
    applicationExit = exitShell
    return Context.get(context, JournaledRunBootstrap)
  })

  const stopRuntime = Effect.gen(function* () {
    const exitFiber = applicationExitFiber
    applicationExitFiber = undefined
    if (exitFiber !== undefined) yield* Fiber.interrupt(exitFiber).pipe(Effect.ignore)
    const fiber = runtimeFiber
    runtimeFiber = undefined
    runtimeCommands = undefined
    if (fiber !== undefined) yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
  })

  const startRuntime = Effect.gen(function* () {
    const installed = bootstrap
    if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
    const commands = yield* Queue.unbounded<RuntimeCommand>()
    const ready = yield* Deferred.make<void>()
    runtimeCommands = commands
    const program = Effect.gen(function* () {
      const journal = yield* Journal
      const protocolController = yield* PlannedAttemptProtocolController
      const runtimeResources = yield* DeliveryRuntimeResources
      const settlementLease = settlementLeaseOf(protocolController)
      const integrationLease: DeliveryActionExecutionLease = {
        ...settlementLease,
        forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (section) => section } },
        integrationTargets: runtimeResources.integrationTargets
      }
      const recovery = yield* RunRecoveryProjection
      const relations = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        recovery,
        runtimeResources.integrationTargets
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
      const acceptedFactPublication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(relations))
      const workflowInterpreter = yield* WorkflowInterpreter
      const workflowTrace = yield* WorkflowTrace
      const finalityExecutor = DeliveryActionExecutor.of({
        execute: (action, lease) =>
          action._tag === "FreshOperationAction" && action.proposal.route._tag === "TrackerGraphReadRoute"
            ? executeFreshTrackerGraphRead(action, action.proposal.route, lease).pipe(
                Effect.provideService(WorkflowInterpreter, workflowInterpreter),
                Effect.provideService(WorkflowTrace, workflowTrace)
              )
            : Effect.succeed({
                _tag: "ActionDeferred" as const,
                proposalId: action.proposal.id,
                reason: "TrackerGraphReadUnavailable" as const
              })
      })
      const finalityPlanner = PlannedTaskAttemptPlanner.of({
        plan: () => Effect.die("cancellation finality unexpectedly planned new task work")
      })
      const ensureIntegrationTarget = Effect.gen(function* () {
        const fixture = integrationFixture
        if (fixture === undefined) return yield* Effect.die("integration fixture was not prepared")
        yield* runtimeResources.integrationTargets.acquire(fixture.responsibility)
        yield* runtimeResources.integrationTargets.publishAcceptedOwnership(fixture.responsibility)
      })
      const readGraphThroughProduction = (operationNumber: number, lifecycle: "Open" | "CompletedSuccessfully") =>
        Effect.gen(function* () {
          graphLifecycle = lifecycle
          const operation = makeTrackerGraphObservationOperation(
            { _tag: "WorkflowEstablishment" },
            OperationId.make(`run-cancellation-graph-${operationNumber}`),
            target,
            [],
            [taskId]
          )
          const snapshot = yield* (yield* WorkflowInterpreter).readTrackerGraph(operation)
          const observed = (yield* journal.read(runId)).findLast(
            ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
          )
          if (observed?.event._tag !== "TaskTrackerFactsObserved") {
            return yield* Effect.die("production graph read did not persist its observation")
          }
          if (
            observed.event.observation._tag !== "CompleteTaskTrackerFacts" &&
            observed.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
          ) {
            return yield* Effect.die("production graph read did not persist complete or reconfirmed facts")
          }
          if (
            observed.event.observation.rootTaskId !== taskId ||
            observed.event.observation.factFamilies.some(
              (family) =>
                family.coverage.explicitlyCoveredTaskIds.length !== 1 ||
                family.coverage.explicitlyCoveredTaskIds[0] !== taskId
            ) ||
            snapshot.rootTaskId !== taskId
          ) {
            return yield* Effect.die("production graph read lost the exact Run root or closure coverage")
          }
          const result = { operation, snapshot, observedAt: observed.position } satisfies ClassificationGraph
          latestClassificationGraph = result
          return result
        })
      const appendAcceptedAttemptLineage = Effect.fn("RunCancellation.appendAcceptedAttemptLineage")(function* (input: {
        readonly claim: ActiveTaskClaim
        readonly claimOperation: ReturnType<typeof makeTaskClaimAcquisitionOperation>
        readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
        readonly plannedAttempt: PlannedTaskAttempt
        readonly planOperation: ReturnType<typeof makeTaskAttemptPlanOperation>
        readonly specificationOperation: ReturnType<typeof makeTaskWorkSpecificationObservationOperation>
      }) {
        const { claim, claimOperation, graphOperation, plannedAttempt, planOperation, specificationOperation } = input
        yield* journal.append(
          runId,
          intentRecordKey(claim.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(claim.operationId),
          TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
        )
        yield* journal.append(runId, intentRecordKey(graphOperation.operationId), taskTrackerReadIntent(graphOperation))
        yield* journal.append(
          runId,
          outcomeRecordKey(graphOperation.operationId),
          taskTrackerFactsObservedEvent(
            graphOperation.operationId,
            makeCompleteTaskTrackerFactsObserved(graphOperation, acceptedAttemptGraphFor(plannedAttempt))
          )
        )
        yield* journal.append(
          runId,
          intentRecordKey(specificationOperation.operationId),
          taskTrackerReadIntent(specificationOperation)
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(specificationOperation.operationId),
          taskTrackerFactsObservedEvent(
            specificationOperation.operationId,
            makeFocusedTaskWorkSpecificationFactsObserved(
              specificationOperation,
              acceptedAttemptSpecificationFor(plannedAttempt)
            )
          )
        )
        yield* journal.append(
          runId,
          attemptPlanRecordKey(plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
        )
        const worktreeOperation = makeTaskWorktreeReconciliationOperation({
          operationId: OperationId.make(`${plannedAttempt.attemptId}-worktree`),
          plannedAttempt,
          predecessorOperationIds: [planOperation.operationId]
        })
        yield* journal.append(
          runId,
          intentRecordKey(worktreeOperation.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({
            operation: worktreeOperation,
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(worktreeOperation.operationId),
          TaskWorktreeReadyEvent.make({
            operationId: worktreeOperation.operationId,
            proof: PlannedWorktreeReady.make({
              baseSha: plannedAttempt.baseSha,
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              worktree: plannedAttempt.worktree
            }),
            version: workflowJournalEventVersion
          })
        )
      })
      const appendAcceptedTerminalExecutorHistory = Effect.fn("RunCancellation.appendAcceptedTerminalExecutorHistory")(
        function* (input: {
          readonly acceptedResult: AcceptedResult
          readonly planOperation: typeof integrationPlanOperation
          readonly claim: ActiveTaskClaim
          readonly claimOperation: ReturnType<typeof makeTaskClaimAcquisitionOperation>
          readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
          readonly specificationOperation: ReturnType<typeof makeTaskWorkSpecificationObservationOperation>
          readonly plannedAttempt: PlannedTaskAttempt
        }) {
          const {
            acceptedResult,
            claim,
            claimOperation,
            graphOperation,
            plannedAttempt: terminalAttempt,
            planOperation: terminalPlanOperation,
            specificationOperation
          } = input
          const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
          const executingReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
          const terminalObservationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
          const terminalReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
          yield* appendAcceptedAttemptLineage({
            claim,
            claimOperation,
            graphOperation,
            planOperation: terminalPlanOperation,
            plannedAttempt: terminalAttempt,
            specificationOperation
          })
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkResponsibilityBeganRecordKey(terminalAttempt.attemptId),
            PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
              plannedAttempt: terminalAttempt,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorCommandIntendedRecordKey(terminalAttempt.attemptId, beginOrdinal),
            PlannedAttemptExecutorCommandIntendedEvent.make({
              command: "Begin",
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              ordinal: beginOrdinal,
              plannedAttempt: terminalAttempt,
              version: workflowJournalEventVersion
            })
          )
          const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: plannedAttemptExecutorCorrelation(terminalAttempt)
          })
          yield* journal.append(
            runId,
            plannedAttemptExecutorCommandResponseObservedRecordKey(terminalAttempt.attemptId, beginOrdinal),
            PlannedAttemptExecutorCommandResponseObservedEvent.make({
              commandOrdinal: beginOrdinal,
              occurrenceClassification: "NonActionOccurrence",
              plannedAttempt: terminalAttempt,
              report: executingReport,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkReportedRecordKey(terminalAttempt.attemptId, executingReportOrdinal),
            PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal: executingReportOrdinal,
              report: executingReport,
              version: workflowJournalEventVersion
            })
          )
          const terminalReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation: plannedAttemptExecutorCorrelation(terminalAttempt),
            result: { _tag: "Accepted", acceptedResult }
          })
          yield* journal.append(
            runId,
            plannedAttemptExecutorStateObservedRecordKey(terminalAttempt.attemptId, terminalObservationOrdinal),
            PlannedAttemptExecutorStateObservedEvent.make({
              observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
                report: terminalReport
              }),
              occurrenceClassification: "NonActionOccurrence",
              ordinal: terminalObservationOrdinal,
              plannedAttempt: terminalAttempt,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkReportedRecordKey(terminalAttempt.attemptId, terminalReportOrdinal),
            PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal: terminalReportOrdinal,
              report: terminalReport,
              version: workflowJournalEventVersion
            })
          )
        }
      )
      yield* Deferred.succeed(ready, undefined)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the runtime remains leased until crash or init.
      while (true) {
        const command = yield* Queue.take(commands)
        if (command._tag === "SeedExecutingAttempt") {
          yield* appendAcceptedAttemptLineage({
            claim: activeClaim,
            claimOperation: claimAcquisitionOperation,
            graphOperation,
            planOperation,
            plannedAttempt,
            specificationOperation
          })
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
            PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
          const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
          yield* journal.append(
            runId,
            plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, beginOrdinal),
            PlannedAttemptExecutorCommandIntendedEvent.make({
              command: "Begin",
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              ordinal: beginOrdinal,
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
          const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
          })
          yield* journal.append(
            runId,
            plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, beginOrdinal),
            PlannedAttemptExecutorCommandResponseObservedEvent.make({
              commandOrdinal: beginOrdinal,
              occurrenceClassification: "NonActionOccurrence",
              plannedAttempt,
              report: executingReport,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkReportedRecordKey(
              plannedAttempt.attemptId,
              PlannedAttemptExecutorReportOrdinal.make(1)
            ),
            PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
              report: executingReport,
              version: workflowJournalEventVersion
            })
          )
          const seededState = yield* journal.state.get
          if (seededState.position !== JournalPosition.make(records.length)) {
            return yield* Effect.die(
              `cancellation seed publication ended at ${seededState.position}, storage ended at ${records.length}`
            )
          }
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "PublishGraph") {
          yield* readGraphThroughProduction(command.operationNumber, "Open")
          const current = yield* journal.state.get
          const frame = yield* journaledCurrentDeliveryFrameOf(current)
          effectivePause = frame.pause.run._tag
          yield* Deferred.succeed(command.completed, effectivePause)
        } else if (command._tag === "PublishUnreadableGraph") {
          const operation = makeTrackerGraphObservationOperation(
            { _tag: "WorkflowEstablishment" },
            OperationId.make(`run-cancellation-unreadable-graph-${command.operationNumber}`),
            target,
            [],
            [taskId]
          )
          graphLifecycle = "Unreadable"
          const result = yield* Effect.exit((yield* WorkflowInterpreter).readTrackerGraph(operation))
          if (Exit.isSuccess(result)) return yield* Effect.die("unreadable graph fixture unexpectedly succeeded")
          graphLifecycle = "Open"
          const observed = (yield* journal.read(runId)).findLast(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" &&
              event.operationId === operation.operationId &&
              event.observation._tag === "TaskTrackerFactsReadFailed"
          )
          if (observed === undefined)
            return yield* Effect.die("production unreadable graph did not persist its failure")
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "TerminateWithGraph") {
          graphLifecycle = command.graphLifecycle
          if (!command.useExistingRead) {
            yield* readGraphThroughProduction(command.operationNumber, command.graphLifecycle)
          } else if (latestClassificationGraph === undefined) {
            return yield* Effect.die("production finality handoff had no established graph read")
          }
          const proof = yield* runStabilizedDelivery(target, runId, relation).pipe(
            Effect.provideService(DeliveryActionExecutor, finalityExecutor),
            Effect.provideService(DeliveryAcceptedFactPublication, acceptedFactPublication),
            Effect.provideService(PlannedTaskAttemptPlanner, finalityPlanner)
          )
          if (!("disposition" in proof) || proof.disposition !== command.disposition) {
            return yield* Effect.die(
              `production cancellation finality classified ${"disposition" in proof ? proof.disposition : proof.decision._tag}, expected ${command.disposition}`
            )
          }
          const proofObservation = records.find(
            ({ event, position }) =>
              position === proof.evidence.observedAt &&
              event._tag === "TaskTrackerFactsObserved" &&
              event.operationId === proof.evidence.operationId
          )
          if (proofObservation === undefined) {
            return yield* Effect.die("production cancellation finality lost its exact observation position")
          }
          yield* Deferred.succeed(command.completed, proof.disposition)
          return proof
        } else if (command._tag === "ObserveUnreadableExecutor") {
          const transition = RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt })
          const result = yield* executePlannedAttemptTransition(
            identityFreeActionFor(transition),
            transition,
            settlementLease
          ).pipe(
            Effect.as("completed" as const),
            Effect.catchTag("PlannedAttemptExecutorStateUnreadable", () => Effect.succeed("unreadable" as const))
          )
          if (result !== "unreadable")
            return yield* Effect.die("production executor unreadable observation unexpectedly completed")
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "ExecutePlannedSettlement") {
          yield* executePlannedAttemptTransition(command.action, command.transition, settlementLease)
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "ExecuteRecoveredSettlement") {
          yield* executeNewRecoveredAction(command.action, command.operationId, settlementLease, runId)
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "PrepareIntegrationQualification") {
          const currentFixture = integrationFixture
          if (currentFixture === undefined) {
            yield* appendAcceptedTerminalExecutorHistory({
              acceptedResult: integrationAcceptedResult,
              claim: integrationClaim,
              claimOperation: integrationClaimAcquisitionOperation,
              graphOperation: integrationGraphOperation,
              planOperation: integrationPlanOperation,
              plannedAttempt: integrationPlannedAttempt,
              specificationOperation: integrationSpecificationOperation
            })
            const began = yield* journal.append(
              runId,
              integrationResponsibilityBeganRecordKey(integrationPlannedAttempt.attemptId),
              IntegrationResponsibilityBeganEvent.make({
                acceptedResult: integrationAcceptedResult,
                integrationTarget,
                plannedAttempt: integrationPlannedAttempt,
                version: workflowJournalEventVersion
              })
            )
            const started = yield* journal.append(
              runId,
              integrationStartedRecordKey(integrationPlannedAttempt.attemptId),
              IntegrationStartedEvent.make({
                acceptedResult: integrationAcceptedResult,
                integrationTarget,
                plannedAttempt: integrationPlannedAttempt,
                responsibilityBeganAt: began.position,
                version: workflowJournalEventVersion
              })
            )
            const lineageOperation = makeTargetLineageObservationOperation({
              integrationTarget,
              operationId: OperationId.make("run-cancellation-integration-lineage"),
              plannedAttempt: integrationPlannedAttempt,
              predecessorOperationIds: []
            })
            yield* journal.append(
              runId,
              intentRecordKey(lineageOperation.operationId),
              GitReadIntentRecordedEvent.make({
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                operation: lineageOperation,
                version: workflowJournalEventVersion
              })
            )
            const lineageObserved = yield* journal.append(
              runId,
              outcomeRecordKey(lineageOperation.operationId),
              TargetLineageObservedEvent.make({
                observation: TargetLineageObservation.make({
                  plannedBaseIsAncestorOfTargetHead: true,
                  plannedBaseSha: integrationPlannedAttempt.baseSha,
                  targetHeadSha: integrationExpectedTargetHead
                }),
                occurrenceClassification: "NonActionOccurrence",
                operationId: lineageOperation.operationId,
                plannedAttempt: integrationPlannedAttempt,
                version: workflowJournalEventVersion
              })
            )
            const responsibility = StartedIntegrationResponsibility.make({
              acceptedResult: integrationAcceptedResult,
              integrationTarget,
              plannedAttempt: integrationPlannedAttempt,
              queuedAt: began.position,
              startedAt: started.position
            })
            const lineage = TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: integrationPlannedAttempt.baseSha,
              targetHeadSha: integrationExpectedTargetHead
            })
            const preparation = IntegratorPreparationInput.make({
              responsibility,
              targetLineage: lineage,
              targetLineageObservedAt: lineageObserved.position
            })
            const run = { ordinal: IntegratorRunOrdinal.make(1), session: integratorCorrelationFor(preparation) }
            const fixtureWithoutCandidate = { lineage, responsibility, run }
            integrationFixture = {
              ...fixtureWithoutCandidate,
              candidate: IntegratorRunQualifiedCandidate.make({
                candidateCommit: integrationCandidateCommit,
                candidateText: integrationCandidateText,
                directParents: [integrationExpectedTargetHead, integrationAcceptedResult.commit],
                qualifiedAt: JournalPosition.make(Number(lineageObserved.position) + 1),
                run
              })
            }
            yield* ensureIntegrationTarget
            const result = yield* executeIntegrationAction(
              identityFreeIntegrationActionFor(integrationRunTransitionFor(integrationFixture), responsibility),
              integrationRunTransitionFor(integrationFixture),
              integrationLease,
              target
            )
            if (result._tag !== "ActionCompleted") {
              return yield* Effect.die(`production Integrator qualification was not completed: ${result._tag}`)
            }
            const qualified = yield* journal.read(runId)
            const observed = qualified.findLast(
              (record) =>
                record.event._tag === "IntegratorRunCandidateGitObserved" &&
                record.event.run.session.sessionId === run.session.sessionId
            )
            if (observed?.event._tag !== "IntegratorRunCandidateGitObserved") {
              return yield* Effect.die("production Integrator qualification did not persist Git evidence")
            }
            integrationFixture = {
              ...fixtureWithoutCandidate,
              candidate: IntegratorRunQualifiedCandidate.make({
                candidateCommit: integrationCandidateCommit,
                candidateText: integrationCandidateText,
                directParents: [integrationExpectedTargetHead, integrationAcceptedResult.commit],
                qualifiedAt: observed.position,
                run
              })
            }
          } else {
            yield* ensureIntegrationTarget
          }
          if (integrationQuarantineFixture === undefined) {
            const preparedFixture = integrationFixture
            if (preparedFixture === undefined) return yield* Effect.die("normal integration fixture was not prepared")
            yield* appendAcceptedTerminalExecutorHistory({
              acceptedResult: quarantineAcceptedResult,
              claim: quarantineClaim,
              claimOperation: quarantineClaimAcquisitionOperation,
              graphOperation: quarantineGraphOperation,
              planOperation: quarantineIntegrationPlanOperation,
              plannedAttempt: quarantinePlannedAttempt,
              specificationOperation: quarantineSpecificationOperation
            })
            const quarantineBegan = yield* journal.append(
              runId,
              integrationResponsibilityBeganRecordKey(quarantinePlannedAttempt.attemptId),
              IntegrationResponsibilityBeganEvent.make({
                acceptedResult: quarantineAcceptedResult,
                integrationTarget,
                plannedAttempt: quarantinePlannedAttempt,
                version: workflowJournalEventVersion
              })
            )
            const quarantineStarted = yield* journal.append(
              runId,
              integrationStartedRecordKey(quarantinePlannedAttempt.attemptId),
              IntegrationStartedEvent.make({
                acceptedResult: quarantineAcceptedResult,
                integrationTarget,
                plannedAttempt: quarantinePlannedAttempt,
                responsibilityBeganAt: quarantineBegan.position,
                version: workflowJournalEventVersion
              })
            )
            const quarantineLineage = TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: quarantinePlannedAttempt.baseSha,
              targetHeadSha: integrationExpectedTargetHead
            })
            const quarantineLineageOperation = makeTargetLineageObservationOperation({
              integrationTarget,
              operationId: OperationId.make("run-cancellation-quarantine-lineage"),
              plannedAttempt: quarantinePlannedAttempt,
              predecessorOperationIds: []
            })
            yield* journal.append(
              runId,
              intentRecordKey(quarantineLineageOperation.operationId),
              GitReadIntentRecordedEvent.make({
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                operation: quarantineLineageOperation,
                version: workflowJournalEventVersion
              })
            )
            const quarantineLineageObserved = yield* journal.append(
              runId,
              outcomeRecordKey(quarantineLineageOperation.operationId),
              TargetLineageObservedEvent.make({
                observation: quarantineLineage,
                occurrenceClassification: "NonActionOccurrence",
                operationId: quarantineLineageOperation.operationId,
                plannedAttempt: quarantinePlannedAttempt,
                version: workflowJournalEventVersion
              })
            )
            const quarantineResponsibility = StartedIntegrationResponsibility.make({
              acceptedResult: quarantineAcceptedResult,
              integrationTarget,
              plannedAttempt: quarantinePlannedAttempt,
              queuedAt: quarantineBegan.position,
              startedAt: quarantineStarted.position
            })
            const quarantinePreparation = IntegratorPreparationInput.make({
              responsibility: quarantineResponsibility,
              targetLineage: quarantineLineage,
              targetLineageObservedAt: quarantineLineageObserved.position
            })
            const quarantineRun = {
              ordinal: IntegratorRunOrdinal.make(1),
              session: integratorCorrelationFor(quarantinePreparation)
            }
            const previousIntegratorOutcomeMode = integratorOutcomeMode
            integratorOutcomeMode = "NotPrepared"
            const protocolResult = yield* prepareIntegrationCandidateRun({
              preparation: quarantinePreparation,
              run: quarantineRun
            }).pipe(Effect.ensuring(Effect.sync(() => (integratorOutcomeMode = previousIntegratorOutcomeMode))))
            if (protocolResult._tag !== "NotPrepared") {
              return yield* Effect.die(
                `production Integrator quarantine setup was not conclusive: ${protocolResult._tag}`
              )
            }
            yield* runtimeResources.integrationTargets.acquire(quarantineResponsibility)
            yield* runtimeResources.integrationTargets.publishAcceptedOwnership(quarantineResponsibility)
            const transition = RunnableFrontierTransition.RecordInitialConclusiveIntegrationQuarantine({
              result: protocolResult,
              responsibility: quarantineResponsibility
            })
            const result = yield* executeIntegrationAction(
              identityFreeIntegrationActionFor(transition, quarantineResponsibility),
              transition,
              integrationLease,
              target
            )
            if (result._tag !== "ActionCompleted") {
              return yield* Effect.die(`production integration quarantine was not completed: ${result._tag}`)
            }
            if (
              !(yield* journal.read(runId)).some(
                ({ event }) =>
                  event._tag === "IntegrationQuarantined" &&
                  event.correlation.sessionId === quarantineRun.session.sessionId
              )
            ) {
              return yield* Effect.die("production Integrator quarantine did not persist its exact Q record")
            }
            integrationQuarantineFixture = {
              responsibility: quarantineResponsibility,
              lineage: quarantineLineage,
              lineageObservedAt: quarantineLineageObserved.position,
              run: quarantineRun
            }
          }
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "ObserveUnreadableIntegration") {
          const fixture = integrationFixture
          if (fixture === undefined) return yield* Effect.die("integration fixture was not prepared")
          yield* ensureIntegrationTarget
          promotionReadMode = "Unreadable"
          const transition = RunnableFrontierTransition.RunTargetPromotion({
            candidate: fixture.candidate,
            responsibility: fixture.responsibility
          })
          const result = yield* executeIntegrationAction(
            identityFreeIntegrationActionFor(transition, fixture.responsibility),
            transition,
            integrationLease,
            target
          ).pipe(
            Effect.as("completed" as const),
            Effect.catchTag("TargetPromotionGitReadFailure", () => Effect.succeed("unreadable" as const))
          )
          promotionReadMode = "Exact"
          if (result !== "unreadable") {
            return yield* Effect.die("production integration unreadable read unexpectedly completed")
          }
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "RunIntegrationPromotion" || command._tag === "ObserveIntegrationPromotion") {
          const fixture = integrationFixture
          if (fixture === undefined) return yield* Effect.die("integration fixture was not prepared")
          yield* ensureIntegrationTarget
          const result = yield* executeIntegrationAction(
            identityFreeIntegrationActionFor(
              RunnableFrontierTransition.RunTargetPromotion({
                candidate: fixture.candidate,
                responsibility: fixture.responsibility
              }),
              fixture.responsibility
            ),
            RunnableFrontierTransition.RunTargetPromotion({
              candidate: fixture.candidate,
              responsibility: fixture.responsibility
            }),
            integrationLease,
            target
          )
          if (result._tag !== "ActionCompleted") {
            return yield* Effect.die(`production integration promotion was not completed: ${result._tag}`)
          }
          yield* Deferred.succeed(command.completed, undefined)
        } else if (command._tag === "RecordIntegrationQuarantine") {
          const quarantineFixture = integrationQuarantineFixture
          if (quarantineFixture === undefined)
            return yield* Effect.die("integration quarantine fixture was not prepared")
          const before = (yield* journal.read(runId)).length
          const persisted = (yield* journal.read(runId)).findLast(
            ({ event }) =>
              event._tag === "IntegrationQuarantined" &&
              event.correlation.sessionId === quarantineFixture.run.session.sessionId
          )
          const cancellation = (yield* journal.read(runId)).findLast(
            ({ event }) => event._tag === "RunCancellationApplied"
          )
          if (
            persisted?.event._tag !== "IntegrationQuarantined" ||
            persisted.event.basis._tag !== "ConclusiveResult" ||
            persisted.event.basis.cause._tag !== "NotPrepared" ||
            cancellation?.event._tag !== "RunCancellationApplied" ||
            persisted.position >= cancellation.position
          ) {
            return yield* Effect.die("production Integrator quarantine fact was not durable before cancellation")
          }
          if ((yield* journal.read(runId)).length !== before) {
            return yield* Effect.die("MarkIntegrationQuarantined appended new history instead of reconciling Q")
          }
          yield* Deferred.succeed(command.completed, undefined)
        } else {
          const fixture = integrationFixture
          if (fixture === undefined) return yield* Effect.die("integration fixture was not prepared")
          const result = yield* executeIntegrationAction(
            identityFreeIntegrationActionFor(
              RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility: fixture.responsibility }),
              fixture.responsibility
            ),
            RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility: fixture.responsibility }),
            integrationLease,
            target
          )
          if (result._tag !== "ActionCompleted") {
            return yield* Effect.die(`production integration release was not completed: ${result._tag}`)
          }
          yield* Deferred.succeed(command.completed, undefined)
        }
      }
    })
    const scope = runCancellationMbtScope
    if (scope === undefined) return yield* Effect.die("cancellation MBT scope was not installed")
    const fiber = yield* Effect.forkScoped(
      installed.activate(
        target,
        Effect.succeed(initialPolicy),
        AllocatedWorkflowRunId.make(runId),
        program.pipe(
          Effect.provide(
            deterministicTaskClaimAcquisitionPlannerLayer({
              owner: ClaimOwner.make("dalph-run-cancellation-planner"),
              tokenPrefix: "run-cancellation"
            })
          ),
          Effect.provideService(CoordinatorOwnership, ownership),
          Effect.provideService(Integrator, integrator),
          Effect.provideService(IntegratorGit, integratorGit),
          Effect.provideService(TargetPromotionRuntime, TargetPromotionRuntime.of({ git: targetPromotionGit }))
        )
      )
    ).pipe(Effect.provideService(Scope.Scope, scope))
    runtimeFiber = fiber
    yield* Deferred.await(ready).pipe(Effect.orDie)
  })

  const publishGraphAndInspectPause = (operationNumber: number) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<"RunPaused" | "RunUnpaused">()
      yield* Queue.offer(commands, { _tag: "PublishGraph", completed, operationNumber })
      const fiber = runtimeFiber
      const pause =
        fiber === undefined
          ? yield* Deferred.await(completed)
          : yield* Effect.raceFirst(
              Deferred.await(completed),
              Fiber.join(fiber).pipe(
                Effect.flatMap(() => Effect.die("cancellation runtime exited before publishing graph facts"))
              )
            )
      if (durable.cancellationApplied && pause !== "RunPaused") {
        return yield* Effect.die("production delivery did not borrow cancellation's effective Run Pause")
      }
      effectivePause = pause
    })

  const publishUnreadableGraph = (operationNumber: number) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<void>()
      yield* Queue.offer(commands, { _tag: "PublishUnreadableGraph", completed, operationNumber })
      yield* awaitSettlementCommand(completed)
    })

  const awaitSettlementCommand = (completed: Deferred.Deferred<void>) => {
    const fiber = runtimeFiber
    return fiber === undefined
      ? Deferred.await(completed)
      : Effect.raceFirst(
          Deferred.await(completed),
          Fiber.join(fiber).pipe(
            Effect.flatMap(() => Effect.die("cancellation runtime exited before settlement command completed"))
          )
        )
  }

  const awaitTerminalCommand = (completed: Deferred.Deferred<RunTerminationDisposition>) => {
    const fiber = runtimeFiber
    return fiber === undefined
      ? Deferred.await(completed)
      : Effect.raceFirst(Deferred.await(completed), Fiber.join(fiber).pipe(Effect.andThen(Deferred.await(completed))))
  }

  const terminateWithGraph = (input: {
    readonly disposition: RunTerminationDisposition
    readonly graphLifecycle: "Open" | "CompletedSuccessfully"
    readonly operationNumber: number
    readonly useExistingRead: boolean
  }) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<RunTerminationDisposition>()
      yield* Queue.offer(commands, { _tag: "TerminateWithGraph", completed, ...input })
      const disposition = yield* awaitTerminalCommand(completed)
      const fiber = runtimeFiber
      if (fiber !== undefined) yield* Fiber.join(fiber)
      const terminal = records.findLast(({ event }) => event._tag === "WorkflowRunTerminated")
      if (terminal?.event._tag !== "WorkflowRunTerminated" || terminal.event.disposition !== disposition) {
        return yield* Effect.die("production finality handoff did not append its exact terminal record")
      }
      return disposition
    })

  const observeUnreadableExecutor = Effect.gen(function* () {
    const commands = runtimeCommands
    if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
    const completed = yield* Deferred.make<void>()
    yield* Queue.offer(commands, { _tag: "ObserveUnreadableExecutor", completed })
    yield* awaitSettlementCommand(completed)
  })

  const observeUnreadableIntegration = Effect.gen(function* () {
    const commands = runtimeCommands
    if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
    const completed = yield* Deferred.make<void>()
    yield* Queue.offer(commands, { _tag: "ObserveUnreadableIntegration", completed })
    yield* awaitSettlementCommand(completed)
  })

  const executePlannedSettlement = (transition: SettlementPlannedTransition) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<void>()
      yield* Queue.offer(commands, {
        _tag: "ExecutePlannedSettlement",
        action: identityFreeActionFor(transition),
        completed,
        transition
      })
      yield* awaitSettlementCommand(completed)
    })

  const executeRecoveredSettlement = (action: NewRecoveredWorkflowAction, operationId: OperationId) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<void>()
      yield* Queue.offer(commands, { _tag: "ExecuteRecoveredSettlement", action, completed, operationId })
      yield* awaitSettlementCommand(completed)
    })

  const executeIntegrationCommand = (
    tag: Extract<
      RuntimeCommand["_tag"],
      | "PrepareIntegrationQualification"
      | "RunIntegrationPromotion"
      | "ObserveIntegrationPromotion"
      | "ReleaseIntegration"
    >
  ) =>
    Effect.gen(function* () {
      const commands = runtimeCommands
      if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
      const completed = yield* Deferred.make<void>()
      yield* Queue.offer(commands, { _tag: tag, completed })
      yield* awaitSettlementCommand(completed)
    })

  const seedExecutingAttempt = Effect.gen(function* () {
    const commands = runtimeCommands
    if (commands === undefined) return yield* Effect.die("cancellation runtime is not active")
    const completed = yield* Deferred.make<void>()
    yield* Queue.offer(commands, { _tag: "SeedExecutingAttempt", completed })
    yield* awaitSettlementCommand(completed)
  })

  const relinquishCancelledAttempt = Effect.gen(function* () {
    const safeReport = records.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "ExecutorWorkSafelySuspended" &&
        event.report.correlation.attemptId === plannedAttempt.attemptId
    )
    if (safeReport === undefined || safeReport.event._tag !== "PlannedAttemptExecutorWorkReported") {
      return yield* Effect.die("cancelled-attempt relinquishment requires the accepted safe executor report")
    }
    yield* executePlannedSettlement(
      RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
        plannedAttempt,
        proof: { _tag: "AcceptedReport", reportOrdinal: safeReport.event.ordinal }
      })
    )
    if (
      !records.some(
        ({ event }) =>
          event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
          event.plannedAttempt.attemptId === plannedAttempt.attemptId
      )
    ) {
      return yield* Effect.die("production cancellation adapter did not persist responsibility relinquishment")
    }
  })

  const cancelledClaimReleaseTransition = () =>
    Effect.gen(function* () {
      const cancellation = records.findLast(({ event }) => event._tag === "RunCancellationApplied")
      const relinquishment = records.findLast(
        ({ event }) =>
          event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
          event.plannedAttempt.attemptId === plannedAttempt.attemptId
      )
      if (
        cancellation === undefined ||
        relinquishment === undefined ||
        cancellation.event._tag !== "RunCancellationApplied" ||
        relinquishment.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished"
      ) {
        return yield* Effect.die("cancellation claim release requires durable cancellation and relinquishment")
      }
      const operation = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
          cancellationAppliedAt: cancellation.position,
          implementationRelinquishedAt: relinquishment.position,
          observationOperationId: claimReadOperationId
        }),
        predecessorOperationIds: [activeClaim.operationId, claimReadOperationId],
        release: { claim: activeClaim, operationId: claimReleaseOperationId }
      })
      return RunnableFrontierTransition.ReleaseCancelledAttemptClaim({ operation, plannedAttempt })
    })

  const observeClaimThroughProduction = (
    operation: typeof claimReadOperation,
    operationId: OperationId,
    mode: "Absent" | "Foreign" | "Unreadable"
  ) =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ObserveCancelledAttemptClaim({ operation, plannedAttempt })
      const action = newRecoveredActionOf(transition)
      if (action === undefined) return yield* Effect.die("production claim observation route was not derived")
      claimObservationMode = mode
      yield* executeRecoveredSettlement(action, operationId)
      claimObservationMode = "Exact"
      const observed = records.findLast(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operationId
      )
      if (observed?.event._tag !== "TaskTrackerFactsObserved") {
        return yield* Effect.die("production claim observation did not persist its focused facts")
      }
      const expectedTag = mode === "Unreadable" ? "FocusedTaskClaimFactsUnreadable" : "FocusedTaskClaimFacts"
      if (observed.event.observation._tag !== expectedTag) {
        return yield* Effect.die(`production claim observation returned ${observed.event.observation._tag}`)
      }
      return observed.event.observation
    })

  const resetAfterProcessLoss = () => {
    const outstandingExecutor = durable.executor !== "NoExecutor" && durable.executor !== "SafelySuspended"
    const outstanding = !(
      (durable.executor === "NoExecutor" || durable.executor === "SafelySuspended") &&
      (durable.claim === "NoClaim" || durable.claim === "Released" || durable.claim === "ForeignClaim") &&
      (durable.integration === "NoIntegration" || durable.integration === "IntegrationSettled")
    )
    process = {
      phase: "ProcessLost",
      requestedRunId: durable.runId,
      requestedTarget: durable.target,
      paused: process.paused,
      admissionOpen: false,
      exitCutoff: false,
      executorPositionHeld: outstandingExecutor,
      responsibilitiesSettled: !outstanding,
      graphRead: false,
      graph: "NoGraph",
      forwardAdmissions: process.forwardAdmissions,
      freshAfterRestart: false,
      cancellationRejected: false
    }
  }

  const implementation = {
    init: () =>
      Effect.gen(function* () {
        yield* stopRuntime
        if (bootstrap === undefined) bootstrap = yield* productionBootstrap
        records = []
        durable = makeInitialDurable()
        process = makeInitialProcess()
        effectivePause = undefined
        executorAuthority = "Executing"
        claimHeld = true
        claimObservationMode = "Exact"
        promotionReadCount = 0
        promotionReadMode = "Exact"
        graphLifecycle = "Open"
        latestClassificationGraph = undefined
        graphRevisionObservations = []
        integratorOutcomeMode = "Prepared"
        integrationFixture = undefined
        integrationQuarantineFixture = undefined
        yield* startRuntime
      }),
    selectIdleRun: () =>
      Effect.sync(() => {
        process = { ...process, executorPositionHeld: false, responsibilitiesSettled: true, graph: "NotAllSucceeded" }
      }),
    selectAlreadyPausedRun: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const applied = yield* installed.operatorControl.applyControlDirection({
          direction: "Pause",
          subject: { _tag: "Run", runId }
        })
        if (applied.event._tag !== "ControlDirectionApplied" || applied.event.direction !== "Pause") {
          return yield* Effect.die("production pause boundary did not persist the Run Pause direction")
        }
        process = {
          ...process,
          paused: true,
          admissionOpen: false,
          executorPositionHeld: false,
          responsibilitiesSettled: true,
          graph: "NotAllSucceeded"
        }
      }),
    selectExecutingExecutor: () =>
      Effect.gen(function* () {
        yield* seedExecutingAttempt
        durable = { ...durable, executor: "Executing", claim: "Held", integration: "NoIntegration" }
        process = { ...process, executorPositionHeld: true, responsibilitiesSettled: false }
      }),
    selectIntegrationOwned: () =>
      Effect.gen(function* () {
        yield* executeIntegrationCommand("PrepareIntegrationQualification")
        durable = { ...durable, integration: "IntegrationOwned" }
        process = { ...process, responsibilitiesSettled: false }
      }),
    selectTemporaryWait: () => Effect.sync(() => (process = { ...process, graph: "TemporaryWait" })),
    selectApplicationExitCutoff: () =>
      Effect.gen(function* () {
        const exitShell = applicationExit
        if (exitShell === undefined) return yield* Effect.die("application Exit shell was not installed")
        applicationExitFiber = yield* exitShell.requestBoundary.requestExit.pipe(Effect.forkChild)
        yield* exitShell.awaitExitRequested
        process = { ...process, exitCutoff: true }
      }),
    selectForeignRunRequest: () => Effect.sync(() => (process = { ...process, requestedRunId: "R2" })),
    selectTerminalHistory: () =>
      Effect.gen(function* () {
        yield* terminateWithGraph({
          disposition: "Completed",
          graphLifecycle: "CompletedSuccessfully",
          operationNumber: durable.classificationReads + 1,
          useExistingRead: false
        })
        durable = { ...durable, terminalHistory: "Completed" }
        process = { ...process, phase: "TerminalHistory", admissionOpen: false }
      }),
    applyCancellation: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const result = yield* installed.operatorControl.applyRunCancellation({ runId })
        if (result._tag !== "RunCancellationApplied")
          return yield* Effect.die(`unexpected production cancellation result ${result._tag}`)
        const current = yield* Effect.succeed(reduceWorkflowJournalHistory(runId, records))
        if (
          current._tag !== "ValidWorkflowJournalHistory" ||
          current.runState.cancellation._tag !== "RunCancellationApplied"
        ) {
          return yield* Effect.die("production cancellation append did not reconstruct")
        }
        if (records.filter(({ event }) => event._tag === "RunCancellationApplied").length !== 1) {
          return yield* Effect.die("production cancellation append was not exact")
        }
        durable = { ...durable, cancellationApplied: true, cancellationAppends: durable.cancellationAppends + 1 }
        process = { ...process, phase: "Cancelling", admissionOpen: false, cancellationRejected: false }
      }),
    redeliverCancellation: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const before = records.length
        const result = yield* installed.operatorControl.applyRunCancellation({ runId })
        if (result._tag !== "RunCancellationAlreadyApplied" || records.length !== before) {
          return yield* Effect.die("production cancellation redelivery appended or lost its existing result")
        }
        durable = { ...durable, cancellationRedeliveries: durable.cancellationRedeliveries + 1 }
      }),
    recordExecutorStopIntent: () =>
      Effect.gen(function* () {
        const transition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
        yield* executePlannedSettlement(transition)
        if (
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "Suspend" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          ) ||
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkExecuting" &&
              event.report.correlation.attemptId === plannedAttempt.attemptId
          )
        ) {
          return yield* Effect.die("production suspension adapter did not persist the exact intent and report")
        }
        durable = { ...durable, executor: "StopIntentRecorded", executorStopIntents: durable.executorStopIntents + 1 }
        process = { ...process, executorPositionHeld: true }
      }),
    reportExecutorSafe: () =>
      Effect.gen(function* () {
        executorAuthority = "SafelySuspended"
        yield* executePlannedSettlement(
          RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt })
        )
        if (
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "ExecutorWorkSafelySuspended" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          )
        ) {
          return yield* Effect.die("production executor observation adapter did not persist the safe report")
        }
        yield* relinquishCancelledAttempt
        durable = { ...durable, executor: "SafelySuspended", executorSafeReports: durable.executorSafeReports + 1 }
        process = { ...process, executorPositionHeld: false }
      }),
    recordClaimReleaseIntent: () =>
      Effect.gen(function* () {
        const transition = RunnableFrontierTransition.ObserveCancelledAttemptClaim({
          operation: claimReadOperation,
          plannedAttempt
        })
        const action = newRecoveredActionOf(transition)
        if (action === undefined) return yield* Effect.die("production claim observation route was not derived")
        yield* executeRecoveredSettlement(action, claimReadOperationId)
        if (
          !records.some(
            ({ event }) =>
              event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === claimReadOperationId
          ) ||
          !records.some(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" &&
              event.operationId === claimReadOperationId &&
              event.observation._tag === "FocusedTaskClaimFacts" &&
              event.observation.observation._tag === "ActiveTaskClaim" &&
              event.observation.observation.operationId === activeClaim.operationId
          )
        ) {
          return yield* Effect.die("production claim observation adapter did not persist the exact focused read")
        }
        durable = { ...durable, claim: "ReleaseIntentRecorded", claimReleaseIntents: durable.claimReleaseIntents + 1 }
      }),
    observeAndReleaseClaim: () =>
      Effect.gen(function* () {
        const transition = yield* cancelledClaimReleaseTransition()
        const action = newRecoveredActionOf(transition)
        if (action === undefined) return yield* Effect.die("production claim release route was not derived")
        yield* executeRecoveredSettlement(action, claimReleaseOperationId)
        if (
          !records.some(
            ({ event }) =>
              event._tag === "TaskClaimReleaseIntended" &&
              event.operation.release.operationId === claimReleaseOperationId
          ) ||
          !records.some(
            ({ event }) => event._tag === "TaskClaimReleased" && event.release.operationId === claimReleaseOperationId
          )
        ) {
          return yield* Effect.die("production claim release adapter did not persist intent and outcome")
        }
        durable = {
          ...durable,
          claim: "Released",
          claimReleaseObservations: durable.claimReleaseObservations + 1,
          claimReleases: durable.claimReleases + 1
        }
      }),
    observeForeignClaim: () =>
      Effect.gen(function* () {
        const observation = yield* observeClaimThroughProduction(
          foreignClaimReadOperation,
          foreignClaimReadOperationId,
          "Foreign"
        )
        if (
          observation._tag !== "FocusedTaskClaimFacts" ||
          observation.observation._tag !== "ActiveTaskClaim" ||
          observation.observation.operationId !== foreignClaim.operationId
        ) {
          return yield* Effect.die("production foreign claim observation lost the foreign owner")
        }
        durable = { ...durable, claim: "ForeignClaim", claimReleaseObservations: 1 }
        process = { ...process, responsibilitiesSettled: true }
      }),
    observeAbsentClaim: () =>
      Effect.gen(function* () {
        const observation = yield* observeClaimThroughProduction(
          absentClaimReadOperation,
          absentClaimReadOperationId,
          "Absent"
        )
        if (observation._tag !== "FocusedTaskClaimFacts" || observation.observation._tag !== "UnclaimedTask") {
          return yield* Effect.die("production absent claim observation did not retain the unclaimed disposition")
        }
        const transition = RunnableFrontierTransition.RecordCancelledAttemptClaimNoRelease({
          observationOperationId: absentClaimReadOperationId,
          plannedAttempt
        })
        yield* executePlannedSettlement(transition)
        if (
          !records.some(
            ({ event }) =>
              event._tag === "CancelledAttemptClaimNoReleaseObserved" &&
              event.observationOperationId === absentClaimReadOperationId &&
              event.observation._tag === "UnclaimedTask"
          )
        ) {
          return yield* Effect.die("production absent claim disposition was not persisted")
        }
        durable = { ...durable, claim: "NoClaim", claimReleaseObservations: 1 }
        process = { ...process, responsibilitiesSettled: true }
      }),
    markClaimUnreadable: () =>
      Effect.gen(function* () {
        const observation = yield* observeClaimThroughProduction(
          unreadableClaimReadOperation,
          unreadableClaimReadOperationId,
          "Unreadable"
        )
        if (observation._tag !== "FocusedTaskClaimFactsUnreadable") {
          return yield* Effect.die("production unreadable claim observation was not retained")
        }
        durable = { ...durable, claim: "ClaimUnreadable" }
        process = { ...process, responsibilitiesSettled: false }
      }),
    recordIntegrationIntent: () =>
      Effect.gen(function* () {
        yield* executeIntegrationCommand("RunIntegrationPromotion")
        if (
          !records.some(
            ({ event }) => event._tag === "TargetPromotionIntended" || event._tag === "TargetPromotionAttemptIntended"
          )
        ) {
          return yield* Effect.die("production integration promotion did not persist an intent boundary")
        }
        durable = {
          ...durable,
          integration: "PromotionIntentRecorded",
          integrationIntents: durable.integrationIntents + 1
        }
      }),
    observePromotedIntegration: () =>
      Effect.gen(function* () {
        yield* executeIntegrationCommand("ObserveIntegrationPromotion")
        if (!records.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")) {
          return yield* Effect.die("production integration promotion did not persist accepted Git evidence")
        }
        durable = { ...durable, integration: "PromotionAccepted", promotionAccepted: true }
      }),
    settlePromotedIntegration: () =>
      Effect.gen(function* () {
        yield* executeIntegrationCommand("ReleaseIntegration")
        durable = {
          ...durable,
          integration: "IntegrationSettled",
          integrationSettlements: durable.integrationSettlements + 1
        }
      }),
    readFreshClassificationGraph: () =>
      Effect.gen(function* () {
        const number = durable.classificationReads + 1
        yield* publishGraphAndInspectPause(number)
        durable = { ...durable, classificationReads: number }
        process = { ...process, graphRead: true }
      }),
    readTemporaryWaitGraph: () =>
      Effect.gen(function* () {
        const number = durable.classificationReads + 1
        yield* publishGraphAndInspectPause(number)
        durable = { ...durable, classificationReads: number }
        process = { ...process, graphRead: true }
      }),
    handoffToFreshClassification: () =>
      Effect.gen(function* () {
        yield* terminateWithGraph({
          disposition: "Cancelled",
          graphLifecycle: "Open",
          operationNumber: durable.classificationReads,
          useExistingRead: true
        })
        process = { ...process, phase: "ReadyForClassification" }
      }),
    crashBeforeSettlement: () =>
      Effect.gen(function* () {
        const before = records
        yield* stopRuntime
        if (records !== before) return yield* Effect.die("process loss changed durable cancellation history")
        durable = { ...durable, processLosses: durable.processLosses + 1 }
        resetAfterProcessLoss()
      }),
    restartCancellation: () =>
      Effect.gen(function* () {
        const reconstructed = reduceWorkflowJournalHistory(runId, records)
        if (
          reconstructed._tag !== "ValidWorkflowJournalHistory" ||
          reconstructed.runState.cancellation._tag !== "RunCancellationApplied"
        ) {
          return yield* Effect.die("restart did not reconstruct the applied cancellation")
        }
        yield* startRuntime
        process = {
          ...process,
          phase: "Cancelling",
          admissionOpen: false,
          freshAfterRestart: true,
          graph: "NotAllSucceeded"
        }
      }),
    reconcileExecutorAfterRestart: () =>
      Effect.gen(function* () {
        executorAuthority = "SafelySuspended"
        yield* executePlannedSettlement(
          RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt })
        )
        if (
          records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "Begin" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          ).length !== 1 ||
          records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "Suspend" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          ).length !== 1 ||
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              event.observation.report._tag === "ExecutorWorkSafelySuspended"
          )
        ) {
          return yield* Effect.die("restart executor reconciliation duplicated the command or lost safe evidence")
        }
        yield* relinquishCancelledAttempt
        durable = { ...durable, executor: "SafelySuspended", executorSafeReports: 1 }
        process = { ...process, executorPositionHeld: false }
      }),
    reconcileClaimAfterRestart: () =>
      Effect.gen(function* () {
        const transition = yield* cancelledClaimReleaseTransition()
        const action = newRecoveredActionOf(transition)
        if (action === undefined) return yield* Effect.die("restart claim release route was not derived")
        yield* executeRecoveredSettlement(action, claimReleaseOperationId)
        if (
          records.filter(
            ({ event }) =>
              event._tag === "TaskClaimReleaseIntended" &&
              event.operation.release.operationId === claimReleaseOperationId
          ).length !== 1 ||
          records.filter(
            ({ event }) => event._tag === "TaskClaimReleased" && event.release.operationId === claimReleaseOperationId
          ).length !== 1
        ) {
          return yield* Effect.die("restart claim reconciliation duplicated or lost the exact release operation")
        }
        durable = { ...durable, claim: "Released", claimReleaseObservations: 1, claimReleases: 1 }
      }),
    reconcileIntegrationAfterRestart: () =>
      Effect.gen(function* () {
        yield* executeIntegrationCommand("ObserveIntegrationPromotion")
        durable = { ...durable, integration: "PromotionAccepted", promotionAccepted: true }
      }),
    settleAfterIdleCancellation: () => Effect.sync(() => (process = { ...process, responsibilitiesSettled: true })),
    markExecutorUnreadable: () =>
      Effect.gen(function* () {
        executorAuthority = "Unreadable"
        yield* observeUnreadableExecutor
        if (
          !records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorStateObserved" &&
              event.observation._tag === "ExecutorStateUnreadable" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          )
        ) {
          return yield* Effect.die("production executor unreadable boundary did not persist its observation")
        }
        durable = { ...durable, executor: "ExecutorUnreadable" }
        process = { ...process, executorPositionHeld: true, responsibilitiesSettled: false }
      }),
    markIntegrationUnreadable: () =>
      Effect.gen(function* () {
        yield* observeUnreadableIntegration
        if (
          records.some(
            ({ event }) => event._tag === "TargetPromotionObservedSuccess" || event._tag === "TargetPromotionStale"
          )
        ) {
          return yield* Effect.die("production unreadable integration boundary published a terminal result")
        }
        durable = { ...durable, integration: "IntegrationUnreadable" }
        process = { ...process, responsibilitiesSettled: false }
      }),
    markIntegrationQuarantined: () =>
      Effect.gen(function* () {
        const fixture = integrationQuarantineFixture
        if (fixture === undefined) return yield* Effect.die("integration quarantine fixture was not prepared")
        const before = records.length
        if (
          !records.some(
            ({ event }) =>
              event._tag === "IntegrationQuarantined" && event.correlation.sessionId === fixture.run.session.sessionId
          )
        ) {
          return yield* Effect.die("production integration quarantine fact was not retained through cancellation")
        }
        if (records.length !== before)
          return yield* Effect.die("observing integration quarantine appended a duplicate fact")
        durable = { ...durable, integration: "IntegrationQuarantined" }
        process = { ...process, responsibilitiesSettled: false }
      }),
    markGraphUnreadable: () =>
      Effect.gen(function* () {
        yield* publishUnreadableGraph(durable.classificationReads + 1)
        process = { ...process, graph: "GraphUnreadable" }
      }),
    rejectCancellationAtExit: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const rejection = yield* installed.operatorControl.applyRunCancellation({ runId }).pipe(Effect.flip)
        if (rejection._tag !== "ApplicationExiting") {
          return yield* Effect.die(`production Exit race returned ${rejection._tag}`)
        }
        process = { ...process, phase: "Rejected", cancellationRejected: true }
      }),
    rejectForeignCancellation: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const rejection = yield* installed.operatorControl
          .applyRunCancellation({ runId: RunId.make("run-cancellation-R2") })
          .pipe(Effect.flip)
        if (rejection._tag !== "JournaledRunIdentityMismatch") {
          return yield* Effect.die(`foreign production cancellation returned ${rejection._tag}`)
        }
        process = { ...process, phase: "Rejected", cancellationRejected: true }
      }),
    rejectTerminalHistory: () =>
      Effect.gen(function* () {
        const installed = bootstrap
        if (installed === undefined) return yield* Effect.die("cancellation bootstrap was not installed")
        const result = yield* installed.operatorControl.applyRunCancellation({ runId })
        if (result._tag !== "RunCancellationRunTerminated" || result.disposition !== "Completed") {
          return yield* Effect.die(`production terminal-history rejection returned ${result._tag}`)
        }
        process = { ...process, phase: "TerminalHistory", cancellationRejected: true }
      }),
    admitForwardWork: () =>
      Effect.gen(function* () {
        yield* seedExecutingAttempt
        durable = { ...durable, executor: "Executing", claim: "Held", integration: "NoIntegration" }
        process = {
          ...process,
          executorPositionHeld: true,
          responsibilitiesSettled: false,
          forwardAdmissions: process.forwardAdmissions + 1
        }
      }),
    getProductionEvidence: () => {
      const reconstructed = reduceWorkflowJournalHistory(runId, records)
      const terminated = records.findLast(({ event }) => event._tag === "WorkflowRunTerminated")
      return Effect.succeed({
        eventTags: records.map(({ event }) => event._tag),
        observationTags: records.flatMap(({ event }) =>
          event._tag === "TaskTrackerFactsObserved" ? [event.observation._tag] : []
        ),
        graphRevisions: graphRevisionObservations,
        cancellation:
          reconstructed._tag === "ValidWorkflowJournalHistory" ? reconstructed.runState.cancellation._tag : "Invalid",
        termination:
          terminated?.event._tag === "WorkflowRunTerminated"
            ? {
                disposition: terminated.event.disposition,
                evidence: terminated.event.evidence,
                position: terminated.position
              }
            : undefined,
        effectivePause
      })
    },
    getState: () => Effect.succeed(projectionOf(durable, process))
  }

  return implementation
}

const runCancellationDriver = defineDriver(makeRunCancellationActions, makeCancellationDriverImplementation)

it.effect("rejects contradictory duplicate journal keys in the cancellation journal fake", () =>
  Effect.gen(function* () {
    let records: ReadonlyArray<JournalRecord> = []
    const storage = makeStorage(
      () => records,
      (next) => (records = next)
    )
    const key = intentRecordKey(activeClaim.operationId)
    const intended = TaskClaimAcquisitionIntendedEvent.make({
      operation: claimAcquisitionOperation,
      version: workflowJournalEventVersion
    })
    const conflicting = TaskClaimAcquiredEvent.make({ claim: activeClaim, version: workflowJournalEventVersion })
    const first = yield* storage.append(runId, key, intended)
    const repeated = yield* storage.append(runId, key, intended)
    expect(repeated.position).toBe(first.position)
    const failure = yield* storage.append(runId, key, conflicting).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(JournalStoreContradiction)
    expect(records).toHaveLength(1)
  })
)

const withCancellationDriver = <A, E>(
  use: (driver: ReturnType<typeof makeCancellationDriverImplementation>) => Effect.Effect<A, E>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const driver = makeCancellationDriverImplementation()
      runCancellationMbtScope = scope
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (runCancellationMbtScope === scope) runCancellationMbtScope = undefined
        })
      )
      return yield* use(driver)
    })
  )

const stateCheckProjection = stateCheck(
  (raw) =>
    Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
      Effect.map(
        ({ state }): DriverProjection => ({
          state: {
            durable: {
              runId: state.durable.runId.tag,
              target: state.durable.target.tag,
              cancellationApplied: state.durable.cancellationApplied,
              cancellationAppends: Number(state.durable.cancellationAppends),
              cancellationRedeliveries: Number(state.durable.cancellationRedeliveries),
              cancellationActor: state.durable.cancellationActor.tag,
              executor: state.durable.executor.tag,
              claim: state.durable.claim.tag,
              integration: state.durable.integration.tag,
              worktreePreserved: state.durable.worktreePreserved,
              logsPreserved: state.durable.logsPreserved,
              evidencePreserved: state.durable.evidencePreserved,
              executorStopIntents: Number(state.durable.executorStopIntents),
              executorSafeReports: Number(state.durable.executorSafeReports),
              claimReleaseIntents: Number(state.durable.claimReleaseIntents),
              claimReleaseObservations: Number(state.durable.claimReleaseObservations),
              claimReleases: Number(state.durable.claimReleases),
              integrationIntents: Number(state.durable.integrationIntents),
              integrationSettlements: Number(state.durable.integrationSettlements),
              promotionAccepted: state.durable.promotionAccepted,
              terminalHistory: state.durable.terminalHistory.tag,
              processLosses: Number(state.durable.processLosses),
              classificationReads: Number(state.durable.classificationReads)
            },
            process: {
              phase: state.process.phase.tag,
              requestedRunId: state.process.requestedRunId.tag,
              requestedTarget: state.process.requestedTarget.tag,
              paused: state.process.paused,
              admissionOpen: state.process.admissionOpen,
              exitCutoff: state.process.exitCutoff,
              executorPositionHeld: state.process.executorPositionHeld,
              responsibilitiesSettled: state.process.responsibilitiesSettled,
              graphRead: state.process.graphRead,
              graph: state.process.graph.tag,
              forwardAdmissions: Number(state.process.forwardAdmissions),
              freshAfterRestart: state.process.freshAfterRestart,
              cancellationRejected: state.process.cancellationRejected
            }
          }
        })
      )
    ),
  (spec, implementation) => JSON.stringify(spec) === JSON.stringify(implementation)
)

it.effect("uses the production cancellation journal boundary and effective Pause selection", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectIdleRun()
      yield* driver.applyCancellation()
      yield* driver.redeliverCancellation()
      yield* driver.readFreshClassificationGraph()
      yield* driver.handoffToFreshClassification()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
      expect(evidence.cancellation).toBe("RunCancellationApplied")
      expect(evidence.effectivePause).toBe("RunPaused")
      expect(evidence.termination?.disposition).toBe("Cancelled")
      expect(evidence.termination?.evidence.rootTaskId).toBe(taskId)
      expect(evidence.termination?.evidence.coverage.explicitlyCoveredTaskIds).toEqual([])
      expect(evidence.termination?.evidence.coverage.explicitlyCoveredTaskIds).toEqual(
        evidence.termination?.evidence.readShape.explicitlyCoveredTaskIds
      )
    })
  )
)

it.effect("keeps repeated tracker content at one revision across different graph operations", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectIdleRun()
      yield* driver.applyCancellation()
      yield* driver.readFreshClassificationGraph()
      yield* driver.readFreshClassificationGraph()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.graphRevisions).toHaveLength(2)
      expect(evidence.graphRevisions[0]?.operationId).not.toBe(evidence.graphRevisions[1]?.operationId)
      expect(evidence.graphRevisions[0]?.revision).toBe(evidence.graphRevisions[1]?.revision)
    })
  )
)

it.effect("cancels an already-paused Run through production Pause, cancellation, and fresh graph boundaries", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectAlreadyPausedRun()
      yield* driver.applyCancellation()
      yield* driver.readFreshClassificationGraph()
      yield* driver.handoffToFreshClassification()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.eventTags.filter((tag) => tag === "ControlDirectionApplied")).toHaveLength(1)
      expect(evidence.eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
      expect(evidence.eventTags.filter((tag) => tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(0)
      expect(evidence.effectivePause).toBe("RunPaused")
      expect(evidence.termination?.evidence.rootTaskId).toBe(taskId)
    })
  )
)

it.effect("orders the production cancellation request behind the real application Exit cutoff", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectApplicationExitCutoff()
      yield* driver.rejectCancellationAtExit()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(0)
      expect(evidence.eventTags.filter((tag) => tag === "ControlDirectionApplied")).toHaveLength(0)
    })
  )
)

it.effect("records an unreadable executor projection through the production observation protocol", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectExecutingExecutor()
      yield* driver.applyCancellation()
      yield* driver.recordExecutorStopIntent()
      yield* driver.markExecutorUnreadable()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.eventTags).toContain("PlannedAttemptExecutorStateObserved")
      expect(evidence.eventTags).not.toContain("WorkflowRunTerminated")
    })
  )
)

it.effect("settles an admitted integration responsibility through the production Git boundary", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectIntegrationOwned()
      yield* driver.applyCancellation()
      yield* driver.recordIntegrationIntent()
      yield* driver.observePromotedIntegration()
      yield* driver.settlePromotedIntegration()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.eventTags).toContain("TargetPromotionIntended")
      expect(evidence.eventTags).toContain("TargetPromotionObservedSuccess")
      expect(evidence.effectivePause).toBeUndefined()
      expect(evidence.termination?.evidence.rootTaskId).toBeUndefined()
    })
  )
)

it.effect("keeps an unreadable integration read pending through the production Git protocol", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectIntegrationOwned()
      yield* driver.applyCancellation()
      yield* driver.recordIntegrationIntent()
      yield* driver.markIntegrationUnreadable()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.eventTags).toContain("TargetPromotionIntended")
      expect(evidence.eventTags).not.toContain("TargetPromotionObservedSuccess")
      expect(evidence.eventTags).not.toContain("WorkflowRunTerminated")
    })
  )
)

it.effect("observes absent, foreign, and unreadable claims without a forbidden release", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectExecutingExecutor()
      yield* driver.applyCancellation()
      yield* driver.recordExecutorStopIntent()
      yield* driver.reportExecutorSafe()
      yield* driver.recordClaimReleaseIntent()
      yield* driver.observeForeignClaim()
      const foreign = yield* driver.getProductionEvidence()
      expect(foreign.eventTags.filter((tag) => tag === "TaskClaimReleaseIntended")).toHaveLength(0)
      expect(foreign.eventTags.filter((tag) => tag === "TaskClaimReleased")).toHaveLength(0)
      expect(foreign.eventTags.filter((tag) => tag === "WorkflowRunTerminated")).toHaveLength(0)

      yield* driver.init()
      yield* driver.selectExecutingExecutor()
      yield* driver.applyCancellation()
      yield* driver.recordExecutorStopIntent()
      yield* driver.reportExecutorSafe()
      yield* driver.recordClaimReleaseIntent()
      yield* driver.markClaimUnreadable()
      const unreadable = yield* driver.getProductionEvidence()
      expect(unreadable.eventTags.filter((tag) => tag === "TaskClaimReleaseIntended")).toHaveLength(0)
      expect(unreadable.eventTags.filter((tag) => tag === "TaskClaimReleased")).toHaveLength(0)
      expect(unreadable.eventTags.filter((tag) => tag === "WorkflowRunTerminated")).toHaveLength(0)

      yield* driver.init()
      yield* driver.selectExecutingExecutor()
      yield* driver.applyCancellation()
      yield* driver.recordExecutorStopIntent()
      yield* driver.reportExecutorSafe()
      yield* driver.recordClaimReleaseIntent()
      yield* driver.observeAbsentClaim()
      yield* driver.readFreshClassificationGraph()
      yield* driver.handoffToFreshClassification()
      const absent = yield* driver.getProductionEvidence()
      expect(absent.eventTags.filter((tag) => tag === "CancelledAttemptClaimNoReleaseObserved")).toHaveLength(1)
      expect(absent.eventTags.filter((tag) => tag === "TaskClaimReleaseIntended")).toHaveLength(0)
      expect(absent.eventTags.filter((tag) => tag === "TaskClaimReleased")).toHaveLength(0)
      expect(absent.eventTags.filter((tag) => tag === "WorkflowRunTerminated")).toHaveLength(1)
      expect(absent.termination?.disposition).toBe("Cancelled")
      expect(absent.termination?.evidence.rootTaskId).toBe(taskId)
    })
  )
)

it.effect("retains an unreadable graph read without terminal classification", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectIdleRun()
      yield* driver.applyCancellation()
      yield* driver.markGraphUnreadable()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.observationTags).toContain("TaskTrackerFactsReadFailed")
      expect(evidence.eventTags.filter((tag) => tag === "WorkflowRunTerminated")).toHaveLength(0)
    })
  )
)

it.effect("rejects cancellation against an existing terminal Run through production finality", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectTerminalHistory()
      yield* driver.rejectTerminalHistory()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.termination?.disposition).toBe("Completed")
      expect(evidence.termination?.evidence.rootTaskId).toBe(taskId)
      expect(evidence.termination?.evidence.coverage.explicitlyCoveredTaskIds).toEqual([])
      expect(evidence.eventTags.filter((tag) => tag === "WorkflowRunTerminated")).toHaveLength(1)
      expect(evidence.eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(0)
    })
  )
)

it.effect("reconstructs the exact applied cancellation after process loss", () =>
  withCancellationDriver((driver) =>
    Effect.gen(function* () {
      yield* driver.init()
      yield* driver.selectExecutingExecutor()
      yield* driver.applyCancellation()
      yield* driver.recordExecutorStopIntent()
      yield* driver.crashBeforeSettlement()
      yield* driver.restartCancellation()
      const evidence = yield* driver.getProductionEvidence()
      expect(evidence.cancellation).toBe("RunCancellationApplied")
      expect(evidence.eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
    })
  )
)

quintIt(
  (name, test, options) =>
    it.effect(
      name,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope
            runCancellationMbtScope = scope
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                if (runCancellationMbtScope === scope) runCancellationMbtScope = undefined
              })
            )
            return yield* test()
          })
        ),
      options
    ),
  "replays Run cancellation through the production bootstrap and journal reconstruction",
  {
    backend: "typescript",
    driverFactory: runCancellationDriver,
    maxSteps: 24,
    nTraces: 100,
    seed: "102",
    spec: "specs/runCancellation.qnt",
    stateCheck: stateCheckProjection
  },
  120_000
)
