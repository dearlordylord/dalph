import { Data } from "effect"
import {
  type TaskId,
  type TaskRevision,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import type { WorkflowOperationResponsibility, WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type {
  StoppedAttemptTaskClaimReleaseOperation,
  WorkflowOperation,
  WorkflowTaskClaimReleaseOperation
} from "../../workflow/registry/operation.js"
import type { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { PlannedAttemptExecutorReportOrdinal } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import type { AttemptChoiceRequestId, AttemptChoiceSubject } from "../../workflow/protocols/attempt-choice/events.js"
import type { OperationId } from "../../workflow/identity.js"

/** Exact accepted executor fact from which one continuation is authorized. */
export type AcceptedPlannedAttemptExecutorProgress =
  | { readonly _tag: "ExecutorResponsibilityBegan"; readonly acceptedAt: JournalPosition }
  | { readonly _tag: "ExecutorReportAccepted"; readonly ordinal: PlannedAttemptExecutorReportOrdinal }
  | { readonly _tag: "ExecutorProjectionAccepted"; readonly observedAt: JournalPosition }

/** Fresh boundary facts governing one unfinished workflow responsibility. */
export type ResponsibilityDisposition = Data.TaggedEnum<{
  AttemptStoppageRequired: {
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
    readonly taskWorkPosition: "None" | "ReserveOrReuse"
  }
  AttemptStoppageExecutorObservationRequired: {
    readonly requestId: AttemptChoiceRequestId
    readonly subject: AttemptChoiceSubject
  }
  AttemptStoppageWait: { readonly reason: "ExecutorContradictory" | "ExecutorRunning" | "ExecutorUnavailable" }
  DependencyWait: { readonly prerequisiteTaskIds: ReadonlyArray<TaskId> }
  FinalOutcome: { readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed" }
  PlannedAttemptExecutorWorkSafelySuspended: { readonly correlation: PlannedAttemptExecutorCorrelation }
  PlannedAttemptExecutorWorkTerminal: {
    readonly report: Extract<PlannedAttemptExecutorReport, { readonly _tag: "Terminal" }>
  }
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
          | "PlannedAttemptExecutorSuspensionRequested"
          | "AttemptStoppageRequired"
          | "AttemptStoppageExecutorObservationRequired"
          | "AttemptStoppageWait"
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
          | "TaskMembershipConstraint"
          | "TaskSpecificationChangeConstraint"
      }
    >
  | ExecutorReadyDisposition

type WorkflowOperationDisposition = Exclude<
  ResponsibilityDisposition,
  {
    readonly _tag:
      | "PlannedAttemptExecutorWorkSafelySuspended"
      | "PlannedAttemptExecutorWorkTerminal"
      | "PlannedAttemptExecutorSuspensionRequested"
      | "AttemptStoppageRequired"
      | "AttemptStoppageExecutorObservationRequired"
      | "AttemptStoppageWait"
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
    }
  | {
      readonly _tag: "WorkflowOperationFreshFacts"
      readonly disposition: WorkflowOperationDisposition
      readonly responsibility: WorkflowOperationResponsibility
    }
