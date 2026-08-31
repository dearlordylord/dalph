import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { encodeJournalEvent, decodeJournalEvent } from "../../workflow-journal/event-codec.js"
import {
  cancelledAttemptClaimNoReleaseRecordKey,
  stoppedAttemptClaimNoReleaseRecordKey,
  cancelledAttemptImplementationResponsibilityRelinquishedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  runCancellationAppliedRecordKey,
  attemptPlanRecordKey,
  plannedAttemptReplacedRecordKey,
  workflowRunBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { JournalStore } from "../../workflow-journal/store.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  requiredRunFinalityFactFamilies,
  makeRunFinalityEvidence,
  RunFinalityEvidence,
  RunFinalityReadShape
} from "../../coordination/frontier/run-finality.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskClaimReleaseIntendedEvent,
  TaskClaimReleasedEvent,
  taskTrackerReadIntent,
  WorkflowRunBeganEvent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  TaskClaimReleaseAuthority,
  WorkflowOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeCompleteTaskTrackerFactsObserved,
  CompleteTargetClosureCoverage,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  CancelledAttemptClaimNoReleaseObservedEvent,
  CancelledAttemptImplementationResponsibilityRelinquishedEvent,
  RunCancellationAppliedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import {
  AttemptChoiceRequestId,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "../../workflow/protocols/attempt-choice/events.js"
import {
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { validateCancelledAttemptHistory } from "./cancelled-attempt-history.js"
import { reduceWorkflowJournalHistory } from "./history.js"
import { decideWorkflowRunTermination } from "../../workflow-journal/run-lifecycle.js"
import { terminationPreconditionIssues } from "../../workflow-journal/termination-preconditions.js"
import { taskClaimReleaseSettled } from "../../workflow-journal/claim-release-settlement.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { completedRunFinalityFixture } from "../../../test/run-finality.js"
import { validSnapshot } from "../../../test/task-dag.js"
import {
  PlannedAttemptReplacedEvent,
  PlannedAttemptReplacementWitness
} from "../../workflow/protocols/attempt-choice/replacement-events.js"

const runId = RunId.make("cancelled-history-test-run")
const taskId = TaskId.make("cancelled-history-test-task")
const target = FixtureTarget.make("cancelled-history-test-target")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("cancelled-history-test-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/cancelled-history-test"),
  executor: TaskExecutorLocator.make("executor:cancelled-history-test"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("cancelled-history-test-revision"),
  worktree: WorktreeLocator.make("/worktrees/cancelled-history-test")
})
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("cancelled-history-test-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("cancelled-history-test-token")
  },
  predecessorOperationIds: []
})
const exactClaim = ActiveTaskClaim.make(claimOperation.acquisition)
const replacementSuccessor = PlannedTaskAttempt.make({
  ...plannedAttempt,
  attemptId: AttemptId.make("cancelled-history-replacement-successor"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/cancelled-history-replacement-successor"),
  taskRevision: TaskRevision.make("cancelled-history-replacement-revision"),
  worktree: WorktreeLocator.make("/worktrees/cancelled-history-replacement-successor")
})
const replacementRequestId = AttemptChoiceRequestId.make({ nonce: "cancelled-history-replacement", runId })
const replacementWitness = PlannedAttemptReplacementWitness.make({
  claimObservationOperationId: OperationId.make("cancelled-history-replacement-claim-read"),
  expectedClaim: exactClaim,
  graphObservationOperationId: OperationId.make("cancelled-history-replacement-graph-read"),
  oldWorktreeObservationOperationId: OperationId.make("cancelled-history-replacement-worktree-read"),
  oldWorktreeProof: PlannedWorktreeReady.make({
    baseSha: plannedAttempt.baseSha,
    branch: plannedAttempt.branch,
    headSha: GitCommitSha.make("3".repeat(40)),
    worktree: plannedAttempt.worktree
  }),
  quiescenceProof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) },
  specificationObservationOperationId: OperationId.make("cancelled-history-replacement-specification-read"),
  targetHeadSha: replacementSuccessor.baseSha,
  targetLineageObservationOperationId: OperationId.make("cancelled-history-replacement-lineage-read")
})
const replacementPlan = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("cancelled-history-replacement-plan"),
  plannedAttempt: replacementSuccessor,
  predecessorOperationIds: [
    replacementWitness.expectedClaim.operationId,
    replacementWitness.graphObservationOperationId,
    replacementWitness.specificationObservationOperationId,
    replacementWitness.claimObservationOperationId,
    replacementWitness.oldWorktreeObservationOperationId,
    replacementWitness.targetLineageObservationOperationId
  ]
})
const replacementEvent = PlannedAttemptReplacedEvent.make({
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  requestId: replacementRequestId,
  subject: { observedTaskRevision: replacementSuccessor.taskRevision, plannedAttempt },
  successorPlan: replacementPlan,
  version: workflowJournalEventVersion,
  witness: replacementWitness
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("cancelled-history-test-plan"),
  plannedAttempt,
  predecessorOperationIds: [exactClaim.operationId]
})
const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
const laterCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
const laterReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
const cancellationAppliedAt = JournalPosition.make(12)
const relinquishedAt = JournalPosition.make(13)
const readOperation = makeTaskClaimObservationOperation(
  OperationId.make("cancelled-history-test-claim-read"),
  target,
  taskId,
  [exactClaim.operationId]
)
const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
  correlation: { attemptId: plannedAttempt.attemptId, runId }
})
const safelySuspendedReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
  correlation: { attemptId: plannedAttempt.attemptId, runId }
})

const rows: ReadonlyArray<Pick<JournalRecord, "event" | "key">> = [
  {
    event: WorkflowRunBeganEvent.make({
      initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      target,
      version: workflowJournalEventVersion
    }),
    key: workflowRunBeganRecordKey
  },
  {
    event: TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }),
    key: intentRecordKey(exactClaim.operationId)
  },
  {
    event: TaskClaimAcquiredEvent.make({ claim: exactClaim, version: workflowJournalEventVersion }),
    key: outcomeRecordKey(exactClaim.operationId)
  },
  {
    event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
    key: attemptPlanRecordKey(plannedAttempt.attemptId)
  },
  {
    event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId)
  },
  {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal)
  },
  {
    event: PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report: executingReport,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal)
  },
  {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: executingReport,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal)
  },
  {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: laterCommandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, laterCommandOrdinal)
  },
  {
    event: PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal: laterCommandOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report: safelySuspendedReport,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, laterCommandOrdinal)
  },
  {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: laterReportOrdinal,
      report: safelySuspendedReport,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, laterReportOrdinal)
  },
  {
    event: RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    key: runCancellationAppliedRecordKey
  },
  {
    event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
      authorizedClaim: exactClaim,
      cancellationAppliedAt,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      plannedAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: laterReportOrdinal },
      version: workflowJournalEventVersion
    }),
    key: cancelledAttemptImplementationResponsibilityRelinquishedRecordKey(plannedAttempt.attemptId)
  }
]

const recordsFrom = (input: ReadonlyArray<Pick<JournalRecord, "event" | "key">>): ReadonlyArray<JournalRecord> =>
  input.map((row, index) => ({ ...row, position: JournalPosition.make(index + 1), runId }))

const baseRecords = recordsFrom(rows)
const noReleaseObservation = taskTrackerFactsObservedEvent(
  readOperation.operationId,
  makeFocusedTaskClaimFactsObserved(readOperation, UnclaimedTask.make({ taskId }))
)
const noRelease = CancelledAttemptClaimNoReleaseObservedEvent.make({
  cancellationAppliedAt,
  expectedClaim: exactClaim,
  observation: UnclaimedTask.make({ taskId }),
  observationOperationId: readOperation.operationId,
  occurrenceClassification: "NonActionOccurrence",
  plannedAttempt,
  version: workflowJournalEventVersion
})
const releaseReadOperation = makeTaskClaimObservationOperation(
  OperationId.make("cancelled-history-test-release-read"),
  target,
  taskId,
  [exactClaim.operationId]
)
const releaseObservation = taskTrackerFactsObservedEvent(
  releaseReadOperation.operationId,
  makeFocusedTaskClaimFactsObserved(releaseReadOperation, exactClaim)
)
const cancellationReleaseAuthority = TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
  cancellationAppliedAt,
  implementationRelinquishedAt: relinquishedAt,
  observationOperationId: releaseReadOperation.operationId
})
const cancellationReleaseOperation = makeTaskClaimReleaseOperation({
  authority: cancellationReleaseAuthority,
  predecessorOperationIds: [exactClaim.operationId, releaseReadOperation.operationId],
  release: { claim: exactClaim, operationId: OperationId.make("cancelled-history-test-release") }
})
const cancellationReleaseIntent = TaskClaimReleaseIntendedEvent.make({
  operation: cancellationReleaseOperation,
  version: workflowJournalEventVersion
})
const cancellationReleaseOutcome = TaskClaimReleasedEvent.make({
  release: cancellationReleaseOperation.release,
  version: workflowJournalEventVersion
})

