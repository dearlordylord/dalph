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
import { attemptChoiceAppliedRecordKey, attemptStoppageIntentRecordKey } from "../../workflow-journal/record-key.js"
import { journalEvidenceFrom, type JournalHistorySource } from "../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptStoppageIntendedEvent
} from "../../workflow/protocols/attempt-choice/events.js"
import { emptyIndexes } from "./history-kernel-state.js"
import type { WorkflowJournalHistoryIssue } from "./history-result.js"
import { validateAttemptChoice, validateAttemptStop } from "./attempt-validation.js"

const runId = RunId.make("attempt-validation-hot-cold")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-validation-A1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-validation-A1"),
  executor: TaskExecutorLocator.make("executor:attempt-validation"),
  runId,
  taskId: TaskId.make("attempt-validation-A"),
  taskRevision: TaskRevision.make("planned-task-revision"),
  worktree: WorktreeLocator.make("/worktrees/attempt-validation-A1")
})
const requestId = AttemptChoiceRequestId.make({ nonce: "missing-authority", runId })
const choice = AttemptChoiceAppliedEvent.make({
  choice: "ContinueExistingAttempt",
  initiatedBy: { _tag: "Operator" },
  occurrenceClassification: "InitiatedAction",
  requestId,
  subject: { observedTaskRevision: TaskRevision.make("unobserved-task-revision"), plannedAttempt },
  version: workflowJournalEventVersion
})
const record: JournalRecord = {
  event: choice,
  key: attemptChoiceAppliedRecordKey(requestId),
  position: JournalPosition.make(1),
  runId
}

const validate = (source: JournalHistorySource): ReadonlyArray<WorkflowJournalHistoryIssue> => {
  const issues = new Array<WorkflowJournalHistoryIssue>()
  validateAttemptChoice(record, runId, source, emptyIndexes(), issues)
  return issues
}

it("reports the same ordered attempt-choice authority issues from cold records and indexed live evidence", () => {
  const records = [record]
  const coldIssues = validate(records)
  const warmIssues = validate(journalEvidenceFrom(records))

  expect(warmIssues).toEqual(coldIssues)
  expect(coldIssues.map((issue) => ("detail" in issue ? issue.detail : issue._tag))).toEqual([
    "attempt-choice request missing-authority has no prior matching planned attempt",
    "attempt-choice request missing-authority requires the latest accepted safely-suspended executor report",
    "attempt-choice request missing-authority does not name the latest observed task fingerprint"
  ])
})

it("rejects the same Stop intent without its applied operator choice from cold records and indexed live evidence", () => {
  const stoppage: JournalRecord = {
    event: AttemptStoppageIntendedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject: choice.subject,
      version: workflowJournalEventVersion
    }),
    key: attemptStoppageIntentRecordKey(requestId),
    position: JournalPosition.make(1),
    runId
  }
  const validateStop = (source: JournalHistorySource): ReadonlyArray<WorkflowJournalHistoryIssue> => {
    const issues = new Array<WorkflowJournalHistoryIssue>()
    validateAttemptStop(stoppage, runId, source, emptyIndexes(), issues)
    return issues
  }
  const records = [stoppage]
  const coldIssues = validateStop(records)

  expect(validateStop(journalEvidenceFrom(records))).toEqual(coldIssues)
  expect(coldIssues.map((issue) => ("detail" in issue ? issue.detail : issue._tag))).toEqual([
    "attempt Stop event AttemptStoppageIntended requires its exact prior applied Stop choice"
  ])
})
