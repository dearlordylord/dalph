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
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { type ApplicationExitTraceEvent, makeApplicationExitShell } from "./application-shell.js"
import { ApplicationExitResult } from "./lifecycle-decision.js"
import {
  RunningAttemptForApplicationExit,
  runningAttemptsForApplicationExit,
  suspendApplicationExitAttempts
} from "./executor-drain.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("exit-attempt-A"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/exit-attempt-A"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("exit-run"),
  taskId: TaskId.make("A"),
  taskRevision: TaskRevision.make("task-A-revision"),
  worktree: WorktreeLocator.make("/worktrees/exit-attempt-A")
})
const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
const plannedAttemptB = PlannedTaskAttempt.make({
  ...plannedAttempt,
  attemptId: AttemptId.make("exit-attempt-B"),
  branch: TaskBranchRef.make("refs/heads/dalph/exit-attempt-B"),
  taskId: TaskId.make("B"),
  taskRevision: TaskRevision.make("task-B-revision"),
  worktree: WorktreeLocator.make("/worktrees/exit-attempt-B")
})
const correlationB = plannedAttemptExecutorCorrelation(plannedAttemptB)

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`exit-executor-${position}`),
  position: JournalPosition.make(position),
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
      report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      version: workflowJournalEventVersion
    })
  )
]

const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
  beganAt: JournalPosition.make(1),
  plannedAttempt
})

it("discovers the exact running planned attempt from accepted Run history without another identity", () => {
  expect(runningAttemptsForApplicationExit({ records: runningHistory(), responsibilities: [responsibility] })).toEqual([
    RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
  ])
})

const journalLayer = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  Layer.succeed(
    InRunJournal,
    InRunJournal.of({
      append: (runId, key, event) =>
        Ref.modify(records, (current) => {
          const appended = {
            event,
            key,
            position: JournalPosition.make(current.length + 1),
            runId
          } satisfies JournalRecord
          return [appended, [...current, appended]] as const
        }),
      read: () => Ref.get(records)
    })
  )

it.effect("records the exact suspension intent before the fast call and records safe evidence afterward", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make(runningHistory())
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const executor = PlannedAttemptExecutor.of({
      project: () => Effect.die("application Exit must not reconcile a fresh executor projection"),
      requestSuspension: (attempt) =>
        Ref.update(calls, (current) => [...current, `Suspend:${attempt.runId}/${attempt.attemptId}`]).pipe(
          Effect.as(
            PlannedAttemptExecutorReport.cases.SafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
          )
        ),
      startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
    })

    yield* suspendApplicationExitAttempts([
      RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
    ]).pipe(
      Effect.provide(
        Layer.mergeAll(
          journalLayer(records),
          Layer.succeed(PlannedAttemptExecutor, executor),
          plannedAttemptProtocolControllerLayer
        )
      )
    )

    expect(yield* Ref.get(calls)).toEqual([`Suspend:${plannedAttempt.runId}/${plannedAttempt.attemptId}`])
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorWorkReported"
    ])
  })
)

it.effect("accepts an exact Terminal suspension response as the attempt's safe Exit boundary", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make(runningHistory())
    const executor = PlannedAttemptExecutor.of({
      project: () => Effect.die("application Exit must not start fresh executor reconciliation"),
      requestSuspension: () =>
        Effect.succeed(
          PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        ),
      startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
    })

    const safe = yield* suspendApplicationExitAttempts([
      RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
    ]).pipe(
      Effect.provide(
        Layer.mergeAll(
          journalLayer(records),
          Layer.succeed(PlannedAttemptExecutor, executor),
          plannedAttemptProtocolControllerLayer
        )
      )
    )
    expect(safe).toEqual([correlation])
    expect(
      (yield* Ref.get(records)).some(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Terminal"
      )
    ).toBe(true)
  })
)

