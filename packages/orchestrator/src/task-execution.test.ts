import { it } from "@effect/vitest"
import { Effect, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  AmbiguousTaskExecutionReported,
  AttemptId,
  CoordinatorOwnershipLost,
  FailedProcessExitCode,
  FailedTaskExecutionReported,
  GitCommitSha,
  GitCommonDirectoryLocator,
  InterruptedTaskExecutionReported,
  makeTaskExecutionOperation,
  NoTaskExecutionReported,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  ResourceEmergencyTaskExecutionReported,
  RunId,
  RunningTaskExecutionReported,
  SuccessfulTaskExecutionReported,
  TaskBranchRef,
  TaskExecutionEvidenceContradiction,
  TaskExecutionIdentityContradiction,
  TaskExecutionLookup,
  TaskExecutionModeContradiction,
  TaskExecutionObservationFailure,
  TaskExecutionOutcomeAmbiguous,
  taskExecutionOutcomeFromReport,
  TaskExecutionRequest,
  TaskExecutionRequestFailure,
  TaskExecutionSessionBinding,
  TaskExecutionSessionConflict,
  TaskExecutionSessionConflictReported,
  TaskExecutionStillRunning,
  TaskExecutor,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskRevision,
  taskRevisionFor,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorkerProcessId,
  WorktreeLocator
} from "./index.js"
import { runTaskExecutionProtocol, taskExecutionTraceObserver } from "./workflow.js"

const operationId = OperationId.make("execution-operation")
const sessionId = TaskWorkSessionId.make("execution-session")
const task = {
  id: TaskId.make("execution-task"),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("execution-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/execution"),
  executor: TaskExecutorLocator.make("executor:scripted"),
  runId: RunId.make("execution-run"),
  session: TaskWorkSessionLocator.make("session:execution"),
  taskId: task.id,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/dalph-execution")
})

const request = TaskExecutionRequest.make({
  operationId,
  plannedAttempt,
  session: TaskExecutionSessionBinding.cases.EstablishedSession.make({ sessionId }),
  task
})
const operation = makeTaskExecutionOperation({
  predecessorOperationIds: [OperationId.make("establish-session")],
  request
})

it.effect("reconciles an uncertain request into an exact nonzero process outcome", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const executor = TaskExecutor.of({
      requestTaskExecution: () =>
        Ref.update(requests, (count) => count + 1).pipe(Effect.andThen(
          Effect.fail(
            new TaskExecutionRequestFailure({
              detail: "adapter disconnected after send",
              observationId: ProviderObservationId.make("request-failed"),
              operationId
            })
          )
        )),
      observeTaskExecution: () =>
        Effect.succeed(FailedTaskExecutionReported.make({
          exitCode: FailedProcessExitCode.make(17),
          observationId: ProviderObservationId.make("failed-observation"),
          operationId,
          partialOutput: "compiled 3 of 4 files",
          processId: WorkerProcessId.make(202),
          sessionId,
          wipPreserved: true
        }))
    })

    const outcome = yield* runTaskExecutionProtocol(executor, operation, true)
    expect(outcome).toMatchObject({
      _tag: "Failed",
      exitCode: 17,
      operationId,
      partialOutput: "compiled 3 of 4 files",
      sessionId,
      wipPreserved: true
    })
    expect(yield* Ref.get(requests)).toBe(1)
  }))

it.effect("preserves explicit provider resource-emergency evidence as its own terminal outcome", () =>
  Effect.gen(function*() {
    const executor = TaskExecutor.of({
      requestTaskExecution: () => Effect.die("fresh emergency evidence must avoid an unchanged request"),
      observeTaskExecution: () =>
        Effect.succeed(ResourceEmergencyTaskExecutionReported.make({
          cause: "StorageExhausted",
          detail: "provider proved the task volume is full",
          observationId: ProviderObservationId.make("resource-emergency-observation"),
          operationId,
          partialOutput: "retained partial work",
          processId: WorkerProcessId.make(212),
          sessionId,
          wipPreserved: true
        }))
    })

    expect(yield* runTaskExecutionProtocol(executor, operation, false)).toMatchObject({
      _tag: "ResourceEmergency",
      cause: "StorageExhausted",
      detail: "provider proved the task volume is full",
      partialOutput: "retained partial work",
      wipPreserved: true
    })
  }))

