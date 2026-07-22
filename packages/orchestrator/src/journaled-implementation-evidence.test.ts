import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit, Layer, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  JournalRecordKey,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorkerProcessId,
  WorktreeLocator
} from "./domain.js"
import {
  ImplementationEvidenceSealedEvent,
  ImplementationEvidenceSealingIntendedEvent
} from "./implementation-evidence-journal.js"
import {
  EvidenceDigest,
  EvidenceReference,
  EvidenceStore,
  ImplementationEvidenceHistoryContradiction,
  ImplementationEvidenceManifest,
  ImplementationEvidenceModeContradiction,
  ImplementationEvidenceSource,
  memoryEvidenceStoreLayer,
  SealedImplementationEvidence
} from "./implementation-evidence.js"
import {
  intentRecordKey,
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  TaskExecutionIntentRecorded,
  TaskExecutionOutcomeObservedEvent
} from "./journal-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionOutcome, TaskExecutionRequest, taskExecutorTestLayer } from "./task-execution.js"
import { taskRunnerTestLayer } from "./task-work-start.js"
import { WorkflowOutcome } from "./workflow-outcome.js"
import { recoverImplementationEvidenceSealings } from "./workflow-recovery.js"
import {
  makeImplementationEvidenceSealingOperation,
  makeTaskExecutionOperation,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

const runId = RunId.make("journaled-evidence-run")
const task = {
  id: TaskId.make("journaled-evidence-task"),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plan = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("journaled-evidence-attempt"),
  baseSha: GitCommitSha.make("2222222222222222222222222222222222222222"),
  branch: TaskBranchRef.make("refs/heads/journaled-evidence"),
  executor: TaskExecutorLocator.make("executor:journaled-evidence"),
  runId,
  session: TaskWorkSessionLocator.make("session:journaled-evidence"),
  taskId: TaskId.make("journaled-evidence-task"),
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/journaled-evidence")
})
const executionId = OperationId.make("journaled-evidence-execution")
const successfulOutcome = TaskExecutionOutcome.cases.Succeeded.make({
  observationId: ProviderObservationId.make("journaled-evidence-observation"),
  operationId: executionId,
  output: "completed output",
  processId: WorkerProcessId.make(17),
  sessionId: TaskWorkSessionId.make("journaled-evidence-session")
})
const operation = makeImplementationEvidenceSealingOperation({
  execution: { _tag: "SuccessfulExecution", outcome: successfulOutcome },
  operationId: OperationId.make("journaled-evidence-seal"),
  plannedAttempt: plan
})
const executionOperation = makeTaskExecutionOperation({
  predecessorOperationIds: [],
  request: TaskExecutionRequest.make({
    operationId: executionId,
    plannedAttempt: plan,
    session: { _tag: "EstablishedSession", sessionId: successfulOutcome.sessionId },
    task
  })
})

const baseLayer = Layer.succeed(
  WorkflowInterpreter,
  WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("unused claim"),
    establishTaskWorkSession: () => Effect.die("unused session"),
    executeTaskWork: () => Effect.die("unused execution"),
    handBackReviewFindings: () => Effect.die("unused review handback"),
    reviewImplementation: () => Effect.die("unused review"),
    readTrackerGraph: () => Effect.die("unused graph"),
    recordTaskAttemptPlan: () => Effect.die("unused plan"),
    reconcileTaskWorktree: () => Effect.die("unused worktree"),
    sealImplementationEvidence: () => Effect.die("journal wrapper owns sealing"),
    simulateTaskExecution: () => Effect.die("unused simulation"),
    simulateTaskWorkSession: () => Effect.die("unused simulation")
  })
)
const sourceLayer = Layer.succeed(
  ImplementationEvidenceSource,
  ImplementationEvidenceSource.of({
    readDiff: () => Effect.succeed(new TextEncoder().encode("journaled diff"))
  })
)
const evidenceLayer = Layer.merge(memoryEvidenceStoreLayer, sourceLayer).pipe(
  Layer.provide(NodeServices.layer)
)
const traceLayer = Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
const journaledLayer = journaledWorkflowInterpreterLayer(
  runId,
  baseLayer,
  taskExecutorTestLayer,
  evidenceLayer
).pipe(
  Layer.provide(taskRunnerTestLayer),
  Layer.provide(traceLayer)
)

