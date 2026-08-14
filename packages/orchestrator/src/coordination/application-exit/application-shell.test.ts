import { it } from "@effect/vitest"
import { Deferred, Duration, Effect, Exit, Fiber, Ref, Scope } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  ApplicationExitDiagnostic,
  ApplicationExitResult,
  type ApplicationExitResult as ApplicationExitResultType,
  type ApplicationProcessEndDecision
} from "./lifecycle-decision.js"
import { makeApplicationExitLifecycle } from "./lifecycle.js"
import { applicationExitDrainDuration } from "../timing/control-plane-budgets.js"
import { OperationId } from "../../workflow/identity.js"
import { InterruptibleWorkflowBoundaryIntent } from "../../workflow/interpretation/interpreter.js"
import { CompletionClaimCleanupBoundaryCall } from "../../workflow/interpretation/interruptible-boundary.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  CompletionClaimRequestOrdinal,
  completionClaimDeletionRequestFor,
  completionClaimReplacementOperationIdFor
} from "../../workflow/protocols/integration-finality/events.js"
import { ActiveTaskClaim, TaskClaimRelease } from "../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskId } from "@dalph/contracts"
import { makeTaskClaimReleaseOperation, TaskClaimReleaseAuthority } from "../../workflow/registry/operation.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import {
  ApplicationExitDrainFailure,
  ApplicationExitRequestBoundary,
  type ApplicationExitDrain,
  type ApplicationExitTraceEvent,
  makeApplicationExitRequestBoundary,
  makeApplicationExitShell
} from "./application-shell.js"

const defaultOwnership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })

const atomicCleanupClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("application-exit-atomic-cleanup-acquisition"),
  owner: ClaimOwner.make("dalph"),
  taskId: TaskId.make("application-exit-atomic-cleanup-task"),
  token: ClaimToken.make("application-exit-atomic-cleanup-token")
})
const atomicTaskClaimCleanup = InterruptibleWorkflowBoundaryIntent.TaskClaimCleanup({
  family: "TaskTracker",
  operation: makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [atomicCleanupClaim.operationId],
    release: TaskClaimRelease.make({
      claim: atomicCleanupClaim,
      operationId: OperationId.make("application-exit-atomic-cleanup-release")
    })
  })
})
const atomicCompletionClaimCleanup = InterruptibleWorkflowBoundaryIntent.CompletionClaimCleanup({
  call: CompletionClaimCleanupBoundaryCall.DeleteAttempt({ attemptOrdinal: CompletionClaimRequestOrdinal.make(1) }),
  family: "TaskTracker",
  replacementOperationId: completionClaimReplacementOperationIdFor(integrationFinalityFixture.claim),
  request: completionClaimDeletionRequestFor(
    integrationFinalityFixture.claim,
    integrationFinalityFixture.successObservation
  )
})

const successfulDrain = (
  record: (event: string) => Effect.Effect<void>,
  closeProcessLocalResources: Effect.Effect<void, ApplicationExitDrainFailure> = record("local-resources-closed")
): ApplicationExitDrain => ({
  closeProcessLocalResources,
  flushProducedJournalWrites: record("produced-writes-flushed"),
  releaseCoordinatorLock: record("coordinator-lock-released"),
  suspendRunningExecutorWork: Effect.succeed([])
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

/** Maintained #209 cassette: one family fails while independent quick drains still reach their boundaries. */
const crossFamilyFailureApplicationExitAuthoredCassette = (
  diagnostic: ApplicationExitDiagnostic
): ReadonlyArray<ApplicationExitTraceEvent> => [
  { _tag: "ExitRequested" },
  { _tag: "AdmissionCutoffClosed" },
  { _tag: "ProcessLocalResourcesClosed" },
  { _tag: "ProducedJournalWritesFlushed" },
  { _tag: "CoordinatorLockReleased" },
  {
    _tag: "ExitResultReported",
    result: ApplicationExitResult.cases.Failed.make({ diagnostics: [diagnostic], requestedStatus: 1 })
  },
  { _tag: "ProcessEndRequested", decision: { _tag: "RequestForcedTermination", status: 1 } }
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

it.effect("can exit successfully with a recoverable ambiguous tracker outcome", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong owner kind")
      const intent = InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
        family: "TaskTracker",
        operationId: OperationId.make("application-shell-ambiguous-tracker")
      })
      const callStarted = yield* Deferred.make<void>()
      const releasedAt = yield* Ref.make<unknown>(undefined)
      yield* owner
        .run(intent, Deferred.succeed(callStarted, undefined).pipe(Effect.andThen(Effect.never)), () =>
          Effect.die("the interrupted tracker request produced no normalized result")
        )
        .pipe(
          Effect.ensuring(owner.snapshot.pipe(Effect.tap((snapshot) => Ref.set(releasedAt, snapshot)))),
          Effect.ensuring(owner.release),
          Effect.forkChild
        )
      yield* Deferred.await(callStarted)
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        successfulDrain(() => Effect.void, lifecycle.awaitForwardOwnersReleased),
        { requestEnd: () => Effect.void }
      )

      expect(yield* boundary.requestExit).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
      expect(yield* Ref.get(releasedAt)).toEqual({ _tag: "RecoverableAmbiguity", intent })
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
          releaseCoordinatorLock: Effect.void,
          suspendRunningExecutorWork: Effect.succeed([])
        },
        { requestEnd: (decision) => Ref.update(processEnds, (decisions) => [...decisions, decision]) }
      )
      const first = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("4 seconds")
      const repeated = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust(Duration.subtract(applicationExitDrainDuration, Duration.seconds(4)))

      const firstResult = yield* Fiber.join(first)
      const repeatedResult = yield* Fiber.join(repeated)
      expect(firstResult).toEqual(repeatedResult)
      expect(firstResult).toEqual(ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 }))
      expect(yield* Ref.get(processEnds)).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])
    })
  )
)

