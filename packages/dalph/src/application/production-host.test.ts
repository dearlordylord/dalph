import { NodeCrypto, NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import {
  RunLifecycleJournal,
  CoordinatorOwnership,
  CoordinatorLockHeld,
  GithubGraphqlClient,
  GithubIssueTarget,
  GitCommand,
  InitialControlPolicy,
  Integrator,
  IntegratorCandidateProviderAuthority,
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
  memoryJournalStoreLayer,
  sqliteJournalStoreLayer,
  unavailableIntegratorCandidateProviderAuthority
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
        const trace = yield* Ref.make<ReadonlyArray<string>>([])
        const githubStarted = yield* Deferred.make<void>()

        const record = (event: string) => Ref.update(trace, (current) => [...current, event])
        const boundaryCall = (event: string) =>
          record(event).pipe(Effect.andThen(Effect.die(`unexpected ${event} boundary call`)))
        const codexCall = (operation: string) => () => boundaryCall(`codex.${operation}`)
        const app = CodexAppServer.of({
          incarnation: CodexServerIncarnation.make("production-host-ownership-test-incarnation"),
          startThread: codexCall("startThread"),
          readThread: codexCall("readThread"),
          resumeThread: codexCall("resumeThread"),
          startTurn: codexCall("startTurn"),
          interruptTurn: codexCall("interruptTurn"),
          listBackgroundTerminals: codexCall("listBackgroundTerminals"),
          terminateBackgroundTerminal: codexCall("terminateBackgroundTerminal"),
          close: record("codex.close")
        })
        const githubClient = GithubGraphqlClient.of({
          execute: () =>
            record("github.execute").pipe(
              Effect.andThen(Deferred.succeed(githubStarted, undefined)),
              Effect.andThen(Effect.never)
            )
        })
        const gitCommand = GitCommand.of({
          run: () => boundaryCall("git.run"),
          runInWorktree: () => boundaryCall("git.runInWorktree"),
          runBytesInWorktree: () => boundaryCall("git.runBytesInWorktree")
        })
        const executor = PlannedAttemptExecutor.of({
          observe: () => boundaryCall("executor.observe"),
          begin: () => boundaryCall("executor.begin"),
          requestSuspension: () => boundaryCall("executor.requestSuspension"),
          resume: () => boundaryCall("executor.resume")
        })
        const integrator = Integrator.of({ prepare: () => boundaryCall("integrator.prepare") })
        const adapters = {
          journalStore: (
            _configuration: ProductionRepositoryHostConfiguration,
            defaultLayer: ReturnType<typeof sqliteJournalStoreLayer>
          ) =>
            Layer.effectContext(
              Effect.gen(function* () {
                // Record before the supplied SQLite layer builds its connection, migration, and writer resources.
                yield* record("journal.sqlite.open")
                return yield* Layer.build(defaultLayer)
              })
            ),
          gitCommand: () => Layer.effect(GitCommand, record("git.acquire").pipe(Effect.as(gitCommand))),
          plannedAttemptExecutor: () =>
            Layer.effectContext(
              Effect.gen(function* () {
                yield* GitCommand
                yield* CodexAppServer
                yield* record("executor.acquire")
                return Context.add(Context.empty(), PlannedAttemptExecutor, executor)
              })
            ),
          integrator: () =>
            Layer.effectContext(
              Effect.gen(function* () {
                yield* GitCommand
                yield* CodexAppServer
                yield* CoordinatorOwnership
                yield* record("integrator.acquire")
                return Context.empty().pipe(
                  Context.add(Integrator, integrator),
                  Context.add(IntegratorCandidateProviderAuthority, unavailableIntegratorCandidateProviderAuthority)
                )
              })
            ),
          codexAppServer: () => Layer.effect(CodexAppServer, record("codex.acquire").pipe(Effect.as(app))),
          githubClient: () => Layer.effect(GithubGraphqlClient, record("github.acquire").pipe(Effect.as(githubClient)))
        }
        const productionGraph = productionRepositoryHostGraph(adapters)
        const foundation = (configuration: ProductionRepositoryHostConfiguration) =>
          Layer.effectContext(
            Effect.gen(function* () {
              const context = yield* Effect.context<CoordinatorOwnership | JournalStore | RunLifecycleJournal>()
              const journal = Context.get(context, JournalStore)
              const lifecycle = Context.get(context, RunLifecycleJournal)
              const observedJournal = JournalStore.of({
                ...journal,
                scanHot: Effect.fn("ProductionHostOwnershipTest.scanHot")(function* () {
                  yield* record("journal.scan")
                  return yield* journal.scanHot()
                }),
                beginRun: Effect.fn("ProductionHostOwnershipTest.beginRun")(function* (runId, target, policy) {
                  yield* record("journal.begin")
                  return yield* journal.beginRun(runId, target, policy)
                }),
                append: Effect.fn("ProductionHostOwnershipTest.append")(function* (runId, key, event) {
                  yield* record("journal.append")
                  return yield* journal.append(runId, key, event)
                }),
                retireTerminalRun: Effect.fn("ProductionHostOwnershipTest.retireTerminalRun")(function* (runId) {
                  yield* record("journal.retireTerminalRun")
                  return yield* journal.retireTerminalRun(runId)
                }),
                terminateRun: Effect.fn("ProductionHostOwnershipTest.terminateRun")(
                  function* (runId, disposition, evidence) {
                    yield* record("journal.terminateRun")
                    return yield* journal.terminateRun(runId, disposition, evidence)
                  }
                )
              })
              const observedLifecycle = RunLifecycleJournal.of({
                ...lifecycle,
                beginRun: observedJournal.beginRun,
                read: observedJournal.read,
                readRunForRecovery: observedJournal.readRunForRecovery,
                scanHot: observedJournal.scanHot,
                auditAll: observedJournal.auditAll,
                retireTerminalRun: observedJournal.retireTerminalRun,
                terminateRun: observedJournal.terminateRun
              })
              return Context.add(
                Context.add(context, JournalStore, observedJournal),
                RunLifecycleJournal,
                observedLifecycle
              )
            })
          ).pipe(Layer.provide(productionGraph.foundation(configuration)))
        const run = (
          configuration: ProductionRepositoryHostConfiguration,
          selection: ProductionRunSelection,
          onFailure: (failure: unknown) => Effect.Effect<void>
        ) => productionGraph.run(configuration, selection, onFailure)
        const graph = { foundation, run }
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
            Effect.andThen(Deferred.await(githubStarted)),
            Effect.andThen(Deferred.succeed(firstReady, undefined)),
            Effect.andThen(Deferred.await(releaseFirst))
          )
        )
        // H1 owns the real common directory, opens SQLite, discovers the Run, and reaches the live GitHub edge.
        const firstFiber = yield* firstHost.pipe(Effect.forkScoped)
        yield* Deferred.await(firstReady)

        const afterFirst = yield* Ref.get(trace)
        const count = (event: string, events: ReadonlyArray<string> = afterFirst) =>
          events.filter((observed) => observed === event).length
        expect(count("journal.sqlite.open")).toBe(1)
        expect(count("journal.scan")).toBeGreaterThan(0)
        expect(count("journal.begin")).toBe(1)
        expect(afterFirst.indexOf("journal.sqlite.open")).toBeLessThan(afterFirst.indexOf("journal.scan"))
        expect(afterFirst.indexOf("journal.scan")).toBeLessThan(afterFirst.indexOf("journal.begin"))
        for (const event of [
          "git.acquire",
          "executor.acquire",
          "integrator.acquire",
          "github.acquire",
          "codex.acquire",
          "github.execute"
        ]) {
          expect(count(event)).toBe(1)
        }

        const secondInput = { ...firstInput, commonDirectory: alias }
        // H2 names the same directory through a symlink while H1 still owns it; ownership must fail first.
        const secondFailure = yield* withProductionRepositoryHost(secondInput, graph, () =>
          Effect.die("H2 must not build")
        ).pipe(Effect.flip)
        expect(secondFailure).toBeInstanceOf(CoordinatorLockHeld)
        if (secondFailure instanceof CoordinatorLockHeld) {
          expect(secondFailure.gitCommonDirectory).toBe(commonDirectory)
        }
        const duringSecond = yield* Ref.get(trace)
        expect(duringSecond.slice(afterFirst.length)).toEqual([])
        expect(duringSecond).toEqual(afterFirst)
        yield* record("h2.lock-conflict")

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(firstFiber)

        // A fresh H2 invocation may now open SQLite, rediscover, and reuse H1's durable Run.
        const secondSelection = yield* withProductionRepositoryHost(secondInput, graph, (observation) =>
          Effect.succeed(observation.selection)
        )
        expect(secondSelection._tag).toBe("Recovered")
        expect(secondSelection.runId).toBe(yield* Deferred.await(firstSelectionRunId))
        const finalTrace = yield* Ref.get(trace)
        expect(count("journal.sqlite.open", finalTrace)).toBe(2)
        expect(count("journal.scan", finalTrace)).toBe(count("journal.scan") + 2)
        expect(count("journal.begin", finalTrace)).toBe(1)
        expect(finalTrace.indexOf("h2.lock-conflict")).toBeGreaterThan(finalTrace.indexOf("github.execute"))
        expect(finalTrace.lastIndexOf("journal.sqlite.open")).toBeGreaterThan(finalTrace.indexOf("h2.lock-conflict"))
      }).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeCrypto.layer))
    )
)
