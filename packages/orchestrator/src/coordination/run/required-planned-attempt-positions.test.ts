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
import { ActiveTaskClaim, TaskClaimRelease, UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
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
  TaskClaimReleasedEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation
} from "../../workflow/registry/operation.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  AttemptImplementationAbandonedEvent,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "../../workflow/protocols/attempt-choice/events.js"
import { CancelledAttemptClaimNoReleaseObservedEvent } from "../../workflow/protocols/run-cancellation/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  CompletionClaimReplacedEvent,
  CompletionTaskClaim,
  FocusedCompletedTaskObservation,
  IntegrationFinalitySettledEvent
} from "../../workflow/protocols/integration-finality/events.js"
import { IntegratorRunQualifiedCandidate } from "../../workflow/protocols/integrator/events.js"
import { targetPromotionCorrelationFor } from "../../workflow/protocols/target-promotion/events.js"
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

const foreignClaim = ActiveTaskClaim.make({
  ...claim,
  operationId: OperationId.make("claim-A-foreign"),
  token: ClaimToken.make("claim-token-A-foreign")
})
const choiceRequestId = AttemptChoiceRequestId.make({ nonce: "pre-start-claim-ending", runId })
const choiceSubject = AttemptChoiceSubject.make({
  observedTaskRevision: TaskRevision.make("revision-A-changed"),
  plannedAttempt
})
const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
  ...integrationFinalityFixture.qualifiedCandidate,
  run: {
    ...integrationFinalityFixture.qualifiedCandidate.run,
    session: { ...integrationFinalityFixture.qualifiedCandidate.run.session, plannedAttempt }
  }
})
const completionClaim = CompletionTaskClaim.make({
  originalClaim: claim,
  plannedAttempt,
  promotionCorrelation: targetPromotionCorrelationFor(qualifiedCandidate)
})
const completionSuccessObservation = FocusedCompletedTaskObservation.make({
  ...integrationFinalityFixture.successObservation,
  claim: completionClaim,
  taskId,
  taskRevision: plannedAttempt.taskRevision
})

const stoppedNoRelease = (
  expectedClaim: ActiveTaskClaim,
  observation: ActiveTaskClaim | UnclaimedTask
): JournalRecord["event"] =>
  StoppedAttemptClaimNoReleaseObservedEvent.make({
    expectedClaim,
    observation,
    observationOperationId: OperationId.make("pre-start-stopped-claim-read"),
    occurrenceClassification: "NonActionOccurrence",
    requestId: choiceRequestId,
    subject: choiceSubject,
    version: workflowJournalEventVersion
  })

const cancelledNoRelease = (
  expectedClaim: ActiveTaskClaim,
  observation: ActiveTaskClaim | UnclaimedTask
): JournalRecord["event"] =>
  CancelledAttemptClaimNoReleaseObservedEvent.make({
    cancellationAppliedAt: JournalPosition.make(4),
    expectedClaim,
    observation,
    observationOperationId: OperationId.make("pre-start-cancelled-claim-read"),
    occurrenceClassification: "NonActionOccurrence",
    plannedAttempt,
    version: workflowJournalEventVersion
  })

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

it.each([
  {
    event: TaskClaimReleasedEvent.make({
      release: TaskClaimRelease.make({ claim, operationId: OperationId.make("pre-start-claim-release") }),
      version: workflowJournalEventVersion
    }),
    label: "exact claim release"
  },
  { event: stoppedNoRelease(claim, UnclaimedTask.make({ taskId })), label: "stopped-attempt unclaimed observation" },
  { event: stoppedNoRelease(claim, foreignClaim), label: "stopped-attempt foreign-claim observation" },
  {
    event: cancelledNoRelease(claim, UnclaimedTask.make({ taskId })),
    label: "cancelled-attempt unclaimed observation"
  },
  { event: cancelledNoRelease(claim, foreignClaim), label: "cancelled-attempt foreign-claim observation" },
  {
    event: AttemptImplementationAbandonedEvent.make({
      expectedClaim: claim,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
      requestId: choiceRequestId,
      subject: choiceSubject,
      version: workflowJournalEventVersion
    }),
    label: "attempt abandonment"
  },
  {
    event: CompletionClaimReplacedEvent.make({
      claim: completionClaim,
      operationId: OperationId.make("pre-start-completion-claim-replacement"),
      version: workflowJournalEventVersion
    }),
    label: "completion-claim replacement"
  },
  {
    event: IntegrationFinalitySettledEvent.make({
      claim: completionClaim,
      deletionOperationId: OperationId.make("pre-start-completion-claim-deletion"),
      replacementOperationId: OperationId.make("pre-start-completion-claim-replacement"),
      successObservation: completionSuccessObservation,
      version: workflowJournalEventVersion
    }),
    label: "integration finality settlement"
  }
])("ends the exact pre-start claim after $label", ({ event }) => {
  expect(
    reconstructed([claimIntent, claimAcquired, plan, record(6, event, outcomeRecordKey(claimOperationId))])
  ).toEqual([])
})

it.each([
  { event: stoppedNoRelease(foreignClaim, UnclaimedTask.make({ taskId })), label: "a foreign expected claim" },
  { event: stoppedNoRelease(claim, UnclaimedTask.make({ taskId: TaskId.make("other-task") })), label: "another task" },
  { event: cancelledNoRelease(claim, claim), label: "the still-current exact claim" }
])("does not end the pre-start claim from a no-release observation of $label", ({ event }) => {
  expect(
    reconstructed([claimIntent, claimAcquired, plan, record(6, event, outcomeRecordKey(claimOperationId))])
  ).toEqual([
    {
      _tag: "PlannedPreStartTaskWorkPosition",
      claimOperationId,
      correlation: { attemptId: plannedAttempt.attemptId, runId },
      taskId
    }
  ])
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