it.effect("forces process death when either cleanup family is stuck recording an already-produced result", () =>
  Effect.forEach([atomicTaskClaimCleanup, atomicCompletionClaimCleanup], (intent) =>
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const owner = yield* lifecycle.admission.acquireForwardOwner("InterruptibleBoundary")
      if (owner.kind !== "InterruptibleBoundary") return yield* Effect.die("wrong atomic cleanup owner kind")
      const atomicRecordingEntered = yield* Deferred.make<void>()
      const allowAtomicRecording = yield* Deferred.make<void>()
      const processEnds = yield* Ref.make<ReadonlyArray<ApplicationProcessEndDecision>>([])
      const cleanup = yield* owner
        .run(intent, Effect.succeed("already-produced"), (result) =>
          Deferred.succeed(atomicRecordingEntered, undefined).pipe(
            Effect.andThen(Deferred.await(allowAtomicRecording)),
            Effect.as(result)
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(atomicRecordingEntered)
      expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultProduced", intent })
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        successfulDrain(() => Effect.void, lifecycle.awaitForwardOwnersReleased),
        { requestEnd: (decision) => Ref.update(processEnds, (decisions) => [...decisions, decision]) }
      )
      const exiting = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })
      )
      expect(yield* Ref.get(processEnds)).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])
      expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultProduced", intent })
      yield* Deferred.succeed(allowAtomicRecording, undefined)
      expect((yield* Fiber.await(cleanup))._tag).toBe("Failure")
      expect(yield* owner.snapshot).toEqual({ _tag: "BoundaryResultRecorded", intent })
      yield* owner.release
    })
  )
)

it.effect("uses no fresh drain time when driver start is delayed beyond the original fifth second", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const cutoffObserved = yield* Deferred.make<void>()
      const allowDriver = yield* Deferred.make<void>()
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        {
          closeProcessLocalResources: Effect.void,
          flushProducedJournalWrites: Effect.never,
          releaseCoordinatorLock: Effect.void,
          suspendRunningExecutorWork: Effect.succeed([])
        },
        { requestEnd: () => Effect.void },
        {
          emit: (event) =>
            event._tag === "AdmissionCutoffClosed"
              ? Deferred.succeed(cutoffObserved, undefined).pipe(Effect.andThen(Deferred.await(allowDriver)))
              : Effect.void
        }
      )
      const exiting = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(cutoffObserved)
      yield* TestClock.adjust("5 seconds")
      yield* Deferred.succeed(allowDriver, undefined)

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })
      )
    })
  )
)

it.effect("forcefully terminates at five seconds while an atomic integration section remains active", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const owner = yield* lifecycle.admission.acquireForwardOwner("AtomicBoundary")
      if (owner.kind !== "AtomicBoundary") return yield* Effect.die("wrong owner kind")
      const entered = yield* Deferred.make<void>()
      const mayReturn = yield* Deferred.make<void>()
      const running = yield* owner
        .run(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(mayReturn))))
        .pipe(Effect.ensuring(owner.release), Effect.forkChild)
      yield* Deferred.await(entered)
      const processEnds = yield* Ref.make<Array<ApplicationProcessEndDecision>>([])
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        successfulDrain(() => Effect.void, lifecycle.awaitForwardOwnersReleased),
        { requestEnd: (decision) => Ref.update(processEnds, (decisions) => [...decisions, decision]) }
      )
      const exiting = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })
      )
      expect(yield* lifecycle.admission.snapshot).toMatchObject({ cutoffClosed: true, registeredOwnerCount: 1 })
      expect(yield* Ref.get(processEnds)).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])

      yield* Deferred.succeed(mayReturn, undefined)
      expect((yield* Fiber.await(running))._tag).toBe("Failure")
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
          releaseCoordinatorLock: record("coordinator-lock-released"),
          suspendRunningExecutorWork: Effect.succeed([])
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

