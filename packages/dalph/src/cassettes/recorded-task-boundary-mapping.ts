import {
  TaskClaimReleaseIntendedEvent,
  TaskClaimReleasedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  type WorkflowJournalEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import type { RecordedCassetteEntry } from "./recorded-domain.js"

type RecordedClaimReleaseEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "TaskClaimReleaseIntended" | "TaskClaimReleased" }
>

export const isRecordedClaimReleaseEntry = <Value extends { readonly _tag: string }>(
  value: Value
): value is Extract<Value, { readonly _tag: "TaskClaimReleaseIntended" | "TaskClaimReleased" }> =>
  value._tag === "TaskClaimReleaseIntended" || value._tag === "TaskClaimReleased"

export const recordClaimReleaseEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleaseIntended" | "TaskClaimReleased" }>
): RecordedClaimReleaseEntry =>
  event._tag === "TaskClaimReleaseIntended"
    ? { _tag: "TaskClaimReleaseIntended", operation: event.operation }
    : { _tag: "TaskClaimReleased", release: event.release }

export const eventForClaimReleaseEntry = (entry: RecordedClaimReleaseEntry): WorkflowJournalEvent =>
  entry._tag === "TaskClaimReleaseIntended"
    ? TaskClaimReleaseIntendedEvent.make({ operation: entry.operation, version: workflowJournalEventVersion })
    : TaskClaimReleasedEvent.make({ release: entry.release, version: workflowJournalEventVersion })

export const lyricForClaimReleaseEntry = (entry: RecordedClaimReleaseEntry): string =>
  entry._tag === "TaskClaimReleaseIntended"
    ? `Dalph intended to release its exact claim for task ${entry.operation.release.claim.taskId}.`
    : `The task tracker showed Dalph's exact claim absent for task ${entry.release.claim.taskId}.`

type RecordedWorktreeEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "TaskWorktreeReady" | "TaskWorktreeReconciliationIntended" }
>

export const isRecordedWorktreeEntry = <Value extends { readonly _tag: string }>(
  value: Value
): value is Extract<Value, { readonly _tag: "TaskWorktreeReady" | "TaskWorktreeReconciliationIntended" }> =>
  value._tag === "TaskWorktreeReady" || value._tag === "TaskWorktreeReconciliationIntended"

export const recordWorktreeEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskWorktreeReady" | "TaskWorktreeReconciliationIntended" }>
): RecordedWorktreeEntry =>
  event._tag === "TaskWorktreeReady"
    ? { _tag: "TaskWorktreeReady", operationId: event.operationId, proof: event.proof }
    : { _tag: "TaskWorktreeReconciliationIntended", operation: event.operation }

export const eventForWorktreeEntry = (entry: RecordedWorktreeEntry): WorkflowJournalEvent =>
  entry._tag === "TaskWorktreeReady"
    ? TaskWorktreeReadyEvent.make({
        operationId: entry.operationId,
        proof: entry.proof,
        version: workflowJournalEventVersion
      })
    : TaskWorktreeReconciliationIntendedEvent.make({ operation: entry.operation, version: workflowJournalEventVersion })

export const lyricForWorktreeEntry = (entry: RecordedWorktreeEntry): string =>
  entry._tag === "TaskWorktreeReady"
    ? `Git showed worktree ${entry.proof.worktree} ready at ${entry.proof.headSha}.`
    : `Dalph recorded its intent to reconcile the worktree for attempt ${entry.operation.plannedAttempt.attemptId}.`
