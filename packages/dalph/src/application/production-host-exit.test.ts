import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  ApplicationExiting,
  ApplicationExitPreFinalizationResult,
  type ApplicationExitPreFinalizationResult as ApplicationExitPreFinalizationResultType,
  type ApplicationExitResultReportLease,
  type ApplicationExitShellService,
  ApplicationExitResult,
  CoordinatorOwnership,
  InitialControlPolicy,
  JournalPosition,
  JournalStore,
  JournaledRunEstablished,
  JournaledRunObservationSource,
  RunLifecycleJournal,
  RunReactivationOwner,
  type ProductionRunSelection,
  TaskWorkCapacity,
  TraceCursor,
  currentSignalOf,
  memoryJournalStoreLayer
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { type ProductionRepositoryHostGraph, withProductionRepositoryHost } from "./production-host.js"

const validRawConfiguration = () => ({
  target: { _tag: "GithubIssue", issueNumber: 297, owner: "dearlordylord", repository: "dalph" },
  repository: "/srv/dalph/repository.git",
  commonDirectory: "/srv/dalph/repository.git",
  integrationRef: "refs/heads/master",
  plannedAttemptBaseSha: "a".repeat(40),
  plannedAttemptExecutor: "codex:production",
  claimOwner: "dalph:production",
  taskWorkCapacity: 2,
  journalDatabase: "/var/lib/dalph/journal.sqlite",
  evidenceStoreRoot: "/var/lib/dalph/evidence",
  plannedAttemptWorktreeRoot: "/srv/dalph/planned-attempts",
  codexStateDirectory: "/var/lib/dalph/codex",
  integratorCandidateWorktreeRoot: "/srv/dalph/integrator-candidates",
  integratorPrivateStore: "/var/lib/dalph/integrator-private.json",
  activationInterval: "1 minute",
  failureCooldown: "5 seconds",
  codexExecutable: "/usr/local/bin/codex",
  codexClientName: "dalph",
  codexClientVersion: "0.0.0",
  codexProvider: "openai",
  githubToken: "github-secret",
  codexProviderCredential: "codex-secret"
})

const scopedCoordinatorOwnershipLayer = (ownership: CoordinatorOwnership["Service"]) =>
  Layer.effect(CoordinatorOwnership, Effect.addFinalizer(() => ownership.release).pipe(Effect.as(ownership)))

const makeHostGraph = (
  foundation: Layer.Layer<CoordinatorOwnership | JournalStore | RunLifecycleJournal>,
  onRun: (
    applicationExit: ApplicationExitShellService<
      ApplicationExitResultReportLease<ApplicationExitPreFinalizationResultType>
    >
  ) => Effect.Effect<void, never, Scope.Scope>
) =>
  ({
    foundation: () => foundation,
    run: (configuration: ProductionRepositoryHostConfiguration, selection, _onFailure, applicationExit) =>
      Layer.effectContext(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* onRun(applicationExit)
          const awaitEstablished = Effect.gen(function* () {
            const records = yield* journal.read(selection.runId)
            const accepted =
              records[0] ??
              (yield* journal
                .beginRun(
                  selection.runId,
                  configuration.target,
                  InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
                )
                .pipe(Effect.orDie))
            return JournaledRunEstablished.make({
              acceptedAt: accepted.position,
              runId: selection.runId,
              target: configuration.target
            })
          }).pipe(Effect.orDie)
          return Context.empty().pipe(
            Context.add(
              JournaledRunObservationSource,
              JournaledRunObservationSource.of({
                acceptedHistory: currentSignalOf(
                  TraceCursor.make({ position: JournalPosition.make(1), runId: selection.runId })
                ),
                awaitEstablished,
                current: currentSignalOf({ _tag: "NotReady" as const })
              })
            ),
            Context.add(RunReactivationOwner, RunReactivationOwner.of({ hint: () => Effect.void }))
          )
        })
      )
  }) satisfies ProductionRepositoryHostGraph<never, never, never, never, never>

/**
 * Scenario mapping: Alice's host request returns its typed lifecycle result
 * before the outer host scope releases coordinator ownership.
 */
