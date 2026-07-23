import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { it } from "@effect/vitest"
import { ConfigProvider, Effect, FileSystem, Layer, Ref, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { expect } from "vitest"
import { TaskWorkSessionCrashScenario } from "../test/task-work-session-crash-scenarios.js"
import { CoordinatorOwnershipLost } from "./coordinator-lock.js"
import {
  AttemptId,
  controlledTrackerMutationLayer,
  FixtureTarget,
  GitCommitSha,
  GitCommonDirectoryLocator,
  GitCommonDirectoryTarget,
  JournalDatabaseLocator,
  JournalRecordKey,
  JournalStore,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  MatchingTaskWorkSessionReported,
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
  TrackerReadError,
  TrackerRevision,
  WorkflowInterpreter,
  WorkflowOperation,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  TaskAttemptPlannedEvent,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"

const runGit = Effect.fn("ProductionApplicationTest.runGit")(function*(cwd: string, ...args: ReadonlyArray<string>) {
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

it.effect(`recovers configured SQLite history after ${TaskWorkSessionCrashScenario.AfterOutcomeRecorded}`, () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-production-"
    })
    const repository = `${directory}/repository`
    yield* fileSystem.makeDirectory(repository)
    yield* runGit(repository, "init", "--initial-branch=master")
    yield* runGit(repository, "config", "user.email", "dalph@example.invalid")
    yield* runGit(repository, "config", "user.name", "Dalph Test")
    yield* runGit(repository, "commit", "--allow-empty", "-m", "base")
    const baseSha = GitCommitSha.make(yield* runGit(repository, "rev-parse", "HEAD"))
    yield* runGit(repository, "worktree", "add", "-b", "production-task", `${directory}/task`, baseSha)
    const runId = RunId.make("production-run")
    const taskId = TaskId.make("production-task")
    const task = {
      id: taskId,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("production-attempt"),
      baseSha,
      branch: TaskBranchRef.make("refs/heads/production-task"),
      executor: TaskExecutorLocator.make("executor:production-test"),
      runId,
      session: TaskWorkSessionLocator.make("session:production-test"),
      taskId,
      taskRevision: taskRevisionFor(task),
      worktree: WorktreeLocator.make(`${directory}/task`)
    })
    const request = TaskWorkStartRequest.make({
      operationId: OperationId.make("production-operation"),
      plannedAttempt,
      task
    })
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("production-plan-operation"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const worktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("production-worktree-operation"),
      plannedAttempt,
      predecessorOperationIds: [planOperation.operationId]
    })
    const operation = makeTaskWorkSessionEstablishmentOperation({
      predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
      request
    })
    const requests = yield* Ref.make(0)
    const lookups = yield* Ref.make(0)
    const runnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () =>
          Ref.update(lookups, (value) => value + 1).pipe(Effect.as(
            MatchingTaskWorkSessionReported.make({
              observationId: ProviderObservationId.make("production-observation"),
              sessionId: TaskWorkSessionId.make("production-session"),
              work: { _tag: "NoProviderWorkReported" }
            })
          )),
        requestTaskWorkStart: () =>
          Ref.update(requests, (value) => value + 1).pipe(Effect.as({
            observationId: ProviderObservationId.make("production-request-observation"),
            providerRequestId: ProviderRequestId.make("production-request")
          }))
      })
    )
    const applicationLayer = productionWorkflowInterpreterLayer(
      runId,
      GitCommonDirectoryTarget.make(`${repository}/.git`),
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
      yield* journal.append(
        runId,
        intentRecordKey(request.operationId),
        TaskWorkSessionEstablishmentIntentRecorded.make({ operation, version: 4 })
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
    yield* runGit(`${directory}/task`, "commit", "--allow-empty", "-m", "implementation progress")
    const configLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({
      DALPH_JOURNAL_DATABASE: filename
    }))
    const [firstOutcome, replayedOutcome] = yield* Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const first = yield* interpreter.establishTaskWorkSession(operation)
      const replayed = yield* interpreter.establishTaskWorkSession(operation)
      return [first, replayed] as const
    }).pipe(
      Effect.provide(applicationLayer),
      Effect.provide(configLayer)
    )

    expect(firstOutcome).toMatchObject({
      operationId: request.operationId,
      sessionId: "production-session"
    })
    expect(replayedOutcome).toEqual(firstOutcome)
    expect(yield* Ref.get(requests)).toBe(0)
    expect(yield* Ref.get(lookups)).toBe(2)
  }).pipe(Effect.provide(NodeServices.layer)))