const invalidDetailsFor = (record: JournalRecord, records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  const details: Array<string> = []
  validateCancelledAttemptHistory(record, runId, records, (detail) => details.push(detail))
  return details
}

const historyDetailsFor = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  return reduction._tag === "InvalidWorkflowJournalHistory"
    ? reduction.issues.flatMap((issue) => ("detail" in issue ? [issue.detail] : []))
    : []
}

it("accepts the complete cancellation settlement prefix through history reduction", () => {
  expect(historyDetailsFor(baseRecords)).toEqual([])
})

it("rejects missing or mismatched cancellation provenance", () => {
  const relinquishment = baseRecords.at(-1)
  if (relinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
    return expect.fail("test fixture lacks relinquishment")
  }
  const missingCancellation: JournalRecord = {
    ...relinquishment,
    event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
      ...relinquishment.event,
      cancellationAppliedAt: JournalPosition.make(99)
    })
  }
  expect(historyDetailsFor([...baseRecords.slice(0, -1), missingCancellation])).toContain(
    "cancelled-attempt relinquishment requires its exact prior RunCancellationApplied position"
  )

  const wrongCancellation: JournalRecord = {
    ...relinquishment,
    event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
      ...relinquishment.event,
      cancellationAppliedAt: JournalPosition.make(1)
    })
  }
  expect(historyDetailsFor([...baseRecords.slice(0, -1), wrongCancellation])).toContain(
    "cancelled-attempt relinquishment requires its exact prior RunCancellationApplied position"
  )
})

it("rejects cancellation relinquishment after replacement of the exact attempt", () => {
  const relinquishment = baseRecords.at(-1)
  if (relinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
    return expect.fail("test fixture lacks relinquishment")
  }
  const replacement: JournalRecord = {
    event: replacementEvent,
    key: plannedAttemptReplacedRecordKey(plannedAttempt.attemptId),
    position: JournalPosition.make(9),
    runId
  }
  expect(
    invalidDetailsFor(relinquishment, [...baseRecords.slice(0, -2), replacement, ...baseRecords.slice(-2)])
  ).toContain("cancelled-attempt relinquishment cannot follow replacement of the exact planned attempt")
})

it("rejects missing, nonlatest, and superseded cancellation proof", () => {
  const relinquishment = baseRecords.at(-1)
  if (relinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
    return expect.fail("test fixture lacks relinquishment")
  }
  const relinquishmentEvent = relinquishment.event
  const invalidProof = (proof: typeof relinquishmentEvent.proof): ReadonlyArray<string> =>
    historyDetailsFor([
      ...baseRecords.slice(0, -1),
      {
        ...relinquishment,
        event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({ ...relinquishmentEvent, proof })
      }
    ])
  expect(
    invalidProof({ _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(3) })
  ).toContain("cancelled-attempt relinquishment requires current safe or terminal executor evidence")
  expect(invalidProof({ _tag: "AcceptedReport", reportOrdinal })).toContain(
    "cancelled-attempt relinquishment requires current safe or terminal executor evidence"
  )

  const supersedingCommand: JournalRecord = {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Resume",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(3),
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(
      plannedAttempt.attemptId,
      PlannedAttemptExecutorCommandOrdinal.make(3)
    ),
    position: JournalPosition.make(12),
    runId
  }
  const supersededRecords = [
    ...baseRecords.slice(0, 11),
    supersedingCommand,
    ...baseRecords.slice(11).map((record) => ({ ...record, position: JournalPosition.make(record.position + 1) }))
  ]
  const shiftedRelinquishment = supersededRecords.at(-1)
  if (shiftedRelinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
    return expect.fail("test fixture lacks shifted relinquishment")
  }
  const shiftedCancellation = supersededRecords.find(({ event }) => event._tag === "RunCancellationApplied")
  if (shiftedCancellation === undefined) return expect.fail("test fixture lacks shifted cancellation")
  const shiftedEvent = CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
    ...shiftedRelinquishment.event,
    cancellationAppliedAt: shiftedCancellation.position
  })
  expect(
    historyDetailsFor([...supersededRecords.slice(0, -1), { ...shiftedRelinquishment, event: shiftedEvent }])
  ).toContain("cancelled-attempt relinquishment requires current safe or terminal executor evidence")
})

it("rejects a relinquishment with the wrong authorized claim or a duplicate relinquishment", () => {
  const relinquishment = baseRecords.at(-1)
  if (relinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
    return expect.fail("test fixture lacks relinquishment")
  }
  const foreignClaim = ActiveTaskClaim.make({
    ...exactClaim,
    operationId: OperationId.make("cancelled-history-foreign-claim")
  })
  const wrongClaim: JournalRecord = {
    ...relinquishment,
    event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
      ...relinquishment.event,
      authorizedClaim: foreignClaim
    })
  }
  expect(historyDetailsFor([...baseRecords.slice(0, -1), wrongClaim])).toContain(
    "cancelled-attempt relinquishment requires the exact authorized claim"
  )

  const duplicate: JournalRecord = {
    ...relinquishment,
    key: JournalRecordKey.make("cancelled-history-duplicate-relinquishment"),
    position: JournalPosition.make(14)
  }
  expect(historyDetailsFor([...baseRecords, duplicate])).toContain(
    "cancelled-attempt implementation responsibility is already relinquished"
  )
})

