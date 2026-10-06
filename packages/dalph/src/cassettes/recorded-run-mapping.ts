import {
  TaskAttemptBaseRetryRequestedEvent,
  TaskWorkCapacityChangedEvent,
  type WorkflowJournalEvent,
  RunCancellationAppliedEvent,
  WorkflowRunBeganEvent,
  WorkflowRunTerminatedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { Match } from "effect"
import type { RecordedCassetteEntry } from "./recorded-domain.js"

type JournalRunEntry = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "TaskAttemptBaseRetryRequested"
      | "TaskWorkCapacityChanged"
      | "WorkflowRunBegan"
      | "WorkflowRunTerminated"
      | "RunCancellationApplied"
  }
>

export type RecordedRunEntry = Extract<
  RecordedCassetteEntry,
  {
    readonly _tag:
      | "TaskAttemptBaseRetryRequested"
      | "TaskWorkCapacityChanged"
      | "WorkflowRunBegan"
      | "WorkflowRunTerminated"
      | "RunCancellationApplied"
  }
>

export const isJournalRunEntry = (event: WorkflowJournalEvent): event is JournalRunEntry =>
  event._tag === "TaskAttemptBaseRetryRequested" ||
  event._tag === "TaskWorkCapacityChanged" ||
  event._tag === "WorkflowRunBegan" ||
  event._tag === "WorkflowRunTerminated" ||
  event._tag === "RunCancellationApplied"

export const isRecordedRunEntry = (entry: RecordedCassetteEntry): entry is RecordedRunEntry =>
  entry._tag === "TaskAttemptBaseRetryRequested" ||
  entry._tag === "TaskWorkCapacityChanged" ||
  entry._tag === "WorkflowRunBegan" ||
  entry._tag === "WorkflowRunTerminated" ||
  entry._tag === "RunCancellationApplied"

export const recordedRunEntryFor = (event: JournalRunEntry): RecordedRunEntry =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TaskAttemptBaseRetryRequested: (value): RecordedRunEntry => ({
        _tag: "TaskAttemptBaseRetryRequested",
        requestId: value.requestId,
        subject: value.subject,
        initiatedBy: value.initiatedBy,
        occurrenceClassification: value.occurrenceClassification
      }),
      TaskWorkCapacityChanged: (value): RecordedRunEntry => ({
        _tag: "TaskWorkCapacityChanged",
        capacity: value.capacity,
        initiatedBy: value.initiatedBy,
        occurrenceClassification: value.occurrenceClassification,
        previousRevision: value.previousRevision,
        revision: value.revision
      }),
      WorkflowRunBegan: (value): RecordedRunEntry => ({
        _tag: "WorkflowRunBegan",
        ...(value.attemptBasePolicy === undefined ? {} : { attemptBasePolicy: value.attemptBasePolicy }),
        initiatedBy: value.initiatedBy,
        initialControlPolicy: value.initialControlPolicy,
        occurrenceClassification: value.occurrenceClassification,
        remotePublicationTarget: value.remotePublicationTarget,
        target: value.target
      }),
      WorkflowRunTerminated: (value): RecordedRunEntry => ({
        _tag: "WorkflowRunTerminated",
        disposition: value.disposition,
        evidence: value.evidence,
        occurrenceClassification: value.occurrenceClassification
      }),
      RunCancellationApplied: (value): RecordedRunEntry => ({
        _tag: "RunCancellationApplied",
        initiatedBy: value.initiatedBy,
        occurrenceClassification: value.occurrenceClassification
      })
    })
  )

export const eventForRunEntry = (entry: RecordedRunEntry): WorkflowJournalEvent =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      TaskAttemptBaseRetryRequested: (value) =>
        TaskAttemptBaseRetryRequestedEvent.make({ ...value, version: workflowJournalEventVersion }),
      TaskWorkCapacityChanged: (value) =>
        TaskWorkCapacityChangedEvent.make({
          capacity: value.capacity,
          initiatedBy: value.initiatedBy,
          occurrenceClassification: value.occurrenceClassification,
          previousRevision: value.previousRevision,
          revision: value.revision,
          version: workflowJournalEventVersion
        }),
      WorkflowRunBegan: (value) =>
        WorkflowRunBeganEvent.make({
          ...(value.attemptBasePolicy === undefined ? {} : { attemptBasePolicy: value.attemptBasePolicy }),
          initialControlPolicy: value.initialControlPolicy,
          initiatedBy: value.initiatedBy,
          occurrenceClassification: value.occurrenceClassification,
          remotePublicationTarget: value.remotePublicationTarget,
          target: value.target,
          version: workflowJournalEventVersion
        }),
      WorkflowRunTerminated: (value) =>
        WorkflowRunTerminatedEvent.make({
          disposition: value.disposition,
          evidence: value.evidence,
          occurrenceClassification: value.occurrenceClassification,
          version: workflowJournalEventVersion
        }),
      RunCancellationApplied: (value) =>
        RunCancellationAppliedEvent.make({
          initiatedBy: value.initiatedBy,
          occurrenceClassification: value.occurrenceClassification,
          version: workflowJournalEventVersion
        })
    })
  )

export const lyricForRunEntry = (entry: RecordedRunEntry): string =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      TaskAttemptBaseRetryRequested: (value) =>
        `Operator authorized fresh tracker checks after Base refusal for task ${value.subject.taskId}.`,
      TaskWorkCapacityChanged: (value) =>
        `Operator changed task-work capacity to ${value.capacity} at policy revision ${value.revision}.`,
      WorkflowRunBegan: (value) => `Dalph began the Run for tracker target ${JSON.stringify(value.target)}.`,
      WorkflowRunTerminated: (value) => `Dalph terminated the Run with disposition ${value.disposition}.`,
      RunCancellationApplied: () => "Operator applied Run cancellation."
    })
  )
