import { Schema } from "effect"
import { PlannedTaskAttempt } from "@dalph/contracts"
import { ControlDirectionAppliedEvent } from "../protocols/control-direction-application/events.js"
import { TaskClaimReacquisitionDirectedEvent } from "../protocols/task-claim-reacquisition/events.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ActiveTaskClaim, TaskClaimRelease } from "../../authorities/task-tracker/claim-mutation.js"
import { workflowJournalEventVersion } from "../kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../protocols/planned-attempt-executor-work/events.js"
import { PlannedAttemptContinuationAuthorizedEvent } from "../protocols/planned-attempt-continuation/events.js"
import { TaskTrackerFactsObservedEvent } from "../task-tracker-facts/observation.js"
import { OperationId } from "../identity.js"
import { WorkflowOperation as WorkflowOperationSchema } from "./operation.js"
import { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { WorkflowActor } from "./actor.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../protocols/integration-admission/events.js"
import { PlannedAttemptWorktreeObservation } from "../protocols/planned-attempt-worktree-observation/protocol.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { IntegrationCandidateConstructionJournalEvent } from "../protocols/integration-candidate-construction/events.js"
import { IntegratorJournalEvent } from "../protocols/integrator/events.js"
import { TargetVerificationJournalEvent } from "../protocols/target-verification/events.js"
import { TargetPromotionJournalEvent } from "../protocols/target-promotion/events.js"
import { IntegrationFinalityJournalEvent } from "../protocols/integration-finality/events.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptImplementationAbandonedEvent,
  AttemptStoppageIntendedEvent,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "../protocols/attempt-choice/events.js"
import {
  AttemptRestartAuthorityReadFailedEvent,
  PlannedAttemptReplacedEvent
} from "../protocols/attempt-choice/replacement-events.js"

const ResponsibilityJournalEvent = Schema.Union([
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  IntegrationCandidateConstructionJournalEvent,
  IntegratorJournalEvent,
  TargetVerificationJournalEvent,
  TargetPromotionJournalEvent,
  IntegrationFinalityJournalEvent
])

/**
 * Dalph durably began one Run for the exact tracker target. This must be the
 * first record for the Run and is created only by Run establishment.
 */
export const WorkflowRunBeganEvent = Schema.TaggedStruct("WorkflowRunBegan", {
  initialControlPolicy: InitialControlPolicy,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  target: TrackerTarget,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Operator durably changed the future task-admission ceiling for one Run. */
export const TaskWorkCapacityChangedEvent = Schema.TaggedStruct("TaskWorkCapacityChanged", {
  capacity: TaskWorkCapacity,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  previousRevision: RunPolicyRevision,
  revision: RunPolicyRevision,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type TaskWorkCapacityChangedEvent = typeof TaskWorkCapacityChangedEvent.Type

/**
 * Dalph reached the normal no-more-runnable-work result for one Run. A crash
 * records no termination, leaving the Run eligible for recovery.
 */
export const WorkflowRunTerminatedEvent = Schema.TaggedStruct("WorkflowRunTerminated", {
  disposition: Schema.Literal("Completed"),
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  version: Schema.Literal(workflowJournalEventVersion)
})

const TaskTrackerReadOperation = Schema.Union([
  WorkflowOperationSchema.cases.ReadCompletionTaskFacts,
  WorkflowOperationSchema.cases.ReadTaskClaim,
  WorkflowOperationSchema.cases.ReadTrackerGraph,
  WorkflowOperationSchema.cases.ReadTaskWorkSpecification
])

export const TaskTrackerReadIntentRecordedEvent = Schema.TaggedStruct("TaskTrackerReadIntentRecorded", {
  operation: TaskTrackerReadOperation,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskClaimAcquisitionIntendedEvent = Schema.TaggedStruct("TaskClaimAcquisitionIntended", {
  operation: WorkflowOperationSchema.cases.AcquireTaskClaim,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskClaimAcquiredEvent = Schema.TaggedStruct("TaskClaimAcquired", {
  claim: ActiveTaskClaim,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Atomic acquisition definitely preserved a different exact tracker claim. */
export const TaskClaimAcquisitionRejectedEvent = Schema.TaggedStruct("TaskClaimAcquisitionRejected", {
  observed: ActiveTaskClaim,
  operationId: OperationId,
  reason: Schema.Literal("ForeignClaim"),
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Dalph durably intends to delete only the embedded exact tracker claim. */
export const TaskClaimReleaseIntendedEvent = Schema.TaggedStruct("TaskClaimReleaseIntended", {
  operation: WorkflowOperationSchema.cases.ReleaseTaskClaim,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** A fresh tracker read proved the intended exact claim is absent. */
export const TaskClaimReleasedEvent = Schema.TaggedStruct("TaskClaimReleased", {
  release: TaskClaimRelease,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskAttemptPlannedEvent = Schema.TaggedStruct("TaskAttemptPlanned", {
  operation: WorkflowOperationSchema.cases.RecordTaskAttemptPlan,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskWorktreeReconciliationIntendedEvent = Schema.TaggedStruct("TaskWorktreeReconciliationIntended", {
  operation: WorkflowOperationSchema.cases.ReconcileTaskWorktree,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TaskWorktreeReadyEvent = Schema.TaggedStruct("TaskWorktreeReady", {
  operationId: OperationId,
  proof: PlannedWorktreeReady,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const GitReadIntentRecordedEvent = Schema.TaggedStruct("GitReadIntentRecorded", {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  operation: Schema.Union([
    WorkflowOperationSchema.cases.ReadTaskWorktree,
    WorkflowOperationSchema.cases.ReadTargetLineage
  ]),
  version: Schema.Literal(workflowJournalEventVersion)
})

export const PlannedAttemptWorktreeObservedEvent = Schema.TaggedStruct("PlannedAttemptWorktreeObserved", {
  observation: PlannedAttemptWorktreeObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const TargetLineageObservedEvent = Schema.TaggedStruct("TargetLineageObserved", {
  observation: TargetLineageObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  plannedAttempt: PlannedTaskAttempt,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Closed semantic event vocabulary accepted by the workflow journal. */
export const WorkflowJournalEvent = Schema.Union([
  WorkflowRunBeganEvent,
  WorkflowRunTerminatedEvent,
  TaskWorkCapacityChangedEvent,
  ControlDirectionAppliedEvent,
  AttemptChoiceAppliedEvent,
  AttemptRestartAuthorityReadFailedEvent,
  PlannedAttemptReplacedEvent,
  AttemptStoppageIntendedEvent,
  AttemptImplementationAbandonedEvent,
  StoppedAttemptClaimNoReleaseObservedEvent,
  TaskClaimReacquisitionDirectedEvent,
  TaskTrackerReadIntentRecordedEvent,
  TaskTrackerFactsObservedEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskClaimReleaseIntendedEvent,
  TaskClaimReleasedEvent,
  TaskAttemptPlannedEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskWorktreeReadyEvent,
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  ResponsibilityJournalEvent,
  PlannedAttemptContinuationAuthorizedEvent
]).check(
  Schema.makeFilter((event) =>
    event._tag !== "TargetLineageObserved" || event.observation.plannedBaseSha === event.plannedAttempt.baseSha
      ? undefined
      : "target lineage must be bound to the exact planned Base SHA"
  )
)
export type WorkflowJournalEvent = typeof WorkflowJournalEvent.Type

export const taskTrackerReadIntent = (
  operation: typeof TaskTrackerReadOperation.Type
): typeof TaskTrackerReadIntentRecordedEvent.Type =>
  TaskTrackerReadIntentRecordedEvent.make({ operation, version: workflowJournalEventVersion })
