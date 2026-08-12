import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { TaskDagSnapshot } from "../authorities/task-tracker/graph.js"
import { TrackerRevision, TrackerSnapshot } from "../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { makeApplicationExitLifecycle } from "../coordination/application-exit/lifecycle.js"
import { InitialControlPolicy } from "../control/policy.js"
import { OperationId } from "../workflow/identity.js"
import { InterruptibleWorkflowBoundaryIntent, WorkflowInterpreter } from "../workflow/interpretation/interpreter.js"
import { makeTrackerGraphObservationOperation } from "../workflow/registry/operation.js"
import { legacyMemoryJournalStoreLayer } from "./adapters/memory-store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"
import { JournalStore } from "./store.js"

const unused = () => Effect.die("unused")
const runId = RunId.make("journaled-tracker-exit-run")
const target = FixtureTarget.make("journaled-tracker-exit-target")
const projected = TaskDagSnapshot.project(
  TrackerSnapshot.make({ revision: TrackerRevision.make("journaled-tracker-exit-revision"), tasks: [] })
)
if (projected._tag === "Invalid") throw new Error("the empty tracker Exit fixture must be valid")

/** Supervisor-visible chronology; lifecycle entries deliberately remain outside the Run journal. */
const interruptedTrackerAuthoredCassette = [
  "TrackerIntentAcknowledged",
  "TrackerCallSent",
  "ExitCutoffClosed",
  "LocalTrackerWaitInterrupted",
  "ApplicationProcessDied",
  "OrdinaryRunEntry",
  "TrackerCheckedBeforeRetry",
  "TrackerObservationRecorded"
] as const

it.effect("records the authored tracker interruption and ordinary replay cassette", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const firstCallStarted = yield* Deferred.make<void>()
    const chronology = yield* Ref.make<Array<(typeof interruptedTrackerAuthoredCassette)[number]>>([])
    const record = (event: (typeof interruptedTrackerAuthoredCassette)[number]) =>
      Ref.update(chronology, (events) => [...events, event])
    const provider = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: unused,
        readTaskWorkSpecification: unused,
        readTaskWorktree: unused,
        readTargetLineage: unused,
        readTrackerGraph: () =>
          Ref.updateAndGet(calls, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? record("TrackerCallSent").pipe(
                    Effect.andThen(Deferred.succeed(firstCallStarted, undefined)),
                    Effect.andThen(Effect.never)
                  )
                : record("TrackerCheckedBeforeRetry").pipe(Effect.as(projected.snapshot))
            )
          ),
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
    const journaled = journaledWorkflowInterpreterLayer(runId, provider)

    yield* Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      const interpreter = yield* WorkflowInterpreter
      const operation = makeTrackerGraphObservationOperation(
        OperationId.make("application-exit-interrupted-tracker-read"),
        target
      )
      const exitingLifecycle = yield* makeApplicationExitLifecycle()
      const exitingOwner = yield* exitingLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (exitingOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
      const inFlight = yield* interpreter
        .readTrackerGraph(operation, record("TrackerIntentAcknowledged"), exitingOwner)
        .pipe(Effect.forkChild)

      yield* Deferred.await(firstCallStarted)
      yield* exitingLifecycle.requestExit
      yield* record("ExitCutoffClosed")
      expect((yield* Fiber.await(inFlight))._tag).toBe("Failure")
      yield* record("LocalTrackerWaitInterrupted")
      expect(yield* exitingOwner.snapshot).toEqual({
        _tag: "RecoverableAmbiguity",
        intent: InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
          family: "TaskTracker",
          operationId: operation.operationId
        })
      })
      yield* exitingOwner.release
      expect(
        (yield* journal.read(runId))
          .map(({ event }) => event._tag)
          .filter((tag) => tag === "TaskTrackerReadIntentRecorded" || tag === "TaskTrackerFactsObserved")
      ).toEqual(["TaskTrackerReadIntentRecorded"])

      yield* record("ApplicationProcessDied")
      yield* record("OrdinaryRunEntry")
      const reopenedLifecycle = yield* makeApplicationExitLifecycle()
      const reopenedOwner = yield* reopenedLifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (reopenedOwner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong reopened owner kind")
      yield* interpreter.readTrackerGraph(operation, Effect.void, reopenedOwner)
      yield* record("TrackerObservationRecorded")
      yield* reopenedOwner.release

      expect(yield* Ref.get(calls)).toBe(2)
      expect(yield* Ref.get(chronology)).toEqual(interruptedTrackerAuthoredCassette)
      expect(
        (yield* journal.read(runId))
          .map(({ event }) => event._tag)
          .filter((tag) => tag === "TaskTrackerReadIntentRecorded" || tag === "TaskTrackerFactsObserved")
      ).toEqual(["TaskTrackerReadIntentRecorded", "TaskTrackerFactsObserved"])
    }).pipe(Effect.provide(journaled))
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)
