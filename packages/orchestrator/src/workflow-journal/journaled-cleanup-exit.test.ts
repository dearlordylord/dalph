import { it } from "@effect/vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Scope } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, TaskClaimRelease } from "../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { makeApplicationExitLifecycle } from "../coordination/application-exit/lifecycle.js"
import { reconstructRunState } from "../coordination/reconstruction/reduce.js"
import { InitialControlPolicy } from "../control/policy.js"
import { OperationId } from "../workflow/identity.js"
import {
  InterruptibleWorkflowBoundaryIntent,
  WorkflowInterpreter,
  type WorkflowInterpreterService
} from "../workflow/interpretation/interpreter.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { AttemptChoiceRequestId } from "../workflow/protocols/attempt-choice/events.js"
import { AuthoritativeTaskClaimReleased } from "../workflow/protocols/task-claim-release/protocol.js"
import { TaskClaimAcquiredEvent, TaskClaimAcquisitionIntendedEvent } from "../workflow/registry/event.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimReleaseOperation,
  TaskClaimReleaseAuthority
} from "../workflow/registry/operation.js"
import { legacyMemoryJournalStoreLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import { InRunJournal, JournalStore } from "./store.js"

const runId = RunId.make("claim-cleanup-application-exit-run")
const target = FixtureTarget.make("claim-cleanup-application-exit-target")
const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("claim-cleanup-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId: TaskId.make("claim-cleanup-task"),
  token: ClaimToken.make("claim-cleanup-token")
})
const release = TaskClaimRelease.make({ claim, operationId: OperationId.make("claim-cleanup-release") })

const workflowCleanup = makeTaskClaimReleaseOperation({
  authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
  predecessorOperationIds: [claim.operationId],
  release
})
const stoppedAttemptCleanup = makeTaskClaimReleaseOperation({
  authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
    observationOperationId: OperationId.make("claim-cleanup-observation"),
    requestId: AttemptChoiceRequestId.make({ nonce: "claim-cleanup-stop-request", runId })
  }),
  predecessorOperationIds: [claim.operationId, OperationId.make("claim-cleanup-observation")],
  release
})

const unused = () => Effect.die("unused")
const interpreterWithRelease = (
  releaseTaskClaim: WorkflowInterpreterService["releaseTaskClaim"]
): WorkflowInterpreterService =>
  WorkflowInterpreter.of({
    acquireTaskClaim: unused,
    readTaskClaim: unused,
    readTaskWorkSpecification: unused,
    readTaskWorktree: unused,
    readTargetLineage: unused,
    readTrackerGraph: unused,
    reconcileTaskWorktree: unused,
    recordTaskAttemptPlan: unused,
    releaseTaskClaim
  })

const beginClaimHistory = Effect.fn("ClaimCleanupExitTest.beginHistory")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  const acquisition = makeTaskClaimAcquisitionOperation({
    acquisition: { operationId: claim.operationId, owner: claim.owner, taskId: claim.taskId, token: claim.token },
    predecessorOperationIds: []
  })
  yield* journal.append(
    runId,
    intentRecordKey(claim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: acquisition, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(claim.operationId),
    TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
  )
})

const buildJournaledInterpreter = Effect.fn("ClaimCleanupExitTest.buildInterpreter")(function* (
  inRunJournal: InRunJournal["Service"],
  provider: WorkflowInterpreterService,
  scope: Scope.Scope
) {
  const layer = journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, provider)).pipe(
    Layer.provide(Layer.succeed(InRunJournal, inRunJournal))
  )
  return Context.get(yield* Layer.build(layer).pipe(Scope.provide(scope)), WorkflowInterpreter)
})

it.effect("records an available exact claim-release result under Exit without changing its disposition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
      const resultProduced = yield* Deferred.make<void>()
      const allowRecording = yield* Deferred.make<void>()
      const intent = InterruptibleWorkflowBoundaryIntent.TaskClaimCleanup({
        family: "TaskTracker",
        operation: stoppedAttemptCleanup
      })
      const recording = yield* owner
        .run(intent, Effect.succeed("tracker-released"), (result) =>
          Deferred.succeed(resultProduced, undefined).pipe(
            Effect.andThen(Deferred.await(allowRecording)),
            Effect.as(result)
          )
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(resultProduced)
      expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultProduced", intent })
      yield* lifecycle.requestExit
      yield* Deferred.succeed(allowRecording, undefined)
      expect((yield* Fiber.await(recording))._tag).toBe("Failure")
      expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultRecorded", intent })
      expect(intent.operation.authority).toEqual(stoppedAttemptCleanup.authority)
      expect(intent.operation.release).toEqual(stoppedAttemptCleanup.release)
      yield* owner.release
    })
  )
)