it("rejects each independent cancellation settlement foundation mismatch", () => {
  const relinquishment = baseRecords.at(-1)
  const cancellation = baseRecords.find(({ event }) => event._tag === "RunCancellationApplied")
  if (
    relinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished" ||
    cancellation?.event._tag !== "RunCancellationApplied"
  ) {
    return expect.fail("test fixture lacks cancellation settlement")
  }
  const foreignRunId = RunId.make("cancelled-history-foreign-run")
  const foreignAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: foreignRunId })
  const withRelinquishment = (
    event: typeof relinquishment.event,
    records: ReadonlyArray<JournalRecord> = baseRecords.slice(0, -1)
  ) => invalidDetailsFor({ ...relinquishment, event }, [...records, { ...relinquishment, event }])

  expect(
    withRelinquishment(relinquishment.event, [...baseRecords.slice(0, 11), { ...cancellation, runId: foreignRunId }])
  ).toContain("cancelled-attempt relinquishment names a cancellation from another Run")
  expect(
    withRelinquishment(
      CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
        ...relinquishment.event,
        plannedAttempt: foreignAttempt
      })
    )
  ).toContain("cancelled-attempt relinquishment planned attempt binds another Run")
  expect(
    withRelinquishment(
      relinquishment.event,
      baseRecords.filter((_, index) => index !== 3 && index !== 12)
    )
  ).toContain("cancelled-attempt relinquishment requires its exact prior planned attempt")
  expect(
    withRelinquishment(
      relinquishment.event,
      baseRecords.filter((_, index) => index !== 4 && index !== 10)
    )
  ).toContain("cancelled-attempt relinquishment requires prior executor-work responsibility")
  const priorResponsibility = baseRecords[4]
  expect(priorResponsibility).toBeDefined()
  if (priorResponsibility === undefined) return
  const lateResponsibility = { ...priorResponsibility, position: cancellation.position }
  expect(
    withRelinquishment(relinquishment.event, [
      ...baseRecords.filter((_, index) => index !== 4 && index !== 10),
      lateResponsibility
    ])
  ).toContain("cancelled-attempt relinquishment requires prior executor-work responsibility")

  const readIntentRecord: JournalRecord = {
    event: taskTrackerReadIntent(readOperation),
    key: intentRecordKey(readOperation.operationId),
    position: JournalPosition.make(14),
    runId
  }
  const observationRecord: JournalRecord = {
    event: noReleaseObservation,
    key: outcomeRecordKey(readOperation.operationId),
    position: JournalPosition.make(15),
    runId
  }
  const noReleaseRecord: JournalRecord = {
    event: noRelease,
    key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
    position: JournalPosition.make(16),
    runId
  }
  expect(
    invalidDetailsFor(
      {
        ...noReleaseRecord,
        event: CancelledAttemptClaimNoReleaseObservedEvent.make({ ...noRelease, plannedAttempt: foreignAttempt })
      },
      [...baseRecords, readIntentRecord, observationRecord, noReleaseRecord]
    )
  ).toContain("cancelled-attempt no-release binds another Run")
  expect(invalidDetailsFor(noReleaseRecord, [readIntentRecord, observationRecord, noReleaseRecord])).toContain(
    "cancelled-attempt no-release requires its exact prior implementation relinquishment"
  )
  const foreignClaim = ActiveTaskClaim.make({
    ...exactClaim,
    operationId: OperationId.make("cancelled-history-foundation-foreign-claim")
  })
  const wrongExpected = {
    ...noReleaseRecord,
    event: CancelledAttemptClaimNoReleaseObservedEvent.make({ ...noRelease, expectedClaim: foreignClaim })
  }
  expect(
    invalidDetailsFor(wrongExpected, [...baseRecords, readIntentRecord, observationRecord, wrongExpected])
  ).toContain("cancelled-attempt no-release contradicts its authorized claim")

  const releaseIntentFor = (authority: typeof cancellationReleaseAuthority): JournalRecord => ({
    event: TaskClaimReleaseIntendedEvent.make({
      operation: makeTaskClaimReleaseOperation({
        authority,
        predecessorOperationIds: cancellationReleaseOperation.predecessorOperationIds,
        release: cancellationReleaseOperation.release
      }),
      version: workflowJournalEventVersion
    }),
    key: intentRecordKey(cancellationReleaseOperation.release.operationId),
    position: JournalPosition.make(14),
    runId
  })
  const missingCancellationIntent = releaseIntentFor(
    TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
      ...cancellationReleaseAuthority,
      cancellationAppliedAt: JournalPosition.make(99)
    })
  )
  expect(invalidDetailsFor(missingCancellationIntent, [...baseRecords, missingCancellationIntent])).toContain(
    "cancelled-attempt claim release requires its exact prior RunCancellationApplied"
  )
  const missingRelinquishmentIntent = releaseIntentFor(
    TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
      ...cancellationReleaseAuthority,
      implementationRelinquishedAt: JournalPosition.make(99)
    })
  )
  expect(invalidDetailsFor(missingRelinquishmentIntent, [...baseRecords, missingRelinquishmentIntent])).toContain(
    "cancelled-attempt claim release requires its exact prior implementation relinquishment"
  )
  const contradictoryReleaseOperation = makeTaskClaimReleaseOperation({
    authority: cancellationReleaseAuthority,
    predecessorOperationIds: [foreignClaim.operationId, releaseReadOperation.operationId],
    release: { claim: foreignClaim, operationId: OperationId.make("cancelled-history-contradictory-release") }
  })
  const contradictoryReleaseIntent: JournalRecord = {
    event: TaskClaimReleaseIntendedEvent.make({
      operation: contradictoryReleaseOperation,
      version: workflowJournalEventVersion
    }),
    key: intentRecordKey(contradictoryReleaseOperation.release.operationId),
    position: JournalPosition.make(14),
    runId
  }
  expect(invalidDetailsFor(contradictoryReleaseIntent, [...baseRecords, contradictoryReleaseIntent])).toContain(
    "cancelled-attempt claim release contradicts its authorized claim"
  )
})

it("accepts a safe executor proof observed before cancellation", () => {
  const record = baseRecords.at(-1)
  if (record === undefined) return expect.fail("test fixture lacks relinquishment")
  expect(invalidDetailsFor(record, baseRecords)).toEqual([])
})

it("rejects command and state observations as accepted-report proof provenance", () => {
  const commandProjectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
  const stateObservationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
  const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId }
  })
  const projectionRecord = {
    event: PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal: laterCommandOrdinal,
      observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
        report: safeReport
      }),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      projectionOrdinal: commandProjectionOrdinal,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandProjectionObservedRecordKey(
      plannedAttempt.attemptId,
      laterCommandOrdinal,
      commandProjectionOrdinal
    )
  }
  const stateRecord = {
    event: PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: safeReport }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: stateObservationOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, stateObservationOrdinal)
  }
  const relinquishment = baseRecords.at(-1)
  if (relinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
    return expect.fail("test fixture lacks relinquishment")
  }
  const projectionRelinquishmentEvent = relinquishment.event
  const cancellationRow = rows[11]
  const relinquishmentRow = rows[12]
  if (
    cancellationRow === undefined ||
    relinquishmentRow === undefined ||
    cancellationRow.event._tag !== "RunCancellationApplied" ||
    relinquishmentRow.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished"
  ) {
    return expect.fail("test fixture lacks cancellation settlement rows")
  }
  const rowsFor = (
    proof: typeof projectionRelinquishmentEvent.proof,
    evidenceRecord: Pick<JournalRecord, "event" | "key">
  ): ReadonlyArray<JournalRecord> =>
    recordsFrom([
      ...rows.slice(0, 11),
      evidenceRecord,
      cancellationRow,
      {
        ...relinquishmentRow,
        event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
          ...projectionRelinquishmentEvent,
          cancellationAppliedAt: JournalPosition.make(13),
          proof
        })
      }
    ])
  const projectionRecords = rowsFor({ _tag: "AcceptedReport", reportOrdinal }, projectionRecord)
  const projectionRelinquishment = projectionRecords.at(-1)
  if (projectionRelinquishment === undefined) return expect.fail("projection fixture lacks relinquishment")
  expect(invalidDetailsFor(projectionRelinquishment, projectionRecords)).not.toEqual([])

  const stateRecords = rowsFor({ _tag: "AcceptedReport", reportOrdinal }, stateRecord)
  const stateRelinquishment = stateRecords.at(-1)
  if (stateRelinquishment === undefined) return expect.fail("state fixture lacks relinquishment")
  expect(invalidDetailsFor(stateRelinquishment, stateRecords)).not.toEqual([])
})

