import type { RunFinalityEvidence } from "../coordination/frontier/run-finality.js"
import { taskTrackerTargetKey } from "../authorities/task-tracker/target.js"
import type { JournalPosition } from "./identity.js"
import { exactWorkflowRunTargetFor } from "./run-target.js"
import type { JournalRecord } from "./store.js"

/** Detects a newer complete graph fact before the proposed terminal journal position. */
export const hasLaterCompleteObservation = (
  records: ReadonlyArray<JournalRecord>,
  evidence: RunFinalityEvidence,
  terminationPosition: JournalPosition
): boolean => {
  const immutableRunTarget = exactWorkflowRunTargetFor(records)
  if (immutableRunTarget === undefined) return false
  const targetKey = taskTrackerTargetKey(immutableRunTarget)
  return records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      position < terminationPosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
      taskTrackerTargetKey(event.observation.target) === targetKey
  )
}
