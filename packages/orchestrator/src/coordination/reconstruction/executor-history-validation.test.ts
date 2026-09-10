import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { journalEvidenceFrom, type JournalHistorySource } from "../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { validateExecutorEvent } from "./executor-history-validation.js"
import { emptyIndexes } from "./history-kernel-state.js"
import { workflowJournalHistoryIssueDetail, type WorkflowJournalHistoryIssue } from "./history-result.js"

const runId = RunId.make("executor-validator-indexed-run")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("executor-validator-indexed-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/executor-validator-indexed"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("executor-validator-task"),
  taskRevision: TaskRevision.make("2".repeat(64)),
  worktree: WorktreeLocator.make("/worktrees/executor-validator-indexed")
})

const command = (ordinal: number): JournalRecord => {
  const brandedOrdinal = PlannedAttemptExecutorCommandOrdinal.make(ordinal)
  return {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: brandedOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, brandedOrdinal),
    position: JournalPosition.make(ordinal + 1),
    runId
  }
}

const records: ReadonlyArray<JournalRecord> = [
  {
    event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    position: JournalPosition.make(1),
    runId
  },
  command(1),
  command(2)
]

const validate = (source: JournalHistorySource): ReadonlyArray<string> => {
  const issues: Array<WorkflowJournalHistoryIssue> = []
  records.reduce((indexes, record) => validateExecutorEvent(record, runId, source, indexes, issues), emptyIndexes())
  return issues.map(workflowJournalHistoryIssueDetail)
}

it("keeps executor issue ordering identical for cold arrays and indexed evidence", () => {
  const coldIssues = validate(records)
  const indexedIssues = validate(journalEvidenceFrom(records))

  expect(indexedIssues).toEqual(coldIssues)
  expect(indexedIssues).toContain(`executor begin for attempt ${plannedAttempt.attemptId} follows a prior begin intent`)
})
