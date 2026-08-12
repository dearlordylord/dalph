/* eslint-disable import/no-nodejs-modules -- This executable fixture is the intentional real Node/Linux host boundary. */
import { appendFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import nodeProcess from "node:process"
import { setImmediate as scheduleNextTurn } from "node:timers"
import { NodeServices } from "@effect/platform-node"
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
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  CoordinatorLock,
  GitCommonDirectoryTarget,
  InRunJournal,
  JournalPosition,
  JournalRecordKey,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  RunningAttemptForApplicationExit,
  nodeCoordinatorLockLayer,
  plannedAttemptProtocolControllerLayer,
  suspendApplicationExitAttempts,
  workflowJournalEventVersion,
  type JournalRecord,
  type ApplicationExitTraceEvent
} from "@dalph/orchestrator"
import { Effect, Layer, Ref } from "effect"
import {
  makeLinuxSupervisorApplicationExitHost,
  nodeApplicationHostProcessBoundary
} from "../../src/application/supervisor-exit.ts"

const usageErrorStatus = 64
const fixtureFailureStatus = 70
const gitCommitShaLength = 40
const runningReportPosition = 2
const mode = nodeProcess.argv[2]
const gitCommonDirectory = nodeProcess.argv[3]
const journalPath = nodeProcess.argv[4]

if (mode === undefined || gitCommonDirectory === undefined) {
  nodeProcess.stderr.write("usage: linux-application-exit-host <mode> <git-common-directory> [journal]\n")
  nodeProcess.exit(usageErrorStatus)
}

const writeLine = (value: unknown): void => {
  nodeProcess.stdout.write(`${JSON.stringify(value)}\n`)
}

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("linux-host-attempt"),
  baseSha: GitCommitSha.make("1".repeat(gitCommitShaLength)),
  branch: TaskBranchRef.make("refs/heads/dalph/linux-host-attempt"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("linux-host-run"),
  taskId: TaskId.make("linux-host-task"),
  taskRevision: TaskRevision.make("linux-host-task-revision"),
  worktree: WorktreeLocator.make("/preserved/linux-host-worktree")
})
const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`linux-host-${position}`),
  position: JournalPosition.make(position),
  runId: plannedAttempt.runId
})

const runningRecords = (): ReadonlyArray<JournalRecord> => [
  record(
    1,
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  ),
  record(
    runningReportPosition,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      version: workflowJournalEventVersion
    })
  )
]

const runningExecutorDrain = Effect.gen(function* () {
  const records = yield* Ref.make(runningRecords())
  const journal = Layer.succeed(
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
          if (journalPath !== undefined) appendFileSync(journalPath, `${event._tag}\n`)
          return [appended, [...current, appended]] as const
        }),
      read: () => Ref.get(records)
    })
  )
  const executor = Layer.succeed(
    PlannedAttemptExecutor,
    PlannedAttemptExecutor.of({
      project: () => Effect.die("application Exit must not project the controlled executor"),
      requestSuspension: (attempt) =>
        Effect.sync(() => {
          writeLine({ controlledExecutor: "FastSuspensionRequested", llmRequests: 0 })
          return PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation: plannedAttemptExecutorCorrelation(attempt)
          })
        }),
      startOrContinue: () => Effect.die("application Exit must not ask the executor to finish")
    })
  )
  const drain = suspendApplicationExitAttempts([
    RunningAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
  ]).pipe(Effect.provide(Layer.mergeAll(journal, executor, plannedAttemptProtocolControllerLayer)))
  return { drain, records }
})

const traceEvent = (event: ApplicationExitTraceEvent) =>
  Effect.sync(() => {
    writeLine({ lifecycle: event, observedAt: performance.now() })
    if (mode === "stuck-repeat" && event._tag === "AdmissionCutoffClosed") {
      scheduleNextTurn(() => {
        writeLine({ repeatedSignalSent: true })
        nodeProcess.kill(nodeProcess.pid, "SIGTERM")
      })
    }
  }).pipe(Effect.andThen(nodeApplicationHostProcessBoundary.reportLifecycleEvent(event)))

const application = Effect.scoped(
  Effect.gen(function* () {
    const lock = yield* CoordinatorLock
    const ownership = yield* lock.acquire(GitCommonDirectoryTarget.make(gitCommonDirectory))
    const host = { ...nodeApplicationHostProcessBoundary, reportLifecycleEvent: traceEvent }
    const shell = yield* makeLinuxSupervisorApplicationExitHost(ownership, host)

    if (journalPath !== undefined) appendFileSync(journalPath, "WorkflowRunBegan\n")

    if (mode === "running") {
      const controlled = yield* runningExecutorDrain
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: controlled.drain.pipe(
          Effect.tap(() =>
            Ref.get(controlled.records).pipe(
              Effect.tap((records) =>
                Effect.sync(() => writeLine({ journalEvents: records.map(({ event }) => event._tag) }))
              )
            )
          )
        )
      })
    } else if (mode === "stuck" || mode === "stuck-repeat") {
      const owner = yield* shell.admission.acquireForwardOwner("AtomicBoundary")
      if (owner.kind !== "AtomicBoundary") return yield* Effect.die("expected an atomic owner")
      yield* owner.run(Effect.never).pipe(Effect.forkScoped)
    } else if (mode === "failed") {
      yield* shell.registerProcessLocalDrain({
        closeProcessLocalResources: Effect.fail(
          new ApplicationExitDrainFailure({
            diagnostics: [ApplicationExitDiagnostic.make("controlled process-local drain failed")]
          })
        )
      })
    } else if (mode === "acquire-once") {
      writeLine({ lockAcquired: true })
      writeLine({ ready: true, pid: nodeProcess.pid })
      yield* ownership.release
      return
    } else if (mode !== "idle") {
      return yield* Effect.die(`unsupported fixture mode ${mode}`)
    }

    writeLine({ ready: true, pid: nodeProcess.pid })
    return yield* Effect.never
  })
).pipe(Effect.provide(nodeCoordinatorLockLayer.pipe(Layer.provide(NodeServices.layer))))

Effect.runPromise(application).catch((cause: unknown) => {
  writeLine({ fixtureFailure: String(cause) })
  nodeProcess.exit(fixtureFailureStatus)
})
