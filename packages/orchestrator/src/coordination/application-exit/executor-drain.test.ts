import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorService,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Deferred, Effect, Fiber, Layer, Option, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { InRunJournal, JournalStore, type JournalRecord } from "../../workflow-journal/store.js"
import type { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { OperationId } from "../../workflow/identity.js"
import { ActiveTaskClaim, TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makePlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { liveJournalTestLayer } from "../delivery/live-journal-test-layer.js"
import { Journal, journalLayer } from "../delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { memoryJournalStoreLayerFromPartitionRecords } from "../../workflow-journal/adapters/memory-store.js"
import { makeExecutingAttemptHistory } from "../../../test/support/executing-attempt-history.js"
import { type ApplicationExitTraceEvent, makeApplicationExitShell } from "./application-shell.js"
import { ApplicationExitResult } from "./lifecycle-decision.js"
import {
  ExecutingAttemptForApplicationExit,
  executingAttemptsForApplicationExit,
  suspendApplicationExitAttempts,
  suspendExecutingExecutorWorkForApplicationExit
} from "./executor-drain.js"

const taskSpecification = makeTaskWorkSpecification({ body: "Complete task A.", taskId: TaskId.make("A"), title: "A" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("exit-attempt-A"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/exit-attempt-A"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("exit-run"),
  taskId: TaskId.make("A"),
  taskRevision: TaskRevision.make(taskSpecification.fingerprint),
  worktree: WorktreeLocator.make("/worktrees/exit-attempt-A")
})
const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
const taskSpecificationB = makeTaskWorkSpecification({ body: "Complete task B.", taskId: TaskId.make("B"), title: "B" })
const plannedAttemptB = PlannedTaskAttempt.make({
  ...plannedAttempt,
  attemptId: AttemptId.make("exit-attempt-B"),
  branch: TaskBranchRef.make("refs/heads/dalph/exit-attempt-B"),
  taskId: TaskId.make("B"),
  taskRevision: TaskRevision.make(taskSpecificationB.fingerprint),
  worktree: WorktreeLocator.make("/worktrees/exit-attempt-B")
})
const trackerTarget = FixtureTarget.make("exit-target")
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("exit-claim-A"),
  owner: ClaimOwner.make("exit-owner"),
  taskId: plannedAttempt.taskId,
  token: ClaimToken.make("exit-token-A")
})
const activeClaimB = ActiveTaskClaim.make({
  operationId: OperationId.make("exit-claim-B"),
  owner: ClaimOwner.make("exit-owner"),
  taskId: plannedAttemptB.taskId,
  token: ClaimToken.make("exit-token-B")
})
const executingHistory = makeExecutingAttemptHistory({
  activeClaim,
  initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) }),
  plannedAttempt,
  runId: plannedAttempt.runId,
  taskSpecification,
  trackerTarget
})
const twoAttemptExecutingHistory = makeExecutingAttemptHistory({
  activeClaim: activeClaimB,
  plannedAttempt: plannedAttemptB,
  priorRecords: executingHistory.records,
  runId: plannedAttempt.runId,
  taskSpecification: taskSpecificationB,
  trackerTarget
})

const liveExecutingJournalLayer = (records: ReadonlyArray<JournalRecord> = executingHistory.records) =>
  liveJournalTestLayer({ records, runId: plannedAttempt.runId, target: trackerTarget })

const protocolLayer = (executor: PlannedAttemptExecutorService) =>
  Layer.merge(Layer.succeed(PlannedAttemptExecutor, executor), plannedAttemptProtocolControllerLayer)