it.effect("emits execution start only from fresh exact process evidence", () =>
  Effect.gen(function*() {
    const tags = yield* Ref.make<ReadonlyArray<string>>([])
    const report = SuccessfulTaskExecutionReported.make({
      observationId: ProviderObservationId.make("success-observation"),
      operationId,
      output: "implementation complete",
      processId: WorkerProcessId.make(206),
      sessionId
    })
    const executor = TaskExecutor.of({
      requestTaskExecution: () =>
        Effect.succeed({
          observationId: ProviderObservationId.make("success-request"),
          providerRequestId: ProviderRequestId.make("success-provider-request")
        }),
      observeTaskExecution: () => Effect.succeed(report)
    })
    const observer = taskExecutionTraceObserver(operation, {
      emit: (item) => Ref.update(tags, (current) => [...current, item._tag])
    })

    const outcome = yield* runTaskExecutionProtocol(executor, operation, true, observer)
    expect(outcome).toMatchObject({ _tag: "Succeeded", operationId, sessionId })
    expect(yield* Ref.get(tags)).toEqual([
      "TaskExecutionRequestReturned",
      "TaskExecutionStarted",
      "TaskExecutionReported"
    ])
  }))

it.effect("does not request execution while resuming an already intended operation", () =>
  Effect.gen(function*() {
    const executor = TaskExecutor.of({
      requestTaskExecution: () => Effect.die("recovery must observe before any repeat"),
      observeTaskExecution: () =>
        Effect.succeed(RunningTaskExecutionReported.make({
          observationId: ProviderObservationId.make("running-observation"),
          operationId,
          processId: WorkerProcessId.make(203),
          sessionId
        }))
    })
    const failure = yield* runTaskExecutionProtocol(executor, operation, false).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(TaskExecutionStillRunning)
    expect(failure).toMatchObject({ report: { operationId, sessionId } })
  }))

it.effect("blocks every stale, replaced, foreign, or untracked session fact", () =>
  Effect.gen(function*() {
    for (const conflict of ["Stale", "Replaced", "Foreign", "Untracked"] as const) {
      const report = TaskExecutionSessionConflictReported.make({
        conflict,
        evidence: { detail: `${conflict} provider correlation`, reportedSessionId: null },
        observationId: ProviderObservationId.make(`conflict:${conflict}`),
        operationId,
        sessionId
      })
      const executor = TaskExecutor.of({
        requestTaskExecution: () =>
          Effect.succeed({
            observationId: ProviderObservationId.make(`request:${conflict}`),
            providerRequestId: ProviderRequestId.make(`provider-request:${conflict}`)
          }),
        observeTaskExecution: () => Effect.succeed(report)
      })
      expect(yield* runTaskExecutionProtocol(executor, operation, true).pipe(Effect.flip))
        .toEqual(new TaskExecutionSessionConflict({ report }))
    }
  }))

it.effect("keeps ambiguous terminal evidence typed and bound to the admission operation", () =>
  Effect.gen(function*() {
    const report = AmbiguousTaskExecutionReported.make({
      detail: "provider lost terminal status",
      observationId: ProviderObservationId.make("ambiguous-observation"),
      operationId,
      partialOutput: "last durable line",
      processId: WorkerProcessId.make(204),
      sessionId,
      wipPreserved: true
    })
    const executor = TaskExecutor.of({
      requestTaskExecution: () =>
        Effect.succeed({
          observationId: ProviderObservationId.make("ambiguous-request"),
          providerRequestId: ProviderRequestId.make("ambiguous-provider-request")
        }),
      observeTaskExecution: () => Effect.succeed(report)
    })
    expect(yield* runTaskExecutionProtocol(executor, operation, true).pipe(Effect.flip))
      .toEqual(new TaskExecutionOutcomeAmbiguous({ report }))
  }))

