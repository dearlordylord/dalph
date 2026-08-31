/* eslint-disable import/no-nodejs-modules, max-lines -- Host composition and its chronological acceptance seam stay together. */
import { NodeCrypto, NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { PlannedAttemptExecutor, RunId, TaskId } from "@dalph/contracts"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import nodeProcess from "node:process"
import { fileURLToPath } from "node:url"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  EvidenceStore,
  GitCommand,
  Integrator,
  IntegratorGit,
  RunLifecycleJournal,
  CoordinatorOwnership,
  GithubGraphqlClient,
  GithubIssueTarget,
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalPosition,
  JournaledRunEstablished,
  JournaledRunObservationSource,
  JournalStore,
  intentRecordKey,
  makeTaskClaimAcquisitionOperation,
  OperationId,
  outcomeRecordKey,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  type ProductionRunSelection,
  RunReactivationOwner,
  TaskWorkCapacity,
  TraceCursor,
  currentSignalOf,
  memoryJournalStoreLayer,
  ProductionRunSelectionConflict,
  sqliteJournalStoreLayer,
  StartupRecoveryBlocked,
  TrackerGraphReader,
  TrackerMutation,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref, Schema, Stream } from "effect"
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
import { completedRunFinalityFixture } from "../../../orchestrator/test/run-finality.js"
import {
  type RestartFixtureEvent,
  type RestartFixtureInput,
  RestartFixtureEvent as RestartFixtureEventSchema
} from "../../bin/production-restart-host-fixture-contract.js"

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

const makeTemporaryProductionInput = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-host-" })
  const repository = path.join(root, "repository.git")
  const evidence = path.join(root, "evidence")
  const codexState = path.join(root, "codex-state")
  yield* fileSystem.makeDirectory(repository, { recursive: true })
  yield* fileSystem.makeDirectory(evidence, { recursive: true })
  yield* fileSystem.makeDirectory(codexState, { recursive: true })
  yield* fileSystem.chmod(codexState, 0o700)
  return {
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

const restartFixture = new URL("../../dist/bin/production-restart-host-fixture.js", import.meta.url).pathname
const dalphPackageDirectory = new URL("../../", import.meta.url).pathname

const readRestartFixtureEvents = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.length > 0),
    Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(RestartFixtureEventSchema))(line)),
    Stream.runCollect
  )

const restartFixtureCommand = (input: RestartFixtureInput) =>
  ChildProcess.make(
    nodeProcess.execPath,
    [restartFixture, input.journalDatabase, input.root, input.label, String(input.taskWorkCapacity)],
    { cwd: dalphPackageDirectory }
  )

const runRestartFixture = (input: RestartFixtureInput) =>
  Effect.gen(function* () {
    const childProcesses = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* childProcesses.spawn(restartFixtureCommand(input))
    const eventsFiber = yield* readRestartFixtureEvents(handle).pipe(Effect.forkScoped)
    const exitCode = yield* handle.exitCode
    const events = yield* Fiber.join(eventsFiber)
    expect(exitCode).toBe(0)
    expect(events.some(({ _tag }) => _tag === "RestartFixtureFailed")).toBe(false)
    return Array.from(events)
  })

const eventsWithTag = <Tag extends RestartFixtureEvent["_tag"]>(
  events: ReadonlyArray<RestartFixtureEvent>,
  tag: Tag
): ReadonlyArray<Extract<RestartFixtureEvent, { readonly _tag: Tag }>> =>
  events.filter((event): event is Extract<RestartFixtureEvent, { readonly _tag: Tag }> => event._tag === tag)

