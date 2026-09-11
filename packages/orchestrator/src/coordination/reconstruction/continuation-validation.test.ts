import { expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  PlannedAttemptExecutorReport,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { validSnapshot } from "../../../test/task-dag.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { journalEvidenceFrom, type JournalHistorySource } from "../../workflow-journal/record-evidence.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion as version } from "../../workflow/kernel/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTargetLineageObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { PlannedAttemptContinuationAuthorizedEvent } from "../../workflow/protocols/planned-attempt-continuation/events.js"
import { validateContinuationAuthorization } from "./attempt-validation.js"
import type { WorkflowJournalHistoryIssue } from "./history-result.js"

const runId = RunId.make("continuation-kernel")
const taskId = TaskId.make("continuation-A")
const otherTaskId = TaskId.make("continuation-B")
const target = FixtureTarget.make("continuation-kernel")
const specification = makeTaskWorkSpecification({ taskId, title: "A", body: "Continue A" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("continuation-A1"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/continuation-A1"),
  executor: TaskExecutorLocator.make("executor:continuation"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/continuation-A1")
})

// Decoded evidence for this semantic seam, deliberately not certified as a whole accepted workflow prefix.
const fixture = (unrelatedReads: number) => {
  const records: Array<JournalRecord> = [
    makeWorkflowRunBeganRecord(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
  ]
  const append = (event: JournalRecord["event"]) => {
    const record = {
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(records.length + 1),
      runId
    }
    records.push(record)
    return record
  }
  for (let index = 0; index < unrelatedReads; index += 1) {
    append(
      taskTrackerReadIntent(
        makeTaskWorkSpecificationObservationOperation(OperationId.make(`unrelated-${index}`), target, otherTaskId, [])
      )
    )
  }
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make("claim-A"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("claim-A")
  })
  append(
    TaskClaimAcquisitionIntendedEvent.make({
      operation: makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] }),
      version
    })
  )
  append(TaskClaimAcquiredEvent.make({ claim, version }))
  const crossTask = append(
    taskTrackerReadIntent(
      makeTaskWorkSpecificationObservationOperation(OperationId.make("cross-task-causal-read"), target, otherTaskId, [
        claim.operationId
      ])
    )
  )
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("plan-A"),
    plannedAttempt,
    predecessorOperationIds: [OperationId.make("cross-task-causal-read")]
  })
  append(TaskAttemptPlannedEvent.make({ operation: plan, version }))
  append(PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version }))
  append(
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: { runId, attemptId: plannedAttempt.attemptId }
      }),
      version
    })
  )
  const graph = makeTrackerGraphObservationOperation(
    { _tag: "AttemptContinuation" },
    OperationId.make("graph-A"),
    target,
    [plan.operationId],
    [taskId]
  )
  append(taskTrackerReadIntent(graph))
  append(
    taskTrackerFactsObservedEvent(
      graph.operationId,
      makeCompleteTaskTrackerFactsObserved(
        graph,
        validSnapshot({
          revision: "current",
          tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
        })
      )
    )
  )
  const spec = makeTaskWorkSpecificationObservationOperation(OperationId.make("spec-A"), target, taskId, [
    plan.operationId,
    graph.operationId
  ])
  append(taskTrackerReadIntent(spec))
  append(
    taskTrackerFactsObservedEvent(spec.operationId, makeFocusedTaskWorkSpecificationFactsObserved(spec, specification))
  )
  const claimRead = makeTaskClaimObservationOperation(OperationId.make("claim-read-A"), target, taskId, [
    plan.operationId,
    spec.operationId
  ])
  append(taskTrackerReadIntent(claimRead))
  append(taskTrackerFactsObservedEvent(claimRead.operationId, makeFocusedTaskClaimFactsObserved(claimRead, claim)))
  const worktree = makeTaskWorktreeObservationOperation({
    operationId: OperationId.make("worktree-A"),
    plannedAttempt,
    predecessorOperationIds: [claimRead.operationId]
  })
  append(
    GitReadIntentRecordedEvent.make({
      operation: worktree,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version
    })
  )
  append(
    PlannedAttemptWorktreeObservedEvent.make({
      operationId: worktree.operationId,
      observation: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      occurrenceClassification: "NonActionOccurrence",
      version
    })
  )
  const lineage = makeTargetLineageObservationOperation({
    operationId: OperationId.make("lineage-A"),
    plannedAttempt,
    integrationTarget: IntegrationTarget.make({
      repository: GitRepositoryLocator.make("/repo/.git"),
      ref: IntegrationTargetRef.make("refs/heads/main")
    }),
    predecessorOperationIds: [worktree.operationId]
  })
  append(
    GitReadIntentRecordedEvent.make({
      operation: lineage,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version
    })
  )
  append(
    TargetLineageObservedEvent.make({
      operationId: lineage.operationId,
      plannedAttempt,
      observation: {
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: plannedAttempt.baseSha
      },
      occurrenceClassification: "NonActionOccurrence",
      version
    })
  )
  const authorization = append(
    PlannedAttemptContinuationAuthorizedEvent.make({
      plannedAttempt,
      witness: {
        activeTaskContinuationRead: {
          graphObservationOperationId: graph.operationId,
          taskClaimObservationOperationId: claimRead.operationId,
          taskWorkSpecificationObservationOperationId: spec.operationId
        },
        targetLineageObservationOperationId: lineage.operationId,
        worktreeObservationOperationId: worktree.operationId
      },
      version
    })
  )
  return { records, authorization, crossTask }
}

const validate = (record: JournalRecord, source: JournalHistorySource) => {
  const issues = new Array<WorkflowJournalHistoryIssue>()
  validateContinuationAuthorization(record, runId, source, (issue) => issues.push(issue))
  return issues
}

it("keeps task B's causal read when validating task A's continuation and fails closed when it is absent", () => {
  const { authorization, crossTask, records } = fixture(0)
  expect(validate(authorization, records)).toEqual([])
  expect(validate(authorization, journalEvidenceFrom(records))).toEqual([])
  const missingCausalRead = records.filter((record) => record !== crossTask)
  const missingIssues = validate(authorization, journalEvidenceFrom(missingCausalRead))
  expect(validate(authorization, missingCausalRead)).toEqual(missingIssues)
  expect(missingIssues).toEqual([
    expect.objectContaining({ detail: "active-task continuation claim observation claim-read-A is missing" })
  ])
})

it("keeps warm continuation visits bounded as unrelated task evidence grows", () => {
  const visits = [64, 256].map((size) => {
    const { authorization, records } = fixture(size)
    const evidence = journalEvidenceFrom(records)
    let indexedVisits = 0
    let materializations = 0
    const stop = observeJournalRecordSequenceOperations((operation) => {
      if (operation._tag === "IndexedRecordVisit") indexedVisits += 1
      else materializations += 1
    })
    try {
      expect(validate(authorization, evidence)).toEqual([])
      expect(materializations).toBe(0)
      return indexedVisits
    } finally {
      stop()
    }
  })
  expect(visits[0]).toBeGreaterThan(0)
  expect(visits[1]).toBe(visits[0])
})
