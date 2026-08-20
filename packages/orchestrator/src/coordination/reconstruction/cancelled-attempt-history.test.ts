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
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { encodeJournalEvent, decodeJournalEvent } from "../../workflow-journal/event-codec.js"
import {
  cancelledAttemptClaimNoReleaseRecordKey,
  cancelledAttemptImplementationResponsibilityRelinquishedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  runCancellationAppliedRecordKey,
  attemptPlanRecordKey,
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
  RunFinalityEvidence,
  RunFinalityReadShape
} from "../../coordination/frontier/run-finality.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
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
  WorkflowOperation
} from "../../workflow/registry/operation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  CompleteTargetClosureCoverage,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import {
  CancelledAttemptClaimNoReleaseObservedEvent,
  CancelledAttemptImplementationResponsibilityRelinquishedEvent,
  RunCancellationAppliedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { validateCancelledAttemptHistory } from "./cancelled-attempt-history.js"
import { reduceWorkflowJournalHistory } from "./history.js"
import { terminationPreconditionIssues } from "../../workflow-journal/termination-preconditions.js"

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
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("cancelled-history-test-plan"),
  plannedAttempt,
  predecessorOperationIds: [exactClaim.operationId]
})
const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
const laterCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
const laterReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
const cancellationAppliedAt = JournalPosition.make(10)
const relinquishedAt = JournalPosition.make(11)
const readOperation = makeTaskClaimObservationOperation(
  OperationId.make("cancelled-history-test-claim-read"),
  target,
  taskId,
  [exactClaim.operationId]
)

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
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal)
  },
  {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      }),
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal)
  },
  {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: laterCommandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, laterCommandOrdinal)
  },
  {
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: laterReportOrdinal,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      }),
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
      proof: { _tag: "CommandResponse", reportOrdinal: laterReportOrdinal },
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
    invalidProof({ _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(3) })
  ).toContain("cancelled-attempt relinquishment requires current safe or terminal executor evidence")
  expect(invalidProof({ _tag: "CommandResponse", reportOrdinal })).toContain(
    "cancelled-attempt relinquishment requires current safe or terminal executor evidence"
  )

  const supersedingCommand: JournalRecord = {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
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
    position: JournalPosition.make(10),
    runId
  }
  const supersededRecords = [
    ...baseRecords.slice(0, 9),
    supersedingCommand,
    ...baseRecords.slice(9).map((record) => ({ ...record, position: JournalPosition.make(record.position + 1) }))
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
    position: JournalPosition.make(12)
  }
  expect(historyDetailsFor([...baseRecords, duplicate])).toContain(
    "cancelled-attempt implementation responsibility is already relinquished"
  )
})

it("accepts a safe executor proof observed before cancellation", () => {
  const record = baseRecords.at(-1)
  if (record === undefined) return expect.fail("test fixture lacks relinquishment")
  expect(invalidDetailsFor(record, baseRecords)).toEqual([])
})

it("requires no-release event observation to equal the focused tracker observation", () => {
  const observationRecord: JournalRecord = {
    event: noReleaseObservation,
    key: outcomeRecordKey(readOperation.operationId),
    position: JournalPosition.make(13),
    runId
  }
  const readIntentRecord: JournalRecord = {
    event: taskTrackerReadIntent(readOperation),
    key: intentRecordKey(readOperation.operationId),
    position: JournalPosition.make(12),
    runId
  }
  const validRecord: JournalRecord = {
    event: noRelease,
    key: cancelledAttemptClaimNoReleaseRecordKey(plannedAttempt.attemptId),
    position: JournalPosition.make(14),
    runId
  }
  expect(invalidDetailsFor(validRecord, [...baseRecords, readIntentRecord, observationRecord, validRecord])).toEqual([])

  const contradictory: JournalRecord = {
    ...validRecord,
    event: CancelledAttemptClaimNoReleaseObservedEvent.make({ ...noRelease, observation: exactClaim })
  }
  expect(
    invalidDetailsFor(contradictory, [...baseRecords, readIntentRecord, observationRecord, contradictory])
  ).toContain("cancelled-attempt no-release requires an exact absent or foreign focused claim observation")

  const duplicate: JournalRecord = { ...validRecord, position: JournalPosition.make(15) }
  expect(
    invalidDetailsFor(duplicate, [...baseRecords, readIntentRecord, observationRecord, validRecord, duplicate])
  ).toContain("cancelled-attempt claim disposition is already terminal")
})

it("rejects a StartOrContinue command after cancellation", () => {
  const lateOrdinal = PlannedAttemptExecutorCommandOrdinal.make(3)
  const lateCommand: JournalRecord = {
    event: PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: lateOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, lateOrdinal),
    position: JournalPosition.make(12),
    runId
  }
  expect(invalidDetailsFor(lateCommand, [...baseRecords, lateCommand])).toContain(
    "post-cancellation history cannot record forward-work event PlannedAttemptExecutorCommandIntended"
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
    position: JournalPosition.make(12),
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
    position: JournalPosition.make(12)
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
    position: JournalPosition.make(12),
    runId
  }
  expect(
    invalidDetailsFor(postCancellationIntegrationStarted, [
      ...baseRecords,
      preCancellationIntegrationBegan,
      postCancellationIntegrationStarted
    ])
  ).toEqual([])

  const postCancellationIntegrationBegan: JournalRecord = {
    ...preCancellationIntegrationBegan,
    position: JournalPosition.make(12)
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
    position: JournalPosition.make(12),
    runId
  }
  const observationRecord: JournalRecord = {
    event: releaseObservation,
    key: outcomeRecordKey(releaseReadOperation.operationId),
    position: JournalPosition.make(13),
    runId
  }
  const intentRecord: JournalRecord = {
    event: cancellationReleaseIntent,
    key: intentRecordKey(cancellationReleaseOperation.release.operationId),
    position: JournalPosition.make(14),
    runId
  }
  const outcomeRecord: JournalRecord = {
    event: cancellationReleaseOutcome,
    key: outcomeRecordKey(cancellationReleaseOperation.release.operationId),
    position: JournalPosition.make(15),
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
    position: JournalPosition.make(14)
  }
  expect(invalidDetailsFor(ordinaryIntentRecord, [...baseRecords, ordinaryIntentRecord])).toContain(
    "cancelled-attempt claim release requires CancelledAttemptClaimReleaseAuthority"
  )

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
})

it("does not let a terminal report and pre-cancellation claim release bypass cancellation relinquishment", () => {
  const terminalReportRow = rows[8]
  const cancellationRow = rows[9]
  if (
    terminalReportRow === undefined ||
    cancellationRow === undefined ||
    terminalReportRow.event._tag !== "PlannedAttemptExecutorWorkReported" ||
    cancellationRow.event._tag !== "RunCancellationApplied"
  ) {
    return expect.fail("test fixture lacks terminal-report and cancellation rows")
  }
  const ordinaryReleaseOperation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [exactClaim.operationId, releaseReadOperation.operationId],
    release: { claim: exactClaim, operationId: OperationId.make("cancelled-history-ordinary-release") }
  })
  const terminalRows: ReadonlyArray<Pick<JournalRecord, "event" | "key">> = [
    ...rows.slice(0, 8),
    {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: laterReportOrdinal,
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          result: { _tag: "Completed" }
        }),
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
    rootPresent: true,
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
