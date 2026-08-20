import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition, OperationId, PlannedWorktreeReady } from "@dalph/orchestrator"
import { Schema } from "effect"

/** The one exact reconciliation operation used by every child and durable seam. */
export const WorktreeOperationId = OperationId
export type WorktreeOperationId = typeof WorktreeOperationId.Type

/** Names the child process that owns one local observation, never an outside authority. */
export const WorktreeProcessInstance = Schema.NonEmptyString.pipe(Schema.brand("WorktreeProcessInstance"))
export type WorktreeProcessInstance = typeof WorktreeProcessInstance.Type

/** The child fault is deliberately placed on one side of Workflow result storage. */
export const WorktreeScenario = Schema.Literals([
  "UnstoredActivityResult",
  "StoredResultBeforeJournal",
  "FactsChangedDuringDowntime",
  "BlindRetry",
  "ReplayHistoricalRead"
])
export type WorktreeScenario = typeof WorktreeScenario.Type

/** The visible current-state decision after the Journal has published the historical result. */
export const WorktreeDecision = Schema.Literals(["ContinueWorktreeReady", "WaitWorktreeNotReady"])
export type WorktreeDecision = typeof WorktreeDecision.Type

/** The two child cut points at which the parent may send SIGKILL. */
export const FaultName = Schema.Literals(["AfterCreateBeforeActivityStorage", "AfterActivityStorageBeforeJournal"])
export type FaultName = typeof FaultName.Type

/** The controlled Git facts that own current worktree authority in this experiment. */
export const ControlledWorktreeObservation = Schema.TaggedUnion({
  PlannedWorktreeAbsent: {},
  PlannedWorktreeContradictory: { detail: Schema.NonEmptyString },
  PlannedWorktreeReady: {
    baseSha: GitCommitSha,
    branch: TaskBranchRef,
    headSha: GitCommitSha,
    worktree: WorktreeLocator
  }
})
export type ControlledWorktreeObservation = typeof ControlledWorktreeObservation.Type

/** Persistent outside-world facts; this file is controlled Git evidence, not a Dalph state store. */
export const ControlledWorld = Schema.Struct({
  observation: ControlledWorktreeObservation,
  plannedAttempt: PlannedTaskAttempt,
  schemaVersion: Schema.Literal(1)
})
export type ControlledWorld = typeof ControlledWorld.Type

/** One controlled Git boundary call, including the exact identities it received. */
export const ControlledGitCall = Schema.TaggedUnion({
  ReadPlannedWorktree: {
    attemptId: AttemptId,
    baseSha: GitCommitSha,
    branch: TaskBranchRef,
    operationId: WorktreeOperationId,
    processInstance: WorktreeProcessInstance,
    result: Schema.Literals(["PlannedWorktreeAbsent", "PlannedWorktreeContradictory", "PlannedWorktreeReady"]),
    runId: RunId,
    worktree: WorktreeLocator
  },
  CreatePlannedWorktree: {
    applied: Schema.Literal(true),
    attemptId: AttemptId,
    baseSha: GitCommitSha,
    branch: TaskBranchRef,
    operationId: WorktreeOperationId,
    processInstance: WorktreeProcessInstance,
    runId: RunId,
    worktree: WorktreeLocator
  }
})
export type ControlledGitCall = typeof ControlledGitCall.Type

/** Evidence that the Workflow handler reached the result-storage/replay seam. */
export const ActivityEvidence = Schema.TaggedStruct("ActivityResultAvailable", {
  activityName: Schema.NonEmptyString,
  attemptId: AttemptId,
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  executionId: Schema.NonEmptyString,
  headSha: GitCommitSha,
  operationId: WorktreeOperationId,
  processInstance: WorktreeProcessInstance,
  runId: RunId,
  worktree: WorktreeLocator
})
export type ActivityEvidence = typeof ActivityEvidence.Type

/** The only value a Workflow Activity may return: exact identities plus a controlled Git proof. */
export const WorktreeActivityResult = Schema.Struct({
  attemptId: AttemptId,
  operationId: WorktreeOperationId,
  proof: PlannedWorktreeReady,
  runId: RunId
})
export type WorktreeActivityResult = typeof WorktreeActivityResult.Type

/** Every known controlled Git/ownership failure remains distinguishable across the Activity boundary. */
export const WorktreeActivityFailureReason = Schema.Literals([
  "CompetingWorktreeRegistrations",
  "ConflictingWorktreeRegistration",
  "ContradictoryWorktreeState",
  "CoordinatorLockObservationContradiction",
  "CoordinatorOwnershipLost",
  "ForeignWorktreeRegistration",
  "GitWorktreeCreateFailure",
  "GitWorktreeReadFailure",
  "UntrackedWorktreePath",
  "UnknownActivityFailure",
  "WorktreeBaseMismatch"
])
export type WorktreeActivityFailureReason = typeof WorktreeActivityFailureReason.Type