const failedJournalTestLayer = Layer.unwrap(
  Effect.gen(function* () {
    const store = yield* JournalStore
    const initial = reduceWorkflowJournalHistory(plannedAttempt.runId, executingHistory.records)
    if (initial._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(initial)
    return journalLayer(plannedAttempt.runId, trackerTarget, initial, {
      append: (runId, key, event) =>
        store
          .append(runId, key, event)
          .pipe(
            Effect.map((acknowledged) => ({ ...acknowledged, key: JournalRecordKey.make("malformed-acknowledgement") }))
          ),
      read: store.read,
      terminateRun: store.terminateRun
    })
  })
).pipe(Layer.provideMerge(memoryJournalStoreLayerFromPartitionRecords({ hot: executingHistory.records })))

const observedJournalTestLayer = (accepted: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* JournalStore
      const initial = reduceWorkflowJournalHistory(plannedAttempt.runId, executingHistory.records)
      if (initial._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(initial)
      return journalLayer(plannedAttempt.runId, trackerTarget, initial, store, (record) =>
        Ref.update(accepted, (current) => [...current, record])
      )
    })
  ).pipe(Layer.provideMerge(memoryJournalStoreLayerFromPartitionRecords({ hot: executingHistory.records })))

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`exit-executor-${position}`),
  position: JournalPosition.make(position),
  runId: plannedAttempt.runId
})

const appendRecord = (records: ReadonlyArray<JournalRecord>, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(records.length + 1),
  runId: plannedAttempt.runId
})

const runningHistory = (): ReadonlyArray<JournalRecord> => [
  record(
    1,
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  ),
  record(
    2,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
      version: workflowJournalEventVersion
    })
  )
]

const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
  beganAt: JournalPosition.make(1),
  plannedAttempt
})

const unusedExecutor = PlannedAttemptExecutor.of({
  observe: () => Effect.die("this scenario must not observe executor state"),
  requestSuspension: () => Effect.die("this scenario must not request executor suspension"),
  begin: () => Effect.die("this scenario must not begin executor work"),
  resume: () => Effect.die("this scenario must not resume executor work")
})

it("discovers the exact running planned attempt from accepted Run history without another identity", () => {
  expect(
    executingAttemptsForApplicationExit({ records: runningHistory(), responsibilities: [responsibility] })
  ).toEqual([ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })])
})

it("retains an accepted executing attempt while a distinct safe observation still awaits lifecycle acceptance", () => {
  const records = [
    ...runningHistory(),
    record(
      3,
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
        }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  ]

  expect(executingAttemptsForApplicationExit({ records, responsibilities: [responsibility] })).toEqual([
    ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
  ])
})

it("ignores non-executor responsibilities and exact attempts without current Executing evidence", () => {
  const claimResponsibility = WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
    acquisition: TaskClaimAcquisition.make({
      operationId: OperationId.make("exit-claim-operation"),
      owner: ClaimOwner.make("exit-claim-owner"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("exit-claim-token")
    }),
    beganAt: JournalPosition.make(1),
    taskId: plannedAttempt.taskId
  })
  const responsibilityOnly = runningHistory().slice(0, 1)

  expect(
    executingAttemptsForApplicationExit({
      records: responsibilityOnly,
      responsibilities: [claimResponsibility, responsibility]
    })
  ).toEqual([])
})

it.effect("maps a failed Run-journal state read to one application Exit drain diagnostic", () =>
  Effect.gen(function* () {
    const journal = yield* Journal
    const command = PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(2),
      plannedAttempt,
      version: workflowJournalEventVersion
    })
    const journalFailure = yield* journal
      .append(plannedAttempt.runId, describeJournalEvent(command).expectedKey, command)
      .pipe(Effect.flip)
    expect(journalFailure).toMatchObject({ _tag: "JournalHistoryInvalid" })
    const failure = yield* suspendExecutingExecutorWorkForApplicationExit().pipe(
      Effect.flip,
      Effect.provide(protocolLayer(unusedExecutor))
    )

    expect(failure).toMatchObject({
      _tag: "ApplicationExitDrainFailure",
      diagnostics: [expect.stringContaining("JournalHistoryInvalid")]
    })
  }).pipe(Effect.provide(failedJournalTestLayer))
)

