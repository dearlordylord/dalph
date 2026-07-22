import { NodeFileSystem } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { ConfigProvider, Deferred, Effect, Fiber, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import { TaskWorkSessionCrashScenario } from "../test/task-work-session-crash-scenarios.js"
import type { WorkflowOutcome } from "./index.js"
import {
  AttemptId,
  GitCommitSha,
  GitCommonDirectoryTarget,
  JournalDatabaseLocator,
  JournalStore,
  makeTaskWorkSessionEstablishmentOperation,
  MatchingTaskWorkSessionReported,
  OperationId,
  PlannedTaskAttempt,
  productionWorkflowInterpreterLayer,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  sqliteJournalStoreLayer,
  TaskBranchRef,
  TaskId,
  TaskLifecycle,
  TaskRunner,
  TaskWorkSessionId,
  TaskWorkStartRequest,
  TrackerGraphReader,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import { intentRecordKey, TaskWorkSessionEstablishmentIntentRecorded } from "./journal-store.js"

it.effect(`recovers configured SQLite history after ${TaskWorkSessionCrashScenario.AfterOutcomeRecorded}`, () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-production-"
    })
    const runId = RunId.make("production-run")
    const taskId = TaskId.make("production-task")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("production-attempt"),
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
      branch: TaskBranchRef.make("refs/heads/production-task"),
      runId,
      taskId,
      worktree: WorktreeLocator.make(`${directory}/task`)
    })
    const request = TaskWorkStartRequest.make({
      operationId: OperationId.make("production-operation"),
      plannedAttempt,
      task: {
        id: taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
    })
    const operation = makeTaskWorkSessionEstablishmentOperation({
      predecessorOperationIds: [],
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
      GitCommonDirectoryTarget.make(directory),
      runnerLayer
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
        intentRecordKey(request.operationId),
        TaskWorkSessionEstablishmentIntentRecorded.make({ operation, version: 2 })
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
    const configLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({
      DALPH_JOURNAL_DATABASE: filename
    }))
    const runCoordinator = Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      return yield* interpreter.establishTaskWorkSession(operation)
    }).pipe(
      Effect.provide(applicationLayer),
      Effect.provide(configLayer)
    )
    const outcomeRecorded = yield* Deferred.make<
      typeof WorkflowOutcome.cases.TaskWorkSessionEstablished.Type
    >()
    const coordinator = yield* runCoordinator.pipe(
      Effect.tap((outcome) => Deferred.succeed(outcomeRecorded, outcome)),
      Effect.andThen(Effect.never),
      Effect.provide(applicationLayer),
      Effect.provide(configLayer),
      Effect.forkDetach
    )
    const firstOutcome = yield* Deferred.await(outcomeRecorded)
    yield* Fiber.interrupt(coordinator)
    const replayedOutcome = yield* runCoordinator

    expect(firstOutcome).toMatchObject({
      operationId: request.operationId,
      sessionId: "production-session"
    })
    expect(replayedOutcome).toEqual(firstOutcome)
    expect(yield* Ref.get(requests)).toBe(0)
    expect(yield* Ref.get(lookups)).toBe(1)
  }).pipe(Effect.provide(NodeFileSystem.layer)))
