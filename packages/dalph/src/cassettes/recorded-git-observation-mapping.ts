import { Match } from "effect"
import {
  GitReadIntentRecordedEvent,
  TaskAttemptBaseReadIntendedEvent,
  TaskAttemptBaseObservedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  type WorkflowJournalEvent,
  WorkflowActor,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import type { RecordedCassetteEntry } from "./recorded-domain.js"

export type RecordedGitObservationEntry = Extract<
  RecordedCassetteEntry,
  {
    readonly _tag:
      | "GitReadInitiated"
      | "PlannedAttemptWorktreeObserved"
      | "TargetLineageObserved"
      | "TaskAttemptBaseReadIntended"
      | "TaskAttemptBaseObserved"
  }
>

const recordedGitObservationEntryTags = {
  GitReadInitiated: true,
  TaskAttemptBaseReadIntended: true,
  TaskAttemptBaseObserved: true,
  PlannedAttemptWorktreeObserved: true,
  TargetLineageObserved: true
} satisfies Record<RecordedGitObservationEntry["_tag"], true>

export const isRecordedGitObservationCassetteEntry = (
  entry: RecordedCassetteEntry
): entry is RecordedGitObservationEntry => Object.hasOwn(recordedGitObservationEntryTags, entry._tag)

export const recordGitObservationEntry = (
  event: Extract<
    WorkflowJournalEvent,
    {
      readonly _tag:
        | "GitReadIntentRecorded"
        | "PlannedAttemptWorktreeObserved"
        | "TargetLineageObserved"
        | "TaskAttemptBaseReadIntended"
        | "TaskAttemptBaseObserved"
    }
  >
): RecordedGitObservationEntry =>
  event._tag === "TaskAttemptBaseReadIntended" || event._tag === "TaskAttemptBaseObserved"
    ? (({ version: _version, ...entry }) => entry)(event)
    : event._tag === "GitReadIntentRecorded"
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
  entry._tag === "TaskAttemptBaseReadIntended"
    ? TaskAttemptBaseReadIntendedEvent.make({ ...entry, version: workflowJournalEventVersion })
    : entry._tag === "TaskAttemptBaseObserved"
      ? TaskAttemptBaseObservedEvent.make({ ...entry, version: workflowJournalEventVersion })
      : entry._tag === "GitReadInitiated"
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
  if (entry._tag === "TaskAttemptBaseReadIntended")
    return `Dalph selected a bounded Git Base read for task ${entry.operation.taskId}.`
  if (entry._tag === "TaskAttemptBaseObserved")
    return entry.observation._tag === "Qualified"
      ? `Git qualified attempt Base ${entry.observation.baseSha}.`
      : `Git refused attempt Base qualification at ${entry.observation.boundary}: ${entry.observation.detail}.`
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
  return Match.value(entry.observation).pipe(
    Match.tagsExhaustive({
      AttemptWorktreeLost: (observation) =>
        `Git no longer registered planned worktree ${observation.plannedAttempt.worktree}.`,
      CompetingWorktreeRegistrations: (observation) =>
        `Git showed competing registrations for planned branch ${observation.plannedBranch} and worktree ${observation.plannedWorktree}.`,
      ConflictingWorktreeRegistration: (observation) =>
        `Git showed branch ${observation.observedBranch} at planned worktree ${observation.worktree}.`,
      ContradictoryWorktreeState: (observation) =>
        `Git returned contradictory facts for planned worktree ${observation.worktree}.`,
      ForeignWorktreeRegistration: (observation) =>
        `Git registered planned branch ${observation.branch} at foreign worktree ${observation.registeredWorktree}.`,
      PlannedWorktreeReady: (observation) =>
        `Git showed planned worktree ${observation.worktree} ready at ${observation.headSha}.`,
      UntrackedWorktreePath: (observation) =>
        `Git did not register existing planned path ${observation.worktree} as a worktree.`,
      WorktreeBaseMismatch: (observation) =>
        `Git showed planned worktree ${observation.worktree} outside Base ${observation.baseSha}.`
    })
  )
}
