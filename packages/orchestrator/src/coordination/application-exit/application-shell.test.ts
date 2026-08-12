import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Ref, Scope } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  ApplicationExitDiagnostic,
  ApplicationExitResult,
  type ApplicationExitResult as ApplicationExitResultType,
  type ApplicationProcessEndDecision
} from "./lifecycle-decision.js"
import { makeApplicationExitLifecycle } from "./lifecycle.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import {
  ApplicationExitDrainFailure,
  ApplicationExitRequestBoundary,
  type ApplicationExitIdleDrain,
  type ApplicationExitTraceEvent,
  makeApplicationExitRequestBoundary,
  makeApplicationExitShell
} from "./application-shell.js"

const successfulDrain = (
  record: (event: string) => Effect.Effect<void>,
  closeProcessLocalResources: Effect.Effect<void, ApplicationExitDrainFailure> = record("local-resources-closed")
): ApplicationExitIdleDrain => ({
  closeProcessLocalResources,
  flushProducedJournalWrites: record("produced-writes-flushed"),
  releaseCoordinatorLock: record("coordinator-lock-released")
})

/** Maintained application-lifecycle cassette; these entries are deliberately outside every Run story. */
const idleApplicationExitAuthoredCassette: ReadonlyArray<ApplicationExitTraceEvent> = [
  { _tag: "ExitRequested" },
  { _tag: "AdmissionCutoffClosed" },
  { _tag: "ProducedJournalWritesFlushed" },
  { _tag: "ProcessLocalResourcesClosed" },
  { _tag: "CoordinatorLockReleased" },
  { _tag: "ExitResultReported", result: ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }) },
  { _tag: "ProcessEndRequested", decision: { _tag: "RequestGracefulTermination", status: 0 } }
]

type ApplicationExitDeathStoryItem =
  | { readonly _tag: "ApplicationExitRequested" }
  | { readonly _tag: "ApplicationProcessDies" }

/** Maintained crash cassette: the process dies after cutoff and before the shared result. */
const deathBeforeApplicationExitResultAuthoredCassette: ReadonlyArray<ApplicationExitDeathStoryItem> = [
  { _tag: "ApplicationExitRequested" },
  { _tag: "ApplicationProcessDies" }
]

it.effect("exits successfully within five seconds after flushing writes and releasing local ownership", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const chronology = yield* Ref.make<Array<string>>([])
      const lifecycleCassette = yield* Ref.make<Array<ApplicationExitTraceEvent>>([])
      const requestedProcessEnds = yield* Ref.make<Array<ApplicationProcessEndDecision>>([])
      const runJournal = yield* Ref.make<ReadonlyArray<string>>(["WorkflowRunBegan"])
      const record = (event: string) => Ref.update(chronology, (events) => [...events, event])
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        successfulDrain(record),
        { requestEnd: (decision) => Ref.update(requestedProcessEnds, (decisions) => [...decisions, decision]) },
        { emit: (event) => Ref.update(lifecycleCassette, (events) => [...events, event]) }
      )

      const result = yield* boundary.requestExit

      expect(result).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
      expect(yield* Ref.get(chronology)).toEqual([
        "produced-writes-flushed",
        "local-resources-closed",
        "coordinator-lock-released"
      ])
      expect(yield* Ref.get(requestedProcessEnds)).toEqual([{ _tag: "RequestGracefulTermination", status: 0 }])
      expect(yield* Ref.get(lifecycleCassette)).toEqual(idleApplicationExitAuthoredCassette)
      // Application lifecycle recording is deliberately projected outside the Run journal.
      expect(yield* Ref.get(runJournal)).toEqual(["WorkflowRunBegan"])
    })
  )
)

it.effect("closes admission before success and waits for a pre-cutoff owner before releasing the lock", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const owner = yield* (yield* lifecycle.admission.prepareForwardOwner("AtomicBoundary")).register
      const chronology = yield* Ref.make<Array<string>>([])
      const writesFlushed = yield* Deferred.make<void>()
      const record = (event: string) =>
        Ref.update(chronology, (events) => [...events, event]).pipe(
          Effect.andThen(event === "produced-writes-flushed" ? Deferred.succeed(writesFlushed, undefined) : Effect.void)
        )
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        successfulDrain(
          record,
          lifecycle.awaitForwardOwnersReleased.pipe(Effect.andThen(record("local-resources-closed")))
        ),
        { requestEnd: () => Effect.void }
      )
      const exiting = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(writesFlushed)

      expect(yield* lifecycle.admission.snapshot).toMatchObject({ cutoffClosed: true, registeredOwnerCount: 1 })
      expect((yield* lifecycle.admission.prepareForwardOwner("AtomicBoundary").pipe(Effect.flip))._tag).toBe(
        "ApplicationExiting"
      )
      expect(yield* Ref.get(chronology)).toEqual(["produced-writes-flushed"])

      yield* owner.release
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
      expect(yield* Ref.get(chronology)).toEqual([
        "produced-writes-flushed",
        "local-resources-closed",
        "coordinator-lock-released"
      ])
    })
  )
)

