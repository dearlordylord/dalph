import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TaskClaimRelease,
  TrackerMutation,
  UnclaimedTask
} from "../authorities/task-tracker/claim-mutation.js"
import { TaskTrackerMutationThrottled } from "../authorities/task-tracker/mutation-throttling.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import type { DeliveryActionExecutionLease } from "../coordination/delivery/delivery-action-executor.js"
import { recoverTaskClaimReleaseOperation } from "../coordination/frontier/recovery.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import { OperationId } from "../workflow/identity.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimReleaseOperation,
  TaskClaimReleaseAuthority
} from "../workflow/registry/operation.js"
import { TaskClaimAcquiredEvent, TaskClaimAcquisitionIntendedEvent } from "../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { AuthoritativeTaskClaimReleased } from "../workflow/protocols/task-claim-release/protocol.js"
import { releaseTaskClaimThrough, WorkflowInterpreter } from "../workflow/interpretation/interpreter.js"
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
const runId = RunId.make("journaled-claim-release-run")
const release = TaskClaimRelease.make({
  claim: ActiveTaskClaim.make({
    operationId: OperationId.make("journaled-claim-acquisition"),
    owner: ClaimOwner.make("dalph"),
    taskId: TaskId.make("journaled-claim-release-task"),
    token: ClaimToken.make("journaled-claim-token")
  }),
  operationId: OperationId.make("journaled-claim-release")
})
const provider = Layer.effect(
  WorkflowInterpreter,
  Effect.gen(function* () {
    const requests = yield* Ref.make(0)
    return WorkflowInterpreter.of({
      acquireTaskClaim: unused,
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: unused,
      readTaskWorkSpecification: unused,
      reconcileTaskWorktree: unused,
      recordTaskAttemptPlan: unused,
      releaseTaskClaim: () =>
        Ref.updateAndGet(requests, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 1
              ? Effect.succeed(AuthoritativeTaskClaimReleased.make({ release }))
              : Effect.die("journal replay repeated the provider release")
          )
        )
    })
  })
)
const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalTestLayer))

it.effect("records exact claim-release intent and outcome once before replay returns", () =>
  Effect.gen(function* () {
    const operation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [release.claim.operationId],
      release
    })
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("journaled-claim-release-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const acquisition = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: release.claim.operationId,
        owner: release.claim.owner,
        taskId: release.claim.taskId,
        token: release.claim.token
      },
      predecessorOperationIds: []
    })
    yield* journal.append(
      runId,
      intentRecordKey(acquisition.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(acquisition.acquisition.operationId),
      TaskClaimAcquiredEvent.make({ claim: release.claim, version: workflowJournalEventVersion })
    )
    const interpreter = yield* WorkflowInterpreter

    expect((yield* interpreter.releaseTaskClaim(operation))._tag).toBe("AuthoritativeTaskClaimReleased")
    expect((yield* interpreter.releaseTaskClaim(operation))._tag).toBe("AuthoritativeTaskClaimReleased")
    expect(
      (yield* journal.read(runId))
        .map(({ event }) => event._tag)
        .filter((tag) => tag === "TaskClaimReleaseIntended" || tag === "TaskClaimReleased")
    ).toEqual(["TaskClaimReleaseIntended", "TaskClaimReleased"])
  }).pipe(Effect.provide(journaled), Effect.provide(memoryJournalTestLayer))
)

