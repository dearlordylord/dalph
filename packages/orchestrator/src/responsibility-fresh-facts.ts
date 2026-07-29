import { Data } from "effect"
import type { TaskId } from "./domain.js"
import type { PlannedAttemptExecutorCorrelation, PlannedAttemptExecutorReport } from "./planned-attempt-executor.js"
import type { WorkflowOperationResponsibility, WorkflowResponsibilityEntry } from "./reconstructed-managed-run-state.js"

/** Fresh boundary facts governing one unfinished workflow responsibility. */
export type ResponsibilityDisposition = Data.TaggedEnum<{
  DependencyWait: { readonly prerequisiteTaskIds: ReadonlyArray<TaskId> }
  FinalOutcome: {
    readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed"
  }
  PlannedAttemptExecutorWorkSafelySuspended: {
    readonly correlation: PlannedAttemptExecutorCorrelation
  }
  PlannedAttemptExecutorWorkTerminal: {
    readonly report: Extract<
      PlannedAttemptExecutorReport,
      { readonly _tag: "Terminal" }
    >
  }
  PlannedAttemptExecutorSuspensionRequested: Record<never, never>
  ForeignClaimIsolation: Record<never, never>
  MissingClaim: Record<never, never>
  Paused: Record<never, never>
  Ready: Record<never, never>
  Relinquished: {
    readonly reason: "AuthorizedHandoff" | "FreshAuthorityRevocation"
  }
  Settled: {
    readonly outcome: "ResponsibilityCompleted" | "TrackerCompleted"
  }
  UnreadableFactWait: {
    readonly boundary: "Executor" | "Git" | "TaskTracker"
  }
}>

export const ResponsibilityDisposition = Data.taggedEnum<
  ResponsibilityDisposition
>()

type PlannedAttemptExecutorDisposition = Extract<
  ResponsibilityDisposition,
  {
    readonly _tag:
      | "PlannedAttemptExecutorWorkSafelySuspended"
      | "PlannedAttemptExecutorWorkTerminal"
      | "PlannedAttemptExecutorSuspensionRequested"
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