it.effect("requests suspension for every running exact planned attempt retained by the Run", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      ...runningHistory(),
      record(
        3,
        PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt: plannedAttemptB,
          version: workflowJournalEventVersion
        })
      ),
      record(
        4,
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation: correlationB }),
          version: workflowJournalEventVersion
        })
      )
    ])
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const executor = PlannedAttemptExecutor.of({
      project: () => Effect.die("application Exit must not start fresh executor reconciliation"),
      requestSuspension: (attempt) =>
        Ref.update(calls, (current) => [...current, attempt.attemptId]).pipe(
          Effect.as(
            PlannedAttemptExecutorReport.cases.SafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
          )
        ),
      startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
    })

    const safe = yield* suspendApplicationExitAttempts([
      RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt }),
      RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt: plannedAttemptB })
    ]).pipe(
      Effect.provide(
        Layer.mergeAll(
          journalLayer(records),
          Layer.succeed(PlannedAttemptExecutor, executor),
          plannedAttemptProtocolControllerLayer
        )
      )
    )

    expect(new Set(yield* Ref.get(calls))).toEqual(new Set([plannedAttempt.attemptId, plannedAttemptB.attemptId]))
    expect(new Set(safe.map(({ attemptId }) => attemptId))).toEqual(
      new Set([plannedAttempt.attemptId, plannedAttemptB.attemptId])
    )
  })
)

it.effect("rejects a foreign suspension report and records the contradiction without releasing safety", () =>
  Effect.gen(function* () {
    const records = yield* Ref.make(runningHistory())
    const foreignCorrelation = { ...correlation, attemptId: AttemptId.make("foreign-exit-attempt") }
    const executor = PlannedAttemptExecutor.of({
      project: () => Effect.die("application Exit must not start fresh executor reconciliation"),
      requestSuspension: () =>
        Effect.succeed(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation: foreignCorrelation })),
      startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
    })

    const failure = yield* suspendApplicationExitAttempts([
      RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
    ]).pipe(
      Effect.provide(
        Layer.mergeAll(
          journalLayer(records),
          Layer.succeed(PlannedAttemptExecutor, executor),
          plannedAttemptProtocolControllerLayer
        )
      ),
      Effect.flip
    )

    expect(failure).toMatchObject({
      _tag: "ApplicationExitDrainFailure",
      diagnostics: [expect.stringContaining("PlannedAttemptExecutorCorrelationMismatch")]
    })
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseContradicted"
    ])
  })
)

it.effect("retains an acknowledged suspension intent when the fast call has no response", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const records = yield* Ref.make(runningHistory())
      const called = yield* Deferred.make<void>()
      const executor = PlannedAttemptExecutor.of({
        project: () => Effect.die("application Exit must not reconcile an unresolved command"),
        requestSuspension: () => Deferred.succeed(called, undefined).pipe(Effect.andThen(Effect.never)),
        startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
      })
      const draining = yield* suspendApplicationExitAttempts([
        RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
      ]).pipe(
        Effect.provide(
          Layer.mergeAll(
            journalLayer(records),
            Layer.succeed(PlannedAttemptExecutor, executor),
            plannedAttemptProtocolControllerLayer
          )
        ),
        Effect.forkChild
      )
      yield* Deferred.await(called)

      expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorWorkReported",
        "PlannedAttemptExecutorCommandIntended"
      ])
      yield* Fiber.interrupt(draining)
      expect((yield* Ref.get(records)).some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(
        true
      )
      expect(
        (yield* Ref.get(records)).filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
      ).toHaveLength(1)
    })
  )
)

