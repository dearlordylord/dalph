import {
  TaskWorkCapacityChangedEvent,
  type WorkflowJournalEvent,
  WorkflowRunBeganEvent,
  WorkflowRunTerminatedEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { Match } from "effect"
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

export const recordedRunEntryFor = (event: JournalRunEntry): RecordedRunEntry =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
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
        initiatedBy: value.initiatedBy,
        initialControlPolicy: value.initialControlPolicy,
        occurrenceClassification: value.occurrenceClassification,
        target: value.target
      }),
      WorkflowRunTerminated: (value): RecordedRunEntry => ({
        _tag: "WorkflowRunTerminated",
        disposition: value.disposition,
        occurrenceClassification: value.occurrenceClassification
      })
    })
  )

export const eventForRunEntry = (entry: RecordedRunEntry): WorkflowJournalEvent =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
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
          initialControlPolicy: value.initialControlPolicy,
          initiatedBy: value.initiatedBy,
          occurrenceClassification: value.occurrenceClassification,
          target: value.target,
          version: workflowJournalEventVersion
        }),
      WorkflowRunTerminated: (value) =>
        WorkflowRunTerminatedEvent.make({
          disposition: value.disposition,
          occurrenceClassification: value.occurrenceClassification,
          version: workflowJournalEventVersion
        })
    })
  )

export const lyricForRunEntry = (entry: RecordedRunEntry): string =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      TaskWorkCapacityChanged: (value) =>
        `Operator changed task-work capacity to ${value.capacity} at policy revision ${value.revision}.`,
      WorkflowRunBegan: (value) => `Dalph began the Run for tracker target ${JSON.stringify(value.target)}.`,
      WorkflowRunTerminated: (value) => `Dalph terminated the Run with disposition ${value.disposition}.`
    })
  )