const restartHostProcesses = Effect.scoped(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-restart-" })
    const repository = path.join(root, "repository")
    const evidence = path.join(root, "evidence")
    const codexState = path.join(root, "codex-state")
    yield* fileSystem.makeDirectory(repository, { recursive: true })
    yield* fileSystem.makeDirectory(evidence, { recursive: true })
    yield* fileSystem.makeDirectory(codexState, { recursive: true })
    yield* fileSystem.chmod(codexState, 0o700)

    const input = {
      journalDatabase: path.join(root, "journal.sqlite"),
      label: "first-host-process",
      root,
      taskWorkCapacity: 2
    } satisfies RestartFixtureInput
    const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(validRawConfiguration().target)
    const acquisition = {
      operationId: OperationId.make("production-restart-claim-acquisition"),
      owner: ClaimOwner.make("dalph:production-restart"),
      taskId: TaskId.make("production-restart-task"),
      token: ClaimToken.make("production-restart-token")
    }
    const acquisitionOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
    const seededRunId = RunId.make("production-restart-run")
    yield* Effect.scoped(
      Effect.gen(function* () {
        const journalContext = yield* Layer.build(
          sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
        )
        const journal = Context.get(journalContext, JournalStore)
        yield* journal.beginRun(
          seededRunId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
        )
        yield* journal.append(
          seededRunId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({
            operation: acquisitionOperation,
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          seededRunId,
          outcomeRecordKey(acquisition.operationId),
          TaskClaimAcquiredEvent.make({
            claim: ActiveTaskClaim.make(acquisition),
            version: workflowJournalEventVersion
          })
        )
      })
    )
    const first = yield* runRestartFixture(input)
    const second = yield* runRestartFixture({ ...input, label: "second-host-process", taskWorkCapacity: 7 })
    const recordsContext = yield* Layer.build(
      sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
    )
    const records = yield* Context.get(recordsContext, JournalStore).read(seededRunId)
    return { first, input, records, second, seededRunId }
  }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeServices.layer, NodeCrypto.layer)))
)

it.effect("unfinished SQLite restart selects the same Run and skips replacement initial policy", () =>
  restartHostProcesses.pipe(
    Effect.map(({ first, records, second, seededRunId }) => {
      const firstCompleted = eventsWithTag(first, "HostCompleted")[0]
      const secondCompleted = eventsWithTag(second, "HostCompleted")[0]
      expect(firstCompleted).toMatchObject({
        label: "first-host-process",
        runId: seededRunId,
        selectionTag: "Recovered"
      })
      expect(secondCompleted).toMatchObject({
        label: "second-host-process",
        runId: seededRunId,
        selectionTag: "Recovered"
      })
      const started = [...eventsWithTag(first, "RestartChildStarted"), ...eventsWithTag(second, "RestartChildStarted")]
      expect(started).toHaveLength(2)
      expect(started[0]?.pid).not.toBe(started[1]?.pid)
      const beginnings = records.filter(({ event }) => event._tag === "WorkflowRunBegan")
      expect(beginnings).toHaveLength(1)
      expect(beginnings[0]?.event).toMatchObject({
        _tag: "WorkflowRunBegan",
        initialControlPolicy: { taskExecutionCapacity: 2 }
      })
    })
  )
)

