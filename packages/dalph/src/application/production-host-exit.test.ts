import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  ApplicationExitResult,
  CoordinatorOwnership,
  InitialControlPolicy,
  JournalPosition,
  JournalStore,
  JournaledRunEstablished,
  JournaledRunObservationSource,
  RunLifecycleJournal,
  RunReactivationOwner,
  TaskWorkCapacity,
  TraceCursor,
  currentSignalOf,
  memoryJournalStoreLayer
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Fiber, Layer, Ref, type Scope } from "effect"
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
    applicationExit: Parameters<ProductionRepositoryHostGraph<never, never, never, never, never>["run"]>[3]
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
it.effect("graceful host Exit closes admission, returns the lifecycle result, then releases the coordinator lock", () =>
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
    const graph = makeHostGraph(foundation, () => Effect.void)

    const result = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
      observation.applicationExitRequestBoundary.requestExit.pipe(
        Effect.tap((exitResult) => Ref.update(events, (current) => [...current, `result:${exitResult._tag}`]))
      )
    )

    expect(result).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
    expect(yield* Ref.get(events)).toEqual(["result:Succeeded", "coordinator-released"])
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
      applicationExit === undefined
        ? Effect.die("host Exit shell is required")
        : applicationExit.registerProcessLocalDrain({ closeProcessLocalResources: Effect.never })
    )
    const running = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
      Effect.gen(function* () {
        const exiting = yield* observation.applicationExitRequestBoundary.requestExit.pipe(
          Effect.tap(() => Ref.update(events, (current) => [...current, "exit-result"])),
          Effect.forkChild
        )
        yield* Ref.update(events, (current) => [...current, "exit-requested"])
        yield* Deferred.succeed(entered, undefined)
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
          if (applicationExit === undefined) return yield* Effect.die("host Exit shell is required")
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

      const first = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
        observation.applicationExitRequestBoundary.requestExit.pipe(
          Effect.map((result) => ({ result, selection: observation.selection }))
        )
      )
      const firstRecords = yield* journal.read(first.selection.runId)

      const firstSelection = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
        Effect.succeed(observation.selection)
      )
      const secondRecords = yield* journal.read(firstSelection.runId)

      expect(first.result._tag).toBe("Failed")
      expect(firstSelection._tag).toBe("Recovered")
      expect(firstRecords.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(secondRecords.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(yield* Ref.get(admissionCutoffs)).toEqual([false, false])
      expect(yield* Ref.get(releases)).toBe(2)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)