/** Typed Activity failure; contradictory controlled Git facts cannot become a defect or an absent result. */
export class WorktreeActivityError extends Schema.TaggedError<WorktreeActivityError>()("WorktreeActivityError", {
  detail: Schema.String,
  reason: WorktreeActivityFailureReason,
  worktree: WorktreeLocator
}) {}

/** An observed call at the real executor boundary; this experiment must produce none. */
export const ExecutorBoundaryContact = Schema.Struct({
  method: Schema.Literals(["project", "requestSuspension", "startOrContinue"]),
  operationId: WorktreeOperationId,
  processInstance: WorktreeProcessInstance,
  runId: RunId
})
export type ExecutorBoundaryContact = typeof ExecutorBoundaryContact.Type

/** Process-local proposal visibility evidence; no proposal is persisted as authority. */
export const ProposalObservation = Schema.TaggedUnion({
  PresentBeforeActivity: { processInstance: WorktreeProcessInstance },
  PresentAfterRestartBeforeJournal: { processInstance: WorktreeProcessInstance },
  AbsentAfterJournalPublication: { processInstance: WorktreeProcessInstance }
})
export type ProposalObservation = typeof ProposalObservation.Type

/** Current decision evidence is separate from the historical Journal outcome. */
export const DecisionEvidence = Schema.Struct({
  decision: WorktreeDecision,
  executorBoundaryContacts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  operationId: WorktreeOperationId,
  processInstance: WorktreeProcessInstance,
  runId: RunId,
  source: Schema.Literals(["ControlledGitFreshRead", "ReplayedWorkflowResult"])
})
export type DecisionEvidence = typeof DecisionEvidence.Type

/** The ordinary production Journal projection changed its exact operation from pending to settled. */
export const ResponsibilityProjectionEvidence = Schema.Struct({
  disposition: Schema.Literals(["Ready", "Settled", "WorkflowOperationTaskClaimConstraint"]),
  operationId: WorktreeOperationId,
  position: JournalPosition,
  processInstance: WorktreeProcessInstance,
  runId: RunId
})
export type ResponsibilityProjectionEvidence = typeof ResponsibilityProjectionEvidence.Type

/** Child stdout protocol owned by the parent harness. */
export const ChildMessage = Schema.TaggedUnion({
  ChildReady: {
    activityName: Schema.NonEmptyString,
    attemptId: AttemptId,
    branch: TaskBranchRef,
    executionId: Schema.NonEmptyString,
    operationId: WorktreeOperationId,
    plannedBaseSha: GitCommitSha,
    runId: RunId,
    worktree: WorktreeLocator
  },
  Completed: { decision: WorktreeDecision, runId: RunId },
  FaultReached: { fault: FaultName, runId: RunId },
  PublicationSuppressed: { runId: RunId },
  ProtocolFailure: { detail: Schema.NonEmptyString }
})
export type ChildMessage = typeof ChildMessage.Type

/** Fixture identities are deliberately branded once and then reused everywhere. */
export const fixture = {
  activityName: "ReconcileTaskWorktree/operation-234-worktree-0001",
  attemptId: AttemptId.make("attempt-234-worktree-0001"),
  baseSha: GitCommitSha.make("b0b4a15d3a4c1e75b129c0c620042a64c2178692"),
  branch: TaskBranchRef.make("refs/heads/dalph/issue-234-worktree-0001"),
  executor: TaskExecutorLocator.make("executor:controlled-prototype-never-started"),
  operationId: WorktreeOperationId.make("operation-234-worktree-0001"),
  runId: RunId.make("run-234-worktree-0001"),
  taskId: TaskId.make("task-234-worktree-0001"),
  taskRevision: TaskRevision.make("task-revision-234-worktree-0001"),
  worktree: WorktreeLocator.make("/controlled/prototype/worktrees/issue-234-worktree-0001")
} as const

export const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: fixture.attemptId,
  baseSha: fixture.baseSha,
  branch: fixture.branch,
  executor: fixture.executor,
  runId: fixture.runId,
  taskId: fixture.taskId,
  taskRevision: fixture.taskRevision,
  worktree: fixture.worktree
})

/** Builds the exact Activity result once, so every retry uses the same identity/proof shape. */
export const activityResultFor = (
  payload: Pick<WorktreeActivityResult, "attemptId" | "operationId" | "runId">,
  proof: PlannedWorktreeReady
): WorktreeActivityResult => WorktreeActivityResult.make({ ...payload, proof })

export const faultFor = (scenario: WorktreeScenario): FaultName | undefined =>
  scenario === "UnstoredActivityResult"
    ? "AfterCreateBeforeActivityStorage"
    : scenario === "StoredResultBeforeJournal" ||
        scenario === "FactsChangedDuringDowntime" ||
        scenario === "ReplayHistoricalRead"
      ? "AfterActivityStorageBeforeJournal"
      : scenario === "BlindRetry"
        ? "AfterCreateBeforeActivityStorage"
      : undefined