it.effect("records the exact suspension intent before the fast call and records safe evidence afterward", () =>
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("application Exit must not observe fresh executor state"),
      requestSuspension: (attempt) =>
        Ref.update(calls, (current) => [...current, `Suspend:${attempt.runId}/${attempt.attemptId}`]).pipe(
          Effect.as(
            PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
          )
        ),
      begin: () => Effect.die("application Exit must not begin executor work"),
      resume: () => Effect.die("application Exit must not resume executor work")
    })

    yield* suspendApplicationExitAttempts([
      ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
    ]).pipe(Effect.provide(protocolLayer(executor)))

    expect(yield* Ref.get(calls)).toEqual([`Suspend:${plannedAttempt.runId}/${plannedAttempt.attemptId}`])
    expect(
      (yield* journal.read(plannedAttempt.runId)).slice(executingHistory.records.length).map(({ event }) => event._tag)
    ).toEqual([
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved",
      "PlannedAttemptExecutorWorkReported"
    ])
  }).pipe(Effect.provide(liveExecutingJournalLayer()))
)

it.effect("accepts an exact Terminal suspension response as the attempt's safe Exit boundary", () =>
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("application Exit must not observe executor state"),
      requestSuspension: () =>
        Effect.succeed(
          PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } })
        ),
      begin: () => Effect.die("application Exit must not begin executor work"),
      resume: () => Effect.die("application Exit must not resume executor work")
    })

    const safe = yield* suspendApplicationExitAttempts([
      ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
    ]).pipe(Effect.provide(protocolLayer(executor)))
    expect(safe).toEqual([correlation])
    expect(
      (yield* journal.read(plannedAttempt.runId)).some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
      )
    ).toBe(true)
  }).pipe(Effect.provide(liveExecutingJournalLayer()))
)

it.effect("requests suspension for every running exact planned attempt retained by the Run", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("application Exit must not observe executor state"),
      requestSuspension: (attempt) =>
        Ref.update(calls, (current) => [...current, attempt.attemptId]).pipe(
          Effect.as(
            PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
          )
        ),
      begin: () => Effect.die("application Exit must not begin executor work"),
      resume: () => Effect.die("application Exit must not resume executor work")
    })

    const safe = yield* suspendApplicationExitAttempts([
      ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt }),
      ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt: plannedAttemptB })
    ]).pipe(Effect.provide(protocolLayer(executor)))

    expect(new Set(yield* Ref.get(calls))).toEqual(new Set([plannedAttempt.attemptId, plannedAttemptB.attemptId]))
    expect(new Set(safe.map(({ attemptId }) => attemptId))).toEqual(
      new Set([plannedAttempt.attemptId, plannedAttemptB.attemptId])
    )
  }).pipe(Effect.provide(liveExecutingJournalLayer(twoAttemptExecutingHistory.records)))
)

it.effect("rejects a foreign suspension report and records the contradiction without releasing safety", () =>
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const foreignCorrelation = { ...correlation, attemptId: AttemptId.make("foreign-exit-attempt") }
    const executor = PlannedAttemptExecutor.of({
      observe: () => Effect.die("application Exit must not observe executor state"),
      requestSuspension: () =>
        Effect.succeed(
          PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation: foreignCorrelation })
        ),
      begin: () => Effect.die("application Exit must not begin executor work"),
      resume: () => Effect.die("application Exit must not resume executor work")
    })

    const failure = yield* suspendApplicationExitAttempts([
      ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
    ]).pipe(Effect.provide(protocolLayer(executor)), Effect.flip)

    expect(failure).toMatchObject({
      _tag: "ApplicationExitDrainFailure",
      diagnostics: [expect.stringContaining("PlannedAttemptExecutorCorrelationMismatch")]
    })
    expect(
      (yield* journal.read(plannedAttempt.runId)).slice(executingHistory.records.length).map(({ event }) => event._tag)
    ).toEqual(["PlannedAttemptExecutorCommandIntended", "PlannedAttemptExecutorCommandResponseContradicted"])
  }).pipe(Effect.provide(liveExecutingJournalLayer()))
)

