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
import { Context, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { PlannedWorktreeReady } from "../authorities/git/worktree.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { makeApplicationExitLifecycle } from "../coordination/application-exit/lifecycle.js"
import { deriveRunRecoveryFrontier } from "../coordination/frontier/recovery-frontier.js"
import { makeRunRecoveryProjection } from "../coordination/run/recovery-activation.js"
import { InitialControlPolicy } from "../control/policy.js"
import { OperationId } from "../workflow/identity.js"
import {
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  type WorkflowInterpreterService
} from "../workflow/interpretation/interpreter.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { AuthoritativeTaskWorktreeReady } from "../workflow/protocols/worktree-reconciliation/protocol.js"
import {
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskAttemptPlannedEvent
} from "../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation
} from "../workflow/registry/operation.js"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { legacyMemoryJournalStoreLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { InRunJournal, JournalStore } from "./store.js"

const unused = () => Effect.die("unused")

const interpreterWith = (overrides: Partial<WorkflowInterpreterService>) =>
  WorkflowInterpreter.of({
    acquireTaskClaim: unused,
    readTaskClaim: unused,
    readTaskWorkSpecification: unused,
    readTaskWorktree: unused,
    readTargetLineage: unused,
    readTrackerGraph: unused,
    reconcileTaskWorktree: unused,
    recordTaskAttemptPlan: unused,
    releaseTaskClaim: unused,
    ...overrides
  })

const buildApplicationInterpreter = Effect.fn("InterruptibleRecoveryTest.buildApplicationInterpreter")(function* (
  runId: RunId,
  inRunJournal: InRunJournal["Service"],
  provider: Layer.Layer<WorkflowInterpreter>,
  applicationScope: Scope.Scope
) {
  const application = journaledWorkflowInterpreterLayer(runId, provider).pipe(
    Layer.provide(Layer.succeed(InRunJournal, inRunJournal))
  )
  const context = yield* Layer.build(application).pipe(Scope.provide(applicationScope))
  return Context.get(context, WorkflowInterpreter)
})

it.effect("rebuilds the tracker application from its recovery projection and records the available response", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = RunId.make("interruptible-tracker-recovery-run")
      const taskId = TaskId.make("interruptible-tracker-recovery-task")
      const target = FixtureTarget.make("interruptible-tracker-recovery-target")
      const operation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make("interruptible-tracker-acquisition"),
          owner: ClaimOwner.make("dalph"),
          taskId,
          token: ClaimToken.make("interruptible-tracker-token")
        },
        predecessorOperationIds: []
      })
      const claim = ActiveTaskClaim.make(operation.acquisition)
      const journal = yield* JournalStore
      const inRunJournal = yield* InRunJournal
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )

      const firstScope = yield* Scope.make()
      const firstLifecycle = yield* makeApplicationExitLifecycle()
      const firstOwner = yield* firstLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (firstOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong first owner kind")
      const firstInterpreter = yield* buildApplicationInterpreter(
        runId,
        inRunJournal,
        Layer.succeed(WorkflowInterpreter, interpreterWith({ acquireTaskClaim: () => Effect.never })),
        firstScope
      )
      const firstCall = yield* firstInterpreter
        .acquireTaskClaim(operation, Effect.void, firstOwner)
        .pipe(Effect.ensuring(firstOwner.release), Effect.forkChild)
      yield* Effect.yieldNow
      yield* firstLifecycle.requestExit
      expect((yield* Fiber.await(firstCall))._tag).toBe("Failure")
      yield* Scope.close(firstScope, Exit.void)

      yield* journal.readRunForRecovery(runId, target)
      const recovery = yield* makeRunRecoveryProjection(runId)
      expect((yield* recovery.readDeliveryProjection).frontier.transitions).toContainEqual(
        expect.objectContaining({ _tag: "CheckTaskClaim", operationId: operation.acquisition.operationId })
      )

      const restartedScope = yield* Scope.make()
      const restartedLifecycle = yield* makeApplicationExitLifecycle()
      const restartedOwner = yield* restartedLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (restartedOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong restarted owner kind")
      const restartedInterpreter = yield* buildApplicationInterpreter(
        runId,
        inRunJournal,
        Layer.succeed(
          WorkflowInterpreter,
          interpreterWith({ acquireTaskClaim: () => Effect.succeed(AuthoritativeTaskClaimAcquired.make({ claim })) })
        ),
        restartedScope
      )
      expect((yield* restartedInterpreter.acquireTaskClaim(operation, Effect.void, restartedOwner)).claim).toEqual(
        claim
      )
      expect(yield* restartedOwner.snapshot).toMatchObject({
        _tag: "BoundaryResultRecorded",
        intent: { family: "TaskTracker", operationId: operation.acquisition.operationId }
      })
      yield* restartedOwner.release
      yield* Scope.close(restartedScope, Exit.void)
      expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toContain("TaskClaimAcquired")
    })
  ).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rebuilds the Git application from its recovery projection and records the available response", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = RunId.make("interruptible-git-recovery-run")
      const taskId = TaskId.make("interruptible-git-recovery-task")
      const target = FixtureTarget.make("interruptible-git-recovery-target")
      const acquisition = {
        operationId: OperationId.make("interruptible-git-acquisition"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("interruptible-git-token")
      }
      const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("interruptible-git-attempt"),
        baseSha: GitCommitSha.make("a".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/interruptible-git"),
        executor: TaskExecutorLocator.make("executor:interruptible-git"),
        runId,
        taskId,
        taskRevision: TaskRevision.make("interruptible-git-revision"),
        worktree: WorktreeLocator.make("/worktrees/interruptible-git")
      })
      const planOperation = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("interruptible-git-plan"),
        plannedAttempt,
        predecessorOperationIds: [acquisition.operationId]
      })
      const operation = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("interruptible-git-reconciliation"),
        plannedAttempt,
        predecessorOperationIds: [planOperation.operationId]
      })
      const proof = PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      })
      const journal = yield* JournalStore
      const inRunJournal = yield* InRunJournal
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      yield* journal.append(
        runId,
        intentRecordKey(acquisition.operationId),
        TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
      )
      yield* journal.append(
        runId,
        outcomeRecordKey(acquisition.operationId),
        TaskClaimAcquiredEvent.make({ claim: ActiveTaskClaim.make(acquisition), version: workflowJournalEventVersion })
      )
      yield* journal.append(
        runId,
        attemptPlanRecordKey(plannedAttempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
      )

      const firstScope = yield* Scope.make()
      const firstLifecycle = yield* makeApplicationExitLifecycle()
      const firstOwner = yield* firstLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (firstOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong first owner kind")
      const firstInterpreter = yield* buildApplicationInterpreter(
        runId,
        inRunJournal,
        Layer.succeed(WorkflowInterpreter, interpreterWith({ reconcileTaskWorktree: () => Effect.never })),
        firstScope
      )
      const firstCall = yield* firstInterpreter
        .reconcileTaskWorktree(operation, Effect.void, firstOwner)
        .pipe(Effect.ensuring(firstOwner.release), Effect.forkChild)
      yield* Effect.yieldNow
      yield* firstLifecycle.requestExit
      expect((yield* Fiber.await(firstCall))._tag).toBe("Failure")
      yield* Scope.close(firstScope, Exit.void)

      yield* journal.readRunForRecovery(runId, target)
      expect(deriveRunRecoveryFrontier(yield* journal.read(runId)).entries).toContainEqual(
        expect.objectContaining({
          _tag: "TaskWorktreeReconciliationUnresolved",
          operation: expect.objectContaining({ operationId: operation.operationId })
        })
      )

      const restartedScope = yield* Scope.make()
      const restartedLifecycle = yield* makeApplicationExitLifecycle()
      const restartedOwner = yield* restartedLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (restartedOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong restarted owner kind")
      const restartedInterpreter = yield* buildApplicationInterpreter(
        runId,
        inRunJournal,
        Layer.succeed(
          WorkflowInterpreter,
          interpreterWith({
            reconcileTaskWorktree: () => Effect.succeed(AuthoritativeTaskWorktreeReady.make({ proof }))
          })
        ),
        restartedScope
      )
      expect((yield* restartedInterpreter.reconcileTaskWorktree(operation, Effect.void, restartedOwner)).proof).toEqual(
        proof
      )
      expect(yield* restartedOwner.snapshot).toMatchObject({
        _tag: "BoundaryResultRecorded",
        intent: { family: "Git", operationId: operation.operationId }
      })
      yield* restartedOwner.release
      yield* Scope.close(restartedScope, Exit.void)
      expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toContain("TaskWorktreeReady")
    })
  ).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)
