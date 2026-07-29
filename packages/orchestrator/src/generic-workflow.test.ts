import { it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TrackerRevision,
  WorktreeLocator
} from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { attemptPlanRecordKey } from "./journal-record-key.js"
import { JournalStore, memoryJournalStoreLayer, TaskAttemptPlannedEvent } from "./journal-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"
import { requireAcknowledgedPlan } from "./task-attempt-plan-journal-evidence.js"
import { TaskAttemptPlanRecordingSimulated } from "./task-attempt-plan-recording.js"
import { projectTrackerSnapshot } from "./task-dag.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import {
  AuthoritativeTaskClaimAcquired,
  AuthoritativeTaskWorktreeReady,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimAcquisitionSimulated,
  TaskWorktreeReconciliationSimulated,
  WorkflowInterpreter
} from "./workflow.js"

const runId = RunId.make("generic-workflow-run")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("A"),
  taskRevision: TaskRevision.make("revision-A"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A")
})

it.effect("journals claim, plan, and Git worktree boundaries without executor internals", () => {
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("claim-A"),
      owner: ClaimOwner.make("dalph"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("claim-token-A")
    },
    predecessorOperationIds: []
  })
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("plan-A"),
    plannedAttempt,
    predecessorOperationIds: [claimOperation.acquisition.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("worktree-A"),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const base = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: (operation) =>
        Effect.succeed(AuthoritativeTaskClaimAcquired.make({ claim: ActiveTaskClaim.make(operation.acquisition) })),
      readTrackerGraph: () => Effect.die("unused"),
      reconcileTaskWorktree: () =>
        Effect.succeed(
          AuthoritativeTaskWorktreeReady.make({
            proof: PlannedWorktreeReady.make({
              baseSha: plannedAttempt.baseSha,
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              worktree: plannedAttempt.worktree
            })
          })
        ),
      recordTaskAttemptPlan: () => Effect.die("journal wrapper owns this")
    })
  )
  const layer = journaledWorkflowInterpreterLayer(runId, base).pipe(Layer.provideMerge(memoryJournalStoreLayer))

  return Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    yield* interpreter.acquireTaskClaim(claimOperation)
    yield* interpreter.recordTaskAttemptPlan(planOperation)
    yield* interpreter.reconcileTaskWorktree(worktreeOperation)
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady"
    ])
  }).pipe(Effect.provide(layer))
})

it.effect("journals simulated generic boundaries and rejects cross-run plans", () => {
  const snapshotResult = projectTrackerSnapshot({ revision: TrackerRevision.make("generic-snapshot"), tasks: [] })
  const snapshot = Option.getOrThrow(
    Option.fromUndefinedOr(snapshotResult._tag === "Valid" ? snapshotResult.snapshot : undefined)
  )
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("graph-A"),
    FixtureTarget.make("generic-fixture")
  )
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("simulated-claim-A"),
      owner: ClaimOwner.make("dalph"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("simulated-token-A")
    },
    predecessorOperationIds: [graphOperation.operationId]
  })
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("simulated-plan-A"),
    plannedAttempt,
    predecessorOperationIds: [claimOperation.acquisition.operationId]
  })
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("simulated-worktree-A"),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const base = Layer.succeed(
    WorkflowInterpreter,
    WorkflowInterpreter.of({
      acquireTaskClaim: (operation) => Effect.succeed(TaskClaimAcquisitionSimulated.make({ operation })),
      readTrackerGraph: () => Effect.succeed(snapshot),
      reconcileTaskWorktree: (operation) => Effect.succeed(TaskWorktreeReconciliationSimulated.make({ operation })),
      recordTaskAttemptPlan: (operation) => Effect.succeed(TaskAttemptPlanRecordingSimulated.make({ operation }))
    })
  )
  const testLayer = journaledWorkflowInterpreterLayer(runId, base).pipe(Layer.provideMerge(memoryJournalStoreLayer))

  return Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    yield* interpreter.readTrackerGraph(graphOperation)
    yield* interpreter.readTrackerGraph(graphOperation)
    yield* interpreter.acquireTaskClaim(claimOperation, Effect.void)

    const otherRunAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: RunId.make("another-run") })
    const otherRunPlan = makeTaskAttemptPlanOperation({ ...planOperation, plannedAttempt: otherRunAttempt })
    expect((yield* interpreter.recordTaskAttemptPlan(otherRunPlan).pipe(Effect.flip))._tag).toBe(
      "TaskAttemptPlanRunContradiction"
    )
    expect(
      (yield* interpreter
        .reconcileTaskWorktree(
          makeTaskWorktreeReconciliationOperation({ ...worktreeOperation, plannedAttempt: otherRunAttempt })
        )
        .pipe(Effect.flip))._tag
    ).toBe("TaskAttemptPlanRunContradiction")

    yield* interpreter.recordTaskAttemptPlan(planOperation)
    expect((yield* interpreter.reconcileTaskWorktree(worktreeOperation))._tag).toBe(
      "TaskWorktreeReconciliationSimulated"
    )

    const records = yield* (yield* JournalStore).read(runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved",
      "TaskClaimAcquisitionIntended",
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended"
    ])
  }).pipe(Effect.provide(testLayer))
})

it.effect("requires one exact causal planned-attempt acknowledgement", () =>
  Effect.gen(function* () {
    const operationId = OperationId.make("evidence-worktree")
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("evidence-plan"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const record = {
      event: TaskAttemptPlannedEvent.make({ operation: plan, version: 4 as const }),
      key: attemptPlanRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(1),
      runId
    }
    const reason = (effect: ReturnType<typeof requireAcknowledgedPlan>) =>
      effect.pipe(
        Effect.flip,
        Effect.map((error) => error.reason)
      )

    expect(yield* reason(requireAcknowledgedPlan([], plannedAttempt, operationId, [plan.operationId]))).toBe("Missing")
    expect(
      yield* reason(
        requireAcknowledgedPlan(
          [record, { ...record, position: JournalPosition.make(2) }],
          plannedAttempt,
          operationId,
          [plan.operationId]
        )
      )
    ).toBe("MultiplePlans")
    expect(yield* reason(requireAcknowledgedPlan([record], plannedAttempt, operationId, []))).toBe(
      "CausalPredecessorMissing"
    )
    const changed = PlannedTaskAttempt.make({ ...plannedAttempt, worktree: WorktreeLocator.make("/worktrees/changed") })
    expect(yield* reason(requireAcknowledgedPlan([record], changed, operationId, [plan.operationId]))).toBe(
      "PlanMismatch"
    )
    yield* requireAcknowledgedPlan([record], plannedAttempt, operationId, [plan.operationId])
  })
)
