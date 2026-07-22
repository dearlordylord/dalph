import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  journaledWorkflowInterpreterLayer,
  JournalStore,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  memoryJournalStoreLayer,
  OperationId,
  PlannedTaskAttempt,
  PlannedWorktreeReady,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  taskExecutorTestLayer,
  TaskId,
  TaskLifecycle,
  taskRevisionFor,
  TaskRunner,
  taskRunnerWorkflowInterpreterLayer,
  TaskWorkSessionLocator,
  TaskWorkStartRequest,
  TaskWorktreeHistoryContradiction,
  TrackerGraphReader,
  WorkflowInterpreter,
  WorkflowTrace,
  WorktreeLocator
} from "./index.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "./journal-store.js"

const runId = RunId.make("worktree-evidence-run")
const task = {
  id: TaskId.make("worktree-evidence-task"),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("worktree-evidence-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/worktree-evidence"),
  executor: TaskExecutorLocator.make("executor:evidence"),
  runId,
  session: TaskWorkSessionLocator.make("session:evidence"),
  taskId: task.id,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/worktree-evidence")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("evidence-plan"),
  plannedAttempt,
  predecessorOperationIds: []
})
const worktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("evidence-worktree"),
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})
const sessionOperation = makeTaskWorkSessionEstablishmentOperation({
  predecessorOperationIds: [planOperation.operationId, worktreeOperation.operationId],
  request: TaskWorkStartRequest.make({
    operationId: OperationId.make("evidence-session"),
    plannedAttempt,
    task
  })
})
const readyEvent = TaskWorktreeReadyEvent.make({
  operationId: worktreeOperation.operationId,
  proof: PlannedWorktreeReady.make({
    baseSha: plannedAttempt.baseSha,
    branch: plannedAttempt.branch,
    headSha: plannedAttempt.baseSha,
    worktree: plannedAttempt.worktree
  }),
  version: 3
})
const interpreterLayer = journaledWorkflowInterpreterLayer(
  runId,
  taskRunnerWorkflowInterpreterLayer,
  taskExecutorTestLayer
).pipe(
  Layer.provide(Layer.succeed(
    TaskRunner,
    TaskRunner.of({
      lookupTaskWorkSession: () => Effect.die("lookup must not run"),
      requestTaskWorkStart: () => Effect.die("start must not run")
    })
  )),
  Layer.provide(Layer.succeed(
    TrackerGraphReader,
    TrackerGraphReader.of({ read: () => Effect.die("tracker read must not run") })
  )),
  Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
)

const intentEvent = (attempt = plannedAttempt) =>
  TaskWorktreeReconciliationIntendedEvent.make({
    operation: makeTaskWorktreeReconciliationOperation({
      ...worktreeOperation,
      plannedAttempt: attempt
    }),
    version: 3
  })

const append = (key: ReturnType<typeof intentRecordKey>, event: Parameters<typeof JournalStore.Service["append"]>[2]) =>
  Effect.flatMap(JournalStore, (journal) => journal.append(runId, key, event))

const cases = [
  { reason: "MissingIntent", records: [] },
  {
    reason: "MultipleIntents",
    records: [
      [intentRecordKey(worktreeOperation.operationId), intentEvent()],
      [intentRecordKey(OperationId.make("duplicate-intent")), intentEvent()]
    ]
  },
  {
    reason: "PlanMismatch",
    records: [[
      intentRecordKey(worktreeOperation.operationId),
      intentEvent(PlannedTaskAttempt.make({
        ...plannedAttempt,
        worktree: WorktreeLocator.make("/tmp/foreign-worktree")
      }))
    ]]
  },
  { reason: "MissingProof", records: [[intentRecordKey(worktreeOperation.operationId), intentEvent()]] },
  {
    reason: "MultipleProofs",
    records: [
      [intentRecordKey(worktreeOperation.operationId), intentEvent()],
      [outcomeRecordKey(worktreeOperation.operationId), readyEvent],
      [outcomeRecordKey(OperationId.make("duplicate-proof")), readyEvent]
    ]
  },
  {
    reason: "ProofMismatch",
    records: [
      [intentRecordKey(worktreeOperation.operationId), intentEvent()],
      [
        outcomeRecordKey(worktreeOperation.operationId),
        TaskWorktreeReadyEvent.make({
          ...readyEvent,
          proof: PlannedWorktreeReady.make({
            ...readyEvent.proof,
            branch: TaskBranchRef.make("refs/heads/foreign-evidence")
          })
        })
      ]
    ]
  }
] as const

for (const scenario of cases) {
  it.effect(`fails closed with ${scenario.reason} worktree evidence`, () =>
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      yield* interpreter.recordTaskAttemptPlan(planOperation)
      for (const [key, event] of scenario.records) yield* append(key, event)
      const failure = yield* interpreter.establishTaskWorkSession(sessionOperation).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(TaskWorktreeHistoryContradiction)
      expect(failure).toMatchObject({ reason: scenario.reason })
    }).pipe(Effect.provide(interpreterLayer), Effect.provide(memoryJournalStoreLayer)))
}
