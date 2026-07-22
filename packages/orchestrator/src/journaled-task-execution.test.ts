import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { recordReadyWorktreeEvidence } from "../test/task-worktree-evidence.js"
import {
  AttemptId,
  FailedProcessExitCode,
  FailedTaskExecutionReported,
  GitCommitSha,
  journaledWorkflowInterpreterLayer,
  JournalRecordKey,
  JournalStore,
  makeTaskAttemptPlanOperation,
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  MatchingTaskWorkSessionReported,
  memoryJournalStoreLayer,
  NoTaskExecutionReported,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  recoverTaskExecutions,
  RunId,
  RunningTaskExecutionReported,
  TaskAttemptPlannedEvent,
  TaskBranchRef,
  TaskExecutionHistoryContradiction,
  TaskExecutionObservationFailure,
  TaskExecutionReportContradiction,
  TaskExecutionRequest,
  TaskExecutionRequestFailure,
  TaskExecutionRunContradiction,
  TaskExecutionSessionBinding,
  TaskExecutor,
  TaskExecutorLocator,
  type TaskExecutorService,
  TaskId,
  TaskLifecycle,
  taskRevisionFor,
  TaskRunner,
  taskRunnerWorkflowInterpreterLayer,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TaskWorkStartRequest,
  TrackerGraphReader,
  WorkerProcessId,
  WorkflowInterpreter,
  WorkflowOutcome,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  TaskExecutionIntentRecorded,
  TaskExecutionOutcomeObservedEvent,
  TaskExecutionReported,
  taskExecutionReportedRecordKey,
  TaskExecutionRequestAttemptRecorded,
  taskExecutionRequestAttemptRecordKey,
  TaskExecutionRequestFailed,
  taskExecutionRequestFailedRecordKey,
  TaskExecutionRequestReturned,
  taskExecutionRequestReturnedRecordKey,
  TaskWorkSessionEstablishedEvent,
  TaskWorkSessionEstablishmentIntentRecorded
} from "./journal-store.js"

const runId = RunId.make("journaled-execution-run")
const sessionId = TaskWorkSessionId.make("journaled-execution-session")
const task = {
  id: TaskId.make("journaled-execution-task"),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("journaled-execution-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/journaled-execution"),
  executor: TaskExecutorLocator.make("executor:journaled"),
  runId,
  session: TaskWorkSessionLocator.make("session:journaled-execution"),
  taskId: task.id,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/dalph-journaled-execution")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("journaled-execution-plan"),
  plannedAttempt,
  predecessorOperationIds: []
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("journaled-execution-worktree"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const sessionOperation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
  request: TaskWorkStartRequest.make({
    operationId: OperationId.make("journaled-execution-session-operation"),
    plannedAttempt,
    task
  })
})
const operation = makeTaskExecutionOperation({
  predecessorOperationIds: [sessionOperation.request.operationId],
  request: TaskExecutionRequest.make({
    operationId: OperationId.make("journaled-execution-operation"),
    plannedAttempt,
    session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
    task
  })
})

const replacementSessionId = TaskWorkSessionId.make("journaled-execution-replacement-session")
const replacementSessionOperation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
  request: TaskWorkStartRequest.make({
    operationId: OperationId.make("journaled-execution-replacement-session-operation"),
    plannedAttempt,
    task
  })
})
const replacementOperation = makeTaskExecutionOperation({
  predecessorOperationIds: [replacementSessionOperation.request.operationId],
  request: TaskExecutionRequest.make({
    operationId: operation.request.operationId,
    plannedAttempt,
    session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
      sessionId: replacementSessionId
    }),
    task
  })
})

const seedEstablishedSession = Effect.fn("Test.seedEstablishedSession")(function*(
  establishment = sessionOperation,
  establishedSessionId = sessionId
) {
  const journal = yield* JournalStore
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: 2 })
  )
  yield* recordReadyWorktreeEvidence(worktreeOperation)
  yield* journal.append(
    runId,
    intentRecordKey(establishment.request.operationId),
    TaskWorkSessionEstablishmentIntentRecorded.make({ operation: establishment, version: 2 })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(establishment.request.operationId),
    TaskWorkSessionEstablishedEvent.make({
      outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
        operationId: establishment.request.operationId,
        sessionId: establishedSessionId
      }),
      version: 2
    })
  )
})

