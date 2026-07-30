import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { controlledFakePlannedAttemptExecutorLayer } from "../../test/controlled-planned-attempt-executor.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, TaskClaimConflict } from "../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { deriveRunRecoveryFrontier } from "../coordination/frontier/recovery-frontier.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import { makeRunRecoveryActivation } from "../coordination/run/recovery-activation.js"
import { OperationId } from "../workflow/identity.js"
import { WorkflowInterpreter, WorkflowTrace } from "../workflow/interpretation/interpreter.js"
import { makeTaskClaimAcquisitionOperation } from "../workflow/registry/operation.js"
import { memoryJournalStoreLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { JournalStore } from "./store.js"

const unused = () => Effect.die("unused")

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
    expect(deriveRunRecoveryFrontier(records).entries).toEqual([])
    const recovery = yield* makeRunRecoveryActivation(runId)
    expect((yield* recovery.readFrontier).transitions).not.toContainEqual(
      expect.objectContaining({ _tag: "ReconcileTaskClaim", operationId: operation.acquisition.operationId })
    )
    // Removing the foreign tracker claim changes no durable rejection fact and cannot revive this command.
    expect((yield* recovery.readFrontier).transitions).not.toContainEqual(
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
      ).pipe(Layer.provide(memoryJournalStoreLayer))
    ),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(memoryJournalStoreLayer)
  )
)