it.effect("restarted production host reconstructs the task claim and policy before its first GitHub graph read", () =>
  restartHostProcesses.pipe(
    Effect.map(({ first, records, second }) => {
      const trackerReadOperationIds = records.flatMap(({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
          ? [String(event.operation.operationId)]
          : []
      )
      expect(trackerReadOperationIds).toHaveLength(2)
      for (const [processIndex, events] of [first, second].entries()) {
        const reconstructed = eventsWithTag(events, "RecoveryReconstructed")[0]
        const selected = eventsWithTag(events, "OperationSelected")[0]
        const githubRead = eventsWithTag(events, "GithubReadStarted")[0]
        const reconstructionIndex = events.findIndex(({ _tag }) => _tag === "RecoveryReconstructed")
        const selectedIndex = events.findIndex(({ _tag }) => _tag === "OperationSelected")
        const githubReadIndex = events.findIndex(({ _tag }) => _tag === "GithubReadStarted")
        expect(events.map(({ _tag }) => _tag)).toEqual([
          "RestartChildStarted",
          "RecoveryReconstructed",
          "OperationSelected",
          "GithubReadStarted",
          "HostCompleted"
        ])
        expect(reconstructed).toMatchObject({
          acceptedPosition: processIndex === 0 ? 3 : 4,
          initialPolicyTaskWorkCapacity: 2,
          responsibilities: ["TaskClaimAcquired"]
        })
        expect(selected).toMatchObject({ operationTag: "ReadTrackerGraph", targetIssueNumber: 293 })
        expect(selected?.operationId).toBe(trackerReadOperationIds[processIndex])
        expect(githubRead).toMatchObject({ _tag: "GithubReadStarted" })
        expect(reconstructionIndex).toBeGreaterThanOrEqual(0)
        expect(reconstructionIndex).toBeLessThan(selectedIndex)
        expect(selectedIndex).toBeLessThan(githubReadIndex)
      }
    })
  )
)

interface UnsafeDiscoveryBoundaryCalls {
  readonly githubGraphqlRequests: number
  readonly githubTrackerReads: number
  readonly githubTrackerMutations: number
  readonly gitCommandCalls: number
  readonly executorCalls: number
  readonly integratorOperations: number
  readonly integratorGitReads: number
  readonly evidenceWrites: number
  readonly journalMutations: number
  readonly runGraphsBuilt: number
}

const noUnsafeDiscoveryBoundaryCalls: UnsafeDiscoveryBoundaryCalls = {
  githubGraphqlRequests: 0,
  githubTrackerReads: 0,
  githubTrackerMutations: 0,
  gitCommandCalls: 0,
  executorCalls: 0,
  integratorOperations: 0,
  integratorGitReads: 0,
  evidenceWrites: 0,
  journalMutations: 0,
  runGraphsBuilt: 0
}

const makeUnsafeDiscoveryGraph = (calls: Ref.Ref<UnsafeDiscoveryBoundaryCalls>) => {
  const productionGraph = productionRepositoryHostGraph()
  const count = (boundary: keyof UnsafeDiscoveryBoundaryCalls) =>
    Ref.update(calls, (current) => ({ ...current, [boundary]: current[boundary] + 1 }))
  const githubClient = GithubGraphqlClient.of({
    execute: () => count("githubGraphqlRequests").pipe(Effect.andThen(Effect.die("unsafe discovery called GitHub")))
  })
  const trackerReader = TrackerGraphReader.of({
    read: () => count("githubTrackerReads").pipe(Effect.andThen(Effect.die("unsafe discovery read the GitHub graph"))),
    readTaskWorkSpecification: () =>
      count("githubTrackerReads").pipe(Effect.andThen(Effect.die("unsafe discovery read GitHub task work")))
  })
  const trackerMutation = TrackerMutation.of({
    acquireTaskClaim: () =>
      count("githubTrackerMutations").pipe(Effect.andThen(Effect.die("unsafe discovery acquired a GitHub claim"))),
    readTaskClaim: () =>
      count("githubTrackerMutations").pipe(Effect.andThen(Effect.die("unsafe discovery read a GitHub claim"))),
    releaseTaskClaim: () =>
      count("githubTrackerMutations").pipe(Effect.andThen(Effect.die("unsafe discovery released a GitHub claim")))
  })
  const gitCommand = GitCommand.of({
    run: () => count("gitCommandCalls").pipe(Effect.andThen(Effect.die("unsafe discovery ran Git"))),
    runInWorktree: () => count("gitCommandCalls").pipe(Effect.andThen(Effect.die("unsafe discovery ran Git"))),
    runBytesInWorktree: () => count("gitCommandCalls").pipe(Effect.andThen(Effect.die("unsafe discovery ran Git")))
  })
  const executor = PlannedAttemptExecutor.of({
    observe: () => count("executorCalls").pipe(Effect.andThen(Effect.die("unsafe discovery observed Codex"))),
    begin: () => count("executorCalls").pipe(Effect.andThen(Effect.die("unsafe discovery began Codex work"))),
    requestSuspension: () =>
      count("executorCalls").pipe(Effect.andThen(Effect.die("unsafe discovery suspended Codex work"))),
    resume: () => count("executorCalls").pipe(Effect.andThen(Effect.die("unsafe discovery resumed Codex work")))
  })
  const integrator = Integrator.of({
    prepare: () => count("integratorOperations").pipe(Effect.andThen(Effect.die("unsafe discovery called Integrator")))
  })
  const integratorGit = IntegratorGit.of({
    readCandidate: () =>
      count("integratorGitReads").pipe(Effect.andThen(Effect.die("unsafe discovery read Integrator Git facts")))
  })
  const evidence = EvidenceStore.of({
    put: () => count("evidenceWrites").pipe(Effect.andThen(Effect.die("unsafe discovery wrote evidence"))),
    read: () => count("evidenceWrites").pipe(Effect.andThen(Effect.die("unsafe discovery read evidence")))
  })
  return {
    foundation: (configuration: ProductionRepositoryHostConfiguration) =>
      Layer.unwrap(
        Effect.gen(function* () {
          const foundation = yield* Layer.build(productionGraph.foundation(configuration))
          const journal = Context.get(foundation, JournalStore)
          const lifecycle = Context.get(foundation, RunLifecycleJournal)
          const countJournalMutation = <A, E>(effect: Effect.Effect<A, E>) =>
            Ref.update(calls, (current) => ({ ...current, journalMutations: current.journalMutations + 1 })).pipe(
              Effect.andThen(effect)
            )
          const wrappedJournal = JournalStore.of({
            ...journal,
            append: (runId, key, event) => countJournalMutation(journal.append(runId, key, event)),
            beginRun: (runId, target, initialControlPolicy) =>
              countJournalMutation(journal.beginRun(runId, target, initialControlPolicy)),
            terminateRun: (runId, disposition, evidence) =>
              countJournalMutation(journal.terminateRun(runId, disposition, evidence)),
            retireTerminalRun: (runId) => countJournalMutation(journal.retireTerminalRun(runId))
          })
          const wrappedLifecycle = RunLifecycleJournal.of({
            ...lifecycle,
            beginRun: wrappedJournal.beginRun,
            terminateRun: wrappedJournal.terminateRun,
            retireTerminalRun: wrappedJournal.retireTerminalRun
          })
          return Layer.succeedContext(
            Context.add(Context.add(foundation, JournalStore, wrappedJournal), RunLifecycleJournal, wrappedLifecycle)
          )
        })
      ),
    run: (_configuration: ProductionRepositoryHostConfiguration, selection: ProductionRunSelection) =>
      Layer.effectContext(
        Effect.gen(function* () {
          yield* Ref.update(calls, (current) => ({ ...current, runGraphsBuilt: current.runGraphsBuilt + 1 }))
          return Context.empty().pipe(
            Context.add(GithubGraphqlClient, githubClient),
            Context.add(TrackerGraphReader, trackerReader),
            Context.add(TrackerMutation, trackerMutation),
            Context.add(GitCommand, gitCommand),
            Context.add(PlannedAttemptExecutor, executor),
            Context.add(Integrator, integrator),
            Context.add(IntegratorGit, integratorGit),
            Context.add(EvidenceStore, evidence),
            Context.add(
              JournaledRunObservationSource,
              JournaledRunObservationSource.of({
                acceptedHistory: currentSignalOf(
                  TraceCursor.make({ position: JournalPosition.make(1), runId: selection.runId })
                ),
                awaitEstablished: Effect.die("unsafe discovery must not build a Run graph"),
                current: currentSignalOf({ _tag: "NotReady" as const })
              })
            ),
            Context.add(RunReactivationOwner, RunReactivationOwner.of({ hint: () => Effect.void }))
          )
        })
      )
  }
}

const assertNoUnsafeDiscoveryBoundaryCalls = (calls: UnsafeDiscoveryBoundaryCalls) => {
  expect(calls).toEqual(noUnsafeDiscoveryBoundaryCalls)
}

it.effect("terminal Run is not reactivated", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* makeTemporaryProductionInput
      const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(input.target)
      const terminalRunId = RunId.make("production-terminal-run")
      const providerStarted = yield* Deferred.make<void>()
      const appAcquisitions = yield* Ref.make(0)
      const githubAcquisitions = yield* Ref.make(0)
      const fixture = completedRunFinalityFixture({ runId: terminalRunId, target })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
          )
          const journal = Context.get(context, JournalStore)
          yield* journal.beginRun(
            terminalRunId,
            target,
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
          )
          yield* journal.append(terminalRunId, intentRecordKey(fixture.operation.operationId), fixture.intent)
          yield* journal.append(terminalRunId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
          yield* journal.terminateRun(terminalRunId, "Completed", fixture.evidence)
        })
      )
      const githubClient = GithubGraphqlClient.of({
        execute: () => Deferred.succeed(providerStarted, undefined).pipe(Effect.andThen(Effect.never))
      })
      const app = CodexAppServer.of({
        incarnation: CodexServerIncarnation.make("production-terminal-test-incarnation"),
        startThread: () => Effect.die("terminal fixture must not start a task thread"),
        readThread: () => Effect.die("terminal fixture must not read a task thread"),
        resumeThread: () => Effect.die("terminal fixture must not resume a task thread"),
        startTurn: () => Effect.die("terminal fixture must not start a task turn"),
        interruptTurn: () => Effect.die("terminal fixture must not interrupt a task turn"),
        listBackgroundTerminals: () => Effect.die("terminal fixture must not inspect terminals"),
        terminateBackgroundTerminal: () => Effect.die("terminal fixture must not terminate a background terminal"),
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
      const observed = yield* withProductionRepositoryHost(
        input,
        productionRepositoryHostGraph(adapters),
        (observation) => Deferred.await(providerStarted).pipe(Effect.as(observation.selection))
      )

      expect(observed._tag).toBe("Allocated")
      expect(observed.runId).not.toBe(terminalRunId)
      expect(yield* Ref.get(appAcquisitions)).toBe(1)
      expect(yield* Ref.get(githubAcquisitions)).toBe(1)
      const recordsContext = yield* Layer.build(
        sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
      )
      const audit = yield* Context.get(recordsContext, JournalStore).auditAll()
      expect(audit.runs).toContainEqual(expect.objectContaining({ runId: terminalRunId, partition: "Cold" }))
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
  )
)

