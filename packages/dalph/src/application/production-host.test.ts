/* eslint-disable import/no-nodejs-modules -- This test guards the neighboring production composition source. */
import { NodeCrypto, NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  type RunLifecycleJournal,
  CoordinatorOwnership,
  CoordinatorLockHeld,
  type CoordinatorLockUnavailable,
  GithubGraphqlClient,
  GithubIssueTarget,
  GitCommonDirectoryTarget,
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalPosition,
  JournaledRunEstablished,
  JournaledRunObservationSource,
  JournalStore,
  type ProductionRunSelection,
  RunReactivationOwner,
  TaskWorkCapacity,
  TraceCursor,
  currentSignalOf,
  journalStoreCapabilities,
  memoryJournalStoreLayer,
  productionCoordinatorOwnershipLayer,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, FileSystem, Fiber, Layer, Path, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  type ProductionRepositoryHostGraph,
  productionRepositoryHostGraph,
  withProductionRepositoryHost
} from "./production-host.js"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { ProductionRepositoryHostConfigurationError } from "./production-configuration.js"
import { CodexAppServer } from "./codex-app-server.js"
import { CodexServerIncarnation } from "./codex-attempt-store.js"

const validRawConfiguration = () => ({
  target: { _tag: "GithubIssue", issueNumber: 293, owner: "dearlordylord", repository: "dalph" },
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

const ownershipLayer = Layer.succeed(
  CoordinatorOwnership,
  CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
)

it.effect(
  "production host returns ProductionHostObservation only after exact Run selection and acknowledged WorkflowRunBegan",
  () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<ReadonlyArray<string>>([])
      const storage = memoryJournalStoreLayer
      const foundation = Layer.merge(ownershipLayer, storage)
      const graph = {
        foundation: () => foundation,
        run: (configuration: ProductionRepositoryHostConfiguration, selection: ProductionRunSelection) =>
          Layer.effectContext(
            Effect.gen(function* () {
              const journal = yield* JournalStore
              const awaitEstablished = Effect.gen(function* () {
                const record = yield* journal
                  .beginRun(
                    selection.runId,
                    configuration.target,
                    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
                  )
                  .pipe(Effect.orDie)
                yield* Ref.update(events, (current) => [...current, "begin-acknowledged"])
                return JournaledRunEstablished.make({
                  acceptedAt: record.position,
                  runId: selection.runId,
                  target: configuration.target
                })
              })
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
      } satisfies ProductionRepositoryHostGraph<never, never, never, never, never>

      const selection = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
        Ref.update(events, (current) => [...current, "observation-returned", "github-read"]).pipe(
          Effect.as(observation.selection)
        )
      )
      expect(selection._tag).toBe("Allocated")
      expect(yield* Ref.get(events)).toEqual(["begin-acknowledged", "observation-returned", "github-read"])
    }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("invalid production host configuration opens no scoped production graph", () =>
  Effect.gen(function* () {
    const opened = yield* Ref.make(0)
    const foundationLayer = Layer.mergeAll(
      ownershipLayer,
      memoryJournalStoreLayer,
      Layer.effectDiscard(Ref.update(opened, (count) => count + 1))
    )
    const foundation = () => foundationLayer
    const graph = {
      foundation,
      run: () =>
        Layer.merge(
          Layer.succeed(
            JournaledRunObservationSource,
            JournaledRunObservationSource.of({
              acceptedHistory: currentSignalOf(
                TraceCursor.make({ position: JournalPosition.make(1), runId: RunId.make("unreachable-invalid-run") })
              ),
              awaitEstablished: Effect.die("invalid configuration must not build a Run"),
              current: currentSignalOf({ _tag: "NotReady" as const })
            })
          ),
          Layer.succeed(RunReactivationOwner, RunReactivationOwner.of({ hint: () => Effect.void }))
        )
    } satisfies ProductionRepositoryHostGraph<never, never, never, never, never>
    const failure = yield* withProductionRepositoryHost(
      { ...validRawConfiguration(), taskWorkCapacity: 0 },
      graph,
      () => Effect.void
    ).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(ProductionRepositoryHostConfigurationError)
    expect(yield* Ref.get(opened)).toBe(0)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("allocated and recovered selections identify the exact Run and never append a second beginning", () =>
  Effect.gen(function* () {
    const existingRunId = RunId.make("existing-production-host-run")
    const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(validRawConfiguration().target)
    const observedRecordCount = yield* Ref.make(0)
    const base = Layer.merge(ownershipLayer, memoryJournalStoreLayer)
    const foundation = Layer.effectContext(
      Effect.gen(function* () {
        const context = yield* Effect.context<CoordinatorOwnership | JournalStore | RunLifecycleJournal>()
        const journal = Context.get(context, JournalStore)
        yield* journal
          .beginRun(
            existingRunId,
            target,
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
          )
          .pipe(Effect.orDie)
        return context
      })
    ).pipe(Layer.provide(base))
    const graph = {
      foundation: () => foundation,
      run: (configuration: ProductionRepositoryHostConfiguration, selection: ProductionRunSelection) =>
        Layer.effectContext(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            const awaitEstablished = Effect.gen(function* () {
              const records = yield* journal.read(selection.runId)
              yield* Ref.set(observedRecordCount, records.length)
              const accepted = records.at(-1)
              if (accepted === undefined) return yield* Effect.die("recovered fixture lost its beginning")
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
    } satisfies ProductionRepositoryHostGraph<never, never, never, never, never>

    const selection = yield* withProductionRepositoryHost(validRawConfiguration(), graph, (observation) =>
      Effect.succeed(observation.selection)
    )
    expect(selection).toEqual({ _tag: "Recovered", runId: existingRunId })
    expect(yield* Ref.get(observedRecordCount)).toBe(1)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("cold production host records one beginning before the first GitHub delivery read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-host-" })
      const repository = path.join(root, "repository.git")
      const codexState = path.join(root, "codex-state")
      const evidence = path.join(root, "evidence")
      yield* fileSystem.makeDirectory(repository, { recursive: true })
      yield* fileSystem.makeDirectory(codexState, { recursive: true })
      yield* fileSystem.makeDirectory(evidence, { recursive: true })
      yield* fileSystem.chmod(codexState, 0o700)
      const providerStarted = yield* Deferred.make<void>()
      const appAcquisitions = yield* Ref.make(0)
      const githubAcquisitions = yield* Ref.make(0)
      const githubClient = GithubGraphqlClient.of({
        execute: () => Deferred.succeed(providerStarted, undefined).pipe(Effect.andThen(Effect.never))
      })
      const app = CodexAppServer.of({
        incarnation: CodexServerIncarnation.make("production-host-test-incarnation"),
        startThread: () => Effect.die("no task may start in the empty graph fixture"),
        readThread: () => Effect.die("no task may read a Codex thread in the empty graph fixture"),
        resumeThread: () => Effect.die("no task may resume a Codex thread in the empty graph fixture"),
        startTurn: () => Effect.die("no task may start a Codex turn in the empty graph fixture"),
        interruptTurn: () => Effect.die("no task may interrupt a Codex turn in the empty graph fixture"),
        listBackgroundTerminals: () =>
          Effect.die("no task may inspect background terminals in the empty graph fixture"),
        terminateBackgroundTerminal: () =>
          Effect.die("no task may terminate a background terminal in the empty graph fixture"),
        close: Effect.void
      })
      const adapters = {
        codexAppServer: () =>
          Layer.effect(CodexAppServer, Ref.updateAndGet(appAcquisitions, (count) => count + 1).pipe(Effect.as(app))),
        githubClient: () =>
          Layer.effect(
            GithubGraphqlClient,
            Ref.updateAndGet(githubAcquisitions, (count) => count + 1).pipe(Effect.as(githubClient))
          )
      }
      const input = {
        ...validRawConfiguration(),
        repository,
        commonDirectory: repository,
        journalDatabase: path.join(root, "journal.sqlite"),
        evidenceStoreRoot: evidence,
        plannedAttemptWorktreeRoot: path.join(root, "planned-attempts"),
        codexStateDirectory: codexState,
        integratorCandidateWorktreeRoot: path.join(root, "integrator-candidates"),
        integratorPrivateStore: path.join(root, "integrator-private.json")
      }
      const observed = yield* withProductionRepositoryHost(
        input,
        productionRepositoryHostGraph(adapters),
        (observation) =>
          Deferred.await(providerStarted).pipe(
            Effect.andThen(observation.acceptedHistory.get),
            Effect.map((cursor) => ({ cursor, selection: observation.selection }))
          )
      )

      expect(observed.selection._tag).toBe("Allocated")
      const journalContext = yield* Layer.build(
        sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
      )
      const records = yield* Context.get(journalContext, JournalStore).read(observed.selection.runId)
      expect(records.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan", "TaskTrackerReadIntentRecorded"])
      expect(observed.cursor).toEqual(
        TraceCursor.make({ position: JournalPosition.make(2), runId: observed.selection.runId })
      )
      expect(yield* Ref.get(appAcquisitions)).toBe(1)
      expect(yield* Ref.get(githubAcquisitions)).toBe(1)
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
  )
)

it.effect(
  "second canonical production host fails before every state-changing boundary and releases for fresh discovery",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-host-ownership-" })
        const commonDirectory = path.join(root, "repository.git")
        const alias = path.join(root, "repository-alias")
        yield* fileSystem.makeDirectory(commonDirectory)
        yield* fileSystem.symlink(commonDirectory, alias)

        const journalLayer = yield* Layer.build(memoryJournalStoreLayer)
        const journal = Context.get(journalLayer, JournalStore)
        const scans = yield* Ref.make(0)
        const journalAcquisitions = yield* Ref.make(0)
        const runAcquisitions = yield* Ref.make(0)
        const beginCalls = yield* Ref.make(0)
        const observedJournal = JournalStore.of({
          ...journal,
          scanHot: Effect.fn("ProductionHostOwnershipTest.scanHot")(function* () {
            yield* Ref.update(scans, (count) => count + 1)
            return yield* journal.scanHot()
          }),
          beginRun: Effect.fn("ProductionHostOwnershipTest.beginRun")(function* (runId, target, policy) {
            yield* Ref.update(beginCalls, (count) => count + 1)
            return yield* journal.beginRun(runId, target, policy)
          })
        })
        const ownershipLayerFor = (configuration: ProductionRepositoryHostConfiguration) =>
          productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(configuration.commonDirectory)).pipe(
            Layer.provide(NodeServices.layer)
          )
        const foundation = (configuration: ProductionRepositoryHostConfiguration) => {
          const ownership = ownershipLayerFor(configuration)
          const journalCapabilities = journalStoreCapabilities(
            Layer.effect(
              JournalStore,
              Ref.update(journalAcquisitions, (count) => count + 1).pipe(Effect.as(observedJournal))
            )
          )
          return journalCapabilities.pipe(Layer.provideMerge(ownership))
        }
        const makeRunLayer = (
          configuration: ProductionRepositoryHostConfiguration,
          selection: ProductionRunSelection
        ) =>
          Layer.effectContext(
            Effect.gen(function* () {
              yield* Ref.update(runAcquisitions, (count) => count + 1)
              const journalService = yield* JournalStore
              const established = Effect.gen(function* () {
                const records = yield* journalService.read(selection.runId)
                if (records.length === 0) {
                  const record = yield* journalService.beginRun(
                    selection.runId,
                    configuration.target,
                    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
                  )
                  return JournaledRunEstablished.make({
                    acceptedAt: record.position,
                    runId: selection.runId,
                    target: configuration.target
                  })
                }
                const last = records.at(-1)
                if (last === undefined) return yield* Effect.die("host ownership fixture lost its Run beginning")
                return JournaledRunEstablished.make({
                  acceptedAt: last.position,
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
                    awaitEstablished: established,
                    current: currentSignalOf({ _tag: "NotReady" as const })
                  })
                ),
                Context.add(RunReactivationOwner, RunReactivationOwner.of({ hint: () => Effect.void }))
              )
            })
          )
        const graph = { foundation, run: makeRunLayer } satisfies ProductionRepositoryHostGraph<
          CoordinatorLockHeld | CoordinatorLockUnavailable,
          never,
          never,
          never,
          never
        >
        const firstReady = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const firstSelectionRunId = yield* Deferred.make<RunId>()
        const firstInput = {
          ...validRawConfiguration(),
          repository: commonDirectory,
          commonDirectory,
          journalDatabase: path.join(root, "journal.sqlite"),
          evidenceStoreRoot: path.join(root, "evidence"),
          plannedAttemptWorktreeRoot: path.join(root, "planned-attempts"),
          codexStateDirectory: path.join(root, "codex-state"),
          integratorCandidateWorktreeRoot: path.join(root, "integrator-candidates"),
          integratorPrivateStore: path.join(root, "integrator-private.json")
        }
        const firstHost = withProductionRepositoryHost(firstInput, graph, (observation) =>
          Deferred.succeed(firstSelectionRunId, observation.selection.runId).pipe(
            Effect.andThen(Deferred.succeed(firstReady, undefined)),
            Effect.andThen(Deferred.await(releaseFirst))
          )
        )
        const firstFiber = yield* firstHost.pipe(Effect.forkScoped)
        yield* Deferred.await(firstReady)

        const secondInput = { ...firstInput, commonDirectory: alias }
        const secondFailure = yield* withProductionRepositoryHost(secondInput, graph, () =>
          Effect.die("H2 must not build")
        ).pipe(Effect.flip)
        expect(secondFailure).toBeInstanceOf(CoordinatorLockHeld)
        if (secondFailure instanceof CoordinatorLockHeld) {
          expect(secondFailure.gitCommonDirectory).toBe(commonDirectory)
        }
        expect(yield* Ref.get(scans)).toBe(1)
        expect(yield* Ref.get(journalAcquisitions)).toBe(1)
        expect(yield* Ref.get(runAcquisitions)).toBe(1)
        expect(yield* Ref.get(beginCalls)).toBe(1)

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(firstFiber)

        const secondSelection = yield* withProductionRepositoryHost(secondInput, graph, (observation) =>
          Effect.succeed(observation.selection)
        )
        expect(secondSelection._tag).toBe("Recovered")
        expect(secondSelection.runId).toBe(yield* Deferred.await(firstSelectionRunId))
        expect(yield* Ref.get(scans)).toBe(2)
        expect(yield* Ref.get(journalAcquisitions)).toBe(2)
        expect(yield* Ref.get(runAcquisitions)).toBe(2)
        expect(yield* Ref.get(beginCalls)).toBe(1)
      }).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeCrypto.layer))
    )
)

const productionHostSource = readFileSync(fileURLToPath(new URL("./production-host.ts", import.meta.url)), "utf8")

it("production host installs exactly one owner for every mutation capability and no controlled capability", () => {
  expect(productionHostSource).not.toMatch(/controlled/i)
  for (const construction of [
    "productionCoordinatorOwnershipLayer(",
    "sqliteJournalStoreLayer(",
    "githubDeliveryAuthorityLayer.pipe(",
    "nodeCodexPlannedAttemptExecutorLayer.pipe(",
    "nodeCodexIntegratorLayer(integratorConfiguration).pipe("
  ]) {
    expect(productionHostSource.split(construction)).toHaveLength(2)
  }
})

it("planned-attempt executor and Integrator share one application-scoped Codex app server", () => {
  expect(productionHostSource.match(/const appLayer\b/g)).toHaveLength(1)
  const executorComposition = productionHostSource.slice(
    productionHostSource.indexOf("const executorLayer ="),
    productionHostSource.indexOf("const integratorConfiguration =")
  )
  const integratorComposition = productionHostSource.slice(
    productionHostSource.indexOf("const integratorLayer ="),
    productionHostSource.indexOf("const sharedServices =")
  )
  expect(executorComposition).toContain("Layer.provide(appLayer)")
  expect(integratorComposition).toContain("Layer.provide(appLayer)")
})