it.effect("graceful host Exit reports the lifecycle result, then releases the coordinator lock", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<string>>([])
    const foundation = Layer.merge(
      scopedCoordinatorOwnershipLayer(
        CoordinatorOwnership.of({
          release: Ref.update(events, (current) => [...current, "coordinator-released"]),
          runMutation: (mutation) => mutation
        })
      ),
      memoryJournalStoreLayer
    )
    const shell = yield* Ref.make<
      | ApplicationExitShellService<ApplicationExitResultReportLease<ApplicationExitPreFinalizationResultType>>
      | undefined
    >(undefined)
    const observedResult = yield* Ref.make<ApplicationExitPreFinalizationResultType | undefined>(undefined)
    const graph = makeHostGraph(foundation, (applicationExit) =>
      Ref.set(shell, applicationExit).pipe(
        Effect.andThen(
          Effect.addFinalizer(() => Ref.update(events, (current) => [...current, "run-resources-released"]))
        )
      )
    )

    const hostExit = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
      Effect.gen(function* () {
        const report = yield* observation.applicationExitRequestBoundary.requestExit
        yield* Ref.set(observedResult, report.result)
        yield* Ref.update(events, (current) => [...current, `result:${report.result._tag}`])
        yield* report.acknowledge
        return yield* Effect.never
      })
    ).pipe(Effect.exit)

    expect(Exit.isFailure(hostExit)).toBe(true)
    const result = yield* Ref.get(observedResult)
    expect(result).toBeDefined()
    if (result === undefined) return yield* Effect.die("host report was not observed")
    expect(result).toEqual(ApplicationExitPreFinalizationResult.cases.ReadyForFinalization.make({ requestedStatus: 0 }))
    expect(result._tag).toBe("ReadyForFinalization")
    expect(result._tag).not.toBe("Succeeded")
    expect(result).not.toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
    expect(yield* Ref.get(events)).toEqual([
      "result:ReadyForFinalization",
      "run-resources-released",
      "coordinator-released"
    ])
    const applicationExit = yield* Ref.get(shell)
    expect(applicationExit).toBeDefined()
    if (applicationExit !== undefined) {
      expect(yield* applicationExit.admission.snapshot).toMatchObject({ cutoffClosed: true })
      expect(yield* applicationExit.admission.prepareForwardOwner("AtomicBoundary").pipe(Effect.flip)).toBeInstanceOf(
        ApplicationExiting
      )
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)

/**
 * Scenario mapping: Alice's visible report continuation is blocked after the
 * host result is available. Scope resources and coordinator ownership remain
 * live until that continuation explicitly acknowledges the exact lease.
 */
it.effect("does not finalize host resources while report acknowledgement is blocked", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<string>>([])
    const reportReady =
      yield* Deferred.make<ApplicationExitResultReportLease<ApplicationExitPreFinalizationResultType>>()
    const allowReport = yield* Deferred.make<void>()
    const releases = yield* Ref.make(0)
    const foundation = Layer.merge(
      scopedCoordinatorOwnershipLayer(
        CoordinatorOwnership.of({
          release: Ref.update(releases, (count) => count + 1),
          runMutation: (mutation) => mutation
        })
      ),
      memoryJournalStoreLayer
    )
    const graph = makeHostGraph(foundation, () =>
      Effect.addFinalizer(() => Ref.update(events, (current) => [...current, "run-resources-released"]))
    )

    const hostExit = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
      Effect.gen(function* () {
        const report = yield* observation.applicationExitRequestBoundary.requestExit
        yield* Deferred.succeed(reportReady, report)
        yield* Deferred.await(allowReport)
        yield* Ref.update(events, (current) => [...current, `report-completed:${report.result._tag}`])
        yield* report.acknowledge
        return yield* Effect.never
      })
    ).pipe(Effect.exit, Effect.forkChild)

    const report = yield* Deferred.await(reportReady)
    expect(report.result._tag).toBe("ReadyForFinalization")
    expect(yield* Ref.get(events)).toEqual([])
    expect(yield* Ref.get(releases)).toBe(0)

    yield* Deferred.succeed(allowReport, undefined)
    expect(Exit.isFailure(yield* Fiber.join(hostExit))).toBe(true)
    expect(yield* Ref.get(events)).toEqual(["report-completed:ReadyForFinalization", "run-resources-released"])
    expect(yield* Ref.get(releases)).toBe(1)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

