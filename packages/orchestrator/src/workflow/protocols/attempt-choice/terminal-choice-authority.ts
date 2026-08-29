import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../../../workflow-journal/store.js"

/** One durable Stop or Restart application that consumes the exact attempt's accepted Safe authority. */
type AppliedTerminalAttemptChoice = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation" | "StopTaskImplementation"
  }
}

/** Returns the latest durable terminal choice for one immutable planned attempt. */
export const appliedTerminalChoiceFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): AppliedTerminalAttemptChoice | undefined =>
  records.findLast(
    (record): record is AppliedTerminalAttemptChoice =>
      record.event._tag === "AttemptChoiceApplied" &&
      (record.event.choice === "RestartTaskImplementation" || record.event.choice === "StopTaskImplementation") &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, plannedAttempt)
  )