it.effect(
  "two unfinished Runs fail before GitHub requests, Git commands, Codex executor calls, or Integrator operations and name both identities",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const input = yield* makeTemporaryProductionInput
        const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(input.target)
        const firstRunId = RunId.make("production-conflicting-run-a")
        const secondRunId = RunId.make("production-conflicting-run-b")
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
            )
            const journal = Context.get(context, JournalStore)
            for (const runId of [firstRunId, secondRunId]) {
              yield* journal.beginRun(
                runId,
                target,
                InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
              )
            }
          })
        )
        const calls = yield* Ref.make(noUnsafeDiscoveryBoundaryCalls)
        const failure = yield* withProductionRepositoryHost(input, makeUnsafeDiscoveryGraph(calls), () =>
          Effect.die("conflicting history must not expose a host observation")
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(ProductionRunSelectionConflict)
        expect(failure).toMatchObject({
          conflicts: expect.arrayContaining([
            expect.objectContaining({ runId: firstRunId }),
            expect.objectContaining({ runId: secondRunId })
          ])
        })
        assertNoUnsafeDiscoveryBoundaryCalls(yield* Ref.get(calls))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
    )
)

it.effect(
  "mismatched unfinished history fails before GitHub requests, Git commands, Codex executor calls, Integrator operations, evidence writes, or Journal mutations",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const input = yield* makeTemporaryProductionInput
        const requestedTarget = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(input.target)
        const recordedTarget = yield* Schema.decodeUnknownEffect(GithubIssueTarget)({
          ...input.target,
          issueNumber: 292
        })
        const runId = RunId.make("production-mismatched-run")
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
            )
            yield* Context.get(context, JournalStore).beginRun(
              runId,
              recordedTarget,
              InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
            )
          })
        )
        const calls = yield* Ref.make(noUnsafeDiscoveryBoundaryCalls)
        const failure = yield* withProductionRepositoryHost(input, makeUnsafeDiscoveryGraph(calls), () =>
          Effect.die("mismatched history must not expose a host observation")
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(ProductionRunSelectionConflict)
        expect(failure).toMatchObject({ requestedTarget, conflicts: [{ runId, target: recordedTarget }] })
        assertNoUnsafeDiscoveryBoundaryCalls(yield* Ref.get(calls))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
    )
)

