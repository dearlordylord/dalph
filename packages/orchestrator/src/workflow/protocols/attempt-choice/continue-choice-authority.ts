import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"

/** Durable Operator authority to keep one immutable plan while accepting one exact changed authored revision. */
type AppliedContinueAttemptChoice = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "ContinueExistingAttempt"
  }
}

/** Returns the latest Continue authority for one immutable planned attempt, regardless of changed revision. */
const latestAppliedContinueChoiceForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): AppliedContinueAttemptChoice | undefined =>
  records.findLast(
    (record): record is AppliedContinueAttemptChoice =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "ContinueExistingAttempt" &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, plannedAttempt)
  )

/** Returns the latest Continue authority for one immutable attempt and one exact changed authored revision. */
export const appliedContinueChoiceForExactRevision = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  observedTaskRevision: PlannedTaskAttempt["taskRevision"]
): AppliedContinueAttemptChoice | undefined => {
  const latest = latestAppliedContinueChoiceForAttempt(records, plannedAttempt)
  return latest?.event.subject.observedTaskRevision === observedTaskRevision ? latest : undefined
}

/** Returns where the latest Continue authority for this attempt was durably recorded. */
export const latestAppliedContinueChoicePositionForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): JournalPosition | undefined => latestAppliedContinueChoiceForAttempt(records, plannedAttempt)?.position

/** Returns where the exact attempt/revision Continue authority was durably recorded. */
export const appliedContinueChoicePositionForExactRevision = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  observedTaskRevision: PlannedTaskAttempt["taskRevision"]
): JournalPosition | undefined =>
  appliedContinueChoiceForExactRevision(records, plannedAttempt, observedTaskRevision)?.position
