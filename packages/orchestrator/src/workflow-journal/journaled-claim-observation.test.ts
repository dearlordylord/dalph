import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { OperationId } from "../workflow/identity.js"
import { AuthoritativeTaskClaimObserved, WorkflowInterpreter } from "../workflow/interpretation/interpreter.js"
import { makeTaskClaimObservationOperation } from "../workflow/registry/operation.js"
import { memoryJournalStoreLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { JournalStore } from "./store.js"

const unused = () => Effect.die("unused")
const runId = RunId.make("journaled-claim-observation-run")
const taskId = TaskId.make("journaled-claim-observation-task")
const target = FixtureTarget.make("journaled-claim-observation-target")
const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("journaled-claim-observation-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("journaled-claim-observation-token")
})

it.effect("records one exact claim observation and replays it without another provider read", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const interpreter = yield* WorkflowInterpreter
    const operation = makeTaskClaimObservationOperation(
      OperationId.make("journaled-claim-observation-read"),
      target,
      taskId
    )

    expect((yield* interpreter.readTaskClaim(operation))._tag).toBe("AuthoritativeTaskClaimObserved")
    expect((yield* interpreter.readTaskClaim(operation))._tag).toBe("AuthoritativeTaskClaimObserved")
    expect(
      (yield* journal.read(runId))
        .map(({ event }) => event._tag)
        .filter((tag) => tag === "TaskTrackerReadIntentRecorded" || tag === "TaskTrackerFactsObserved")
    ).toEqual(["TaskTrackerReadIntentRecorded", "TaskTrackerFactsObserved"])
  }).pipe(
    Effect.provide(
      journaledWorkflowInterpreterLayer(
        runId,
        Layer.effect(
          WorkflowInterpreter,
          Ref.make(0).pipe(
            Effect.map((reads) =>
              WorkflowInterpreter.of({
                acquireTaskClaim: unused,
                readTaskClaim: () =>
                  Ref.updateAndGet(reads, (count) => count + 1).pipe(
                    Effect.flatMap((count) =>
                      count === 1
                        ? Effect.succeed(AuthoritativeTaskClaimObserved.make({ observation: claim }))
                        : Effect.die("journal replay repeated the provider claim read")
                    )
                  ),
                readTaskWorktree: () => Effect.die("unused worktree observation"),
                readTargetLineage: () => Effect.die("unused target-lineage observation"),
                readTrackerGraph: unused,
                readTaskWorkSpecification: unused,
                reconcileTaskWorktree: unused,
                recordTaskAttemptPlan: unused,
                releaseTaskClaim: unused
              })
            )
          )
        )
      ).pipe(Layer.provide(memoryJournalStoreLayer))
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)
