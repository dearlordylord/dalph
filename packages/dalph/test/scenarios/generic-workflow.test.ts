import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  attemptPlanRecordKey,
  AuthoritativeTaskClaimAcquired,
  AuthoritativeTaskWorktreeReady,
  ClaimOwner,
  ClaimToken,
  JournalPosition,
  JournalStore,
  journaledWorkflowInterpreterLayer,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  memoryJournalTestLayer,
  OperationId,
  PlannedWorktreeReady,
  requireAcknowledgedPlan,
  TaskAttemptPlannedEvent,
  workflowJournalEventVersion,
  WorkflowInterpreter
} from "@dalph/orchestrator"
import { Effect, Layer } from "effect"
import { expect } from "vitest"

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
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: () => Effect.die("unused"),
      readTaskWorkSpecification: () => Effect.die("unused"),
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
      recordTaskAttemptPlan: () => Effect.die("journal wrapper owns this"),
      releaseTaskClaim: () => Effect.die("unused")
    })
  )
  const layer = journaledWorkflowInterpreterLayer(runId, base).pipe(Layer.provideMerge(memoryJournalTestLayer))

  return Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    yield* interpreter.acquireTaskClaim(claimOperation)
    const otherRunAttempt = PlannedTaskAttempt.make({ ...plannedAttempt, runId: RunId.make("another-run") })
    expect(
      (yield* interpreter
        .recordTaskAttemptPlan(makeTaskAttemptPlanOperation({ ...planOperation, plannedAttempt: otherRunAttempt }))
        .pipe(Effect.flip))._tag
    ).toBe("TaskAttemptPlanRunContradiction")
    expect(
      (yield* interpreter
        .reconcileTaskWorktree(
          makeTaskWorktreeReconciliationOperation({ ...worktreeOperation, plannedAttempt: otherRunAttempt })
        )
        .pipe(Effect.flip))._tag
    ).toBe("TaskAttemptPlanRunContradiction")
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

it.effect("requires one exact causal planned-attempt acknowledgement", () =>
  Effect.gen(function* () {
    const operationId = OperationId.make("evidence-worktree")
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("evidence-plan"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const record = {
      event: TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
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
