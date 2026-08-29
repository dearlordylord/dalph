import { Match } from "effect"
import {
  ActiveWorkAuthorityRefreshGitReadFailedEvent,
  type ActiveWorkAuthorityRefreshGitReadFailedEvent as ActiveWorkAuthorityRefreshGitReadFailedEventType,
  workflowJournalEventVersion,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import type { RecordedCassetteEntry } from "./recorded-domain.js"

type ActiveWorkAuthorityRefreshGitReadFailedJournalEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "ActiveWorkAuthorityRefreshGitReadFailed" }
>

type RecordedActiveWorkAuthorityRefreshGitReadFailedEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "ActiveWorkAuthorityRefreshGitReadFailed" }
>

export const isActiveWorkAuthorityRefreshGitReadFailedEvent = (
  event: WorkflowJournalEvent
): event is ActiveWorkAuthorityRefreshGitReadFailedJournalEvent =>
  event._tag === "ActiveWorkAuthorityRefreshGitReadFailed"

export const isRecordedActiveWorkAuthorityRefreshGitReadFailedEntry = (
  entry: RecordedCassetteEntry
): entry is RecordedActiveWorkAuthorityRefreshGitReadFailedEntry =>
  entry._tag === "ActiveWorkAuthorityRefreshGitReadFailed"

/** Records the complete active-refresh Git failure without converting it to a Restart failure. */
export const recordActiveWorkAuthorityRefreshGitReadFailedEntry = (
  event: ActiveWorkAuthorityRefreshGitReadFailedJournalEvent
): RecordedActiveWorkAuthorityRefreshGitReadFailedEntry => ({
  _tag: event._tag,
  authority: event.authority,
  failure: event.failure,
  occurrenceClassification: event.occurrenceClassification,
  operation: event.operation,
  ordinal: event.ordinal,
  source: event.source
})

/** Rehydrates the exact active-refresh Git failure event at the journal boundary. */
export const eventForActiveWorkAuthorityRefreshGitReadFailedEntry = (
  entry: RecordedActiveWorkAuthorityRefreshGitReadFailedEntry
): ActiveWorkAuthorityRefreshGitReadFailedEventType =>
  ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
    authority: entry.authority,
    failure: entry.failure,
    occurrenceClassification: entry.occurrenceClassification,
    operation: entry.operation,
    ordinal: entry.ordinal,
    source: entry.source,
    version: workflowJournalEventVersion
  })

/** Presents the durable non-action outcome while retaining the typed Git boundary. */
export const lyricForActiveWorkAuthorityRefreshGitReadFailedEntry = (
  entry: RecordedActiveWorkAuthorityRefreshGitReadFailedEntry
): string =>
  Match.value(entry.failure).pipe(
    Match.tagsExhaustive({
      GitWorktreeReadFailure: (failure) =>
        `The active-refresh Git read failed for worktree ${failure.worktree}: ${failure.detail}.`,
      GitTargetLineageReadFailure: (failure) =>
        `The active-refresh Git read failed for target ${failure.target.ref} at Base ${failure.plannedBaseSha}: ${failure.detail}.`
    })
  )