it.effect("recovers an unfinished exact release intent after throttle and rereads before cleanup", () =>
  Effect.gen(function* () {
    const recoveryRunId = RunId.make("journaled-throttled-release-recovery")
    const recoveryRelease = TaskClaimRelease.make({
      claim: ActiveTaskClaim.make({
        operationId: OperationId.make("journaled-throttled-release-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: TaskId.make("journaled-throttled-release-task"),
        token: ClaimToken.make("journaled-throttled-release-token")
      }),
      operationId: OperationId.make("journaled-throttled-release")
    })
    const operation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [recoveryRelease.claim.operationId],
      release: recoveryRelease
    })
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const throttle = yield* Ref.make(true)
    const current = yield* Ref.make<ActiveTaskClaim | undefined>(recoveryRelease.claim)
    const tracker = TrackerMutation.of({
      acquireTaskClaim: unused,
      readTaskClaim: (taskId) =>
        Ref.update(calls, (entries) => [...entries, `read:${taskId}`]).pipe(
          Effect.andThen(Ref.get(current)),
          Effect.map((claim) => claim ?? UnclaimedTask.make({ taskId }))
        ),
      releaseTaskClaim: (request) =>
        Ref.update(calls, (entries) => [...entries, `cleanup:${request.operationId}`]).pipe(
          Effect.andThen(Ref.get(throttle)),
          Effect.flatMap((isThrottled) =>
            isThrottled
              ? Effect.fail(
                  new TaskTrackerMutationThrottled({
                    detail: "GitHub primary rate limit rejected the GraphQL request",
                    operation: "ReleaseTaskClaim",
                    operationId: request.operationId,
                    timingEvidence: null
                  })
                )
              : Ref.set(current, undefined)
          )
        )
    })
    const provider = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: unused,
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: (requestedOperation) => releaseTaskClaimThrough(tracker, requestedOperation)
      })
    )
    const journaled = () => Layer.fresh(journaledWorkflowInterpreterLayer(recoveryRunId, provider))
    const journal = yield* JournalStore
    yield* journal.beginRun(
      recoveryRunId,
      FixtureTarget.make("journaled-throttled-release-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const acquisition = makeTaskClaimAcquisitionOperation({
      acquisition: recoveryRelease.claim,
      predecessorOperationIds: []
    })
    yield* journal.append(
      recoveryRunId,
      intentRecordKey(acquisition.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      recoveryRunId,
      outcomeRecordKey(acquisition.acquisition.operationId),
      TaskClaimAcquiredEvent.make({ claim: recoveryRelease.claim, version: workflowJournalEventVersion })
    )
    const firstFailure = yield* Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      return yield* interpreter.releaseTaskClaim(operation).pipe(Effect.flip)
    }).pipe(Effect.provide(journaled()))
    expect(firstFailure).toBeInstanceOf(TaskTrackerMutationThrottled)
    expect(yield* Ref.get(calls)).toEqual([
      `read:${recoveryRelease.claim.taskId}`,
      `cleanup:${recoveryRelease.operationId}`
    ])

    const throttledRecords = yield* journal.read(recoveryRunId)
    expect(throttledRecords.map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "TaskClaimReleaseIntended"
    ])
    expect(
      throttledRecords.every(
        ({ event }) => !("timingEvidence" in event) && !("retryDeadline" in event) && !("retryAt" in event)
      )
    ).toBe(true)
    expect(reduceWorkflowJournalHistory(recoveryRunId, throttledRecords)._tag).toBe("ValidWorkflowJournalHistory")
    const retainedIntent = throttledRecords.find(({ event }) => event._tag === "TaskClaimReleaseIntended")?.event
    if (retainedIntent?._tag !== "TaskClaimReleaseIntended") {
      return yield* Effect.die("expected unfinished claim-release intent")
    }
    expect(retainedIntent.operation).toEqual(operation)

    yield* Ref.set(throttle, false)
    yield* recoverTaskClaimReleaseOperation(
      recoveryRunId,
      retainedIntent.operation.release.operationId,
      controlledRecoveryLease
    ).pipe(Effect.provide(journaled()))
    expect(yield* Ref.get(calls)).toEqual([
      `read:${recoveryRelease.claim.taskId}`,
      `cleanup:${recoveryRelease.operationId}`,
      `read:${recoveryRelease.claim.taskId}`,
      `cleanup:${recoveryRelease.operationId}`,
      `read:${recoveryRelease.claim.taskId}`
    ])
    expect((yield* journal.read(recoveryRunId)).map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "TaskClaimReleaseIntended",
      "TaskClaimReleased"
    ])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
