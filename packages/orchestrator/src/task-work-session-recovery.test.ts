import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  CoordinatorOwnershipLost,
  FixtureTarget,
  GitCommitSha,
  GitCommonDirectoryLocator,
  journaledWorkflowInterpreterLayer,
  JournalStore,
  JournalStoreContradiction,
  makeTaskWorkSessionEstablishmentOperation,
  makeTrackerGraphObservationOperation,
  MatchingTaskWorkSessionReported,
  memoryJournalStoreLayer,
  NoMatchingTaskWorkSessionReported,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ProviderRequestId,
  recoverTaskWorkSessionEstablishments,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskLifecycle,
  TaskRunner,
  taskRunnerWorkflowInterpreterLayer,
  TaskWorkSessionCorrelationConflict,
  TaskWorkSessionEstablishmentDidNotConverge,
  TaskWorkSessionEvidenceContradiction,
  TaskWorkSessionId,
  TaskWorkSessionLookupDidNotConverge,
  TaskWorkSessionLookupFailure,
  TaskWorkSessionRunContradiction,
  TaskWorkStartRequest,
  TaskWorkStartRequestFailure,
  TraceOutputError,
  TrackerGraphReader,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import {
  intentRecordKey,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorkSessionReported,
  taskWorkSessionReportedRecordKey
} from "./journal-store.js"
import type { TaskRunnerService } from "./task-work-start.js"
import { runTaskWorkSessionEstablishmentProtocol } from "./workflow.js"

const runId = RunId.make("run-recovery")
const operationId = OperationId.make("operation-session-establishment")
const taskId = TaskId.make("task-41")
const task = {
  id: taskId,
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-41"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/task-41"),
  runId,
  taskId,
  worktree: WorktreeLocator.make("/tmp/dalph/task-41")
})
const request = TaskWorkStartRequest.make({ operationId, plannedAttempt, task })
const operation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [OperationId.make("operation-plan-attempt")],
  request
})

it.effect("repeats one exact start request only after fresh authoritative absence", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make<ReadonlyArray<TaskWorkStartRequest>>([])
    const lookupCount = yield* Ref.make(0)
    const runner = TaskRunner.of({
      lookupTaskWorkSession: Effect.fn("TaskRunner.Test.lookup")(function*() {
        const index = yield* Ref.getAndUpdate(lookupCount, (count) => count + 1)
        return index === 0
          ? NoMatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make("observation-absence")
          })
          : MatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make("observation-match"),
            sessionId: TaskWorkSessionId.make("session-41"),
            work: { _tag: "NoProviderWorkReported" }
          })
      }),
      requestTaskWorkStart: Effect.fn("TaskRunner.Test.request")(function*(observed) {
        yield* Ref.update(requests, (current) => [...current, observed])
        const requestNumber = (yield* Ref.get(requests)).length
        return {
          observationId: ProviderObservationId.make(`request-observation-${requestNumber}`),
          providerRequestId: ProviderRequestId.make(`request-${requestNumber}`)
        }
      })
    })
    const interpreterLayer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(TaskRunner, runner)),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )
    const result = yield* Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const outcome = yield* interpreter.establishTaskWorkSession(operation)
      const journal = yield* JournalStore
      const records = yield* journal.read(runId)
      return { outcome, records }
    }).pipe(
      Effect.provide(interpreterLayer)
    )

    expect(result.outcome).toMatchObject({
      _tag: "TaskWorkSessionEstablished",
      operationId,
      sessionId: "session-41"
    })
    expect(yield* Ref.get(requests)).toEqual([request, request])
    expect(yield* Ref.get(lookupCount)).toBe(2)

    expect(result.records.map(({ event }) => event._tag)).toEqual([
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
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("fails closed when a provider reuses one observation identity for another call", () =>
  Effect.gen(function*() {
    const reused = ProviderObservationId.make("reused-provider-observation")
    const runner = TaskRunner.of({
      lookupTaskWorkSession: () =>
        Effect.succeed(MatchingTaskWorkSessionReported.make({
          observationId: reused,
          sessionId: TaskWorkSessionId.make("identity-reuse-session"),
          work: { _tag: "NoProviderWorkReported" }
        })),
      requestTaskWorkStart: () =>
        Effect.succeed({
          observationId: reused,
          providerRequestId: ProviderRequestId.make("identity-reuse-request")
        })
    })
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(TaskRunner, runner)),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )

    const failure = yield* Effect.gen(function*() {
      return yield* (yield* WorkflowInterpreter)
        .establishTaskWorkSession(operation)
        .pipe(Effect.flip)
    }).pipe(Effect.provide(layer))

    expect(failure).toBeInstanceOf(JournalStoreContradiction)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("performs exactly three fresh lookups before typed unreadable non-convergence", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const lookups = yield* Ref.make(0)
    const runner = TaskRunner.of({
      lookupTaskWorkSession: Effect.fn("TaskRunner.Test.unreadable")(function*() {
        const count = yield* Ref.getAndUpdate(lookups, (value) => value + 1)
        return yield* new TaskWorkSessionLookupFailure({
          detail: "registry unavailable",
          observationId: ProviderObservationId.make(`unreadable-${count}`)
        })
      }),
      requestTaskWorkStart: Effect.fn("TaskRunner.Test.initialRequest")(function*() {
        yield* Ref.update(requests, (value) => value + 1)
        return {
          observationId: ProviderObservationId.make("initial-request-observation"),
          providerRequestId: ProviderRequestId.make("initial-request")
        }
      })
    })
    const failure = yield* runTaskWorkSessionEstablishmentProtocol(
      runner,
      operation,
      true
    ).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TaskWorkSessionLookupDidNotConverge)
    expect(yield* Ref.get(requests)).toBe(1)
    expect(yield* Ref.get(lookups)).toBe(3)
  }))

