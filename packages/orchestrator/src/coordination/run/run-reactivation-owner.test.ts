import { it } from "@effect/vitest"
import { AttemptId, RunId } from "@dalph/contracts"
import {
  ApplicationExitShell,
  type ApplicationExitDrainFailure,
  type ApplicationExitShellService,
  makeApplicationExitShell
} from "../application-exit/application-shell.js"
import { Deferred, Effect, Fiber, Layer, Queue, Ref, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { RunFinalityDecision } from "../frontier/frontier.js"
import {
  RunReactivationHint,
  RunReactivationIntervalInvalid,
  RunReactivationOwner,
  type RunReactivationOwnerOptions,
  type RunReactivationOwnerService,
  runReactivationOwnerLayer
} from "./run-reactivation-owner.js"
import type { AcceptedRunControlObserver } from "./run.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { makeCurrentSignal } from "../delivery/relations.js"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsFor,
  RunActivationOpportunity
} from "./run-activation-opportunity.js"

class TestTrackerReadFailure extends Schema.TaggedError<TestTrackerReadFailure>()("TestTrackerReadFailure", {
  detail: Schema.String
}) {}

class TestGitReadFailure extends Schema.TaggedError<TestGitReadFailure>()("TestGitReadFailure", {
  detail: Schema.String
}) {}

class TestAlreadyTerminatedFailure extends Schema.TaggedError<TestAlreadyTerminatedFailure>()(
  "TestAlreadyTerminatedFailure",
  {}
) {}

const isTestAlreadyTerminatedFailure = (failure: unknown): boolean =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "TestAlreadyTerminatedFailure"

const makeTestExitShell = Effect.gen(function* () {
  const drains = yield* Ref.make<ReadonlyArray<Effect.Effect<void, ApplicationExitDrainFailure>>>([])
  const shell = ApplicationExitShell.of({
    admission: {
      prepareForwardOwner: () => Effect.succeed({ cancel: Effect.void, register: Effect.die("unused") }),
      acquireForwardOwner: () => Effect.die("unused"),
      snapshot: Effect.succeed({ cutoffClosed: false, preparingOwnerCount: 0, registeredOwnerCount: 0 })
    },
    awaitExitRequested: Effect.never,
    awaitExecutorDrains: Effect.void,
    registerExecutorDrain: () => Effect.void,
    registerProcessLocalDrain: ({ closeProcessLocalResources }) =>
      Ref.update(drains, (current) => [...current, closeProcessLocalResources]),
    requestBoundary: { requestExit: Effect.never }
  } satisfies ApplicationExitShellService)
  return { drains, shell }
})

type TestOwnerOptions<E, R> = Omit<RunReactivationOwnerOptions<E, R>, "activateActiveWorkAuthorityRefresh"> & {
  readonly activateActiveWorkAuthorityRefresh?: RunReactivationOwnerOptions<E, R>["activateActiveWorkAuthorityRefresh"]
}

const ownerLayer = <E, R>(shell: ApplicationExitShellService, options: TestOwnerOptions<E, R>) =>
  runReactivationOwnerLayer({
    ...options,
    activateActiveWorkAuthorityRefresh:
      options.activateActiveWorkAuthorityRefresh ??
      (() => options.activate(RunActivationOpportunity.OrdinaryRunEntry()))
  }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, shell)))

const provideOwner = <E, R, A>(
  shell: ApplicationExitShellService,
  options: TestOwnerOptions<E, R>,
  program: (owner: RunReactivationOwnerService) => Effect.Effect<A>
) =>
  Effect.gen(function* () {
    const owner = yield* RunReactivationOwner
    return yield* program(owner)
  }).pipe(Effect.provide(ownerLayer(shell, options)))

it.effect("maps only tracker notifications and timers to active-work authority refreshes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const opportunities = yield* Ref.make<ReadonlyArray<RunActivationOpportunity>>([])
      const activated = yield* Queue.unbounded<void>()
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-opportunities"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: (opportunity) =>
            Ref.update(opportunities, (current) => [...current, opportunity]).pipe(
              Effect.andThen(Queue.offer(activated, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          activateActiveWorkAuthorityRefresh: (source) =>
            Ref.update(opportunities, (current) => [
              ...current,
              activeWorkAuthorityRefreshForOwner(
                source,
                activeWorkAuthorityRefreshSubjectsFor([
                  { runId: RunId.make("test-run-opportunities"), attemptId: AttemptId.make("test-attempt-A") },
                  { runId: RunId.make("test-run-opportunities"), attemptId: AttemptId.make("test-attempt-B") }
                ])
              )
            ]).pipe(
              Effect.andThen(Queue.offer(activated, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Queue.take(activated)
            yield* owner.hint(RunReactivationHint.AcceptedFactPublication())
            yield* Queue.take(activated)
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Queue.take(activated)
            yield* owner.hint(RunReactivationHint.Timer())
            yield* Queue.take(activated)
            expect(yield* Ref.get(opportunities)).toEqual([
              { _tag: "OrdinaryRunEntry" },
              { _tag: "OrdinaryRunEntry" },
              {
                _tag: "ActiveWorkAuthorityRefresh",
                source: "TrackerNotification",
                subjects: activeWorkAuthorityRefreshSubjectsFor([
                  { runId: RunId.make("test-run-opportunities"), attemptId: AttemptId.make("test-attempt-A") },
                  { runId: RunId.make("test-run-opportunities"), attemptId: AttemptId.make("test-attempt-B") }
                ])
              },
              {
                _tag: "ActiveWorkAuthorityRefresh",
                source: "Timer",
                subjects: activeWorkAuthorityRefreshSubjectsFor([
                  { runId: RunId.make("test-run-opportunities"), attemptId: AttemptId.make("test-attempt-A") },
                  { runId: RunId.make("test-run-opportunities"), attemptId: AttemptId.make("test-attempt-B") }
                ])
              }
            ])
          })
      )
    })
  )
)

