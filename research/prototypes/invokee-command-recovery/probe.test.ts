import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { PlannedAttemptExecutorLifecycleObservation, RunId } from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Queue, Ref } from "effect"
import { expect } from "vitest"
import { CoordinatorOwnership } from "../../../packages/orchestrator/src/authorities/coordinator-ownership/ownership.js"
import { FixtureTarget } from "../../../packages/orchestrator/src/authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../packages/orchestrator/src/coordination/admission/capacity.js"
import {
  ApplicationExitShell,
  makeApplicationExitShell
} from "../../../packages/orchestrator/src/coordination/application-exit/application-shell.js"
import { RunFinalityDecision } from "../../../packages/orchestrator/src/coordination/frontier/frontier.js"
import { journaledRunBootstrapLayer } from "../../../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.js"
import {
  RunReactivationHint,
  RunReactivationOwner,
  runReactivationOwnerLayer
} from "../../../packages/orchestrator/src/coordination/run/run-reactivation-owner.js"
import { JournaledRunBootstrap } from "../../../packages/orchestrator/src/coordination/run/run.js"
import { InitialControlPolicy } from "../../../packages/orchestrator/src/control/policy.js"
import { sqliteJournalTestLayer } from "../../../packages/orchestrator/src/workflow-journal/adapters/sqlite-store.js"
import { JournalDatabaseLocator } from "../../../packages/orchestrator/src/workflow-journal/identity.js"
import { noopJournalMaintenanceObservation } from "../../../packages/orchestrator/src/workflow-journal/maintenance.js"
import {
  journalStoreCapabilities,
  JournalStore,
  RunLifecycleJournal
} from "../../../packages/orchestrator/src/workflow-journal/store.js"

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })

