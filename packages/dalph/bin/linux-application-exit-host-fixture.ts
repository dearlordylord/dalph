#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- This executable fixture is the intentional real Node/Linux host boundary. */
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import nodeProcess from "node:process"
import { setImmediate as scheduleNextTurn } from "node:timers"
import { NodeServices } from "@effect/platform-node"
import {
  makeTaskWorkSpecification,
  PlannedTaskAttempt,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  AcceptedJournalReader,
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  CoordinatorLock,
  ClaimOwner,
  ClaimToken,
  describeJournalEvent,
  InRunJournal,
  InitialControlPolicy,
  journalLayer,
  JournalPosition,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedWorktreeReady,
  ExecutingAttemptForApplicationExit,
  FixtureTarget,
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  nodeCoordinatorLockLayer,
  OperationId,
  plannedAttemptProtocolControllerLayer,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  suspendApplicationExitAttempts,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisition,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  TaskLifecycle,
  TaskTrackerFactsObservedEvent,
  TaskWorkCapacity,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TrackerRevision,
  WorkflowRunBeganEvent,
  workflowJournalEventVersion,
  type JournalRecord,
  type ApplicationExitTraceEvent
} from "@dalph/orchestrator"
import { Effect, Layer, Option, Ref, Result, Schema } from "effect"
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
const suspensionJournalAppendCount = 3
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
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(position),
  runId: plannedAttempt.runId
})

const runningRecords = (fixtureAttempt: ReturnType<typeof makeFixturePlannedAttempt>) => {
  const specification = makeTaskWorkSpecification({
    body: "Suspend the controlled Linux application-exit executor.",
    taskId: fixtureAttempt.taskId,
    title: "Controlled Linux application-exit executor"
  })
  const plannedAttempt = PlannedTaskAttempt.make({ ...fixtureAttempt, taskRevision: specification.fingerprint })
  const target = FixtureTarget.make("linux-application-exit-host")
  const activeClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("linux-host-claim"),
    owner: ClaimOwner.make("dalph:linux-host"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make("linux-host-claim-token")
  })
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make(activeClaim),
    predecessorOperationIds: []
  })
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("linux-host-graph"),
    target,
    [claimOperation.operationId],
    [plannedAttempt.taskId]
  )
  const projected = projectTrackerSnapshot({
    revision: TrackerRevision.make("linux-host-tracker-revision"),
    tasks: [
      {
        id: plannedAttempt.taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  const snapshot = Option.getOrThrow(projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none())
  const specificationOperation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("linux-host-specification"),
    target,
    plannedAttempt.taskId,
    [graphOperation.operationId]
  )
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("linux-host-plan"),
    plannedAttempt,
    predecessorOperationIds: [specificationOperation.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("linux-host-worktree"),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const version = workflowJournalEventVersion
  const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
    correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
  })
  const events: ReadonlyArray<JournalRecord["event"]> = [
    WorkflowRunBeganEvent.make({
      initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      target,
      version
    }),
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version }),
    TaskClaimAcquiredEvent.make({ claim: activeClaim, version }),
    taskTrackerReadIntent(graphOperation),
    TaskTrackerFactsObservedEvent.make({
      observation: makeCompleteTaskTrackerFactsObserved(graphOperation, snapshot),
      operationId: graphOperation.operationId,
      version
    }),
    taskTrackerReadIntent(specificationOperation),
    taskTrackerFactsObservedEvent(
      specificationOperation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
    ),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version }),
    TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version }),
    TaskWorktreeReadyEvent.make({
      operationId: worktreeOperation.operationId,
      proof: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      version
    }),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version }),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      plannedAttempt,
      version
    }),
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      command: "Begin",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      report,
      version
    }),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report,
      version
    })
  ]
  const records = events.map((event, index) => record(plannedAttempt, index + 1, event))
  const visibleRecords = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
      event._tag === "PlannedAttemptExecutorWorkReported"
  )
  return { plannedAttempt, records, target, visibleRecords }
}

const executingExecutorDrain = (runningInput: RunningHostFixtureInput) =>
  Effect.gen(function* () {
    const fixture = runningRecords(makeFixturePlannedAttempt(runningInput))
    const { plannedAttempt } = fixture
    const initial = reduceWorkflowJournalHistory(plannedAttempt.runId, fixture.records)
    if (initial._tag === "InvalidWorkflowJournalHistory") {
      return yield* Effect.die(`linux host fixture history is invalid: ${JSON.stringify(initial.issues)}`)
    }
    const stored = yield* Ref.make(fixture.records)
    const records = yield* Ref.make(fixture.visibleRecords)
    const storageReads = yield* Ref.make(0)
    const storage = {
      append: (runId: typeof plannedAttempt.runId, key: JournalRecord["key"], event: JournalRecord["event"]) =>
        Ref.modify(stored, (current) => {
          const existing = current.find((candidate) => candidate.key === key)
          if (existing !== undefined) return [existing, current] as const
          const appended = record(plannedAttempt, current.length + 1, event)
          return [appended, [...current, appended]] as const
        }),
      read: () => Ref.updateAndGet(storageReads, (count) => count + 1).pipe(Effect.andThen(Ref.get(stored))),
      terminateRun: () => Effect.die("application Exit must not terminate the controlled Run")
    }
    const journal = journalLayer(plannedAttempt.runId, fixture.target, initial, storage)
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
    const drain = Effect.gen(function* () {
      const accepted = yield* AcceptedJournalReader
      const live = yield* InRunJournal
      const activated = yield* accepted.readAccepted(plannedAttempt.runId)
      const recordingJournal = InRunJournal.of({
        read: live.read,
        append: (runId, key, event) =>
          live.append(runId, key, event).pipe(
            Effect.tap((appended) => Ref.update(records, (current) => [...current, appended])),
            Effect.tap(() =>
              Effect.sync(() => {
                if (runningInput.journalPath !== undefined) appendFileSync(runningInput.journalPath, `${event._tag}\n`)
              })
            )
          )
      })
      const result = yield* suspendApplicationExitAttempts([
        ExecutingAttemptForApplicationExit.ReadyForSuspension({ plannedAttempt })
      ]).pipe(Effect.provideService(InRunJournal, recordingJournal))
      const advanced = yield* accepted.readAccepted(plannedAttempt.runId)
      const reads = yield* Ref.get(storageReads)
      if (advanced.records.length !== activated.records.length + suspensionJournalAppendCount || reads !== 0) {
        return yield* Effect.die("accepted Journal appends must publish without storage reread")
      }
      return result
    }).pipe(Effect.provide(Layer.mergeAll(journal, executor, plannedAttemptProtocolControllerLayer)))
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
