import type { WorkflowJournalEvent } from "../../../packages/orchestrator/src/journal-store.ts"
import type { WorkflowResponsibilityEntry } from "../../../packages/orchestrator/src/reconstructed-managed-run-state.ts"
import type {
  FrontierExplanation,
  ResponsibilityDisposition,
  RunFinalityDecision,
  RunnableFrontierTransition
} from "../../../packages/orchestrator/src/runnable-frontier.ts"
import type { WorkflowOperation } from "../../../packages/orchestrator/src/workflow-operation.ts"

type CoverageStatus = "Interactive" | "Observable" | "IntentionallyExcluded"
type Coverage<Union extends { readonly _tag: string }> = {
  readonly [Tag in Union["_tag"]]: {
    readonly status: CoverageStatus
    readonly reason: string
  }
}

const interactive = (reason: string) => ({ reason, status: "Interactive" as const })
const observable = (reason: string) => ({ reason, status: "Observable" as const })
const excluded = (reason: string) => ({ reason, status: "IntentionallyExcluded" as const })

/** Adding an operation to the production algebra makes this prototype fail typechecking until classified. */
export const workflowOperationCoverage = {
  AcquireTaskClaim: interactive("Selected claim intents can be committed."),
  EstablishTaskWorkSession: excluded("The current driver cannot execute work-session operations."),
  ExecuteTaskWork: excluded("The current driver does not run task executors."),
  HandBackReviewFindings: excluded("Review handback is outside this reducer slice."),
  ReadTrackerGraph: interactive("The controlled tracker can be observed repeatedly."),
  ReconcileTaskWorktree: excluded("Git authority is not yet controlled by this driver."),
  RecordImplementationDisposition: excluded("Implementation convergence is outside this reducer slice."),
  RecordTaskAttemptPlan: excluded("Attempt planning is outside this reducer slice."),
  ReviewImplementation: excluded("Reviewer execution is outside this reducer slice."),
  SealImplementationEvidence: excluded("Evidence storage is outside this reducer slice.")
} satisfies Coverage<WorkflowOperation>

/** Journal events are consequences of driver operations, never raw UI buttons. */
export const workflowJournalEventCoverage = {
  ImplementationConvergenceDispositionRecorded: excluded("No implementation convergence driver."),
  ImplementationEvidenceSealed: excluded("No evidence-store driver."),
  ImplementationEvidenceSealingIntended: excluded("No evidence-store driver."),
  ImplementationReviewCompleted: excluded("No reviewer driver."),
  ImplementationReviewIntended: excluded("No reviewer driver."),
  ReviewFindingsHandbackCompleted: excluded("No reviewer handback driver."),
  ReviewFindingsHandbackIntended: excluded("No reviewer handback driver."),
  TaskAttemptPlanned: excluded("No attempt-planning driver."),
  TaskClaimAcquired: excluded("Claim outcome reconciliation is not implemented in the current driver."),
  TaskClaimAcquisitionIntended: interactive("Produced by an admitted claim move."),
  TaskExecutionIntentRecorded: excluded("No executor driver."),
  TaskExecutionObservationFailed: excluded("No executor authority driver."),
  TaskExecutionOutcomeObserved: excluded("No executor authority driver."),
  TaskExecutionReported: excluded("No executor authority driver."),
  TaskExecutionRequestAttemptRecorded: excluded("No executor driver."),
  TaskExecutionRequestFailed: excluded("No executor driver."),
  TaskExecutionRequestReturned: excluded("No executor driver."),
  TaskWorkSessionEstablished: excluded("No task-work provider driver."),
  TaskWorkSessionEstablishmentIntentRecorded: excluded("No task-work provider driver."),
  TaskWorkSessionLookupFailed: excluded("No task-work provider driver."),
  TaskWorkSessionLookupRequested: excluded("No task-work provider driver."),
  TaskWorkSessionReported: excluded("No task-work provider driver."),
  TaskWorkSessionResultReported: excluded("No task-work provider driver."),
  TaskWorkStartRequestAcknowledged: excluded("No task-work provider driver."),
  TaskWorkStartRequestFailed: excluded("No task-work provider driver."),
  TaskWorkStartRequested: excluded("No task-work provider driver."),
  TaskWorktreeReady: excluded("No Git authority driver."),
  TaskWorktreeReconciliationIntended: excluded("No Git authority driver."),
  TechnicalRetryDeferralSuperseded: excluded("No technical-retry clock driver."),
  TechnicalRetryPolicyCaptured: excluded("No technical-retry driver."),
  TechnicalRetryScheduled: excluded("No technical-retry clock driver."),
  TrackerGraphObservationIntentRecorded: interactive("Produced by observing the controlled tracker."),
  TrackerGraphOutcomeObserved: interactive("Produced by observing the controlled tracker.")
} satisfies Coverage<WorkflowJournalEvent>

