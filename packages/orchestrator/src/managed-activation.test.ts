import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget, OperationId, RunId, TrackerRevision } from "./domain.js"
import {
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { makeManagedRecoveryActivation, observeRecoveredAdmissionCapacity } from "./managed-activation.js"
import { TaskExecutor } from "./task-execution.js"
import { makeTrackerGraphObservationOperation } from "./workflow-operation.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const unused = () => Effect.die("invalid history must fail before a boundary call")

it.effect("rejects invalid managed history before capacity observation or frontier derivation", () => {
  const runId = RunId.make("invalid-managed-activation")
  const operation = makeTrackerGraphObservationOperation(
    OperationId.make("orphan-managed-activation-outcome"),
    FixtureTarget.make("invalid-managed-activation-target")
  )
  const interpreter = WorkflowInterpreter.of({
    acquireTaskClaim: unused,
    establishTaskWorkSession: unused,
    executeTaskWork: unused,
    handBackReviewFindings: unused,
    readTrackerGraph: unused,
    reconcileTaskWorktree: unused,
    recordImplementationDisposition: unused,
    recordTaskAttemptPlan: unused,
    reviewImplementation: unused,
    sealImplementationEvidence: unused,
    simulateTaskExecution: unused,
    simulateTaskWorkSession: unused
  })
  const executor = TaskExecutor.of({
    observeTaskExecution: unused,
    requestTaskExecution: unused
  })

  return Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      trackerGraphOutcomeObserved(operation.operationId, {
        _tag: "TrackerGraphObserved",
        revision: TrackerRevision.make("invalid-managed-activation-revision"),
        taskIds: []
      })
    )

    const capacityExit = yield* observeRecoveredAdmissionCapacity(runId).pipe(
      Effect.provideService(TaskExecutor, executor),
      Effect.exit
    )
    const frontierExit = yield* makeManagedRecoveryActivation(runId).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(
        WorkflowTrace,
        WorkflowTrace.of({ emit: () => Effect.void })
      ),
      Effect.exit
    )

    expect(capacityExit._tag).toBe("Failure")
    expect(frontierExit._tag).toBe("Failure")
  }).pipe(Effect.provide(memoryJournalStoreLayer))
})
