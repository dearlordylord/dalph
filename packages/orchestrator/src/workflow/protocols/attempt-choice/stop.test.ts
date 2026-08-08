import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TaskClaimReleaseFailure,
  UnclaimedTask
} from "../../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { makeTaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { transitionTaskWorkPosition } from "../../../coordination/frontier/transition-task-work.js"
import { makeJournaledFreshRunRecoveryProjection } from "../../../coordination/run/recovery-activation.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  stoppedAttemptClaimNoReleaseRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { type JournalRecord, JournalStore } from "../../../workflow-journal/store.js"
import { journaledWorkflowInterpreterLayer } from "../../../workflow-journal/journaled-interpreter.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimReleaseIntendedEvent,
  TaskClaimReleasedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  TaskClaimReleaseAuthority
} from "../../registry/operation.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { AttemptChoiceControl, attemptChoiceControlLayer } from "./control.js"
import { AttemptChoiceRequestId, StoppedAttemptClaimNoReleaseObservedEvent } from "./events.js"
import { AuthoritativeTaskClaimObserved, WorkflowInterpreter } from "../../interpretation/interpreter.js"
import { AuthoritativeTaskClaimReleased } from "../task-claim-release/protocol.js"
import { advanceAttemptStoppage, observeAttemptStoppageExecutor, recordStoppedAttemptClaimNoRelease } from "./stop.js"

const runId = RunId.make("attempt-stop-run")
const taskId = TaskId.make("attempt-stop-task")
const target = FixtureTarget.make("attempt-stop-target")
const plannedRevision = TaskRevision.make("attempt-stop-F1")
const changedSpecification = makeTaskWorkSpecification({ body: "Changed F2", taskId, title: "Changed F2" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-stop-P"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-stop-P"),
  executor: TaskExecutorLocator.make("executor:attempt-stop"),
  runId,
  taskId,
  taskRevision: plannedRevision,
  worktree: WorktreeLocator.make("/worktrees/attempt-stop-P")
})
const correlation = { attemptId: plannedAttempt.attemptId, runId }
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("attempt-stop-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("attempt-stop-token")
  },
  predecessorOperationIds: []
})
const exactClaim = ActiveTaskClaim.make(claimOperation.acquisition)
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("attempt-stop-plan"),
  plannedAttempt,
  predecessorOperationIds: [exactClaim.operationId]
})
const requestId = AttemptChoiceRequestId.make({ nonce: "attempt-stop-D2", runId })
const subject = { observedTaskRevision: changedSpecification.fingerprint, plannedAttempt }
const unusedBoundary = () => Effect.die("unused boundary")

const appendExposedStop = Effect.fn("AttemptStopTest.appendExposed")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  yield* journal.append(
    runId,
    intentRecordKey(exactClaim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(exactClaim.operationId),
    TaskClaimAcquiredEvent.make({ claim: exactClaim, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const safeOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, safeOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: safeOrdinal,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }),
      version: workflowJournalEventVersion
    })
  )
  const specificationRead = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("attempt-stop-observe-F2"),
    target,
    taskId
  )
  yield* journal.append(runId, intentRecordKey(specificationRead.operationId), taskTrackerReadIntent(specificationRead))
  yield* journal.append(
    runId,
    outcomeRecordKey(specificationRead.operationId),
    taskTrackerFactsObservedEvent(
      specificationRead.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationRead, changedSpecification)
    )
  )
  yield* (yield* AttemptChoiceControl).apply({ choice: "StopTaskImplementation", requestId, subject })
})

const recordsWithRows = (
  records: ReadonlyArray<JournalRecord>,
  rows: ReadonlyArray<Pick<JournalRecord, "event" | "key">>
): ReadonlyArray<JournalRecord> => [
  ...records,
  ...rows.map((row, index) => ({ ...row, position: JournalPosition.make(records.length + index + 1), runId }))
]