it("requires no-release event observation to equal the focused tracker observation", () => {
  const observationRecord: JournalRecord = {
    event: noReleaseObservation,
    key: outcomeRecordKey(readOperation.operationId),
    position: JournalPosition.make(15),
    runId
  }
  const readIntentRecord: JournalRecord = {
    event: taskTrackerReadIntent(readOperation),
    key: intentRecordKey(readOperation.operationId),
    position: JournalPosition.make(14),
    runId
  }
  const validRecord: JournalRecord = {
    event: noRelease,
    key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
    position: JournalPosition.make(16),
    runId
  }
  expect(invalidDetailsFor(validRecord, [...baseRecords, readIntentRecord, observationRecord, validRecord])).toEqual([])
  const cancellationRecord = baseRecords.find(({ event }) => event._tag === "RunCancellationApplied")
  if (cancellationRecord === undefined) return expect.fail("test fixture lacks cancellation")
  const unrelatedGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-no-release-unrelated-graph"),
    target
  )
  const unrelatedTaskClaimOperation = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-history-no-release-unrelated-task"),
    target,
    TaskId.make("other")
  )
  const lateValidRecord = { ...validRecord, position: JournalPosition.make(20) }
  expect(
    invalidDetailsFor(lateValidRecord, [
      ...baseRecords,
      readIntentRecord,
      observationRecord,
      {
        event: taskTrackerFactsObservedEvent(
          unrelatedGraphOperation.operationId,
          makeCompleteTaskTrackerFactsObserved(
            unrelatedGraphOperation,
            validSnapshot({
              revision: "cancelled-history-no-release-unrelated-graph",
              rootTaskId: "other",
              tasks: [{ id: "other", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
            })
          )
        ),
        key: outcomeRecordKey(unrelatedGraphOperation.operationId),
        position: JournalPosition.make(16),
        runId
      },
      {
        event: taskTrackerFactsObservedEvent(
          unrelatedTaskClaimOperation.operationId,
          makeFocusedTaskClaimFactsObserved(
            unrelatedTaskClaimOperation,
            UnclaimedTask.make({ taskId: TaskId.make("other") })
          )
        ),
        key: outcomeRecordKey(unrelatedTaskClaimOperation.operationId),
        position: JournalPosition.make(17),
        runId
      },
      { ...cancellationRecord, position: JournalPosition.make(18) },
      lateValidRecord
    ])
  ).toEqual([])

  const readWithoutRelinquishmentPredecessor = makeTaskClaimObservationOperation(
    readOperation.operationId,
    target,
    taskId
  )
  const missingPredecessorIntent: JournalRecord = {
    ...readIntentRecord,
    event: taskTrackerReadIntent(readWithoutRelinquishmentPredecessor)
  }
  expect(
    invalidDetailsFor(validRecord, [...baseRecords, missingPredecessorIntent, observationRecord, validRecord])
  ).toContain("cancelled-attempt no-release requires an exact absent or foreign focused claim observation")

  const foreignTargetRead = makeTaskClaimObservationOperation(
    readOperation.operationId,
    FixtureTarget.make("cancelled-history-no-release-foreign-target"),
    taskId,
    [exactClaim.operationId]
  )
  const mismatchedReadIntent: JournalRecord = { ...readIntentRecord, event: taskTrackerReadIntent(foreignTargetRead) }
  expect(
    invalidDetailsFor(validRecord, [...baseRecords, mismatchedReadIntent, observationRecord, validRecord])
  ).toContain("cancelled-attempt no-release requires an exact absent or foreign focused claim observation")

  const contradictory: JournalRecord = {
    ...validRecord,
    event: CancelledAttemptClaimNoReleaseObservedEvent.make({ ...noRelease, observation: exactClaim })
  }
  expect(
    invalidDetailsFor(contradictory, [...baseRecords, readIntentRecord, observationRecord, contradictory])
  ).toContain("cancelled-attempt no-release requires an exact absent or foreign focused claim observation")

  const duplicate: JournalRecord = { ...validRecord, position: JournalPosition.make(17) }
  expect(
    invalidDetailsFor(duplicate, [...baseRecords, readIntentRecord, observationRecord, validRecord, duplicate])
  ).toContain("cancelled-attempt claim disposition is already terminal")
})

it("rejects unreadable or absent focused claim evidence for cancellation no-release", () => {
  const readIntentRecord: JournalRecord = {
    event: taskTrackerReadIntent(readOperation),
    key: intentRecordKey(readOperation.operationId),
    position: JournalPosition.make(14),
    runId
  }
  const unreadableObservation: JournalRecord = {
    event: taskTrackerFactsObservedEvent(readOperation.operationId, makeFocusedTaskClaimFactsUnreadable(readOperation)),
    key: outcomeRecordKey(readOperation.operationId),
    position: JournalPosition.make(15),
    runId
  }
  const validNoReleaseRecord: JournalRecord = {
    event: noRelease,
    key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
    position: JournalPosition.make(16),
    runId
  }
  expect(invalidDetailsFor(validNoReleaseRecord, [...baseRecords, validNoReleaseRecord])).toContain(
    "cancelled-attempt no-release requires an exact absent or foreign focused claim observation"
  )
  expect(
    invalidDetailsFor(validNoReleaseRecord, [
      ...baseRecords,
      readIntentRecord,
      unreadableObservation,
      validNoReleaseRecord
    ])
  ).toContain("cancelled-attempt no-release requires an exact absent or foreign focused claim observation")
})

it("rejects a Begin command after cancellation", () => {
  const lateOrdinal = PlannedAttemptExecutorCommandOrdinal.make(3)
  const lateCommand: JournalRecord = {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: lateOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, lateOrdinal),
    position: JournalPosition.make(14),
    runId
  }
  expect(invalidDetailsFor(lateCommand, [...baseRecords, lateCommand])).toContain(
    "post-cancellation history cannot record forward-work event PlannedAttemptExecutorCommandIntended"
  )
})

it("rejects executor responsibility beginning after cancellation", () => {
  const lateResponsibility: JournalRecord = {
    event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    position: JournalPosition.make(14),
    runId
  }
  expect(invalidDetailsFor(lateResponsibility, [...baseRecords, lateResponsibility])).toContain(
    "post-cancellation history cannot record forward-work event PlannedAttemptExecutorWorkResponsibilityBegan"
  )
})

it("classifies post-cancellation claim rejection by its pre-cancellation intent", () => {
  const foreignClaim = ActiveTaskClaim.make({
    ...exactClaim,
    operationId: OperationId.make("cancelled-history-late-rejection-foreign")
  })
  const acceptedPreCancellationRejection: JournalRecord = {
    event: TaskClaimAcquisitionRejectedEvent.make({
      observed: foreignClaim,
      operationId: exactClaim.operationId,
      reason: "ForeignClaim",
      version: workflowJournalEventVersion
    }),
    key: outcomeRecordKey(exactClaim.operationId),
    position: JournalPosition.make(14),
    runId
  }
  expect(
    invalidDetailsFor(acceptedPreCancellationRejection, [...baseRecords, acceptedPreCancellationRejection])
  ).toEqual([])

  const lateOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("cancelled-history-late-rejection"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("cancelled-history-late-rejection-token")
    },
    predecessorOperationIds: []
  })
  const lateRejection: JournalRecord = {
    event: TaskClaimAcquisitionRejectedEvent.make({
      observed: foreignClaim,
      operationId: lateOperation.acquisition.operationId,
      reason: "ForeignClaim",
      version: workflowJournalEventVersion
    }),
    key: outcomeRecordKey(lateOperation.acquisition.operationId),
    position: JournalPosition.make(14),
    runId
  }
  expect(invalidDetailsFor(lateRejection, [...baseRecords, lateRejection])).toContain(
    "post-cancellation history cannot record forward-work event TaskClaimAcquisitionRejected"
  )
})

it("allows only pre-cancellation claim and integration outcomes after the cutoff", () => {
  const lateAcquisition = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("cancelled-history-late-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("cancelled-history-late-token")
    },
    predecessorOperationIds: []
  })
  const preCancellationClaimIntent: JournalRecord = {
    event: TaskClaimAcquisitionIntendedEvent.make({ operation: lateAcquisition, version: workflowJournalEventVersion }),
    key: intentRecordKey(lateAcquisition.acquisition.operationId),
    position: JournalPosition.make(9),
    runId
  }
  const postCancellationClaimOutcome: JournalRecord = {
    event: TaskClaimAcquiredEvent.make({
      claim: ActiveTaskClaim.make(lateAcquisition.acquisition),
      version: workflowJournalEventVersion
    }),
    key: outcomeRecordKey(lateAcquisition.acquisition.operationId),
    position: JournalPosition.make(14),
    runId
  }
  expect(
    invalidDetailsFor(postCancellationClaimOutcome, [
      ...baseRecords,
      preCancellationClaimIntent,
      postCancellationClaimOutcome
    ])
  ).toEqual([])

  const postCancellationClaimIntent: JournalRecord = {
    ...preCancellationClaimIntent,
    position: JournalPosition.make(14)
  }
  expect(invalidDetailsFor(postCancellationClaimIntent, [...baseRecords, postCancellationClaimIntent])).toContain(
    "post-cancellation history cannot record forward-work event TaskClaimAcquisitionIntended"
  )

  const acceptedResult = integrationFinalityFixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult
  const integrationTarget = integrationFinalityFixture.integrationTarget
  const preCancellationIntegrationBegan: JournalRecord = {
    event: IntegrationResponsibilityBeganEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("cancelled-history-integration-began"),
    position: JournalPosition.make(9),
    runId
  }
  const postCancellationIntegrationStarted: JournalRecord = {
    event: IntegrationStartedEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt,
      responsibilityBeganAt: preCancellationIntegrationBegan.position,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("cancelled-history-integration-started"),
    position: JournalPosition.make(14),
    runId
  }
  expect(
    invalidDetailsFor(postCancellationIntegrationStarted, [
      ...baseRecords,
      preCancellationIntegrationBegan,
      postCancellationIntegrationStarted
    ])
  ).toEqual([])

  expect(
    invalidDetailsFor(postCancellationIntegrationStarted, [...baseRecords, postCancellationIntegrationStarted])
  ).toContain("post-cancellation history cannot record forward-work event IntegrationStarted")

  const postCancellationIntegrationBegan: JournalRecord = {
    ...preCancellationIntegrationBegan,
    position: JournalPosition.make(14)
  }
  expect(
    invalidDetailsFor(postCancellationIntegrationBegan, [...baseRecords, postCancellationIntegrationBegan])
  ).toContain("post-cancellation history cannot record forward-work event IntegrationResponsibilityBegan")
})