it.effect("preserves a current-first tracker notification ahead of Startup", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const firstActivation = yield* Deferred.make<void>()
      const opportunities = yield* Ref.make<ReadonlyArray<RunActivationOpportunity>>([])
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-current-first"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: (opportunity) =>
            Ref.update(opportunities, (current) => [...current, opportunity]).pipe(
              Effect.andThen(Deferred.succeed(firstActivation, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          activateActiveWorkAuthorityRefresh: (source) =>
            Ref.update(opportunities, (current) => [
              ...current,
              activeWorkAuthorityRefreshForOwner(
                source,
                activeWorkAuthorityRefreshSubjectsFor([
                  { runId: RunId.make("test-run-current-first"), attemptId: AttemptId.make("test-attempt") }
                ])
              )
            ]).pipe(
              Effect.andThen(Deferred.succeed(firstActivation, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void,
          trackerNotificationSource: makeCurrentSignal(Effect.succeed({ current: undefined, changes: Stream.never }))
        },
        () =>
          Effect.gen(function* () {
            yield* Deferred.await(firstActivation)
            yield* Effect.yieldNow
            const [first] = yield* Ref.get(opportunities)
            expect(first?._tag).toBe("ActiveWorkAuthorityRefresh")
            expect(yield* Ref.get(opportunities)).toHaveLength(1)
          })
      )
    })
  )
)

it.effect("rejects non-positive timer and cooldown values at the Layer boundary", () =>
  Effect.gen(function* () {
    const shell = yield* makeTestExitShell
    const result = yield* Effect.exit(
      RunReactivationOwner.pipe(
        Effect.provide(
          ownerLayer(shell.shell, {
            runId: RunId.make("test-run-invalid-interval"),
            activationInterval: "0 seconds",
            failureCooldown: "1 second",
            activate: () =>
              Effect.succeed(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })),
            readControl: Effect.succeed("RunUnpaused" as const),
            isTerminationFailure: () => false,
            installAcceptedRunReactivationObservers: () => Effect.void,
            onFailure: () => Effect.void
          })
        )
      )
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") expect(result.cause).toBeDefined()
    expect(new RunReactivationIntervalInvalid({ detail: "x" })._tag).toBe("RunReactivationIntervalInvalid")
  })
)

it.effect("rechecks after a lost notification when TestClock fires, with no Run read per timer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const activations = yield* Ref.make(0)
      const controlReads = yield* Ref.make(0)
      const firstActivation = yield* Deferred.make<void>()
      const secondActivation = yield* Deferred.make<void>()
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-timer"),
          activationInterval: "1 second",
          failureCooldown: "1 second",
          readControl: Ref.updateAndGet(controlReads, (current) => current + 1).pipe(Effect.as("RunUnpaused" as const)),
          activate: () =>
            Ref.updateAndGet(activations, (current) => current + 1).pipe(
              Effect.tap((count) =>
                count === 1
                  ? Deferred.succeed(firstActivation, undefined)
                  : Deferred.succeed(secondActivation, undefined)
              ),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        () =>
          Effect.gen(function* () {
            yield* Deferred.await(firstActivation)
            expect(yield* Ref.get(controlReads)).toBe(1)
            yield* TestClock.adjust("1 second")
            yield* Deferred.await(secondActivation)
            expect(yield* Ref.get(activations)).toBe(2)
            expect(yield* Ref.get(controlReads)).toBe(1)
          })
      )
    })
  )
)

it.effect("coalesces concurrent hints behind one activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const firstStarted = yield* Deferred.make<void>()
      const firstRelease = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const activationCount = yield* Ref.make(0)
      const concurrent = yield* Ref.make(0)
      const maximumConcurrent = yield* Ref.make(0)
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-coalescing"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Effect.gen(function* () {
              const count = yield* Ref.updateAndGet(activationCount, (current) => current + 1)
              const active = yield* Ref.updateAndGet(concurrent, (current) => current + 1)
              yield* Ref.update(maximumConcurrent, (current) => Math.max(current, active))
              if (count === 1) {
                yield* Deferred.succeed(firstStarted, undefined)
                yield* Deferred.await(firstRelease)
              } else {
                yield* Deferred.succeed(secondStarted, undefined)
              }
              yield* Ref.update(concurrent, (current) => current - 1)
              return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
            }),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(firstStarted)
            yield* Effect.forEach(
              [
                RunReactivationHint.TrackerNotification(),
                RunReactivationHint.AcceptedFactPublication(),
                RunReactivationHint.OperatorWake()
              ],
              owner.hint
            )
            yield* Deferred.succeed(firstRelease, undefined)
            yield* Deferred.await(secondStarted)
            yield* Effect.yieldNow
            expect(yield* Ref.get(activationCount)).toBe(2)
            expect(yield* Ref.get(maximumConcurrent)).toBe(1)
          })
      )
    })
  )
)

