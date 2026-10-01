import { Data, Effect, Schema } from "effect"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { journalRecordByPosition, type JournalHistorySource } from "../../workflow-journal/record-evidence.js"
import type { OperationId } from "../../workflow/identity.js"

/**
 * Distinguishes accepted progress from a durable observation that leaves the
 * Run at the same retained wait. A retained wait cancels only publication-owned
 * reactivation; it never consumes an outside wake.
 */
export type AcceptedRunFactPublication = Data.TaggedEnum<{
  WorkflowProgress: Record<never, never>
  RetainedWait: Record<never, never>
  ReadPending: { readonly operationId: OperationId }
  ReadObserved: { readonly operationId: OperationId }
  ReadFailed: { readonly operationId: OperationId }
}>

export const AcceptedRunFactPublication = Data.taggedEnum<AcceptedRunFactPublication>()

/** The accepted prefix does not contain the record named by its publication position. */
export class AcceptedRunFactPublicationRecordMissing extends Schema.TaggedError<AcceptedRunFactPublicationRecordMissing>()(
  "AcceptedRunFactPublicationRecordMissing",
  { acceptedAt: JournalPosition }
) {}

/**
 * Classifies one publication from the exact accepted prefix that produced it.
 * A contradictory position fails instead of manufacturing workflow progress.
 */
export const acceptedRunFactPublicationFromPrefix = Effect.fn("AcceptedRunFactPublication.fromAcceptedPrefix")(
  function* (acceptedAt: JournalPosition, prefix: JournalHistorySource) {
    const record = journalRecordByPosition(prefix, acceptedAt)
    if (record === undefined) return yield* new AcceptedRunFactPublicationRecordMissing({ acceptedAt })
    const event = record.event
    if (event._tag === "TaskTrackerReadIntentRecorded" || event._tag === "GitReadIntentRecorded") {
      return AcceptedRunFactPublication.ReadPending({ operationId: event.operation.operationId })
    }
    if (event._tag === "TaskTrackerFactsObserved") {
      return event.observation._tag === "TaskTrackerFactsReadFailed"
        ? AcceptedRunFactPublication.ReadFailed({ operationId: event.operationId })
        : AcceptedRunFactPublication.ReadObserved({ operationId: event.operationId })
    }
    if (event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved") {
      return AcceptedRunFactPublication.ReadObserved({ operationId: event.operationId })
    }
    const retainedExecutorWait =
      (event._tag === "PlannedAttemptExecutorStateObserved" ||
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved") &&
      event.observation._tag === "ExecutorStateUnreadable"
    // An unreadable tracker observation establishes no current facts and cannot wake its own retained wait.
    return retainedExecutorWait || event._tag === "TaskClaimAcquisitionRejected"
      ? AcceptedRunFactPublication.RetainedWait()
      : AcceptedRunFactPublication.WorkflowProgress()
  }
)

/** Classifies every accepted record crossed by one relation publication, not only its last record. */
export const acceptedRunFactPublicationsBetween = Effect.fn("AcceptedRunFactPublication.betweenAcceptedPositions")(
  function* (after: JournalPosition, through: JournalPosition, prefix: JournalHistorySource) {
    return yield* Effect.forEach(
      Array.from({ length: Math.max(0, through - after) }, (_, offset) => JournalPosition.make(after + offset + 1)),
      (position) => acceptedRunFactPublicationFromPrefix(position, prefix)
    )
  }
)
