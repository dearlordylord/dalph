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
  EstablishTaskWorkSession: interactive("The production stage runs through the dry-run interpreter."),
  ExecuteTaskWork: interactive("The Lab's fake executor boundary is invoked through the selected executor's opaque outer protocol."),
  HandBackReviewFindings: interactive("Findings from the Lab's fake reviewer cross the journaled handback boundary."),
  ReadTrackerGraph: interactive("The Lab's fake task tracker can be observed repeatedly."),
  ReconcileTaskWorktree: interactive("The production stage runs through the dry-run interpreter."),
  RecordImplementationDisposition: interactive("The selected executor journals its exact terminal disposition."),
  RecordTaskAttemptPlan: interactive("The production stage plans the exact attempt."),
  ReviewImplementation: interactive("The Lab's fake independent reviewer is invoked inside the selected executor protocol."),
  SealImplementationEvidence: interactive("The Lab's fake content-addressed evidence store is invoked inside the selected executor protocol.")
} satisfies Coverage<WorkflowOperation>

/** Journal events are consequences of driver operations, never raw UI buttons. */
export const workflowJournalEventCoverage = {
  ControlCommandRecorded: interactive("Produced by authenticated pause and unpause controls."),
  ImplementationConvergenceDispositionRecorded: interactive("Produced when the Lab's selected fake executor accepts the implementation."),
  ImplementationEvidenceSealed: interactive("Produced through the Lab's fake evidence store."),
  ImplementationEvidenceSealingIntended: interactive("Produced before the Lab's fake evidence store is called."),
  ImplementationReviewCompleted: interactive("Produced through the Lab's fake independent reviewer."),
  ImplementationReviewIntended: interactive("Produced before the Lab's fake independent reviewer is invoked."),
  ReviewFindingsHandbackCompleted: interactive("Produced when the Lab's fake reviewer findings return to the exact implementer session."),
  ReviewFindingsHandbackIntended: interactive("Produced before the Lab sends fake reviewer findings back."),
  TaskAttemptPlanned: interactive("Produced by the real attempt-planning stage."),
  TaskClaimAcquired: interactive("Produced by the Lab's fake task-tracker claim adapter."),
  TaskClaimAcquisitionIntended: interactive("Produced by an admitted claim move."),
  TaskExecutionIntentRecorded: interactive("Produced before a request to the Lab's fake executor."),
  TaskExecutionObservationFailed: interactive("Produced by the selectable executor-observation failure."),
  TaskExecutionOutcomeObserved: interactive("Produced from a successful observation of the Lab's fake executor."),
  TaskExecutionReported: interactive("Produced from the Lab's fake executor report."),
  TaskExecutionRequestAttemptRecorded: interactive("Produced before a request to the Lab's fake executor."),
  TaskExecutionRequestFailed: interactive("Produced by the selectable executor-request failure."),
  TaskExecutionRequestReturned: interactive("Produced by the Lab's fake executor acknowledgement."),
  TaskWorkSessionEstablished: interactive("Produced from the Lab's fake task-work provider."),
  TaskWorkSessionEstablishmentIntentRecorded: interactive("Produced before task-work session establishment."),
  TaskWorkSessionLookupFailed: interactive("Produced by the selectable task-work lookup failure."),
  TaskWorkSessionLookupRequested: interactive("Produced before looking up a session through the Lab's fake task-work provider."),
  TaskWorkSessionReported: interactive("Produced from the Lab's fake task-work provider report."),
  TaskWorkSessionResultReported: excluded("No task-work provider driver."),
  TaskWorkStartRequestAcknowledged: interactive("Produced by the Lab's fake task-work provider acknowledgement."),
  TaskWorkStartRequestFailed: interactive("Produced by the selectable task-work start failure."),
  TaskWorkStartRequested: interactive("Produced before a request to the Lab's fake task-work provider."),
  TaskWorktreeReady: interactive("Produced from the authoritative proof returned by the Lab's fake Git boundary."),
  TaskWorktreeReconciliationIntended: interactive("Produced before reconciliation through the Lab's fake Git boundary."),
  TechnicalRetryDeferralSuperseded: interactive("Produced immediately before retrying the Lab's applicable fake boundary."),
  TechnicalRetryPolicyCaptured: interactive("Produced when the journaled review or handback boundary captures its retry policy."),
  TechnicalRetryScheduled: interactive("Produced when a technical failure from a Lab fake boundary schedules its bounded retry."),
  TrackerGraphObservationIntentRecorded: interactive("Produced before reading the Lab's fake task tracker."),
  TrackerGraphOutcomeObserved: interactive("Produced after successfully reading the Lab's fake task tracker.")
} satisfies Coverage<WorkflowJournalEvent>

export const responsibilityCoverage = {
  ExecutorInvocationResponsibility: interactive("Created by the journaled boundary around the Lab's fake executor."),
  TaskClaimResponsibility: interactive("Created by a committed claim intent."),
  TaskWorkSessionResponsibility: interactive("Created by the journaled boundary around the Lab's fake task-work provider."),
  TaskWorktreeResponsibility: interactive("Created by the journaled boundary around the Lab's fake Git adapter.")
} satisfies Coverage<WorkflowResponsibilityEntry>

export const dispositionCoverage = {
  DependencyWait: interactive("Available for every exact outstanding responsibility."),
  ExecutorInvocationSettled: interactive("Available for exact executor-invocation responsibilities."),
  ExecutorInvocationWait: interactive("Available for exact executor-invocation responsibilities."),
  FinalOutcome: interactive("Derived from observed tracker lifecycle or supplied directly per responsibility."),
  ForeignClaimIsolation: interactive("Available as a fresh authority fact."),
  MissingClaim: interactive("Available as a fresh authority fact."),
  Paused: interactive("Available at the selector seam, while reconstructed pause remains absent."),
  Ready: interactive("Available as a fresh authority fact."),
  Relinquished: interactive("Available for every exact outstanding responsibility."),
  Settled: interactive("Available for every exact outstanding responsibility."),
  UnreadableFactWait: interactive("Available for every exact outstanding responsibility.")
} satisfies Coverage<ResponsibilityDisposition>

export const transitionCoverage = {
  CheckTaskClaim: observable("Shown when selected; driver execution is visibly missing."),
  CheckTaskWorkSession: observable("Shown when selected; driver execution is visibly missing."),
  CommitFreshTaskClaimIntent: interactive("Can be executed when admitted."),
  ContinueExecutorInvocation: observable("Shown when selected; executor execution is visibly missing."),
  ContinueFreshWorkflowOperation: interactive("The current production stage can be executed one operation at a time."),
  ReconcileTaskClaim: observable("Shown when selected; driver execution is visibly missing."),
  ReconcileTaskWorktree: observable("Shown when selected; driver execution is visibly missing."),
  StartExecutorInvocation: interactive("The current selected-executor stage can be executed one invocation at a time.")
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
  TypedIssue: interactive("Selectable missing and duplicate fact cardinalities reach the production typed issue."),
  UnreadableFactWait: observable("Rendered if reached by the production selector.")
} satisfies Coverage<FrontierExplanation>

export const finalityCoverage = {
  RunMayTerminate: observable("Rendered if production reconstruction over the current Lab inputs reaches it."),
  RunMustRemainActive: observable("Rendered from the current frontier and unsettled target.")
} satisfies Coverage<RunFinalityDecision>