it.effect("retains an acknowledged suspension intent when the fast call has no response", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const accepted = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
      yield* Effect.gen(function* () {
        const called = yield* Deferred.make<void>()
        const executor = PlannedAttemptExecutor.of({
          observe: () => Effect.die("application Exit must not observe executor state for an unresolved command"),
          requestSuspension: () => Deferred.succeed(called, undefined).pipe(Effect.andThen(Effect.never)),
          begin: () => Effect.die("application Exit must not begin executor work"),
          resume: () => Effect.die("application Exit must not resume executor work")
        })
        const draining = yield* suspendApplicationExitAttempts([
          ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
        ]).pipe(Effect.provide(protocolLayer(executor)), Effect.forkChild)
        yield* Deferred.await(called)

        expect((yield* Ref.get(accepted)).map(({ event }) => event._tag)).toEqual([
          "PlannedAttemptExecutorCommandIntended"
        ])
        yield* Fiber.interrupt(draining)
        expect((yield* Ref.get(accepted)).map(({ event }) => event._tag)).toEqual([
          "PlannedAttemptExecutorCommandIntended"
        ])
      }).pipe(Effect.provide(observedJournalTestLayer(accepted)))
    })
  )
)

it.effect("does not retry or project an already-unresolved executor command during Exit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const unresolvedEvent = PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Suspend",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: PlannedAttemptExecutorCommandOrdinal.make(2),
        plannedAttempt,
        version: workflowJournalEventVersion
      })
      const unresolved = [...executingHistory.records, appendRecord(executingHistory.records, unresolvedEvent)]
      const journal = yield* InRunJournal
      const attempt = executingAttemptsForApplicationExit({ records: unresolved, responsibilities: [responsibility] })
      expect(attempt).toEqual([ExecutingAttemptForApplicationExit.ExecutorCommandAlreadyUnresolved({ plannedAttempt })])
      const executor = PlannedAttemptExecutor.of({
        observe: () => Effect.die("application Exit must not observe an already-unresolved executor command"),
        requestSuspension: () => Effect.die("application Exit must not issue suspension behind an unresolved command"),
        begin: () => Effect.die("application Exit must not begin executor work"),
        resume: () => Effect.die("application Exit must not resume executor work")
      })
      // Simulate discovery racing just ahead of the unmatched intent: the guarded protocol must still refuse projection.
      const draining = yield* suspendApplicationExitAttempts([
        ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
      ]).pipe(Effect.provide(protocolLayer(executor)), Effect.forkChild)
      yield* Effect.yieldNow

      expect(yield* journal.read(plannedAttempt.runId)).toEqual(unresolved)
      yield* Fiber.interrupt(draining)
    })
  ).pipe(
    Effect.provide(
      liveExecutingJournalLayer([
        ...executingHistory.records,
        appendRecord(
          executingHistory.records,
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Suspend",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: PlannedAttemptExecutorCommandOrdinal.make(2),
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
      ])
    )
  )
)

it.effect("keeps an already-classified unresolved executor command pending for the original Exit deadline", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const draining = yield* suspendApplicationExitAttempts([
        ExecutingAttemptForApplicationExit.ExecutorCommandAlreadyUnresolved({ plannedAttempt })
      ]).pipe(Effect.provide(protocolLayer(unusedExecutor)), Effect.forkChild)
      yield* Effect.yieldNow

      expect(draining.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(draining)
    })
  ).pipe(Effect.provide(liveExecutingJournalLayer()))
)

it.effect("waits for the exact attempt permit before a concurrent Exit suspension can enter", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const reserved = yield* controller.reserve(correlation)
    expect(Option.isSome(reserved)).toBe(true)
    if (Option.isNone(reserved)) return
    const entered = yield* Deferred.make<void>()
    const waiting = yield* controller
      .withPermit(correlation, () => Deferred.succeed(entered, undefined))
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(entered)).toBe(false)

    yield* reserved.value.release
    yield* Fiber.join(waiting)
    expect(yield* Deferred.isDone(entered)).toBe(true)
  })
)

