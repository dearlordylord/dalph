import { Data, Effect, Schema } from "effect"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { journalRecordByPosition, type JournalHistorySource } from "../../workflow-journal/record-evidence.js"

/**
 * Distinguishes accepted progress from a durable observation that leaves the
 * Run at the same retained wait. A retained wait cancels only publication-owned
 * reactivation; it never consumes an outside wake.
 */
export type AcceptedRunFactPublication = Data.TaggedEnum<{
  WorkflowProgress: Record<never, never>
  RetainedWait: Record<never, never>
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
    const retainedExecutorWait =
      (event._tag === "PlannedAttemptExecutorStateObserved" ||
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved") &&
      event.observation._tag === "ExecutorStateUnreadable"
    return retainedExecutorWait || event._tag === "TaskClaimAcquisitionRejected"
      ? AcceptedRunFactPublication.RetainedWait()
      : AcceptedRunFactPublication.WorkflowProgress()
  }
)
