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
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation
} from "../../workflow/registry/operation.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { requiredPreStartTaskWorkPositionsOf } from "./required-planned-attempt-positions.js"

const runId = RunId.make("pre-start-reconstruction-run")
const foreignRunId = RunId.make("pre-start-reconstruction-foreign-run")
const taskId = TaskId.make("A")
const claimOperationId = OperationId.make("claim-A")
const claim = ActiveTaskClaim.make({
  operationId: claimOperationId,
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("claim-token-A")
})
const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A-0"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-0"),
  executor: TaskExecutorLocator.make("executor:pre-start-test"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("revision-A"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A-0")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("plan-A"),
  plannedAttempt,
  predecessorOperationIds: [claimOperationId]
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("worktree-A"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})

const record = (position: number, event: JournalRecord["event"], key: JournalRecord["key"]): JournalRecord => ({
  event,
  key,
  position: JournalPosition.make(position),
  runId
})

const claimIntent = record(
  1,
  TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }),
  intentRecordKey(claimOperationId)
)
const claimAcquired = record(
  2,
  TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion }),
  outcomeRecordKey(claimOperationId)
)
const plan = record(
  3,
  TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
  attemptPlanRecordKey(plannedAttempt.attemptId)
)
const worktreeIntent = record(
  4,
  TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: workflowJournalEventVersion }),
  intentRecordKey(worktreeOperation.operationId)
)
const executorBegan = record(
  5,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion }),
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId)
)

const reconstructed = (records: ReadonlyArray<JournalRecord>, entries = []) =>
  requiredPreStartTaskWorkPositionsOf({ runId, responsibility: { entries }, workflowHistory: { records } })

it("retains the exact claim operation through every pre-start restart prefix", () => {
  expect(reconstructed([claimIntent])).toEqual([
    { _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId, taskId }
  ])
  expect(reconstructed([claimIntent, claimAcquired])).toEqual([
    { _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId, taskId }
  ])
  expect(reconstructed([claimIntent, claimAcquired, plan])).toEqual([
    {
      _tag: "PlannedPreStartTaskWorkPosition",
      claimOperationId,
      correlation: { attemptId: plannedAttempt.attemptId, runId },
      taskId
    }
  ])
  expect(reconstructed([claimIntent, claimAcquired, plan, worktreeIntent])).toEqual([
    {
      _tag: "PlannedPreStartTaskWorkPosition",
      claimOperationId,
      correlation: { attemptId: plannedAttempt.attemptId, runId },
      taskId
    }
  ])
})

it("does not resurrect a position after conclusive rejection or executor responsibility", () => {
  const rejected = record(
    2,
    TaskClaimAcquisitionRejectedEvent.make({
      observed: ActiveTaskClaim.make({
        operationId: OperationId.make("foreign-claim"),
        owner: ClaimOwner.make("other-owner"),
        taskId,
        token: ClaimToken.make("foreign-token")
      }),
      operationId: claimOperationId,
      reason: "ForeignClaim",
      version: workflowJournalEventVersion
    }),
    outcomeRecordKey(claimOperationId)
  )
  expect(reconstructed([claimIntent, rejected])).toEqual([])

  // The current responsibility projection is intentionally empty: journal history, not a stale map entry,
  // proves that executor responsibility began and therefore ends the pre-start phase.
  expect(reconstructed([claimIntent, claimAcquired, plan, executorBegan])).toEqual([])
})

it("does not upgrade a claim position from a foreign-run or unrelated same-run plan", () => {
  const unrelatedPlanOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("plan-A-unrelated"),
    plannedAttempt,
    predecessorOperationIds: []
  })
  const unrelatedPlan = record(
    3,
    TaskAttemptPlannedEvent.make({ operation: unrelatedPlanOperation, version: workflowJournalEventVersion }),
    attemptPlanRecordKey(plannedAttempt.attemptId)
  )
  expect(reconstructed([claimIntent, claimAcquired, unrelatedPlan])).toEqual([
    { _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId, taskId }
  ])

  const foreignPlannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("attempt-foreign-0"),
    baseSha: plannedAttempt.baseSha,
    branch: TaskBranchRef.make("refs/heads/dalph/attempt-foreign-0"),
    executor: plannedAttempt.executor,
    runId: foreignRunId,
    taskId,
    taskRevision: plannedAttempt.taskRevision,
    worktree: WorktreeLocator.make("/worktrees/attempt-foreign-0")
  })
  const foreignPlanOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("plan-A-foreign-run"),
    plannedAttempt: foreignPlannedAttempt,
    predecessorOperationIds: [claimOperationId]
  })
  const foreignPlan: JournalRecord = {
    event: TaskAttemptPlannedEvent.make({ operation: foreignPlanOperation, version: workflowJournalEventVersion }),
    key: attemptPlanRecordKey(foreignPlannedAttempt.attemptId),
    position: JournalPosition.make(3),
    runId: foreignRunId
  }
  expect(reconstructed([claimIntent, claimAcquired, foreignPlan])).toEqual([
    { _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId, taskId }
  ])
})

it("binds a newer same-task claim instead of reusing an older task-keyed position", () => {
  const newerOperationId = OperationId.make("claim-A-newer")
  const newerClaim = ActiveTaskClaim.make({
    operationId: newerOperationId,
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("claim-token-A-newer")
  })
  const newerIntent = record(
    6,
    TaskClaimAcquisitionIntendedEvent.make({
      operation: makeTaskClaimAcquisitionOperation({ acquisition: newerClaim, predecessorOperationIds: [] }),
      version: workflowJournalEventVersion
    }),
    intentRecordKey(newerOperationId)
  )

  expect(reconstructed([claimIntent, claimAcquired, plan, newerIntent])).toEqual([
    { _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId: newerOperationId, taskId }
  ])
})