it.effect("does not send a fourth request after absence reaches the lookup bound", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const lookups = yield* Ref.make(0)
    const runner = TaskRunner.of({
      lookupTaskWorkSession: Effect.fn("TaskRunner.Test.absent")(function*() {
        const count = yield* Ref.getAndUpdate(lookups, (value) => value + 1)
        return NoMatchingTaskWorkSessionReported.make({
          observationId: ProviderObservationId.make(`absent-${count}`)
        })
      }),
      requestTaskWorkStart: Effect.fn("TaskRunner.Test.repeatedRequest")(function*() {
        const count = yield* Ref.getAndUpdate(requests, (value) => value + 1)
        return {
          observationId: ProviderObservationId.make(`request-observation-${count}`),
          providerRequestId: ProviderRequestId.make(`request-${count}`)
        }
      })
    })
    const failure = yield* runTaskWorkSessionEstablishmentProtocol(
      runner,
      operation,
      true
    ).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TaskWorkSessionEstablishmentDidNotConverge)
    expect(yield* Ref.get(requests)).toBe(3)
    expect(yield* Ref.get(lookups)).toBe(3)
  }))

it.effect("fails closed on correlation conflict without repeating the request", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const lookups = yield* Ref.make(0)
    const conflict = TaskWorkSessionCorrelationConflict.make({
      conflicts: [{
        detail: "two sessions claim the same operation",
        sessionId: TaskWorkSessionId.make("conflicting-session")
      }],
      observationId: ProviderObservationId.make("conflict")
    })
    const runner = TaskRunner.of({
      lookupTaskWorkSession: () =>
        Ref.update(lookups, (value) => value + 1).pipe(
          Effect.as(conflict)
        ),
      requestTaskWorkStart: () =>
        Ref.update(requests, (value) => value + 1).pipe(
          Effect.as({
            observationId: ProviderObservationId.make("request-observation"),
            providerRequestId: ProviderRequestId.make("request")
          })
        )
    })
    const failure = yield* runTaskWorkSessionEstablishmentProtocol(
      runner,
      operation,
      true
    ).pipe(Effect.flip)

    expect(failure).toEqual(conflict)
    expect(yield* Ref.get(requests)).toBe(1)
    expect(yield* Ref.get(lookups)).toBe(1)
  }))