const seedSessionIntentOnly = Effect.fn("Test.seedSessionIntentOnly")(function*(
  establishment = sessionOperation
) {
  const journal = yield* JournalStore
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: 2 })
  )
  yield* recordReadyWorktreeEvidence(worktreeOperation)
  yield* journal.append(
    runId,
    intentRecordKey(establishment.request.operationId),
    TaskWorkSessionEstablishmentIntentRecorded.make({ operation: establishment, version: 2 })
  )
})

const runnerLayer = Layer.succeed(
  TaskRunner,
  TaskRunner.of({
    lookupTaskWorkSession: () =>
      Effect.succeed(MatchingTaskWorkSessionReported.make({
        observationId: ProviderObservationId.make("unused-session-observation"),
        sessionId,
        work: { _tag: "NoProviderWorkReported" }
      })),
    requestTaskWorkStart: () =>
      Effect.succeed({
        observationId: ProviderObservationId.make("unused-session-request-observation"),
        providerRequestId: ProviderRequestId.make("unused-session-request")
      })
  })
)

const supportLayer = Layer.mergeAll(
  runnerLayer,
  Layer.succeed(TrackerGraphReader, TrackerGraphReader.of({ read: () => Effect.die("unused graph") })),
  Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
)

const journaledLayerFor = (executor: TaskExecutorService) =>
  journaledWorkflowInterpreterLayer(
    runId,
    taskRunnerWorkflowInterpreterLayer,
    Layer.succeed(TaskExecutor, executor)
  ).pipe(Layer.provide(supportLayer))

