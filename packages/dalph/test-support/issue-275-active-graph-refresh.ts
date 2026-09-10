import { TaskId } from "@dalph/contracts"
import {
  ApplicationExitShell,
  type ApplicationExiting,
  projectTrackerSnapshot,
  RunReactivationHint,
  RunReactivationOwner,
  type RunReactivationIntervalInvalid,
  runReactivationOwnerLayer,
  type TestTrackerGraphReader,
  type TrackerGraphReader
} from "@dalph/orchestrator"
import { Deferred, Effect, Layer, Queue, Ref } from "effect"
import { TestClock } from "effect/testing"
import type { Issue268Ds04TimerCheckpointInput } from "./issue-268-controlled-ds04.js"
import type { Issue268Ds03BoundarySnapshot } from "./issue-268-controlled-characterization-types.js"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"

export interface Issue275RefreshResult {
  readonly before: Issue268Ds03BoundarySnapshot
  readonly after: Issue268Ds03BoundarySnapshot
  readonly graphReads: number
  readonly maximumGraphReads: number
  readonly sources: ReadonlyArray<string>
}

/** Alice edits before the sole owner's queued active read; G2 remains separately owned. */
export const makeIssue275GraphRefresh: (
  reader: TrackerGraphReader["Service"],
  tracker: TestTrackerGraphReader["Service"]
) => Effect.Effect<Issue275GraphRefresh> = Effect.fn("Issue275.makeGraphRefresh")(function* (
  reader: TrackerGraphReader["Service"],
  tracker: TestTrackerGraphReader["Service"]
) {
  const enabled = yield* Ref.make(false)
  const calls = yield* Ref.make(0)
  const concurrent = yield* Ref.make(0)
  const maximum = yield* Ref.make(0)
  const result = yield* Deferred.make<Issue275RefreshResult>()
  const read: TrackerGraphReader["Service"]["read"] = (target) =>
    Effect.gen(function* () {
      if (!(yield* Ref.get(enabled))) return yield* reader.read(target)
      yield* Ref.update(calls, (value) => value + 1)
      const active = yield* Ref.updateAndGet(concurrent, (value) => value + 1)
      yield* Ref.update(maximum, (value) => Math.max(value, active))
      return yield* reader.read(target).pipe(Effect.ensuring(Ref.update(concurrent, (value) => value - 1)))
    })
  const run = <E, R>(input: Issue268Ds04TimerCheckpointInput<E, R>) =>
    Effect.gen(function* () {
      const before = yield* input.snapshot
      const sources = yield* Ref.make<ReadonlyArray<string>>([])
      const startupEntered = yield* Deferred.make<void>()
      const releaseStartup = yield* Deferred.make<void>()
      const settled = yield* Queue.unbounded<"Ordinary" | "ActiveWorkAuthorityRefresh">()
      const failure = yield* Deferred.make<unknown>()
      const ownerLayer = runReactivationOwnerLayer({
        activate: () =>
          Deferred.succeed(startupEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseStartup)),
            Effect.as(input.startupDecision)
          ),
        activateActiveWorkAuthorityRefresh: (source) =>
          Ref.update(sources, (values) => [...values, source]).pipe(
            Effect.andThen(input.activateActiveRefresh(source))
          ),
        activationInterval: "1 second",
        failureCooldown: "1 second",
        installAcceptedRunReactivationObservers: input.installObservers,
        isTerminationFailure: () => false,
        onActivationFinalizationStart: (kind) => Queue.offer(settled, kind).pipe(Effect.asVoid),
        onFailure: (error) => Deferred.succeed(failure, error).pipe(Effect.asVoid),
        readControl: input.readControl,
        runId: input.runId
      }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, input.applicationExit)))
      const awaitSettled = Queue.take(settled).pipe(
        Effect.raceFirst(Deferred.await(failure).pipe(Effect.flatMap((error) => Effect.die(error))))
      )
      const after = yield* Effect.gen(function* () {
        const owner = yield* RunReactivationOwner
        yield* Deferred.await(startupEntered)
        yield* Ref.set(enabled, true)
        const projected = projectTrackerSnapshot({
          revision: "G5",
          rootTaskId: scenario.taskIds.A,
          tasks: ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({
            id: TaskId.make(id),
            lifecycle: { _tag: "Open" },
            parentTaskId: null,
            prerequisiteIds: []
          }))
        })
        if (projected._tag === "Invalid") return yield* Effect.die("invalid G5 fixture")
        yield* tracker.setSnapshot(projected.snapshot)
        yield* owner.hint(RunReactivationHint.AcceptedFactPublication())
        yield* owner.hint(RunReactivationHint.TrackerNotification())
        yield* TestClock.adjust("1 second")
        yield* owner.hint(RunReactivationHint.Timer())
        yield* owner.hint(RunReactivationHint.Timer())
        yield* Deferred.succeed(releaseStartup, undefined)
        yield* awaitSettled
        yield* awaitSettled
        return yield* input.snapshot
      }).pipe(Effect.provide(ownerLayer))
      yield* Deferred.succeed(result, {
        before,
        after,
        graphReads: yield* Ref.get(calls),
        maximumGraphReads: yield* Ref.get(maximum),
        sources: yield* Ref.get(sources)
      })
      return yield* Effect.never
    })
  return { read, result, run }
})

interface Issue275GraphRefreshOperations {
  readonly read: TrackerGraphReader["Service"]["read"]
  readonly run: <E, R>(
    input: Issue268Ds04TimerCheckpointInput<E, R>
  ) => Effect.Effect<void, E | ApplicationExiting | RunReactivationIntervalInvalid, R>
}

export type Issue275GraphRefresh = Issue275GraphRefreshOperations & {
  readonly result: Deferred.Deferred<Issue275RefreshResult>
}
