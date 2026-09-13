import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { PlannedAttemptExecutorLifecycleObservation, RunId } from "@dalph/contracts"
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Ref, Scope } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../packages/orchestrator/src/authorities/task-tracker/fixture/target.js"
import { CoordinatorOwnership } from "../../../packages/orchestrator/src/authorities/coordinator-ownership/ownership.js"
import { TaskWorkCapacity } from "../../../packages/orchestrator/src/coordination/admission/capacity.js"
import { journalLayer } from "../../../packages/orchestrator/src/coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../packages/orchestrator/src/coordination/reconstruction/history.js"
import {
  journaledRunBootstrapLayer
} from "../../../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.js"
import { JournaledRunBootstrap } from "../../../packages/orchestrator/src/coordination/run/run.js"
import {
  makeApplicationExitShell
} from "../../../packages/orchestrator/src/coordination/application-exit/application-shell.js"
import {
  InitialControlPolicy,
  initialRunPolicyRevision
} from "../../../packages/orchestrator/src/control/policy.js"
import {
  TaskWorkCapacityControl,
  taskWorkCapacityControlLayer
} from "../../../packages/orchestrator/src/control/task-work-capacity.js"
import {
  sqliteJournalTestLayer
} from "../../../packages/orchestrator/src/workflow-journal/adapters/sqlite-store.js"
import { JournalDatabaseLocator } from "../../../packages/orchestrator/src/workflow-journal/identity.js"
import {
  journalStoreCapabilities,
  type JournalRecord,
  JournalStore,
  RunLifecycleJournal
} from "../../../packages/orchestrator/src/workflow-journal/store.js"
import {
  noopJournalMaintenanceObservation
} from "../../../packages/orchestrator/src/workflow-journal/maintenance.js"
import {
  ControlDirectionApplication,
  controlDirectionApplicationLayer
} from "../../../packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.js"

type CommandKind = "Capacity" | "Unpause"
type CommandOutcome =
  | { readonly _tag: "CapacityApplied"; readonly revision: number }
  | { readonly _tag: "CapacityConflict"; readonly currentRevision: number }
  | { readonly _tag: "ControlApplied"; readonly ordinal: number }
  | { readonly _tag: "UnexpectedFailure"; readonly failureTag: string }

type Harness = {
  readonly apply: (kind: CommandKind) => Effect.Effect<CommandOutcome>
  readonly read: Effect.Effect<ReadonlyArray<JournalRecord>>
  readonly runId: RunId
}

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })

const commandRecordCount = (records: ReadonlyArray<{ readonly event: { readonly _tag: string } }>, kind: CommandKind) =>
  records.filter(({ event }) =>
    kind === "Capacity" ? event._tag === "TaskWorkCapacityChanged" : event._tag === "ControlDirectionApplied"
  ).length