it.effect("reports a direct executor-family drain failure and still performs every later quick drain", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const chronology = yield* Ref.make<ReadonlyArray<string>>([])
      const diagnostic = ApplicationExitDiagnostic.make("executor suspension contradicted the exact attempt")
      const record = (event: string) => Ref.update(chronology, (current) => [...current, event])
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        {
          closeProcessLocalResources: record("local-resources-closed"),
          flushProducedJournalWrites: record("produced-writes-flushed"),
          releaseCoordinatorLock: record("coordinator-lock-released"),
          suspendRunningExecutorWork: Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] }))
        },
        { requestEnd: () => Effect.void }
      )

      expect(yield* boundary.requestExit).toEqual(
        ApplicationExitResult.cases.Failed.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
      expect(yield* Ref.get(chronology)).toEqual([
        "produced-writes-flushed",
        "local-resources-closed",
        "coordinator-lock-released"
      ])
    })
  )
)

it.effect("retains every concurrent family diagnostic in stable application-drain order", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycle = yield* makeApplicationExitLifecycle()
      const executorDiagnostic = ApplicationExitDiagnostic.make("executor diagnostic")
      const writeDiagnostic = ApplicationExitDiagnostic.make("produced-write diagnostic")
      const localDiagnostic = ApplicationExitDiagnostic.make("process-local diagnostic")
      const lockDiagnostic = ApplicationExitDiagnostic.make("coordinator-lock diagnostic")
      const executorStarted = yield* Deferred.make<void>()
      const writeStarted = yield* Deferred.make<void>()
      const localStarted = yield* Deferred.make<void>()
      const finishExecutor = yield* Deferred.make<void>()
      const finishWrite = yield* Deferred.make<void>()
      const finishLocal = yield* Deferred.make<void>()
      const failAfter = (started: Deferred.Deferred<void>, finish: Deferred.Deferred<void>, diagnostic: string) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(finish)),
          Effect.andThen(
            Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [ApplicationExitDiagnostic.make(diagnostic)] }))
          )
        )
      const boundary = yield* makeApplicationExitRequestBoundary(
        lifecycle,
        {
          closeProcessLocalResources: failAfter(localStarted, finishLocal, localDiagnostic),
          flushProducedJournalWrites: failAfter(writeStarted, finishWrite, writeDiagnostic),
          releaseCoordinatorLock: Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [lockDiagnostic] })),
          suspendRunningExecutorWork: failAfter(executorStarted, finishExecutor, executorDiagnostic)
        },
        { requestEnd: () => Effect.void }
      )
      const exiting = yield* boundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(executorStarted)
      yield* Deferred.await(writeStarted)
      yield* Deferred.await(localStarted)

      yield* Deferred.succeed(finishLocal, undefined)
      yield* Deferred.succeed(finishWrite, undefined)
      yield* Deferred.succeed(finishExecutor, undefined)

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.Failed.make({
          diagnostics: [executorDiagnostic, writeDiagnostic, localDiagnostic, lockDiagnostic],
          requestedStatus: 1
        })
      )
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

it.effect("retains a settled local-drain failure when its sibling remains stuck at the fifth second", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const diagnostic = ApplicationExitDiagnostic.make("first local drain failed while its sibling remained useful")
      const failedDrainSettled = yield* Deferred.make<void>()
      const processEnds = yield* Ref.make<ReadonlyArray<ApplicationProcessEndDecision>>([])
      const shell = yield* makeApplicationExitShell(defaultOwnership, {
        requestEnd: (decision) => Ref.update(processEnds, (current) => [...current, decision])
      })
      yield* shell.registerProcessLocalDrain({
        closeProcessLocalResources: Deferred.succeed(failedDrainSettled, undefined).pipe(
          Effect.andThen(Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] })))
        )
      })
      yield* shell.registerProcessLocalDrain({ closeProcessLocalResources: Effect.never })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(failedDrainSettled)
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
      expect(yield* Ref.get(processEnds)).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])
    })
  )
)

