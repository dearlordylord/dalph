// @effect-diagnostics multipleEffectProvide:off
import { it } from "@effect/vitest"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../test/controlled-planned-attempt-executor.js"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
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
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent,
  TaskWorktreeReconciliationIntendedEvent
} from "../../workflow/registry/event.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { activateRecoveredResponsibilities, makeRunRecoveryActivation } from "../run/recovery-activation.js"
import { trustedPlannedAttemptRecoveryAuthorityLayer } from "../run/recovery-authority.js"
import { RunnableFrontierTransition } from "./frontier.js"
import { recoverRunnableTransition } from "./recovery.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskAttemptPlanOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorktreeReconciliationOperation
} from "../../workflow/registry/operation.js"
import {
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../../workflow/protocols/planned-attempt-executor-work/events.js"

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
        readTaskWorkSpecification: unused,
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
      readTaskWorkSpecification: unused,
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

it.effect("a responsible task leaving complete membership becomes a task-local constraint", () =>
  Effect.gen(function* () {
    const runId = RunId.make("membership-constraint-run")
    const taskId = TaskId.make("removed-responsible-task")
    const claim = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("removed-task-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("removed-task-token")
      },
      predecessorOperationIds: []
    })
    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("membership-removal-read"),
      FixtureTarget.make("membership-constraint-target")
    )
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("task-removed-from-target"),
        taskIds: []
      })
    )

    const recovery = yield* makeRunRecoveryActivation(runId)
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        {
          _tag: "WorkflowOperationTaskMembershipConstraint",
          operationId: claim.acquisition.operationId,
          taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ],
      transitions: []
    })
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("an executor responsibility leaving complete membership becomes an executor-local constraint", () =>
  Effect.gen(function* () {
    const runId = RunId.make("executor-membership-constraint-run")
    const taskId = TaskId.make("removed-executor-task")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("removed-executor-attempt"),
      baseSha: GitCommitSha.make("4".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/removed-executor-attempt"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: TaskRevision.make("removed-executor-revision"),
      worktree: WorktreeLocator.make("/worktrees/removed-executor-attempt")
    })
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("removed-executor-plan"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("executor-membership-removal-read"),
      FixtureTarget.make("executor-membership-constraint-target")
    )
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("executor-task-removed-from-target"),
        taskIds: []
      })
    )

    const recovery = yield* makeRunRecoveryActivation(runId)
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        {
          _tag: "PlannedAttemptTaskMembershipConstraint",
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ],
      transitions: []
    })
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
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
      readTaskWorkSpecification: unused,
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
      beginRun: () => Effect.die("unused"),
      read: () =>
        Ref.getAndUpdate(reads, (count) => count + 1).pipe(Effect.map((count) => (count === 0 ? [] : [invalidRecord]))),
      readRunForRecovery: () => Effect.die("unused"),
      scan: () => Effect.succeed({ issues: [], runs: [] }),
      terminateRun: () => Effect.die("unused")
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
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)