it.effect("runs one queued active refresh after admission-stalled delivery yields", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const ordinaryStarted = yield* Deferred.make<void>()
      const releaseAdmissionStall = yield* Deferred.make<void>()
      const activeStarted = yield* Deferred.make<void>()
      const releaseActive = yield* Deferred.make<void>()
      const activeFinalizationStarted = yield* Deferred.make<void>()
      const activeIdle = yield* Deferred.make<void>()
      const activeIdleArmed = yield* Ref.make(false)
      const kinds = yield* Ref.make<ReadonlyArray<"OrdinaryRunEntry" | "ActiveWorkAuthorityRefresh">>([])
      const concurrent = yield* Ref.make(0)
      const maximumConcurrent = yield* Ref.make(0)
      const enter = (kind: "OrdinaryRunEntry" | "ActiveWorkAuthorityRefresh") =>
        Effect.gen(function* () {
          yield* Ref.update(kinds, (current) => [...current, kind])
          const active = yield* Ref.updateAndGet(concurrent, (current) => current + 1)
          yield* Ref.update(maximumConcurrent, (current) => Math.max(current, active))
        })
      const leave = Ref.update(concurrent, (current) => current - 1)

      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-admission-stalled-trailing-refresh"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Effect.gen(function* () {
              yield* enter("OrdinaryRunEntry")
              yield* Deferred.succeed(ordinaryStarted, undefined)
              yield* Deferred.await(releaseAdmissionStall)
              return RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })
            }).pipe(Effect.ensuring(leave)),
          activateActiveWorkAuthorityRefresh: () =>
            Effect.gen(function* () {
              yield* enter("ActiveWorkAuthorityRefresh")
              yield* Deferred.succeed(activeStarted, undefined)
              yield* Deferred.await(releaseActive)
              return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
            }).pipe(Effect.ensuring(leave)),
          onActivationFinalizationStart: (kind) =>
            kind === "ActiveWorkAuthorityRefresh"
              ? Ref.set(activeIdleArmed, true).pipe(
                  Effect.andThen(Deferred.succeed(activeFinalizationStarted, undefined))
                )
              : Effect.void,
          onActivationHandoffIdle: () =>
            Ref.getAndSet(activeIdleArmed, false).pipe(
              Effect.flatMap((armed) => (armed ? Deferred.succeed(activeIdle, undefined) : Effect.void))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(ordinaryStarted)
            yield* Effect.forEach(
              [
                RunReactivationHint.TrackerNotification(),
                RunReactivationHint.Timer(),
                RunReactivationHint.TrackerNotification(),
                RunReactivationHint.Timer()
              ],
              owner.hint
            )
            expect(yield* Ref.get(kinds)).toEqual(["OrdinaryRunEntry"])
            yield* Deferred.succeed(releaseAdmissionStall, undefined)
            yield* Deferred.await(activeStarted)
            expect(yield* Ref.get(kinds)).toEqual(["OrdinaryRunEntry", "ActiveWorkAuthorityRefresh"])
            yield* Deferred.succeed(releaseActive, undefined)
            yield* Deferred.await(activeFinalizationStarted)
            yield* Deferred.await(activeIdle)
            const [drain] = yield* Ref.get(shell.drains)
            if (drain === undefined) return yield* Effect.die("owner did not register its process-local drain")
            yield* Effect.orDie(drain)
            yield* owner.hint(RunReactivationHint.Timer())
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            expect(yield* Ref.get(kinds)).toEqual(["OrdinaryRunEntry", "ActiveWorkAuthorityRefresh"])
            expect(yield* Ref.get(concurrent)).toBe(0)
            expect(yield* Ref.get(maximumConcurrent)).toBe(1)
          })
      )
    })
  )
)

it.effect("coalesces hints arriving during an active refresh into one trailing active refresh", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const ordinaryStarted = yield* Deferred.make<void>()
      const ordinaryFinished = yield* Deferred.make<void>()
      const activeStarted = yield* Deferred.make<void>()
      const releaseActive = yield* Deferred.make<void>()
      const trailingActiveStarted = yield* Deferred.make<void>()
      const kinds = yield* Ref.make<ReadonlyArray<"OrdinaryRunEntry" | "ActiveWorkAuthorityRefresh">>([])
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-active-trailing"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.updateAndGet(kinds, (current) => [...current, "OrdinaryRunEntry" as const]).pipe(
              Effect.tap((current) =>
                current.length === 1 ? Deferred.succeed(ordinaryStarted, undefined) : Effect.void
              ),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })),
              Effect.tap(() => Deferred.succeed(ordinaryFinished, undefined))
            ),
          activateActiveWorkAuthorityRefresh: () =>
            Ref.updateAndGet(kinds, (current) => [...current, "ActiveWorkAuthorityRefresh" as const]).pipe(
              Effect.tap((current) =>
                current.length === 3 ? Deferred.succeed(trailingActiveStarted, undefined) : Effect.void
              ),
              Effect.andThen(Deferred.succeed(activeStarted, undefined)),
              Effect.andThen(Deferred.await(releaseActive)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(ordinaryStarted)
            yield* Deferred.await(ordinaryFinished)
            yield* Effect.yieldNow
            yield* Effect.yieldNow
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.await(activeStarted)
            yield* owner.hint(RunReactivationHint.Timer())
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.succeed(releaseActive, undefined)
            yield* Deferred.await(trailingActiveStarted)
            expect(yield* Ref.get(kinds)).toEqual([
              "OrdinaryRunEntry",
              "ActiveWorkAuthorityRefresh",
              "ActiveWorkAuthorityRefresh"
            ])
          })
      )
    })
  )
)

