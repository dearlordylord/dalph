import {
  type AttemptId,
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import type { ControlDirectionApplicationOrdinal } from "../protocols/control-direction-application/events.js"
import type { TaskClaimReacquisitionRequestId } from "../protocols/task-claim-reacquisition/events.js"
import { type JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import { type OperationId } from "../identity.js"
import {
  attemptPlanRecordKey,
  controlDirectionAppliedRecordKey,
  taskClaimReacquisitionDirectedRecordKey,
  intentRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  workflowRunBeganRecordKey,
  workflowRunTerminatedRecordKey,
  taskWorkCapacityPolicyRecordKey
} from "../../workflow-journal/record-key.js"
import type { WorkflowJournalEvent } from "./event.js"
import type { PlannedAttemptExecutorReportOrdinal } from "../protocols/planned-attempt-executor-work/events.js"

interface OperationEventDescriptor {
  readonly _tag: "OperationEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly operationId: OperationId
  readonly plannedAttempt: PlannedAttemptFact
  readonly relatedOperationIds: ReadonlyArray<OperationId>
  readonly requiredOperationIds: ReadonlyArray<OperationId>
  readonly requiredPredecessorKinds: ReadonlyArray<WorkflowJournalEvent["_tag"]>
  readonly recordPredecessor: RecordPredecessorFact
}

interface ControlDirectionEventDescriptor {
  readonly _tag: "ControlDirectionEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly ordinal: ControlDirectionApplicationOrdinal
  readonly runId: RunId
}

interface TaskClaimReacquisitionDirectionEventDescriptor {
  readonly _tag: "TaskClaimReacquisitionDirectionEventDescriptor"
  readonly expectedKey: JournalRecordKey
  readonly requestId: TaskClaimReacquisitionRequestId
  readonly runId: RunId
}

interface PlannedAttemptExecutorEventDescriptor {
  readonly _tag: "PlannedAttemptExecutorEventDescriptor"
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly expectedKey: JournalRecordKey
  readonly ordinal: PlannedAttemptExecutorReportOrdinal | undefined
  readonly plannedAttempt: PlannedTaskAttempt | undefined
}

interface WorkflowRunLifecycleEventDescriptor {
  readonly _tag: "WorkflowRunLifecycleEventDescriptor"
  readonly expectedKey: JournalRecordKey
}

interface RunPolicyEventDescriptor {
  readonly _tag: "RunPolicyEventDescriptor"
  readonly expectedKey: JournalRecordKey
}

interface IntegrationEventDescriptor {
  readonly _tag: "IntegrationEventDescriptor"
  readonly attemptId: AttemptId
  readonly expectedKey: JournalRecordKey
  readonly responsibilityBeganAt: JournalPosition | undefined
  readonly runId: RunId
}

type JournalEventDescriptor =
  | ControlDirectionEventDescriptor
  | IntegrationEventDescriptor
  | OperationEventDescriptor
  | PlannedAttemptExecutorEventDescriptor
  | RunPolicyEventDescriptor
  | TaskClaimReacquisitionDirectionEventDescriptor
  | WorkflowRunLifecycleEventDescriptor

type PlannedAttemptFact =
  | { readonly _tag: "NoPlannedAttempt" }
  | { readonly _tag: "PlannedAttempt"; readonly plannedAttempt: PlannedTaskAttempt }

type RecordPredecessorFact =
  | { readonly _tag: "NoRecordPredecessor" }
  | { readonly _tag: "RequiredRecordPredecessor"; readonly key: JournalRecordKey }

interface OperationEventInput {
  readonly expectedKey: JournalRecordKey
  readonly operationId: OperationId
  readonly plannedAttempt?: PlannedTaskAttempt
  readonly relatedOperationIds?: ReadonlyArray<OperationId>
  readonly requiredOperationIds: ReadonlyArray<OperationId>
  readonly requiredPredecessorKey?: JournalRecordKey
  readonly requiredPredecessorKinds?: ReadonlyArray<WorkflowJournalEvent["_tag"]>
}

const operationEvent = (input: OperationEventInput): OperationEventDescriptor => ({
  _tag: "OperationEventDescriptor",
  expectedKey: input.expectedKey,
  operationId: input.operationId,
  plannedAttempt:
    input.plannedAttempt === undefined
      ? { _tag: "NoPlannedAttempt" }
      : { _tag: "PlannedAttempt", plannedAttempt: input.plannedAttempt },
  recordPredecessor:
    input.requiredPredecessorKey === undefined
      ? { _tag: "NoRecordPredecessor" }
      : { _tag: "RequiredRecordPredecessor", key: input.requiredPredecessorKey },
  relatedOperationIds: input.relatedOperationIds ?? [],
  requiredOperationIds: input.requiredOperationIds,
  requiredPredecessorKinds: input.requiredPredecessorKinds ?? []
})

const plannedAttemptExecutorEvent = (
  correlation: PlannedAttemptExecutorCorrelation,
  expectedKey: JournalRecordKey,
  plannedAttempt: PlannedTaskAttempt | undefined,
  ordinal: PlannedAttemptExecutorReportOrdinal | undefined
): PlannedAttemptExecutorEventDescriptor => ({
  _tag: "PlannedAttemptExecutorEventDescriptor",
  correlation,
  expectedKey,
  ordinal,
  plannedAttempt
})

/** Derives canonical storage identity and causal facts from one generic event. */
export const describeJournalEvent = (event: WorkflowJournalEvent): JournalEventDescriptor => {
  switch (event._tag) {
    case "WorkflowRunBegan":
      return { _tag: "WorkflowRunLifecycleEventDescriptor", expectedKey: workflowRunBeganRecordKey }
    case "WorkflowRunTerminated":
      return { _tag: "WorkflowRunLifecycleEventDescriptor", expectedKey: workflowRunTerminatedRecordKey }
    case "TaskWorkCapacityChanged":
      return { _tag: "RunPolicyEventDescriptor", expectedKey: taskWorkCapacityPolicyRecordKey(event.revision) }
    case "ControlDirectionApplied":
      return {
        _tag: "ControlDirectionEventDescriptor",
        expectedKey: controlDirectionAppliedRecordKey(event.ordinal),
        ordinal: event.ordinal,
        runId: event.subject.runId
      }
    case "TaskClaimReacquisitionDirected":
      return {
        _tag: "TaskClaimReacquisitionDirectionEventDescriptor",
        expectedKey: taskClaimReacquisitionDirectedRecordKey(event.requestId),
        requestId: event.requestId,
        runId: event.subject.runId
      }
    case "PlannedAttemptExecutorWorkResponsibilityBegan":
      return plannedAttemptExecutorEvent(
        { attemptId: event.plannedAttempt.attemptId, runId: event.plannedAttempt.runId },
        plannedAttemptExecutorWorkResponsibilityBeganRecordKey(event.plannedAttempt.attemptId),
        event.plannedAttempt,
        undefined
      )
    case "PlannedAttemptExecutorWorkReported":
      return plannedAttemptExecutorEvent(
        event.report.correlation,
        plannedAttemptExecutorWorkReportedRecordKey(event.report.correlation.attemptId, event.ordinal),
        undefined,
        event.ordinal
      )
    case "IntegrationResponsibilityBegan":
      return {
        _tag: "IntegrationEventDescriptor",
        attemptId: event.plannedAttempt.attemptId,
        expectedKey: integrationResponsibilityBeganRecordKey(event.plannedAttempt.attemptId),
        responsibilityBeganAt: undefined,
        runId: event.plannedAttempt.runId
      }
    case "IntegrationStarted":
      return {
        _tag: "IntegrationEventDescriptor",
        attemptId: event.plannedAttempt.attemptId,
        expectedKey: integrationStartedRecordKey(event.plannedAttempt.attemptId),
        responsibilityBeganAt: event.responsibilityBeganAt,
        runId: event.plannedAttempt.runId
      }
    case "TaskTrackerReadIntentRecorded":
      return operationEvent({
        expectedKey: intentRecordKey(event.operation.operationId),
        operationId: event.operation.operationId,
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "GitReadIntentRecorded":
      return operationEvent({
        expectedKey: intentRecordKey(event.operation.operationId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "PlannedAttemptWorktreeObserved":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["GitReadIntentRecorded"]
      })
    case "TargetLineageObserved":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        plannedAttempt: event.plannedAttempt,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["GitReadIntentRecorded"]
      })
    case "TaskTrackerFactsObserved":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["TaskTrackerReadIntentRecorded"]
      })
    case "TaskClaimAcquisitionIntended":
      return operationEvent({
        expectedKey: intentRecordKey(event.operation.acquisition.operationId),
        operationId: event.operation.acquisition.operationId,
        relatedOperationIds: [event.operation.acquisition.operationId],
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "TaskClaimAcquired":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.claim.operationId),
        operationId: event.claim.operationId,
        relatedOperationIds: [event.claim.operationId],
        requiredOperationIds: [event.claim.operationId],
        requiredPredecessorKey: intentRecordKey(event.claim.operationId),
        requiredPredecessorKinds: ["TaskClaimAcquisitionIntended"]
      })
    case "TaskClaimAcquisitionRejected":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        relatedOperationIds: [event.operationId, event.observed.operationId],
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["TaskClaimAcquisitionIntended"]
      })
    case "TaskClaimReleaseIntended":
      return operationEvent({
        expectedKey: intentRecordKey(event.operation.release.operationId),
        operationId: event.operation.release.operationId,
        relatedOperationIds: [event.operation.release.operationId, event.operation.release.claim.operationId],
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "TaskClaimReleased":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.release.operationId),
        operationId: event.release.operationId,
        relatedOperationIds: [event.release.operationId, event.release.claim.operationId],
        requiredOperationIds: [event.release.operationId],
        requiredPredecessorKey: intentRecordKey(event.release.operationId),
        requiredPredecessorKinds: ["TaskClaimReleaseIntended"]
      })
    case "TaskAttemptPlanned":
      return operationEvent({
        expectedKey: attemptPlanRecordKey(event.operation.plannedAttempt.attemptId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "TaskWorktreeReconciliationIntended":
      return operationEvent({
        expectedKey: intentRecordKey(event.operation.operationId),
        operationId: event.operation.operationId,
        plannedAttempt: event.operation.plannedAttempt,
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "TaskWorktreeReady":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["TaskWorktreeReconciliationIntended"]
      })
  }
}