const appendSuccessfulPredecessor = Effect.gen(function*() {
  const journal = yield* JournalStore
  yield* journal.append(
    runId,
    intentRecordKey(executionId),
    TaskExecutionIntentRecorded.make({ operation: executionOperation, version: 2 })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(executionId),
    TaskExecutionOutcomeObservedEvent.make({
      outcome: WorkflowOutcome.cases.TaskExecutionObserved.make({ outcome: successfulOutcome }),
      version: 2
    })
  )
})

it.effect("seals once and reuses the immutable journaled outcome during recovery", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const interpreter = yield* WorkflowInterpreter
    const first = yield* interpreter.sealImplementationEvidence(operation)
    const second = yield* interpreter.sealImplementationEvidence(operation)
    expect(first._tag).toBe("SealedImplementationEvidence")
    expect(second).toEqual(first)
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "TaskExecutionIntentRecorded",
      "TaskExecutionOutcomeObserved",
      "ImplementationEvidenceSealingIntended",
      "ImplementationEvidenceSealed"
    ])
  }).pipe(
    Effect.provide(journaledLayer),
    Effect.provide(traceLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("rejects missing, mismatched, and simulated execution predecessors", () =>
  Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    expect(yield* interpreter.sealImplementationEvidence(operation).pipe(Effect.flip))
      .toBeInstanceOf(ImplementationEvidenceHistoryContradiction)

    yield* appendSuccessfulPredecessor
    const changedOutcome = TaskExecutionOutcome.cases.Succeeded.make({
      ...successfulOutcome,
      output: "changed output"
    })
    const mismatched = makeImplementationEvidenceSealingOperation({
      execution: { _tag: "SuccessfulExecution", outcome: changedOutcome },
      operationId: OperationId.make("mismatched-evidence-seal"),
      plannedAttempt: plan
    })
    const mismatchFailure = yield* interpreter.sealImplementationEvidence(mismatched).pipe(Effect.flip)
    expect(mismatchFailure).toBeInstanceOf(ImplementationEvidenceHistoryContradiction)
    if (mismatchFailure instanceof ImplementationEvidenceHistoryContradiction) {
      expect(mismatchFailure.reason).toBe("PredecessorMismatch")
    }

    yield* (yield* JournalStore).append(
      runId,
      JournalRecordKey.make("duplicate-successful-predecessor"),
      TaskExecutionOutcomeObservedEvent.make({
        outcome: WorkflowOutcome.cases.TaskExecutionObserved.make({ outcome: successfulOutcome }),
        version: 2
      })
    )
    const multipleFailure = yield* interpreter.sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(multipleFailure).toBeInstanceOf(ImplementationEvidenceHistoryContradiction)
    if (multipleFailure instanceof ImplementationEvidenceHistoryContradiction) {
      expect(multipleFailure.reason).toBe("MultiplePredecessors")
    }

    const simulated = makeImplementationEvidenceSealingOperation({
      execution: { _tag: "SimulatedExecution", predecessorOperationId: executionId },
      operationId: OperationId.make("simulated-evidence-seal"),
      plannedAttempt: plan
    })
    expect(yield* interpreter.sealImplementationEvidence(simulated).pipe(Effect.flip))
      .toBeInstanceOf(ImplementationEvidenceModeContradiction)
  }).pipe(
    Effect.provide(journaledLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("rejects a sealing attempt not bound to the exact execution intent before reading evidence", () =>
  Effect.gen(function*() {
    const calls = yield* Ref.make(0)
    const changedPlan = PlannedTaskAttempt.make({
      ...plan,
      worktree: WorktreeLocator.make("/tmp/different-attempt-worktree")
    })
    const changedExecution = makeTaskExecutionOperation({
      predecessorOperationIds: [],
      request: TaskExecutionRequest.make({
        ...executionOperation.request,
        plannedAttempt: changedPlan
      })
    })
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(executionId),
      TaskExecutionIntentRecorded.make({ operation: changedExecution, version: 2 })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(executionId),
      TaskExecutionOutcomeObservedEvent.make({
        outcome: WorkflowOutcome.cases.TaskExecutionObserved.make({ outcome: successfulOutcome }),
        version: 2
      })
    )
    const countingEvidence = Layer.merge(
      memoryEvidenceStoreLayer,
      Layer.succeed(
        ImplementationEvidenceSource,
        ImplementationEvidenceSource.of({
          readDiff: () => Ref.update(calls, (count) => count + 1).pipe(Effect.as(new Uint8Array()))
        })
      )
    ).pipe(Layer.provide(NodeServices.layer))
    const layer = journaledWorkflowInterpreterLayer(
      runId,
      baseLayer,
      taskExecutorTestLayer,
      countingEvidence
    ).pipe(
      Layer.provide(taskRunnerTestLayer),
      Layer.provide(traceLayer)
    )
    const failure = yield* Effect.gen(function*() {
      return yield* (yield* WorkflowInterpreter).sealImplementationEvidence(operation)
    }).pipe(Effect.provide(layer), Effect.flip)
    expect(failure).toBeInstanceOf(ImplementationEvidenceHistoryContradiction)
    if (failure instanceof ImplementationEvidenceHistoryContradiction) {
      expect(failure.reason).toBe("AttemptMismatch")
    }
    expect(yield* Ref.get(calls)).toBe(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("recovers an interrupted sealing intent idempotently after execution recovery", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(operation.operationId),
      ImplementationEvidenceSealingIntendedEvent.make({ operation, version: 2 })
    )
    yield* recoverImplementationEvidenceSealings(runId)
    yield* recoverImplementationEvidenceSealings(runId)
    const records = yield* journal.read(runId)
    expect(records.filter(({ event }) => event._tag === "ImplementationEvidenceSealed")).toHaveLength(1)
  }).pipe(
    Effect.provide(journaledLayer),
    Effect.provide(traceLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("recovers idempotently after every evidence-object interruption boundary", () =>
  Effect.forEach([1, 2, 3, 4, 5, 6], (failAt) =>
    Effect.gen(function*() {
      yield* appendSuccessfulPredecessor
      const baseStore = yield* EvidenceStore
      const calls = yield* Ref.make(0)
      const crossBoundary = Effect.fn("EvidenceCrashMatrix.crossBoundary")(function*() {
        const call = yield* Ref.updateAndGet(calls, (count) => count + 1)
        if (call === failAt) return yield* Effect.die(`crash after evidence boundary ${failAt}`)
      })
      const controlledStore = EvidenceStore.of({
        put: (bytes) => crossBoundary().pipe(Effect.andThen(baseStore.put(bytes))),
        read: (reference) => crossBoundary().pipe(Effect.andThen(baseStore.read(reference)))
      })
      const controlledEvidence = Layer.merge(
        Layer.succeed(EvidenceStore, controlledStore),
        Layer.succeed(
          ImplementationEvidenceSource,
          ImplementationEvidenceSource.of({
            readDiff: () =>
              crossBoundary().pipe(
                Effect.as(new TextEncoder().encode("journaled diff"))
              )
          })
        )
      )
      const recoveryLayer = journaledWorkflowInterpreterLayer(
        runId,
        baseLayer,
        taskExecutorTestLayer,
        controlledEvidence
      ).pipe(
        Layer.provide(taskRunnerTestLayer),
        Layer.provide(traceLayer)
      )
      const interrupted = yield* Effect.gen(function*() {
        return yield* (yield* WorkflowInterpreter).sealImplementationEvidence(operation)
      }).pipe(Effect.provide(recoveryLayer), Effect.exit)
      expect(Exit.isFailure(interrupted)).toBe(true)
      yield* recoverImplementationEvidenceSealings(runId).pipe(
        Effect.provide(recoveryLayer),
        Effect.provide(traceLayer)
      )
      const records = yield* (yield* JournalStore).read(runId)
      expect(records.filter(({ event }) => event._tag === "ImplementationEvidenceSealed")).toHaveLength(1)
    }).pipe(
      Effect.provide(memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer))),
      Effect.provide(memoryJournalStoreLayer)
    ), { concurrency: 1, discard: true }))

it.effect("rejects a schema-valid sealed replay whose manifest contradicts the current operation", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(operation.operationId),
      ImplementationEvidenceSealingIntendedEvent.make({ operation, version: 2 })
    )
    const absent = EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd")
    })
    const implementationOutput = yield* (yield* EvidenceStore).put(
      new TextEncoder().encode(successfulOutcome.output)
    )
    const forged = SealedImplementationEvidence.make({
      manifest: ImplementationEvidenceManifest.make({
        diff: absent,
        implementationOutput,
        plannedBaseSha: plan.baseSha,
        predecessorOperationId: executionId,
        runId,
        stage: "Implementation",
        taskId: TaskId.make("different-task")
      }),
      manifestReference: absent
    })
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      ImplementationEvidenceSealedEvent.make({ operationId: operation.operationId, sealed: forged, version: 2 })
    )
    const replayLayer = journaledWorkflowInterpreterLayer(
      runId,
      baseLayer,
      taskExecutorTestLayer,
      Layer.merge(Layer.succeed(EvidenceStore, yield* EvidenceStore), sourceLayer)
    ).pipe(
      Layer.provide(taskRunnerTestLayer),
      Layer.provide(traceLayer)
    )
    const failure = yield* Effect.gen(function*() {
      return yield* (yield* WorkflowInterpreter).sealImplementationEvidence(operation)
    }).pipe(Effect.provide(replayLayer), Effect.flip)
    expect(failure).toBeInstanceOf(ImplementationEvidenceHistoryContradiction)
    if (failure instanceof ImplementationEvidenceHistoryContradiction) {
      expect(failure.reason).toBe("ExistingEvidenceMismatch")
    }
  }).pipe(
    Effect.provide(evidenceLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("rejects a relationally valid replay when its persisted manifest is unavailable", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(operation.operationId),
      ImplementationEvidenceSealingIntendedEvent.make({ operation, version: 2 })
    )
    const absent = EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
    })
    const implementationOutput = yield* (yield* EvidenceStore).put(
      new TextEncoder().encode(successfulOutcome.output)
    )
    const forged = SealedImplementationEvidence.make({
      manifest: ImplementationEvidenceManifest.make({
        diff: absent,
        implementationOutput,
        plannedBaseSha: plan.baseSha,
        predecessorOperationId: executionId,
        runId,
        stage: "Implementation",
        taskId: plan.taskId
      }),
      manifestReference: absent
    })
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      ImplementationEvidenceSealedEvent.make({ operationId: operation.operationId, sealed: forged, version: 2 })
    )
    const replayLayer = journaledWorkflowInterpreterLayer(
      runId,
      baseLayer,
      taskExecutorTestLayer,
      Layer.merge(Layer.succeed(EvidenceStore, yield* EvidenceStore), sourceLayer)
    ).pipe(
      Layer.provide(taskRunnerTestLayer),
      Layer.provide(traceLayer)
    )
    const failure = yield* Effect.gen(function*() {
      return yield* (yield* WorkflowInterpreter).sealImplementationEvidence(operation)
    }).pipe(Effect.provide(replayLayer), Effect.flip)
    expect(failure).toBeInstanceOf(ImplementationEvidenceHistoryContradiction)
    if (failure instanceof ImplementationEvidenceHistoryContradiction) {
      expect(failure.reason).toBe("ExistingEvidenceMismatch")
    }
  }).pipe(
    Effect.provide(evidenceLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("rejects replay when its persisted implementation output is unavailable", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const journal = yield* JournalStore
    const absent = EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("abababababababababababababababababababababababababababababababab")
    })
    const sealed = SealedImplementationEvidence.make({
      manifest: ImplementationEvidenceManifest.make({
        diff: absent,
        implementationOutput: absent,
        plannedBaseSha: plan.baseSha,
        predecessorOperationId: executionId,
        runId,
        stage: "Implementation",
        taskId: plan.taskId
      }),
      manifestReference: absent
    })
    yield* journal.append(
      runId,
      intentRecordKey(operation.operationId),
      ImplementationEvidenceSealingIntendedEvent.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      ImplementationEvidenceSealedEvent.make({ operationId: operation.operationId, sealed, version: 2 })
    )
    const failure = yield* (yield* WorkflowInterpreter).sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(failure).toMatchObject({ reason: "ExistingEvidenceMismatch" })
  }).pipe(
    Effect.provide(journaledLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("rejects run, duplicate execution-intent, and mismatched sealing-intent histories", () =>
  Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    const wrongRun = makeImplementationEvidenceSealingOperation({
      ...operation,
      plannedAttempt: PlannedTaskAttempt.make({ ...plan, runId: RunId.make("wrong-run") })
    })
    const runFailure = yield* interpreter.sealImplementationEvidence(wrongRun).pipe(Effect.flip)
    expect(runFailure).toMatchObject({ reason: "RunMismatch" })

    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(executionId),
      TaskExecutionIntentRecorded.make({ operation: executionOperation, version: 2 })
    )
    const missingPredecessor = yield* interpreter.sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(missingPredecessor).toMatchObject({ reason: "MissingPredecessor" })

    yield* appendSuccessfulPredecessor
    yield* journal.append(
      runId,
      JournalRecordKey.make("duplicate-execution-intent"),
      TaskExecutionIntentRecorded.make({ operation: executionOperation, version: 2 })
    )
    const duplicateFailure = yield* interpreter.sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(duplicateFailure).toMatchObject({ reason: "MultipleExecutionIntents" })
  }).pipe(
    Effect.provide(journaledLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("rejects mismatched and duplicate sealing intents before evidence effects", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const journal = yield* JournalStore
    const changedOutcome = TaskExecutionOutcome.cases.Succeeded.make({
      ...successfulOutcome,
      output: "different sealing intent output"
    })
    const changedIntent = makeImplementationEvidenceSealingOperation({
      execution: { _tag: "SuccessfulExecution", outcome: changedOutcome },
      operationId: operation.operationId,
      plannedAttempt: plan
    })
    yield* journal.append(
      runId,
      intentRecordKey(operation.operationId),
      ImplementationEvidenceSealingIntendedEvent.make({ operation: changedIntent, version: 2 })
    )
    const mismatch = yield* (yield* WorkflowInterpreter)
      .sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(mismatch).toMatchObject({ reason: "IntentMismatch" })
    yield* journal.append(
      runId,
      JournalRecordKey.make("duplicate-sealing-intent"),
      ImplementationEvidenceSealingIntendedEvent.make({ operation: changedIntent, version: 2 })
    )
    const duplicate = yield* (yield* WorkflowInterpreter)
      .sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(duplicate).toMatchObject({ reason: "MultipleSealingIntents" })
  }).pipe(
    Effect.provide(journaledLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("rejects sealed outcomes without one exact intent and duplicate sealed outcomes", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const journal = yield* JournalStore
    const absent = EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
    })
    const forged = SealedImplementationEvidence.make({
      manifest: ImplementationEvidenceManifest.make({
        diff: absent,
        implementationOutput: absent,
        plannedBaseSha: plan.baseSha,
        predecessorOperationId: executionId,
        runId,
        stage: "Implementation",
        taskId: plan.taskId
      }),
      manifestReference: absent
    })
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      ImplementationEvidenceSealedEvent.make({ operationId: operation.operationId, sealed: forged, version: 2 })
    )
    const withoutIntent = yield* (yield* WorkflowInterpreter)
      .sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(withoutIntent).toMatchObject({ reason: "OutcomeWithoutIntent" })
    yield* journal.append(
      runId,
      intentRecordKey(operation.operationId),
      ImplementationEvidenceSealingIntendedEvent.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      JournalRecordKey.make("duplicate-sealed-outcome"),
      ImplementationEvidenceSealedEvent.make({ operationId: operation.operationId, sealed: forged, version: 2 })
    )
    const duplicate = yield* (yield* WorkflowInterpreter)
      .sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(duplicate).toMatchObject({ reason: "MultipleSealedOutcomes" })
  }).pipe(
    Effect.provide(journaledLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("reverifies the exact persisted execution output during sealed replay", () =>
  Effect.gen(function*() {
    yield* appendSuccessfulPredecessor
    const journal = yield* JournalStore
    const store = yield* EvidenceStore
    const diff = yield* store.put(new TextEncoder().encode("persisted diff"))
    const implementationOutput = yield* store.put(new TextEncoder().encode("wrong output"))
    const manifest = ImplementationEvidenceManifest.make({
      diff,
      implementationOutput,
      plannedBaseSha: plan.baseSha,
      predecessorOperationId: executionId,
      runId,
      stage: "Implementation",
      taskId: plan.taskId
    })
    const manifestReference = yield* store.put(new TextEncoder().encode(
      JSON.stringify(Schema.encodeUnknownSync(ImplementationEvidenceManifest)(manifest))
    ))
    yield* journal.append(
      runId,
      intentRecordKey(operation.operationId),
      ImplementationEvidenceSealingIntendedEvent.make({ operation, version: 2 })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      ImplementationEvidenceSealedEvent.make({
        operationId: operation.operationId,
        sealed: SealedImplementationEvidence.make({ manifest, manifestReference }),
        version: 2
      })
    )
    const failure = yield* (yield* WorkflowInterpreter).sealImplementationEvidence(operation).pipe(Effect.flip)
    expect(failure).toMatchObject({ reason: "ExistingEvidenceMismatch" })
  }).pipe(
    Effect.provide(Layer.merge(journaledLayer, evidenceLayer)),
    Effect.provide(memoryJournalStoreLayer)
  ))
