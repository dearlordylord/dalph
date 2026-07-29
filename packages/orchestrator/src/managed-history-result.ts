import { Schema } from "effect"
import { AttemptId, JournalPosition, RunId, TaskId } from "./domain.js"
import type { PlannedTaskAttempt } from "./domain.js"
import type { JournalRecord } from "./journal-store.js"
import type { ManagedRunRecoveryStage } from "./managed-run-recovery-stage.js"
import type { ReconstructedManagedRunState } from "./reconstructed-managed-run-state.js"

const ManagedHistoryIssueFields = { detail: Schema.String, position: JournalPosition, runId: RunId }

/** A journal record's key, event identity, or planned-attempt owner disagree. */
export class ManagedHistoryIdentityIssue extends Schema.TaggedErrorClass<ManagedHistoryIdentityIssue>()(
  "ManagedHistoryIdentityIssue",
  ManagedHistoryIssueFields
) {}

/** Ordered decoded events violate the generic workflow transition algebra. */
export class ManagedHistorySemanticIssue extends Schema.TaggedErrorClass<ManagedHistorySemanticIssue>()(
  "ManagedHistorySemanticIssue",
  ManagedHistoryIssueFields
) {}

/** Two journal records claim unfinished executor work for the same task. */
export class DuplicateUnfinishedTaskAttemptIssue extends Schema.TaggedErrorClass<DuplicateUnfinishedTaskAttemptIssue>()(
  "DuplicateUnfinishedTaskAttemptIssue",
  {
    first: Schema.Struct({ attemptId: AttemptId, position: JournalPosition, runId: RunId }),
    runId: RunId,
    second: Schema.Struct({ attemptId: AttemptId, position: JournalPosition, runId: RunId }),
    taskId: TaskId
  }
) {}

export type ManagedHistoryIssue =
  | DuplicateUnfinishedTaskAttemptIssue
  | ManagedHistoryIdentityIssue
  | ManagedHistorySemanticIssue

export const duplicateUnfinishedTaskAttemptIssue = (
  runId: RunId,
  first: PlannedTaskAttempt,
  firstPosition: JournalPosition,
  second: PlannedTaskAttempt,
  secondPosition: JournalPosition
) =>
  new DuplicateUnfinishedTaskAttemptIssue({
    first: { attemptId: first.attemptId, position: firstPosition, runId: first.runId },
    runId,
    second: { attemptId: second.attemptId, position: secondPosition, runId: second.runId },
    taskId: second.taskId
  })

export interface ValidManagedHistory {
  readonly _tag: "ValidManagedHistory"
  readonly managedRun: ReconstructedManagedRunState
  readonly records: ReadonlyArray<JournalRecord>
  readonly recoveryStage: ManagedRunRecoveryStage
  readonly runId: RunId
}

export interface InvalidManagedHistory {
  readonly _tag: "InvalidManagedHistory"
  readonly issues: ReadonlyArray<ManagedHistoryIssue>
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}
