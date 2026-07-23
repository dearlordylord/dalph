import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { ConfigProvider, Effect, Exit, FileSystem, Layer, Ref, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import {
  type TaskWorkSessionCrashScenario,
  TaskWorkSessionCrashScenario as CrashScenario
} from "../test/task-work-session-crash-scenarios.js"
import {
  AttemptId,
  controlledTrackerMutationLayer,
  GitCommitSha,
  GitCommonDirectoryTarget,
  JournalDatabaseLocator,
  JournalStore,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  OperationId,
  PlannedTaskAttempt,
  PlannedWorktreeReady,
  productionWorkflowInterpreterLayer,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  sqliteJournalStoreLayer,
  TaskBranchRef,
  TaskExecutorLocator,
  taskExecutorTestLayer,
  TaskId,
  TaskLifecycle,
  taskRevisionFor,
  TaskRunner,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TaskWorkStartRequest,
  TrackerGraphReader,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  TaskAttemptPlannedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "./journal-store.js"

const runGit = Effect.fn("TaskWorkSessionCrashMatrix.runGit")(function*(
  cwd: string,
  ...args: ReadonlyArray<string>
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(Effect.gen(function*() {
    const handle = yield* spawner.spawn(ChildProcess.make("git", args, { cwd }))
    const [exitCode, stderr, stdout] = yield* Effect.all([
      handle.exitCode,
      handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
      handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
    ], { concurrency: "unbounded" })
    if (exitCode !== 0) return yield* Effect.die(`git ${args.join(" ")} failed: ${stderr}`)
    return stdout.trim()
  }))
})

const makeRepository = Effect.fn("TaskWorkSessionCrashMatrix.makeRepository")(function*(directory: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const repository = `${directory}/repository`
  yield* fileSystem.makeDirectory(repository)
  yield* runGit(repository, "init", "--initial-branch=master")
  yield* runGit(repository, "config", "user.email", "dalph@example.invalid")
  yield* runGit(repository, "config", "user.name", "Dalph Test")
  yield* runGit(repository, "commit", "--allow-empty", "-m", "base")
  return {
    baseSha: GitCommitSha.make(yield* runGit(repository, "rev-parse", "HEAD")),
    gitDirectory: GitCommonDirectoryTarget.make(`${repository}/.git`),
    repository
  }
})

/** Shared typed metadata for the provider/request crash-boundary acceptance lane. */
const crashScenarios = [
  {
    boundary: CrashScenario.AfterIntentBeforeRequest,
    expectedLookups: 2,
    expectedRequests: 1,
    expectedTags: [
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ]
  },
  {
    boundary: CrashScenario.AfterRequestCrossed,
    expectedLookups: 1,
    expectedRequests: 1,
    expectedTags: [
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ]
  },
  {
    boundary: CrashScenario.AfterRequestCrossedWithoutCreation,
    expectedLookups: 2,
    expectedRequests: 2,
    expectedTags: [
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ]
  },
  {
    boundary: CrashScenario.AfterAcknowledgementRecorded,
    expectedLookups: 1,
    expectedRequests: 1,
    expectedTags: [
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ]
  },
  {
    boundary: CrashScenario.AfterAcknowledgementRecordedWithoutCreation,
    expectedLookups: 2,
    expectedRequests: 2,
    expectedTags: [
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ]
  },
  {
    boundary: CrashScenario.AfterMatchingReportRecorded,
    expectedLookups: 2,
    expectedRequests: 1,
    expectedTags: [
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ]
  },
  {
    boundary: CrashScenario.AfterAbsenceReportRecorded,
    expectedLookups: 3,
    expectedRequests: 2,
    expectedTags: [
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestAcknowledged",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionReported",
      "TaskWorkSessionEstablished"
    ]
  }
] as const satisfies ReadonlyArray<{
  readonly boundary: TaskWorkSessionCrashScenario
  readonly expectedLookups: number
  readonly expectedRequests: number
  readonly expectedTags: ReadonlyArray<string>
}>

for (const scenario of crashScenarios) {
  it.effect(`recovers after ${scenario.boundary}`, () =>
    Effect.gen(function*() {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: `dalph-crash-${scenario.boundary}-`
      })
      const repository = yield* makeRepository(directory)
      yield* runGit(
        repository.repository,
        "worktree",
        "add",
        "-b",
        scenario.boundary,
        `${directory}/task`,
        repository.baseSha
      )
      const runId = RunId.make(`crash-${scenario.boundary}`)
      const operationId = OperationId.make(`operation-${scenario.boundary}`)
      const taskId = TaskId.make(`task-${scenario.boundary}`)
      const task = {
        id: taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`attempt-${scenario.boundary}`),
        baseSha: repository.baseSha,
        branch: TaskBranchRef.make(`refs/heads/${scenario.boundary}`),
        executor: TaskExecutorLocator.make("executor:crash-matrix"),
        runId,
        session: TaskWorkSessionLocator.make(`session:${scenario.boundary}`),
        taskId,
        taskRevision: taskRevisionFor(task),
        worktree: WorktreeLocator.make(`${directory}/task`)
      })
      const request = TaskWorkStartRequest.make({
        operationId,
        plannedAttempt,
        task
      })
      const planOperationId = OperationId.make("planned-attempt-operation")
      const planOperation = makeTaskAttemptPlanOperation({
        operationId: planOperationId,
        plannedAttempt,
        predecessorOperationIds: []
      })
      const worktreeOperation = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make(`worktree-${scenario.boundary}`),
        plannedAttempt,
        predecessorOperationIds: [planOperationId]
      })
      const predecessorOperationIds = [planOperationId, worktreeOperation.operationId]
      const operation = makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds,
        request
      })
      const crashed = yield* Ref.make(false)
      const lookups = yield* Ref.make(0)
      const providerHasSession = yield* Ref.make(false)
      const requests = yield* Ref.make(0)

      const runnerLayer = Layer.succeed(
        TaskRunner,
        TaskRunner.of({
          lookupTaskWorkSession: () =>
            Effect.gen(function*() {
              const count = yield* Ref.updateAndGet(lookups, (value) => value + 1)
              const report = (yield* Ref.get(providerHasSession))
                ? MatchingTaskWorkSessionReported.make({
                  observationId: ProviderObservationId.make(`lookup-match-${count}`),
                  sessionId: TaskWorkSessionId.make("provider-session"),
                  work: { _tag: "NoProviderWorkReported" }
                })
                : NoMatchingTaskWorkSessionReported.make({
                  observationId: ProviderObservationId.make(`lookup-absence-${count}`)
                })
              return report
            }),
          requestTaskWorkStart: () =>
            Effect.gen(function*() {
              if (
                scenario.boundary === CrashScenario.AfterIntentBeforeRequest
                && !(yield* Ref.get(crashed))
              ) {
                yield* Ref.set(crashed, true)
                return yield* Effect.interrupt
              }
              const count = yield* Ref.updateAndGet(requests, (value) => value + 1)
              const firstAbsenceScenarioRequest = (
                scenario.boundary === CrashScenario.AfterAbsenceReportRecorded
                || scenario.boundary === CrashScenario.AfterRequestCrossedWithoutCreation
                || scenario.boundary === CrashScenario.AfterAcknowledgementRecordedWithoutCreation
              ) && count === 1
              if (!firstAbsenceScenarioRequest) yield* Ref.set(providerHasSession, true)
              if (
                (
                  scenario.boundary === CrashScenario.AfterRequestCrossed
                  || scenario.boundary === CrashScenario.AfterRequestCrossedWithoutCreation
                )
                && !(yield* Ref.get(crashed))
              ) {
                yield* Ref.set(crashed, true)
                return yield* Effect.interrupt
              }
              return {
                observationId: ProviderObservationId.make(`request-observation-${count}`),
                providerRequestId: ProviderRequestId.make(`provider-request-${count}`)
              }
            })
        })
      )
      const traceLayer = Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({
          emit: (item) =>
            Effect.gen(function*() {
              if (yield* Ref.get(crashed)) return
              const shouldCrash = (
                  scenario.boundary === CrashScenario.AfterAcknowledgementRecorded
                  || scenario.boundary === CrashScenario.AfterAcknowledgementRecordedWithoutCreation
                )
                ? item._tag === "TaskWorkStartRequestAcknowledged"
                : scenario.boundary === CrashScenario.AfterMatchingReportRecorded
                ? item._tag === "TaskWorkSessionReported"
                  && item.report._tag === "MatchingTaskWorkSessionReported"
                : scenario.boundary === CrashScenario.AfterAbsenceReportRecorded
                ? item._tag === "TaskWorkSessionReported"
                  && item.report._tag === "NoMatchingTaskWorkSessionReported"
                : false
              if (shouldCrash) {
                yield* Ref.set(crashed, true)
                yield* Effect.interrupt
              }
            })
        })
      )
      const applicationLayer = productionWorkflowInterpreterLayer(
        runId,
        repository.gitDirectory,
        taskExecutorTestLayer,
        runnerLayer,
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(Layer.succeed(
          TrackerGraphReader,
          TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
        )),
        Layer.provide(traceLayer)
      )
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const configLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({
        DALPH_JOURNAL_DATABASE: filename
      }))
      yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        yield* journal.append(
          runId,
          attemptPlanRecordKey(plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({ operation: planOperation, version: 4 })
        )
        yield* journal.append(
          runId,
          intentRecordKey(worktreeOperation.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: 4 })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(worktreeOperation.operationId),
          TaskWorktreeReadyEvent.make({
            operationId: worktreeOperation.operationId,
            proof: PlannedWorktreeReady.make({
              baseSha: plannedAttempt.baseSha,
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              worktree: plannedAttempt.worktree
            }),
            version: 4
          })
        )
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      const runCoordinator = Effect.gen(function*() {
        const interpreter = yield* WorkflowInterpreter
        return yield* interpreter.establishTaskWorkSession(operation)
      }).pipe(
        Effect.provide(applicationLayer),
        Effect.provide(configLayer)
      )

      const crashedExit = yield* Effect.exit(runCoordinator)
      expect(Exit.isFailure(crashedExit)).toBe(true)
      const outcome = yield* runCoordinator
      expect(outcome).toMatchObject({ operationId, sessionId: "provider-session" })

      const records = yield* Effect.gen(function*() {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      expect(records.map(({ event }) => event._tag)).toEqual(scenario.expectedTags)
      expect(yield* Ref.get(requests)).toBe(scenario.expectedRequests)
      expect(yield* Ref.get(lookups)).toBe(scenario.expectedLookups + 1)
      expect(yield* Ref.get(providerHasSession)).toBe(true)
      const intent = records.find(({ event }) => event._tag === "TaskWorkSessionEstablishmentIntentRecorded")?.event
      expect(intent).toMatchObject({ operation: { predecessorOperationIds, request } })
    }).pipe(Effect.provide(NodeServices.layer)))
}

