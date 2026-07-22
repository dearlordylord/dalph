import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import {
  ActiveTaskClaim,
  AuthoritativeTaskClaimAcquired,
  ClaimOwner,
  ClaimToken,
  journaledWorkflowInterpreterLayer,
  JournalStore,
  makeTaskClaimAcquisitionOperation,
  memoryJournalStoreLayer,
  OperationId,
  RunId,
  TaskClaimAcquisition,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionSimulated,
  taskExecutorTestLayer,
  TaskId,
  TaskRunner,
  WorkflowInterpreter,
  WorkflowTrace
} from "./index.js"
import { intentRecordKey } from "./journal-store.js"
import { recoverTaskClaimAcquisitions } from "./workflow-recovery.js"

it.effect("journals claim intent before the authoritative acquired outcome", () => {
  const runId = RunId.make("journaled-claim-run")
  const acquisition = TaskClaimAcquisition.make({
    operationId: OperationId.make("journaled-claim-operation"),
    owner: ClaimOwner.make("journaled-owner"),
    taskId: TaskId.make("journaled-task"),
    token: ClaimToken.make("journaled-token")
  })
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition,
    predecessorOperationIds: []
  })
  const baseLayer = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () =>
        Effect.succeed(
          AuthoritativeTaskClaimAcquired.make({
            claim: ActiveTaskClaim.make(acquisition)
          })
        ),
      establishTaskWorkSession: () => Effect.die("unused establishment"),
      executeTaskWork: () => Effect.die("unused execution"),
      handBackReviewFindings: () => Effect.die("unused review handback"),
      reviewImplementation: () => Effect.die("unused review"),
      recordTaskAttemptPlan: () => Effect.die("unused plan"),
      reconcileTaskWorktree: () => Effect.die("unused worktree"),
      readTrackerGraph: () => Effect.die("unused graph read"),
      simulateTaskExecution: () => Effect.die("unused execution simulation"),
      simulateTaskWorkSession: () => Effect.die("unused simulation"),
      sealImplementationEvidence: () => Effect.die("unused evidence sealing")
    })
  )
  const layer = journaledWorkflowInterpreterLayer(runId, baseLayer, taskExecutorTestLayer).pipe(
    Layer.provide(Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("unused lookup"),
        requestTaskWorkStart: () => Effect.die("unused start")
      })
    )),
    Layer.provide(Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    ))
  )

  return Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    yield* interpreter.acquireTaskClaim(operation)
    const records = yield* (yield* JournalStore).read(runId)

    expect(records.map(({ event }) => event._tag)).toEqual([
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired"
    ])
  }).pipe(
    Effect.provide(layer),
    Effect.provide(Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    )),
    Effect.provide(memoryJournalStoreLayer)
  )
})

it.effect("records simulated claim intent without an authoritative outcome", () => {
  const runId = RunId.make("journaled-simulated-claim-run")
  const acquisition = TaskClaimAcquisition.make({
    operationId: OperationId.make("journaled-simulated-claim-operation"),
    owner: ClaimOwner.make("simulated-owner"),
    taskId: TaskId.make("simulated-task"),
    token: ClaimToken.make("simulated-token")
  })
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition,
    predecessorOperationIds: []
  })
  const baseLayer = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.succeed(TaskClaimAcquisitionSimulated.make({ operation })),
      establishTaskWorkSession: () => Effect.die("unused establishment"),
      executeTaskWork: () => Effect.die("unused execution"),
      handBackReviewFindings: () => Effect.die("unused review handback"),
      reviewImplementation: () => Effect.die("unused review"),
      recordTaskAttemptPlan: () => Effect.die("unused plan"),
      reconcileTaskWorktree: () => Effect.die("unused worktree"),
      readTrackerGraph: () => Effect.die("unused graph read"),
      simulateTaskExecution: () => Effect.die("unused execution simulation"),
      simulateTaskWorkSession: () => Effect.die("unused simulation"),
      sealImplementationEvidence: () => Effect.die("unused evidence sealing")
    })
  )
  const layer = journaledWorkflowInterpreterLayer(runId, baseLayer, taskExecutorTestLayer).pipe(
    Layer.provide(Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("unused lookup"),
        requestTaskWorkStart: () => Effect.die("unused start")
      })
    )),
    Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
  )

  return Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    yield* interpreter.acquireTaskClaim(operation)
    yield* recoverTaskClaimAcquisitions(runId)
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.map(({ event }) => event._tag)).toEqual(["TaskClaimAcquisitionIntended"])
  }).pipe(
    Effect.provide(layer),
    Effect.provide(Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    )),
    Effect.provide(memoryJournalStoreLayer)
  )
})

it.effect("reconciles a crashed claim with its original durable acquisition", () => {
  const runId = RunId.make("recover-claim-run")
  const acquisition = TaskClaimAcquisition.make({
    operationId: OperationId.make("recover-claim-operation"),
    owner: ClaimOwner.make("recover-owner"),
    taskId: TaskId.make("recover-task"),
    token: ClaimToken.make("recover-token")
  })
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition,
    predecessorOperationIds: []
  })
  const baseLayer = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: (recovered) =>
        Effect.succeed(
          AuthoritativeTaskClaimAcquired.make({
            claim: ActiveTaskClaim.make(recovered.acquisition)
          })
        ),
      establishTaskWorkSession: () => Effect.die("unused establishment"),
      executeTaskWork: () => Effect.die("unused execution"),
      handBackReviewFindings: () => Effect.die("unused review handback"),
      reviewImplementation: () => Effect.die("unused review"),
      recordTaskAttemptPlan: () => Effect.die("unused plan"),
      reconcileTaskWorktree: () => Effect.die("unused worktree"),
      readTrackerGraph: () => Effect.die("unused graph read"),
      simulateTaskExecution: () => Effect.die("unused execution simulation"),
      simulateTaskWorkSession: () => Effect.die("unused simulation"),
      sealImplementationEvidence: () => Effect.die("unused evidence sealing")
    })
  )
  const layer = journaledWorkflowInterpreterLayer(runId, baseLayer, taskExecutorTestLayer).pipe(
    Layer.provide(Layer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => Effect.die("unused lookup"),
        requestTaskWorkStart: () => Effect.die("unused start")
      })
    )),
    Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
  )

  return Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation, version: 3 })
    )
    yield* recoverTaskClaimAcquisitions(runId)
    yield* recoverTaskClaimAcquisitions(runId)
    const records = yield* journal.read(runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired"
    ])
    expect(records[1]?.event).toMatchObject({ claim: acquisition })
  }).pipe(
    Effect.provide(layer),
    Effect.provide(Layer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => Effect.void })
    )),
    Effect.provide(memoryJournalStoreLayer)
  )
})