it.effect("rejects mismatched operation evidence and locator-only live execution", () =>
  Effect.gen(function*() {
    const traceTags = yield* Ref.make<ReadonlyArray<string>>([])
    const mismatch = RunningTaskExecutionReported.make({
      observationId: ProviderObservationId.make("mismatch-observation"),
      operationId: OperationId.make("replacement-operation"),
      processId: WorkerProcessId.make(205),
      sessionId
    })
    const executor = TaskExecutor.of({
      requestTaskExecution: () =>
        Effect.succeed({
          observationId: ProviderObservationId.make("mismatch-request"),
          providerRequestId: ProviderRequestId.make("mismatch-provider-request")
        }),
      observeTaskExecution: () => Effect.succeed(mismatch)
    })
    const observer = taskExecutionTraceObserver(operation, {
      emit: (item) => Ref.update(traceTags, (current) => [...current, item._tag])
    })
    expect(yield* runTaskExecutionProtocol(executor, operation, true, observer).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionEvidenceContradiction)
    expect(yield* Ref.get(traceTags)).toEqual(["TaskExecutionRequestReturned"])

    const sessionMismatchExecutor = TaskExecutor.of({
      requestTaskExecution: executor.requestTaskExecution,
      observeTaskExecution: () =>
        Effect.succeed(RunningTaskExecutionReported.make({
          observationId: ProviderObservationId.make("session-mismatch-observation"),
          operationId,
          processId: WorkerProcessId.make(207),
          sessionId: TaskWorkSessionId.make("foreign-execution-session")
        }))
    })
    expect(
      yield* runTaskExecutionProtocol(
        sessionMismatchExecutor,
        operation,
        true,
        observer
      ).pipe(Effect.flip)
    ).toBeInstanceOf(TaskExecutionEvidenceContradiction)
    expect(yield* Ref.get(traceTags)).toEqual([
      "TaskExecutionRequestReturned",
      "TaskExecutionRequestReturned"
    ])

    const replacementFailureExecutor = TaskExecutor.of({
      requestTaskExecution: () =>
        Effect.succeed({
          observationId: ProviderObservationId.make("replacement-failure-request"),
          providerRequestId: ProviderRequestId.make("replacement-failure-provider-request")
        }),
      observeTaskExecution: () =>
        Effect.fail(
          new TaskExecutionObservationFailure({
            detail: "adapter replaced the admitted identity",
            observationId: ProviderObservationId.make("replacement-failure-observation"),
            operationId: OperationId.make("replacement-failure-operation")
          })
        )
    })
    expect(
      yield* runTaskExecutionProtocol(replacementFailureExecutor, operation, true).pipe(Effect.flip)
    ).toBeInstanceOf(TaskExecutionIdentityContradiction)

    const simulated = makeTaskExecutionOperation({
      predecessorOperationIds: [],
      request: TaskExecutionRequest.make({
        operationId,
        plannedAttempt,
        session: TaskExecutionSessionBinding.cases.PlannedSession.make({
          session: plannedAttempt.session
        }),
        task
      })
    })
    expect(yield* runTaskExecutionProtocol(executor, simulated, true).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionModeContradiction)
  }))