it.effect("does not retry or project an already-unresolved executor command during Exit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const unresolved = [
        ...runningHistory(),
        record(
          3,
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "StartOrContinue",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
      ]
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(unresolved)
      const attempt = runningAttemptsForApplicationExit({ records: unresolved, responsibilities: [responsibility] })
      expect(attempt).toEqual([RunningAttemptForApplicationExit.ExecutorCommandAlreadyUnresolved({ plannedAttempt })])
      const executor = PlannedAttemptExecutor.of({
        project: () => Effect.die("application Exit must not project an already-unresolved executor command"),
        requestSuspension: () => Effect.die("application Exit must not issue suspension behind an unresolved command"),
        startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
      })
      // Simulate discovery racing just ahead of the unmatched intent: the guarded protocol must still refuse projection.
      const draining = yield* suspendApplicationExitAttempts([
        RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
      ]).pipe(
        Effect.provide(
          Layer.mergeAll(
            journalLayer(records),
            Layer.succeed(PlannedAttemptExecutor, executor),
            plannedAttemptProtocolControllerLayer
          )
        ),
        Effect.forkChild
      )
      yield* Effect.yieldNow

      expect(yield* Ref.get(records)).toEqual(unresolved)
      yield* Fiber.interrupt(draining)
    })
  )
)

const runningExecutorExitAuthoredCassette = [
  "ExitRequested",
  "AdmissionCutoffClosed",
  "RunningExecutorWorkReachedSafeBoundary",
  "ProducedJournalWritesFlushed",
  "ProcessLocalResourcesClosed",
  "CoordinatorLockReleased",
  "ExitResultReported",
  "ProcessEndRequested"
] as const

it.effect("Alice exits successfully only after the running exact attempt is safely suspended", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const records = yield* Ref.make(runningHistory())
      const lifecycleCassette = yield* Ref.make<ReadonlyArray<ApplicationExitTraceEvent>>([])
      const executor = PlannedAttemptExecutor.of({
        project: () => Effect.die("application Exit must not start fresh executor reconciliation"),
        requestSuspension: (attempt) =>
          Effect.succeed(
            PlannedAttemptExecutorReport.cases.SafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
          ),
        startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
      })
      const executorDrain = suspendApplicationExitAttempts([
        RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
      ]).pipe(
        Effect.provide(
          Layer.mergeAll(
            journalLayer(records),
            Layer.succeed(PlannedAttemptExecutor, executor),
            plannedAttemptProtocolControllerLayer
          )
        )
      )
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void },
        { emit: (event) => Ref.update(lifecycleCassette, (current) => [...current, event]) }
      )
      yield* shell.registerExecutorDrain({ suspendRunningExecutorWork: executorDrain })

      expect(yield* shell.requestBoundary.requestExit).toEqual(
        ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })
      )
      expect((yield* Ref.get(lifecycleCassette)).map(({ _tag }) => _tag)).toEqual(runningExecutorExitAuthoredCassette)
      expect(yield* Ref.get(lifecycleCassette)).toContainEqual({
        _tag: "RunningExecutorWorkReachedSafeBoundary",
        correlations: [correlation]
      })
      expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorWorkReported",
        "PlannedAttemptExecutorCommandIntended",
        "PlannedAttemptExecutorWorkReported"
      ])
    })
  )
)

it.effect("Alice receives timeout when the suspension response still reports the attempt running", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const records = yield* Ref.make(runningHistory())
      const suspensionReturned = yield* Deferred.make<void>()
      const executor = PlannedAttemptExecutor.of({
        project: () => Effect.die("application Exit must not start fresh executor reconciliation"),
        requestSuspension: () =>
          Deferred.succeed(suspensionReturned, undefined).pipe(
            Effect.as(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
          ),
        startOrContinue: () => Effect.die("application Exit must not ask executor work to finish")
      })
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: suspendApplicationExitAttempts([
          RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
        ]).pipe(
          Effect.provide(
            Layer.mergeAll(
              journalLayer(records),
              Layer.succeed(PlannedAttemptExecutor, executor),
              plannedAttemptProtocolControllerLayer
            )
          )
        )
      })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(suspensionReturned)
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })
      )
      expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorWorkReported",
        "PlannedAttemptExecutorCommandIntended",
        "PlannedAttemptExecutorWorkReported"
      ])
      expect(
        (yield* Ref.get(records)).some(
          ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "SafelySuspended"
        )
      ).toBe(false)
    })
  )
)