it.effect("proves the exact executor stopped before abandoning implementation responsibility", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const result = yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("retained safe proof must avoid projection"),
          requestSuspension: () => Effect.die("retained safe proof must avoid suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const records = yield* (yield* JournalStore).read(runId)

    expect(result._tag).toBe("AttemptImplementationAbandoned")
    expect(records.filter(({ event }) => event._tag === "AttemptStoppageIntended")).toHaveLength(0)
    expect(records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects executor work that reopens an abandoned attempt", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("unused projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const records = yield* (yield* JournalStore).read(runId)
    const ordinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const forged = recordsWithRows(records, [
      {
        event: PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "StartOrContinue",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal)
      }
    ])

    expect(reduceWorkflowJournalHistory(runId, forged)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("follows abandonment") })
      ])
    })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rechecks the executor after restart before repeating Stop", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const journal = yield* JournalStore
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const projectionCalls = yield* Ref.make(0)
    const suspensionCalls = yield* Ref.make(0)
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () =>
            Ref.update(projectionCalls, (count) => count + 1).pipe(
              Effect.as(Option.some(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })))
            ),
          requestSuspension: () =>
            Ref.update(suspensionCalls, (count) => count + 1).pipe(
              Effect.as(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
            ),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const records = yield* journal.read(runId)

    expect(yield* Ref.get(projectionCalls)).toBe(1)
    expect(yield* Ref.get(suspensionCalls)).toBe(0)
    expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toHaveLength(2)
    expect(records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("issues three suspension commands, never a fourth, then abandons after a later safe projection", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const journal = yield* JournalStore
    const startOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, startOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: startOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const runningOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, runningOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: runningOrdinal,
        report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
        version: workflowJournalEventVersion
      })
    )
    const suspensionCalls = yield* Ref.make(0)
    const runningExecutor = PlannedAttemptExecutor.of({
      project: () => Effect.die("matched responses require no projection"),
      requestSuspension: () =>
        Ref.update(suspensionCalls, (count) => count + 1).pipe(
          Effect.as(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
        ),
      startOrContinue: () => Effect.die("unused continuation")
    })
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.andThen(advanceAttemptStoppage(requestId, subject)),
      Effect.andThen(advanceAttemptStoppage(requestId, subject)),
      Effect.provideService(PlannedAttemptExecutor, runningExecutor)
    )

    const recovery = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const observe = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObserveAttemptStoppageExecutor"
    )
    expect(observe).toMatchObject({ _tag: "ObserveAttemptStoppageExecutor", requestId, subject })
    if (observe?._tag !== "ObserveAttemptStoppageExecutor") return yield* Effect.die("missing Stop projection")
    expect(transitionTaskWorkPosition(observe)).toBe("ReserveOrReuse")

    const projectionCalls = yield* Ref.make(0)
    yield* observeAttemptStoppageExecutor(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () =>
            Ref.update(projectionCalls, (count) => count + 1).pipe(
              Effect.as(Option.some(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })))
            ),
          requestSuspension: () => Effect.die("a fourth suspension command is forbidden"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const records = yield* journal.read(runId)

    expect(yield* Ref.get(suspensionCalls)).toBe(3)
    expect(yield* Ref.get(projectionCalls)).toBe(1)
    expect(
      records.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
      )
    ).toHaveLength(3)
    expect(records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("derives a no-release result only from the exact journaled focused claim observation", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("unused projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const journal = yield* JournalStore
    const missingOperationId = OperationId.make("attempt-stop-missing-claim-read")
    const missing = yield* recordStoppedAttemptClaimNoRelease(requestId, subject, missingOperationId).pipe(Effect.flip)
    expect(missing._tag).toBe("StoppedAttemptClaimObservationMissing")

    const claimRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-current-claim"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(claimRead.operationId), taskTrackerReadIntent(claimRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(claimRead.operationId),
      taskTrackerFactsObservedEvent(
        claimRead.operationId,
        makeFocusedTaskClaimFactsObserved(claimRead, UnclaimedTask.make({ taskId }))
      )
    )
    yield* recordStoppedAttemptClaimNoRelease(requestId, subject, claimRead.operationId)
    const records = yield* journal.read(runId)
    const noRelease = records.findLast(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")?.event

    expect(noRelease).toMatchObject({
      _tag: "StoppedAttemptClaimNoReleaseObserved",
      expectedClaim: exactClaim,
      observation: { _tag: "UnclaimedTask", taskId },
      observationOperationId: claimRead.operationId
    })
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects a stale no-release observation after a newer exact claim read", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("unused projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const journal = yield* JournalStore
    const staleRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-stale-no-release"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(staleRead.operationId), taskTrackerReadIntent(staleRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(staleRead.operationId),
      taskTrackerFactsObservedEvent(
        staleRead.operationId,
        makeFocusedTaskClaimFactsObserved(staleRead, UnclaimedTask.make({ taskId }))
      )
    )
    const currentRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-newer-exact-claim"),
      target,
      taskId,
      [exactClaim.operationId, staleRead.operationId]
    )
    yield* journal.append(runId, intentRecordKey(currentRead.operationId), taskTrackerReadIntent(currentRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(currentRead.operationId),
      taskTrackerFactsObservedEvent(currentRead.operationId, makeFocusedTaskClaimFactsObserved(currentRead, exactClaim))
    )

    const contradiction = yield* recordStoppedAttemptClaimNoRelease(requestId, subject, staleRead.operationId).pipe(
      Effect.flip
    )
    expect(contradiction._tag).toBe("StoppedAttemptClaimObservationContradiction")
    const records = yield* journal.read(runId)
    expect(records.some(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")).toBe(false)
    const forged = recordsWithRows(records, [
      {
        event: StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: UnclaimedTask.make({ taskId }),
          observationOperationId: staleRead.operationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        }),
        key: stoppedAttemptClaimNoReleaseRecordKey(requestId)
      }
    ])
    expect(reduceWorkflowJournalHistory(runId, forged)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("latest exact post-baseline claim read") })
      ])
    })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("requires one exact stopped-claim release operation after its current claim read", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("unused projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const journal = yield* JournalStore
    const exactRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-release-authority-read"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(exactRead.operationId), taskTrackerReadIntent(exactRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(exactRead.operationId),
      taskTrackerFactsObservedEvent(exactRead.operationId, makeFocusedTaskClaimFactsObserved(exactRead, exactClaim))
    )
    const records = yield* journal.read(runId)
    const releaseOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: exactRead.operationId,
        requestId
      }),
      predecessorOperationIds: [exactClaim.operationId, exactRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-authorized-release") }
    })
    const releaseIntentRow = {
      event: TaskClaimReleaseIntendedEvent.make({ operation: releaseOperation, version: workflowJournalEventVersion }),
      key: intentRecordKey(releaseOperation.release.operationId)
    }
    const intended = recordsWithRows(records, [releaseIntentRow])
    expect(reduceWorkflowJournalHistory(runId, intended)._tag).toBe("ValidWorkflowJournalHistory")

    const duplicateOperation = makeTaskClaimReleaseOperation({
      authority: releaseOperation.authority,
      predecessorOperationIds: releaseOperation.predecessorOperationIds,
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-duplicate-release") }
    })
    const duplicate = recordsWithRows(intended, [
      {
        event: TaskClaimReleaseIntendedEvent.make({
          operation: duplicateOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(duplicateOperation.release.operationId)
      }
    ])
    expect(reduceWorkflowJournalHistory(runId, duplicate)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("already has one durable intent") })
      ])
    })

    const wrongOutcomeOperationId = OperationId.make("attempt-stop-wrong-release-outcome")
    const wrongOutcome = recordsWithRows(intended, [
      {
        event: TaskClaimReleasedEvent.make({
          release: { ...releaseOperation.release, operationId: wrongOutcomeOperationId },
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(wrongOutcomeOperationId)
      }
    ])
    expect(reduceWorkflowJournalHistory(runId, wrongOutcome)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("contradicts operation") })
      ])
    })

    const predatedRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-predated-release-read"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    const abandonmentIndex = records.findIndex(({ event }) => event._tag === "AttemptImplementationAbandoned")
    const predatedRows: Array<Pick<JournalRecord, "event" | "key">> = records.map(({ event, key }) => ({ event, key }))
    predatedRows.splice(abandonmentIndex, 0, {
      event: taskTrackerReadIntent(predatedRead),
      key: intentRecordKey(predatedRead.operationId)
    })
    const predatedPrefix = recordsWithRows([], predatedRows)
    const predatedObservation = {
      event: taskTrackerFactsObservedEvent(
        predatedRead.operationId,
        makeFocusedTaskClaimFactsObserved(predatedRead, exactClaim)
      ),
      key: outcomeRecordKey(predatedRead.operationId)
    }
    const predatedRelease = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: predatedRead.operationId,
        requestId
      }),
      predecessorOperationIds: [exactClaim.operationId, predatedRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-predated-release") }
    })
    const predated = recordsWithRows(predatedPrefix, [
      predatedObservation,
      {
        event: TaskClaimReleaseIntendedEvent.make({ operation: predatedRelease, version: workflowJournalEventVersion }),
        key: intentRecordKey(predatedRelease.release.operationId)
      }
    ])
    expect(reduceWorkflowJournalHistory(runId, predated)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("latest exact post-abandonment claim read") })
      ])
    })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("makes released and no-release stopped-claim dispositions mutually exclusive", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("unused projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const journal = yield* JournalStore
    const exactRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-terminal-exact-read"),
      target,
      taskId,
      [exactClaim.operationId]
    )
    yield* journal.append(runId, intentRecordKey(exactRead.operationId), taskTrackerReadIntent(exactRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(exactRead.operationId),
      taskTrackerFactsObservedEvent(exactRead.operationId, makeFocusedTaskClaimFactsObserved(exactRead, exactClaim))
    )
    const releaseOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: exactRead.operationId,
        requestId
      }),
      predecessorOperationIds: [exactClaim.operationId, exactRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-terminal-release") }
    })
    yield* journal.append(
      runId,
      intentRecordKey(releaseOperation.release.operationId),
      TaskClaimReleaseIntendedEvent.make({ operation: releaseOperation, version: workflowJournalEventVersion })
    )
    const intended = yield* journal.read(runId)
    const missingRead = makeTaskClaimObservationOperation(
      OperationId.make("attempt-stop-terminal-missing-read"),
      target,
      taskId,
      [exactClaim.operationId, releaseOperation.release.operationId]
    )
    const missingObservation = UnclaimedTask.make({ taskId })
    const readRows = [
      { event: taskTrackerReadIntent(missingRead), key: intentRecordKey(missingRead.operationId) },
      {
        event: taskTrackerFactsObservedEvent(
          missingRead.operationId,
          makeFocusedTaskClaimFactsObserved(missingRead, missingObservation)
        ),
        key: outcomeRecordKey(missingRead.operationId)
      }
    ] as const
    const releasedRow = {
      event: TaskClaimReleasedEvent.make({ release: releaseOperation.release, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(releaseOperation.release.operationId)
    }
    const noReleaseRow = {
      event: StoppedAttemptClaimNoReleaseObservedEvent.make({
        expectedClaim: exactClaim,
        observation: missingObservation,
        observationOperationId: missingRead.operationId,
        occurrenceClassification: "NonActionOccurrence",
        requestId,
        subject,
        version: workflowJournalEventVersion
      }),
      key: stoppedAttemptClaimNoReleaseRecordKey(requestId)
    }

    for (const forged of [
      recordsWithRows(intended, [releasedRow, ...readRows, noReleaseRow]),
      recordsWithRows(intended, [...readRows, noReleaseRow, releasedRow])
    ]) {
      expect(reduceWorkflowJournalHistory(runId, forged)).toMatchObject({
        _tag: "InvalidWorkflowJournalHistory",
        issues: expect.arrayContaining([
          expect.objectContaining({ detail: "stopped-attempt claim disposition is already terminal" })
        ])
      })
    }
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("releases only the freshly confirmed exact claim after Stop", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("unused projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const recovery = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const claimReads = yield* Ref.make(0)
    const releases = yield* Ref.make(0)
    const base = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unusedBoundary,
        readTaskClaim: () =>
          Ref.update(claimReads, (count) => count + 1).pipe(
            Effect.as(AuthoritativeTaskClaimObserved.make({ observation: exactClaim }))
          ),
        readTaskWorktree: unusedBoundary,
        readTargetLineage: unusedBoundary,
        readTrackerGraph: unusedBoundary,
        readTaskWorkSpecification: unusedBoundary,
        reconcileTaskWorktree: unusedBoundary,
        recordTaskAttemptPlan: unusedBoundary,
        releaseTaskClaim: (operation) =>
          Ref.update(releases, (count) => count + 1).pipe(
            Effect.as(AuthoritativeTaskClaimReleased.make({ release: operation.release }))
          )
      })
    )
    const journaled = journaledWorkflowInterpreterLayer(runId, base)
    yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const observe = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (observe?._tag !== "ObserveStoppedAttemptClaim") return yield* Effect.die("missing stopped claim read")
      yield* interpreter.readTaskClaim(observe.operation)

      const release = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ReleaseStoppedAttemptClaim"
      )
      if (release?._tag !== "ReleaseStoppedAttemptClaim") return yield* Effect.die("missing stopped claim release")
      yield* interpreter.releaseTaskClaim(release.operation)
      yield* interpreter.releaseTaskClaim(release.operation)
    }).pipe(Effect.provide(journaled))

    const projection = yield* recovery.readDeliveryProjection
    const records = yield* (yield* JournalStore).read(runId)
    expect(yield* Ref.get(claimReads)).toBe(1)
    expect(yield* Ref.get(releases)).toBe(1)
    expect(records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    expect(projection.frontier.transitions.some(({ _tag }) => _tag === "ReconcileTaskClaimRelease")).toBe(false)
    expect(projection.frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "Released" })
    )
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("stops implementation without mutating an absent or foreign claim", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("unused projection"),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const recovery = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const reads = yield* Ref.make(0)
    const releases = yield* Ref.make(0)
    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("attempt-stop-foreign-claim"),
      owner: ClaimOwner.make("foreign-owner"),
      taskId,
      token: ClaimToken.make("attempt-stop-foreign-token")
    })
    const base = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unusedBoundary,
        readTaskClaim: () =>
          Ref.updateAndGet(reads, (count) => count + 1).pipe(
            Effect.map((count) =>
              AuthoritativeTaskClaimObserved.make({ observation: count === 1 ? exactClaim : foreignClaim })
            )
          ),
        readTaskWorktree: unusedBoundary,
        readTargetLineage: unusedBoundary,
        readTrackerGraph: unusedBoundary,
        readTaskWorkSpecification: unusedBoundary,
        reconcileTaskWorktree: unusedBoundary,
        recordTaskAttemptPlan: unusedBoundary,
        releaseTaskClaim: (operation) =>
          Ref.update(releases, (count) => count + 1).pipe(
            Effect.andThen(
              Effect.fail(new TaskClaimReleaseFailure({ detail: "response lost", release: operation.release }))
            )
          )
      })
    )
    const journaled = journaledWorkflowInterpreterLayer(runId, base)
    yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const firstRead = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (firstRead?._tag !== "ObserveStoppedAttemptClaim") return yield* Effect.die("missing first claim read")
      yield* interpreter.readTaskClaim(firstRead.operation)
      const release = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ReleaseStoppedAttemptClaim"
      )
      if (release?._tag !== "ReleaseStoppedAttemptClaim") return yield* Effect.die("missing claim release")
      expect((yield* Effect.result(interpreter.releaseTaskClaim(release.operation)))._tag).toBe("Failure")
      const pending = yield* (yield* AttemptChoiceControl).apply({
        choice: "StopTaskImplementation",
        requestId,
        subject
      })
      expect(pending).toMatchObject({
        _tag: "StopApplied",
        status: {
          _tag: "ImplementationAbandonedClaimReleasePending",
          operationId: release.operation.release.operationId
        }
      })

      const reconcileRead = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
        ({ _tag }) => _tag === "ObserveStoppedAttemptClaim"
      )
      if (reconcileRead?._tag !== "ObserveStoppedAttemptClaim") {
        return yield* Effect.die("missing claim release reconciliation read")
      }
      yield* interpreter.readTaskClaim(reconcileRead.operation)
    }).pipe(Effect.provide(journaled))

    const noRelease = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "RecordStoppedAttemptClaimNoRelease"
    )
    if (noRelease?._tag !== "RecordStoppedAttemptClaimNoRelease") {
      return yield* Effect.die("missing stopped no-release transition")
    }
    expect(
      (yield* recovery.readDeliveryProjection).frontier.transitions.some(
        ({ _tag }) => _tag === "ReconcileTaskClaimRelease"
      )
    ).toBe(false)
    yield* recordStoppedAttemptClaimNoRelease(requestId, subject, noRelease.observationOperationId)

    const laterRecovery = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const laterProjection = yield* laterRecovery.readDeliveryProjection
    const records = yield* (yield* JournalStore).read(runId)
    expect(yield* Ref.get(reads)).toBe(2)
    expect(yield* Ref.get(releases)).toBe(1)
    expect(laterProjection.frontier.transitions.some(({ _tag }) => _tag === "ReconcileTaskClaimRelease")).toBe(false)
    expect(laterProjection.frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "StoppedAttemptSettled", claimDisposition: "NoRelease" })
    )
    expect(yield* (yield* AttemptChoiceControl).read(requestId)).toMatchObject({
      _tag: "StopApplied",
      status: { _tag: "SettledNoRelease", observation: foreignClaim }
    })
    expect(records.findLast(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")?.event).toMatchObject(
      { observation: foreignClaim }
    )
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)