it.effect("preserves an authority hint blocked by active finalization as one trailing active refresh", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const ownerReady = yield* Deferred.make<RunReactivationOwnerService>()
      const activeStarted = yield* Deferred.make<void>()
      const releaseActive = yield* Deferred.make<void>()
      const producerFiber = yield* Deferred.make<Fiber.Fiber<void, never>>()
      const finalizationStarted = yield* Deferred.make<void>()
      const releaseFinalization = yield* Deferred.make<void>()
      const trailingActiveStarted = yield* Deferred.make<void>()
      const activeCalls = yield* Ref.make(0)
      const ordinaryCalls = yield* Ref.make(0)
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-finalization-handoff"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.updateAndGet(ordinaryCalls, (current) => current + 1).pipe(
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          activateActiveWorkAuthorityRefresh: () =>
            Ref.updateAndGet(activeCalls, (current) => current + 1).pipe(
              Effect.tap((count) => Deferred.succeed(count === 1 ? activeStarted : trailingActiveStarted, undefined)),
              Effect.andThen(Deferred.await(releaseActive)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          trackerNotificationSource: makeCurrentSignal(Effect.succeed({ current: undefined, changes: Stream.never })),
          onActivationFinalizationStart: (kind) =>
            kind === "ActiveWorkAuthorityRefresh"
              ? Effect.gen(function* () {
                  yield* Deferred.succeed(finalizationStarted, undefined)
                  const owner = yield* Deferred.await(ownerReady)
                  // The callback itself runs while commandGate is held. Let
                  // the child reach owner.hint before releasing that gate so
                  // this is a deterministic blocked-producer race.
                  const producer = yield* owner.hint(RunReactivationHint.Timer()).pipe(Effect.forkChild)
                  yield* Effect.yieldNow
                  yield* Deferred.succeed(producerFiber, producer)
                  yield* Deferred.await(releaseFinalization)
                })
              : Effect.void,
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(ownerReady, owner)
            yield* Deferred.await(activeStarted)
            yield* Deferred.succeed(releaseActive, undefined)
            yield* Deferred.await(finalizationStarted)
            const producer = yield* Deferred.await(producerFiber)
            yield* Deferred.succeed(releaseFinalization, undefined)
            yield* Fiber.join(producer)
            yield* Deferred.await(trailingActiveStarted)
            yield* Effect.yieldNow
            expect(yield* Ref.get(activeCalls)).toBe(2)
            expect(yield* Ref.get(ordinaryCalls)).toBe(0)
          })
      )
    })
  )
)

it.effect("keeps a blocked trailing marker ahead of a post-idle hint until it is consumed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const ownerReady = yield* Deferred.make<RunReactivationOwnerService>()
      const firstOrdinaryFinished = yield* Deferred.make<void>()
      const activeStarted = yield* Deferred.make<void>()
      const releaseActive = yield* Deferred.make<void>()
      const finalizationStarted = yield* Deferred.make<void>()
      const releaseFinalization = yield* Deferred.make<void>()
      const producerFiber = yield* Deferred.make<Fiber.Fiber<void, never>>()
      const trailingRecorded = yield* Deferred.make<void>()
      const postIdleHintSent = yield* Deferred.make<void>()
      const trailingActiveStarted = yield* Deferred.make<void>()
      const idleHookArmed = yield* Ref.make(false)
      const kinds = yield* Ref.make<ReadonlyArray<"OrdinaryRunEntry" | "ActiveWorkAuthorityRefresh">>([])
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-durable-trailing-marker"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.updateAndGet(kinds, (current) => [...current, "OrdinaryRunEntry" as const]).pipe(
              Effect.tap((current) =>
                current.length === 1 ? Deferred.succeed(firstOrdinaryFinished, undefined) : Effect.void
              ),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          activateActiveWorkAuthorityRefresh: () =>
            Ref.updateAndGet(kinds, (current) => [...current, "ActiveWorkAuthorityRefresh" as const]).pipe(
              Effect.tap((current) =>
                current.length === 3 ? Deferred.succeed(trailingActiveStarted, undefined) : Effect.void
              ),
              Effect.andThen(Deferred.succeed(activeStarted, undefined)),
              Effect.andThen(Deferred.await(releaseActive)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          onActivationFinalizationStart: (kind) =>
            kind === "ActiveWorkAuthorityRefresh"
              ? Effect.gen(function* () {
                  yield* Ref.set(idleHookArmed, true)
                  const owner = yield* Deferred.await(ownerReady)
                  // This producer captures Finalizing before the finalizer
                  // releases its gate, then waits to record the marker.
                  const producer = yield* owner.hint(RunReactivationHint.Timer()).pipe(Effect.forkChild)
                  yield* Deferred.succeed(producerFiber, producer)
                  yield* Effect.yieldNow
                  yield* Deferred.succeed(finalizationStarted, undefined)
                  yield* Deferred.await(releaseFinalization)
                })
              : Effect.void,
          onTrailingActivationRecorded: () => Deferred.succeed(trailingRecorded, undefined),
          // The worker observes Idle before taking its next queue value. Wait
          // for the blocked producer's marker, then send the second hint in
          // that exact pre-take interval.
          onActivationHandoffIdle: () =>
            Effect.gen(function* () {
              if (!(yield* Ref.getAndSet(idleHookArmed, false))) return
              yield* Deferred.await(trailingRecorded)
              const owner = yield* Deferred.await(ownerReady)
              yield* owner.hint(RunReactivationHint.TrackerNotification())
              yield* Deferred.succeed(postIdleHintSent, undefined)
            }),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(ownerReady, owner)
            yield* Deferred.await(firstOrdinaryFinished)
            yield* Effect.yieldNow
            yield* Effect.yieldNow
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.await(activeStarted)
            yield* Deferred.succeed(releaseActive, undefined)
            yield* Deferred.await(finalizationStarted)
            yield* Deferred.succeed(releaseFinalization, undefined)
            const producer = yield* Deferred.await(producerFiber)
            yield* Fiber.join(producer)
            yield* Deferred.await(postIdleHintSent)
            yield* Deferred.await(trailingActiveStarted)
            expect(yield* Ref.get(kinds)).toEqual([
              "OrdinaryRunEntry",
              "ActiveWorkAuthorityRefresh",
              "ActiveWorkAuthorityRefresh"
            ])
          })
      )
    })
  )
)