it.effect("round-trips cancellation settlement events through the journal codec", () =>
  Effect.gen(function* () {
    expect(yield* decodeJournalEvent(encodeJournalEvent(baseRecords.at(-1)?.event ?? noRelease))).toEqual(
      baseRecords.at(-1)?.event ?? noRelease
    )
    expect(yield* decodeJournalEvent(encodeJournalEvent(noRelease))).toEqual(noRelease)
  })
)

it.effect("persists RunCancellationApplied in the memory journal store", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const event = RunCancellationAppliedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
    const appended = yield* journal.append(runId, runCancellationAppliedRecordKey, event)
    const records = yield* journal.read(runId)
    expect(records.at(-1)).toEqual(appended)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it("accepts the cancellation-specific release authority schema", () => {
  expect(Schema.decodeUnknownSync(WorkflowOperation)(cancellationReleaseOperation)).toEqual(
    cancellationReleaseOperation
  )
})

it("requires cancellation authority for a release after relinquishment and validates its outcome", () => {
  const readIntentRecord: JournalRecord = {
    event: taskTrackerReadIntent(releaseReadOperation),
    key: intentRecordKey(releaseReadOperation.operationId),
    position: JournalPosition.make(14),
    runId
  }
  const observationRecord: JournalRecord = {
    event: releaseObservation,
    key: outcomeRecordKey(releaseReadOperation.operationId),
    position: JournalPosition.make(15),
    runId
  }
  const intentRecord: JournalRecord = {
    event: cancellationReleaseIntent,
    key: intentRecordKey(cancellationReleaseOperation.release.operationId),
    position: JournalPosition.make(16),
    runId
  }
  const outcomeRecord: JournalRecord = {
    event: cancellationReleaseOutcome,
    key: outcomeRecordKey(cancellationReleaseOperation.release.operationId),
    position: JournalPosition.make(17),
    runId
  }
  const prefix = [...baseRecords, readIntentRecord, observationRecord, intentRecord]
  expect(invalidDetailsFor(intentRecord, prefix)).toEqual([])
  expect(invalidDetailsFor(outcomeRecord, [...prefix, outcomeRecord])).toEqual([])

  const ordinaryRelease = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [exactClaim.operationId],
    release: cancellationReleaseOperation.release
  })
  const ordinaryIntentRecord: JournalRecord = {
    ...intentRecord,
    event: TaskClaimReleaseIntendedEvent.make({ operation: ordinaryRelease, version: workflowJournalEventVersion }),
    position: JournalPosition.make(16)
  }
  expect(invalidDetailsFor(ordinaryIntentRecord, [...baseRecords, ordinaryIntentRecord])).toContain(
    "cancelled-attempt claim release requires CancelledAttemptClaimReleaseAuthority"
  )
  expect(invalidDetailsFor(ordinaryIntentRecord, [...baseRecords.slice(0, -1), ordinaryIntentRecord])).toContain(
    "cancelled-attempt claim release requires CancelledAttemptClaimReleaseAuthority"
  )
  const cancellationBeforeRelinquishment = baseRecords.at(-2)
  if (cancellationBeforeRelinquishment === undefined) return expect.fail("test fixture lacks cancellation")
  expect(
    invalidDetailsFor(ordinaryIntentRecord, [
      ...baseRecords.slice(0, -2),
      {
        event: replacementEvent,
        key: plannedAttemptReplacedRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(9),
        runId
      },
      cancellationBeforeRelinquishment,
      ordinaryIntentRecord
    ])
  ).toContain("cancelled-attempt claim release requires CancelledAttemptClaimReleaseAuthority")

  const foreignClaim = ActiveTaskClaim.make({
    ...exactClaim,
    operationId: OperationId.make("cancelled-history-outcome-foreign-claim")
  })
  const mismatchedOutcome: JournalRecord = {
    ...outcomeRecord,
    event: TaskClaimReleasedEvent.make({
      release: { ...cancellationReleaseOperation.release, claim: foreignClaim },
      version: workflowJournalEventVersion
    })
  }
  expect(invalidDetailsFor(mismatchedOutcome, [...prefix, mismatchedOutcome])).toContain(
    "cancelled-attempt claim release outcome contradicts its exact intent"
  )

  const missingReadOperation = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-history-release-missing-read"),
    target,
    taskId,
    [exactClaim.operationId]
  )
  const missingReadAuthority = TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
    ...cancellationReleaseAuthority,
    observationOperationId: missingReadOperation.operationId
  })
  const missingReadRelease = makeTaskClaimReleaseOperation({
    authority: missingReadAuthority,
    predecessorOperationIds: [exactClaim.operationId, missingReadOperation.operationId],
    release: cancellationReleaseOperation.release
  })
  const missingReadIntent: JournalRecord = {
    ...intentRecord,
    event: TaskClaimReleaseIntendedEvent.make({ operation: missingReadRelease, version: workflowJournalEventVersion })
  }
  expect(invalidDetailsFor(missingReadIntent, [...baseRecords, missingReadIntent])).toContain(
    "cancelled-attempt claim release requires a fresh exact focused claim observation"
  )

  const noPredecessorReadOperation = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-history-release-no-predecessor"),
    target,
    taskId,
    []
  )
  const noPredecessorAuthority = TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
    ...cancellationReleaseAuthority,
    observationOperationId: noPredecessorReadOperation.operationId
  })
  const noPredecessorRelease = makeTaskClaimReleaseOperation({
    authority: noPredecessorAuthority,
    predecessorOperationIds: [exactClaim.operationId, noPredecessorReadOperation.operationId],
    release: { ...cancellationReleaseOperation.release, operationId: OperationId.make("release-no-predecessor") }
  })
  const noPredecessorIntent: JournalRecord = {
    ...intentRecord,
    event: TaskClaimReleaseIntendedEvent.make({ operation: noPredecessorRelease, version: workflowJournalEventVersion })
  }
  const noPredecessorObservation: JournalRecord = {
    event: taskTrackerFactsObservedEvent(
      noPredecessorReadOperation.operationId,
      makeFocusedTaskClaimFactsObserved(noPredecessorReadOperation, exactClaim)
    ),
    key: outcomeRecordKey(noPredecessorReadOperation.operationId),
    position: JournalPosition.make(15),
    runId
  }
  const noPredecessorReadIntent: JournalRecord = {
    event: taskTrackerReadIntent(noPredecessorReadOperation),
    key: intentRecordKey(noPredecessorReadOperation.operationId),
    position: JournalPosition.make(14),
    runId
  }
  expect(
    invalidDetailsFor(noPredecessorIntent, [
      ...baseRecords,
      noPredecessorReadIntent,
      noPredecessorObservation,
      noPredecessorIntent
    ])
  ).toContain("cancelled-attempt claim release requires a fresh exact focused claim observation")

  const wrongTargetReadOperation = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-history-release-wrong-target"),
    FixtureTarget.make("cancelled-history-release-wrong-target"),
    taskId,
    [exactClaim.operationId]
  )
  const wrongTargetAuthority = TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
    ...cancellationReleaseAuthority,
    observationOperationId: wrongTargetReadOperation.operationId
  })
  const wrongTargetRelease = makeTaskClaimReleaseOperation({
    authority: wrongTargetAuthority,
    predecessorOperationIds: [exactClaim.operationId, wrongTargetReadOperation.operationId],
    release: { ...cancellationReleaseOperation.release, operationId: OperationId.make("release-wrong-target") }
  })
  const wrongTargetIntent: JournalRecord = {
    ...intentRecord,
    event: TaskClaimReleaseIntendedEvent.make({ operation: wrongTargetRelease, version: workflowJournalEventVersion })
  }
  const wrongTargetReadIntent: JournalRecord = {
    event: taskTrackerReadIntent(wrongTargetReadOperation),
    key: intentRecordKey(wrongTargetReadOperation.operationId),
    position: JournalPosition.make(14),
    runId
  }
  const wrongTargetObservation: JournalRecord = {
    event: { ...releaseObservation, operationId: wrongTargetReadOperation.operationId },
    key: outcomeRecordKey(wrongTargetReadOperation.operationId),
    position: JournalPosition.make(15),
    runId
  }
  expect(
    invalidDetailsFor(wrongTargetIntent, [
      ...baseRecords,
      wrongTargetReadIntent,
      wrongTargetObservation,
      wrongTargetIntent
    ])
  ).toContain("cancelled-attempt claim release requires a fresh exact focused claim observation")

  const duplicateIntentRecord: JournalRecord = { ...intentRecord, position: JournalPosition.make(18) }
  expect(invalidDetailsFor(duplicateIntentRecord, [...prefix, duplicateIntentRecord])).toContain(
    "cancelled-attempt claim disposition is already terminal"
  )
  expect(
    invalidDetailsFor(outcomeRecord, [readIntentRecord, observationRecord, intentRecord, outcomeRecord])
  ).toContain("cancelled-attempt claim release outcome requires its exact prior relinquishment")
  const duplicateOutcomeRecord: JournalRecord = { ...outcomeRecord, position: JournalPosition.make(18) }
  expect(invalidDetailsFor(duplicateOutcomeRecord, [...prefix, outcomeRecord, duplicateOutcomeRecord])).toContain(
    "cancelled-attempt claim disposition is already terminal"
  )
})