it.effect("preserves and blocks semantically invalid discovered history before authority refresh", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-invalid-production-" })
    const runId = RunId.make("invalid-production-run")
    const operationId = OperationId.make("orphan-tracker-outcome")
    const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
    yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        outcomeRecordKey(operationId),
        trackerGraphOutcomeObserved(operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("orphan-revision"),
          taskIds: []
        })
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

    const unusedRunnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("invalid history must block runner lookup"),
        requestTaskWorkStart: () => Effect.die("invalid history must block runner request")
      })
    )
    const applicationLayer = productionWorkflowInterpreterLayer(
      runId,
      GitCommonDirectoryTarget.make(directory),
      taskExecutorTestLayer,
      unusedRunnerLayer,
      controlledTrackerMutationLayer
    ).pipe(
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("invalid history must block tracker read") })
      )),
      Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
    )
    const failure = yield* Effect.gen(function*() {
      yield* WorkflowInterpreter
    }).pipe(
      Effect.provide(applicationLayer),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
      Effect.flip
    )
    expect(failure).toMatchObject({ _tag: "StartupRecoveryBlocked" })
  }).pipe(Effect.provide(NodeFileSystem.layer)))

it.effect("does not resume a run containing both valid history and a physical decode issue", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-invalid-row-production-" })
    const runId = RunId.make("invalid-row-production-run")
    const secondRunId = RunId.make("valid-history-with-invalid-row-production-run")
    const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
    const makeIntent = (operationId: string) =>
      trackerGraphObservationIntent(
        WorkflowOperation.cases.ReadTrackerGraph.make({
          operationId: OperationId.make(operationId),
          predecessorOperationIds: [],
          target: FixtureTarget.make(`target-${operationId}`)
        })
      )
    yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(runId, JournalRecordKey.make("operation:valid:outcome"), makeIntent("valid"))
      yield* journal.append(runId, intentRecordKey(OperationId.make("foreign")), makeIntent("foreign"))
      yield* journal.append(runId, intentRecordKey(OperationId.make("unreadable")), makeIntent("unreadable"))
      yield* journal.append(runId, intentRecordKey(OperationId.make("ownership")), makeIntent("ownership"))
      yield* journal.append(runId, JournalRecordKey.make("operation:corrupt:intent"), makeIntent("corrupt"))
      yield* journal.append(
        secondRunId,
        JournalRecordKey.make("operation:second-valid:intent"),
        makeIntent("second-valid")
      )
      yield* journal.append(
        secondRunId,
        JournalRecordKey.make("operation:second-corrupt:intent"),
        makeIntent("second-corrupt")
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
    yield* Effect.scoped(
      Effect.gen(function*() {
        const sql = yield* SqliteClient.make({ filename })
        yield* sql`UPDATE journal_records SET payload_json = '{' WHERE record_key = 'operation:corrupt:intent'`
        yield* sql`UPDATE journal_records SET payload_json = '{' WHERE record_key = 'operation:second-corrupt:intent'`
      }).pipe(Effect.provide(Reactivity.layer))
    )

    const unusedRunnerLayer = Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("physical issue must skip runner lookup"),
        requestTaskWorkStart: () => Effect.die("physical issue must skip runner request")
      })
    )
    const applicationLayer = productionWorkflowInterpreterLayer(
      runId,
      GitCommonDirectoryTarget.make(directory),
      taskExecutorTestLayer,
      unusedRunnerLayer,
      controlledTrackerMutationLayer
    ).pipe(
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: (target) =>
            typeof target === "string" && target === "target-ownership"
              ? Effect.fail(
                new CoordinatorOwnershipLost({
                  gitCommonDirectory: GitCommonDirectoryLocator.make(`${directory}/ownership-lost`)
                })
              ) as never
              : Effect.fail(
                new TrackerReadError({
                  detail: typeof target === "string"
                    ? `${target.replace("target-", "")} authority observation`
                    : "unreadable authority observation",
                  operation: "TrackerGraphReader.decode"
                })
              )
        })
      )),
      Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
    )
    const failure = yield* WorkflowInterpreter.pipe(
      Effect.provide(applicationLayer),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
      Effect.flip
    )
    expect(failure).toMatchObject({ _tag: "StartupRecoveryBlocked" })
    if (failure._tag === "StartupRecoveryBlocked") {
      expect(failure.issues.map(({ _tag }) => _tag)).toEqual([
        "JournalBoundaryDecodeIssue",
        "JournalBoundaryDecodeIssue",
        "ManagedHistoryIdentityIssue",
        "RecoveryReconciliationIssue",
        "RecoveryReconciliationIssue",
        "RecoveryReconciliationIssue",
        "RecoveryOwnershipIssue",
        "RecoveryReconciliationIssue"
      ])
      expect(failure.issues.filter(({ runId: issueRunId }) => issueRunId === runId)).toHaveLength(6)
      expect(failure.issues.filter(({ runId: issueRunId }) => issueRunId === secondRunId)).toHaveLength(2)
    }
  }).pipe(Effect.provide(NodeFileSystem.layer)))
