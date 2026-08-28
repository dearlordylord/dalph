import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  type ApplicationExitDrainFailure,
  ApplicationExitShell,
  defaultTaskWorkCapacity,
  FixtureTarget,
  InitialControlPolicy,
  JournaledRunBootstrap,
  JournalDatabaseLocator,
  JournalStore,
  WorkflowRunAlreadyBegan,
  memoryJournalTestLayer,
  sqliteJournalTestLayer,
  intentRecordKey,
  outcomeRecordKey,
  makeCurrentSignal,
  PlannedTaskAttemptPlanner,
  RunFinalityDecision,
  type RunActivationOpportunityValue,
  RunReactivationHint,
  RunReactivationOwner,
  TaskClaimAcquisitionPlanner,
  type AcceptedRunReactivationObservers
} from "@dalph/orchestrator"
import { RunId } from "@dalph/contracts"
import { Context, Deferred, Duration, Effect, FileSystem, Layer, Path, Queue, Ref, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { productionRunReactivationLayer, ProductionRunReactivationInterval } from "./production.js"
import { completedRunFinalityFixture } from "../../../orchestrator/test/run-finality.js"

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

it.effect("rejects a non-positive production reactivation interval at configuration decoding", () =>
  Effect.gen(function* () {
    const failure = yield* Schema.decodeUnknownEffect(ProductionRunReactivationInterval)("0 seconds").pipe(Effect.flip)
    expect(String(failure)).toContain("reactivation intervals must be finite and greater than zero")
  })
)

type TerminalOwnerBoundaryCalls = {
  readonly activation: number
  readonly executor: number
  readonly git: number
  readonly provider: number
  readonly tracker: number
}

const seedRetiredTerminal = Effect.fn("ProductionReactivationTest.seedRetiredTerminal")(function* (
  journal: JournalStore["Service"],
  runId: RunId,
  target: ReturnType<typeof FixtureTarget.make>
) {
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity }))
  const fixture = completedRunFinalityFixture({ runId, target })
  yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
  yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
  yield* journal.terminateRun(runId, "Completed", fixture.evidence)
  yield* journal.retireTerminalRun(runId)
})

const makeTerminalBootstrap = (
  journal: JournalStore["Service"],
  calls: Ref.Ref<TerminalOwnerBoundaryCalls>,
  journalReads: Ref.Ref<number>
) =>
  JournaledRunBootstrap.of({
    activate: () =>
      Ref.update(calls, (current) => ({
        ...current,
        activation: current.activation + 1,
        executor: current.executor + 1,
        git: current.git + 1,
        provider: current.provider + 1,
        tracker: current.tracker + 1
      })).pipe(Effect.andThen(Effect.die("terminal Run must never activate"))),
    readRunReactivationControl: (_target, requestedRunId) =>
      Ref.update(journalReads, (current) => current + 1).pipe(
        Effect.andThen(journal.read(requestedRunId)),
        Effect.map((records) =>
          records.at(-1)?.event._tag === "WorkflowRunTerminated" ? "RunTerminated" : "RunUnpaused"
        )
      ),
    registerAcceptedRunReactivationObservers: (_observers) => Effect.void,
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

const runTerminalProductionOwner = Effect.fn("ProductionReactivationTest.runTerminalOwner")(function* (
  journal: JournalStore["Service"],
  runId: RunId,
  target: ReturnType<typeof FixtureTarget.make>
) {
  const calls = yield* Ref.make<TerminalOwnerBoundaryCalls>({
    activation: 0,
    executor: 0,
    git: 0,
    provider: 0,
    tracker: 0
  })
  const journalReads = yield* Ref.make(0)
  const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
  const bootstrap = makeTerminalBootstrap(journal, calls, journalReads)
  const applicationExit = ApplicationExitShell.of({
    admission: {
      prepareForwardOwner: () => Effect.succeed({ cancel: Effect.void, register: Effect.die("unused") }),
      acquireForwardOwner: () => Effect.die("unused"),
      snapshot: Effect.succeed({ cutoffClosed: false, preparingOwnerCount: 0, registeredOwnerCount: 0 })
    },
    awaitExitRequested: Effect.never,
    awaitExecutorDrains: Effect.void,
    registerExecutorDrain: () => Effect.void,
    registerProcessLocalDrain: () => Effect.void,
    requestBoundary: { requestExit: Effect.never }
  })
  const productionLayer = productionRunReactivationLayer(
    target,
    Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })),
    runId,
    {
      activationInterval: ProductionRunReactivationInterval.make(Duration.seconds(1)),
      failureCooldown: ProductionRunReactivationInterval.make(Duration.seconds(1)),
      onFailure: () => Effect.die("terminal history must not report a reactivation failure"),
      onTimerStateChange: (state) => Ref.update(timerStates, (current) => [...current, state])
    }
  ).pipe(
    Layer.provide(Layer.succeed(JournaledRunBootstrap, bootstrap)),
    Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)),
    Layer.provide(Layer.mock(PlannedTaskAttemptPlanner, {})),
    Layer.provide(Layer.mock(TaskClaimAcquisitionPlanner, {}))
  )
  yield* Effect.scoped(
    Effect.gen(function* () {
      const owner = yield* RunReactivationOwner
      yield* owner.hint(RunReactivationHint.Timer())
      yield* TestClock.adjust("1 hour")
    }).pipe(Effect.provide(productionLayer))
  )
  // This raw store assertion covers the lower-level RunId reuse guard; ordinary
  // establishment is covered by the JournaledRunBootstrap cold-history tests.
  const runIdReuse = yield* journal
    .beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity }))
    .pipe(Effect.flip)
  return {
    calls: yield* Ref.get(calls),
    journalReads: yield* Ref.get(journalReads),
    runIdReuse,
    timerStates: yield* Ref.get(timerStates)
  }
})