/**
 * Scenario mapping: a supervisor request runs in a child while Alice's host
 * callback is still serving; the typed result is observed before that pending
 * serving scope is interrupted and its resources/lock are finalized.
 */
it.effect("a child Exit request stops a pending host invocation after its typed result", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<string>>([])
    const result = yield* Ref.make<ApplicationExitPreFinalizationResultType | undefined>(undefined)
    const foundation = Layer.merge(
      scopedCoordinatorOwnershipLayer(
        CoordinatorOwnership.of({
          release: Ref.update(events, (current) => [...current, "coordinator-released"]),
          runMutation: (mutation) => mutation
        })
      ),
      memoryJournalStoreLayer
    )
    const graph = makeHostGraph(foundation, () =>
      Effect.addFinalizer(() => Ref.update(events, (current) => [...current, "run-resources-released"]))
    )

    const hostExit = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
      Effect.gen(function* () {
        yield* observation.applicationExitRequestBoundary.requestExit.pipe(
          Effect.tap((report) =>
            Ref.update(result, () => report.result).pipe(
              Effect.andThen(Ref.update(events, (current) => [...current, `result:${report.result._tag}`])),
              Effect.andThen(report.acknowledge)
            )
          ),
          Effect.forkChild
        )
        return yield* Effect.never
      })
    ).pipe(Effect.exit)

    expect(Exit.isFailure(hostExit)).toBe(true)
    const observedResult = yield* Ref.get(result)
    expect(observedResult).toEqual(
      ApplicationExitPreFinalizationResult.cases.ReadyForFinalization.make({ requestedStatus: 0 })
    )
    expect(observedResult?._tag).toBe("ReadyForFinalization")
    expect(observedResult?._tag).not.toBe("Succeeded")
    expect(observedResult).not.toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
    expect(yield* Ref.get(events)).toEqual([
      "result:ReadyForFinalization",
      "run-resources-released",
      "coordinator-released"
    ])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

/**
 * Scenario mapping: cancellation closes the host scope, but no Exit request
 * result is produced and scope loss is not reported as graceful shutdown.
 */
it.effect("host cancellation without an Exit result never reports graceful shutdown", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const events = yield* Ref.make<ReadonlyArray<string>>([])
    const foundation = Layer.merge(
      scopedCoordinatorOwnershipLayer(
        CoordinatorOwnership.of({
          release: Ref.update(events, (current) => [...current, "coordinator-released"]),
          runMutation: (mutation) => mutation
        })
      ),
      memoryJournalStoreLayer
    )
    const graph = makeHostGraph(foundation, (applicationExit) =>
      Effect.gen(function* () {
        yield* applicationExit.awaitExitRequested.pipe(
          Effect.andThen(Deferred.succeed(entered, undefined)),
          Effect.forkChild
        )
        yield* applicationExit.registerProcessLocalDrain({ closeProcessLocalResources: Effect.never })
      })
    )
    const running = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
      Effect.gen(function* () {
        const exiting = yield* observation.applicationExitRequestBoundary.requestExit.pipe(
          Effect.tap(() => Ref.update(events, (current) => [...current, "exit-result"])),
          Effect.forkChild
        )
        yield* Ref.update(events, (current) => [...current, "exit-requested"])
        yield* Fiber.join(exiting)
      })
    ).pipe(Effect.forkChild)

    yield* Deferred.await(entered)
    yield* Fiber.interrupt(running)

    expect(yield* Ref.get(events)).toEqual(["exit-requested", "coordinator-released"])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

/**
 * Scenario mapping: a conclusive drain failure is non-graceful, leaves the
 * exact Run unfinished, and a later host starts with a fresh Exit lifecycle.
 */