const openHarness = Effect.fn("InvokeeInterruption.openHarness")(function* (
  filename: JournalDatabaseLocator,
  runId: RunId,
  initialize: boolean,
  hooks: {
    readonly afterAppendCommit?: () => Effect.Effect<void, string>
    readonly onAppendInserted?: (runId: RunId) => Effect.Effect<void>
  } = {}
) {
  const target = FixtureTarget.make(`interruption-${runId}`)
  const storeContext = yield* Layer.build(sqliteJournalTestLayer({ filename, ...hooks }))
  const store = Context.get(storeContext, JournalStore)
  if (initialize) yield* store.beginRun(runId, target, initialPolicy)
  const records = yield* store.read(runId)
  const initial = reduceWorkflowJournalHistory(runId, records)
  if (initial._tag !== "ValidWorkflowJournalHistory") {
    return yield* Effect.die(`invalid interruption fixture: ${JSON.stringify(initial.issues)}`)
  }
  const live = journalLayer(runId, target, initial, store)
  const services = yield* Layer.build(
    Layer.merge(taskWorkCapacityControlLayer, controlDirectionApplicationLayer).pipe(Layer.provideMerge(live))
  )
  const capacity = Context.get(services, TaskWorkCapacityControl)
  const control = Context.get(services, ControlDirectionApplication)
  const apply = (kind: CommandKind): Effect.Effect<CommandOutcome> =>
    kind === "Capacity"
      ? capacity
          .apply({
            capacity: TaskWorkCapacity.make(1),
            expectedRevision: initialRunPolicyRevision,
            runId
          })
          .pipe(
            Effect.match({
              onSuccess: (policy) => ({ _tag: "CapacityApplied" as const, revision: policy.revision }),
              onFailure: (failure) =>
                failure._tag === "TaskWorkCapacityPolicyRevisionConflict"
                  ? { _tag: "CapacityConflict" as const, currentRevision: failure.current.revision }
                  : { _tag: "UnexpectedFailure" as const, failureTag: failure._tag }
            })
          )
      : control.apply({ direction: "Unpause", subject: { _tag: "Run", runId } }).pipe(
          Effect.match({
            onSuccess: ({ event }) =>
              event._tag === "ControlDirectionApplied"
                ? { _tag: "ControlApplied" as const, ordinal: event.ordinal }
                : { _tag: "UnexpectedFailure" as const, failureTag: event._tag },
            onFailure: (failure) => ({
              _tag: "UnexpectedFailure" as const,
              failureTag: "_tag" in failure ? String(failure._tag) : String(failure)
            })
          })
        )
  return { apply, read: store.read(runId), runId } satisfies Harness
})

const openInactiveBootstrap = Effect.fn("InvokeeInterruption.openInactiveBootstrap")(function* (
  filename: JournalDatabaseLocator,
  runId: RunId,
  onAppendInserted: () => Effect.Effect<void>
) {
  const target = FixtureTarget.make(`bootstrap-${runId}`)
  const storeContext = yield* Layer.build(sqliteJournalTestLayer({ filename, onAppendInserted: () => onAppendInserted() }))
  const store = Context.get(storeContext, JournalStore)
  yield* store.beginRun(runId, target, initialPolicy)
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
        attach: () => Effect.die("inactive bootstrap interruption probe must not attach an executor")
      })
    )
  )
  const context = yield* Layer.build(
    journaledRunBootstrapLayer(
      runId,
      () => Layer.die("inactive bootstrap interruption probe must not build a runtime"),
      applicationExit,
      noopJournalMaintenanceObservation
    ).pipe(Layer.provide(dependencies))
  )
  return { bootstrap: Context.get(context, JournaledRunBootstrap), read: store.read(runId), runId }
})

