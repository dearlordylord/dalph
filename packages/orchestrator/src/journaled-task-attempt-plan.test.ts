import { it } from "@effect/vitest"
import { Effect, Exit, Layer, Ref } from "effect"
import { expect } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import {
  AttemptId,
  ClaimOwner,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  FixtureTarget,
  GitCommitSha,
  JournalPosition,
  JournalRecordKey,
  JournalStorageUnavailable,
  JournalStore,
  JournalStoreContradiction,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSessionEstablishmentOperation,
  memoryJournalStoreLayer,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  runWorkflow,
  TaskAttemptPlanHistoryContradiction,
  TaskAttemptPlannedEvent,
  TaskAttemptPlanRunContradiction,
  TaskBranchRef,
  TaskClaimAcquisitionSimulated,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  taskRevisionFor,
  TaskRunner,
  TaskWorkCapacity,
  TaskWorkSessionLocator,
  TaskWorkStartRequest,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-workflow-interpreter.js"

const runId = RunId.make("attempt-plan-run")
const taskId = TaskId.make("attempt-plan-task")
const task = {
  id: taskId,
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plan = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-plan-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/attempt-plan"),
  executor: TaskExecutorLocator.make("executor:attempt-plan"),
  runId,
  session: TaskWorkSessionLocator.make("session:attempt-plan"),
  taskId,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/attempt-plan")
})
const operation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("record-attempt-plan"),
  plannedAttempt: plan,
  predecessorOperationIds: []
})

const baseInterpreterLayer = Layer.succeed(
  WorkflowInterpreter,
  WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("unused claim"),
    establishTaskWorkSession: () => Effect.die("unused session"),
    readTrackerGraph: () => Effect.die("unused graph"),
    recordTaskAttemptPlan: () => Effect.die("journal wrapper records the plan"),
    reconcileTaskWorktree: () => Effect.die("unused worktree"),
    simulateTaskWorkSession: () => Effect.die("unused simulation")
  })
)

const journaledLayer = journaledWorkflowInterpreterLayer(runId, baseInterpreterLayer).pipe(
  Layer.provide(Layer.succeed(
    TaskRunner,
    TaskRunner.of({
      lookupTaskWorkSession: () => Effect.die("unused lookup"),
      requestTaskWorkStart: () => Effect.die("unused start")
    })
  )),
  Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
)

it.effect("acknowledges one immutable attempt plan from durable journal history", () => {
  return Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    expect(yield* interpreter.recordTaskAttemptPlan(operation)).toEqual({
      _tag: "TaskAttemptPlanRecordAcknowledged",
      plannedAttempt: plan
    })
    expect(yield* interpreter.recordTaskAttemptPlan(operation)).toEqual({
      _tag: "TaskAttemptPlanRecordAcknowledged",
      plannedAttempt: plan
    })

    const foreignRunOperation = makeTaskAttemptPlanOperation({
      ...operation,
      plannedAttempt: PlannedTaskAttempt.make({
        ...plan,
        runId: RunId.make("foreign-attempt-plan-run")
      })
    })
    const failure = yield* interpreter.recordTaskAttemptPlan(foreignRunOperation).pipe(
      Effect.flip
    )
    expect(failure).toBeInstanceOf(TaskAttemptPlanRunContradiction)

    const changedPlanOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("replace-attempt-plan"),
      plannedAttempt: PlannedTaskAttempt.make({
        ...plan,
        worktree: WorktreeLocator.make("/tmp/replaced-attempt-plan")
      }),
      predecessorOperationIds: []
    })
    const replacementFailure = yield* interpreter.recordTaskAttemptPlan(
      changedPlanOperation
    ).pipe(Effect.flip)
    expect(replacementFailure).toBeInstanceOf(JournalStoreContradiction)

    const request = TaskWorkStartRequest.make({
      operationId: OperationId.make("attempt-plan-session"),
      plannedAttempt: plan,
      task
    })
    const nonCausalFailure = yield* interpreter.establishTaskWorkSession(
      makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [],
        request
      })
    ).pipe(Effect.flip)
    expect(nonCausalFailure).toBeInstanceOf(TaskAttemptPlanHistoryContradiction)
    expect(nonCausalFailure).toMatchObject({ reason: "CausalPredecessorMissing" })

    const missingPlan = PlannedTaskAttempt.make({
      ...plan,
      attemptId: AttemptId.make("missing-attempt-plan")
    })
    const missingFailure = yield* interpreter.establishTaskWorkSession(
      makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [OperationId.make("missing-plan-operation")],
        request: TaskWorkStartRequest.make({
          operationId: OperationId.make("missing-plan-session"),
          plannedAttempt: missingPlan,
          task
        })
      })
    ).pipe(Effect.flip)
    expect(missingFailure).toBeInstanceOf(TaskAttemptPlanHistoryContradiction)
    expect(missingFailure).toMatchObject({ reason: "Missing" })

    const records = yield* (yield* JournalStore).read(runId)
    expect(records).toHaveLength(1)
    expect(records[0]?.event).toEqual({
      _tag: "TaskAttemptPlanned",
      operation,
      version: 2
    })
  }).pipe(Effect.provide(journaledLayer), Effect.provide(memoryJournalStoreLayer))
})

