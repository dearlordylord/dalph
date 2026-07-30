import {
  TaskWorkCapacityChangedEvent,
  type WorkflowJournalEvent,
  WorkflowRunBeganEvent,
  WorkflowRunTerminatedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import type { RecordedCassetteEntry } from "./recorded-domain.js"

type JournalRunEntry = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "TaskWorkCapacityChanged" | "WorkflowRunBegan" | "WorkflowRunTerminated" }
>

export type RecordedRunEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "TaskWorkCapacityChanged" | "WorkflowRunBegan" | "WorkflowRunTerminated" }
>

export const isJournalRunEntry = (event: WorkflowJournalEvent): event is JournalRunEntry =>
  event._tag === "TaskWorkCapacityChanged" ||
  event._tag === "WorkflowRunBegan" ||
  event._tag === "WorkflowRunTerminated"

export const isRecordedRunEntry = (entry: RecordedCassetteEntry): entry is RecordedRunEntry =>
  entry._tag === "TaskWorkCapacityChanged" ||
  entry._tag === "WorkflowRunBegan" ||
  entry._tag === "WorkflowRunTerminated"

export const recordedRunEntryFor = (event: JournalRunEntry): RecordedRunEntry => {
  switch (event._tag) {
    case "TaskWorkCapacityChanged":
      return {
        _tag: "TaskWorkCapacityChanged",
        capacity: event.capacity,
        initiatedBy: event.initiatedBy,
        occurrenceClassification: event.occurrenceClassification,
        previousRevision: event.previousRevision,
        revision: event.revision
      }
    case "WorkflowRunBegan":
      return {
        _tag: "WorkflowRunBegan",
        initiatedBy: event.initiatedBy,
        initialControlPolicy: event.initialControlPolicy,
        occurrenceClassification: event.occurrenceClassification,
        target: event.target
      }
    case "WorkflowRunTerminated":
      return {
        _tag: "WorkflowRunTerminated",
        disposition: event.disposition,
        occurrenceClassification: event.occurrenceClassification
      }
  }
}

export const eventForRunEntry = (entry: RecordedRunEntry): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "TaskWorkCapacityChanged":
      return TaskWorkCapacityChangedEvent.make({
        capacity: entry.capacity,
        initiatedBy: entry.initiatedBy,
        occurrenceClassification: entry.occurrenceClassification,
        previousRevision: entry.previousRevision,
        revision: entry.revision,
        version: workflowJournalEventVersion
      })
    case "WorkflowRunBegan":
      return WorkflowRunBeganEvent.make({
        initialControlPolicy: entry.initialControlPolicy,
        initiatedBy: entry.initiatedBy,
        occurrenceClassification: entry.occurrenceClassification,
        target: entry.target,
        version: workflowJournalEventVersion
      })
    case "WorkflowRunTerminated":
      return WorkflowRunTerminatedEvent.make({
        disposition: entry.disposition,
        occurrenceClassification: entry.occurrenceClassification,
        version: workflowJournalEventVersion
      })
  }
}

export const lyricForRunEntry = (entry: RecordedRunEntry): string => {
  switch (entry._tag) {
    case "TaskWorkCapacityChanged":
      return `Operator changed task-work capacity to ${entry.capacity} at policy revision ${entry.revision}.`
    case "WorkflowRunBegan":
      return `Dalph began the Run for tracker target ${JSON.stringify(entry.target)}.`
    case "WorkflowRunTerminated":
      return `Dalph terminated the Run with disposition ${entry.disposition}.`
  }
}