it.effect("reconstructs an unresolved operation from journal history and replays its outcome", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const lookups = yield* Ref.make(0)
    const runner = TaskRunner.of({
      lookupTaskWorkSession: () =>
        Ref.update(lookups, (value) => value + 1).pipe(
          Effect.as(MatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make("recovery-match"),
            sessionId: TaskWorkSessionId.make("recovered-session"),
            work: { _tag: "NoProviderWorkReported" }
          }))
        ),
      requestTaskWorkStart: () =>
        Ref.update(requests, (value) => value + 1).pipe(
          Effect.as({
            observationId: ProviderObservationId.make("unexpected-request-observation"),
            providerRequestId: ProviderRequestId.make("unexpected-request")
          })
        )
    })
    const traceLayer = Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    )
    const interpreterLayer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(TaskRunner, runner)),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
      )),
      Layer.provide(traceLayer)
    )

    const results = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        intentRecordKey(operationId),
        TaskWorkSessionEstablishmentIntentRecorded.make({ operation, version: 2 })
      )
      const recovered = yield* recoverTaskWorkSessionEstablishments(runId)
      const directReplay = yield* (yield* WorkflowInterpreter)
        .establishTaskWorkSession(operation)
      const replayed = yield* recoverTaskWorkSessionEstablishments(runId)
      return { directReplay, recovered, replayed }
    }).pipe(
      Effect.provide(interpreterLayer),
      Effect.provide(traceLayer)
    )

    expect(results.recovered).toHaveLength(1)
    expect(results.recovered[0]).toMatchObject({
      operationId,
      sessionId: "recovered-session"
    })
    expect(results.directReplay).toEqual(results.recovered[0])
    expect(results.replayed).toEqual([])
    expect(yield* Ref.get(requests)).toBe(0)
    expect(yield* Ref.get(lookups)).toBe(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("propagates every observation failure without crossing the next boundary", () =>
  Effect.gen(function*() {
    const observationFailure = new TraceOutputError({ detail: "trace unavailable" })
    const lookupFailure = new TaskWorkSessionLookupFailure({
      detail: "provider unreadable",
      observationId: ProviderObservationId.make("observer-lookup-failure")
    })
    const startFailure = new TaskWorkStartRequestFailure({
      detail: "provider return was ambiguous",
      observationId: ProviderObservationId.make("observer-start-failure")
    })
    const acknowledgement = {
      observationId: ProviderObservationId.make("observer-request-observation"),
      providerRequestId: ProviderRequestId.make("observer-request")
    }
    const matching = MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make("observer-match"),
      sessionId: TaskWorkSessionId.make("observer-session"),
      work: { _tag: "NoProviderWorkReported" }
    })
    const silent = {
      lookupFailed: () => Effect.void,
      sessionReported: () => Effect.void,
      startFailed: () => Effect.void,
      startRequested: () => Effect.void
    }

    const failures = yield* Effect.all([
      runTaskWorkSessionEstablishmentProtocol(
        TaskRunner.of({
          lookupTaskWorkSession: () => Effect.succeed(matching),
          requestTaskWorkStart: () => Effect.succeed(acknowledgement)
        }),
        operation,
        true,
        { ...silent, startRequested: () => Effect.fail(observationFailure) }
      ).pipe(Effect.flip),
      runTaskWorkSessionEstablishmentProtocol(
        TaskRunner.of({
          lookupTaskWorkSession: () => Effect.succeed(matching),
          requestTaskWorkStart: () => Effect.succeed(acknowledgement)
        }),
        operation,
        false,
        { ...silent, sessionReported: () => Effect.fail(observationFailure) }
      ).pipe(Effect.flip),
      runTaskWorkSessionEstablishmentProtocol(
        TaskRunner.of({
          lookupTaskWorkSession: () => Effect.fail(lookupFailure),
          requestTaskWorkStart: () => Effect.succeed(acknowledgement)
        }),
        operation,
        false,
        { ...silent, lookupFailed: () => Effect.fail(observationFailure) }
      ).pipe(Effect.flip),
      runTaskWorkSessionEstablishmentProtocol(
        TaskRunner.of({
          lookupTaskWorkSession: () => Effect.succeed(matching),
          requestTaskWorkStart: () => Effect.fail(startFailure)
        }),
        operation,
        true,
        { ...silent, startFailed: () => Effect.fail(observationFailure) }
      ).pipe(Effect.flip)
    ])

    expect(failures).toEqual([
      observationFailure,
      observationFailure,
      observationFailure,
      observationFailure
    ])
  }))