export const responsibilityCoverage = {
  ExecutorInvocationResponsibility: excluded("No executor-boundary driver."),
  TaskClaimResponsibility: interactive("Created by a committed claim intent."),
  TaskWorkSessionResponsibility: excluded("No task-work provider driver."),
  TaskWorktreeResponsibility: excluded("No Git authority driver.")
} satisfies Coverage<WorkflowResponsibilityEntry>

export const dispositionCoverage = {
  DependencyWait: observable("The graph editor constructs prerequisites; current eligibility filters blocked tasks before this selector seam."),
  ExecutorInvocationSettled: observable("The real selector supports it; the current driver does not settle executor invocations."),
  ExecutorInvocationWait: observable("The real selector supports it; the current driver does not retry executor invocations."),
  FinalOutcome: observable("Tracker lifecycle is editable; this responsibility disposition requires a later production responsibility stage."),
  ForeignClaimIsolation: interactive("Available as a fresh authority fact."),
  MissingClaim: interactive("Available as a fresh authority fact."),
  Paused: interactive("Available at the selector seam, while reconstructed pause remains absent."),
  Ready: interactive("Available as a fresh authority fact."),
  Relinquished: observable("The real selector supports it; no relinquishment command is driven."),
  Settled: observable("The real selector supports it; no completion protocol is driven."),
  UnreadableFactWait: observable("The real selector supports it; no failing authority adapter is driven.")
} satisfies Coverage<ResponsibilityDisposition>

export const transitionCoverage = {
  CheckTaskClaim: observable("Shown when selected; driver execution is visibly missing."),
  CheckTaskWorkSession: observable("Shown when selected; driver execution is visibly missing."),
  CommitFreshTaskClaimIntent: interactive("Can be executed when admitted."),
  ContinueExecutorInvocation: observable("Shown when selected; executor execution is visibly missing."),
  ContinueFreshWorkflowOperation: observable("Shown when selected; driver execution is visibly missing."),
  ReconcileTaskClaim: observable("Shown when selected; driver execution is visibly missing."),
  ReconcileTaskWorktree: observable("Shown when selected; driver execution is visibly missing."),
  StartExecutorInvocation: observable("Shown when selected; executor execution is visibly missing.")
} satisfies Coverage<RunnableFrontierTransition>

export const explanationCoverage = {
  ActivationInProgress: observable("Rendered if the process-local activation owner is already running it."),
  CapacityWait: observable("Rendered from real admission output."),
  DependencyWait: observable("Rendered if reached by the production selector."),
  ExecutorInvocationSettlement: observable("Rendered if reached by the production selector."),
  ExecutorInvocationWait: observable("Rendered if reached by the production selector."),
  FinalOutcome: observable("Rendered if reached by the production selector."),
  Isolation: observable("Rendered from a foreign-claim fact."),
  Pause: observable("Rendered from a paused fresh fact."),
  Relinquishment: observable("Rendered if reached by the production selector."),
  Settlement: observable("Rendered if reached by the production selector."),
  TypedIssue: observable("Rendered if the production selector rejects its fresh facts."),
  UnreadableFactWait: observable("Rendered if reached by the production selector.")
} satisfies Coverage<FrontierExplanation>

export const finalityCoverage = {
  RunMayTerminate: observable("Rendered if the controlled state reaches it."),
  RunMustRemainActive: observable("Rendered from the current frontier and unsettled target.")
} satisfies Coverage<RunFinalityDecision>