it.effect(`allocates a new candidate after ${CrashScenario.BeforeIntentAcknowledgement}`, () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-before-intent-" })
    const repository = yield* makeRepository(directory)
    yield* runGit(
      repository.repository,
      "worktree",
      "add",
      "-b",
      "before-intent",
      `${directory}/task`,
      repository.baseSha
    )
    const runId = RunId.make("before-intent-run")
    const taskId = TaskId.make("before-intent-task")
    const task = {
      id: taskId,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("before-intent-attempt"),
      baseSha: repository.baseSha,
      branch: TaskBranchRef.make("refs/heads/before-intent"),
      executor: TaskExecutorLocator.make("executor:before-intent"),
      runId,
      session: TaskWorkSessionLocator.make("session:before-intent"),
      taskId,
      taskRevision: taskRevisionFor(task),
      worktree: WorktreeLocator.make(`${directory}/task`)
    })
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("before-intent-plan"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const worktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("before-intent-worktree"),
      plannedAttempt,
      predecessorOperationIds: [planOperation.operationId]
    })
    const makeOperation = (operationId: OperationId) =>
      makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
        request: TaskWorkStartRequest.make({
          operationId,
          plannedAttempt,
          task
        })
      })
    const discarded = makeOperation(OperationId.make("discarded-candidate"))
    const replacement = makeOperation(OperationId.make("replacement-candidate"))
    const runnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () =>
          Effect.succeed(
            MatchingTaskWorkSessionReported.make({
              observationId: ProviderObservationId.make("replacement-match"),
              sessionId: TaskWorkSessionId.make("replacement-session"),
              work: { _tag: "NoProviderWorkReported" }
            })
          ),
        requestTaskWorkStart: () =>
          Effect.succeed({
            observationId: ProviderObservationId.make("replacement-request-observation"),
            providerRequestId: ProviderRequestId.make("replacement-request")
          })
      })
    )
    const applicationLayer = productionWorkflowInterpreterLayer(
      runId,
      repository.gitDirectory,
      taskExecutorTestLayer,
      runnerLayer,
      controlledTrackerMutationLayer
    ).pipe(
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )
    const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
    const configLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({
      DALPH_JOURNAL_DATABASE: filename
    }))
    const crashBeforeIntent = Effect.gen(function*() {
      yield* WorkflowInterpreter
      return yield* Effect.interrupt
    }).pipe(Effect.provide(applicationLayer), Effect.provide(configLayer))

    expect(Exit.isFailure(yield* Effect.exit(crashBeforeIntent))).toBe(true)
    const beforeRecovery = yield* Effect.gen(function*() {
      return yield* (yield* JournalStore).read(runId)
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
    expect(beforeRecovery).toEqual([])

    yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        attemptPlanRecordKey(plannedAttempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: planOperation, version: 4 })
      )
      yield* journal.append(
        runId,
        intentRecordKey(worktreeOperation.operationId),
        TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: 4 })
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(worktreeOperation.operationId),
        TaskWorktreeReadyEvent.make({
          operationId: worktreeOperation.operationId,
          proof: PlannedWorktreeReady.make({
            baseSha: plannedAttempt.baseSha,
            branch: plannedAttempt.branch,
            headSha: plannedAttempt.baseSha,
            worktree: plannedAttempt.worktree
          }),
          version: 4
        })
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
    const outcome = yield* Effect.gen(function*() {
      return yield* (yield* WorkflowInterpreter).establishTaskWorkSession(replacement)
    }).pipe(Effect.provide(applicationLayer), Effect.provide(configLayer))
    expect(outcome.operationId).toBe(replacement.request.operationId)
    expect(outcome.operationId).not.toBe(discarded.request.operationId)
  }).pipe(Effect.provide(NodeServices.layer)))
