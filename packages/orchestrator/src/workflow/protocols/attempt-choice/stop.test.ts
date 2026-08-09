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
import { Deferred, Effect, Layer, Option, Ref } from "effect"
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
  attemptChoiceAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  stoppedAttemptClaimNoReleaseRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord, JournalStore } from "../../../workflow-journal/store.js"
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
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { AttemptChoiceControl, attemptChoiceControlLayer } from "./control.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptImplementationAbandonedEvent,
  AttemptQuiescenceProof,
  AttemptStoppageIntendedEvent,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "./events.js"
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
const unusedPlannedAttemptExecutor = PlannedAttemptExecutor.of({
  project: () => Effect.die("executor must not be called before Stop authority is established"),
  requestSuspension: () => Effect.die("executor must not be called before Stop authority is established"),
  startOrContinue: () => Effect.die("unused continuation")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("attempt-stop-plan"),
  plannedAttempt,
  predecessorOperationIds: [exactClaim.operationId]
})
const requestId = AttemptChoiceRequestId.make({ nonce: "attempt-stop-D2", runId })
const subject = { observedTaskRevision: changedSpecification.fingerprint, plannedAttempt }
const unusedBoundary = () => Effect.die("unused boundary")

const appendExposedStop = Effect.fn("AttemptStopTest.appendExposed")(function* (
  includeClaim = true,
  includeRunBeginning = true
) {
  const journal = yield* JournalStore
  if (includeRunBeginning) {
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
  }
  if (includeClaim) {
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
  }
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
  if (includeRunBeginning) {
    yield* (yield* AttemptChoiceControl).apply({ choice: "StopTaskImplementation", requestId, subject })
  } else {
    yield* journal.append(
      runId,
      attemptChoiceAppliedRecordKey(requestId),
      AttemptChoiceAppliedEvent.make({
        choice: "StopTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    )
  }
})

const recordsWithRows = (
  records: ReadonlyArray<JournalRecord>,
  rows: ReadonlyArray<Pick<JournalRecord, "event" | "key">>
): ReadonlyArray<JournalRecord> => [
  ...records,
  ...rows.map((row, index) => ({ ...row, position: JournalPosition.make(records.length + index + 1), runId }))
]

const forgedRow = (name: string, event: JournalRecord["event"]): Pick<JournalRecord, "event" | "key"> => ({
  event,
  key: JournalRecordKey.make(`attempt-stop-forged:${name}`)
})

const invalidHistoryDetails = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  return reduction._tag === "InvalidWorkflowJournalHistory"
    ? reduction.issues.flatMap((issue) => ("detail" in issue ? [issue.detail] : []))
    : []
}

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

it.effect("rejects Stop advancement and observation without Alice's exact applied choice", () =>
  Effect.gen(function* () {
    expect(yield* advanceAttemptStoppage(requestId, subject).pipe(Effect.flip)).toMatchObject({
      _tag: "AttemptStopChoiceContradiction"
    })
    expect(yield* observeAttemptStoppageExecutor(requestId, subject).pipe(Effect.flip)).toMatchObject({
      _tag: "AttemptStopChoiceContradiction"
    })
    expect(
      yield* recordStoppedAttemptClaimNoRelease(
        requestId,
        subject,
        OperationId.make("no-applied-stop-observation")
      ).pipe(Effect.flip)
    ).toMatchObject({ _tag: "AttemptStopChoiceContradiction" })
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("requires the exact claim that authorized the attempt before abandoning implementation", () =>
  Effect.gen(function* () {
    yield* appendExposedStop(false)
    const failure = yield* advanceAttemptStoppage(requestId, subject).pipe(Effect.flip)

    expect(failure).toMatchObject({ _tag: "AttemptStopClaimAuthorityMissing", requestId, subject })
  }).pipe(
    Effect.provideService(PlannedAttemptExecutor, unusedPlannedAttemptExecutor),
    Effect.provide(attemptChoiceControlLayer),
    Effect.provide(legacyMemoryJournalStoreLayer)
  )
)

it.effect("keeps an abandoned attempt waiting when no tracker target can authorize its claim read", () =>
  Effect.gen(function* () {
    yield* appendExposedStop(true, false)
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () => Effect.die("retained proof needs no projection"),
          requestSuspension: () => Effect.die("retained proof needs no suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )

    const recovery = yield* makeJournaledFreshRunRecoveryProjection(runId)
    expect((yield* recovery.readDeliveryProjection).frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "StoppedAttemptClaimPlanningWait", reason: "TrackerTargetUnavailable" })
    )
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects attempt choices that are not exposed by the exact Run plan safe report and latest fingerprint", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const records = yield* (yield* JournalStore).read(runId)
    const withoutChoice = records.filter(({ event }) => event._tag !== "AttemptChoiceApplied")
    const makeChoice = (
      nonce: string,
      choiceSubject = subject,
      choice: "ContinueExistingAttempt" | "StopTaskImplementation" = "ContinueExistingAttempt",
      choiceRunId = runId
    ) =>
      AttemptChoiceAppliedEvent.make({
        choice,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: AttemptChoiceRequestId.make({ nonce, runId: choiceRunId }),
        subject: choiceSubject,
        version: workflowJournalEventVersion
      })
    const foreignAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("attempt-stop-foreign-plan")
    })
    const cases = [
      {
        detail: "binds run",
        records: recordsWithRows(withoutChoice, [
          forgedRow(
            "choice-foreign-run",
            makeChoice("choice-foreign-run", subject, "ContinueExistingAttempt", RunId.make("foreign-choice-run"))
          )
        ])
      },
      {
        detail: "has no prior matching planned attempt",
        records: recordsWithRows(withoutChoice, [
          forgedRow(
            "choice-foreign-plan",
            makeChoice("choice-foreign-plan", {
              observedTaskRevision: changedSpecification.fingerprint,
              plannedAttempt: foreignAttempt
            })
          )
        ])
      },
      {
        detail: "requires a latest exact safely-suspended executor report",
        records: recordsWithRows(
          withoutChoice.filter(
            ({ event }) =>
              event._tag !== "PlannedAttemptExecutorWorkReported" || event.report._tag !== "SafelySuspended"
          ),
          [forgedRow("choice-without-safe", makeChoice("choice-without-safe"))]
        )
      },
      {
        detail: "does not name the latest observed task fingerprint",
        records: recordsWithRows(withoutChoice, [
          forgedRow(
            "choice-stale-fingerprint",
            makeChoice("choice-stale-fingerprint", {
              observedTaskRevision: TaskRevision.make("attempt-stop-F3"),
              plannedAttempt
            })
          )
        ])
      },
      {
        detail: "follows the terminal Stop direction",
        records: recordsWithRows(records, [forgedRow("choice-after-stop", makeChoice("choice-after-stop"))])
      },
      {
        detail: "follows the winning direction",
        records: recordsWithRows(records, [
          forgedRow("choice-duplicate-subject", makeChoice("choice-duplicate-subject"))
        ])
      }
    ]

    for (const scenario of cases) {
      expect(invalidHistoryDetails(scenario.records)).toEqual(
        expect.arrayContaining([expect.stringContaining(scenario.detail)])
      )
    }
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("coalesces concurrent abandonment and treats later Stop observation as already complete", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const journal = yield* InRunJournal
    const initialReadCount = yield* Ref.make(0)
    const bothInitialReadsCompleted = yield* Deferred.make<void>()
    const synchronizedJournal = InRunJournal.of({
      append: journal.append,
      read: (readRunId) =>
        Effect.gen(function* () {
          const snapshot = yield* journal.read(readRunId)
          const count = yield* Ref.updateAndGet(initialReadCount, (current) => current + 1)
          if (count > 2) return snapshot
          if (count === 2) yield* Deferred.succeed(bothInitialReadsCompleted, undefined)
          yield* Deferred.await(bothInitialReadsCompleted)
          return snapshot
        })
    })
    const executor = PlannedAttemptExecutor.of({
      project: () => Effect.die("retained proof needs no projection"),
      requestSuspension: () => Effect.die("retained proof needs no suspension"),
      startOrContinue: () => Effect.die("unused continuation")
    })
    const outcomes = yield* Effect.all(
      [advanceAttemptStoppage(requestId, subject), advanceAttemptStoppage(requestId, subject)],
      { concurrency: "unbounded" }
    ).pipe(
      Effect.provideService(InRunJournal, synchronizedJournal),
      Effect.provideService(PlannedAttemptExecutor, executor)
    )

    expect(outcomes).toEqual([{ _tag: "AttemptImplementationAbandoned" }, { _tag: "AttemptImplementationAbandoned" }])
    expect(
      yield* advanceAttemptStoppage(requestId, subject).pipe(Effect.provideService(PlannedAttemptExecutor, executor))
    ).toEqual({ _tag: "AttemptImplementationAbandoned" })
    expect(
      yield* observeAttemptStoppageExecutor(requestId, subject).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor)
      )
    ).toEqual({ _tag: "AttemptImplementationAbandoned" })
    expect(
      (yield* (yield* JournalStore).read(runId)).filter(({ event }) => event._tag === "AttemptImplementationAbandoned")
    ).toHaveLength(1)
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects stopped-attempt events without their exact choice quiescence proof and claim", () =>
  Effect.gen(function* () {
    yield* appendExposedStop()
    const records = yield* (yield* JournalStore).read(runId)
    const foreignRequestId = AttemptChoiceRequestId.make({
      nonce: "attempt-stop-foreign-event",
      runId: RunId.make("attempt-stop-foreign-event-run")
    })
    const foreignClaim = ActiveTaskClaim.make({
      ...exactClaim,
      operationId: OperationId.make("attempt-stop-foreign-authority"),
      token: ClaimToken.make("attempt-stop-foreign-authority-token")
    })
    const abandonment = (
      proof: AttemptQuiescenceProof = AttemptQuiescenceProof.cases.CommandResponse.make({
        reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1)
      }),
      expectedClaim = exactClaim
    ) =>
      AttemptImplementationAbandonedEvent.make({
        expectedClaim,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        proof,
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    const laterCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const laterCommand = PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: laterCommandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
    const cases = [
      {
        detail: "requires its exact prior applied Stop choice",
        records: recordsWithRows(records, [
          forgedRow(
            "stoppage-without-choice",
            AttemptStoppageIntendedEvent.make({
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              requestId: foreignRequestId,
              subject,
              version: workflowJournalEventVersion
            })
          )
        ])
      },
      {
        detail: "requires its exact safe or terminal executor proof",
        records: recordsWithRows(records, [
          forgedRow(
            "abandonment-without-proof",
            abandonment(
              AttemptQuiescenceProof.cases.CommandResponse.make({
                reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(99)
              })
            )
          )
        ])
      },
      {
        detail: "follows a later executor command",
        records: recordsWithRows(records, [
          forgedRow("later-executor-command", laterCommand),
          forgedRow("abandonment-after-command", abandonment())
        ])
      },
      {
        detail: "requires its exact authorized claim",
        records: recordsWithRows(records, [
          forgedRow("abandonment-foreign-claim", abandonment(undefined, foreignClaim))
        ])
      },
      {
        detail: "no-release requires its exact prior abandonment",
        records: recordsWithRows(records, [
          forgedRow(
            "no-release-without-abandonment",
            StoppedAttemptClaimNoReleaseObservedEvent.make({
              expectedClaim: exactClaim,
              observation: UnclaimedTask.make({ taskId }),
              observationOperationId: OperationId.make("attempt-stop-unowned-no-release-read"),
              occurrenceClassification: "NonActionOccurrence",
              requestId,
              subject,
              version: workflowJournalEventVersion
            })
          )
        ])
      }
    ]

    for (const scenario of cases) {
      expect(invalidHistoryDetails(scenario.records)).toEqual(
        expect.arrayContaining([expect.stringContaining(scenario.detail)])
      )
    }
    const terminalOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    const terminalProofHistory = recordsWithRows(records, [
      forgedRow("terminal-proof-command", laterCommand),
      forgedRow(
        "terminal-proof-report",
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: terminalOrdinal,
          report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } }),
          version: workflowJournalEventVersion
        })
      ),
      forgedRow(
        "terminal-proof-abandonment",
        abandonment(AttemptQuiescenceProof.cases.CommandResponse.make({ reportOrdinal: terminalOrdinal }))
      )
    ])
    expect(invalidHistoryDetails(terminalProofHistory)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("requires its exact safe or terminal executor proof")])
    )
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("keeps Stop pending when a read-only executor projection still reports Running", () =>
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

    expect(
      yield* observeAttemptStoppageExecutor(requestId, subject).pipe(
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            project: () =>
              Effect.succeed(Option.some(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))),
            requestSuspension: () => Effect.die("read-only observation must not suspend"),
            startOrContinue: () => Effect.die("unused continuation")
          })
        )
      )
    ).toEqual({ _tag: "AttemptStoppagePending", executorState: "Running" })
  }).pipe(Effect.provide(attemptChoiceControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("shows a contradictory executor projection as an explicit Stop wait", () =>
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
    const recovery = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const projectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandProjectionObservedRecordKey(
        plannedAttempt.attemptId,
        commandOrdinal,
        projectionOrdinal
      ),
      PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal,
        observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorReportContradiction.make({
          observed: PlannedAttemptExecutorReport.cases.Running.make({
            correlation: { attemptId: AttemptId.make("attempt-stop-foreign-projection"), runId }
          })
        }),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal,
        version: workflowJournalEventVersion
      })
    )

    expect((yield* recovery.readDeliveryProjection).frontier.explanations).toContainEqual(
      expect.objectContaining({ _tag: "AttemptStoppageWait", reason: "ExecutorContradictory" })
    )
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

