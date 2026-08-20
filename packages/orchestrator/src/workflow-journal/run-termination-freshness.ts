import type { RunFinalityEvidence } from "../coordination/frontier/run-finality.js"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"

/** Detects a newer complete graph fact before the proposed terminal journal position. */
export const hasLaterCompleteObservation = (
  records: ReadonlyArray<JournalRecord>,
  evidence: RunFinalityEvidence,
  terminationPosition: JournalPosition
): boolean =>
  records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      position < terminationPosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
  )
