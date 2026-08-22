import { it } from "@effect/vitest"
import {
  type ApplicationExitDrainFailure,
  ApplicationExitShell,
  defaultTaskWorkCapacity,
  FixtureTarget,
  InitialControlPolicy,
  JournaledRunBootstrap,
  PlannedTaskAttemptPlanner,
  RunFinalityDecision,
  TaskClaimAcquisitionPlanner
} from "@dalph/orchestrator"
import { RunId } from "@dalph/contracts"
import { Deferred, Duration, Effect, Fiber, Layer, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { makeProductionRunReactivationOwner, ProductionRunReactivationInterval } from "./production.js"

it.effect("production composition re-enters public runWorkflow for each current check", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const firstActivation = yield* Deferred.make<void>()
      const secondActivation = yield* Deferred.make<void>()
      const registeredDrains = yield* Ref.make<ReadonlyArray<Effect.Effect<void, ApplicationExitDrainFailure>>>([])
      const bootstrap = JournaledRunBootstrap.of({
        activate: (_target, _policy, _runId, _program) =>
          Ref.updateAndGet(activations, (current) => current + 1).pipe(
            Effect.tap((count) =>
              count === 1 ? Deferred.succeed(firstActivation, undefined) : Deferred.succeed(secondActivation, undefined)
            ),
            Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          ),
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
          prepareForwardOwner: () => Effect.die("unused"),
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
      const owner = yield* makeProductionRunReactivationOwner(
        FixtureTarget.make("production-reactivation-target"),
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })),
        RunId.make("production-reactivation-run"),
        { activationInterval: ProductionRunReactivationInterval.make(Duration.seconds(1)) }
      ).pipe(
        Effect.provideService(JournaledRunBootstrap, bootstrap),
        Effect.provideService(ApplicationExitShell, applicationExit)
      )
      const running = yield* owner.run.pipe(
        Effect.provide(
          Layer.mergeAll(Layer.mock(PlannedTaskAttemptPlanner, {}), Layer.mock(TaskClaimAcquisitionPlanner, {}))
        ),
        Effect.forkScoped
      )

      yield* Deferred.await(firstActivation)
      yield* TestClock.adjust("1 second")
      yield* Deferred.await(secondActivation)
      expect(yield* Ref.get(activations)).toBe(2)
      const [exitDrain] = yield* Ref.get(registeredDrains)
      if (exitDrain === undefined) return yield* Effect.die("production owner did not register its Exit drain")
      yield* exitDrain
      yield* Fiber.join(running)
      yield* TestClock.adjust("1 hour")
      expect(yield* Ref.get(activations)).toBe(2)
    })
  )
)
