import type { RunFinalityEvidence } from "../coordination/frontier/run-finality.js"
import { taskTrackerTargetKey } from "../authorities/task-tracker/target.js"
import type { JournalPosition } from "./identity.js"
import { exactWorkflowRunTargetFor } from "./run-target.js"
import { journalRecordsOfKind, type JournalHistorySource } from "./record-evidence.js"
import type { JournalRecord } from "./store.js"

const isCompleteObservationForTarget = (event: JournalRecord["event"], targetKey: string): boolean =>
  event._tag === "TaskTrackerFactsObserved" &&
  (event.observation._tag === "CompleteTaskTrackerFacts" ||
    event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
  taskTrackerTargetKey(event.observation.target) === targetKey

/** Detects a newer complete graph fact before the proposed terminal journal position. */
export const hasLaterCompleteObservation = (
  records: JournalHistorySource,
  evidence: RunFinalityEvidence,
  terminationPosition: JournalPosition
): boolean => {
  const immutableRunTarget = exactWorkflowRunTargetFor(records)
  if (immutableRunTarget === undefined) return false
  const targetKey = taskTrackerTargetKey(immutableRunTarget)
  for (const { event, position } of journalRecordsOfKind(records, "TaskTrackerFactsObserved")) {
    if (
      position > evidence.observedAt &&
      position < terminationPosition &&
      isCompleteObservationForTarget(event, targetKey)
    )
      return true
  }
  return false
}