it.effect("rejects multiple durable plans for one attempt before session mutation", () => {
  const duplicatePlanJournalLayer = Layer.succeed(
    JournalStore,
    JournalStore.of({
      append: () => Effect.die("must reject history before appending an intent"),
      read: () =>
        Effect.succeed([
          {
            event: TaskAttemptPlannedEvent.make({ operation, version: 2 }),
            key: JournalRecordKey.make("duplicate-plan:first"),
            position: JournalPosition.make(1),
            runId
          },
          {
            event: TaskAttemptPlannedEvent.make({ operation, version: 2 }),
            key: JournalRecordKey.make("duplicate-plan:second"),
            position: JournalPosition.make(2),
            runId
          }
        ])
    })
  )
  const request = TaskWorkStartRequest.make({
    operationId: OperationId.make("duplicate-plan-session"),
    plannedAttempt: plan,
    task
  })

  return Effect.gen(function*() {
    const interpreter = yield* WorkflowInterpreter
    const failure = yield* interpreter.establishTaskWorkSession(
      makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [operation.operationId],
        request
      })
    ).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TaskAttemptPlanHistoryContradiction)
    expect(failure).toMatchObject({ reason: "MultiplePlans" })
  }).pipe(Effect.provide(journaledLayer), Effect.provide(duplicatePlanJournalLayer))
})

it.effect("performs no session mutation when plan acknowledgement fails", () =>
  Effect.gen(function*() {
    const starts = yield* Ref.make(0)
    const snapshot = validSnapshot({
      revision: "plan-failure-snapshot",
      tasks: [{ id: "plan-failure-task", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    const interpreterLayer = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: (claimOperation) =>
          Effect.succeed(TaskClaimAcquisitionSimulated.make({ operation: claimOperation })),
        establishTaskWorkSession: () =>
          Ref.update(starts, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("session mutation must not run"))
          ),
        readTrackerGraph: () => Effect.succeed(snapshot),
        recordTaskAttemptPlan: () =>
          Effect.fail(
            new JournalStorageUnavailable({
              detail: "journal unavailable",
              operation: "JournalStore.append"
            })
          ),
        reconcileTaskWorktree: () => Effect.die("unused worktree"),
        simulateTaskWorkSession: () =>
          Ref.update(starts, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("session simulation must not run"))
          )
      })
    )
    const result = yield* runWorkflow(
      FixtureTarget.make("plan-failure-target"),
      TaskWorkCapacity.make(1)
    ).pipe(
      Effect.provide(interpreterLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer("plan-failure")),
      Effect.provide(deterministicTaskClaimAcquisitionPlannerLayer({
        owner: ClaimOwner.make("plan-failure"),
        tokenPrefix: "plan-failure"
      })),
      Effect.provide(deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
        executor: TaskExecutorLocator.make("executor:plan-failure"),
        runId,
        sessionRoot: TaskWorkSessionLocator.make("session:plan-failure"),
        worktreeRoot: WorktreeLocator.make("/tmp/plan-failure")
      })),
      Effect.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))),
      Effect.exit
    )

    expect(Exit.isFailure(result)).toBe(true)
    expect(yield* Ref.get(starts)).toBe(0)
  }))
