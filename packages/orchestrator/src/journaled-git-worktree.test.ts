import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  AuthoritativeTaskWorktreeReady,
  GitCommitSha,
  JournalStore,
  makeTaskAttemptPlanOperation,
  makeTaskWorktreeReconciliationOperation,
  memoryJournalStoreLayer,
  OperationId,
  PlannedTaskAttempt,
  PlannedWorktreeReady,
  RunId,
  TaskAttemptPlanRunContradiction,
  TaskBranchRef,
  TaskExecutorLocator,
  taskExecutorTestLayer,
  TaskId,
  TaskRevision,
  TaskRunner,
  TaskWorkSessionLocator,
  TaskWorktreeReconciliationSimulated,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import { intentRecordKey, TaskWorktreeReconciliationIntendedEvent } from "./journal-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"
import { recoverTaskWorktreeReconciliations } from "./workflow-recovery.js"

const runId = RunId.make("journaled-worktree-run")
const plan = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("journaled-worktree-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/journaled-worktree"),
  executor: TaskExecutorLocator.make("executor:test"),
  runId,
  session: TaskWorkSessionLocator.make("session:test"),
  taskId: TaskId.make("task-45"),
  taskRevision: TaskRevision.make("revision-45"),
  worktree: WorktreeLocator.make("/tmp/dalph-journaled-worktree")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("plan-worktree"),
  plannedAttempt: plan,
  predecessorOperationIds: []
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("reconcile-worktree"),
  plannedAttempt: plan,
  predecessorOperationIds: [planOperation.operationId]
})
const proof = PlannedWorktreeReady.make({
  baseSha: plan.baseSha,
  branch: plan.branch,
  headSha: plan.baseSha,
  worktree: plan.worktree
})

const baseLayer = Layer.succeed(
  WorkflowInterpreter,
  WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("unused claim"),
    establishTaskWorkSession: () => Effect.die("unused session"),
    executeTaskWork: () => Effect.die("unused execution"),
    readTrackerGraph: () => Effect.die("unused graph"),
    recordTaskAttemptPlan: () => Effect.die("journal wrapper records the plan"),
    reconcileTaskWorktree: () => Effect.succeed(AuthoritativeTaskWorktreeReady.make({ proof })),
    simulateTaskExecution: () => Effect.die("unused execution simulation"),
    simulateTaskWorkSession: () => Effect.die("unused simulation")
  })
)

const silentTraceLayer = Layer.succeed(
  WorkflowTrace,
  WorkflowTrace.of({ emit: () => Effect.void })
)

const layer = journaledWorkflowInterpreterLayer(runId, baseLayer, taskExecutorTestLayer).pipe(
  Layer.provide(Layer.succeed(
    TaskRunner,
    TaskRunner.of({
      lookupTaskWorkSession: () => Effect.die("unused lookup"),
      requestTaskWorkStart: () => Effect.die("unused start")
    })
  )),
  Layer.provide(silentTraceLayer)
)

it.effect("records worktree intent before the authoritative Base and HEAD proof", () =>
  Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    yield* interpreter.recordTaskAttemptPlan(planOperation)

    const result = yield* interpreter.reconcileTaskWorktree(worktreeOperation)
    const records = yield* journal.read(runId)

    expect(result).toEqual(AuthoritativeTaskWorktreeReady.make({ proof }))
    expect(records.map(({ event }) => event._tag)).toEqual([
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady"
    ])
    expect(records[2]?.event).toMatchObject({
      _tag: "TaskWorktreeReady",
      operationId: worktreeOperation.operationId,
      proof
    })
  }).pipe(
    Effect.provide(layer),
    Effect.provide(silentTraceLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("reconciles an acknowledged worktree intent after a crash", () =>
  Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* JournalStore
    yield* interpreter.recordTaskAttemptPlan(planOperation)
    yield* journal.append(
      runId,
      intentRecordKey(worktreeOperation.operationId),
      TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktreeOperation,
        version: 2
      })
    )

    yield* recoverTaskWorktreeReconciliations(runId)

    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady"
    ])
    yield* recoverTaskWorktreeReconciliations(runId)
    expect(yield* journal.read(runId)).toHaveLength(3)
  }).pipe(
    Effect.provide(layer),
    Effect.provide(silentTraceLayer),
    Effect.provide(memoryJournalStoreLayer)
  ))

it.effect("does not fabricate a ready proof from a simulated recovery result", () => {
  const simulatedLayer = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("unused claim"),
      establishTaskWorkSession: () => Effect.die("unused session"),
      executeTaskWork: () => Effect.die("unused execution"),
      readTrackerGraph: () => Effect.die("unused graph"),
      recordTaskAttemptPlan: () => Effect.die("unused plan"),
      reconcileTaskWorktree: (operation) =>
        Effect.succeed(
          TaskWorktreeReconciliationSimulated.make({ operation })
        ),
      simulateTaskExecution: () => Effect.die("unused execution simulation"),
      simulateTaskWorkSession: () => Effect.die("unused simulation")
    })
  )
  return Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(worktreeOperation.operationId),
      TaskWorktreeReconciliationIntendedEvent.make({
        operation: worktreeOperation,
        version: 2
      })
    )
    yield* recoverTaskWorktreeReconciliations(runId)
    expect(yield* journal.read(runId)).toHaveLength(1)
  }).pipe(
    Effect.provide(simulatedLayer),
    Effect.provide(silentTraceLayer),
    Effect.provide(memoryJournalStoreLayer)
  )
})

it.effect("rejects a worktree operation from another run before Git", () => {
  const foreignPlan = PlannedTaskAttempt.make({
    ...plan,
    runId: RunId.make("foreign-run")
  })
  const operation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("foreign-run-worktree"),
    plannedAttempt: foreignPlan,
    predecessorOperationIds: [planOperation.operationId]
  })
  return Effect.gen(function*() {
    const failure = yield* Effect.flip(
      (yield* WorkflowInterpreter).reconcileTaskWorktree(operation)
    )
    expect(failure).toBeInstanceOf(TaskAttemptPlanRunContradiction)
  }).pipe(
    Effect.provide(layer),
    Effect.provide(memoryJournalStoreLayer)
  )
})