it.effect("orders settled local-drain timeout diagnostics by registration rather than completion", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstDiagnostic = ApplicationExitDiagnostic.make("first registered local drain failed second")
      const secondDiagnostic = ApplicationExitDiagnostic.make("second registered local drain failed first")
      const failFirst = yield* Deferred.make<void>()
      const failSecond = yield* Deferred.make<void>()
      const firstSettled = yield* Deferred.make<void>()
      const secondSettled = yield* Deferred.make<void>()
      const shell = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const failWhenAllowed = (
        allowed: Deferred.Deferred<void>,
        settled: Deferred.Deferred<void>,
        diagnostic: ApplicationExitDiagnostic
      ) =>
        Deferred.await(allowed).pipe(
          Effect.andThen(Deferred.succeed(settled, undefined)),
          Effect.andThen(Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] })))
        )
      yield* shell.registerProcessLocalDrain({
        closeProcessLocalResources: failWhenAllowed(failFirst, firstSettled, firstDiagnostic)
      })
      yield* shell.registerProcessLocalDrain({
        closeProcessLocalResources: failWhenAllowed(failSecond, secondSettled, secondDiagnostic)
      })
      yield* shell.registerProcessLocalDrain({ closeProcessLocalResources: Effect.never })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.succeed(failSecond, undefined)
      yield* Deferred.await(secondSettled)
      yield* Deferred.succeed(failFirst, undefined)
      yield* Deferred.await(firstSettled)
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({
          diagnostics: [firstDiagnostic, secondDiagnostic],
          requestedStatus: 1
        })
      )
    })
  )
)

it.effect("reports a registered executor-family drain failure after its admitted Run owner releases", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const diagnostic = ApplicationExitDiagnostic.make("registered executor suspension failed")
      const shell = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const owner = yield* shell.admission.acquireForwardOwner("RunActivation")
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] }))
      })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* owner.release

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.Failed.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
    })
  )
)

it.effect("settles an interrupted executor drain with a typed diagnostic", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const shell = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.interrupt))
      })

      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(started)

      const result = yield* Fiber.join(exiting)
      expect(result._tag).toBe("Failed")
      if (result._tag === "Failed") {
        expect(result.diagnostics[0]).toContain("Executor Exit drain interrupted")
      }
    })
  )
)

it.effect("reports timeout with an earlier executor failure while an atomic owner remains stuck", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const diagnostic = ApplicationExitDiagnostic.make("exact executor suspension failed before the owner settled")
      const processEnds = yield* Ref.make<ReadonlyArray<ApplicationProcessEndDecision>>([])
      const shell = yield* makeApplicationExitShell(defaultOwnership, {
        requestEnd: (decision) => Ref.update(processEnds, (current) => [...current, decision])
      })
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] }))
      })
      yield* shell.admission.acquireForwardOwner("AtomicBoundary")
      const first = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const joined = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* TestClock.adjust("5 seconds")

      const expected = ApplicationExitResult.cases.TimedOut.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      expect(yield* Fiber.join(first)).toEqual(expected)
      expect(yield* Fiber.join(joined)).toEqual(expected)
      expect(yield* Ref.get(processEnds)).toEqual([{ _tag: "RequestForcedTermination", status: 1 }])
    })
  )
)

it.effect("retains a settled executor failure when another executor drain remains unconfirmed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const diagnostic = ApplicationExitDiagnostic.make("first executor failed while its sibling remained running")
      const failedDrainSettled = yield* Deferred.make<void>()
      const shell = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(failedDrainSettled, undefined).pipe(
          Effect.andThen(Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] })))
        )
      })
      yield* shell.registerExecutorDrain({ suspendRunningExecutorWork: Effect.never })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(failedDrainSettled)
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      )
    })
  )
)