it.effect("Exit timeout or conclusive drain failure remains non-graceful and preserves unfinished Run recovery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const memory = yield* Layer.build(memoryJournalStoreLayer)
      const journal = Context.get(memory, JournalStore)
      const lifecycle = Context.get(memory, RunLifecycleJournal)
      const releases = yield* Ref.make(0)
      const registrations = yield* Ref.make(0)
      const admissionCutoffs = yield* Ref.make<ReadonlyArray<boolean>>([])
      const ownership = CoordinatorOwnership.of({
        release: Ref.update(releases, (count) => count + 1),
        runMutation: (mutation) => mutation
      })
      const foundation = Layer.mergeAll(
        scopedCoordinatorOwnershipLayer(ownership),
        Layer.succeed(JournalStore, journal),
        Layer.succeed(RunLifecycleJournal, lifecycle)
      )
      const graph = makeHostGraph(foundation, (applicationExit) =>
        Effect.gen(function* () {
          const admission = yield* applicationExit.admission.snapshot
          yield* Ref.update(admissionCutoffs, (current) => [...current, admission.cutoffClosed])
          const registration = yield* Ref.getAndUpdate(registrations, (count) => count + 1)
          if (registration === 0) {
            yield* applicationExit.registerProcessLocalDrain({
              closeProcessLocalResources: Effect.fail(
                new ApplicationExitDrainFailure({
                  diagnostics: [ApplicationExitDiagnostic.make("controlled host drain failed")]
                })
              )
            })
          }
        })
      )

      const firstSelectionRef = yield* Ref.make<ProductionRunSelection | undefined>(undefined)
      const firstResultRef = yield* Ref.make<ApplicationExitPreFinalizationResultType | undefined>(undefined)
      const firstExit = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
        Effect.gen(function* () {
          const report = yield* observation.applicationExitRequestBoundary.requestExit
          yield* Ref.set(firstSelectionRef, observation.selection)
          yield* Ref.set(firstResultRef, report.result)
          yield* report.acknowledge
          return yield* Effect.never
        })
      ).pipe(Effect.exit)
      expect(Exit.isFailure(firstExit)).toBe(true)
      const firstSelection = yield* Ref.get(firstSelectionRef)
      const firstResult = yield* Ref.get(firstResultRef)
      if (firstSelection === undefined || firstResult === undefined) {
        return yield* Effect.die("host failure report was not observed")
      }
      const firstRecords = yield* journal.read(firstSelection.runId)

      const restartedSelection = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
        Effect.succeed(observation.selection)
      )
      const secondRecords = yield* journal.read(restartedSelection.runId)

      expect(firstResult._tag).toBe("DrainFailed")
      expect(firstResult).not.toEqual(
        ApplicationExitResult.cases.Failed.make({
          diagnostics: [ApplicationExitDiagnostic.make("controlled host drain failed")],
          requestedStatus: 1
        })
      )
      expect(restartedSelection._tag).toBe("Recovered")
      expect(firstRecords.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(secondRecords.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(yield* Ref.get(admissionCutoffs)).toEqual([false, false])
      expect(yield* Ref.get(releases)).toBe(2)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

/**
 * Scenario mapping: a stuck process-local drain reaches the fixed five-second
 * deadline, reports TimedOut, and a restarted host gets a new cutoff/timer.
 */
it.effect("host Exit timeout preserves recovery and starts a fresh five-second lifecycle", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const memory = yield* Layer.build(memoryJournalStoreLayer)
      const journal = Context.get(memory, JournalStore)
      const lifecycle = Context.get(memory, RunLifecycleJournal)
      const releases = yield* Ref.make(0)
      const registrations = yield* Ref.make(0)
      const firstDrainStarted = yield* Deferred.make<void>()
      const secondDrainStarted = yield* Deferred.make<void>()
      const releaseSecondDrain = yield* Deferred.make<void>()
      const admissionCutoffs = yield* Ref.make<ReadonlyArray<boolean>>([])
      const ownership = CoordinatorOwnership.of({
        release: Ref.update(releases, (count) => count + 1),
        runMutation: (mutation) => mutation
      })
      const foundation = Layer.mergeAll(
        scopedCoordinatorOwnershipLayer(ownership),
        Layer.succeed(JournalStore, journal),
        Layer.succeed(RunLifecycleJournal, lifecycle)
      )
      const graph = makeHostGraph(foundation, (applicationExit) =>
        Effect.gen(function* () {
          const admission = yield* applicationExit.admission.snapshot
          yield* Ref.update(admissionCutoffs, (current) => [...current, admission.cutoffClosed])
          const registration = yield* Ref.getAndUpdate(registrations, (count) => count + 1)
          yield* applicationExit.registerProcessLocalDrain(
            registration === 0
              ? {
                  closeProcessLocalResources: Deferred.succeed(firstDrainStarted, undefined).pipe(
                    Effect.andThen(Effect.never)
                  )
                }
              : {
                  closeProcessLocalResources: Deferred.succeed(secondDrainStarted, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseSecondDrain))
                  )
                }
          )
        })
      )

      const firstSelectionRef = yield* Ref.make<ProductionRunSelection | undefined>(undefined)
      const firstResultRef = yield* Ref.make<ApplicationExitPreFinalizationResultType | undefined>(undefined)
      const firstExit = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
        Effect.gen(function* () {
          const request = yield* observation.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
          yield* Deferred.await(firstDrainStarted)
          yield* TestClock.adjust("5 seconds")
          const report = yield* Fiber.join(request)
          yield* Ref.set(firstSelectionRef, observation.selection)
          yield* Ref.set(firstResultRef, report.result)
          yield* report.acknowledge
          return yield* Effect.never
        })
      ).pipe(Effect.exit)
      expect(Exit.isFailure(firstExit)).toBe(true)
      const firstSelection = yield* Ref.get(firstSelectionRef)
      const firstResult = yield* Ref.get(firstResultRef)
      if (firstSelection === undefined || firstResult === undefined) {
        return yield* Effect.die("host timeout report was not observed")
      }
      const firstRecords = yield* journal.read(firstSelection.runId)

      const secondSelectionRef = yield* Ref.make<ProductionRunSelection | undefined>(undefined)
      const secondResultRef = yield* Ref.make<ApplicationExitPreFinalizationResultType | undefined>(undefined)
      const secondExit = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
        Effect.gen(function* () {
          const request = yield* observation.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
          yield* Deferred.await(secondDrainStarted)
          yield* TestClock.adjust("4 seconds")
          expect(request.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(releaseSecondDrain, undefined)
          const report = yield* Fiber.join(request)
          yield* Ref.set(secondSelectionRef, observation.selection)
          yield* Ref.set(secondResultRef, report.result)
          yield* report.acknowledge
          return yield* Effect.never
        })
      ).pipe(Effect.exit)
      expect(Exit.isFailure(secondExit)).toBe(true)
      const secondSelection = yield* Ref.get(secondSelectionRef)
      const secondResult = yield* Ref.get(secondResultRef)
      if (secondSelection === undefined || secondResult === undefined) {
        return yield* Effect.die("host restart report was not observed")
      }
      const secondRecords = yield* journal.read(secondSelection.runId)

      expect(firstResult).toEqual(
        ApplicationExitPreFinalizationResult.cases.DrainTimedOut.make({ diagnostics: [], requestedStatus: 1 })
      )
      expect(firstResult._tag).toBe("DrainTimedOut")
      expect(secondResult).toEqual(
        ApplicationExitPreFinalizationResult.cases.ReadyForFinalization.make({ requestedStatus: 0 })
      )
      expect(secondResult._tag).not.toBe("Succeeded")
      expect(firstResult).not.toEqual(
        ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })
      )
      expect(secondSelection).toEqual({ _tag: "Recovered", runId: firstSelection.runId })
      expect(firstRecords.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(secondRecords.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(yield* Ref.get(admissionCutoffs)).toEqual([false, false])
      expect(yield* Ref.get(releases)).toBe(2)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)