it.effect("preserves typed request and observation adapter failures in protocol traces", () =>
  Effect.gen(function*() {
    const tags = yield* Ref.make<ReadonlyArray<string>>([])
    const observer = taskExecutionTraceObserver(operation, {
      emit: (item) => Ref.update(tags, (current) => [...current, item._tag])
    })
    const requestFailure = new TaskExecutionRequestFailure({
      detail: "request return was uncertain",
      observationId: ProviderObservationId.make("typed-request-failure"),
      operationId
    })
    const observationFailure = new TaskExecutionObservationFailure({
      detail: "provider observation unavailable",
      observationId: ProviderObservationId.make("typed-observation-failure"),
      operationId
    })
    const executor = TaskExecutor.of({
      requestTaskExecution: () => Effect.fail(requestFailure),
      observeTaskExecution: () => Effect.fail(observationFailure)
    })
    expect(yield* runTaskExecutionProtocol(executor, operation, true, observer).pipe(Effect.flip))
      .toEqual(observationFailure)
    expect(yield* Ref.get(tags)).toEqual([
      "TaskExecutionRequestFailed",
      "TaskExecutionObservationFailed"
    ])

    const replacementRequestFailure = new TaskExecutionRequestFailure({
      ...requestFailure,
      operationId: OperationId.make("replacement-request-operation")
    })
    expect(
      yield* runTaskExecutionProtocol(
        TaskExecutor.of({
          requestTaskExecution: () => Effect.fail(replacementRequestFailure),
          observeTaskExecution: () => Effect.die("identity contradiction must stop observation")
        }),
        operation,
        true
      ).pipe(Effect.flip)
    ).toBeInstanceOf(TaskExecutionIdentityContradiction)

    const ownershipLost = new CoordinatorOwnershipLost({
      gitCommonDirectory: GitCommonDirectoryLocator.make("/tmp/dalph-ownership-lost")
    })
    expect(
      yield* runTaskExecutionProtocol(
        TaskExecutor.of({
          requestTaskExecution: () => Effect.fail(ownershipLost),
          observeTaskExecution: () => Effect.die("ownership loss must stop observation")
        }),
        operation,
        true
      ).pipe(Effect.flip)
    ).toEqual(ownershipLost)
  }))

it.effect("classifies direct absence, interruption, and foreign evidence outcomes", () =>
  Effect.gen(function*() {
    const lookup = TaskExecutionLookup.make({ operationId, plannedAttempt, sessionId })
    const absent = NoTaskExecutionReported.make({
      observationId: ProviderObservationId.make("direct-absence"),
      operationId,
      sessionId
    })
    expect(yield* taskExecutionOutcomeFromReport(lookup, absent).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionEvidenceContradiction)

    const interrupted = InterruptedTaskExecutionReported.make({
      observationId: ProviderObservationId.make("direct-interruption"),
      operationId,
      partialOutput: "preserved interruption output",
      processId: WorkerProcessId.make(208),
      sessionId,
      wipPreserved: true
    })
    expect(yield* taskExecutionOutcomeFromReport(lookup, interrupted)).toMatchObject({
      _tag: "Interrupted",
      partialOutput: "preserved interruption output"
    })

    const foreign = RunningTaskExecutionReported.make({
      observationId: ProviderObservationId.make("direct-foreign"),
      operationId: OperationId.make("direct-foreign-operation"),
      processId: WorkerProcessId.make(209),
      sessionId
    })
    expect(yield* taskExecutionOutcomeFromReport(lookup, foreign).pipe(Effect.flip))
      .toBeInstanceOf(TaskExecutionEvidenceContradiction)
  }))

it("rejects invalid task revisions and accepts every positive safe-integer process exit", () => {
  expect(() =>
    TaskExecutionRequest.make({
      ...request,
      plannedAttempt: PlannedTaskAttempt.make({
        ...plannedAttempt,
        taskId: TaskId.make("foreign-request-task")
      })
    })
  ).toThrow()
  expect(() =>
    TaskExecutionRequest.make({
      ...request,
      plannedAttempt: PlannedTaskAttempt.make({
        ...plannedAttempt,
        taskRevision: TaskRevision.make("foreign-revision")
      })
    })
  ).toThrow()
  expect(() => Schema.decodeUnknownSync(FailedProcessExitCode)(0)).toThrow()
  expect(Schema.decodeUnknownSync(FailedProcessExitCode)(256)).toBe(256)
  expect(Schema.decodeUnknownSync(FailedProcessExitCode)(Number.MAX_SAFE_INTEGER))
    .toBe(Number.MAX_SAFE_INTEGER)
  expect(() => Schema.decodeUnknownSync(FailedProcessExitCode)(Number.MAX_SAFE_INTEGER + 1)).toThrow()
})