it.effect("propagates ownership loss without treating it as a provider failure", () =>
  Effect.gen(function*() {
    const ownershipLost = new CoordinatorOwnershipLost({
      gitCommonDirectory: GitCommonDirectoryLocator.make("/tmp/dalph-ownership-lost")
    })
    const failure = yield* runTaskWorkSessionEstablishmentProtocol(
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("lookup must not run"),
        requestTaskWorkStart: () => Effect.fail(ownershipLost)
      }),
      operation,
      true
    ).pipe(Effect.flip)

    expect(failure).toEqual(ownershipLost)
  }))

it.effect("continues with a fresh lookup after an ambiguous start return", () =>
  Effect.gen(function*() {
    const outcome = yield* runTaskWorkSessionEstablishmentProtocol(
      TaskRunner.of({
        lookupTaskWorkSession: () =>
          Effect.succeed(
            MatchingTaskWorkSessionReported.make({
              observationId: ProviderObservationId.make("post-failure-match"),
              sessionId: TaskWorkSessionId.make("post-failure-session"),
              work: { _tag: "NoProviderWorkReported" }
            })
          ),
        requestTaskWorkStart: () =>
          Effect.fail(
            new TaskWorkStartRequestFailure({
              detail: "request outcome unknown",
              observationId: ProviderObservationId.make("ambiguous-start")
            })
          )
      }),
      operation,
      true
    )

    expect(outcome.sessionId).toBe("post-failure-session")
  }))

it.effect("journals tracker reads idempotently through the same interpreter boundary", () => {
  const snapshot = validSnapshot({ revision: "journaled-read", tasks: [] })
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("journaled-read-operation"),
    FixtureTarget.make("journaled-read-target")
  )
  const baseLayer = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("unused claim acquisition"),
      establishTaskWorkSession: () => Effect.die("unused establishment"),
      readTrackerGraph: () => Effect.succeed(snapshot)
    })
  )
  const layer = journaledWorkflowInterpreterLayer(runId, baseLayer).pipe(
    Layer.provide(Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("unused lookup"),
        requestTaskWorkStart: () => Effect.die("unused request")
      })
    )),
    Layer.provide(Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    ))
  )

  return Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    expect(yield* interpreter.readTrackerGraph(graphOperation)).toEqual(snapshot)
    expect(yield* interpreter.readTrackerGraph(graphOperation)).toEqual(snapshot)
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved"
    ])
  }).pipe(
    Effect.provide(layer),
    Effect.provide(memoryJournalStoreLayer)
  )
})

