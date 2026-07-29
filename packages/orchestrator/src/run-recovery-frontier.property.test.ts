import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TrackerRevision,
  WorktreeLocator
} from "./domain.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { reduceWorkflowJournalHistory } from "./workflow-journal-history.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "./workflow-operation.js"

const safeSegment = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)

it("gives every generated acknowledged-plan prefix exactly one derived recovery frontier", () => {
  fc.assert(
    fc.property(safeSegment, (segment) => {
      const runId = RunId.make(`property-run-${segment}`)
      const attempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`attempt-${segment}`),
        baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
        branch: TaskBranchRef.make(`refs/heads/${segment}`),
        executor: TaskExecutorLocator.make(`executor:${segment}`),
        runId,
        taskId: TaskId.make(`task-${segment}`),
        taskRevision: TaskRevision.make(`revision-${segment}`),
        worktree: WorktreeLocator.make(`/tmp/${segment}`)
      })
      const operation = makeTaskAttemptPlanOperation({
        operationId: OperationId.make(`plan-${segment}`),
        plannedAttempt: attempt,
        predecessorOperationIds: []
      })
      const reduction = reduceWorkflowJournalHistory(runId, [
        {
          event: TaskAttemptPlannedEvent.make({ operation, version: 5 }),
          key: attemptPlanRecordKey(attempt.attemptId),
          position: JournalPosition.make(1),
          runId
        }
      ])
      expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
      if (reduction._tag === "InvalidWorkflowJournalHistory") return
      expect(reduction.recoveryFrontier.entries).toHaveLength(1)
      expect(reduction.recoveryFrontier.entries[0]?._tag).toBe("TaskWorktreeReconciliationNeeded")
    })
  )
})

it("classifies every generated pre-attempt fact-to-next-intent crash prefix", () => {
  fc.assert(
    fc.property(safeSegment, fc.integer({ min: 2, max: 6 }), (segment, prefixLength) => {
      const runId = RunId.make(`pre-attempt-property-${segment}`)
      const taskId = TaskId.make(`task-${segment}`)
      const initial = makeTrackerGraphObservationOperation(
        OperationId.make(`initial-${segment}`),
        FixtureTarget.make(`target-${segment}`)
      )
      const claim = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make(`claim-${segment}`),
          owner: ClaimOwner.make(`owner-${segment}`),
          taskId,
          token: ClaimToken.make(`token-${segment}`)
        },
        predecessorOperationIds: [initial.operationId]
      })
      const admission = makeTrackerGraphObservationOperation(OperationId.make(`admission-${segment}`), initial.target, [
        claim.acquisition.operationId
      ])
      const events = [
        { event: trackerGraphObservationIntent(initial), key: intentRecordKey(initial.operationId) },
        {
          event: trackerGraphOutcomeObserved(initial.operationId, {
            _tag: "TrackerGraphObserved" as const,
            revision: TrackerRevision.make(`initial-${segment}`),
            taskIds: [taskId]
          }),
          key: outcomeRecordKey(initial.operationId)
        },
        {
          event: TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: 5 }),
          key: intentRecordKey(claim.acquisition.operationId)
        },
        {
          event: TaskClaimAcquiredEvent.make({ claim: ActiveTaskClaim.make(claim.acquisition), version: 5 }),
          key: outcomeRecordKey(claim.acquisition.operationId)
        },
        { event: trackerGraphObservationIntent(admission), key: intentRecordKey(admission.operationId) },
        {
          event: trackerGraphOutcomeObserved(admission.operationId, {
            _tag: "TrackerGraphObserved" as const,
            revision: TrackerRevision.make(`admission-${segment}`),
            taskIds: [taskId]
          }),
          key: outcomeRecordKey(admission.operationId)
        }
      ] as const
      const records = events
        .slice(0, prefixLength)
        .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1), runId }))
      const reduction = reduceWorkflowJournalHistory(runId, records)
      expect(reduction._tag).toBe("ValidWorkflowJournalHistory")
      if (reduction._tag === "InvalidWorkflowJournalHistory") return
      expect(reduction.recoveryFrontier.entries).toHaveLength(1)
      expect(reduction.recoveryFrontier.entries[0]?._tag).toBe(
        [
          "TaskClaimAcquisitionNeeded",
          "TaskClaimAcquisitionUnresolved",
          "TaskEligibilityRefreshNeeded",
          "TaskEligibilityRefreshUnresolved",
          "TaskAttemptPlanNeeded"
        ][prefixLength - 2]
      )
    })
  )
})
