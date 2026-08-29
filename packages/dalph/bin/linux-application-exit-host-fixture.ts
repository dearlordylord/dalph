#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- This executable fixture is the intentional real Node/Linux host boundary. */
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import nodeProcess from "node:process"
import { setImmediate as scheduleNextTurn } from "node:timers"
import { NodeServices } from "@effect/platform-node"
import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  CoordinatorLock,
  InRunJournal,
  JournalPosition,
  JournalRecordKey,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  ExecutingAttemptForApplicationExit,
  nodeCoordinatorLockLayer,
  plannedAttemptProtocolControllerLayer,
  suspendApplicationExitAttempts,
  workflowJournalEventVersion,
  type JournalRecord,
  type ApplicationExitTraceEvent
} from "@dalph/orchestrator"
import { Effect, Layer, Ref, Result, Schema } from "effect"
import {
  makeLinuxSupervisorApplicationExitHost,
  nodeApplicationHostProcessBoundary
} from "../src/application/supervisor-exit.js"
import {
  HostFixtureInput,
  makeFixturePlannedAttempt,
  preservedArtifact,
  type RunningHostFixtureInput
} from "./linux-application-exit-host-fixture-contract.js"

const usageErrorStatus = 64
const fixtureFailureStatus = 70
const runningReportPosition = 2
const modeArgument = nodeProcess.argv[2]
const gitCommonDirectoryArgument = nodeProcess.argv[3]
const journalArgument = nodeProcess.argv[4]
const worktreeArgument = nodeProcess.argv[5]
const baseShaArgument = nodeProcess.argv[6]

const decodedInput = Schema.decodeUnknownResult(HostFixtureInput)(
  modeArgument === "running"
    ? {
        baseSha: baseShaArgument,
        gitCommonDirectory: gitCommonDirectoryArgument,
        journalPath: journalArgument === "-" ? undefined : journalArgument,
        mode: modeArgument,
        worktree: worktreeArgument
      }
    : {
        gitCommonDirectory: gitCommonDirectoryArgument,
        journalPath: journalArgument === "-" ? undefined : journalArgument,
        mode: modeArgument
      }
)

if (Result.isFailure(decodedInput)) {
  nodeProcess.stderr.write(
    `usage: linux-application-exit-host-fixture <mode> <git-common-directory> [journal|-] [planned-worktree] [base-sha]\n${String(decodedInput.failure)}\n`
  )
  nodeProcess.exit(usageErrorStatus)
}

const input = decodedInput.success

const writeLine = (value: unknown): void => {
  nodeProcess.stdout.write(`${JSON.stringify(value)}\n`)
}

const record = (
  plannedAttempt: ReturnType<typeof makeFixturePlannedAttempt>,
  position: number,
  event: JournalRecord["event"]
): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`linux-host-${position}`),
  position: JournalPosition.make(position),
  runId: plannedAttempt.runId
})

const runningRecords = (plannedAttempt: ReturnType<typeof makeFixturePlannedAttempt>): ReadonlyArray<JournalRecord> => [
  record(
    plannedAttempt,
    1,
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  ),
  record(
    plannedAttempt,
    runningReportPosition,
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      }),
      version: workflowJournalEventVersion
    })
  )
]

const executingExecutorDrain = (runningInput: RunningHostFixtureInput) =>
  Effect.gen(function* () {
    const plannedAttempt = makeFixturePlannedAttempt(runningInput)
    const records = yield* Ref.make(runningRecords(plannedAttempt))
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
            if (runningInput.journalPath !== undefined) appendFileSync(runningInput.journalPath, `${event._tag}\n`)
            return [appended, [...current, appended]] as const
          }),
        read: () => Ref.get(records)
      })
    )
    const executor = Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        observe: () => Effect.die("application Exit must not project the controlled executor"),
        requestSuspension: (attempt) =>
          Effect.sync(() => {
            writeLine({ controlledExecutor: "FastSuspensionRequested", llmRequests: 0 })
            return PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
              correlation: plannedAttemptExecutorCorrelation(attempt)
            })
          }),
        begin: () => Effect.die("application Exit must not ask the executor to begin"),
        resume: () => Effect.die("application Exit must not ask the executor to resume")
      })
    )
    const drain = suspendApplicationExitAttempts([
      ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
    ]).pipe(Effect.provide(Layer.mergeAll(journal, executor, plannedAttemptProtocolControllerLayer)))
    return { drain, records }
  })

const traceEvent = (event: ApplicationExitTraceEvent) =>
  Effect.sync(() => {
    writeLine({ lifecycle: event, observedAt: performance.now() })
    if (input.mode === "stuck-repeat" && event._tag === "AdmissionCutoffClosed") {
      scheduleNextTurn(() => {
        writeLine({ repeatedSignalSent: true })
        nodeProcess.kill(nodeProcess.pid, "SIGTERM")
      })
    }
  }).pipe(Effect.andThen(nodeApplicationHostProcessBoundary.reportLifecycleEvent(event)))

const application = Effect.scoped(
  Effect.gen(function* () {
    const lock = yield* CoordinatorLock
    const ownership = yield* lock.acquire(input.gitCommonDirectory)
    const host = { ...nodeApplicationHostProcessBoundary, reportLifecycleEvent: traceEvent }
    const shell = yield* makeLinuxSupervisorApplicationExitHost(ownership, host)

    if (input.journalPath !== undefined) appendFileSync(input.journalPath, "WorkflowRunBegan\n")

    const registerRunningDrain = Effect.gen(function* () {
      if (input.mode !== "running") return yield* Effect.die("running fixture input was not selected")
      writeLine({
        worktreeEvidence: {
          artifact: readFileSync(join(input.worktree, preservedArtifact), "utf8"),
          baseSha: input.baseSha,
          worktree: input.worktree
        }
      })
      const controlled = yield* executingExecutorDrain(input)
      yield* shell.registerExecutorDrain({
        suspendExecutingExecutorWork: controlled.drain.pipe(
          Effect.tap(() =>
            Ref.get(controlled.records).pipe(
              Effect.tap((records) =>
                Effect.sync(() => writeLine({ journalEvents: records.map(({ event }) => event._tag) }))
              )
            )
          )
        )
      })
    })

    const registerStuckDrain = Effect.gen(function* () {
      const owner = yield* shell.admission.acquireForwardOwner("AtomicBoundary")
      if (owner.kind !== "AtomicBoundary") return yield* Effect.die("expected an atomic owner")
      yield* owner.run(Effect.never).pipe(Effect.forkScoped)
    })

    if (input.mode === "running") {
      yield* registerRunningDrain
    } else if (input.mode === "stuck" || input.mode === "stuck-repeat") {
      yield* registerStuckDrain
    } else if (input.mode === "failed") {
      yield* shell.registerProcessLocalDrain({
        closeProcessLocalResources: Effect.fail(
          new ApplicationExitDrainFailure({
            diagnostics: [ApplicationExitDiagnostic.make("controlled process-local drain failed")]
          })
        )
      })
    } else if (input.mode === "acquire-once") {
      writeLine({ lockAcquired: true })
      writeLine({ ready: true, pid: nodeProcess.pid })
      yield* ownership.release
      return
    }

    writeLine({ ready: true, pid: nodeProcess.pid })
    return yield* Effect.never
  })
).pipe(Effect.provide(nodeCoordinatorLockLayer.pipe(Layer.provide(NodeServices.layer))))

Effect.runPromise(application).catch((cause: unknown) => {
  writeLine({ fixtureFailure: String(cause) })
  nodeProcess.exit(fixtureFailureStatus)
})
