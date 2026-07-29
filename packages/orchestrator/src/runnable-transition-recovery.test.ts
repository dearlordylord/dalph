import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkCapacity,
  WorktreeLocator
} from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { intentRecordKey, outcomeRecordKey } from "./journal-record-key.js"
import {
  JournalStore,
  memoryJournalStoreLayer,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "./journal-store.js"
import { activateRecoveredResponsibilities, makeRunRecoveryActivation } from "./run-recovery-activation.js"
import { controlledFakePlannedAttemptExecutorLayer } from "./planned-attempt-executor.js"
import { trustedPlannedAttemptRecoveryAuthorityLayer } from "./planned-attempt-recovery-authority.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { recoverRunnableTransition } from "./runnable-transition-recovery.js"
import { makeTaskClaimAcquisitionOperation, makeTaskWorktreeReconciliationOperation } from "./workflow-operation.js"
import { AuthoritativeTaskClaimAcquired, WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const unused = () => Effect.die("empty history must not invoke an interpreter")

it.effect("routes every recovered transition variant through its exact empty-history handler", () => {
  const runId = RunId.make("runnable-transition-routing")
  const taskId = TaskId.make("runnable-transition-task")
  const operationId = OperationId.make("runnable-transition-operation")
  const transitions = [
    RunnableFrontierTransition.CheckTaskClaim({ operationId, taskId }),
    RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId,
      taskRevision: TaskRevision.make("runnable-transition-revision")
    }),
    RunnableFrontierTransition.ContinueFreshWorkflowOperation({ operationId, taskId }),
    RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId }),
    RunnableFrontierTransition.ReconcileTaskWorktree({ operationId, taskId })
  ]

  return Effect.gen(function* () {
    const results = yield* Effect.forEach(transitions, (transition) => recoverRunnableTransition(runId, transition))
    expect(results).toEqual(Array.from({ length: transitions.length }))
  }).pipe(
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTrackerGraph: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(memoryJournalStoreLayer)
  )
})

it.effect("settles a recovered generic claim through run recovery activation", () =>
  Effect.gen(function* () {
    const runId = RunId.make("recovered-generic-recovery")
    const taskId = TaskId.make("recovered-generic-task")
    const claim = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("recovered-generic-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("recovered-generic-token")
      },
      predecessorOperationIds: []
    })
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: (operation) =>
        journal
          .append(
            runId,
            outcomeRecordKey(operation.acquisition.operationId),
            TaskClaimAcquiredEvent.make({
              claim: { _tag: "ActiveTaskClaim", ...operation.acquisition },
              version: workflowJournalEventVersion
            })
          )
          .pipe(
            Effect.as({
              ...AuthoritativeTaskClaimAcquired.make({ claim: { _tag: "ActiveTaskClaim", ...operation.acquisition } })
            })
          ),
      readTrackerGraph: unused,
      reconcileTaskWorktree: unused,
      recordTaskAttemptPlan: unused
    })
    yield* activateRecoveredResponsibilities(runId, TaskWorkCapacity.make(1)).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provide(controlledFakePlannedAttemptExecutorLayer),
      Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer)
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("replays the exact durable claim and worktree intents", () => {
  const runId = RunId.make("runnable-transition-intents")
  const taskId = TaskId.make("runnable-transition-task")
  const claim = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("recovered-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("recovered-token")
    },
    predecessorOperationIds: []
  })
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("recovered-attempt"),
    baseSha: GitCommitSha.make("3".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/recovered-attempt"),
    executor: TaskExecutorLocator.make("executor:fake"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("recovered-revision"),
    worktree: WorktreeLocator.make("/worktrees/recovered-attempt")
  })
  const worktree = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("recovered-worktree"),
    plannedAttempt,
    predecessorOperationIds: []
  })

  return Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      intentRecordKey(worktree.operationId),
      TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion })
    )
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: (operation) =>
        Ref.update(calls, (current) => [...current, `claim:${operation.acquisition.operationId}`]).pipe(
          Effect.as({ _tag: "TaskClaimAcquisitionSimulated", operation })
        ),
      readTrackerGraph: unused,
      reconcileTaskWorktree: (operation) =>
        Ref.update(calls, (current) => [...current, `worktree:${operation.operationId}`]).pipe(
          Effect.as({ _tag: "TaskWorktreeReconciliationSimulated", operation })
        ),
      recordTaskAttemptPlan: unused
    })
    yield* recoverRunnableTransition(
      runId,
      RunnableFrontierTransition.CheckTaskClaim({ operationId: claim.acquisition.operationId, taskId })
    ).pipe(Effect.provideService(WorkflowInterpreter, interpreter))
    yield* recoverRunnableTransition(
      runId,
      RunnableFrontierTransition.ReconcileTaskClaim({ operationId: claim.acquisition.operationId, taskId })
    ).pipe(Effect.provideService(WorkflowInterpreter, interpreter))
    yield* recoverRunnableTransition(
      runId,
      RunnableFrontierTransition.ReconcileTaskWorktree({ operationId: worktree.operationId, taskId })
    ).pipe(Effect.provideService(WorkflowInterpreter, interpreter))
    expect(yield* Ref.get(calls)).toEqual([
      "claim:recovered-claim",
      "claim:recovered-claim",
      "worktree:recovered-worktree"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
})

it.effect("fails closed when initial or reread workflow-journal history is invalid", () =>
  Effect.gen(function* () {
    const runId = RunId.make("invalid-workflow-journal-history-recovery")
    const operation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("invalid-workflow-journal-history-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: TaskId.make("invalid-workflow-journal-history-task"),
        token: ClaimToken.make("invalid-workflow-journal-history-token")
      },
      predecessorOperationIds: []
    })
    const invalidRecord = {
      event: TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
      key: intentRecordKey(operation.acquisition.operationId),
      position: JournalPosition.make(2),
      runId
    }
    const reads = yield* Ref.make(0)
    const changingJournal = JournalStore.of({
      append: () => Effect.die("unused"),
      read: () =>
        Ref.getAndUpdate(reads, (count) => count + 1).pipe(Effect.map((count) => (count === 0 ? [] : [invalidRecord]))),
      scan: () => Effect.succeed({ issues: [], runs: [] })
    })
    const recovery = yield* makeRunRecoveryActivation(runId).pipe(Effect.provideService(JournalStore, changingJournal))
    expect((yield* recovery.readFrontier.pipe(Effect.flip))._tag).toBe("InvalidWorkflowJournalHistory")

    const initiallyInvalid = yield* makeRunRecoveryActivation(runId).pipe(
      Effect.provideService(
        JournalStore,
        JournalStore.of({ ...changingJournal, read: () => Effect.succeed([invalidRecord]) })
      ),
      Effect.flip
    )
    expect(initiallyInvalid._tag).toBe("InvalidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTrackerGraph: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)