it.effect("retains one trailing ordinary activation when the active handoff rejects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const ordinaryStarted = yield* Deferred.make<void>()
      const ordinaryFinished = yield* Deferred.make<void>()
      const activeStarted = yield* Deferred.make<void>()
      const releaseActive = yield* Deferred.make<void>()
      const failureObserved = yield* Deferred.make<void>()
      const trailingOrdinaryStarted = yield* Deferred.make<void>()
      const kinds = yield* Ref.make<ReadonlyArray<"OrdinaryRunEntry" | "ActiveWorkAuthorityRefresh">>([])
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-active-rejected"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.updateAndGet(kinds, (current) => [...current, "OrdinaryRunEntry" as const]).pipe(
              Effect.tap((current) =>
                current.length === 1
                  ? Deferred.succeed(ordinaryStarted, undefined)
                  : Deferred.succeed(trailingOrdinaryStarted, undefined)
              ),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })),
              Effect.tap(() => Deferred.succeed(ordinaryFinished, undefined))
            ),
          activateActiveWorkAuthorityRefresh: () =>
            Effect.gen(function* () {
              yield* Ref.update(kinds, (current) => [...current, "ActiveWorkAuthorityRefresh" as const])
              yield* Deferred.succeed(activeStarted, undefined)
              yield* Deferred.await(releaseActive)
              return yield* new TestTrackerReadFailure({ detail: "active handoff rejected" })
            }),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Deferred.succeed(failureObserved, undefined)
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(ordinaryStarted)
            yield* Deferred.await(ordinaryFinished)
            yield* Effect.yieldNow
            yield* Effect.yieldNow
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.await(activeStarted)
            yield* owner.hint(RunReactivationHint.Timer())
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.succeed(releaseActive, undefined)
            yield* Deferred.await(failureObserved)
            expect(yield* Ref.get(kinds)).toEqual(["OrdinaryRunEntry", "ActiveWorkAuthorityRefresh"])
            yield* TestClock.adjust("1 second")
            yield* Deferred.await(trailingOrdinaryStarted)
            expect(yield* Ref.get(kinds)).toEqual([
              "OrdinaryRunEntry",
              "ActiveWorkAuthorityRefresh",
              "OrdinaryRunEntry"
            ])
          })
      )
    })
  )
)

it.effect("a later timer retries an unreadable active-work refresh as a fresh authority check", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const ordinaryStarted = yield* Deferred.make<void>()
      const firstFailureObserved = yield* Deferred.make<void>()
      const secondRefreshFinished = yield* Deferred.make<void>()
      const sources = yield* Ref.make<ReadonlyArray<"TrackerNotification" | "Timer">>([])
      const ordinaryCalls = yield* Ref.make(0)
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-unreadable-active-refresh"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.updateAndGet(ordinaryCalls, (current) => current + 1).pipe(
              Effect.tap(() => Deferred.succeed(ordinaryStarted, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          activateActiveWorkAuthorityRefresh: (source) =>
            Effect.gen(function* () {
              const attempted = yield* Ref.updateAndGet(sources, (current) => [...current, source])
              if (attempted.length === 1) {
                return yield* new TestGitReadFailure({ detail: "active authority is unreadable" })
              }
              yield* Deferred.succeed(secondRefreshFinished, undefined)
              return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
            }),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Deferred.succeed(firstFailureObserved, undefined)
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(ordinaryStarted)
            yield* Effect.yieldNow
            yield* Effect.yieldNow
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.await(firstFailureObserved)
            yield* TestClock.adjust("1 second")
            yield* owner.hint(RunReactivationHint.Timer())
            yield* Deferred.await(secondRefreshFinished)
            expect(yield* Ref.get(sources)).toEqual(["TrackerNotification", "Timer"])
            expect(yield* Ref.get(ordinaryCalls)).toBe(1)
          })
      )
    })
  )
)

it.effect("observes one typed activation failure, cools down, and waits for a later hint", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const attempts = yield* Ref.make(0)
      const firstAttempt = yield* Deferred.make<void>()
      const secondAttempt = yield* Deferred.make<void>()
      const failureObserved = yield* Deferred.make<void>()
      const recovered = yield* Deferred.make<void>()
      const failures = yield* Ref.make<ReadonlyArray<string>>([])
      const currentReads = yield* Ref.make(0)
      const mutationCalls = yield* Ref.make(0)
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-failure"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Effect.gen(function* () {
              yield* Ref.update(currentReads, (current) => current + 1)
              const attempt = yield* Ref.updateAndGet(attempts, (current) => current + 1)
              if (attempt === 1) {
                yield* Deferred.succeed(firstAttempt, undefined)
                return yield* new TestTrackerReadFailure({ detail: "tracker unavailable" })
              }
              if (attempt === 2) {
                yield* Deferred.succeed(secondAttempt, undefined)
                return yield* new TestGitReadFailure({ detail: "git unavailable" })
              }
              yield* Ref.update(mutationCalls, (current) => current + 1)
              yield* Deferred.succeed(recovered, undefined)
              return RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
            }),
          onFailure: (failure) =>
            Ref.update(failures, (current) => [...current, failure._tag]).pipe(
              Effect.andThen(Deferred.succeed(failureObserved, undefined))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(firstAttempt)
            yield* Deferred.await(failureObserved)
            yield* TestClock.adjust("999 millis")
            expect(yield* Ref.get(attempts)).toBe(1)
            yield* TestClock.adjust("1 millis")
            yield* owner.hint(RunReactivationHint.OperatorWake())
            yield* Deferred.await(secondAttempt)
            yield* TestClock.adjust("1 second")
            yield* owner.hint(RunReactivationHint.OperatorWake())
            yield* Deferred.await(recovered)
            expect(yield* Ref.get(attempts)).toBe(3)
            expect(yield* Ref.get(currentReads)).toBe(3)
            expect(yield* Ref.get(mutationCalls)).toBe(1)
            expect(yield* Ref.get(failures)).toEqual(["TestTrackerReadFailure", "TestGitReadFailure"])
          })
      )
    })
  )
)