const withDatabase = <A, E, R>(
  name: string,
  use: (filename: JournalDatabaseLocator) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-recovery-${name}-` })
      return yield* use(JournalDatabaseLocator.make(`${directory}/journal.sqlite`))
    })
  ).pipe(Effect.provide(NodeServices.layer))

const makeGate = Effect.fn("InvokeeRecovery.makeGate")(function* () {
  const armed = yield* Ref.make(false)
  const entered = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const hook = Ref.get(armed).pipe(
    Effect.flatMap((mustGate) =>
      mustGate
        ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        : Effect.void
    )
  )
  return { armed, entered, hook, release }
})

const openBootstrap = Effect.fn("InvokeeRecovery.openBootstrap")(function* (
  filename: JournalDatabaseLocator,
  runId: RunId,
  initialize: boolean,
  onAppendInserted?: () => Effect.Effect<void>
) {
  const target = FixtureTarget.make(`recovery-${runId}`)
  const storeContext = yield* Layer.build(sqliteJournalTestLayer({ filename, onAppendInserted }))
  const store = Context.get(storeContext, JournalStore)
  if (initialize) yield* store.beginRun(runId, target, initialPolicy)
  const journalCapabilities = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, store)))
  const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
  const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
  const dependencies = Layer.mergeAll(
    Layer.succeed(JournalStore, store),
    Layer.succeed(RunLifecycleJournal, Context.get(journalCapabilities, RunLifecycleJournal)),
    Layer.succeed(CoordinatorOwnership, ownership),
    Layer.succeed(
      PlannedAttemptExecutorLifecycleObservation,
      PlannedAttemptExecutorLifecycleObservation.of({
        attach: () => Effect.die("inactive recovery probe must not attach an executor")
      })
    )
  )
  const context = yield* Layer.build(
    journaledRunBootstrapLayer(
      runId,
      () => Layer.die("inactive recovery probe must not build a delivery runtime"),
      applicationExit,
      noopJournalMaintenanceObservation
    ).pipe(Layer.provide(dependencies))
  )
  return {
    applicationExit,
    bootstrap: Context.get(context, JournaledRunBootstrap),
    read: store.read(runId),
    runId,
    target
  }
})

const buildOwner = Effect.fn("InvokeeRecovery.buildOwner")(function* (
  harness: Effect.Success<ReturnType<typeof openBootstrap>>
) {
  const activations = yield* Ref.make(0)
  const activationObserved = yield* Deferred.make<void>()
  const activationEvents = yield* Queue.unbounded<number>()
  const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
  const controlObserverCalls = yield* Ref.make<ReadonlyArray<"Pause" | "Unpause">>([])
  const ownerContext = yield* Layer.build(
    runReactivationOwnerLayer({
      runId: harness.runId,
      activationInterval: "1 hour",
      failureCooldown: "1 second",
      readControl: harness.bootstrap.readRunReactivationControl(harness.target, harness.runId),
      installAcceptedRunReactivationObservers: (observers) =>
        harness.bootstrap.registerAcceptedRunReactivationObservers({
          control: (direction) =>
            Ref.update(controlObserverCalls, (current) => [...current, direction]).pipe(
              Effect.andThen(observers.control(direction))
            ),
          acceptedFactPublication: observers.acceptedFactPublication
        }),
      activate: () =>
        Ref.updateAndGet(activations, (current) => current + 1).pipe(
          Effect.tap((count) => Queue.offer(activationEvents, count)),
          Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })),
          Effect.tap(() => Deferred.succeed(activationObserved, undefined))
        ),
      activateActiveWorkAuthorityRefresh: () =>
        Effect.die("recovery probe does not advance the one-hour authority-refresh timer"),
      isTerminationFailure: () => false,
      onFailure: (failure) => Effect.die(failure),
      onTimerStateChange: (state) => Ref.update(timerStates, (current) => [...current, state])
    }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, harness.applicationExit)))
  )
  return {
    activationObserved,
    activationEvents,
    activations,
    controlObserverCalls,
    owner: Context.get(ownerContext, RunReactivationOwner),
    timerStates
  }
})

const controlRecords = (records: ReadonlyArray<{ readonly event: { readonly _tag: string } }>) =>
  records.filter(({ event }) => event._tag === "ControlDirectionApplied")

it.live("an ongoing paused owner misses durable Unpause but a fresh owner reconstructs it without retry", () =>
  withDatabase("fresh-owner", (filename) =>
    Effect.gen(function* () {
      const runId = RunId.make("recovery-fresh-owner")
      const ongoing = yield* Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* makeGate()
          const harness = yield* openBootstrap(filename, runId, true, () => gate.hook)
          const owner = yield* buildOwner(harness)
          yield* Deferred.await(owner.activationObserved)

          const paused = yield* harness.bootstrap.operatorControl.applyControlDirection({
            direction: "Pause",
            subject: { _tag: "Run", runId }
          })
          expect(paused.event).toMatchObject({ _tag: "ControlDirectionApplied", ordinal: 1 })
          yield* Ref.set(gate.armed, true)

          const request = yield* harness.bootstrap.operatorControl
            .applyControlDirection({ direction: "Unpause", subject: { _tag: "Run", runId } })
            .pipe(Effect.forkChild)
          yield* Effect.addFinalizer(() => Deferred.succeed(gate.release, undefined).pipe(Effect.asVoid))
          yield* Deferred.await(gate.entered)
          const interrupting = yield* Fiber.interrupt(request).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          const requestWasPending = request.pollUnsafe() === undefined
          yield* Deferred.succeed(gate.release, undefined)
          yield* Fiber.join(interrupting)
          const requestExit = request.pollUnsafe()

          expect(requestWasPending).toBe(true)
          expect(requestExit === undefined ? false : Exit.hasInterrupts(requestExit)).toBe(true)
          expect(yield* harness.bootstrap.readRunReactivationControl(harness.target, runId)).toBe("RunUnpaused")
          expect(controlRecords(yield* harness.read)).toHaveLength(2)
          expect(yield* Ref.get(owner.controlObserverCalls)).toEqual(["Pause"])

          yield* owner.owner.hint(RunReactivationHint.OperatorWake())
          yield* Effect.yieldNow
          expect(yield* Ref.get(owner.activations)).toBe(1)
          expect(yield* Ref.get(owner.timerStates)).toEqual(["Started", "Stopped"])
          return {
            activations: yield* Ref.get(owner.activations),
            controlObserverCalls: yield* Ref.get(owner.controlObserverCalls),
            durableControl: "RunUnpaused" as const,
            durableOrdinals: controlRecords(yield* harness.read).map(({ event }) =>
              "ordinal" in event ? event.ordinal : undefined
            ),
            timerStates: yield* Ref.get(owner.timerStates)
          }
        })
      )

      const reconstructed = yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* openBootstrap(filename, runId, false)
          const owner = yield* buildOwner(harness)
          yield* Deferred.await(owner.activationObserved)
          const records = controlRecords(yield* harness.read)
          expect(records).toHaveLength(2)
          expect(yield* Ref.get(owner.activations)).toBe(1)
          expect(yield* Ref.get(owner.controlObserverCalls)).toEqual([])
          expect(yield* Ref.get(owner.timerStates)).toEqual(["Started"])
          return {
            activations: yield* Ref.get(owner.activations),
            controlObserverCalls: yield* Ref.get(owner.controlObserverCalls),
            durableControlRecords: records.length,
            timerStates: yield* Ref.get(owner.timerStates)
          }
        })
      )
      const result = { ongoing, reconstructed }
      console.log(JSON.stringify(result))
      return result
    })
  )
)

it.live("a host-owned bootstrap command reaches the actual owner observer once after its waiter is interrupted", () =>
  withDatabase("host-owned", (filename) =>
    Effect.scoped(
      Effect.gen(function* () {
        const runId = RunId.make("recovery-host-owned")
        const gate = yield* makeGate()
        const harness = yield* openBootstrap(filename, runId, true, () => gate.hook)
        const owner = yield* buildOwner(harness)
        yield* Deferred.await(owner.activationObserved)
        expect(yield* Queue.take(owner.activationEvents)).toBe(1)
        const paused = yield* harness.bootstrap.operatorControl.applyControlDirection({
          direction: "Pause",
          subject: { _tag: "Run", runId }
        })
        expect(paused.event).toMatchObject({ _tag: "ControlDirectionApplied", ordinal: 1 })
        expect(yield* Ref.get(owner.controlObserverCalls)).toEqual(["Pause"])
        expect(yield* Ref.get(owner.timerStates)).toEqual(["Started", "Stopped"])
        yield* Ref.set(gate.armed, true)
        const hostScope = yield* Effect.scope
        const command = yield* Effect.forkIn(
          harness.bootstrap.operatorControl.applyControlDirection({
            direction: "Unpause",
            subject: { _tag: "Run", runId }
          }),
          hostScope
        )
        const request = yield* Fiber.join(command).pipe(Effect.forkChild)
        yield* Effect.addFinalizer(() => Deferred.succeed(gate.release, undefined).pipe(Effect.asVoid))
        yield* Deferred.await(gate.entered)
        yield* Fiber.interrupt(request)
        const requestExit = request.pollUnsafe()
        const commandWasPending = command.pollUnsafe() === undefined
        yield* Deferred.succeed(gate.release, undefined)
        const applied = yield* Fiber.join(command)
        expect(yield* Queue.take(owner.activationEvents)).toBe(2)

        expect(requestExit === undefined ? false : Exit.hasInterrupts(requestExit)).toBe(true)
        expect(commandWasPending).toBe(true)
        expect(applied.event).toMatchObject({ _tag: "ControlDirectionApplied", ordinal: 2 })
        expect(controlRecords(yield* harness.read)).toHaveLength(2)
        expect(yield* Ref.get(owner.controlObserverCalls)).toEqual(["Pause", "Unpause"])
        expect(yield* Ref.get(owner.activations)).toBe(2)
        expect(yield* Ref.get(owner.timerStates)).toEqual(["Started", "Stopped", "Started"])
        const result = {
          activations: yield* Ref.get(owner.activations),
          commandOrdinal: applied.event._tag === "ControlDirectionApplied" ? applied.event.ordinal : undefined,
          controlObserverCalls: yield* Ref.get(owner.controlObserverCalls),
          durableControlRecords: controlRecords(yield* harness.read).length,
          requestInterrupted: true,
          timerStates: yield* Ref.get(owner.timerStates)
        }
        console.log(JSON.stringify(result))
        return result
      })
    )
  )
)
