import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "../../test/controlled-planned-attempt-executor.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TaskClaimConflict,
  TrackerMutation,
  UnclaimedTask
} from "../authorities/task-tracker/claim-mutation.js"
import { TaskTrackerMutationThrottled } from "../authorities/task-tracker/mutation-throttling.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import type { DeliveryActionExecutionLease } from "../coordination/delivery/delivery-action-executor.js"
import { recoverTaskClaimOperation } from "../coordination/frontier/recovery.js"
import { makeRunRecoveryProjection } from "../coordination/run/recovery-activation.js"
import { OperationId } from "../workflow/identity.js"
import { acquireTaskClaimThrough, WorkflowInterpreter, WorkflowTrace } from "../workflow/interpretation/interpreter.js"
import { makeTaskClaimAcquisitionOperation } from "../workflow/registry/operation.js"
import { memoryJournalTestLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { JournalStore } from "./store.js"

const unused = () => Effect.die("unused")
const controlledRecoveryLease: Pick<DeliveryActionExecutionLease, "forwardBoundary" | "recordIntent"> = {
  forwardBoundary: {
    _tag: "InterruptibleBoundary",
    execution: { run: (_intent, call, recordResult) => Effect.flatMap(call, recordResult) }
  },
  recordIntent: () => Effect.void
}

it.effect("records a foreign acquisition rejection as terminal and never reconstructs a retry", () =>
  Effect.gen(function* () {
    const runId = RunId.make("journaled-foreign-claim-rejection")
    const taskId = TaskId.make("foreign-claim-task")
    const target = FixtureTarget.make("foreign-claim-target")
    const operation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("rejected-acquisition"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("attempted-token")
      },
      predecessorOperationIds: []
    })
    const foreign = ActiveTaskClaim.make({
      operationId: OperationId.make("foreign-acquisition"),
      owner: ClaimOwner.make("other-owner"),
      taskId,
      token: ClaimToken.make("foreign-token")
    })
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const interpreter = yield* WorkflowInterpreter
    expect((yield* interpreter.acquireTaskClaim(operation).pipe(Effect.flip))._tag).toBe(
      "TrackerMutation.TaskClaimConflict"
    )

    const records = yield* journal.read(runId)
    expect(records.map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquisitionRejected"
    ])
    expect(records.at(-1)?.event).toMatchObject({
      observed: foreign,
      operationId: operation.acquisition.operationId,
      reason: "ForeignClaim"
    })
    expect(reduceWorkflowJournalHistory(runId, records)._tag).toBe("ValidWorkflowJournalHistory")
    const recovery = yield* makeRunRecoveryProjection(runId)
    expect((yield* recovery.readDeliveryProjection).frontier.transitions).not.toContainEqual(
      expect.objectContaining({ _tag: "ReconcileTaskClaim", operationId: operation.acquisition.operationId })
    )
    // Removing the foreign tracker claim changes no durable rejection fact and cannot revive this command.
    expect((yield* recovery.readDeliveryProjection).frontier.transitions).not.toContainEqual(
      expect.objectContaining({ _tag: "ReconcileTaskClaim", operationId: operation.acquisition.operationId })
    )
  }).pipe(
    Effect.provide(
      journaledWorkflowInterpreterLayer(
        RunId.make("journaled-foreign-claim-rejection"),
        Layer.succeed(
          WorkflowInterpreter,
          WorkflowInterpreter.of({
            acquireTaskClaim: (operation) =>
              Effect.fail(
                new TaskClaimConflict({
                  attempted: operation.acquisition,
                  observed: ActiveTaskClaim.make({
                    operationId: OperationId.make("foreign-acquisition"),
                    owner: ClaimOwner.make("other-owner"),
                    taskId: operation.acquisition.taskId,
                    token: ClaimToken.make("foreign-token")
                  })
                })
              ),
            readTaskClaim: unused,
            readTaskWorktree: () => Effect.die("unused worktree observation"),
            readTargetLineage: () => Effect.die("unused target-lineage observation"),
            readTrackerGraph: unused,
            readTaskWorkSpecification: unused,
            reconcileTaskWorktree: unused,
            recordTaskAttemptPlan: unused,
            releaseTaskClaim: unused
          })
        )
      ).pipe(Layer.provide(memoryJournalTestLayer))
    ),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("recovers an unfinished exact claim intent after throttle and rereads before mutation", () =>
  Effect.gen(function* () {
    const runId = RunId.make("journaled-throttled-claim-recovery")
    const taskId = TaskId.make("journaled-throttled-claim-task")
    const operation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("journaled-throttled-acquisition"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("journaled-throttled-token")
      },
      predecessorOperationIds: []
    })
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const throttle = yield* Ref.make(true)
    const current = yield* Ref.make<ActiveTaskClaim | undefined>(undefined)
    const tracker = TrackerMutation.of({
      acquireTaskClaim: (request) =>
        Ref.update(calls, (entries) => [...entries, `mutate:${request.operationId}`]).pipe(
          Effect.andThen(Ref.get(throttle)),
          Effect.flatMap((isThrottled) =>
            isThrottled
              ? Effect.fail(
                  new TaskTrackerMutationThrottled({
                    detail: "GitHub secondary rate limit rejected the GraphQL request",
                    operation: "AcquireTaskClaim",
                    operationId: request.operationId,
                    timingEvidence: null
                  })
                )
              : Ref.set(current, ActiveTaskClaim.make(request)).pipe(Effect.as(ActiveTaskClaim.make(request)))
          )
        ),
      readTaskClaim: (requestedTaskId) =>
        Ref.update(calls, (entries) => [...entries, `read:${requestedTaskId}`]).pipe(
          Effect.andThen(Ref.get(current)),
          Effect.map((claim) => claim ?? UnclaimedTask.make({ taskId: requestedTaskId }))
        ),
      releaseTaskClaim: unused
    })
    const provider = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: (requestedOperation) => acquireTaskClaimThrough(tracker, requestedOperation),
        readTaskClaim: unused,
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
    const journaled = () => Layer.fresh(journaledWorkflowInterpreterLayer(runId, provider))
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("journaled-throttled-claim-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const firstFailure = yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      return yield* interpreter.acquireTaskClaim(operation).pipe(Effect.flip)
    }).pipe(Effect.provide(journaled()))
    expect(firstFailure).toBeInstanceOf(TaskTrackerMutationThrottled)
    expect(yield* Ref.get(calls)).toEqual([`read:${taskId}`, `mutate:${operation.acquisition.operationId}`])

    const throttledRecords = yield* journal.read(runId)
    expect(throttledRecords.map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskClaimAcquisitionIntended"
    ])
    expect(
      throttledRecords.every(
        ({ event }) => !("timingEvidence" in event) && !("retryDeadline" in event) && !("retryAt" in event)
      )
    ).toBe(true)
    expect(reduceWorkflowJournalHistory(runId, throttledRecords)._tag).toBe("ValidWorkflowJournalHistory")
    const retainedIntent = throttledRecords.find(({ event }) => event._tag === "TaskClaimAcquisitionIntended")?.event
    if (retainedIntent?._tag !== "TaskClaimAcquisitionIntended") {
      return yield* Effect.die("expected unfinished claim intent")
    }
    expect(retainedIntent.operation).toEqual(operation)

    yield* Ref.set(throttle, false)
    yield* recoverTaskClaimOperation(
      runId,
      retainedIntent.operation.acquisition.operationId,
      controlledRecoveryLease
    ).pipe(Effect.provide(journaled()))
    expect(yield* Ref.get(calls)).toEqual([
      `read:${taskId}`,
      `mutate:${operation.acquisition.operationId}`,
      `read:${taskId}`,
      `mutate:${operation.acquisition.operationId}`,
      `read:${taskId}`
    ])
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired"
    ])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
