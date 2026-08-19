import { Schema } from "effect"
import { AttemptId, RunId, TaskId } from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { ReconstructedRunState } from "./state.js"

const WorkflowJournalHistoryIssueFields = { detail: Schema.String, position: JournalPosition, runId: RunId }

/** A journal record's key, event identity, or planned-attempt owner disagree. */
export class WorkflowJournalHistoryIdentityIssue extends Schema.TaggedError<WorkflowJournalHistoryIdentityIssue>()(
  "WorkflowJournalHistoryIdentityIssue",
  WorkflowJournalHistoryIssueFields
) {}

/** Ordered decoded events violate the generic workflow transition algebra. */
export class WorkflowJournalHistorySemanticIssue extends Schema.TaggedError<WorkflowJournalHistorySemanticIssue>()(
  "WorkflowJournalHistorySemanticIssue",
  WorkflowJournalHistoryIssueFields
) {}

/** Two journal records claim unfinished executor work for the same task. */
export class DuplicateUnfinishedTaskAttemptIssue extends Schema.TaggedError<DuplicateUnfinishedTaskAttemptIssue>()(
  "DuplicateUnfinishedTaskAttemptIssue",
  {
    first: Schema.Struct({ attemptId: AttemptId, position: JournalPosition, runId: RunId }),
    runId: RunId,
    second: Schema.Struct({ attemptId: AttemptId, position: JournalPosition, runId: RunId }),
    taskId: TaskId
  }
) {}

export type WorkflowJournalHistoryIssue =
  | DuplicateUnfinishedTaskAttemptIssue
  | WorkflowJournalHistoryIdentityIssue
  | WorkflowJournalHistorySemanticIssue

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

export interface ValidWorkflowJournalHistory {
  readonly _tag: "ValidWorkflowJournalHistory"
  readonly runState: ReconstructedRunState
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

export interface InvalidWorkflowJournalHistory {
  readonly _tag: "InvalidWorkflowJournalHistory"
  readonly issues: ReadonlyArray<WorkflowJournalHistoryIssue>
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}