it("settles only target-matching claim dispositions for each release authority", () => {
  type TaskClaimReleaseResponsibility = Extract<
    WorkflowResponsibilityEntry,
    { readonly _tag: "TaskClaimReleaseResponsibility" }
  >
  const record = (event: JournalRecord["event"], key: JournalRecord["key"], position: number): JournalRecord => ({
    event,
    key,
    position: JournalPosition.make(position),
    runId
  })
  const responsibilityFor = (
    operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type,
    beganAt = relinquishedAt
  ): TaskClaimReleaseResponsibility =>
    WorkflowResponsibilityEntry.cases.TaskClaimReleaseResponsibility.make({ beganAt, operation, taskId })

  const ordinaryRelease = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [exactClaim.operationId],
    release: { ...cancellationReleaseOperation.release, operationId: OperationId.make("helper-ordinary-release") }
  })
  const ordinaryRecords = [
    ...baseRecords,
    record(
      TaskClaimReleaseIntendedEvent.make({ operation: ordinaryRelease, version: workflowJournalEventVersion }),
      intentRecordKey(ordinaryRelease.release.operationId),
      14
    ),
    record(
      TaskClaimReleasedEvent.make({ release: ordinaryRelease.release, version: workflowJournalEventVersion }),
      outcomeRecordKey(ordinaryRelease.release.operationId),
      15
    )
  ]
  expect(taskClaimReleaseSettled(ordinaryRecords, responsibilityFor(ordinaryRelease), target)).toBe(true)
  expect(taskClaimReleaseSettled(ordinaryRecords.slice(0, -1), responsibilityFor(ordinaryRelease), target)).toBe(false)
  expect(
    taskClaimReleaseSettled(
      [
        ...ordinaryRecords.slice(0, -1),
        record(
          TaskClaimReleasedEvent.make({
            release: { ...ordinaryRelease.release, operationId: OperationId.make("helper-wrong-release-outcome") },
            version: workflowJournalEventVersion
          }),
          outcomeRecordKey(OperationId.make("helper-wrong-release-outcome")),
          15
        )
      ],
      responsibilityFor(ordinaryRelease),
      target
    )
  ).toBe(false)
  expect(
    taskClaimReleaseSettled(
      [...ordinaryRecords.slice(0, -2), ordinaryRecords.at(-1) as JournalRecord],
      responsibilityFor(ordinaryRelease),
      target
    )
  ).toBe(false)

  const exactCancellationRecords = [
    ...baseRecords,
    record(taskTrackerReadIntent(readOperation), intentRecordKey(readOperation.operationId), 14),
    record(noReleaseObservation, outcomeRecordKey(readOperation.operationId), 15),
    record(noRelease, cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId), 16)
  ]
  const cancellationOperation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
      ...cancellationReleaseAuthority,
      observationOperationId: readOperation.operationId
    }),
    predecessorOperationIds: [exactClaim.operationId, readOperation.operationId],
    release: { ...cancellationReleaseOperation.release, operationId: OperationId.make("helper-cancelled-release") }
  })
  expect(taskClaimReleaseSettled(exactCancellationRecords, responsibilityFor(cancellationOperation), target)).toBe(true)

  const stoppedRequestId = AttemptChoiceRequestId.make({ nonce: "helper-stopped", runId })
  const stoppedOperation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
      observationOperationId: readOperation.operationId,
      requestId: stoppedRequestId
    }),
    predecessorOperationIds: [exactClaim.operationId, readOperation.operationId],
    release: { ...cancellationReleaseOperation.release, operationId: OperationId.make("helper-stopped-release") }
  })
  const stoppedEvent = StoppedAttemptClaimNoReleaseObservedEvent.make({
    expectedClaim: exactClaim,
    observation: UnclaimedTask.make({ taskId }),
    observationOperationId: readOperation.operationId,
    occurrenceClassification: "NonActionOccurrence",
    requestId: stoppedRequestId,
    subject: { observedTaskRevision: TaskRevision.make("helper-stopped-observed-revision"), plannedAttempt },
    version: workflowJournalEventVersion
  })
  const stoppedRecords = [
    ...baseRecords,
    record(taskTrackerReadIntent(readOperation), intentRecordKey(readOperation.operationId), 14),
    record(noReleaseObservation, outcomeRecordKey(readOperation.operationId), 15),
    record(stoppedEvent, stoppedAttemptClaimNoReleaseRecordKey(stoppedRequestId), 16)
  ]
  expect(taskClaimReleaseSettled(stoppedRecords, responsibilityFor(stoppedOperation), target)).toBe(true)
  expect(taskClaimReleaseSettled(stoppedRecords, responsibilityFor(cancellationOperation), target)).toBe(false)

  const foreignTarget = FixtureTarget.make("cancelled-history-helper-foreign-target")
  const foreignRead = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-history-helper-foreign-read"),
    foreignTarget,
    taskId,
    [exactClaim.operationId]
  )
  const foreignObservation = taskTrackerFactsObservedEvent(
    foreignRead.operationId,
    makeFocusedTaskClaimFactsObserved(foreignRead, UnclaimedTask.make({ taskId }))
  )
  const foreignCancellationOperation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
      ...cancellationReleaseAuthority,
      observationOperationId: foreignRead.operationId
    }),
    predecessorOperationIds: [exactClaim.operationId, foreignRead.operationId],
    release: {
      ...cancellationReleaseOperation.release,
      operationId: OperationId.make("helper-foreign-cancelled-release")
    }
  })
  const foreignCancellationEvent = CancelledAttemptClaimNoReleaseObservedEvent.make({
    ...noRelease,
    observationOperationId: foreignRead.operationId
  })
  const foreignCancellationRecords = [
    ...baseRecords,
    record(taskTrackerReadIntent(foreignRead), intentRecordKey(foreignRead.operationId), 14),
    record(foreignObservation, outcomeRecordKey(foreignRead.operationId), 15),
    record(foreignCancellationEvent, cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId), 16)
  ]
  expect(
    taskClaimReleaseSettled(foreignCancellationRecords, responsibilityFor(foreignCancellationOperation), target)
  ).toBe(false)
  expect(taskClaimReleaseSettled(foreignCancellationRecords, responsibilityFor(stoppedOperation), target)).toBe(false)

  const foreignClaim = ActiveTaskClaim.make({
    ...exactClaim,
    operationId: OperationId.make("cancelled-history-helper-foreign-claim"),
    token: ClaimToken.make("cancelled-history-helper-foreign-token")
  })
  const foreignClaimObservation = taskTrackerFactsObservedEvent(
    readOperation.operationId,
    makeFocusedTaskClaimFactsObserved(readOperation, foreignClaim)
  )
  const foreignClaimStoppedEvent = StoppedAttemptClaimNoReleaseObservedEvent.make({
    ...stoppedEvent,
    observation: foreignClaim
  })
  const foreignClaimCancelledEvent = CancelledAttemptClaimNoReleaseObservedEvent.make({
    ...noRelease,
    observation: foreignClaim
  })
  const foreignClaimRows = [
    ...baseRecords,
    record(taskTrackerReadIntent(readOperation), intentRecordKey(readOperation.operationId), 14),
    record(foreignClaimObservation, outcomeRecordKey(readOperation.operationId), 15)
  ]
  expect(
    taskClaimReleaseSettled(
      [
        ...foreignClaimRows,
        record(foreignClaimStoppedEvent, stoppedAttemptClaimNoReleaseRecordKey(stoppedRequestId), 16)
      ],
      responsibilityFor(stoppedOperation),
      target
    )
  ).toBe(true)
  expect(
    taskClaimReleaseSettled(
      [
        ...foreignClaimRows,
        record(foreignClaimCancelledEvent, cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId), 16)
      ],
      responsibilityFor(cancellationOperation),
      target
    )
  ).toBe(true)
})

