import type { ControlCommandId, JournalRecordKey, OperationId, PlannedTaskAttempt, RunId } from "./domain.js"
import {
  attemptPlanRecordKey,
  controlCommandRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "./journal-record-key.js"
import type { WorkflowJournalEvent } from "./journal-store.js"
import type { PlannedAttemptExecutorReportOrdinal } from "./planned-attempt-executor-journal.js"
import type { PlannedAttemptExecutorCorrelation } from "./planned-attempt-executor.js"

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

interface ControlCommandEventDescriptor {
  readonly _tag: "ControlCommandEventDescriptor"
  readonly commandId: ControlCommandId
  readonly expectedKey: JournalRecordKey
  readonly runId: RunId
}

interface PlannedAttemptExecutorEventDescriptor {
  readonly _tag: "PlannedAttemptExecutorEventDescriptor"
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly expectedKey: JournalRecordKey
  readonly ordinal: PlannedAttemptExecutorReportOrdinal | undefined
  readonly plannedAttempt: PlannedTaskAttempt | undefined
}

type JournalEventDescriptor =
  | ControlCommandEventDescriptor
  | OperationEventDescriptor
  | PlannedAttemptExecutorEventDescriptor

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
    case "ControlCommandRecorded":
      return {
        _tag: "ControlCommandEventDescriptor",
        commandId: event.command.commandId,
        expectedKey: controlCommandRecordKey(event.command.commandId),
        runId: event.command.runId
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
    case "TrackerGraphObservationIntentRecorded":
      return operationEvent({
        expectedKey: intentRecordKey(event.operation.operationId),
        operationId: event.operation.operationId,
        requiredOperationIds: event.operation.predecessorOperationIds
      })
    case "TrackerGraphOutcomeObserved":
      return operationEvent({
        expectedKey: outcomeRecordKey(event.operationId),
        operationId: event.operationId,
        requiredOperationIds: [event.operationId],
        requiredPredecessorKey: intentRecordKey(event.operationId),
        requiredPredecessorKinds: ["TrackerGraphObservationIntentRecorded"]
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