it.effect("uses current-first control state: paused restart is passive and accepted Unpause activates once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const activations = yield* Ref.make(0)
      const activated = yield* Deferred.make<void>()
      const acceptedControl = yield* Deferred.make<AcceptedRunControlObserver>()
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-paused"),
          activationInterval: "1 second",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunPaused" as const),
          activate: () =>
            Ref.updateAndGet(activations, (current) => current + 1).pipe(
              Effect.tap(() => Deferred.succeed(activated, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: ({ control }) => Deferred.succeed(acceptedControl, control),
          onFailure: () => Effect.void
        },
        () =>
          Effect.gen(function* () {
            yield* TestClock.adjust("1 hour")
            expect(yield* Ref.get(activations)).toBe(0)
            yield* (yield* Deferred.await(acceptedControl))("Unpause")
            yield* Deferred.await(activated)
            expect(yield* Ref.get(activations)).toBe(1)
          })
      )
    })
  )
)

it.effect("accepted Pause suppresses active refresh until Unpause completes its ordinary current read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const acceptedControl = yield* Deferred.make<AcceptedRunControlObserver>()
      const handoffIdle = yield* Queue.unbounded<void>()
      const unpauseReadStarted = yield* Deferred.make<void>()
      const releaseUnpauseRead = yield* Deferred.make<void>()
      const activeReadStarted = yield* Deferred.make<void>()
      const ordinaryReads = yield* Ref.make(0)
      const chronology = yield* Ref.make<ReadonlyArray<string>>([])

      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-pause-unpause-active-refresh"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Effect.gen(function* () {
              const ordinal = yield* Ref.updateAndGet(ordinaryReads, (current) => current + 1)
              if (ordinal === 1) {
                yield* Ref.update(chronology, (current) => [...current, "startup current read completed"])
              } else {
                yield* Ref.update(chronology, (current) => [...current, "Unpause current read started"])
                yield* Deferred.succeed(unpauseReadStarted, undefined)
                yield* Deferred.await(releaseUnpauseRead)
                yield* Ref.update(chronology, (current) => [...current, "Unpause current read completed"])
              }
              return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
            }),
          activateActiveWorkAuthorityRefresh: (source) =>
            Ref.update(chronology, (current) => [...current, `active read started from ${source}`]).pipe(
              Effect.andThen(Deferred.succeed(activeReadStarted, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: ({ control }) => Deferred.succeed(acceptedControl, control),
          onActivationHandoffIdle: () => Queue.offer(handoffIdle, undefined),
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Queue.take(handoffIdle)
            const control = yield* Deferred.await(acceptedControl)

            yield* control("Pause")
            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* owner.hint(RunReactivationHint.Timer())
            yield* TestClock.adjust("2 hours")
            expect(yield* Deferred.isDone(activeReadStarted)).toBe(false)

            yield* control("Unpause")
            yield* Deferred.await(unpauseReadStarted)
            expect(yield* Deferred.isDone(activeReadStarted)).toBe(false)
            yield* Deferred.succeed(releaseUnpauseRead, undefined)
            yield* Queue.take(handoffIdle)

            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.await(activeReadStarted)
            expect(yield* Ref.get(chronology)).toEqual([
              "startup current read completed",
              "Unpause current read started",
              "Unpause current read completed",
              "active read started from TrackerNotification"
            ])
          })
      )
    })
  )
)

