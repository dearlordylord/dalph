import { NodeFileSystem } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { ConfigProvider, Effect, Exit, FileSystem, Layer, Ref } from "effect"
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
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  OperationId,
  PlannedTaskAttempt,
  productionWorkflowInterpreterLayer,
  ProviderObservationId,
  ProviderRequestId,
  RunId,
  sqliteJournalStoreLayer,
  TaskBranchRef,
  TaskExecutorLocator,
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

/** Shared typed metadata for the provider/request crash-boundary acceptance lane. */
const crashScenarios = [
  {
    boundary: CrashScenario.AfterIntentBeforeRequest,
    expectedLookups: 2,
    expectedRequests: 1,
    expectedTags: [
      "TaskAttemptPlanned",
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
        baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
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
      const predecessorOperationIds = [planOperationId]
      const planOperation = makeTaskAttemptPlanOperation({
        operationId: planOperationId,
        plannedAttempt,
        predecessorOperationIds: []
      })
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
        GitCommonDirectoryTarget.make(directory),
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
      const runCoordinator = Effect.gen(function*() {
        const interpreter = yield* WorkflowInterpreter
        yield* interpreter.recordTaskAttemptPlan(planOperation)
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
      expect(yield* Ref.get(lookups)).toBe(scenario.expectedLookups)
      expect(yield* Ref.get(providerHasSession)).toBe(true)
      const intent = records.find(({ event }) => event._tag === "TaskWorkSessionEstablishmentIntentRecorded")?.event
      expect(intent).toMatchObject({ operation: { predecessorOperationIds, request } })
    }).pipe(Effect.provide(NodeFileSystem.layer)))
}

it.effect(`allocates a new candidate after ${CrashScenario.BeforeIntentAcknowledgement}`, () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-before-intent-" })
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
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
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
    const makeOperation = (operationId: OperationId) =>
      makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [planOperation.operationId],
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
      GitCommonDirectoryTarget.make(directory),
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

    const outcome = yield* Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      yield* interpreter.recordTaskAttemptPlan(planOperation)
      return yield* interpreter.establishTaskWorkSession(replacement)
    }).pipe(Effect.provide(applicationLayer), Effect.provide(configLayer))
    expect(outcome.operationId).toBe(replacement.request.operationId)
    expect(outcome.operationId).not.toBe(discarded.request.operationId)
  }).pipe(Effect.provide(NodeFileSystem.layer)))
