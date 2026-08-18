/* eslint-disable max-lines -- The closed transition/explanation algebra and its exhaustive mapping share one owner. */
import { Data, Match, Option } from "effect"
import {
  type IntegrationTarget,
  type PlannedTaskAttempt,
  type TaskId,
  type TaskRevision,
  type PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { type OperationId } from "../../workflow/identity.js"
import {
  type WorkflowResponsibilityEntry,
  workflowResponsibilityKey,
  workflowResponsibilityOperationId,
  type WorkflowResponsibilityState
} from "../reconstruction/state.js"
import type { AcceptedPlannedAttemptExecutorProgress, ResponsibilityFreshFacts } from "./fresh-facts.js"
import type {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import type {
  StoppedAttemptTaskClaimReleaseOperation,
  WorkflowOperation,
  WorkflowTaskClaimReleaseOperation
} from "../../workflow/registry/operation.js"
import type { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import type {
  CandidateContinuationLimit,
  CandidateCorrectionLimit
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import type { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type {
  TargetVerificationCandidate,
  TargetVerificationPlan
} from "../../workflow/protocols/target-verification/events.js"
import type {
  IntegratorRunCorrelation,
  IntegratorRunQualifiedCandidate
} from "../../workflow/protocols/integrator/events.js"
import type { InitialConclusiveIntegrationQuarantineInput } from "../../workflow/protocols/integration-quarantine/initial-conclusive.js"
import type { ProviderRunFailureQuarantineInput } from "../../workflow/protocols/integration-quarantine/provider-failure.js"
import type { RetryConclusiveIntegrationQuarantineInput } from "../../workflow/protocols/integration-quarantine/retry-conclusive.js"
import type { IntegratorSuccessorPreparationInput } from "../../workflow/protocols/integrator/session.js"
import type {
  CompletionTaskClaim,
  CompletionClaimDeletionRequest,
  CompletionClaimReplacementRequest,
  CompletionTaskRequest,
  PostPromotionBlockerClearAuthorization
} from "../../workflow/protocols/integration-finality/events.js"
import type { AttemptChoiceRequestId, AttemptChoiceSubject } from "../../workflow/protocols/attempt-choice/events.js"
import type {
  AttemptRestartRejectedReason,
  AttemptRestartWaitReason
} from "../../workflow/protocols/attempt-choice/restart-reasons.js"
import type { PlannedAttemptContinuationWitness } from "../../workflow/protocols/planned-attempt-continuation/events.js"
import type { CompletionTaskConflictReason } from "../../workflow/protocols/integration-finality/completion-task-protocol.js"
import type { PlannedAttemptExecutorProjectionWaitReason } from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import type { ChangedHeadRetryQuarantineInput } from "../../workflow/protocols/integration-quarantine/changed-head-retry.js"

export { ResponsibilityDisposition, type ResponsibilityFreshFacts } from "./fresh-facts.js"
export { deriveRunFinalityDecision, RunFinalityDecision, type RunFinalityProof } from "./run-finality.js"

/** Exact reconstructed reason that one promoted task still waits for focused success. */
export type IntegrationFinalityTrackerSuccessWaitReason =
  | { readonly _tag: "FocusedConfirmationNotObserved" }
  | { readonly _tag: "FocusedCompletionPending"; readonly operationId: OperationId }
  | {
      readonly _tag: "FocusedCompletionConflict"
      readonly detail: string
      readonly operationId: OperationId
      readonly reason: CompletionTaskConflictReason
    }

export type RunnableFrontierTransition = Data.TaggedEnum<{
  AdvanceAttemptRestart: {
    readonly integrationTarget: IntegrationTarget
    readonly plannedAttempt: PlannedTaskAttempt
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  AdvanceAttemptStoppage: {
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
    readonly taskWorkPosition: "None" | "ReserveOrReuse"
  }
  CheckTaskClaim: { readonly operationId: OperationId; readonly taskId: TaskId }
  CommitFreshTaskClaimIntent: { readonly taskId: TaskId; readonly taskRevision: TaskRevision }
  CommitTaskClaimReacquisitionIntent: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly requestId: TaskClaimReacquisitionRequestId
    readonly taskId: TaskId
  }
  ContinueFreshWorkflowOperation: { readonly operationId: OperationId; readonly taskId: TaskId }
  StartPlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  ContinuePlannedAttemptExecutorWork: {
    readonly acceptedProgress: AcceptedPlannedAttemptExecutorProgress
    readonly plannedAttempt: PlannedTaskAttempt
  }
  /** Continue one retained responsibility only after the named current tracker and Git facts are authorized. */
  ContinuePlannedAttemptExecutorWorkAfterCurrentFacts: {
    readonly acceptedProgress: AcceptedPlannedAttemptExecutorProgress
    readonly plannedAttempt: PlannedTaskAttempt
    readonly witness: PlannedAttemptContinuationWitness
  }
  ObservePlannedAttemptContinuationGraph: {
    readonly operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationSpecification: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationClaim: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationWorktree: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskWorktree.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationTargetLineage: {
    readonly operation: typeof WorkflowOperation.cases.ReadTargetLineage.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationExecutor: { readonly plannedAttempt: PlannedTaskAttempt }
  ObserveAttemptStoppageExecutor: { readonly requestId: AttemptChoiceRequestId; readonly subject: AttemptChoiceSubject }
  ObserveResponsibleTaskClaim: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
    readonly taskId: TaskId
  }
  ObserveStoppedAttemptClaim: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  RecordStoppedAttemptClaimNoRelease: {
    readonly observationOperationId: OperationId
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  ReleaseStoppedAttemptClaim: {
    readonly operation: StoppedAttemptTaskClaimReleaseOperation
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  /** Repeats one already-intended stopped-attempt claim release after the tracker kept that exact claim current. */
  RetryStoppedAttemptClaimRelease: {
    readonly operation: StoppedAttemptTaskClaimReleaseOperation
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  SuspendPlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  ReconcileTaskClaim: { readonly operationId: OperationId; readonly taskId: TaskId }
  ReconcileTaskClaimRelease: { readonly operationId: OperationId; readonly taskId: TaskId }
  ReleaseExternallyCompletedTaskClaim: {
    readonly operation: WorkflowTaskClaimReleaseOperation
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ReconcileTaskWorktree: { readonly operationId: OperationId; readonly taskId: TaskId }
  QueueAcceptedResultIntegrationResponsibility: {
    readonly accepted: UnqueuedAcceptedResult
    readonly integrationTarget: IntegrationTarget
  }
  StartQueuedIntegration: { readonly responsibility: QueuedIntegrationResponsibility }
  AcquireStartedIntegrationTarget: { readonly responsibility: StartedIntegrationResponsibility }
  ContinueStartedIntegrationCandidate: {
    /** Latest durable candidate fact accepted before this exact continuation was proposed. */
    readonly acceptedCandidateProgressAt: JournalPosition | null
    readonly correctionLimit: CandidateCorrectionLimit
    readonly continuationLimit: CandidateContinuationLimit
    readonly lineage: TargetLineageObservation
    readonly responsibility: StartedIntegrationResponsibility
  }
  /** Runs or resumes the one outer Integrator session bound to this exact durable lineage observation. */
  RunIntegrator: {
    readonly lineage: TargetLineageObservation
    readonly lineageObservedAt: JournalPosition
    readonly responsibility: StartedIntegrationResponsibility
    /** Exact outer occurrence authorized for this delivery, including Retry ordinal two. */
    readonly run: IntegratorRunCorrelation
  }
  /** Records why an authorized Retry cannot reuse its fixed session head; this transition never calls Integrator. */
  RecordChangedHeadRetryQuarantine: {
    readonly request: ChangedHeadRetryQuarantineInput
    readonly responsibility: StartedIntegrationResponsibility
  }
  /** Records Q after a modern initial Integrator run already has a conclusive result but Q is absent. */
  RecordInitialConclusiveIntegrationQuarantine: {
    readonly result: InitialConclusiveIntegrationQuarantineInput
    readonly responsibility: StartedIntegrationResponsibility
  }
  /** Recovers Q after provider-owned activity absence was durable but its dependent append was interrupted. */
  RecordProviderRunFailureIntegrationQuarantine: {
    readonly input: ProviderRunFailureQuarantineInput
    readonly responsibility: StartedIntegrationResponsibility
  }
  /** Records Q2 after an authorized Retry run 2 already ended conclusively. */
  RecordRetryConclusiveIntegrationQuarantine: {
    readonly responsibility: StartedIntegrationResponsibility
    readonly result: RetryConclusiveIntegrationQuarantineInput
  }
  /** Fixes one deterministic FullRerun successor after the operator direction and fresh Git lineage are durable. */
  FixIntegratorSuccessorSession: {
    readonly input: IntegratorSuccessorPreparationInput
    readonly responsibility: StartedIntegrationResponsibility
  }
  RunTargetVerification: {
    readonly candidate: TargetVerificationCandidate
    readonly plan: TargetVerificationPlan
    readonly responsibility: StartedIntegrationResponsibility
  }
  RunTargetPromotion: {
    readonly candidate: IntegratorRunQualifiedCandidate
    readonly responsibility: StartedIntegrationResponsibility
  }
  ReplacePromotedTaskClaim: {
    readonly request: CompletionClaimReplacementRequest
    readonly responsibility: StartedIntegrationResponsibility
  }
  /** Reproves promoted-candidate ancestry after a tracker blocker clears. */
  ObservePromotedCandidateAncestryAfterBlockerClear: {
    readonly authorization: PostPromotionBlockerClearAuthorization
    readonly responsibility: StartedIntegrationResponsibility
  }
  CompletePromotedTask: {
    readonly request: CompletionTaskRequest
    readonly responsibility: StartedIntegrationResponsibility
  }
  ObserveFocusedTaskCompletion: {
    readonly request: CompletionTaskRequest
    readonly responsibility: StartedIntegrationResponsibility
  }
  DeleteCompletedTaskCompletionClaim: {
    readonly replacementOperationId: OperationId
    readonly request: CompletionClaimDeletionRequest
    readonly responsibility: StartedIntegrationResponsibility
  }
  ReleaseStartedIntegrationTarget: { readonly responsibility: StartedIntegrationResponsibility }
}>

export const RunnableFrontierTransition = Data.taggedEnum<RunnableFrontierTransition>()

type AttemptStopTransition = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "AdvanceAttemptStoppage"
      | "ObserveAttemptStoppageExecutor"
      | "ObserveStoppedAttemptClaim"
      | "RecordStoppedAttemptClaimNoRelease"
      | "ReleaseStoppedAttemptClaim"
      | "RetryStoppedAttemptClaimRelease"
  }
>

const isAttemptStopTransition = (transition: RunnableFrontierTransition): transition is AttemptStopTransition =>
  transition._tag === "AdvanceAttemptStoppage" ||
  transition._tag === "ObserveAttemptStoppageExecutor" ||
  transition._tag === "ObserveStoppedAttemptClaim" ||
  transition._tag === "RecordStoppedAttemptClaimNoRelease" ||
  transition._tag === "ReleaseStoppedAttemptClaim" ||
  transition._tag === "RetryStoppedAttemptClaimRelease"

export const runnableTransitionTaskId = (transition: RunnableFrontierTransition): TaskId => {
  if (isAttemptStopTransition(transition)) return transition.subject.plannedAttempt.taskId
  return transition._tag === "QueueAcceptedResultIntegrationResponsibility"
    ? transition.accepted.plannedAttempt.taskId
    : transition._tag === "ReleaseExternallyCompletedTaskClaim"
      ? transition.operation.release.claim.taskId
      : "responsibility" in transition
        ? transition.responsibility.plannedAttempt.taskId
        : "plannedAttempt" in transition
          ? transition.plannedAttempt.taskId
          : transition.taskId
}

export const runnableTransitionOperationId = (transition: RunnableFrontierTransition): OperationId | undefined =>
  "operationId" in transition ? transition.operationId : undefined

export type TransitionTrackerGraphRequirement = "AcceptedHistorySufficient" | "CurrentTrackerGraphRequired"

/**
 * Declares whether accepted pre-crash evidence is sufficient to run this
 * transition before the current tracker graph has been established.
 */
const transitionTrackerGraphRequirements = {
  AdvanceAttemptRestart: "AcceptedHistorySufficient",
  AdvanceAttemptStoppage: "AcceptedHistorySufficient",
  AcquireStartedIntegrationTarget: "CurrentTrackerGraphRequired",
  CheckTaskClaim: "AcceptedHistorySufficient",
  CommitFreshTaskClaimIntent: "CurrentTrackerGraphRequired",
  CommitTaskClaimReacquisitionIntent: "AcceptedHistorySufficient",
  ContinueFreshWorkflowOperation: "CurrentTrackerGraphRequired",
  ContinuePlannedAttemptExecutorWork: "CurrentTrackerGraphRequired",
  ContinuePlannedAttemptExecutorWorkAfterCurrentFacts: "CurrentTrackerGraphRequired",
  ContinueStartedIntegrationCandidate: "CurrentTrackerGraphRequired",
  RecordChangedHeadRetryQuarantine: "CurrentTrackerGraphRequired",
  RecordInitialConclusiveIntegrationQuarantine: "AcceptedHistorySufficient",
  RecordProviderRunFailureIntegrationQuarantine: "AcceptedHistorySufficient",
  RecordRetryConclusiveIntegrationQuarantine: "AcceptedHistorySufficient",
  FixIntegratorSuccessorSession: "CurrentTrackerGraphRequired",
  RunIntegrator: "CurrentTrackerGraphRequired",
  RunTargetVerification: "CurrentTrackerGraphRequired",
  RunTargetPromotion: "CurrentTrackerGraphRequired",
  ReplacePromotedTaskClaim: "CurrentTrackerGraphRequired",
  ObservePromotedCandidateAncestryAfterBlockerClear: "CurrentTrackerGraphRequired",
  CompletePromotedTask: "CurrentTrackerGraphRequired",
  ObserveFocusedTaskCompletion: "CurrentTrackerGraphRequired",
  DeleteCompletedTaskCompletionClaim: "CurrentTrackerGraphRequired",
  ObservePlannedAttemptContinuationClaim: "AcceptedHistorySufficient",
  ObserveAttemptStoppageExecutor: "AcceptedHistorySufficient",
  ObservePlannedAttemptContinuationExecutor: "AcceptedHistorySufficient",
  ObservePlannedAttemptContinuationGraph: "AcceptedHistorySufficient",
  ObservePlannedAttemptContinuationSpecification: "AcceptedHistorySufficient",
  ObservePlannedAttemptContinuationTargetLineage: "AcceptedHistorySufficient",
  ObservePlannedAttemptContinuationWorktree: "AcceptedHistorySufficient",
  ObserveResponsibleTaskClaim: "CurrentTrackerGraphRequired",
  ObserveStoppedAttemptClaim: "AcceptedHistorySufficient",
  QueueAcceptedResultIntegrationResponsibility: "CurrentTrackerGraphRequired",
  ReconcileTaskClaim: "AcceptedHistorySufficient",
  ReconcileTaskClaimRelease: "AcceptedHistorySufficient",
  ReconcileTaskWorktree: "AcceptedHistorySufficient",
  RecordStoppedAttemptClaimNoRelease: "AcceptedHistorySufficient",
  ReleaseExternallyCompletedTaskClaim: "CurrentTrackerGraphRequired",
  ReleaseStoppedAttemptClaim: "AcceptedHistorySufficient",
  RetryStoppedAttemptClaimRelease: "AcceptedHistorySufficient",
  ReleaseStartedIntegrationTarget: "AcceptedHistorySufficient",
  StartPlannedAttemptExecutorWork: "CurrentTrackerGraphRequired",
  StartQueuedIntegration: "CurrentTrackerGraphRequired",
  SuspendPlannedAttemptExecutorWork: "AcceptedHistorySufficient"
} as const satisfies Record<RunnableFrontierTransition["_tag"], TransitionTrackerGraphRequirement>

export const transitionTrackerGraphRequirement = (
  transition: RunnableFrontierTransition
): TransitionTrackerGraphRequirement => transitionTrackerGraphRequirements[transition._tag]

export type FrontierExplanation = Data.TaggedEnum<{
  AttemptRestartRejected: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reason: AttemptRestartRejectedReason
    readonly taskId: TaskId
  }
  AttemptRestartWait: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reason: AttemptRestartWaitReason
    readonly taskId: TaskId
    readonly wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
  }
  AttemptStoppageWait: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reason: "ExecutorContradictory" | "ExecutorRunning" | "ExecutorUnavailable"
    readonly taskId: TaskId
    readonly wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
  }
  CapacityWait: { readonly taskId: TaskId; readonly wakeCondition: "CapacityReleasedOrReconstructedStateChanged" }
  ActivationInProgress: { readonly operationId: Option.Option<OperationId>; readonly taskId: TaskId }
  DependencyWait: {
    readonly operationId: OperationId
    readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  IntegrationDependencyWait: {
    readonly plannedAttempt: QueuedIntegrationResponsibility["plannedAttempt"]
    readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  IntegrationConfigurationWait: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "IntegrationTargetConfigured"
  }
  IntegrationTaskClaimConstraint: {
    readonly claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved"
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection" | "TaskClaimFactsObserved"
  }
  IntegrationInProgress: { readonly plannedAttempt: PlannedTaskAttempt }
  IntegrationTrackerFactsWait: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  IntegrationTargetWait: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "IntegrationTargetReleased"
  }
  TargetVerificationConfigurationWait: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "TargetVerificationPlanConfigured"
  }
  TargetPromotionConfigurationWait: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "TargetPromotionRuntimeConfigured"
  }
  IntegrationFinalityConfigurationWait: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "CompletionClaimBoundaryConfigured"
  }
  IntegrationFinalityTrackerSuccessWait: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly reason: IntegrationFinalityTrackerSuccessWaitReason
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  IntegrationFinalityNonConvergence: {
    readonly claim: CompletionTaskClaim
    readonly operationId: OperationId
    readonly phase: "Replacement" | "Deletion"
    readonly plannedAttempt: PlannedTaskAttempt
    readonly wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
  }
  PlannedAttemptExecutorWorkSafelySuspended: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
  }
  PlannedAttemptExecutorWorkTerminal: {
    readonly report: Extract<PlannedAttemptExecutorReport, { readonly _tag: "Terminal" }>
    readonly taskId: TaskId
  }
  PlannedAttemptExecutorProjectionWait: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reason: PlannedAttemptExecutorProjectionWaitReason
    readonly taskId: TaskId
    readonly wakeCondition: "LaterRunActivationOrAcceptedFactsChanged"
  }
  PlannedAttemptExecutorWorkTypedIssue: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reason: "DuplicateFreshFacts" | "MissingFreshFacts"
  }
  StoppedAttemptClaimWait: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly observationOperationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "TaskClaimFactsObserved"
  }
  StoppedAttemptClaimReleasePending: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "TaskClaimReleaseReconciled"
  }
  StoppedAttemptClaimPlanningWait: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reason: "FocusedObservationContradiction" | "TrackerTargetUnavailable"
    readonly taskId: TaskId
    readonly wakeCondition: "JournalHistoryRepairedOrTargetAvailable"
  }
  StoppedAttemptSettled: {
    readonly claimDisposition: "NoRelease" | "Released"
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
  }
  PlannedAttemptTaskMembershipConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  PlannedAttemptTaskLifecycleConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly lifecycle: "TerminalWithoutSuccess"
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  PlannedAttemptGitConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly gitState:
      | "CompetingWorktreeRegistrations"
      | "ConflictingWorktreeRegistration"
      | "ContradictoryWorktreeState"
      | "ForeignWorktreeRegistration"
      | "TargetRewrite"
      | "UntrackedWorktreePath"
      | "WorktreeBaseMismatch"
      | "WorktreeLost"
    readonly taskId: TaskId
    readonly wakeCondition: "GitFactsObserved"
  }
  PlannedAttemptTaskExternalSuccessConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
    readonly wakeCondition: "ExactTaskClaimDispositionApplied"
  }
  PlannedAttemptTaskExternalSuccessSettled: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
  }
  PlannedAttemptTaskClaimConstraint: {
    readonly claimState: "Foreign" | "Missing" | "Unreadable"
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
    readonly wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection" | "TaskClaimFactsObserved"
  }
  PlannedAttemptTaskSpecificationChangeConstraint: {
    readonly availableResolutions: readonly [
      "ContinueExistingAttempt",
      "RestartTaskImplementation",
      "StopTaskImplementation"
    ]
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly observedFingerprint: TaskRevision
    readonly plannedFingerprint: TaskRevision
    readonly taskId: TaskId
    readonly wakeCondition: "TaskResolutionApplied"
  }
  FinalOutcome: {
    readonly operationId: OperationId
    readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed"
    readonly taskId: TaskId
  }
  Isolation: { readonly operationId: OperationId; readonly reason: "ForeignClaim"; readonly taskId: TaskId }
  Pause: { readonly operationId: OperationId; readonly taskId: TaskId }
  Relinquishment: {
    readonly operationId: OperationId
    readonly reason: "AuthorizedHandoff" | "FreshAuthorityRevocation"
    readonly taskId: TaskId
  }
  Settlement: {
    readonly operationId: OperationId
    readonly outcome: "ResponsibilityCompleted" | "TrackerCompleted"
    readonly taskId: TaskId
  }
  TypedIssue: { readonly operationId: OperationId; readonly reason: "DuplicateFreshFacts" | "MissingFreshFacts" }
  WorkflowOperationTaskMembershipConstraint: {
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  WorkflowOperationTaskClaimConstraint: {
    readonly claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved"
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection" | "TaskClaimFactsObserved"
  }
  WorkflowOperationGitConstraint: {
    readonly gitState: "WorktreeLost"
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "GitFactsObserved"
  }
  UnreadableFactWait: {
    readonly boundary: "Executor" | "Git" | "TaskTracker"
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "BoundaryRereadSucceeded"
  }
}>