const executingExecutorExitAuthoredCassette = [
  "ExitRequested",
  "AdmissionCutoffClosed",
  "ProcessLocalResourcesClosed",
  "ExecutingExecutorWorkReachedSafeBoundary",
  "ProducedJournalWritesFlushed",
  "CoordinatorLockReleased",
  "ExitResultReported",
  "ProcessEndRequested"
] as const

it.effect("Alice exits successfully only after the running exact attempt is safely suspended", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const lifecycleCassette = yield* Ref.make<ReadonlyArray<ApplicationExitTraceEvent>>([])
      const executor = PlannedAttemptExecutor.of({
        observe: () => Effect.die("application Exit must not observe executor state"),
        requestSuspension: (attempt) =>
          Effect.succeed(
            PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
          ),
        begin: () => Effect.die("application Exit must not begin executor work"),
        resume: () => Effect.die("application Exit must not resume executor work")
      })
      const journalContext = yield* Effect.context<AcceptedJournalReader | InRunJournal>()
      const executorDrain = suspendApplicationExitAttempts([
        ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
      ]).pipe(Effect.provide(protocolLayer(executor)), Effect.provide(journalContext))
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void },
        { emit: (event) => Ref.update(lifecycleCassette, (current) => [...current, event]) }
      )
      yield* shell.registerExecutorDrain({ suspendExecutingExecutorWork: executorDrain })

      expect(yield* shell.requestBoundary.requestExit).toEqual(
        ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })
      )
      expect((yield* Ref.get(lifecycleCassette)).map(({ _tag }) => _tag)).toEqual(executingExecutorExitAuthoredCassette)
      expect(yield* Ref.get(lifecycleCassette)).toContainEqual({
        _tag: "ExecutingExecutorWorkReachedSafeBoundary",
        correlations: [correlation]
      })
      expect(
        (yield* journal.read(plannedAttempt.runId))
          .slice(executingHistory.records.length)
          .map(({ event }) => event._tag)
      ).toEqual([
        "PlannedAttemptExecutorCommandIntended",
        "PlannedAttemptExecutorCommandResponseObserved",
        "PlannedAttemptExecutorWorkReported"
      ])
    })
  ).pipe(Effect.provide(liveExecutingJournalLayer()))
)

it.effect("Alice receives timeout when the suspension response still reports the attempt running", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const suspensionReturned = yield* Deferred.make<void>()
      const executor = PlannedAttemptExecutor.of({
        observe: () => Effect.die("application Exit must not observe executor state"),
        requestSuspension: () =>
          Deferred.succeed(suspensionReturned, undefined).pipe(
            Effect.as(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
          ),
        begin: () => Effect.die("application Exit must not begin executor work"),
        resume: () => Effect.die("application Exit must not resume executor work")
      })
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      const journalContext = yield* Effect.context<AcceptedJournalReader | InRunJournal>()
      yield* shell.registerExecutorDrain({
        suspendExecutingExecutorWork: suspendApplicationExitAttempts([
          ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
        ]).pipe(Effect.provide(protocolLayer(executor)), Effect.provide(journalContext))
      })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(suspensionReturned)
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })
      )
      expect(
        (yield* journal.read(plannedAttempt.runId))
          .slice(executingHistory.records.length)
          .map(({ event }) => event._tag)
      ).toEqual(["PlannedAttemptExecutorCommandIntended", "PlannedAttemptExecutorCommandResponseObserved"])
      expect(
        (yield* journal.read(plannedAttempt.runId)).some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkSafelySuspended"
        )
      ).toBe(false)
    })
  ).pipe(Effect.provide(liveExecutingJournalLayer()))
)