it.effect(
  "malformed history fails before GitHub requests, Git commands, Codex executor calls, Integrator operations, evidence writes, or Journal mutations",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const input = yield* makeTemporaryProductionInput
        const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(input.target)
        const runId = RunId.make("production-malformed-run")
        yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
            )
            yield* Context.get(context, JournalStore).beginRun(
              runId,
              target,
              InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
            )
          })
        )
        yield* Effect.sync(() => {
          const database = new DatabaseSync(input.journalDatabase)
          database.prepare("UPDATE journal_records SET position = 99 WHERE run_id = ? AND position = 1").run(runId)
          database.close()
        })
        const calls = yield* Ref.make(noUnsafeDiscoveryBoundaryCalls)
        const failure = yield* withProductionRepositoryHost(input, makeUnsafeDiscoveryGraph(calls), () =>
          Effect.die("malformed history must not expose a host observation")
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(StartupRecoveryBlocked)
        const blocked = failure as StartupRecoveryBlocked
        expect(blocked.issues).toHaveLength(1)
        expect(blocked.issues[0]).toMatchObject({
          _tag: "JournalSemanticIssue",
          detail: "expected canonical position 1, found 99; WorkflowRunBegan must be the first record",
          partition: "Hot",
          runId
        })
        assertNoUnsafeDiscoveryBoundaryCalls(yield* Ref.get(calls))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
    )
)

const productionHostSource = readFileSync(fileURLToPath(new URL("./production-host.ts", import.meta.url)), "utf8")

it("production host installs one coordinator-owned GitHub, Git, executor, Integrator, and Journal write boundary", () => {
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
