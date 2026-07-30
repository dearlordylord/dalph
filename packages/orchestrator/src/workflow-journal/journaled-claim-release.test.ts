import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, TaskClaimRelease } from "../authorities/task-tracker/claim-mutation.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import { makeTaskClaimAcquisitionOperation, makeTaskClaimReleaseOperation } from "../workflow/registry/operation.js"
import { TaskClaimAcquiredEvent, TaskClaimAcquisitionIntendedEvent } from "../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { AuthoritativeTaskClaimReleased } from "../workflow/protocols/task-claim-release/protocol.js"
import { WorkflowInterpreter } from "../workflow/interpretation/interpreter.js"
import { memoryJournalStoreLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { JournalStore } from "./store.js"

const unused = () => Effect.die("unused")
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
const journaled = journaledWorkflowInterpreterLayer(runId, provider).pipe(Layer.provide(memoryJournalStoreLayer))

it.effect("records exact claim-release intent and outcome once before replay returns", () =>
  Effect.gen(function* () {
    const operation = makeTaskClaimReleaseOperation({ predecessorOperationIds: [release.claim.operationId], release })
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
  }).pipe(Effect.provide(journaled), Effect.provide(memoryJournalStoreLayer))
)
