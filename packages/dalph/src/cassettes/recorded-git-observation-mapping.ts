import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  type WorkflowJournalEvent,
  WorkflowActor,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import type { RecordedCassetteEntry } from "./recorded-domain.js"

export type RecordedGitObservationEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "GitReadInitiated" | "PlannedAttemptWorktreeObserved" | "TargetLineageObserved" }
>

export const isRecordedGitObservationEntry = <Value extends { readonly _tag: string }>(
  value: Value
): value is Extract<
  Value,
  { readonly _tag: "GitReadInitiated" | "PlannedAttemptWorktreeObserved" | "TargetLineageObserved" }
> =>
  value._tag === "GitReadInitiated" ||
  value._tag === "PlannedAttemptWorktreeObserved" ||
  value._tag === "TargetLineageObserved"

export const recordGitObservationEntry = (
  event: Extract<
    WorkflowJournalEvent,
    { readonly _tag: "GitReadIntentRecorded" | "PlannedAttemptWorktreeObserved" | "TargetLineageObserved" }
  >
): RecordedGitObservationEntry =>
  event._tag === "GitReadIntentRecorded"
    ? {
        _tag: "GitReadInitiated",
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: event.operation
      }
    : event._tag === "PlannedAttemptWorktreeObserved"
      ? {
          _tag: "PlannedAttemptWorktreeObserved",
          observation: event.observation,
          occurrenceClassification: "NonActionOccurrence",
          originatingActionOperationId: event.operationId
        }
      : {
          _tag: "TargetLineageObserved",
          observation: event.observation,
          occurrenceClassification: "NonActionOccurrence",
          originatingActionOperationId: event.operationId,
          plannedAttempt: event.plannedAttempt
        }

export const eventForGitObservationEntry = (entry: RecordedGitObservationEntry): WorkflowJournalEvent =>
  entry._tag === "GitReadInitiated"
    ? GitReadIntentRecordedEvent.make({
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operation: entry.operation,
        version: workflowJournalEventVersion
      })
    : entry._tag === "PlannedAttemptWorktreeObserved"
      ? PlannedAttemptWorktreeObservedEvent.make({
          observation: entry.observation,
          occurrenceClassification: "NonActionOccurrence",
          operationId: entry.originatingActionOperationId,
          version: workflowJournalEventVersion
        })
      : TargetLineageObservedEvent.make({
          observation: entry.observation,
          occurrenceClassification: "NonActionOccurrence",
          operationId: entry.originatingActionOperationId,
          plannedAttempt: entry.plannedAttempt,
          version: workflowJournalEventVersion
        })

// eslint-disable-next-line complexity -- Each distinct Git reconciliation fact must remain visibly distinct in recorded lyrics.
export const lyricForGitObservationEntry = (entry: RecordedGitObservationEntry): string => {
  if (entry._tag === "GitReadInitiated") {
    return entry.operation._tag === "ReadTaskWorktree"
      ? `Dalph coordinator initiated a Git read for planned worktree ${entry.operation.plannedAttempt.worktree}.`
      : `Dalph coordinator initiated a target-lineage read for Base ${entry.operation.plannedAttempt.baseSha}.`
  }
  if (entry._tag === "TargetLineageObserved") {
    return entry.observation.plannedBaseIsAncestorOfTargetHead
      ? `Git showed target ${entry.observation.targetHeadSha} descended from Base ${entry.observation.plannedBaseSha}.`
      : `Git showed target ${entry.observation.targetHeadSha} outside Base ${entry.observation.plannedBaseSha}.`
  }
  switch (entry.observation._tag) {
    case "AttemptWorktreeLost":
      return `Git no longer registered planned worktree ${entry.observation.plannedAttempt.worktree}.`
    case "CompetingWorktreeRegistrations":
      return `Git showed competing registrations for planned branch ${entry.observation.plannedBranch} and worktree ${entry.observation.plannedWorktree}.`
    case "ConflictingWorktreeRegistration":
      return `Git showed branch ${entry.observation.observedBranch} at planned worktree ${entry.observation.worktree}.`
    case "ContradictoryWorktreeState":
      return `Git returned contradictory facts for planned worktree ${entry.observation.worktree}.`
    case "ForeignWorktreeRegistration":
      return `Git registered planned branch ${entry.observation.branch} at foreign worktree ${entry.observation.registeredWorktree}.`
    case "PlannedWorktreeReady":
      return `Git showed planned worktree ${entry.observation.worktree} ready at ${entry.observation.headSha}.`
    case "UntrackedWorktreePath":
      return `Git did not register existing planned path ${entry.observation.worktree} as a worktree.`
    case "WorktreeBaseMismatch":
      return `Git showed planned worktree ${entry.observation.worktree} outside Base ${entry.observation.baseSha}.`
  }
}