it("does not let a terminal report and pre-cancellation claim release bypass cancellation relinquishment", () => {
  const suspensionResponseRow = rows[9]
  const terminalReportRow = rows[10]
  const cancellationRow = rows[11]
  if (
    suspensionResponseRow === undefined ||
    terminalReportRow === undefined ||
    cancellationRow === undefined ||
    suspensionResponseRow.event._tag !== "PlannedAttemptExecutorCommandResponseObserved" ||
    terminalReportRow.event._tag !== "PlannedAttemptExecutorWorkReported" ||
    cancellationRow.event._tag !== "RunCancellationApplied"
  ) {
    return expect.fail("test fixture lacks terminal-report and cancellation rows")
  }
  const terminalExecutorReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId },
    result: { _tag: "Completed" }
  })
  const ordinaryReleaseOperation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [exactClaim.operationId, releaseReadOperation.operationId],
    release: { claim: exactClaim, operationId: OperationId.make("cancelled-history-ordinary-release") }
  })
  const terminalRows: ReadonlyArray<Pick<JournalRecord, "event" | "key">> = [
    ...rows.slice(0, 9),
    {
      event: PlannedAttemptExecutorCommandResponseObservedEvent.make({
        ...suspensionResponseRow.event,
        report: terminalExecutorReport
      }),
      key: suspensionResponseRow.key
    },
    {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: laterReportOrdinal,
        report: terminalExecutorReport,
        version: workflowJournalEventVersion
      }),
      key: terminalReportRow.key
    },
    { event: taskTrackerReadIntent(releaseReadOperation), key: intentRecordKey(releaseReadOperation.operationId) },
    { event: releaseObservation, key: outcomeRecordKey(releaseReadOperation.operationId) },
    {
      event: TaskClaimReleaseIntendedEvent.make({
        operation: ordinaryReleaseOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(ordinaryReleaseOperation.release.operationId)
    },
    {
      event: TaskClaimReleasedEvent.make({
        release: ordinaryReleaseOperation.release,
        version: workflowJournalEventVersion
      }),
      key: outcomeRecordKey(ordinaryReleaseOperation.release.operationId)
    },
    cancellationRow
  ]
  const terminalRecords = recordsFrom(terminalRows)
  const evidence = RunFinalityEvidence.make({
    blockedTaskIds: [],
    complete: true,
    coverage: CompleteTargetClosureCoverage.make({ explicitlyCoveredTaskIds: [], target }),
    contentIdentity: TrackerRevision.make("cancelled-history-finality"),
    graphOutcome: "Unsettled",
    operationId: OperationId.make("cancelled-history-finality-read"),
    readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [] }),
    requiredFactFamilies: requiredRunFinalityFactFamilies,
    rootTaskId: TaskId.make("root"),
    runId,
    target,
    terminalTaskIds: [],
    observedAt: JournalPosition.make(1)
  })
  expect(terminationPreconditionIssues(terminalRecords, runId, evidence)).toContain(
    "termination requires every journal responsibility to be settled"
  )
})