it.effect("keeps a cold terminal memory Run closed in production-shaped reactivation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(memoryJournalTestLayer)
      const journal = Context.get(context, JournalStore)
      const runId = RunId.make("production-cold-memory-run")
      const target = FixtureTarget.make("production-cold-memory-target")
      yield* seedRetiredTerminal(journal, runId, target)

      const result = yield* runTerminalProductionOwner(journal, runId, target)

      expect(result.runIdReuse).toBeInstanceOf(WorkflowRunAlreadyBegan)
      expect(result.journalReads).toBe(1)
      expect(result.timerStates).toEqual([])
      expect(result.calls).toEqual({ activation: 0, executor: 0, git: 0, provider: 0, tracker: 0 })
    })
  )
)

it.effect("keeps a reopened SQLite cold terminal Run closed in production-shaped reactivation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-cold-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const runId = RunId.make("production-cold-sqlite-run")
      const target = FixtureTarget.make("production-cold-sqlite-target")
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* seedRetiredTerminal(yield* JournalStore, runId, target)
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      )
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(sqliteJournalTestLayer({ filename }))
          return yield* runTerminalProductionOwner(Context.get(context, JournalStore), runId, target)
        })
      )
      expect(result.runIdReuse).toBeInstanceOf(WorkflowRunAlreadyBegan)
      expect(result.journalReads).toBe(1)
      expect(result.timerStates).toEqual([])
      expect(result.calls).toEqual({ activation: 0, executor: 0, git: 0, provider: 0, tracker: 0 })
    }).pipe(Effect.provide(nodePathAndFileSystemLayer))
  )
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
      const opportunities = yield* Ref.make<ReadonlyArray<RunActivationOpportunityValue>>([])
      const bootstrap = JournaledRunBootstrap.of({
        activate: (_target, _policy, _runId, _program, opportunity) =>
          Ref.update(opportunities, (current) =>
            opportunity === undefined ? current : [...current, opportunity]
          ).pipe(
            Effect.andThen(Ref.update(bootstrapTrace, (current) => [...current, "bootstrap-activate" as const])),
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
        expect(yield* Ref.get(opportunities)).toEqual([
          { _tag: "OrdinaryRunEntry" },
          { _tag: "ActiveWorkAuthorityRefresh", source: "TrackerNotification" },
          { _tag: "ActiveWorkAuthorityRefresh", source: "Timer" },
          { _tag: "OrdinaryRunEntry" }
        ])
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