it.effect("journals uncertain start and unreadable lookup evidence before non-convergence", () =>
  Effect.gen(function*() {
    const lookupOrdinal = yield* Ref.make(0)
    const startFailure = new TaskWorkStartRequestFailure({
      detail: "ambiguous provider return",
      observationId: ProviderObservationId.make("journaled-start-failure")
    })
    const runner = TaskRunner.of({
      lookupTaskWorkSession: () =>
        Ref.getAndUpdate(
          lookupOrdinal,
          (value) => value + 1
        ).pipe(
          Effect.flatMap((ordinal) =>
            Effect.fail(
              new TaskWorkSessionLookupFailure({
                detail: "registry unreadable",
                observationId: ProviderObservationId.make(`journaled-lookup-failure-${ordinal}`)
              })
            )
          )
        ),
      requestTaskWorkStart: () => Effect.fail(startFailure)
    })
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(TaskRunner, runner)),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )

    const tags = yield* Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const failure = yield* interpreter.establishTaskWorkSession(operation).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TaskWorkSessionLookupDidNotConverge)
      return (yield* (yield* JournalStore).read(runId)).map(({ event }) => event._tag)
    }).pipe(Effect.provide(layer))

    expect(tags).toEqual([
      "TaskWorkSessionEstablishmentIntentRecorded",
      "TaskWorkStartRequested",
      "TaskWorkStartRequestFailed",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionLookupFailed",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionLookupFailed",
      "TaskWorkSessionLookupRequested",
      "TaskWorkSessionLookupFailed"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("blocks a repeat when fresh absence contradicts a recorded matching report", () =>
  Effect.gen(function*() {
    const requests = yield* Ref.make(0)
    const previousReport = MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make("previous-match"),
      sessionId: TaskWorkSessionId.make("previous-session"),
      work: { _tag: "NoProviderWorkReported" }
    })
    const freshAbsence = NoMatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make("contradictory-absence")
    })
    const runner = TaskRunner.of({
      lookupTaskWorkSession: () => Effect.succeed(freshAbsence),
      requestTaskWorkStart: () =>
        Ref.update(requests, (value) => value + 1).pipe(
          Effect.as({
            observationId: ProviderObservationId.make("forbidden-request-observation"),
            providerRequestId: ProviderRequestId.make("forbidden-request")
          })
        )
    })
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(TaskRunner, runner)),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )

    const failure = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        intentRecordKey(operationId),
        TaskWorkSessionEstablishmentIntentRecorded.make({ operation, version: 2 })
      )
      yield* journal.append(
        runId,
        taskWorkSessionReportedRecordKey(operationId, previousReport.observationId),
        TaskWorkSessionReported.make({ operationId, report: previousReport, version: 2 })
      )
      return yield* (yield* WorkflowInterpreter)
        .establishTaskWorkSession(operation)
        .pipe(Effect.flip)
    }).pipe(Effect.provide(layer))

    expect(failure).toBeInstanceOf(TaskWorkSessionEvidenceContradiction)
    expect(failure).toMatchObject({ currentReport: freshAbsence, previousReport })
    expect(yield* Ref.get(requests)).toBe(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects a fresh matching report for a different provider session", () =>
  Effect.gen(function*() {
    const previousReport = MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make("previous-session-match"),
      sessionId: TaskWorkSessionId.make("previous-provider-session"),
      work: { _tag: "NoProviderWorkReported" }
    })
    const changedReport = MatchingTaskWorkSessionReported.make({
      observationId: ProviderObservationId.make("changed-session-match"),
      sessionId: TaskWorkSessionId.make("changed-provider-session"),
      work: { _tag: "NoProviderWorkReported" }
    })
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(
        TaskRunner,
        TaskRunner.of({
          lookupTaskWorkSession: () => Effect.succeed(changedReport),
          requestTaskWorkStart: () => Effect.die("request must not repeat")
        })
      )),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )

    const failure = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        intentRecordKey(operationId),
        TaskWorkSessionEstablishmentIntentRecorded.make({ operation, version: 2 })
      )
      yield* journal.append(
        runId,
        taskWorkSessionReportedRecordKey(operationId, previousReport.observationId),
        TaskWorkSessionReported.make({ operationId, report: previousReport, version: 2 })
      )
      return yield* (yield* WorkflowInterpreter)
        .establishTaskWorkSession(operation)
        .pipe(Effect.flip)
    }).pipe(Effect.provide(layer))

    expect(failure).toBeInstanceOf(TaskWorkSessionEvidenceContradiction)
    expect(failure).toMatchObject({ currentReport: changedReport, previousReport })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("emits distinct typed non-convergence comparison events", () =>
  Effect.gen(function*() {
    const traceFor = (runner: TaskRunnerService) =>
      Effect.gen(function*() {
        const items = yield* Ref.make<ReadonlyArray<{ readonly _tag: string }>>([])
        const failure = yield* Effect.gen(function*() {
          const interpreter = yield* WorkflowInterpreter
          return yield* interpreter.establishTaskWorkSession(operation).pipe(Effect.flip)
        }).pipe(
          Effect.provide(taskRunnerWorkflowInterpreterLayer),
          Effect.provide(Layer.succeed(TaskRunner, runner)),
          Effect.provide(Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({ read: () => Effect.die("unused tracker read") })
          )),
          Effect.provide(Layer.succeed(
            WorkflowTrace,
            WorkflowTrace.of({
              emit: (item) => Ref.update(items, (current) => [...current, item])
            })
          ))
        )
        return { failure, tags: (yield* Ref.get(items)).map(({ _tag }) => _tag) }
      })
    const acknowledged = {
      observationId: ProviderObservationId.make("non-convergence-request-observation"),
      providerRequestId: ProviderRequestId.make("non-convergence-request")
    }
    const unreadable = yield* traceFor(TaskRunner.of({
      lookupTaskWorkSession: () =>
        Effect.fail(
          new TaskWorkSessionLookupFailure({
            detail: "registry unavailable",
            observationId: ProviderObservationId.make("non-convergence-unreadable")
          })
        ),
      requestTaskWorkStart: () => Effect.succeed(acknowledged)
    }))
    const absent = yield* traceFor(TaskRunner.of({
      lookupTaskWorkSession: () =>
        Effect.succeed(
          NoMatchingTaskWorkSessionReported.make({
            observationId: ProviderObservationId.make("non-convergence-absence")
          })
        ),
      requestTaskWorkStart: () => Effect.succeed(acknowledged)
    }))

    expect(unreadable.failure).toBeInstanceOf(TaskWorkSessionLookupDidNotConverge)
    expect(unreadable.tags.toReversed()[0]).toBe("TaskWorkSessionLookupDidNotConverge")
    expect(absent.failure).toBeInstanceOf(TaskWorkSessionEstablishmentDidNotConverge)
    expect(absent.tags.toReversed()[0]).toBe("TaskWorkSessionEstablishmentDidNotConverge")
  }))

