import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { journalRecordsForAttemptKind, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"

/** One durable Stop or Restart application that consumes the exact attempt's accepted Safe authority. */
type AppliedTerminalAttemptChoice = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation" | "StopTaskImplementation"
  }
}

/** Returns the latest durable terminal choice for one immutable planned attempt. */
export const appliedTerminalChoiceFor = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt
): AppliedTerminalAttemptChoice | undefined => {
  let found: AppliedTerminalAttemptChoice | undefined
  for (const record of journalRecordsForAttemptKind(records, plannedAttempt.attemptId, "AttemptChoiceApplied")) {
    if (
      record.event._tag === "AttemptChoiceApplied" &&
      (record.event.choice === "RestartTaskImplementation" || record.event.choice === "StopTaskImplementation") &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, plannedAttempt)
    )
      found = record as AppliedTerminalAttemptChoice
  }
  return found
}
