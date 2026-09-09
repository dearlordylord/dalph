import { Data, Schema } from "effect"
import {
  type IntegrationTarget,
  type PlannedTaskAttempt,
  TaskId,
  type TaskRevision,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { immutableSnapshot } from "../immutable-snapshot.js"
import type { WorkflowOperationResponsibility, WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type {
  CancelledAttemptTaskClaimReleaseOperation,
  StoppedAttemptTaskClaimReleaseOperation,
  WorkflowOperation,
  WorkflowTaskClaimReleaseOperation
} from "../../workflow/registry/operation.js"
import type { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { PlannedAttemptExecutorReportOrdinal } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import type {
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  AttemptQuiescenceProof
} from "../../workflow/protocols/attempt-choice/events.js"
import type {
  AttemptRestartRejectedReason,
  AttemptRestartWaitReason
} from "../../workflow/protocols/attempt-choice/restart-reasons.js"
import type { OperationId } from "../../workflow/identity.js"
import type {
  AcceptedPlannedAttemptExecutorEvidence,
  PlannedAttemptExecutorProjectionWaitReason
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"

/** The exact unfinished prerequisites blocking one executing task; an empty set is not a dependency constraint. */
export const UnfinishedPrerequisiteTaskIds = Schema.NonEmptyArray(TaskId)
export type UnfinishedPrerequisiteTaskIds = typeof UnfinishedPrerequisiteTaskIds.Type

/** Exact accepted executor fact that identifies one durable observation proposal. */
export type AcceptedPlannedAttemptExecutorProgress =
  | { readonly _tag: "ExecutorResponsibilityBegan"; readonly acceptedAt: JournalPosition }
  | { readonly _tag: "ExecutorReportAccepted"; readonly ordinal: PlannedAttemptExecutorReportOrdinal }

const SafeContinuationRevalidationEligibilityTypeId: unique symbol = Symbol(
  "@dalph/SafeContinuationRevalidationEligibility"
)
const issuedSafeContinuationRevalidationEligibilities = new WeakSet<object>()

/**
 * Process-local permission for one safely suspended responsibility to reserve
 * capacity while it rereads current continuation authority. It is not final
 * Resume authorization and cannot be reconstructed from its public fields.
 */
export type SafeContinuationRevalidationEligibility = {
  readonly [SafeContinuationRevalidationEligibilityTypeId]: typeof SafeContinuationRevalidationEligibilityTypeId
  readonly acceptedSafe: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reportOrdinal: PlannedAttemptExecutorReportOrdinal
  }
  readonly plannedAttempt: PlannedTaskAttempt
  readonly responsibilityBeganAt: JournalPosition
}

/** Runtime guard for the private exact Safe-continuation eligibility. */
export const isSafeContinuationRevalidationEligibility = (
  value: unknown
): value is SafeContinuationRevalidationEligibility =>
  typeof value === "object" && value !== null && issuedSafeContinuationRevalidationEligibilities.has(value)

type SafeContinuationReadyFacts = Extract<
  ResponsibilityFreshFacts,
  { readonly _tag: "PlannedAttemptExecutorFreshFacts" }
> & { readonly disposition: ExecutorReadyDisposition }

/**
 * Mints eligibility only when Ready is backed by the exact accepted Safe
 * report for the same immutable responsibility. Recovery additionally owns
 * proving that this evidence is current, unconsumed, and outside an active
 * executing refresh before it calls this constructor.
 */
export const safeContinuationRevalidationEligibilityOf = (
  facts: SafeContinuationReadyFacts,
  acceptedSafe: AcceptedPlannedAttemptExecutorEvidence
): SafeContinuationRevalidationEligibility | undefined => {
  if (
    acceptedSafe.report._tag !== "ExecutorWorkSafelySuspended" ||
    facts.disposition.acceptedProgress._tag !== "ExecutorReportAccepted" ||
    facts.disposition.acceptedProgress.ordinal !== acceptedSafe.source.ordinal ||
    facts.responsibility.plannedAttempt.runId !== acceptedSafe.report.correlation.runId ||
    facts.responsibility.plannedAttempt.attemptId !== acceptedSafe.report.correlation.attemptId
  ) {
    return undefined
  }
  const eligibility: SafeContinuationRevalidationEligibility = Object.freeze({
    [SafeContinuationRevalidationEligibilityTypeId]: SafeContinuationRevalidationEligibilityTypeId,
    acceptedSafe: Object.freeze({
      correlation: immutableSnapshot(acceptedSafe.report.correlation),
      reportOrdinal: acceptedSafe.source.ordinal
    }),
    plannedAttempt: immutableSnapshot(facts.responsibility.plannedAttempt),
    responsibilityBeganAt: facts.responsibility.beganAt
  })
  issuedSafeContinuationRevalidationEligibilities.add(eligibility)
  return eligibility
}

/** Fresh boundary facts governing one unfinished workflow responsibility. */
export type ResponsibilityDisposition = Data.TaggedEnum<{
  AttemptRestartRequired: {
    readonly integrationTarget: IntegrationTarget
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  AttemptRestartRejected: { readonly reason: AttemptRestartRejectedReason }
  AttemptRestartWait: { readonly reason: AttemptRestartWaitReason }
  AttemptStoppageRequired: {
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
    readonly taskWorkPosition: "None" | "ReserveOrReuse"
  }
  AttemptStoppageExecutorObservationRequired: {
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  AttemptStoppageWait: { readonly reason: "ExecutorContradictory" | "ExecutorExecuting" | "ExecutorUnavailable" }
  /** Cancellation has proved exact executor quiescence; relinquishment is the next durable action. */
  CancelledAttemptRelinquishmentRequired: {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly proof: AttemptQuiescenceProof
  }
  /** A post-relinquishment claim read proved an absent or foreign claim and must be journaled as no-release. */
  CancelledAttemptClaimNoReleaseRequired: {
    readonly observationOperationId: OperationId
    readonly plannedAttempt: PlannedTaskAttempt
  }
  CancelledAttemptClaimObservationRequired: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  CancelledAttemptClaimReleaseRequired: {
    readonly operation: CancelledAttemptTaskClaimReleaseOperation
    readonly plannedAttempt: PlannedTaskAttempt
  }
  /** A post-intent tracker read kept the exact cancellation claim current, so release is retried. */
  CancelledAttemptClaimReleaseRetryRequired: {
    readonly operation: CancelledAttemptTaskClaimReleaseOperation
    readonly plannedAttempt: PlannedTaskAttempt
  }
  CancelledAttemptClaimReleasePending: { readonly operationId: OperationId }
  CancelledAttemptClaimPlanningWait: { readonly reason: "FocusedObservationContradiction" | "TrackerTargetUnavailable" }
  CancelledAttemptClaimUnreadableWait: { readonly observationOperationId: OperationId }
  CancelledAttemptSettled: { readonly claimDisposition: "NoRelease" | "Released" }
  DependencyWait: { readonly prerequisiteTaskIds: ReadonlyArray<TaskId> }
  FinalOutcome: { readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed" }
  PlannedAttemptExecutorWorkSafelySuspended: { readonly correlation: PlannedAttemptExecutorCorrelation }
  PlannedAttemptExecutorWorkTerminal: {
    readonly report: Extract<PlannedAttemptExecutorReport, { readonly _tag: "ExecutorWorkTerminal" }>
  }
  /** A normalized executor projection was not trusted; retain the exact responsibility and resources. */
  PlannedAttemptExecutorProjectionWait: { readonly reason: PlannedAttemptExecutorProjectionWaitReason }
  PlannedAttemptExecutorSuspensionRequested: Record<never, never>
  StoppedAttemptClaimNoReleaseRequired: {
    readonly observationOperationId: OperationId
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  StoppedAttemptClaimObservationRequired: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  StoppedAttemptClaimReleaseRequired: {
    readonly operation: StoppedAttemptTaskClaimReleaseOperation
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  /** A post-intent tracker read kept the exact claim current, so Dalph must repeat the accepted release request. */
  StoppedAttemptClaimReleaseRetryRequired: {
    readonly operation: StoppedAttemptTaskClaimReleaseOperation
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  StoppedAttemptClaimReleasePending: { readonly operationId: OperationId }
  StoppedAttemptClaimPlanningWait: { readonly reason: "FocusedObservationContradiction" | "TrackerTargetUnavailable" }
  StoppedAttemptClaimUnreadableWait: { readonly observationOperationId: OperationId }
  StoppedAttemptSettled: { readonly claimDisposition: "NoRelease" | "Released" }
  PlannedAttemptGitConstraint: {
    readonly gitState:
      | "CompetingWorktreeRegistrations"
      | "ConflictingWorktreeRegistration"
      | "ContradictoryWorktreeState"
      | "ForeignWorktreeRegistration"
      | "TargetRewrite"
      | "UntrackedWorktreePath"
      | "WorktreeBaseMismatch"
      | "WorktreeLost"
  }
  TaskExternalSuccessConstraint: Record<never, never>
  TaskExternalSuccessReleaseNeeded: { readonly operation: WorkflowTaskClaimReleaseOperation }
  TaskExternalSuccessSettled: Record<never, never>
  TaskClaimMissingConstraint: Record<never, never>
  TaskClaimUnreadableWait: Record<never, never>
  TaskForeignClaimIsolation: Record<never, never>
  AppliedTaskClaimReacquisitionDirection: { readonly requestId: TaskClaimReacquisitionRequestId }
  WorkflowOperationTaskClaimConstraint: { readonly claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved" }
  WorkflowOperationGitConstraint: { readonly gitState: "WorktreeLost" }
  TaskLifecycleConstraint: { readonly lifecycle: "TerminalWithoutSuccess" }
  TaskMembershipConstraint: Record<never, never>
  /** A current complete tracker graph makes this executing task ineligible because exact prerequisites are unfinished. */
  TaskDependencyConstraint: { readonly prerequisiteTaskIds: UnfinishedPrerequisiteTaskIds }
  TaskSpecificationChangeConstraint: {
    readonly observedFingerprint: TaskRevision
    readonly plannedFingerprint: TaskRevision
  }
  ForeignClaimIsolation: Record<never, never>
  MissingClaim: Record<never, never>
  Paused: Record<never, never>
  Ready: Record<never, never>
  Relinquished: { readonly reason: "AuthorizedHandoff" | "FreshAuthorityRevocation" }
  Settled: { readonly outcome: "ResponsibilityCompleted" | "TrackerCompleted" }
  UnreadableFactWait: { readonly boundary: "Executor" | "Git" | "TaskTracker" }
}>

export const ResponsibilityDisposition = Data.taggedEnum<ResponsibilityDisposition>()

type ExecutorReadyDisposition = Extract<ResponsibilityDisposition, { readonly _tag: "Ready" }> & {
  readonly acceptedProgress: AcceptedPlannedAttemptExecutorProgress
}

export type PlannedAttemptExecutorDisposition =
  | Extract<
      ResponsibilityDisposition,
      {
        readonly _tag:
          | "PlannedAttemptExecutorWorkSafelySuspended"
          | "PlannedAttemptExecutorWorkTerminal"
          | "PlannedAttemptExecutorProjectionWait"
          | "PlannedAttemptExecutorSuspensionRequested"
          | "AttemptStoppageRequired"
          | "AttemptRestartRequired"
          | "AttemptRestartRejected"
          | "AttemptRestartWait"
          | "AttemptStoppageExecutorObservationRequired"
          | "AttemptStoppageWait"
          | "CancelledAttemptRelinquishmentRequired"
          | "CancelledAttemptClaimNoReleaseRequired"
          | "CancelledAttemptClaimObservationRequired"
          | "CancelledAttemptClaimReleaseRequired"
          | "CancelledAttemptClaimReleaseRetryRequired"
          | "CancelledAttemptClaimReleasePending"
          | "CancelledAttemptClaimPlanningWait"
          | "CancelledAttemptClaimUnreadableWait"
          | "CancelledAttemptSettled"
          | "StoppedAttemptClaimNoReleaseRequired"
          | "StoppedAttemptClaimObservationRequired"
          | "StoppedAttemptClaimReleaseRequired"
          | "StoppedAttemptClaimReleaseRetryRequired"
          | "StoppedAttemptClaimReleasePending"
          | "StoppedAttemptClaimPlanningWait"
          | "StoppedAttemptClaimUnreadableWait"
          | "StoppedAttemptSettled"
          | "PlannedAttemptGitConstraint"
          | "TaskExternalSuccessConstraint"
          | "TaskExternalSuccessReleaseNeeded"
          | "TaskExternalSuccessSettled"
          | "TaskClaimMissingConstraint"
          | "TaskClaimUnreadableWait"
          | "TaskForeignClaimIsolation"
          | "Relinquished"
          | "AppliedTaskClaimReacquisitionDirection"
          | "TaskLifecycleConstraint"
          | "TaskMembershipConstraint"
          | "TaskDependencyConstraint"
          | "TaskSpecificationChangeConstraint"
          | "UnreadableFactWait"
      }
    >
  | ExecutorReadyDisposition

type WorkflowOperationDisposition = Exclude<
  ResponsibilityDisposition,
  {
    readonly _tag:
      | "PlannedAttemptExecutorWorkSafelySuspended"
      | "PlannedAttemptExecutorWorkTerminal"
      | "PlannedAttemptExecutorProjectionWait"
      | "PlannedAttemptExecutorSuspensionRequested"
      | "AttemptStoppageRequired"
      | "AttemptRestartRequired"
      | "AttemptRestartRejected"
      | "AttemptRestartWait"
      | "AttemptStoppageExecutorObservationRequired"
      | "AttemptStoppageWait"
      | "CancelledAttemptRelinquishmentRequired"
      | "CancelledAttemptClaimNoReleaseRequired"
      | "CancelledAttemptClaimObservationRequired"
      | "CancelledAttemptClaimReleaseRequired"
      | "CancelledAttemptClaimReleaseRetryRequired"
      | "CancelledAttemptClaimReleasePending"
      | "CancelledAttemptClaimPlanningWait"
      | "CancelledAttemptClaimUnreadableWait"
      | "CancelledAttemptSettled"
      | "StoppedAttemptClaimNoReleaseRequired"
      | "StoppedAttemptClaimObservationRequired"
      | "StoppedAttemptClaimReleaseRequired"
      | "StoppedAttemptClaimReleaseRetryRequired"
      | "StoppedAttemptClaimReleasePending"
      | "StoppedAttemptClaimPlanningWait"
      | "StoppedAttemptClaimUnreadableWait"
      | "StoppedAttemptSettled"
      | "PlannedAttemptGitConstraint"
      | "TaskExternalSuccessConstraint"
      | "TaskExternalSuccessReleaseNeeded"
      | "TaskExternalSuccessSettled"
      | "TaskClaimMissingConstraint"
      | "TaskClaimUnreadableWait"
      | "TaskForeignClaimIsolation"
      | "AppliedTaskClaimReacquisitionDirection"
      | "TaskLifecycleConstraint"
      | "TaskDependencyConstraint"
      | "TaskSpecificationChangeConstraint"
  }
>

/** The variant fixes which dispositions may accompany each responsibility kind. */
export type ResponsibilityFreshFacts =
  | {
      readonly _tag: "PlannedAttemptExecutorFreshFacts"
      readonly disposition: PlannedAttemptExecutorDisposition
      readonly responsibility: Extract<
        WorkflowResponsibilityEntry,
        { readonly _tag: "PlannedAttemptExecutorWorkResponsibility" }
      >
      readonly safeContinuationRevalidationEligibility?: SafeContinuationRevalidationEligibility
    }
  | {
      readonly _tag: "WorkflowOperationFreshFacts"
      readonly disposition: WorkflowOperationDisposition
      readonly responsibility: WorkflowOperationResponsibility
    }