export const FrontierExplanation = Data.taggedEnum<FrontierExplanation>()

export interface RunnableFrontierInput {
  readonly freshEligibleTasks: ReadonlyArray<{ readonly taskId: TaskId; readonly taskRevision: TaskRevision }>
  readonly responsibility: WorkflowResponsibilityState
  readonly responsibilityFacts: ReadonlyArray<ResponsibilityFreshFacts>
}

export interface RunnableFrontier {
  readonly explanations: ReadonlyArray<FrontierExplanation>
  readonly transitions: ReadonlyArray<RunnableFrontierTransition>
}

const workflowResponsibilityTaskId = (responsibility: WorkflowResponsibilityEntry): TaskId =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? responsibility.plannedAttempt.taskId
    : responsibility.taskId

const readyTransition = (
  facts: Extract<ResponsibilityFreshFacts, { readonly _tag: "WorkflowOperationFreshFacts" }>
): RunnableFrontierTransition =>
  Match.value(facts.responsibility).pipe(
    Match.tags({
      TaskClaimResponsibility: ({ acquisition }) =>
        RunnableFrontierTransition.CheckTaskClaim({
          operationId: acquisition.operationId,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        }),
      TaskClaimReleaseResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ReconcileTaskClaimRelease({
          operationId: operation.release.operationId,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        }),
      TaskWorktreeResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ReconcileTaskWorktree({
          operationId: operation.operationId,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
    }),
    Match.exhaustive
  )

const executorDecisionFor = (
  facts: Extract<ResponsibilityFreshFacts, { readonly _tag: "PlannedAttemptExecutorFreshFacts" }>
): { readonly explanation?: FrontierExplanation; readonly transition?: RunnableFrontierTransition } =>
  Match.value(facts.disposition).pipe(
    Match.tags({
      AttemptRestartRequired: ({ integrationTarget, requestId, subject }) => ({
        transition: RunnableFrontierTransition.AdvanceAttemptRestart({
          integrationTarget,
          plannedAttempt: facts.responsibility.plannedAttempt,
          requestId,
          subject
        })
      }),
      AttemptRestartRejected: ({ reason }) => ({
        explanation: FrontierExplanation.AttemptRestartRejected({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          reason,
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      AttemptRestartWait: ({ reason }) => ({
        explanation: FrontierExplanation.AttemptRestartWait({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          reason,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
        })
      }),
      AttemptStoppageRequired: ({ requestId, subject, taskWorkPosition }) => ({
        transition: RunnableFrontierTransition.AdvanceAttemptStoppage({ requestId, subject, taskWorkPosition })
      }),
      AttemptStoppageExecutorObservationRequired: ({ requestId, subject }) => ({
        transition: RunnableFrontierTransition.ObserveAttemptStoppageExecutor({ requestId, subject })
      }),
      AttemptStoppageWait: ({ reason }) => ({
        explanation: FrontierExplanation.AttemptStoppageWait({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          reason,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
        })
      }),
      PlannedAttemptExecutorWorkSafelySuspended: ({ correlation }) => ({
        explanation: FrontierExplanation.PlannedAttemptExecutorWorkSafelySuspended({
          correlation,
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      PlannedAttemptExecutorWorkTerminal: ({ report }) => ({
        explanation: FrontierExplanation.PlannedAttemptExecutorWorkTerminal({
          report,
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      PlannedAttemptExecutorProjectionWait: ({ reason }) => ({
        explanation: FrontierExplanation.PlannedAttemptExecutorProjectionWait({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          reason,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "LaterRunActivationOrAcceptedFactsChanged"
        })
      }),
      PlannedAttemptExecutorSuspensionRequested: () => ({
        transition: RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({
          plannedAttempt: facts.responsibility.plannedAttempt
        })
      }),
      StoppedAttemptClaimNoReleaseRequired: (fields) => ({
        transition: RunnableFrontierTransition.RecordStoppedAttemptClaimNoRelease(fields)
      }),
      StoppedAttemptClaimObservationRequired: ({ operation, requestId, subject }) => ({
        transition: RunnableFrontierTransition.ObserveStoppedAttemptClaim({ operation, requestId, subject })
      }),
      StoppedAttemptClaimReleaseRequired: ({ operation, requestId, subject }) => ({
        transition: RunnableFrontierTransition.ReleaseStoppedAttemptClaim({ operation, requestId, subject })
      }),
      StoppedAttemptClaimReleaseRetryRequired: ({ operation, requestId, subject }) => ({
        transition: RunnableFrontierTransition.RetryStoppedAttemptClaimRelease({ operation, requestId, subject })
      }),
      StoppedAttemptClaimReleasePending: ({ operationId }) => ({
        explanation: FrontierExplanation.StoppedAttemptClaimReleasePending({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          operationId,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskClaimReleaseReconciled"
        })
      }),
      StoppedAttemptClaimPlanningWait: ({ reason }) => ({
        explanation: FrontierExplanation.StoppedAttemptClaimPlanningWait({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          reason,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "JournalHistoryRepairedOrTargetAvailable"
        })
      }),
      StoppedAttemptClaimUnreadableWait: ({ observationOperationId }) => ({
        explanation: FrontierExplanation.StoppedAttemptClaimWait({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          observationOperationId,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskClaimFactsObserved"
        })
      }),
      StoppedAttemptSettled: ({ claimDisposition }) => ({
        explanation: FrontierExplanation.StoppedAttemptSettled({
          claimDisposition,
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      PlannedAttemptGitConstraint: ({ gitState }) => ({
        explanation: FrontierExplanation.PlannedAttemptGitConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          gitState,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "GitFactsObserved"
        })
      }),
      TaskExternalSuccessConstraint: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskExternalSuccessConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ExactTaskClaimDispositionApplied"
        })
      }),
      TaskExternalSuccessReleaseNeeded: ({ operation }) => ({
        transition: RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({
          operation,
          plannedAttempt: facts.responsibility.plannedAttempt
        })
      }),
      TaskExternalSuccessSettled: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskExternalSuccessSettled({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      TaskClaimMissingConstraint: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskClaimConstraint({
          claimState: "Missing",
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
        })
      }),
      TaskClaimUnreadableWait: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskClaimConstraint({
          claimState: "Unreadable",
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskClaimFactsObserved"
        })
      }),
      TaskForeignClaimIsolation: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskClaimConstraint({
          claimState: "Foreign",
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
        })
      }),
      AppliedTaskClaimReacquisitionDirection: ({ requestId }) => ({
        transition: RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
          plannedAttempt: facts.responsibility.plannedAttempt,
          requestId,
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      TaskLifecycleConstraint: ({ lifecycle }) => ({
        explanation: FrontierExplanation.PlannedAttemptTaskLifecycleConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          lifecycle,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      TaskSpecificationChangeConstraint: ({ observedFingerprint, plannedFingerprint }) => ({
        explanation: FrontierExplanation.PlannedAttemptTaskSpecificationChangeConstraint({
          availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          observedFingerprint,
          plannedFingerprint,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskResolutionApplied"
        })
      }),
      TaskMembershipConstraint: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskMembershipConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      Ready: ({ acceptedProgress }) => ({
        transition: RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
          acceptedProgress,
          plannedAttempt: facts.responsibility.plannedAttempt
        })
      })
    }),
    Match.exhaustive
  )

const operationDecisionFor = (
  facts: Extract<ResponsibilityFreshFacts, { readonly _tag: "WorkflowOperationFreshFacts" }>
): { readonly explanation?: FrontierExplanation; readonly transition?: RunnableFrontierTransition } =>
  Match.value(facts.disposition).pipe(
    Match.tags({
      DependencyWait: ({ prerequisiteTaskIds }) => ({
        explanation: FrontierExplanation.DependencyWait({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          prerequisiteTaskIds: [...prerequisiteTaskIds].sort(),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      FinalOutcome: ({ outcome }) => ({
        explanation: FrontierExplanation.FinalOutcome({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          outcome,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      ForeignClaimIsolation: () => ({
        explanation: FrontierExplanation.Isolation({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          reason: "ForeignClaim",
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      MissingClaim: () => ({
        transition: RunnableFrontierTransition.ReconcileTaskClaim({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      Paused: () => ({
        explanation: FrontierExplanation.Pause({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      Ready: () => ({ transition: readyTransition(facts) }),
      Relinquished: ({ reason }) => ({
        explanation: FrontierExplanation.Relinquishment({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          reason,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      Settled: ({ outcome }) => ({
        explanation: FrontierExplanation.Settlement({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          outcome,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      TaskMembershipConstraint: () => ({
        explanation: FrontierExplanation.WorkflowOperationTaskMembershipConstraint({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      WorkflowOperationTaskClaimConstraint: ({ claimState }) => ({
        explanation: FrontierExplanation.WorkflowOperationTaskClaimConstraint({
          claimState,
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition:
            claimState === "Missing" || claimState === "Foreign"
              ? "ExplicitAppliedTaskClaimReacquisitionDirection"
              : "TaskClaimFactsObserved"
        })
      }),
      WorkflowOperationGitConstraint: ({ gitState }) => ({
        explanation: FrontierExplanation.WorkflowOperationGitConstraint({
          gitState,
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "GitFactsObserved"
        })
      }),
      UnreadableFactWait: ({ boundary }) => ({
        explanation: FrontierExplanation.UnreadableFactWait({
          boundary,
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "BoundaryRereadSucceeded"
        })
      })
    }),
    Match.exhaustive
  )

const decisionFor = (
  facts: ResponsibilityFreshFacts
): { readonly explanation?: FrontierExplanation; readonly transition?: RunnableFrontierTransition } =>
  facts._tag === "PlannedAttemptExecutorFreshFacts" ? executorDecisionFor(facts) : operationDecisionFor(facts)

/** Derives process-local choices in responsibility-first, canonical task order. */
export const deriveRunnableFrontier = (input: RunnableFrontierInput): RunnableFrontier => {
  const responsibleDecisions = input.responsibility.entries.map((responsibility) => {
    const responsibilityKey = workflowResponsibilityKey(responsibility)
    const matchingFacts = input.responsibilityFacts.filter(
      (facts) => workflowResponsibilityKey(facts.responsibility) === responsibilityKey
    )
    const decision =
      matchingFacts.length === 1
        ? decisionFor(Option.getOrThrow(Option.fromUndefinedOr(matchingFacts[0])))
        : responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
          ? {
              explanation: FrontierExplanation.PlannedAttemptExecutorWorkTypedIssue({
                correlation: {
                  attemptId: responsibility.plannedAttempt.attemptId,
                  runId: responsibility.plannedAttempt.runId
                },
                reason: matchingFacts.length === 0 ? "MissingFreshFacts" : "DuplicateFreshFacts"
              })
            }
          : {
              explanation: FrontierExplanation.TypedIssue({
                operationId: workflowResponsibilityOperationId(responsibility),
                reason: matchingFacts.length === 0 ? "MissingFreshFacts" : "DuplicateFreshFacts"
              })
            }
    return { ...decision, beganAt: responsibility.beganAt, taskId: workflowResponsibilityTaskId(responsibility) }
  })
  const responsibleTaskIds = new Set(input.responsibility.entries.map(workflowResponsibilityTaskId))
  const responsibleTransitions = responsibleDecisions
    .filter(
      (decision): decision is typeof decision & { readonly transition: RunnableFrontierTransition } =>
        decision.transition !== undefined
    )
    .toSorted((left, right) => left.beganAt - right.beganAt || left.taskId.localeCompare(right.taskId))
    .map(({ transition }) => transition)
  const freshTransitions = input.freshEligibleTasks
    .filter(({ taskId }) => !responsibleTaskIds.has(taskId))
    .filter(({ taskId }, index, tasks) => tasks.findIndex((candidate) => candidate.taskId === taskId) === index)
    .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    .map(({ taskId, taskRevision }) => RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId, taskRevision }))
  return {
    explanations: responsibleDecisions.flatMap(({ explanation }) => (explanation === undefined ? [] : [explanation])),
    transitions: [...responsibleTransitions, ...freshTransitions]
  }
}