it.effect("starts each restarted owner with fresh timer, hint, and coalescing state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = RunId.make("test-run-active-refresh-restart")
      const chronology = yield* Ref.make<ReadonlyArray<string>>([])
      const firstActiveStarted = yield* Deferred.make<void>()

      yield* Effect.scoped(
        Effect.gen(function* () {
          const shell = yield* makeTestExitShell
          const handoffIdle = yield* Queue.unbounded<void>()
          yield* provideOwner(
            shell.shell,
            {
              runId,
              activationInterval: "1 hour",
              failureCooldown: "1 second",
              readControl: Effect.succeed("RunUnpaused" as const),
              activate: () =>
                Ref.update(chronology, (current) => [...current, "process 1 startup current read"]).pipe(
                  Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
                ),
              activateActiveWorkAuthorityRefresh: (source) =>
                Ref.update(chronology, (current) => [...current, `process 1 active read from ${source}`]).pipe(
                  Effect.andThen(Deferred.succeed(firstActiveStarted, undefined)),
                  Effect.andThen(Effect.never)
                ),
              isTerminationFailure: () => false,
              installAcceptedRunReactivationObservers: () => Effect.void,
              onActivationHandoffIdle: () => Queue.offer(handoffIdle, undefined),
              onFailure: () => Effect.void
            },
            (owner) =>
              Effect.gen(function* () {
                yield* Queue.take(handoffIdle)
                yield* TestClock.adjust("59 minutes")
                yield* owner.hint(RunReactivationHint.TrackerNotification())
                yield* Deferred.await(firstActiveStarted)
                yield* owner.hint(RunReactivationHint.Timer())
                yield* owner.hint(RunReactivationHint.AcceptedFactPublication())
              })
          )
        })
      )

      const secondActiveStarted = yield* Deferred.make<void>()
      const secondShell = yield* makeTestExitShell
      const secondHandoffIdle = yield* Queue.unbounded<void>()
      yield* provideOwner(
        secondShell.shell,
        {
          runId,
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.update(chronology, (current) => [...current, "process 2 startup current read"]).pipe(
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          activateActiveWorkAuthorityRefresh: (source) =>
            Ref.update(chronology, (current) => [...current, `process 2 active read from ${source}`]).pipe(
              Effect.andThen(Deferred.succeed(secondActiveStarted, undefined)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onActivationHandoffIdle: () => Queue.offer(secondHandoffIdle, undefined),
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Queue.take(secondHandoffIdle)
            yield* TestClock.adjust("1 minute")
            expect(yield* Deferred.isDone(secondActiveStarted)).toBe(false)
            expect(yield* Ref.get(chronology)).toEqual([
              "process 1 startup current read",
              "process 1 active read from TrackerNotification",
              "process 2 startup current read"
            ])

            yield* owner.hint(RunReactivationHint.TrackerNotification())
            yield* Deferred.await(secondActiveStarted)
            expect(yield* Ref.get(chronology)).toEqual([
              "process 1 startup current read",
              "process 1 active read from TrackerNotification",
              "process 2 startup current read",
              "process 2 active read from TrackerNotification"
            ])
          })
      )
    })
  )
)

it.effect("replays durable Pause between observer attachment and the mandatory current read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const activations = yield* Ref.make(0)
      const acceptedControl = yield* Deferred.make<AcceptedRunControlObserver>()
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-attach-read-race"),
          activationInterval: "1 second",
          failureCooldown: "1 second",
          // Deliberately stale: the accepted callback below wins while the
          // current read is attaching and must not be overwritten.
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.update(activations, (current) => current + 1).pipe(
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: ({ control }) =>
            control("Pause").pipe(Effect.andThen(Deferred.succeed(acceptedControl, control))),
          onFailure: () => Effect.void
        },
        () =>
          Effect.gen(function* () {
            yield* TestClock.adjust("1 hour")
            expect(yield* Ref.get(activations)).toBe(0)
            yield* (yield* Deferred.await(acceptedControl))("Unpause")
            yield* Effect.yieldNow
            expect(yield* Ref.get(activations)).toBe(1)
          })
      )
    })
  )
)

it.effect("stops the Run-specific timer on accepted Pause and starts one fresh timer on Unpause", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const activations = yield* Ref.make(0)
      const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
      const acceptedControl = yield* Deferred.make<AcceptedRunControlObserver>()
      const firstActivation = yield* Deferred.make<void>()
      const releaseFirstActivation = yield* Deferred.make<void>()
      const secondActivation = yield* Deferred.make<void>()
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-timer-lifecycle"),
          activationInterval: "1 hour",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.updateAndGet(activations, (current) => current + 1).pipe(
              Effect.tap((count) =>
                count === 1
                  ? Deferred.succeed(firstActivation, undefined)
                  : Deferred.succeed(secondActivation, undefined)
              ),
              Effect.tap((count) => (count === 1 ? Deferred.await(releaseFirstActivation) : Effect.void)),
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: ({ control }) => Deferred.succeed(acceptedControl, control),
          onTimerStateChange: (state) => Ref.update(timerStates, (current) => [...current, state]),
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(firstActivation)
            expect(yield* Ref.get(timerStates)).toEqual(["Started"])
            yield* owner.hint(RunReactivationHint.AcceptedFactPublication())
            yield* (yield* Deferred.await(acceptedControl))("Pause")
            yield* (yield* Deferred.await(acceptedControl))("Pause")
            yield* Deferred.succeed(releaseFirstActivation, undefined)
            expect(yield* Ref.get(timerStates)).toEqual(["Started", "Stopped"])
            yield* TestClock.adjust("2 hours")
            expect(yield* Ref.get(activations)).toBe(1)
            yield* (yield* Deferred.await(acceptedControl))("Unpause")
            yield* (yield* Deferred.await(acceptedControl))("Unpause")
            expect(yield* Ref.get(timerStates)).toEqual(["Started", "Stopped", "Started"])
            yield* Deferred.await(secondActivation)
            expect(yield* Ref.get(activations)).toBe(2)
          })
      )
    })
  )
)

it.effect("stops its timer when activation returns RunMayTerminate", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const activations = yield* Ref.make(0)
      const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-may-terminate"),
          activationInterval: "1 second",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Ref.update(activations, (current) => current + 1).pipe(Effect.as(RunFinalityDecision.RunMayTerminate())),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void,
          onTimerStateChange: (state) => Ref.update(timerStates, (current) => [...current, state])
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Effect.yieldNow
            yield* owner.hint(RunReactivationHint.Timer())
            yield* TestClock.adjust("1 hour")
            expect(yield* Ref.get(activations)).toBe(1)
            expect(yield* Ref.get(timerStates)).toEqual(["Started", "Stopped"])
          })
      )
    })
  )
)