it.effect("coalesces repeated Exit requests without resetting the fixed five-second deadline", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const processEnds = yield* Ref.make<Array<ApplicationProcessEndDecision>>([])
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        {
          closeProcessLocalResources: Effect.void,
          flushProducedJournalWrites: Effect.never,
          releaseCoordinatorLock: Effect.void
        },
        { requestEnd: (decision) => Ref.update(processEnds, (decisions) => [...decisions, decision]) }
      )
      const first = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("4 seconds")
      const repeated = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("1 second")

      const firstResult = yield* Fiber.join(first)
      const repeatedResult = yield* Fiber.join(repeated)
      expect(firstResult).toEqual(repeatedResult)
      expect(firstResult).toEqual(ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 }))
      expect(yield* Ref.get(processEnds)).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])
    })
  )
)

it.effect("reports a flush failure only after releasing idle process resources and the coordinator lock", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const chronology = yield* Ref.make<Array<string>>([])
      const processEnds = yield* Ref.make<Array<ApplicationProcessEndDecision>>([])
      const diagnostic = ApplicationExitDiagnostic.make("already-produced journal write was not acknowledged")
      const record = (event: string) => Ref.update(chronology, (events) => [...events, event])
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        {
          closeProcessLocalResources: record("local-resources-closed"),
          flushProducedJournalWrites: Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] })),
          releaseCoordinatorLock: record("coordinator-lock-released")
        },
        { requestEnd: (decision) => Ref.update(processEnds, (decisions) => [...decisions, decision]) }
      )

      expect(yield* boundary.requestExit).toEqual(
        ApplicationExitResult.cases.Failed.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
      expect(yield* Ref.get(chronology)).toEqual(["local-resources-closed", "coordinator-lock-released"])
      expect(yield* Ref.get(processEnds)).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])
    })
  )
)

it.effect("continues every application-owned local drain after one sibling reports failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const chronology = yield* Ref.make<Array<string>>([])
      const diagnostic = ApplicationExitDiagnostic.make("first local drain failed")
      const record = (event: string) => Ref.update(chronology, (events) => [...events, event])
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: record("coordinator-lock-released"), runMutation: (mutation) => mutation }),
        { requestEnd: () => record("process-end-requested") }
      )
      yield* shell.registerProcessLocalDrain({
        closeProcessLocalResources: record("first-local-drain").pipe(
          Effect.andThen(Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] })))
        )
      })
      yield* shell.registerProcessLocalDrain({ closeProcessLocalResources: record("second-local-drain") })

      const result = yield* ApplicationExitRequestBoundary.pipe(
        Effect.flatMap((boundary) => boundary.requestExit),
        Effect.provideService(ApplicationExitRequestBoundary, shell.requestBoundary)
      )
      expect(result).toEqual(ApplicationExitResult.cases.Failed.make({ diagnostics: [diagnostic], requestedStatus: 1 }))
      expect(yield* Ref.get(chronology)).toEqual([
        "first-local-drain",
        "second-local-drain",
        "coordinator-lock-released",
        "process-end-requested"
      ])
    })
  )
)

it.effect("reports timeout with an earlier produced-write diagnostic at the original fifth second", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const diagnostic = ApplicationExitDiagnostic.make("already-produced journal write failed before local close")
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        {
          closeProcessLocalResources: Effect.never,
          flushProducedJournalWrites: Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] })),
          releaseCoordinatorLock: Effect.void
        },
        { requestEnd: () => Effect.void }
      )
      const exiting = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
    })
  )
)

it.effect("an authored process-death cut before the Exit result persists no cutoff or successful result", () =>
  Effect.gen(function* () {
    const applicationScope = yield* Scope.make()
    const lifecycle = yield* makeApplicationExitLifecycle()
    const boundary = yield* makeApplicationExitRequestBoundary(
      lifecycle,
      {
        closeProcessLocalResources: Effect.void,
        flushProducedJournalWrites: Effect.never,
        releaseCoordinatorLock: Effect.void
      },
      { requestEnd: () => Effect.void }
    ).pipe(Scope.provide(applicationScope))
    let request: Fiber.Fiber<ApplicationExitResultType> | undefined
    for (const item of deathBeforeApplicationExitResultAuthoredCassette) {
      if (item._tag === "ApplicationExitRequested") {
        request = yield* boundary.requestExit.pipe(Effect.forkChild)
        yield* Effect.yieldNow
      } else {
        yield* Scope.close(applicationScope, Exit.void)
      }
    }
    const sharedRequest = yield* lifecycle.requestExit

    expect(yield* Deferred.isDone(sharedRequest.result)).toBe(false)
    if (request !== undefined) yield* Fiber.interrupt(request)

    const restarted = yield* makeApplicationExitLifecycle()
    expect(yield* restarted.admission.snapshot).toEqual({
      cutoffClosed: false,
      preparingOwnerCount: 0,
      registeredOwnerCount: 0
    })
  })
)