it.effect("finishes independent cross-family quick drains before reporting one shared conclusive failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const diagnostic = ApplicationExitDiagnostic.make("executor suspension contradicted the exact attempt")
      const executorStarted = yield* Deferred.make<void>()
      const localCloseStarted = yield* Deferred.make<void>()
      const allowExecutorFailure = yield* Deferred.make<void>()
      const allowLocalClose = yield* Deferred.make<void>()
      const lifecycleCassette = yield* Ref.make<ReadonlyArray<ApplicationExitTraceEvent>>([])
      const shell = yield* makeApplicationExitShell(
        defaultOwnership,
        { requestEnd: () => Effect.void },
        { emit: (event) => Ref.update(lifecycleCassette, (events) => [...events, event]) }
      )
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(executorStarted, undefined).pipe(
          Effect.andThen(Deferred.await(allowExecutorFailure)),
          Effect.andThen(Effect.fail(new ApplicationExitDrainFailure({ diagnostics: [diagnostic] })))
        )
      })
      yield* shell.registerProcessLocalDrain({
        closeProcessLocalResources: Deferred.succeed(localCloseStarted, undefined).pipe(
          Effect.andThen(Deferred.await(allowLocalClose))
        )
      })
      const owner = yield* shell.admission.acquireForwardOwner("AtomicBoundary")
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)

      yield* Deferred.await(executorStarted)
      const joined = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      expect(yield* Deferred.isDone(localCloseStarted)).toBe(false)
      yield* owner.release
      yield* Deferred.await(localCloseStarted)
      yield* Deferred.succeed(allowExecutorFailure, undefined)
      yield* Deferred.succeed(allowLocalClose, undefined)

      const expected = ApplicationExitResult.cases.Failed.make({ diagnostics: [diagnostic], requestedStatus: 1 })
      expect(yield* Fiber.join(exiting)).toEqual(expected)
      expect(yield* Fiber.join(joined)).toEqual(expected)
      const recordedCassette = yield* Ref.get(lifecycleCassette)
      expect(recordedCassette.filter(({ _tag }) => _tag === "ExitRequested")).toHaveLength(2)
      expect(recordedCassette.filter(({ _tag }, index) => _tag !== "ExitRequested" || index === 0)).toEqual(
        crossFamilyFailureApplicationExitAuthoredCassette(diagnostic)
      )
    })
  )
)

it.effect("drains an admitted Run that registers after the Exit driver captured its first executor set", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstDrainStarted = yield* Deferred.make<void>()
      const releaseFirstDrain = yield* Deferred.make<void>()
      const lateDrainStarted = yield* Deferred.make<void>()
      const shell = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const owner = yield* shell.admission.acquireForwardOwner("RunActivation")
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(firstDrainStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseFirstDrain)),
          Effect.as([])
        )
      })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(firstDrainStarted)

      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(lateDrainStarted, undefined).pipe(Effect.as([]))
      })
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(lateDrainStarted)).toBe(true)

      yield* Deferred.succeed(releaseFirstDrain, undefined)
      yield* owner.release
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
    })
  )
)

it.effect("settles the empty executor set before accepting a post-settlement registration", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lateDrainStarted = yield* Deferred.make<void>()
      const shell = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)

      expect(yield* Fiber.join(exiting)).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))

      // The empty activation atomically moved the registry to Settled. A
      // registration arriving after that point cannot become an active drain.
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(lateDrainStarted, undefined).pipe(Effect.as([]))
      })
      expect(yield* Deferred.isDone(lateDrainStarted)).toBe(false)
    })
  )
)

it.effect("unregisters a serving drain before cutoff so Exit does not start it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const drainStarted = yield* Deferred.make<void>()
      const registrationScope = yield* Scope.make()
      const shell = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      yield* shell
        .registerExecutorDrain({
          suspendRunningExecutorWork: Deferred.succeed(drainStarted, undefined).pipe(Effect.as([]))
        })
        .pipe(Scope.provide(registrationScope))

      yield* Scope.close(registrationScope, Exit.void)
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)

      expect(yield* Fiber.join(exiting)).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
      expect(yield* Deferred.isDone(drainStarted)).toBe(false)
    })
  )
)

it.effect("keeps a pre-cutoff executor drain registered when its Run scope closes before driver capture", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const cutoffObserved = yield* Deferred.make<void>()
      const allowDriver = yield* Deferred.make<void>()
      const drainStarted = yield* Deferred.make<void>()
      const releaseDrain = yield* Deferred.make<void>()
      const registrationScope = yield* Scope.make()
      const shell = yield* makeApplicationExitShell(
        defaultOwnership,
        { requestEnd: () => Effect.void },
        {
          emit: (event) =>
            event._tag === "AdmissionCutoffClosed"
              ? Deferred.succeed(cutoffObserved, undefined).pipe(Effect.andThen(Deferred.await(allowDriver)))
              : Effect.void
        }
      )
      yield* shell
        .registerExecutorDrain({
          suspendRunningExecutorWork: Deferred.succeed(drainStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseDrain)),
            Effect.as([])
          )
        })
        .pipe(Scope.provide(registrationScope))
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(cutoffObserved)

      const closingRegistration = yield* Scope.close(registrationScope, Exit.void).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(closingRegistration.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(allowDriver, undefined)
      yield* Deferred.await(drainStarted)
      yield* Deferred.succeed(releaseDrain, undefined)
      yield* Fiber.join(closingRegistration)
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
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
          releaseCoordinatorLock: Effect.void,
          suspendRunningExecutorWork: Effect.succeed([])
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
        releaseCoordinatorLock: Effect.void,
        suspendRunningExecutorWork: Effect.succeed([])
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
