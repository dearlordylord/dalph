import { it } from "@effect/vitest"
import {
  type ApplicationExitDrainFailure,
  ApplicationExitShell,
  defaultTaskWorkCapacity,
  FixtureTarget,
  InitialControlPolicy,
  JournaledRunBootstrap,
  makeCurrentSignal,
  PlannedTaskAttemptPlanner,
  RunFinalityDecision,
  RunReactivationOwner,
  TaskClaimAcquisitionPlanner,
  type AcceptedRunReactivationObservers
} from "@dalph/orchestrator"
import { RunId } from "@dalph/contracts"
import { Deferred, Duration, Effect, Layer, Queue, Ref, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { productionRunReactivationLayer, ProductionRunReactivationInterval } from "./production.js"

it.effect("rejects a non-positive production reactivation interval at configuration decoding", () =>
  Effect.gen(function* () {
    const failure = yield* Schema.decodeUnknownEffect(ProductionRunReactivationInterval)("0 seconds").pipe(Effect.flip)
    expect(String(failure)).toContain("reactivation intervals must be finite and greater than zero")
  })
)

it.effect("production composition wires current-first tracker notifications and fresh checks", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const firstActivation = yield* Deferred.make<void>()
      const secondActivation = yield* Deferred.make<void>()
      const thirdActivation = yield* Deferred.make<void>()
      const fourthActivation = yield* Deferred.make<void>()
      const trackerNotifications = yield* Queue.unbounded<void>()
      const trackerNotificationSource = makeCurrentSignal(
        Effect.succeed({ current: undefined, changes: Stream.fromQueue(trackerNotifications) })
      )
      const registeredDrains = yield* Ref.make<ReadonlyArray<Effect.Effect<void, ApplicationExitDrainFailure>>>([])
      const registeredObservers = yield* Ref.make<AcceptedRunReactivationObservers | undefined>(undefined)
      const bootstrapTrace = yield* Ref.make<ReadonlyArray<"journal-read" | "bootstrap-activate">>([])
      const bootstrap = JournaledRunBootstrap.of({
        activate: (_target, _policy, _runId, _program) =>
          Ref.update(bootstrapTrace, (current) => [...current, "bootstrap-activate" as const]).pipe(
            Effect.andThen(Ref.updateAndGet(activations, (current) => current + 1)),
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(firstActivation, undefined)
                : count === 2
                  ? Deferred.succeed(secondActivation, undefined)
                  : count === 3
                    ? Deferred.succeed(thirdActivation, undefined)
                    : Deferred.succeed(fourthActivation, undefined)
            ),
            Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          ),
        readRunReactivationControl: () =>
          Ref.update(bootstrapTrace, (current) => [...current, "journal-read" as const]).pipe(
            Effect.as("RunUnpaused" as const)
          ),
        registerAcceptedRunReactivationObservers: (observers) => Ref.set(registeredObservers, observers),
        operatorControl: {
          applyRunCancellation: () => Effect.die("unused"),
          applyIntegrationQuarantineDirection: () => Effect.die("unused"),
          applyAttemptChoice: () => Effect.die("unused"),
          applyControlDirection: () => Effect.die("unused"),
          applyTaskClaimReacquisition: () => Effect.die("unused"),
          readAttemptChoice: () => Effect.die("unused"),
          readIntegrationQuarantineDirection: () => Effect.die("unused"),
          readTaskWorkCapacity: () => Effect.die("unused"),
          observePause: () => Stream.empty,
          setTaskWorkCapacity: () => Effect.die("unused")
        }
      })
      const applicationExit = ApplicationExitShell.of({
        admission: {
          prepareForwardOwner: () => Effect.succeed({ cancel: Effect.void, register: Effect.die("unused") }),
          acquireForwardOwner: () => Effect.die("unused"),
          snapshot: Effect.succeed({ cutoffClosed: false, preparingOwnerCount: 0, registeredOwnerCount: 0 })
        },
        awaitExitRequested: Effect.never,
        awaitExecutorDrains: Effect.void,
        registerExecutorDrain: () => Effect.void,
        registerProcessLocalDrain: ({ closeProcessLocalResources }) =>
          Ref.update(registeredDrains, (drains) => [...drains, closeProcessLocalResources]),
        requestBoundary: { requestExit: Effect.never }
      })
      const productionLayer = productionRunReactivationLayer(
        FixtureTarget.make("production-reactivation-target"),
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })),
        RunId.make("production-reactivation-run"),
        {
          activationInterval: ProductionRunReactivationInterval.make(Duration.seconds(1)),
          failureCooldown: ProductionRunReactivationInterval.make(Duration.seconds(1)),
          onFailure: () => Effect.void,
          trackerNotificationSource
        }
      )
      const providedProductionLayer = productionLayer.pipe(
        Layer.provide(Layer.succeed(JournaledRunBootstrap, bootstrap)),
        Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)),
        Layer.provide(Layer.mock(PlannedTaskAttemptPlanner, {})),
        Layer.provide(Layer.mock(TaskClaimAcquisitionPlanner, {}))
      )
      const run = Effect.gen(function* () {
        const firstOwner = yield* RunReactivationOwner
        const secondOwner = yield* RunReactivationOwner
        expect(firstOwner).toBe(secondOwner)
        yield* Deferred.await(firstActivation)
        yield* Queue.offer(trackerNotifications, undefined)
        yield* Deferred.await(secondActivation)
        yield* TestClock.adjust("1 second")
        yield* Deferred.await(thirdActivation)
        expect(yield* Ref.get(activations)).toBe(3)
        expect(yield* Ref.get(bootstrapTrace)).toEqual([
          "journal-read",
          "bootstrap-activate",
          "bootstrap-activate",
          "bootstrap-activate"
        ])
        const observers = yield* Ref.get(registeredObservers)
        if (observers === undefined) return yield* Effect.die("production owner did not register its observers")
        yield* observers.acceptedFactPublication()
        yield* Deferred.await(fourthActivation)
        expect(yield* Ref.get(activations)).toBe(4)
        const [exitDrain] = yield* Ref.get(registeredDrains)
        if (exitDrain === undefined) return yield* Effect.die("production owner did not register its Exit drain")
        yield* exitDrain
        yield* Effect.yieldNow
        yield* TestClock.adjust("1 hour")
        expect(yield* Ref.get(activations)).toBe(4)
      }).pipe(Effect.provide(Layer.mergeAll(providedProductionLayer)))
      yield* run
    })
  )
)
