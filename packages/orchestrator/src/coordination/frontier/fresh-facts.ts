import { Data } from "effect"
import {
  type TaskId,
  type TaskRevision,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import type { WorkflowOperationResponsibility, WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"

/** Fresh boundary facts governing one unfinished workflow responsibility. */
export type ResponsibilityDisposition = Data.TaggedEnum<{
  DependencyWait: { readonly prerequisiteTaskIds: ReadonlyArray<TaskId> }
  FinalOutcome: { readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed" }
  PlannedAttemptExecutorWorkSafelySuspended: { readonly correlation: PlannedAttemptExecutorCorrelation }
  PlannedAttemptExecutorWorkTerminal: {
    readonly report: Extract<PlannedAttemptExecutorReport, { readonly _tag: "Terminal" }>
  }
  PlannedAttemptExecutorSuspensionRequested: Record<never, never>
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
  TaskExternalSuccessReleaseNeeded: { readonly operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type }
  TaskExternalSuccessSettled: Record<never, never>
  TaskClaimMissingConstraint: Record<never, never>
  TaskClaimUnreadableWait: Record<never, never>
  TaskForeignClaimIsolation: Record<never, never>
  TaskClaimReacquisitionRequested: { readonly requestId: TaskClaimReacquisitionRequestId }
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

export type PlannedAttemptExecutorDisposition = Extract<
  ResponsibilityDisposition,
  {
    readonly _tag:
      | "PlannedAttemptExecutorWorkSafelySuspended"
      | "PlannedAttemptExecutorWorkTerminal"
      | "PlannedAttemptExecutorSuspensionRequested"
      | "PlannedAttemptGitConstraint"
      | "TaskExternalSuccessConstraint"
      | "TaskExternalSuccessReleaseNeeded"
      | "TaskExternalSuccessSettled"
      | "TaskClaimMissingConstraint"
      | "TaskClaimUnreadableWait"
      | "TaskForeignClaimIsolation"
      | "TaskClaimReacquisitionRequested"
      | "TaskLifecycleConstraint"
      | "TaskMembershipConstraint"
      | "TaskSpecificationChangeConstraint"
      | "Ready"
  }
>

type WorkflowOperationDisposition = Exclude<
  ResponsibilityDisposition,
  {
    readonly _tag:
      | "PlannedAttemptExecutorWorkSafelySuspended"
      | "PlannedAttemptExecutorWorkTerminal"
      | "PlannedAttemptExecutorSuspensionRequested"
      | "PlannedAttemptGitConstraint"
      | "TaskExternalSuccessConstraint"
      | "TaskExternalSuccessReleaseNeeded"
      | "TaskExternalSuccessSettled"
      | "TaskClaimMissingConstraint"
      | "TaskClaimUnreadableWait"
      | "TaskForeignClaimIsolation"
      | "TaskClaimReacquisitionRequested"
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