it("covers termination responsibility settlement and graph comparability controls, including target-isolated cancellation no-release", () => {
  const evidence = completedRunFinalityFixture({ runId, target }).evidence
  const unsettledPrefix = baseRecords.slice(0, 11)
  expect(terminationPreconditionIssues(unsettledPrefix, runId, evidence)).toContain(
    "termination requires every journal responsibility to be settled"
  )

  const foreignClaim = ActiveTaskClaim.make({
    ...exactClaim,
    operationId: OperationId.make("cancelled-history-rejected-foreign")
  })
  const rejected = TaskClaimAcquisitionRejectedEvent.make({
    observed: foreignClaim,
    operationId: exactClaim.operationId,
    reason: "ForeignClaim",
    version: workflowJournalEventVersion
  })
  const acquiredRecord = baseRecords[2]
  if (acquiredRecord === undefined) return expect.fail("test fixture lacks acquisition outcome")
  const rejectedRecords = [
    ...baseRecords.slice(0, 2),
    { ...acquiredRecord, event: rejected },
    ...baseRecords.slice(3, 11)
  ] as ReadonlyArray<JournalRecord>
  expect(terminationPreconditionIssues(rejectedRecords, runId, evidence)).toEqual([
    "termination requires every journal responsibility to be settled"
  ])

  const releaseRows = [
    {
      event: taskTrackerReadIntent(releaseReadOperation),
      key: intentRecordKey(releaseReadOperation.operationId),
      position: JournalPosition.make(14),
      runId
    },
    {
      event: releaseObservation,
      key: outcomeRecordKey(releaseReadOperation.operationId),
      position: JournalPosition.make(15),
      runId
    },
    {
      event: cancellationReleaseIntent,
      key: intentRecordKey(cancellationReleaseOperation.release.operationId),
      position: JournalPosition.make(16),
      runId
    }
  ]
  expect(terminationPreconditionIssues([...baseRecords, ...releaseRows], runId, evidence)).toContain(
    "termination requires every journal responsibility to be settled"
  )
  expect(
    terminationPreconditionIssues(
      [
        ...baseRecords,
        ...releaseRows,
        {
          event: cancellationReleaseOutcome,
          key: outcomeRecordKey(cancellationReleaseOperation.release.operationId),
          position: JournalPosition.make(17),
          runId
        }
      ],
      runId,
      evidence
    )
  ).toEqual([])

  const noReleaseRecords = [
    ...baseRecords,
    {
      event: taskTrackerReadIntent(readOperation),
      key: intentRecordKey(readOperation.operationId),
      position: JournalPosition.make(14),
      runId
    },
    {
      event: noReleaseObservation,
      key: outcomeRecordKey(readOperation.operationId),
      position: JournalPosition.make(15),
      runId
    },
    {
      event: noRelease,
      key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(16),
      runId
    }
  ] as ReadonlyArray<JournalRecord>
  expect(terminationPreconditionIssues(noReleaseRecords, runId, evidence)).toEqual([])

  const foreignTarget = FixtureTarget.make("cancelled-history-termination-foreign-target")
  const foreignReadOperation = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-history-termination-foreign-claim-read"),
    foreignTarget,
    taskId,
    [exactClaim.operationId]
  )
  const foreignNoReleaseObservation = taskTrackerFactsObservedEvent(
    foreignReadOperation.operationId,
    makeFocusedTaskClaimFactsObserved(foreignReadOperation, UnclaimedTask.make({ taskId }))
  )
  const foreignNoRelease = CancelledAttemptClaimNoReleaseObservedEvent.make({
    ...noRelease,
    observationOperationId: foreignReadOperation.operationId
  })
  const foreignNoReleaseRecords = [
    ...baseRecords,
    {
      event: taskTrackerReadIntent(foreignReadOperation),
      key: intentRecordKey(foreignReadOperation.operationId),
      position: JournalPosition.make(14),
      runId
    },
    {
      event: foreignNoReleaseObservation,
      key: outcomeRecordKey(foreignReadOperation.operationId),
      position: JournalPosition.make(15),
      runId
    },
    {
      event: foreignNoRelease,
      key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(16),
      runId
    }
  ] as ReadonlyArray<JournalRecord>
  expect(reduceWorkflowJournalHistory(runId, foreignNoReleaseRecords)._tag).toBe("InvalidWorkflowJournalHistory")
  expect(terminationPreconditionIssues(foreignNoReleaseRecords, runId, evidence)).not.toEqual([])

  const interleavedNoReleaseRecords = [
    ...baseRecords,
    {
      event: taskTrackerReadIntent(readOperation),
      key: intentRecordKey(readOperation.operationId),
      position: JournalPosition.make(14),
      runId
    },
    {
      event: noReleaseObservation,
      key: outcomeRecordKey(readOperation.operationId),
      position: JournalPosition.make(15),
      runId
    },
    {
      event: taskTrackerReadIntent(foreignReadOperation),
      key: intentRecordKey(foreignReadOperation.operationId),
      position: JournalPosition.make(16),
      runId
    },
    {
      event: foreignNoReleaseObservation,
      key: outcomeRecordKey(foreignReadOperation.operationId),
      position: JournalPosition.make(17),
      runId
    },
    {
      event: noRelease,
      key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(18),
      runId
    }
  ] as ReadonlyArray<JournalRecord>
  expect(reduceWorkflowJournalHistory(runId, interleavedNoReleaseRecords)._tag).toBe("ValidWorkflowJournalHistory")
  expect(terminationPreconditionIssues(interleavedNoReleaseRecords, runId, evidence)).toEqual([])

  const laterExactReadOperation = makeTaskClaimObservationOperation(
    OperationId.make("cancelled-history-termination-later-exact-claim-read"),
    target,
    taskId,
    [exactClaim.operationId]
  )
  const laterExactObservation = taskTrackerFactsObservedEvent(
    laterExactReadOperation.operationId,
    makeFocusedTaskClaimFactsObserved(laterExactReadOperation, UnclaimedTask.make({ taskId }))
  )
  const sameTargetLaterRecords = [
    ...baseRecords,
    {
      event: taskTrackerReadIntent(readOperation),
      key: intentRecordKey(readOperation.operationId),
      position: JournalPosition.make(14),
      runId
    },
    {
      event: noReleaseObservation,
      key: outcomeRecordKey(readOperation.operationId),
      position: JournalPosition.make(15),
      runId
    },
    {
      event: taskTrackerReadIntent(laterExactReadOperation),
      key: intentRecordKey(laterExactReadOperation.operationId),
      position: JournalPosition.make(16),
      runId
    },
    {
      event: laterExactObservation,
      key: outcomeRecordKey(laterExactReadOperation.operationId),
      position: JournalPosition.make(17),
      runId
    },
    {
      event: noRelease,
      key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(18),
      runId
    }
  ] as ReadonlyArray<JournalRecord>
  expect(reduceWorkflowJournalHistory(runId, sameTargetLaterRecords)._tag).toBe("InvalidWorkflowJournalHistory")

  const finalityGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-termination-foreign-claim-finality"),
    target
  )
  const finalitySnapshot = validSnapshot({
    revision: "cancelled-history-termination-foreign-claim-finality",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const finalityObservation = taskTrackerFactsObservedEvent(
    finalityGraphOperation.operationId,
    makeCompleteTaskTrackerFactsObserved(finalityGraphOperation, finalitySnapshot)
  )
  const foreignNoReleaseFinalityRecords = [
    ...foreignNoReleaseRecords,
    {
      event: taskTrackerReadIntent(finalityGraphOperation),
      key: intentRecordKey(finalityGraphOperation.operationId),
      position: JournalPosition.make(17),
      runId
    },
    {
      event: finalityObservation,
      key: outcomeRecordKey(finalityGraphOperation.operationId),
      position: JournalPosition.make(18),
      runId
    }
  ] as ReadonlyArray<JournalRecord>
  const finalityEvidence = makeRunFinalityEvidence({
    observedAt: JournalPosition.make(18),
    operationId: finalityGraphOperation.operationId,
    readShape: finalityGraphOperation.readShape,
    rootTaskId: TaskId.make("root"),
    runId,
    snapshot: finalitySnapshot,
    target
  })
  const lifecycleDecision = decideWorkflowRunTermination(
    foreignNoReleaseFinalityRecords,
    runId,
    "Cancelled",
    finalityEvidence
  )
  expect(lifecycleDecision).toMatchObject({
    _tag: "LifecycleTransitionRejected",
    failure: {
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("termination requires a valid workflow-journal history prefix")
    }
  })

  const laterResponseRecord = baseRecords[9]
  const laterReportRecord = baseRecords[10]
  if (
    laterResponseRecord?.event._tag !== "PlannedAttemptExecutorCommandResponseObserved" ||
    laterReportRecord === undefined
  ) {
    return expect.fail("test fixture lacks later executor response and report")
  }
  const terminalExecutorReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId },
    result: { _tag: "Completed" }
  })
  const terminalResponse: JournalRecord = {
    ...laterResponseRecord,
    event: PlannedAttemptExecutorCommandResponseObservedEvent.make({
      ...laterResponseRecord.event,
      report: terminalExecutorReport
    })
  }
  const terminalReport: JournalRecord = {
    ...laterReportRecord,
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: laterReportOrdinal,
      report: terminalExecutorReport,
      version: workflowJournalEventVersion
    })
  }
  expect(
    terminationPreconditionIssues([...baseRecords.slice(0, 9), terminalResponse, terminalReport], runId, evidence)
  ).toContain("termination requires every journal responsibility to be settled")

  const graphFixture = completedRunFinalityFixture({ runId, target })
  const beginningRecord = baseRecords[0]
  if (beginningRecord === undefined) return expect.fail("test fixture lacks workflow beginning")
  const graphRecordsFor = (
    reads: ReadonlyArray<{
      readonly operation: ReturnType<typeof makeTrackerGraphObservationOperation>
      readonly snapshot: ReturnType<typeof validSnapshot>
    }>
  ): ReadonlyArray<JournalRecord> => [
    beginningRecord,
    ...reads.flatMap(({ operation, snapshot }, index) => [
      {
        event: taskTrackerReadIntent(operation),
        key: intentRecordKey(operation.operationId),
        position: JournalPosition.make(index * 2 + 2),
        runId
      },
      {
        event: taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, snapshot)
        ),
        key: outcomeRecordKey(operation.operationId),
        position: JournalPosition.make(index * 2 + 3),
        runId
      }
    ])
  ]
  const firstGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-precondition-graph-first"),
    target
  )
  const secondGraphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-precondition-graph-second"),
    target
  )
  const firstGraphSnapshot = validSnapshot({
    revision: "cancelled-history-precondition-graph-first-revision",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const secondGraphSnapshot = validSnapshot({
    revision: "cancelled-history-precondition-graph-second-revision",
    rootTaskId: "root",
    tasks: [{ id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  const contradictoryGraphRecords = graphRecordsFor([
    { operation: firstGraphOperation, snapshot: firstGraphSnapshot },
    { operation: secondGraphOperation, snapshot: secondGraphSnapshot }
  ])
  expect(terminationPreconditionIssues(contradictoryGraphRecords, runId, graphFixture.evidence)).toContain(
    "termination requires tracker graph observations to be causally comparable"
  )

  const causallyRelatedSecond = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-precondition-graph-causal-second"),
    target,
    [firstGraphOperation.operationId]
  )
  expect(
    terminationPreconditionIssues(
      graphRecordsFor([
        { operation: firstGraphOperation, snapshot: firstGraphSnapshot },
        { operation: causallyRelatedSecond, snapshot: secondGraphSnapshot }
      ]),
      runId,
      graphFixture.evidence
    )
  ).toEqual([])

  const foreignTargetOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-precondition-graph-foreign-target"),
    FixtureTarget.make("cancelled-history-precondition-foreign-target")
  )
  expect(
    terminationPreconditionIssues(
      graphRecordsFor([
        { operation: firstGraphOperation, snapshot: firstGraphSnapshot },
        { operation: foreignTargetOperation, snapshot: secondGraphSnapshot }
      ]),
      runId,
      graphFixture.evidence
    )
  ).toEqual([])

  const disjointFirst = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-precondition-graph-disjoint-first"),
    target,
    [],
    [TaskId.make("root")]
  )
  const disjointSecond = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("cancelled-history-precondition-graph-disjoint-second"),
    target,
    [],
    [TaskId.make("other")]
  )
  const disjointSecondSnapshot = validSnapshot({
    revision: "cancelled-history-precondition-graph-disjoint-revision",
    rootTaskId: "other",
    tasks: [{ id: "other", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  expect(
    terminationPreconditionIssues(
      graphRecordsFor([
        { operation: disjointFirst, snapshot: firstGraphSnapshot },
        { operation: disjointSecond, snapshot: disjointSecondSnapshot }
      ]),
      runId,
      graphFixture.evidence
    )
  ).toEqual([])
})