it.effect("rejects a changed payload under an already committed operation identity", () =>
  Effect.gen(function*() {
    const changedRequest = TaskWorkStartRequest.make({
      ...request,
      plannedAttempt: PlannedTaskAttempt.make({
        ...plannedAttempt,
        worktree: WorktreeLocator.make("/tmp/dalph/changed-task-41")
      })
    })
    const changedOperation = makeTaskWorkSessionEstablishmentOperation({
      predecessorOperationIds: operation.predecessorOperationIds,
      request: changedRequest
    })
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(
        TaskRunner,
        TaskRunner.of({
          lookupTaskWorkSession: () => Effect.die("lookup must not run"),
          requestTaskWorkStart: () => Effect.die("request must not run")
        })
      )),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("tracker read must not run") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )
    const failure = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(
        runId,
        intentRecordKey(operationId),
        TaskWorkSessionEstablishmentIntentRecorded.make({ operation, version: 2 })
      )
      return yield* (yield* WorkflowInterpreter)
        .establishTaskWorkSession(changedOperation)
        .pipe(Effect.flip)
    }).pipe(Effect.provide(layer))

    expect(failure).toBeInstanceOf(JournalStoreContradiction)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects a planned attempt from another journal run", () =>
  Effect.gen(function*() {
    const foreignOperation = makeTaskWorkSessionEstablishmentOperation({
      predecessorOperationIds: [],
      request: TaskWorkStartRequest.make({
        ...request,
        plannedAttempt: PlannedTaskAttempt.make({
          ...plannedAttempt,
          runId: RunId.make("foreign-run")
        })
      })
    })
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      taskRunnerWorkflowInterpreterLayer
    ).pipe(
      Layer.provide(Layer.succeed(
        TaskRunner,
        TaskRunner.of({
          lookupTaskWorkSession: () => Effect.die("lookup must not run"),
          requestTaskWorkStart: () => Effect.die("request must not run")
        })
      )),
      Layer.provide(Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({ read: () => Effect.die("tracker read must not run") })
      )),
      Layer.provide(Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ))
    )
    const failure = yield* Effect.gen(function*() {
      return yield* (yield* WorkflowInterpreter)
        .establishTaskWorkSession(foreignOperation)
        .pipe(Effect.flip)
    }).pipe(Effect.provide(layer))

    expect(failure).toBeInstanceOf(TaskWorkSessionRunContradiction)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))
