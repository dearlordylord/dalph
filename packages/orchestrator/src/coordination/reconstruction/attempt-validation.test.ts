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
  AttemptImplementationAbandonedEvent,
  AttemptStoppageIntendedEvent
} from "../../workflow/protocols/attempt-choice/events.js"
import { emptyIndexes } from "./history-kernel-state.js"
import type { WorkflowJournalHistoryIssue } from "./history-result.js"
import { validateAttemptChoice, validateAttemptStop } from "./attempt-validation.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { OperationId } from "../../workflow/identity.js"
import { makeTaskClaimReleaseOperation } from "../../workflow/registry/operation.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { TaskClaimReleaseIntendedEvent, TaskClaimReleasedEvent } from "../../workflow/registry/event.js"
import { PlannedAttemptExecutorReportOrdinal } from "../../workflow/protocols/planned-attempt-executor-work/events.js"

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

it.each([64, 256])("bounds Stop disposition validation after %i unrelated same-task releases", (size) => {
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make("stop-original-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make("stop-original-token")
  })
  const releaseIntent = (nonce: string) => TaskClaimReleaseIntendedEvent.make({
    operation: makeTaskClaimReleaseOperation({
      release: { claim, operationId: OperationId.make(`alternate-release-${nonce}`) },
      predecessorOperationIds: [claim.operationId, OperationId.make("missing-focused-read")],
      authority: {
        _tag: "StoppedAttemptClaimReleaseAuthority",
        observationOperationId: OperationId.make("missing-focused-read"),
        requestId: AttemptChoiceRequestId.make({ runId, nonce })
      }
    }),
    version: workflowJournalEventVersion
  })
  const ownIntent = releaseIntent(requestId.nonce)
  const events = [
    AttemptChoiceAppliedEvent.make({ ...choice, choice: "StopTaskImplementation" }),
    AttemptImplementationAbandonedEvent.make({
      expectedClaim: claim,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
      requestId,
      subject: choice.subject,
      version: workflowJournalEventVersion
    }),
    ...Array.from({ length: size }, (_, offset) => releaseIntent(`unrelated-${offset}`)),
    ownIntent,
    TaskClaimReleasedEvent.make({ release: ownIntent.operation.release, version: workflowJournalEventVersion })
  ]
  const records = events.map((event, offset): JournalRecord => ({
    event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(offset + 1), runId
  }))
  const candidate: JournalRecord = {
    event: ownIntent,
    key: describeJournalEvent(ownIntent).expectedKey,
    position: JournalPosition.make(records.length + 1),
    runId
  }
  // This pure validator seam deliberately diagnoses an incomplete chronology; it does not manufacture Accepted.
  const expected = new Array<WorkflowJournalHistoryIssue>()
  validateAttemptStop(candidate, runId, records, emptyIndexes(), expected)
  const evidence = journalEvidenceFrom(records)
  const actual = new Array<WorkflowJournalHistoryIssue>()
  let visits = 0
  const stop = observeJournalRecordSequenceOperations((operation) => {
    expect(operation._tag).toBe("IndexedRecordVisit")
    visits += 1
  })
  try {
    validateAttemptStop(candidate, runId, evidence, emptyIndexes(), actual)
  } finally {
    stop()
  }
  expect(actual).toEqual(expected)
  expect(actual.map((issue) => "detail" in issue ? issue.detail : issue._tag)).toContain(
    "stopped-attempt claim disposition is already terminal"
  )
  expect(visits).toBeLessThanOrEqual(16)
})

it.each([64, 256])("bounds checking a new direction after %i same-attempt Continue records", (size) => {
  const began = makeWorkflowRunBeganRecord(
    runId,
    FixtureTarget.make("choice-count"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  const records = [
    began,
    ...Array.from({ length: size }, (_, offset): JournalRecord => {
      const id = AttemptChoiceRequestId.make({ nonce: `continue-${offset}`, runId })
      return {
        ...record,
        event: { ...choice, requestId: id },
        key: attemptChoiceAppliedRecordKey(id),
        position: JournalPosition.make(offset + 2)
      }
    })
  ]
  // Decoded evidence exercises the chronological query kernel; this is not fabricated Accepted history.
  const evidence = journalEvidenceFrom(records)
  const candidate = { ...record, position: JournalPosition.make(size + 2) }
  let visits = 0
  const stop = observeJournalRecordSequenceOperations((operation) => {
    expect(operation._tag).toBe("IndexedRecordVisit")
    visits += 1
  })
  try {
    validateAttemptChoice(candidate, runId, evidence, emptyIndexes(), [])
  } finally {
    stop()
  }
  expect(visits).toBe(4)
})

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
