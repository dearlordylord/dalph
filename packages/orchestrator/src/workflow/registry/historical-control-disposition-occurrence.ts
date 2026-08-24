import { Schema } from "effect"
import { PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { ActiveTaskClaim, TaskClaimObservation } from "../../authorities/task-tracker/claim-mutation.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../identity.js"
import { WorkflowActor } from "./actor.js"
import { AttemptQuiescenceProof } from "../protocols/attempt-choice/events.js"
import { BranchCleanupJournalEvent } from "../protocols/disposition-cleanup/branch.js"
import { IntegratorCandidateCleanupJournalEvent } from "../protocols/disposition-cleanup/integrator-candidate.js"
import { WorktreeCleanupJournalEvent } from "../protocols/disposition-cleanup/worktree.js"

/** Operator applied cancellation to one exact Run; cancellation is not executor or app exit. */
export const RunCancellationApplied = Schema.TaggedStruct("RunCancellationApplied", {
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type RunCancellationApplied = typeof RunCancellationApplied.Type

/** Cancellation relinquished one executor responsibility after an explicit quiescence proof. */
export const CancelledAttemptImplementationResponsibilityRelinquished = Schema.TaggedStruct(
  "CancelledAttemptImplementationResponsibilityRelinquished",
  {
    authorizedClaim: ActiveTaskClaim,
    cancellationAppliedAt: JournalPosition,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    plannedAttempt: PlannedTaskAttempt,
    proof: AttemptQuiescenceProof,
    recordedAt: JournalPosition,
    runId: RunId
  }
)
export type CancelledAttemptImplementationResponsibilityRelinquished =
  typeof CancelledAttemptImplementationResponsibilityRelinquished.Type

/** Cancellation observed a non-owned claim without releasing it. */
export const CancelledAttemptClaimNoReleaseObserved = Schema.TaggedStruct("CancelledAttemptClaimNoReleaseObserved", {
  cancellationAppliedAt: JournalPosition,
  expectedClaim: ActiveTaskClaim,
  observation: TaskClaimObservation,
  observationOperationId: OperationId,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  plannedAttempt: PlannedTaskAttempt,
  recordedAt: JournalPosition,
  runId: RunId
})
export type CancelledAttemptClaimNoReleaseObserved = typeof CancelledAttemptClaimNoReleaseObserved.Type

/** One immutable worktree cleanup journal event retained with its exact source position. */
export const WorktreeCleanupOccurred = Schema.TaggedStruct("WorktreeCleanupOccurred", {
  event: WorktreeCleanupJournalEvent,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type WorktreeCleanupOccurred = typeof WorktreeCleanupOccurred.Type

/** One immutable branch cleanup journal event retained separately from worktree cleanup. */
export const BranchCleanupOccurred = Schema.TaggedStruct("BranchCleanupOccurred", {
  event: BranchCleanupJournalEvent,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type BranchCleanupOccurred = typeof BranchCleanupOccurred.Type

/** One immutable provider-owned Integrator candidate cleanup event. */
export const IntegratorCandidateCleanupOccurred = Schema.TaggedStruct("IntegratorCandidateCleanupOccurred", {
  event: IntegratorCandidateCleanupJournalEvent,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  recordedAt: JournalPosition,
  runId: RunId
})
export type IntegratorCandidateCleanupOccurred = typeof IntegratorCandidateCleanupOccurred.Type