it.effect("reconciles a lost third suspension response before the bounded read-only Stop observation", () =>
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
    const executorWithLostThirdResponse = PlannedAttemptExecutor.of({
      project: () => Effect.succeed(Option.some(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))),
      requestSuspension: () =>
        Ref.updateAndGet(suspensionCalls, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 3
              ? Effect.die("third suspension response lost")
              : Effect.succeed(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
          )
        ),
      startOrContinue: () => Effect.die("unused continuation")
    })
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.andThen(advanceAttemptStoppage(requestId, subject)),
      Effect.provideService(PlannedAttemptExecutor, executorWithLostThirdResponse)
    )
    expect(
      (yield* advanceAttemptStoppage(requestId, subject).pipe(
        Effect.provideService(PlannedAttemptExecutor, executorWithLostThirdResponse),
        Effect.exit
      ))._tag
    ).toBe("Failure")

    const afterLostResponse = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const reconciliation = (yield* afterLostResponse.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "AdvanceAttemptStoppage"
    )
    expect(reconciliation).toMatchObject({ _tag: "AdvanceAttemptStoppage", requestId, subject })
    expect(
      (yield* afterLostResponse.readDeliveryProjection).frontier.transitions.some(
        ({ _tag }) => _tag === "ObserveAttemptStoppageExecutor"
      )
    ).toBe(false)
    yield* advanceAttemptStoppage(requestId, subject).pipe(
      Effect.provideService(PlannedAttemptExecutor, executorWithLostThirdResponse)
    )

    const afterCommandProjection = yield* makeJournaledFreshRunRecoveryProjection(runId)
    const observation = (yield* afterCommandProjection.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObserveAttemptStoppageExecutor"
    )
    expect(observation).toMatchObject({ _tag: "ObserveAttemptStoppageExecutor", requestId, subject })
    yield* observeAttemptStoppageExecutor(requestId, subject).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () =>
            Effect.succeed(Option.some(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))),
          requestSuspension: () => Effect.die("a fourth suspension command is forbidden"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      )
    )
    const records = yield* journal.read(runId)
    const lastSuspend = records.findLast(
      ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
    )
    const commandProjection = records.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
        event.commandOrdinal ===
          (lastSuspend?.event._tag === "PlannedAttemptExecutorCommandIntended" ? lastSuspend.event.ordinal : -1)
    )
    const stateProjection = records.findLast(({ event }) => event._tag === "PlannedAttemptExecutorStateObserved")

    expect(yield* Ref.get(suspensionCalls)).toBe(3)
    expect(
      records.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
      )
    ).toHaveLength(3)
    expect(commandProjection?.position).toBeGreaterThan(lastSuspend?.position ?? 0)
    expect(stateProjection?.position).toBeGreaterThan(commandProjection?.position ?? 0)
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
    const withoutObservation = recordsWithRows(yield* journal.read(runId), [
      forgedRow(
        "no-release-without-focused-observation",
        StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: UnclaimedTask.make({ taskId }),
          observationOperationId: missingOperationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ])
    expect(invalidHistoryDetails(withoutObservation)).toEqual(
      expect.arrayContaining([expect.stringContaining("latest exact post-baseline claim read")])
    )

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
    const duplicateNoRelease = recordsWithRows(records, [
      forgedRow(
        "duplicate-no-release",
        StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: UnclaimedTask.make({ taskId }),
          observationOperationId: claimRead.operationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        })
      )
    ])
    expect(invalidHistoryDetails(duplicateNoRelease)).toEqual(
      expect.arrayContaining([expect.stringContaining("claim disposition is already terminal")])
    )
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
    const forgedExactClaimNoRelease = recordsWithRows(records, [
      {
        event: StoppedAttemptClaimNoReleaseObservedEvent.make({
          expectedClaim: exactClaim,
          observation: exactClaim,
          observationOperationId: currentRead.operationId,
          occurrenceClassification: "NonActionOccurrence",
          requestId,
          subject,
          version: workflowJournalEventVersion
        }),
        key: stoppedAttemptClaimNoReleaseRecordKey(requestId)
      }
    ])
    expect(invalidHistoryDetails(forgedExactClaimNoRelease)).toEqual(
      expect.arrayContaining([expect.stringContaining("cannot preserve the exact owned claim")])
    )
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

    const noAppliedStopOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: exactRead.operationId,
        requestId: AttemptChoiceRequestId.make({ nonce: "attempt-stop-unapplied-release", runId })
      }),
      predecessorOperationIds: [exactClaim.operationId, exactRead.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-unapplied-release") }
    })
    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "unapplied-release-intent",
            TaskClaimReleaseIntendedEvent.make({
              operation: noAppliedStopOperation,
              version: workflowJournalEventVersion
            })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires its exact applied Stop")]))

    const beforeAbandonment = records.filter(({ event }) => event._tag !== "AttemptImplementationAbandoned")
    expect(invalidHistoryDetails(recordsWithRows(beforeAbandonment, [releaseIntentRow]))).toEqual(
      expect.arrayContaining([expect.stringContaining("precedes implementation abandonment")])
    )

    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("attempt-stop-release-foreign-claim"),
      owner: exactClaim.owner,
      taskId,
      token: ClaimToken.make("attempt-stop-release-foreign-token")
    })
    const foreignClaimRelease = makeTaskClaimReleaseOperation({
      authority: releaseOperation.authority,
      predecessorOperationIds: [foreignClaim.operationId, exactRead.operationId],
      release: { claim: foreignClaim, operationId: OperationId.make("attempt-stop-release-foreign") }
    })
    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "foreign-claim-release-intent",
            TaskClaimReleaseIntendedEvent.make({ operation: foreignClaimRelease, version: workflowJournalEventVersion })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("contradicts its authorized claim")]))

    const workflowRelease = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [exactClaim.operationId],
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-workflow-release") }
    })
    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "workflow-release-intent",
            TaskClaimReleaseIntendedEvent.make({ operation: workflowRelease, version: workflowJournalEventVersion })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires explicit stopped-attempt authority")]))
    const workflowReleaseIntentRow = forgedRow(
      "workflow-release-intent-for-outcome",
      TaskClaimReleaseIntendedEvent.make({ operation: workflowRelease, version: workflowJournalEventVersion })
    )
    const workflowReleasedRow = forgedRow(
      "workflow-release-outcome",
      TaskClaimReleasedEvent.make({ release: workflowRelease.release, version: workflowJournalEventVersion })
    )
    expect(
      invalidHistoryDetails(recordsWithRows(records, [workflowReleaseIntentRow, workflowReleasedRow, releaseIntentRow]))
    ).toEqual(expect.arrayContaining([expect.stringContaining("requires explicit stopped-attempt authority")]))

    const withoutPostAbandonmentClaimRead = records.filter(
      ({ event }) =>
        !(
          (event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === exactRead.operationId) ||
          (event._tag === "TaskTrackerFactsObserved" && event.operationId === exactRead.operationId)
        )
    )
    expect(invalidHistoryDetails(recordsWithRows(withoutPostAbandonmentClaimRead, [releaseIntentRow]))).toEqual(
      expect.arrayContaining([expect.stringContaining("requires its latest exact post-abandonment claim read")])
    )

    expect(
      invalidHistoryDetails(
        recordsWithRows(records, [
          forgedRow(
            "unapplied-release-intent-for-outcome",
            TaskClaimReleaseIntendedEvent.make({
              operation: noAppliedStopOperation,
              version: workflowJournalEventVersion
            })
          ),
          forgedRow(
            "unapplied-release-outcome",
            TaskClaimReleasedEvent.make({
              release: noAppliedStopOperation.release,
              version: workflowJournalEventVersion
            })
          )
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("has no exact prior abandonment")]))

    const duplicateOperation = makeTaskClaimReleaseOperation({
      authority: releaseOperation.authority,
      predecessorOperationIds: releaseOperation.predecessorOperationIds,
      release: { claim: exactClaim, operationId: OperationId.make("attempt-stop-duplicate-release") }
    })
    const releasedRow = {
      event: TaskClaimReleasedEvent.make({ release: releaseOperation.release, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(releaseOperation.release.operationId)
    }
    const duplicateIntentRow = {
      event: TaskClaimReleaseIntendedEvent.make({
        operation: duplicateOperation,
        version: workflowJournalEventVersion
      }),
      key: intentRecordKey(duplicateOperation.release.operationId)
    }
    const duplicateReleasedRow = {
      event: TaskClaimReleasedEvent.make({ release: duplicateOperation.release, version: workflowJournalEventVersion }),
      key: outcomeRecordKey(duplicateOperation.release.operationId)
    }
    const duplicate = recordsWithRows(intended, [duplicateIntentRow])
    expect(reduceWorkflowJournalHistory(runId, duplicate)).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("already has one durable intent") })
      ])
    })

    expect(invalidHistoryDetails(recordsWithRows(intended, [releasedRow, duplicateIntentRow]))).toEqual(
      expect.arrayContaining([expect.stringContaining("claim disposition is already terminal")])
    )
    expect(
      invalidHistoryDetails(recordsWithRows(intended, [releasedRow, duplicateIntentRow, duplicateReleasedRow]))
    ).toEqual(expect.arrayContaining([expect.stringContaining("claim disposition is already terminal")]))

    expect(
      invalidHistoryDetails(
        recordsWithRows(beforeAbandonment, [
          releaseIntentRow,
          {
            event: TaskClaimReleasedEvent.make({
              release: releaseOperation.release,
              version: workflowJournalEventVersion
            }),
            key: outcomeRecordKey(releaseOperation.release.operationId)
          }
        ])
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining("has no exact prior abandonment")]))

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