it.effect("stops on an activation-observed terminated Run instead of cooling down for replay", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const attempts = yield* Ref.make(0)
      const failureObserved = yield* Deferred.make<void>()
      const timerStopped = yield* Deferred.make<void>()
      const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-activation-terminated"),
          activationInterval: "1 second",
          failureCooldown: "1 hour",
          readControl: Effect.succeed("RunUnpaused" as const),
          activate: () =>
            Effect.gen(function* () {
              yield* Ref.update(attempts, (current) => current + 1)
              return yield* new TestAlreadyTerminatedFailure()
            }),
          isTerminationFailure: isTestAlreadyTerminatedFailure,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onTimerStateChange: (state) =>
            Ref.update(timerStates, (current) => [...current, state]).pipe(
              Effect.andThen(state === "Stopped" ? Deferred.succeed(timerStopped, undefined) : Effect.void)
            ),
          onFailure: () => Deferred.succeed(failureObserved, undefined)
        },
        (owner) =>
          Effect.gen(function* () {
            yield* Deferred.await(failureObserved)
            expect(yield* Ref.get(attempts)).toBe(1)
            yield* Deferred.await(timerStopped)
            expect(yield* Ref.get(timerStates)).toEqual(["Started", "Stopped"])
            yield* owner.hint(RunReactivationHint.OperatorWake())
            yield* TestClock.adjust("2 hours")
            expect(yield* Ref.get(attempts)).toBe(1)
          })
      )
    })
  )
)

it.effect("treats terminated history as closure and never schedules a fresh activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const activations = yield* Ref.make(0)
      yield* provideOwner(
        shell.shell,
        {
          runId: RunId.make("test-run-terminated"),
          activationInterval: "1 second",
          failureCooldown: "1 second",
          readControl: Effect.succeed("RunTerminated" as const),
          activate: () =>
            Ref.update(activations, (current) => current + 1).pipe(
              Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
            ),
          isTerminationFailure: () => false,
          installAcceptedRunReactivationObservers: () => Effect.void,
          onFailure: () => Effect.void
        },
        (owner) =>
          Effect.gen(function* () {
            yield* owner.hint(RunReactivationHint.Timer())
            yield* TestClock.adjust("1 hour")
            expect(yield* Ref.get(activations)).toBe(0)
          })
      )
    })
  )
)

it.effect("keeps one owner per exact Run composition and lets Exit stop after the active boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeTestExitShell
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const activations = yield* Ref.make(0)
      const acceptedControl = yield* Deferred.make<AcceptedRunControlObserver>()
      const ownerLayerInstance = ownerLayer(shell.shell, {
        runId: RunId.make("test-run-exit"),
        activationInterval: "1 second",
        failureCooldown: "1 second",
        readControl: Effect.succeed("RunUnpaused" as const),
        activate: () =>
          Ref.updateAndGet(activations, (current) => current + 1).pipe(
            Effect.tap(() => Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
            Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          ),
        isTerminationFailure: () => false,
        installAcceptedRunReactivationObservers: ({ control }) => Deferred.succeed(acceptedControl, control),
        onFailure: () => Effect.void
      })
      yield* Effect.gen(function* () {
        const first = yield* RunReactivationOwner
        const second = yield* RunReactivationOwner
        expect(first).toBe(second)
        yield* Deferred.await(started)
        const [drain] = yield* Ref.get(shell.drains)
        if (drain === undefined) return yield* Effect.die("owner did not register Exit drain")
        yield* drain
        yield* Deferred.succeed(release, undefined)
        yield* (yield* Deferred.await(acceptedControl))("Pause")
        yield* (yield* Deferred.await(acceptedControl))("Unpause")
        yield* TestClock.adjust("1 hour")
        expect(yield* Ref.get(activations)).toBe(1)
      }).pipe(Effect.provide(ownerLayerInstance))
    })
  )
)

it.effect("registers its drain before Exit can pass a blocking tracker-source attachment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const sourceAttaching = yield* Deferred.make<void>()
      const allowSourceAttachment = yield* Deferred.make<void>()
      const activations = yield* Ref.make(0)
      const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      const trackerNotificationSource = makeCurrentSignal(
        Deferred.succeed(sourceAttaching, undefined).pipe(
          Effect.andThen(Deferred.await(allowSourceAttachment)),
          Effect.as({ current: undefined, changes: Stream.never })
        )
      )
      const layer = ownerLayer(shell, {
        runId: RunId.make("test-run-exit-during-source-attachment"),
        activationInterval: "1 second",
        failureCooldown: "1 second",
        readControl: Effect.succeed("RunUnpaused" as const),
        activate: () =>
          Ref.update(activations, (current) => current + 1).pipe(
            Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          ),
        isTerminationFailure: () => false,
        installAcceptedRunReactivationObservers: () => Effect.void,
        onFailure: () => Effect.void,
        onTimerStateChange: (state) => Ref.update(timerStates, (current) => [...current, state]),
        trackerNotificationSource
      })

      const building = yield* Layer.build(layer).pipe(Effect.forkChild)
      yield* Deferred.await(sourceAttaching)
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      const exitResult = yield* Fiber.join(exiting)
      yield* Deferred.succeed(allowSourceAttachment, undefined)
      yield* Fiber.join(building)
      expect(exitResult).toMatchObject({ _tag: "Succeeded" })
      yield* TestClock.adjust("1 hour")
      expect(yield* Ref.get(activations)).toBe(0)
      expect(yield* Ref.get(timerStates)).toEqual([])
    })
  )
)