const withDatabase = <A, E, R>(
  name: string,
  use: (filename: JournalDatabaseLocator) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-invokee-${name}-` })
      return yield* use(JournalDatabaseLocator.make(`${directory}/journal.sqlite`))
    })
  ).pipe(Effect.provide(NodeServices.layer))

const gatedHook = Effect.fn("InvokeeInterruption.gatedHook")(function* () {
  const entered = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const first = yield* Ref.make(true)
  const hook = Ref.getAndSet(first, false).pipe(
    Effect.flatMap((mustGate) =>
      mustGate
        ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
        : Effect.void
    )
  )
  return { entered, hook, release }
})

const interruptedBeforeService = (kind: CommandKind) =>
  withDatabase(`before-${kind.toLowerCase()}`, (filename) =>
    Effect.scoped(
      Effect.gen(function* () {
        const runId = RunId.make(`before-${kind.toLowerCase()}`)
        const harness = yield* openHarness(filename, runId, true)
        const requestReached = yield* Deferred.make<void>()
        const invoke = yield* Deferred.make<void>()
        const request = yield* Deferred.succeed(requestReached, undefined).pipe(
          Effect.andThen(Deferred.await(invoke)),
          Effect.andThen(harness.apply(kind)),
          Effect.forkChild
        )
        yield* Deferred.await(requestReached)
        yield* Fiber.interrupt(request)
        expect(commandRecordCount(yield* harness.read, kind)).toBe(0)
        const retry = yield* harness.apply(kind)
        expect(retry._tag).toBe(kind === "Capacity" ? "CapacityApplied" : "ControlApplied")
        expect(commandRecordCount(yield* harness.read, kind)).toBe(1)
        return { kind, retry: retry._tag }
      })
    )
  )

const interruptedAfterInsertBeforeCommit = (kind: CommandKind) =>
  withDatabase(`inside-${kind.toLowerCase()}`, (filename) =>
    Effect.scoped(
      Effect.gen(function* () {
        const runId = RunId.make(`inside-${kind.toLowerCase()}`)
        const gate = yield* gatedHook()
        const harness = yield* openHarness(filename, runId, true, { onAppendInserted: () => gate.hook })
        const request = yield* harness.apply(kind).pipe(Effect.forkChild)
        yield* Effect.addFinalizer(() => Deferred.succeed(gate.release, undefined).pipe(Effect.asVoid))
        yield* Deferred.await(gate.entered)
        const interrupting = yield* Fiber.interrupt(request).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        const requestWasPending = request.pollUnsafe() === undefined
        const interruptionWasPending = interrupting.pollUnsafe() === undefined
        yield* Deferred.succeed(gate.release, undefined)
        yield* Fiber.join(interrupting)
        const requestExit = request.pollUnsafe()
        expect(requestWasPending).toBe(true)
        expect(interruptionWasPending).toBe(true)
        expect(requestExit === undefined ? false : Exit.hasInterrupts(requestExit)).toBe(true)
        expect(commandRecordCount(yield* harness.read, kind)).toBe(1)
        const retry = yield* harness.apply(kind)
        expect(retry._tag).toBe(kind === "Capacity" ? "CapacityConflict" : "ControlApplied")
        expect(commandRecordCount(yield* harness.read, kind)).toBe(kind === "Capacity" ? 1 : 2)
        return {
          kind,
          retry: retry._tag,
          rowsAfterInterruption: 1,
          interruptionDeferredUntilAppendFinished: true
        }
      })
    )
  )

const interruptedAfterCommitBeforeAcknowledgement = (kind: CommandKind) =>
  withDatabase(`committed-${kind.toLowerCase()}`, (filename) =>
    Effect.gen(function* () {
      const runId = RunId.make(`committed-${kind.toLowerCase()}`)
      const sameRuntime = yield* Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* gatedHook()
          const harness = yield* openHarness(filename, runId, true, {
            afterAppendCommit: () => gate.hook
          })
          const request = yield* harness.apply(kind).pipe(Effect.forkChild)
          yield* Effect.addFinalizer(() => Deferred.succeed(gate.release, undefined).pipe(Effect.asVoid))
          yield* Deferred.await(gate.entered)
          const interrupting = yield* Fiber.interrupt(request).pipe(Effect.forkChild)
          yield* Effect.yieldNow
          const requestWasPending = request.pollUnsafe() === undefined
          const interruptionWasPending = interrupting.pollUnsafe() === undefined
          yield* Deferred.succeed(gate.release, undefined)
          yield* Fiber.join(interrupting)
          const requestExit = request.pollUnsafe()
          expect(requestWasPending).toBe(true)
          expect(interruptionWasPending).toBe(true)
          expect(requestExit === undefined ? false : Exit.hasInterrupts(requestExit)).toBe(true)
          expect(commandRecordCount(yield* harness.read, kind)).toBe(1)
          return { acceptedRows: 1, interruptionDeferredUntilPublicationFinished: true }
        })
      )
      const freshRuntime = yield* Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* openHarness(filename, runId, false)
          const retry = yield* harness.apply(kind)
          const records = yield* harness.read
          return { retry, records: commandRecordCount(records, kind) }
        })
      )
      expect(freshRuntime.retry._tag).toBe(kind === "Capacity" ? "CapacityConflict" : "ControlApplied")
      expect(freshRuntime.records).toBe(kind === "Capacity" ? 1 : 2)
      return {
        kind,
        sameRuntime,
        freshRuntimeRetry: freshRuntime.retry._tag,
        freshRuntimeRows: freshRuntime.records
      }
    })
  )

const interruptedAfterServiceBeforeResponse = (kind: CommandKind) =>
  withDatabase(`response-${kind.toLowerCase()}`, (filename) =>
    Effect.scoped(
      Effect.gen(function* () {
        const runId = RunId.make(`response-${kind.toLowerCase()}`)
        const harness = yield* openHarness(filename, runId, true)
        const serviceReturned = yield* Deferred.make<void>()
        const deliverResponse = yield* Deferred.make<void>()
        const request = yield* harness.apply(kind).pipe(
          Effect.tap(() => Deferred.succeed(serviceReturned, undefined)),
          Effect.andThen(Deferred.await(deliverResponse)),
          Effect.forkChild
        )
        yield* Deferred.await(serviceReturned)
        yield* Fiber.interrupt(request)
        expect(commandRecordCount(yield* harness.read, kind)).toBe(1)
        const retry = yield* harness.apply(kind)
        expect(retry._tag).toBe(kind === "Capacity" ? "CapacityConflict" : "ControlApplied")
        expect(commandRecordCount(yield* harness.read, kind)).toBe(kind === "Capacity" ? 1 : 2)
        return { kind, retry: retry._tag }
      })
    )
  )

const hostScopedCommandSurvivesRequest = (kind: CommandKind) =>
  withDatabase(`host-${kind.toLowerCase()}`, (filename) =>
    Effect.scoped(
      Effect.gen(function* () {
        const runId = RunId.make(`host-${kind.toLowerCase()}`)
        const gate = yield* gatedHook()
        const harness = yield* openHarness(filename, runId, true, { onAppendInserted: () => gate.hook })
        const hostScope = yield* Effect.scope
        const commandFiberReady = yield* Deferred.make<Fiber.Fiber<CommandOutcome>>()
        const request = yield* Effect.gen(function* () {
          const command = yield* Effect.forkIn(harness.apply(kind), hostScope)
          yield* Deferred.succeed(commandFiberReady, command)
          return yield* Fiber.join(command)
        }).pipe(Effect.forkChild)
        const command = yield* Deferred.await(commandFiberReady)
        yield* Effect.addFinalizer(() => Deferred.succeed(gate.release, undefined).pipe(Effect.asVoid))
        yield* Deferred.await(gate.entered)
        yield* Fiber.interrupt(request)
        const requestExit = request.pollUnsafe()
        const commandSurvivedRequest = command.pollUnsafe() === undefined
        yield* Deferred.succeed(gate.release, undefined)
        const outcome = yield* Fiber.join(command)
        expect(requestExit === undefined ? false : Exit.hasInterrupts(requestExit)).toBe(true)
        expect(commandSurvivedRequest).toBe(true)
        expect(outcome._tag).toBe(kind === "Capacity" ? "CapacityApplied" : "ControlApplied")
        expect(commandRecordCount(yield* harness.read, kind)).toBe(1)
        return { kind, outcome: outcome._tag, requestInterruptedBeforeCommandCompleted: true }
      })
    )
  )

const interruptionCanSkipBootstrapControlObserver = withDatabase("bootstrap-control-observer", (filename) =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = RunId.make("bootstrap-control-observer")
      const gate = yield* gatedHook()
      const harness = yield* openInactiveBootstrap(filename, runId, () => gate.hook)
      const callbackCount = yield* Ref.make(0)
      yield* harness.bootstrap.registerAcceptedRunReactivationObservers({
        control: () => Ref.update(callbackCount, (count) => count + 1),
        acceptedFactPublication: () => Effect.void
      })
      const apply = harness.bootstrap.operatorControl.applyControlDirection({
        direction: "Unpause",
        subject: { _tag: "Run", runId }
      })
      const request = yield* apply.pipe(Effect.forkChild)
      yield* Effect.addFinalizer(() => Deferred.succeed(gate.release, undefined).pipe(Effect.asVoid))
      yield* Deferred.await(gate.entered)
      const interrupting = yield* Fiber.interrupt(request).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(gate.release, undefined)
      yield* Fiber.join(interrupting)
      const requestExit = request.pollUnsafe()
      expect(requestExit === undefined ? false : Exit.hasInterrupts(requestExit)).toBe(true)
      expect(commandRecordCount(yield* harness.read, "Unpause")).toBe(1)
      expect(yield* Ref.get(callbackCount)).toBe(0)

      const retry = yield* apply
      expect(retry.event).toMatchObject({ _tag: "ControlDirectionApplied", ordinal: 2 })
      expect(yield* Ref.get(callbackCount)).toBe(1)
      expect(commandRecordCount(yield* harness.read, "Unpause")).toBe(2)
      return { callbackAfterInterruptedAppend: 0, callbackAfterExactRetry: 1, durableOrdinals: [1, 2] }
    })
  )
)

const both = <A, E, R>(run: (kind: CommandKind) => Effect.Effect<A, E, R>) =>
  Effect.all([run("Capacity"), run("Unpause")], { concurrency: 1 })

it.live("interrupts before service invocation and a fresh exact request applies once", () =>
  both(interruptedBeforeService).pipe(Effect.tap((result) => Effect.sync(() => console.log(JSON.stringify(result)))))
)

it.live("defers request interruption during the real INSERT until the atomic live-Journal append finishes", () =>
  both(interruptedAfterInsertBeforeCommit).pipe(
    Effect.tap((result) => Effect.sync(() => console.log(JSON.stringify(result))))
  )
)

it.live("defers interruption after COMMIT until live-Journal publication and distinguishes a fresh runtime", () =>
  both(interruptedAfterCommitBeforeAcknowledgement).pipe(
    Effect.tap((result) => Effect.sync(() => console.log(JSON.stringify(result))))
  )
)

it.live("distinguishes response loss after the real service has accepted the record", () =>
  both(interruptedAfterServiceBeforeResponse).pipe(
    Effect.tap((result) => Effect.sync(() => console.log(JSON.stringify(result))))
  )
)

it.live("keeps a command running in the existing host scope after its request fiber is interrupted", () =>
  both(hostScopedCommandSurvivesRequest).pipe(
    Effect.tap((result) => Effect.sync(() => console.log(JSON.stringify(result))))
  )
)

it.live("can skip the inactive bootstrap control observer after persisting Unpause and invokes it on exact retry", () =>
  interruptionCanSkipBootstrapControlObserver.pipe(
    Effect.tap((result) => Effect.sync(() => console.log(JSON.stringify(result))))
  )
)

it.effect("negative control: closing the owning scope before service invocation leaves no command record", () =>
  withDatabase("host-scope-negative", (filename) =>
    Effect.scoped(Effect.gen(function* () {
      const runId = RunId.make("host-scope-negative")
      const harness = yield* openHarness(filename, runId, true)
      const serviceInvocation = yield* Deferred.make<void>()
      const commandScope = yield* Scope.make()
      const command = yield* Effect.forkIn(
        Deferred.await(serviceInvocation).pipe(Effect.andThen(harness.apply("Capacity"))),
        commandScope
      )
      yield* Scope.close(commandScope, Exit.void)
      expect(command.pollUnsafe()).toBeDefined()
      expect(commandRecordCount(yield* harness.read, "Capacity")).toBe(0)
    }))
  ).pipe(Effect.provide(NodeServices.layer))
)
