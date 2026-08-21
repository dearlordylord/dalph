import { Schema } from "effect"
import { PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { ActiveTaskClaim, TaskClaimObservation } from "../../../authorities/task-tracker/claim-mutation.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { RunTerminationDisposition } from "../../../coordination/frontier/run-finality.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { OperationId } from "../../identity.js"
import { AttemptQuiescenceProof } from "../attempt-choice/events.js"

/** Operator durably stopped forward admission for one exact Run. */
export const RunCancellationAppliedEvent = Schema.TaggedStruct("RunCancellationApplied", {
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type RunCancellationAppliedEvent = typeof RunCancellationAppliedEvent.Type

/** Alice's transport-independent command for one exact nonterminal Run. */
export const ApplyRunCancellationRequest = Schema.Struct({ runId: RunId })
export type ApplyRunCancellationRequest = typeof ApplyRunCancellationRequest.Type

/** Durable cancellation state observed after applying or semantically redelivering the command. */
export const AppliedRunCancellation = Schema.TaggedUnion({
  RunCancellationApplied: { appliedAt: JournalPosition },
  RunCancellationAlreadyApplied: { appliedAt: JournalPosition },
  RunCancellationRunTerminated: { disposition: RunTerminationDisposition, terminatedAt: JournalPosition }
})
export type AppliedRunCancellation = typeof AppliedRunCancellation.Type

/**
 * Cancellation has proved that one exact planned attempt is no longer allowed
 * to write. The executor proof is retained separately from the later tracker
 * claim disposition so safe suspension or terminal work never implies claim
 * release.
 */
export const CancelledAttemptImplementationResponsibilityRelinquishedEvent = Schema.TaggedStruct(
  "CancelledAttemptImplementationResponsibilityRelinquished",
  {
    authorizedClaim: ActiveTaskClaim,
    cancellationAppliedAt: JournalPosition,
    initiatedBy: WorkflowActor.cases.DalphCoordinator,
    occurrenceClassification: Schema.Literal("InitiatedAction"),
    plannedAttempt: PlannedTaskAttempt,
    proof: AttemptQuiescenceProof,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CancelledAttemptImplementationResponsibilityRelinquishedEvent =
  typeof CancelledAttemptImplementationResponsibilityRelinquishedEvent.Type

/**
 * A focused post-cancellation claim read proved the exact claim was absent or
 * foreign. Dalph records the observation and leaves that claim untouched.
 */
export const CancelledAttemptClaimNoReleaseObservedEvent = Schema.TaggedStruct(
  "CancelledAttemptClaimNoReleaseObserved",
  {
    cancellationAppliedAt: JournalPosition,
    expectedClaim: ActiveTaskClaim,
    observation: TaskClaimObservation,
    observationOperationId: OperationId,
    occurrenceClassification: Schema.Literal("NonActionOccurrence"),
    plannedAttempt: PlannedTaskAttempt,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CancelledAttemptClaimNoReleaseObservedEvent = typeof CancelledAttemptClaimNoReleaseObservedEvent.Type