it.effect("journals intent before process request and preserves exact nonzero outcome", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    const requests = yield* Ref.make(0)
    const observations = yield* Ref.make(0)
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () =>
          Effect.gen(function*() {
            const records = yield* journal.read(runId).pipe(Effect.orDie)
            expect(records.some(({ event }) =>
              event._tag === "TaskExecutionIntentRecorded"
              && event.operation.request.operationId === operation.request.operationId
            )).toBe(true)
            yield* Ref.update(requests, (count) => count + 1)
            return {
              observationId: ProviderObservationId.make("journaled-execution-request-observation"),
              providerRequestId: ProviderRequestId.make("journaled-execution-provider-request")
            }
          }),
        observeTaskExecution: () =>
          Ref.update(observations, (count) => count + 1).pipe(Effect.as(
            FailedTaskExecutionReported.make({
              exitCode: FailedProcessExitCode.make(9),
              observationId: ProviderObservationId.make("journaled-execution-observation"),
              operationId: operation.request.operationId,
              partialOutput: "partial manifest",
              processId: WorkerProcessId.make(301),
              sessionId,
              wipPreserved: true
            })
          ))
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))

    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(layer))
    const first = yield* interpreter.executeTaskWork(operation)
    const second = yield* interpreter.executeTaskWork(operation)
    expect(first).toEqual(second)
    expect(first.outcome).toMatchObject({
      _tag: "Failed",
      operationId: operation.request.operationId,
      sessionId,
      wipPreserved: true
    })
    expect(yield* Ref.get(requests)).toBe(1)
    expect(yield* Ref.get(observations)).toBe(1)
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toContain("TaskExecutionReported")
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects execution before any adapter effect when durable session evidence is missing", () =>
  Effect.gen(function*() {
    const calls = yield* Ref.make(0)
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.die("must not request"))),
        observeTaskExecution: () =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.die("must not observe")))
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(layer))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionHistoryContradiction)
    expect(yield* Ref.get(calls)).toBe(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("restart safely makes the first request after an intent-only crash", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    const requests = yield* Ref.make(0)
    const observations = yield* Ref.make(0)
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () =>
          Ref.update(requests, (count) => count + 1).pipe(Effect.as({
            observationId: ProviderObservationId.make("recovered-first-request-observation"),
            providerRequestId: ProviderRequestId.make("recovered-first-provider-request")
          })),
        observeTaskExecution: () =>
          Ref.update(observations, (count) => count + 1).pipe(Effect.as(
            FailedTaskExecutionReported.make({
              exitCode: FailedProcessExitCode.make(11),
              observationId: ProviderObservationId.make("recovered-execution-observation"),
              operationId: operation.request.operationId,
              partialOutput: "recovered partial output",
              processId: WorkerProcessId.make(302),
              sessionId,
              wipPreserved: true
            })
          ))
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    yield* recoverTaskExecutions(runId).pipe(
      Effect.provide(layer),
      Effect.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
    )
    expect(yield* Ref.get(requests)).toBe(1)
    expect(yield* Ref.get(observations)).toBe(1)
    expect((yield* journal.read(runId)).map(({ event }) => event._tag))
      .toContain("TaskExecutionOutcomeObserved")
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("restart observes before repeating after the durable request-attempt boundary", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionRequestAttemptRecordKey(operation.request.operationId),
      TaskExecutionRequestAttemptRecorded.make({ request: operation.request, version: 2 })
    )
    const observations = yield* Ref.make(0)
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("recovery cannot repeat an ambiguous request"),
        observeTaskExecution: () =>
          Ref.update(observations, (count) => count + 1).pipe(Effect.as(
            FailedTaskExecutionReported.make({
              exitCode: FailedProcessExitCode.make(12),
              observationId: ProviderObservationId.make("attempt-boundary-observation"),
              operationId: operation.request.operationId,
              partialOutput: "preserved after ambiguous request",
              processId: WorkerProcessId.make(303),
              sessionId,
              wipPreserved: true
            })
          ))
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    yield* recoverTaskExecutions(runId).pipe(
      Effect.provide(layer),
      Effect.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
    )
    expect(yield* Ref.get(observations)).toBe(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("completes an exact request after request-attempt crash and authoritative absence", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionRequestAttemptRecordKey(operation.request.operationId),
      TaskExecutionRequestAttemptRecorded.make({ request: operation.request, version: 2 })
    )
    const requests = yield* Ref.make(0)
    const observations = yield* Ref.make(0)
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () =>
          Ref.update(requests, (count) => count + 1).pipe(Effect.as({
            observationId: ProviderObservationId.make("completed-attempt-request-observation"),
            providerRequestId: ProviderRequestId.make("completed-attempt-provider-request")
          })),
        observeTaskExecution: () =>
          Ref.getAndUpdate(observations, (count) => count + 1).pipe(Effect.map((count) =>
            count === 0
              ? NoTaskExecutionReported.make({
                observationId: ProviderObservationId.make("confirmed-absence-observation"),
                operationId: operation.request.operationId,
                sessionId
              })
              : FailedTaskExecutionReported.make({
                exitCode: FailedProcessExitCode.make(17),
                observationId: ProviderObservationId.make("completed-attempt-observation"),
                operationId: operation.request.operationId,
                partialOutput: "requested after confirmed absence",
                processId: WorkerProcessId.make(307),
                sessionId,
                wipPreserved: true
              })
          ))
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(layer))
    const outcome = yield* interpreter.executeTaskWork(operation)
    expect(outcome.outcome).toMatchObject({ _tag: "Failed", exitCode: 17 })
    expect(yield* Ref.get(requests)).toBe(1)
    expect(yield* Ref.get(observations)).toBe(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects completed replay against a different exact request before adapter calls", () =>
  Effect.gen(function*() {
    yield* seedEstablishedSession()
    yield* seedEstablishedSession(replacementSessionOperation, replacementSessionId)
    const calls = yield* Ref.make(0)
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.as({
            observationId: ProviderObservationId.make("replay-request-observation"),
            providerRequestId: ProviderRequestId.make("replay-provider-request")
          })),
        observeTaskExecution: (lookup) =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.as(
            FailedTaskExecutionReported.make({
              exitCode: FailedProcessExitCode.make(13),
              observationId: ProviderObservationId.make("replay-terminal-observation"),
              operationId: lookup.operationId,
              partialOutput: "old session output",
              processId: WorkerProcessId.make(304),
              sessionId: lookup.sessionId,
              wipPreserved: true
            })
          ))
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(layer))
    yield* interpreter.executeTaskWork(operation)
    const callsBeforeReplay = yield* Ref.get(calls)
    const failure = yield* interpreter.executeTaskWork(replacementOperation).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskExecutionHistoryContradiction)
    expect(failure).toMatchObject({ reason: "IntentMismatch" })
    expect(yield* Ref.get(calls)).toBe(callsBeforeReplay)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("converges the same terminal evidence from a new observation after a crash", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    const report = FailedTaskExecutionReported.make({
      exitCode: FailedProcessExitCode.make(14),
      observationId: ProviderObservationId.make("durable-terminal-observation"),
      operationId: operation.request.operationId,
      partialOutput: "durable terminal output",
      processId: WorkerProcessId.make(305),
      sessionId,
      wipPreserved: true
    })
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionRequestAttemptRecordKey(operation.request.operationId),
      TaskExecutionRequestAttemptRecorded.make({ request: operation.request, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionReportedRecordKey(operation.request.operationId, report.observationId),
      TaskExecutionReported.make({
        operationId: operation.request.operationId,
        report,
        version: 2
      })
    )
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("terminal replay cannot repeat the request"),
        observeTaskExecution: () =>
          Effect.succeed(FailedTaskExecutionReported.make({
            ...report,
            observationId: ProviderObservationId.make("fresh-equivalent-terminal-observation")
          }))
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(layer))
    const outcome = yield* interpreter.executeTaskWork(operation)
    expect(outcome.outcome).toMatchObject({ _tag: "Failed", exitCode: 14 })
    expect((yield* journal.read(runId)).map(({ event }) => event._tag))
      .toContain("TaskExecutionOutcomeObserved")
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects changed terminal evidence after a report-to-outcome crash", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    const durableReport = FailedTaskExecutionReported.make({
      exitCode: FailedProcessExitCode.make(15),
      observationId: ProviderObservationId.make("conflict-durable-observation"),
      operationId: operation.request.operationId,
      partialOutput: "durable output",
      processId: WorkerProcessId.make(306),
      sessionId,
      wipPreserved: true
    })
    const freshReport = FailedTaskExecutionReported.make({
      ...durableReport,
      exitCode: FailedProcessExitCode.make(16),
      observationId: ProviderObservationId.make("conflict-fresh-observation")
    })
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionRequestAttemptRecordKey(operation.request.operationId),
      TaskExecutionRequestAttemptRecorded.make({ request: operation.request, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionReportedRecordKey(operation.request.operationId, durableReport.observationId),
      TaskExecutionReported.make({
        operationId: operation.request.operationId,
        report: durableReport,
        version: 2
      })
    )
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("terminal replay cannot repeat the request"),
        observeTaskExecution: () => Effect.succeed(freshReport)
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(layer))
    const failure = yield* interpreter.executeTaskWork(operation).pipe(Effect.flip)
    expect(failure).toEqual(
      new TaskExecutionReportContradiction({
        durableReport,
        freshReport,
        operationId: operation.request.operationId
      })
    )
    const reports = (yield* journal.read(runId)).filter(({ event }) => event._tag === "TaskExecutionReported")
    expect(reports).toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects a replacement process after a durable running report", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    const runningReport = RunningTaskExecutionReported.make({
      observationId: ProviderObservationId.make("durable-running-observation"),
      operationId: operation.request.operationId,
      processId: WorkerProcessId.make(308),
      sessionId
    })
    const replacementReport = FailedTaskExecutionReported.make({
      exitCode: FailedProcessExitCode.make(18),
      observationId: ProviderObservationId.make("replacement-process-observation"),
      operationId: operation.request.operationId,
      partialOutput: "foreign replacement output",
      processId: WorkerProcessId.make(309),
      sessionId,
      wipPreserved: true
    })
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionRequestAttemptRecordKey(operation.request.operationId),
      TaskExecutionRequestAttemptRecorded.make({ request: operation.request, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionReportedRecordKey(operation.request.operationId, runningReport.observationId),
      TaskExecutionReported.make({
        operationId: operation.request.operationId,
        report: runningReport,
        version: 2
      })
    )
    const executorLayer = Layer.succeed(
      TaskExecutor,
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("running recovery cannot repeat the request"),
        observeTaskExecution: () => Effect.succeed(replacementReport)
      })
    )
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer,
      executorLayer
    ).pipe(Layer.provide(supportLayer))
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(layer))
    const failure = yield* interpreter.executeTaskWork(operation).pipe(Effect.flip)
    expect(failure).toEqual(
      new TaskExecutionReportContradiction({
        durableReport: runningReport,
        freshReport: replacementReport,
        operationId: operation.request.operationId
      })
    )
    expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "TaskExecutionReported")).toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("journals typed request and observation failures before returning them", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    const requestFailure = new TaskExecutionRequestFailure({
      detail: "journaled uncertain request",
      observationId: ProviderObservationId.make("journaled-request-failure"),
      operationId: operation.request.operationId
    })
    const observationFailure = new TaskExecutionObservationFailure({
      detail: "journaled unreadable observation",
      observationId: ProviderObservationId.make("journaled-observation-failure"),
      operationId: operation.request.operationId
    })
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.fail(requestFailure),
        observeTaskExecution: () => Effect.fail(observationFailure)
      })
    )))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toEqual(observationFailure)
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual(
      expect.arrayContaining([
        "TaskExecutionRequestFailed",
        "TaskExecutionObservationFailed"
      ])
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects execution for another run and locator-only live execution", () =>
  Effect.gen(function*() {
    const calls = yield* Ref.make(0)
    const executor = TaskExecutor.of({
      requestTaskExecution: () =>
        Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.die("unexpected request"))),
      observeTaskExecution: () =>
        Ref.update(calls, (count) => count + 1).pipe(Effect.andThen(Effect.die("unexpected observation")))
    })
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(executor)))
    const foreignAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      runId: RunId.make("foreign-journaled-execution-run")
    })
    const foreignOperation = makeTaskExecutionOperation({
      predecessorOperationIds: operation.predecessorOperationIds,
      request: TaskExecutionRequest.make({
        ...operation.request,
        plannedAttempt: foreignAttempt
      })
    })
    expect(yield* interpreter.executeTaskWork(foreignOperation).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionRunContradiction)

    yield* seedEstablishedSession()
    const plannedOperation = makeTaskExecutionOperation({
      predecessorOperationIds: operation.predecessorOperationIds,
      request: TaskExecutionRequest.make({
        ...operation.request,
        operationId: OperationId.make("planned-journaled-execution"),
        session: TaskExecutionSessionBinding.cases.PlannedSession.make({
          session: plannedAttempt.session
        })
      })
    })
    expect(yield* interpreter.executeTaskWork(plannedOperation).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionModeContradiction" })
    expect(yield* Ref.get(calls)).toBe(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects duplicate execution intents and outcomes without exact intent", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      JournalRecordKey.make("test:duplicate-execution-intent"),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("duplicate intent must stop request"),
        observeTaskExecution: () => Effect.die("duplicate intent must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionHistoryContradiction", reason: "MultipleIntents" })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects a durable outcome that has no exact execution intent", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    const outcome = WorkflowOutcome.cases.TaskExecutionObserved.make({
      outcome: {
        _tag: "Failed",
        exitCode: FailedProcessExitCode.make(24),
        observationId: ProviderObservationId.make("orphan-outcome-observation"),
        operationId: operation.request.operationId,
        partialOutput: "orphan outcome",
        processId: WorkerProcessId.make(410),
        sessionId,
        wipPreserved: true
      }
    })
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.request.operationId),
      TaskExecutionOutcomeObservedEvent.make({ outcome, version: 2 })
    )
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("orphan outcome must stop request"),
        observeTaskExecution: () => Effect.die("orphan outcome must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionHistoryContradiction", reason: "OutcomeWithoutIntent" })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects contradictory terminal reports already present in the journal", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionRequestAttemptRecordKey(operation.request.operationId),
      TaskExecutionRequestAttemptRecorded.make({ request: operation.request, version: 2 })
    )
    const first = FailedTaskExecutionReported.make({
      exitCode: FailedProcessExitCode.make(25),
      observationId: ProviderObservationId.make("first-durable-conflict"),
      operationId: operation.request.operationId,
      partialOutput: "first terminal evidence",
      processId: WorkerProcessId.make(411),
      sessionId,
      wipPreserved: true
    })
    const second = FailedTaskExecutionReported.make({
      ...first,
      exitCode: FailedProcessExitCode.make(26),
      observationId: ProviderObservationId.make("second-durable-conflict")
    })
    for (const report of [first, second]) {
      yield* journal.append(
        runId,
        taskExecutionReportedRecordKey(operation.request.operationId, report.observationId),
        TaskExecutionReported.make({
          operationId: operation.request.operationId,
          report,
          version: 2
        })
      )
    }
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("durable conflict must stop request"),
        observeTaskExecution: () => Effect.die("durable conflict must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionReportContradiction)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("recovers legacy request-failure evidence without repeating the request", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    const requestFailure = new TaskExecutionRequestFailure({
      detail: "legacy request failure evidence",
      observationId: ProviderObservationId.make("legacy-request-failure"),
      operationId: operation.request.operationId
    })
    yield* journal.append(
      runId,
      taskExecutionRequestFailedRecordKey(operation.request.operationId, requestFailure.observationId),
      TaskExecutionRequestFailed.make({ failure: requestFailure, request: operation.request, version: 2 })
    )
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("legacy uncertain request cannot repeat"),
        observeTaskExecution: () =>
          Effect.succeed(FailedTaskExecutionReported.make({
            exitCode: FailedProcessExitCode.make(27),
            observationId: ProviderObservationId.make("legacy-recovered-observation"),
            operationId: operation.request.operationId,
            partialOutput: "legacy recovered output",
            processId: WorkerProcessId.make(412),
            sessionId,
            wipPreserved: true
          }))
      })
    )))
    expect((yield* interpreter.executeTaskWork(operation)).outcome).toMatchObject({ exitCode: 27 })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("recovers legacy request acknowledgement without repeating the request", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    const acknowledgement = {
      observationId: ProviderObservationId.make("legacy-request-returned"),
      providerRequestId: ProviderRequestId.make("legacy-provider-request-returned")
    }
    yield* journal.append(
      runId,
      taskExecutionRequestReturnedRecordKey(
        operation.request.operationId,
        acknowledgement.observationId
      ),
      TaskExecutionRequestReturned.make({
        acknowledgement,
        operationId: operation.request.operationId,
        version: 2
      })
    )
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("acknowledged request cannot repeat"),
        observeTaskExecution: () =>
          Effect.succeed(FailedTaskExecutionReported.make({
            exitCode: FailedProcessExitCode.make(28),
            observationId: ProviderObservationId.make("legacy-acknowledgement-recovery"),
            operationId: operation.request.operationId,
            partialOutput: "legacy acknowledgement recovery",
            processId: WorkerProcessId.make(413),
            sessionId,
            wipPreserved: true
          }))
      })
    )))
    expect((yield* interpreter.executeTaskWork(operation)).outcome).toMatchObject({ exitCode: 28 })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects replacement process identities already durable in journal history", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      intentRecordKey(operation.request.operationId),
      TaskExecutionIntentRecorded.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      taskExecutionRequestAttemptRecordKey(operation.request.operationId),
      TaskExecutionRequestAttemptRecorded.make({ request: operation.request, version: 2 })
    )
    for (const [observation, processId] of [["durable-process-a", 414], ["durable-process-b", 415]] as const) {
      const report = RunningTaskExecutionReported.make({
        observationId: ProviderObservationId.make(observation),
        operationId: operation.request.operationId,
        processId: WorkerProcessId.make(processId),
        sessionId
      })
      yield* journal.append(
        runId,
        taskExecutionReportedRecordKey(operation.request.operationId, report.observationId),
        TaskExecutionReported.make({
          operationId: operation.request.operationId,
          report,
          version: 2
        })
      )
    }
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("durable replacement must stop request"),
        observeTaskExecution: () => Effect.die("durable replacement must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionReportContradiction)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("distinguishes missing and multiple durable session outcomes", () =>
  Effect.gen(function*() {
    yield* seedSessionIntentOnly()
    const deadExecutor = TaskExecutor.of({
      requestTaskExecution: () => Effect.die("session history must stop request"),
      observeTaskExecution: () => Effect.die("session history must stop observation")
    })
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(deadExecutor)))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionHistoryContradiction", reason: "MissingSessionOutcome" })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects multiple durable session outcomes", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedEstablishedSession()
    yield* journal.append(
      runId,
      JournalRecordKey.make("test:duplicate-session-outcome"),
      TaskWorkSessionEstablishedEvent.make({
        outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
          operationId: sessionOperation.request.operationId,
          sessionId
        }),
        version: 2
      })
    )
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("multiple outcomes must stop request"),
        observeTaskExecution: () => Effect.die("multiple outcomes must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionHistoryContradiction", reason: "MultipleSessionOutcomes" })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects mismatched durable session identity", () =>
  Effect.gen(function*() {
    yield* seedEstablishedSession(sessionOperation, replacementSessionId)
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("session mismatch must stop request"),
        observeTaskExecution: () => Effect.die("session mismatch must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(operation).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionHistoryContradiction", reason: "SessionMismatch" })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects multiple causal session intents and attempt mismatch", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* seedSessionIntentOnly()
    yield* journal.append(
      runId,
      intentRecordKey(replacementSessionOperation.request.operationId),
      TaskWorkSessionEstablishmentIntentRecorded.make({
        operation: replacementSessionOperation,
        version: 2
      })
    )
    const multiplePredecessors = makeTaskExecutionOperation({
      predecessorOperationIds: [
        sessionOperation.request.operationId,
        replacementSessionOperation.request.operationId
      ],
      request: operation.request
    })
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("session intent contradiction must stop request"),
        observeTaskExecution: () => Effect.die("session intent contradiction must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(multiplePredecessors).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionHistoryContradiction", reason: "MultipleSessionIntents" })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects a causal session intent for a different planned attempt", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const foreignAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      worktree: WorktreeLocator.make("/tmp/foreign-session-attempt")
    })
    const foreignEstablishment = makeTaskWorkSessionEstablishmentOperation({
      predecessorOperationIds: [],
      request: TaskWorkStartRequest.make({
        operationId: OperationId.make("foreign-session-establishment"),
        plannedAttempt: foreignAttempt,
        task
      })
    })
    yield* journal.append(
      runId,
      intentRecordKey(foreignEstablishment.request.operationId),
      TaskWorkSessionEstablishmentIntentRecorded.make({
        operation: foreignEstablishment,
        version: 2
      })
    )
    const foreignPredecessor = makeTaskExecutionOperation({
      predecessorOperationIds: [foreignEstablishment.request.operationId],
      request: operation.request
    })
    const interpreter = yield* WorkflowInterpreter.pipe(Effect.provide(journaledLayerFor(
      TaskExecutor.of({
        requestTaskExecution: () => Effect.die("attempt mismatch must stop request"),
        observeTaskExecution: () => Effect.die("attempt mismatch must stop observation")
      })
    )))
    expect(yield* interpreter.executeTaskWork(foreignPredecessor).pipe(Effect.flip))
      .toMatchObject({ _tag: "TaskExecutionHistoryContradiction", reason: "AttemptMismatch" })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it("keeps execution intent a distinct durable domain event", () => {
  expect(TaskExecutionIntentRecorded.make({ operation, version: 2 })._tag)
    .toBe("TaskExecutionIntentRecorded")
})