it.effect("preserves and reopens interrupted exact claim cleanup in authored and Run-journal cassettes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      const inRunJournal = yield* InRunJournal
      yield* beginClaimHistory()
      const firstScope = yield* Scope.make()
      const firstLifecycle = yield* makeApplicationExitLifecycle()
      const firstOwner = yield* firstLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (firstOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong first owner kind")
      const callStarted = yield* Deferred.make<void>()
      const authored = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (entry: string) => Ref.update(authored, (entries) => [...entries, entry])
      const firstInterpreter = yield* buildJournaledInterpreter(
        inRunJournal,
        interpreterWithRelease(() =>
          record("ClaimReleaseSent").pipe(
            Effect.andThen(Deferred.succeed(callStarted, undefined)),
            Effect.andThen(Effect.never)
          )
        ),
        firstScope
      )
      const firstCall = yield* firstInterpreter
        .releaseTaskClaim(workflowCleanup, record("ClaimReleaseIntentAcknowledged"), firstOwner)
        .pipe(Effect.forkChild)

      yield* Deferred.await(callStarted)
      yield* firstLifecycle.requestExit
      yield* record("ExitCutoffClosed")
      expect((yield* Fiber.await(firstCall))._tag).toBe("Failure")
      yield* record("LocalCleanupWaitInterrupted")
      const expectedIntent = InterruptibleWorkflowBoundaryIntent.TaskClaimCleanup({
        family: "TaskTracker",
        operation: workflowCleanup
      })
      expect(yield* firstOwner.snapshot).toEqual({ _tag: "RecoverableAmbiguity", intent: expectedIntent })
      yield* firstOwner.release
      expect(
        (yield* journal.read(runId))
          .map(({ event }) => event._tag)
          .filter((tag) => tag === "TaskClaimReleaseIntended" || tag === "TaskClaimReleased")
      ).toEqual(["TaskClaimReleaseIntended"])
      const recovered = reconstructRunState(runId, yield* journal.read(runId))
      expect(recovered._tag).toBe("ValidReconstructedRun")
      if (recovered._tag !== "ValidReconstructedRun") return yield* Effect.die("invalid cleanup recovery history")
      expect(recovered.state.responsibility.entries).toContainEqual(
        expect.objectContaining({ _tag: "TaskClaimReleaseResponsibility", operation: workflowCleanup })
      )
      yield* Scope.close(firstScope, Exit.void)

      yield* record("ApplicationProcessDied")
      yield* journal.readRunForRecovery(runId, target)
      yield* record("OrdinaryRunEntry")
      const restartedScope = yield* Scope.make()
      const restartedLifecycle = yield* makeApplicationExitLifecycle()
      const restartedOwner = yield* restartedLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (restartedOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong restarted owner kind")
      const restartedInterpreter = yield* buildJournaledInterpreter(
        inRunJournal,
        interpreterWithRelease((operation) =>
          record("TrackerCheckedBeforeRetry").pipe(
            Effect.as(AuthoritativeTaskClaimReleased.make({ release: operation.release }))
          )
        ),
        restartedScope
      )
      yield* restartedInterpreter.releaseTaskClaim(workflowCleanup, Effect.void, restartedOwner)
      yield* record("ClaimReleaseResultRecorded")
      expect(yield* restartedOwner.snapshot).toEqual({ _tag: "BoundaryResultRecorded", intent: expectedIntent })
      yield* restartedOwner.release
      yield* Scope.close(restartedScope, Exit.void)

      expect(yield* Ref.get(authored)).toEqual([
        "ClaimReleaseIntentAcknowledged",
        "ClaimReleaseSent",
        "ExitCutoffClosed",
        "LocalCleanupWaitInterrupted",
        "ApplicationProcessDied",
        "OrdinaryRunEntry",
        "TrackerCheckedBeforeRetry",
        "ClaimReleaseResultRecorded"
      ])
      expect(
        (yield* journal.read(runId))
          .map(({ event }) => event._tag)
          .filter((tag) => tag === "TaskClaimReleaseIntended" || tag === "TaskClaimReleased")
      ).toEqual(["TaskClaimReleaseIntended", "TaskClaimReleased"])
    })
  ).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("sends no task-claim cleanup call through a pre-cutoff owner after the Exit cutoff", () =>
  Effect.gen(function* () {
    const lifecycle = yield* makeApplicationExitLifecycle()
    const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
    if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
    const calls = yield* Ref.make(0)
    yield* lifecycle.requestExit
    const result = yield* owner
      .run(
        InterruptibleWorkflowBoundaryIntent.TaskClaimCleanup({ family: "TaskTracker", operation: workflowCleanup }),
        Ref.update(calls, (count) => count + 1),
        () => Effect.void
      )
      .pipe(Effect.exit)
    expect(result._tag).toBe("Failure")
    expect(yield* Ref.get(calls)).toBe(0)
    expect(yield* owner.snapshot).toEqual({ _tag: "NoBoundaryCall" })
    yield* owner.release
    expect((yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary").pipe(Effect.flip))._tag).toBe(
      "ApplicationExiting"
    )
  })
)
