import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { journalRecordsForAttemptKind, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"

/** One durable Stop or Restart application that consumes the exact attempt's accepted Safe authority. */
type AppliedTerminalAttemptChoice = Omit<JournalRecord, "event"> & {
  readonly event: Omit<Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>, "choice"> & {
    readonly choice: "RestartTaskImplementation" | "StopTaskImplementation"
  }
}

const isAppliedTerminalAttemptChoice = (
  record: JournalRecord,
  plannedAttempt: PlannedTaskAttempt
): record is AppliedTerminalAttemptChoice => {
  const { event } = record
  return (
    event._tag === "AttemptChoiceApplied" &&
    (event.choice === "RestartTaskImplementation" || event.choice === "StopTaskImplementation") &&
    plannedTaskAttemptEquivalence(event.subject.plannedAttempt, plannedAttempt)
  )
}

/** Returns the latest durable terminal choice for one immutable planned attempt. */
export const appliedTerminalChoiceFor = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt
): AppliedTerminalAttemptChoice | undefined => {
  let found: AppliedTerminalAttemptChoice | undefined
  for (const record of journalRecordsForAttemptKind(records, plannedAttempt.attemptId, "AttemptChoiceApplied")) {
    if (isAppliedTerminalAttemptChoice(record, plannedAttempt)) found = record
  }
  return found
}
