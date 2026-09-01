/* eslint-disable import/no-nodejs-modules, max-lines -- Host composition and its chronological acceptance seam stay together. */
import { NodeCrypto, NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { DatabaseSync } from "node:sqlite"
import nodeProcess from "node:process"
import {
  ApplicationExitShell,
  type ApplicationExitPreFinalizationResult,
  type ApplicationExitResultReportLease,
  type ApplicationExitShellService,
  ClaimOwner,
  ClaimToken,
  RunLifecycleJournal,
  CoordinatorOwnership,
  CoordinatorLockHeld,
  GithubGraphqlClient,
  GithubIssueNodeId,
  GithubIssueTarget,
  GithubRepositoryNodeId,
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalPosition,
  JournaledRunEstablished,
  JournaledRunObservationSource,
  JournalStore,
  intentRecordKey,
  makeTaskClaimAcquisitionOperation,
  makeCompleteTaskTrackerFactsObserved,
  makeTrackerGraphObservationOperation,
  OperationId,
  outcomeRecordKey,
  projectTrackerSnapshot,
  TaskClaimAcquisitionIntendedEvent,
  TaskTrackerMutationThrottled,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  type ProductionRunSelection,
  RunReactivationOwner,
  TaskWorkCapacity,
  TraceCursor,
  currentSignalOf,
  memoryJournalStoreLayer,
  ProductionRunSelectionConflict,
  RunPolicyRevision,
  sqliteJournalStoreLayer,
  StartupRecoveryBlocked,
  TaskWorkCapacityChangedEvent,
  taskWorkCapacityPolicyRecordKey,
  TrackerRevision,
  workflowJournalEventVersion,
  githubTaskIdFor
} from "@dalph/orchestrator"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Schema,
  Stream
} from "effect"
import { TestClock } from "effect/testing"
import { expect, expectTypeOf } from "vitest"
import {
  type ProductionRepositoryHostAdapters,
  type ProductionRepositoryHostBoundary,
  type ProductionRepositoryHostGraph,
  productionRepositoryHostGraph,
  withProductionRepositoryHost
} from "./production-host.js"
import { isNonRetryableProductionActivationFailure } from "./production.js"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { ProductionRepositoryHostConfigurationError } from "./production-configuration.js"
import { CodexAppServer } from "./codex-app-server.js"
import { CodexServerIncarnation } from "./codex-attempt-store.js"
import { completedRunFinalityFixture } from "../../../orchestrator/test/run-finality.js"
import { GithubGraphqlThrottled } from "../../../orchestrator/src/authorities/task-tracker/github/graphql-client.js"
import { GithubGraphqlRequestError } from "../../../orchestrator/src/authorities/task-tracker/github/graphql-response.js"
import { githubGraphqlTestClient } from "../../../orchestrator/src/authorities/task-tracker/github/graphql-client.test-fixture.js"
import {
  type RestartFixtureEvent,
  RestartFixtureInput,
  RestartFixtureEvent as RestartFixtureEventSchema,
  type RestartFixtureInput as RestartFixtureInputType
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

it("production host adapter surface cannot replace workflow mutation capabilities", () => {
  type CapabilityReplacementKey = Extract<
    keyof ProductionRepositoryHostAdapters,
    "journalStore" | "gitCommand" | "plannedAttemptExecutor" | "integrator" | "evidenceStore"
  >
  expectTypeOf<CapabilityReplacementKey>().toEqualTypeOf<never>()
  type HostProcessEndObserverKey = Extract<keyof ProductionRepositoryHostAdapters, "applicationProcessEndObserver">
  expectTypeOf<HostProcessEndObserverKey>().toEqualTypeOf<never>()
})

it("production host graph exposes only the precise non-retryable throttle callback", () => {
  const graph = productionRepositoryHostGraph()
  type ActivationFailure = Parameters<typeof graph.run>[2] extends (failure: infer Failure) => Effect.Effect<void>
    ? Failure
    : never
  expectTypeOf<ActivationFailure>().toEqualTypeOf<TaskTrackerMutationThrottled>()
})

it("uses one canonical fatal classifier for throttles and recoverable failures", () => {
  const throttle = new TaskTrackerMutationThrottled({
    detail: "GitHub primary rate limit rejected the claim mutation",
    operation: "AcquireTaskClaim",
    operationId: OperationId.make("production-host-classifier-throttle"),
    retry: null
  })
  const recoverable = new GithubGraphqlRequestError({
    detail: "GitHub request failed while reading the current claim",
    operation: "FindClaimLabel"
  })

  expect(isNonRetryableProductionActivationFailure(throttle)).toBe(true)
  expect(isNonRetryableProductionActivationFailure(recoverable)).toBe(false)
})

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

it.effect("production host exposes TaskTrackerMutationThrottled unchanged and tears down only its ordinary scope", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<string>>([])
    const useEntered = yield* Deferred.make<void>()
    const failureDelivered = yield* Deferred.make<void>()
    const scopeReleased = yield* Deferred.make<void>()
    const throttle = new TaskTrackerMutationThrottled({
      detail: "GitHub primary rate limit rejected the claim mutation",
      operation: "AcquireTaskClaim",
      operationId: OperationId.make("production-host-throttle"),
      retry: null
    })
    const graph = {
      foundation: () => Layer.merge(ownershipLayer, memoryJournalStoreLayer),
      run: (
        configuration: ProductionRepositoryHostConfiguration,
        selection: ProductionRunSelection,
        onFailure,
        _applicationExit
      ) =>
        Layer.effectContext(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Ref.update(events, (current) => [...current, "scope-released"]).pipe(
                Effect.andThen(Deferred.succeed(scopeReleased, undefined))
              )
            )
            yield* Effect.forkScoped(
              Deferred.await(useEntered).pipe(
                Effect.andThen(Ref.update(events, (current) => [...current, "tracker-throttle"])),
                Effect.andThen(Deferred.succeed(failureDelivered, undefined)),
                Effect.andThen(onFailure(throttle))
              )
            )
            return Context.empty().pipe(
              Context.add(
                JournaledRunObservationSource,
                JournaledRunObservationSource.of({
                  acceptedHistory: currentSignalOf(
                    TraceCursor.make({ position: JournalPosition.make(1), runId: selection.runId })
                  ),
                  awaitEstablished: Effect.succeed(
                    JournaledRunEstablished.make({
                      acceptedAt: JournalPosition.make(1),
                      runId: selection.runId,
                      target: configuration.target
                    })
                  ),
                  current: currentSignalOf({ _tag: "NotReady" as const })
                })
              ),
              Context.add(RunReactivationOwner, RunReactivationOwner.of({ hint: () => Effect.void }))
            )
          })
        )
      // Keep the failure type at this seam explicit: #257 owns conversion
      // from GitHub's mutation throttle to this provider-neutral error.
      // The host only observes and propagates the already typed result.
    } satisfies ProductionRepositoryHostGraph<never, never, never, never, TaskTrackerMutationThrottled>

    const hostFiber = yield* withProductionRepositoryHost(validRawConfiguration(), graph, () =>
      Deferred.succeed(useEntered, undefined).pipe(Effect.andThen(Effect.never))
    ).pipe(Effect.exit, Effect.timeoutOption(Duration.seconds(1)))
    yield* Deferred.await(failureDelivered)
    yield* Deferred.await(scopeReleased)

    expect(Option.isSome(hostFiber)).toBe(true)
    if (Option.isSome(hostFiber)) {
      const result = hostFiber.value
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBe(throttle)
    }
    expect(yield* Ref.get(events)).toEqual(["tracker-throttle", "scope-released"])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("next host invocation recovers the same Run and authority-reads before mutation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* makeTemporaryProductionInput
      const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(input.target)
      const runId = RunId.make("production-throttle-recovery-run")
      const taskId = githubTaskIdFor(
        GithubRepositoryNodeId.make("production-throttle-recovery-repository"),
        GithubIssueNodeId.make("production-throttle-recovery-issue")
      )
      const acquisitionOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make("production-throttle-recovery-acquisition"),
          owner: ClaimOwner.make("dalph:production"),
          taskId,
          token: ClaimToken.make("production-throttle-recovery-token")
        },
        predecessorOperationIds: []
      })
      const graphOperation = makeTrackerGraphObservationOperation(
        OperationId.make("production-throttle-recovery-graph"),
        target,
        [],
        [taskId]
      )
      const graphProjection = projectTrackerSnapshot({
        revision: TrackerRevision.make("production-throttle-recovery-graph"),
        tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (graphProjection._tag === "Invalid") return yield* Effect.die(graphProjection)
      const graphObservation = makeCompleteTaskTrackerFactsObserved(graphOperation, graphProjection.snapshot)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const journalContext = yield* Layer.build(
            sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
          )
          const journal = Context.get(journalContext, JournalStore)
          yield* journal.beginRun(
            runId,
            target,
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
          )
          yield* journal.append(
            runId,
            intentRecordKey(graphOperation.operationId),
            taskTrackerReadIntent(graphOperation)
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(graphOperation.operationId),
            taskTrackerFactsObservedEvent(graphOperation.operationId, graphObservation)
          )
          yield* journal.append(
            runId,
            intentRecordKey(acquisitionOperation.acquisition.operationId),
            TaskClaimAcquisitionIntendedEvent.make({
              operation: acquisitionOperation,
              version: workflowJournalEventVersion
            })
          )
        })
      )

      const requests = yield* Ref.make<ReadonlyArray<string>>([])
      const selections = yield* Ref.make<ReadonlyArray<ProductionRunSelection>>([])
      const throttle = new GithubGraphqlThrottled({
        detail: "GitHub primary rate limit rejected the claim mutation",
        kind: "Primary",
        operation: "CreateClaimLabel",
        timingEvidence: null
      })
      const firstMutationReturned = yield* Deferred.make<void>()
      const firstTimerStopped = yield* Deferred.make<void>()
      const activations = yield* Ref.make(0)
      const githubClient = githubGraphqlTestClient(
        Effect.fn("ProductionThrottleRecovery.github.execute")(function* (request) {
          yield* Ref.update(requests, (current) => [...current, request._tag])
          if (request._tag === "FindClaimLabel") {
            yield* Ref.update(activations, (current) => current + 1)
            return { body: { data: { node: { id: request.repositoryNodeId, label: null } } } }
          }
          if (request._tag === "CreateClaimLabel") {
            yield* Deferred.succeed(firstMutationReturned, undefined)
            return yield* throttle
          }
          return yield* Effect.die(`unexpected GitHub request ${request._tag}`)
        })
      )
      const appClosed = yield* Ref.make(0)
      const applicationExitRequests = yield* Ref.make(0)
      const applicationExitTrace = yield* Ref.make<ReadonlyArray<string>>([])
      const workflowCleanupCalls = yield* Ref.make<ReadonlyArray<string>>([])
      const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
      const activationFinalizations = yield* Ref.make<ReadonlyArray<string>>([])
      const activationFailures = yield* Ref.make<ReadonlyArray<string>>([])
      const app = CodexAppServer.of({
        incarnation: CodexServerIncarnation.make("production-throttle-recovery-incarnation"),
        startThread: () => Effect.die("throttle recovery must not start a Codex thread"),
        readThread: () => Effect.die("throttle recovery must not read a Codex thread"),
        resumeThread: () => Effect.die("throttle recovery must not resume a Codex thread"),
        startTurn: () => Effect.die("throttle recovery must not start a Codex turn"),
        interruptTurn: () => Effect.die("throttle recovery must not interrupt a Codex turn"),
        listBackgroundTerminals: () => Effect.die("throttle recovery must not inspect terminals"),
        terminateBackgroundTerminal: () => Effect.die("throttle recovery must not terminate a terminal"),
        close: Ref.update(appClosed, (count) => count + 1)
      })
      const adapters: ProductionRepositoryHostAdapters = {
        codexAppServer: () =>
          Layer.effect(CodexAppServer, Effect.addFinalizer(() => app.close.pipe(Effect.orDie)).pipe(Effect.as(app))),
        githubClient: () => Layer.succeed(GithubGraphqlClient, githubClient),
        applicationExitRequestObserver: () => Ref.update(applicationExitRequests, (count) => count + 1),
        applicationExitTraceObserver: (event) =>
          Ref.update(applicationExitTrace, (current) => [...current, event._tag]),
        workflowCleanupObserver: (boundary) => Ref.update(workflowCleanupCalls, (current) => [...current, boundary]),
        onActivationFailure: (failure) =>
          Ref.update(activationFailures, (current) => [
            ...current,
            failure instanceof TaskTrackerMutationThrottled ? failure._tag : "UnexpectedFailure"
          ]),
        onTimerStateChange: (state) =>
          Ref.update(timerStates, (current) => [...current, state]).pipe(
            Effect.andThen(state === "Stopped" ? Deferred.succeed(firstTimerStopped, undefined) : Effect.void)
          ),
        onActivationFinalizationStart: (kind) => Ref.update(activationFinalizations, (current) => [...current, kind])
      }
      const graph = productionRepositoryHostGraph(adapters)
      const callbackEntered = yield* Deferred.make<void>()
      const callbackTeardownStarted = yield* Deferred.make<void>()
      const releaseCallbackTeardown = yield* Deferred.make<void>()
      const firstObserveSelection = (observation: { readonly selection: ProductionRunSelection }) =>
        Ref.update(selections, (current) => [...current, observation.selection]).pipe(
          Effect.andThen(Deferred.succeed(callbackEntered, undefined)),
          // This models a callback finalizer that cannot be interrupted until
          // its process-local resource has released. The owner must stop
          // before this teardown begins or a short cooldown can admit retry.
          Effect.andThen(
            Effect.acquireUseRelease(
              Effect.void,
              () => Effect.never,
              () =>
                Deferred.succeed(callbackTeardownStarted, undefined).pipe(
                  Effect.andThen(Effect.uninterruptible(Deferred.await(releaseCallbackTeardown)))
                )
            )
          )
        )
      const firstFiber = yield* withProductionRepositoryHost(
        { ...input, activationInterval: "1 millis", failureCooldown: "1 millis" },
        graph,
        firstObserveSelection
      ).pipe(Effect.exit, Effect.forkScoped)
      yield* Deferred.await(callbackEntered)
      yield* Deferred.await(firstMutationReturned)
      // Fatal handling stops the owner before host-scope interruption reaches
      // this callback. Wait for both direct signals before advancing the
      // frozen clock, so this proves stop-before-teardown rather than merely
      // observing that the mutation returned a throttle.
      yield* Deferred.await(firstTimerStopped)
      yield* Deferred.await(callbackTeardownStarted)
      // The callback teardown remains blocked while every owner-local timer
      // can fire. A non-retryable throttle must leave exactly one activation.
      yield* TestClock.adjust("100 millis")
      yield* Effect.yieldNow
      expect(yield* Ref.get(activations)).toBe(1)
      expect(yield* Ref.get(requests)).toEqual(["FindClaimLabel", "CreateClaimLabel"])
      yield* Deferred.succeed(releaseCallbackTeardown, undefined)
      const first = yield* Fiber.join(firstFiber)
      const recordsAfterFirst = yield* Effect.scoped(
        Effect.gen(function* () {
          const journalContext = yield* Layer.build(
            sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
          )
          return yield* Context.get(journalContext, JournalStore).read(runId)
        })
      )
      const second = yield* withProductionRepositoryHost(input, graph, (observation) =>
        Ref.update(selections, (current) => [...current, observation.selection]).pipe(Effect.andThen(Effect.never))
      ).pipe(Effect.exit)
      const recordsAfterSecond = yield* Effect.scoped(
        Effect.gen(function* () {
          const journalContext = yield* Layer.build(
            sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(input.journalDatabase) })
          )
          return yield* Context.get(journalContext, JournalStore).read(runId)
        })
      )

      expect(Exit.isFailure(first)).toBe(true)
      expect(Exit.isFailure(second)).toBe(true)
      if (Exit.isFailure(first)) {
        const failure = Cause.squash(first.cause)
        expect(failure).toBeInstanceOf(TaskTrackerMutationThrottled)
        expect(failure).toMatchObject({
          detail: throttle.detail,
          operation: "AcquireTaskClaim",
          operationId: acquisitionOperation.acquisition.operationId,
          retry: null
        })
      }
      if (Exit.isFailure(second)) {
        expect(Cause.squash(second.cause)).toBeInstanceOf(TaskTrackerMutationThrottled)
      }
      expect(yield* Ref.get(selections)).toEqual([
        { _tag: "Recovered", runId },
        { _tag: "Recovered", runId }
      ])
      expect(yield* Ref.get(requests)).toEqual([
        "FindClaimLabel",
        "CreateClaimLabel",
        "FindClaimLabel",
        "CreateClaimLabel"
      ])
      expect(yield* Ref.get(applicationExitRequests)).toBe(0)
      expect(yield* Ref.get(applicationExitTrace)).toEqual([])
      expect(yield* Ref.get(workflowCleanupCalls)).toEqual([])
      expect(yield* Ref.get(activationFailures)).toEqual([
        "TaskTrackerMutationThrottled",
        "TaskTrackerMutationThrottled"
      ])
      expect(yield* Ref.get(timerStates)).toEqual(["Started", "Stopped", "Started", "Stopped"])
      expect(yield* Ref.get(activationFinalizations)).toEqual(["Ordinary", "Ordinary"])
      expect(yield* Ref.get(activations)).toBe(2)
      expect(recordsAfterFirst.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
      expect(recordsAfterSecond.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
      expect(yield* Ref.get(appClosed)).toBe(2)
    })
  ).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeServices.layer, NodeCrypto.layer)))
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

/**
 * Scenario mapping: one required host Exit shell is injected into both the
 * real Codex acquisition and workflow layer, with no second process shell.
 */
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
      const applicationExitObservations = yield* Ref.make<
        ReadonlyArray<readonly ["workflow" | "codex-app-server", ApplicationExitShell["Service"]]>
      >([])
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
        workflowApplicationExitObserver: (applicationExit: ApplicationExitShell["Service"]) =>
          Ref.update(applicationExitObservations, (current) => [...current, ["workflow", applicationExit] as const]),
        codexAppServer: () =>
          Layer.effect(
            CodexAppServer,
            Effect.gen(function* () {
              const applicationExit = yield* ApplicationExitShell
              yield* Ref.update(applicationExitObservations, (current) => [
                ...current,
                ["codex-app-server", applicationExit] as const
              ])
              yield* Ref.update(appAcquisitions, (count) => count + 1)
              return app
            })
          ),
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
            Effect.map((cursor) => ({
              cursor,
              selection: observation.selection,
              applicationExitRequestBoundary: observation.applicationExitRequestBoundary
            }))
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
      const exitObservations = yield* Ref.get(applicationExitObservations)
      expect(exitObservations.some(([boundary]) => boundary === "codex-app-server")).toBe(true)
      expect(exitObservations.some(([boundary]) => boundary === "workflow")).toBe(true)
      const observedShells = exitObservations.map(([, applicationExit]) => applicationExit)
      expect(observedShells.length).toBeGreaterThanOrEqual(2)
      expect(observedShells.every((applicationExit) => applicationExit === observedShells[0])).toBe(true)
      expect(observedShells[0]?.requestBoundary).toBe(observed.applicationExitRequestBoundary)
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
  )
)

/**
 * Scenario mapping: a supervisor requests Exit through the production host's
 * supplied prefinalization shell; request and lifecycle trace observers see
 * the real boundary events, while no process-end event is fabricated.
 */
it.effect("production host connects supplied Exit request and trace observers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-host-exit-observers-" })
      const repository = path.join(root, "repository.git")
      const codexState = path.join(root, "codex-state")
      const evidence = path.join(root, "evidence")
      yield* fileSystem.makeDirectory(repository, { recursive: true })
      yield* fileSystem.makeDirectory(codexState, { recursive: true })
      yield* fileSystem.makeDirectory(evidence, { recursive: true })
      yield* fileSystem.chmod(codexState, 0o700)
      const providerStarted = yield* Deferred.make<void>()
      const cutoffObserved = yield* Deferred.make<void>()
      const requestObservers = yield* Ref.make(0)
      const traceEvents = yield* Ref.make<ReadonlyArray<string>>([])
      const resultTag = yield* Ref.make<string | undefined>(undefined)
      const githubClient = GithubGraphqlClient.of({
        execute: () => Deferred.succeed(providerStarted, undefined).pipe(Effect.andThen(Effect.never))
      })
      const app = CodexAppServer.of({
        incarnation: CodexServerIncarnation.make("production-host-exit-observer-incarnation"),
        startThread: () => Effect.die("Exit observer fixture must not start a Codex thread"),
        readThread: () => Effect.die("Exit observer fixture must not read a Codex thread"),
        resumeThread: () => Effect.die("Exit observer fixture must not resume a Codex thread"),
        startTurn: () => Effect.die("Exit observer fixture must not start a Codex turn"),
        interruptTurn: () => Effect.die("Exit observer fixture must not interrupt a Codex turn"),
        listBackgroundTerminals: () => Effect.die("Exit observer fixture must not inspect terminals"),
        terminateBackgroundTerminal: () => Effect.die("Exit observer fixture must not terminate a terminal"),
        close: Effect.void
      })
      const adapters: ProductionRepositoryHostAdapters = {
        applicationExitRequestObserver: () => Ref.update(requestObservers, (count) => count + 1),
        applicationExitTraceObserver: (event) =>
          Ref.update(traceEvents, (current) => [...current, event._tag]).pipe(
            Effect.andThen(
              event._tag === "AdmissionCutoffClosed" ? Deferred.succeed(cutoffObserved, undefined) : Effect.void
            )
          ),
        codexAppServer: () => Layer.succeed(CodexAppServer, app),
        githubClient: () => Layer.succeed(GithubGraphqlClient, githubClient)
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

      const hostExit = yield* withProductionRepositoryHost(
        input,
        productionRepositoryHostGraph(adapters),
        (observation) =>
          Effect.gen(function* () {
            yield* Deferred.await(providerStarted)
            const request = yield* observation.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
            yield* Deferred.await(cutoffObserved)
            yield* TestClock.adjust("5 seconds")
            const report = yield* Fiber.join(request)
            yield* Ref.set(resultTag, report.result._tag)
            yield* report.acknowledge
            return yield* Effect.never
          })
      ).pipe(Effect.exit)

      expect(Exit.isFailure(hostExit)).toBe(true)
      expect(yield* Ref.get(resultTag)).toBe("ReadyForFinalization")
      expect(yield* Ref.get(requestObservers)).toBe(1)
      const observedTrace = yield* Ref.get(traceEvents)
      expect(observedTrace).toContain("ExitRequested")
      expect(observedTrace).toContain("AdmissionCutoffClosed")
      expect(observedTrace).toContain("ExitDrainResultReported")
      expect(observedTrace).toContain("ExitDrainReportAcknowledged")
      expect(observedTrace).not.toContain("ProcessEndRequested")
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

const restartFixtureCommand = (input: RestartFixtureInputType) =>
  ChildProcess.make(nodeProcess.execPath, [restartFixture, JSON.stringify(input)], { cwd: dalphPackageDirectory })

const runRestartFixture = (input: RestartFixtureInputType) =>
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

    const target = yield* Schema.decodeUnknownEffect(GithubIssueTarget)(validRawConfiguration().target)
    const acquisition = {
      operationId: OperationId.make("production-restart-claim-acquisition"),
      owner: ClaimOwner.make("dalph:production-restart"),
      taskId: githubTaskIdFor(
        GithubRepositoryNodeId.make("production-restart-repository-node"),
        GithubIssueNodeId.make("production-restart-issue-node")
      ),
      token: ClaimToken.make("production-restart-token")
    }
    const acquisitionOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
    const graphOperation = makeTrackerGraphObservationOperation(
      OperationId.make("production-restart-graph-read"),
      target,
      [],
      [acquisition.taskId]
    )
    const graphProjection = projectTrackerSnapshot({
      revision: TrackerRevision.make("production-restart-graph"),
      tasks: [{ id: acquisition.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (graphProjection._tag === "Invalid") return yield* Effect.die(graphProjection)
    const graphObservation = makeCompleteTaskTrackerFactsObserved(graphOperation, graphProjection.snapshot)
    const seededRunId = RunId.make("production-restart-run")
    const input = RestartFixtureInput.make({
      journalDatabase: JournalDatabaseLocator.make(path.join(root, "journal.sqlite")),
      label: "first-host-process",
      root,
      runId: seededRunId,
      responsibilityOperationId: acquisition.operationId,
      target,
      taskId: acquisition.taskId,
      taskWorkCapacity: TaskWorkCapacity.make(2)
    })
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
          intentRecordKey(graphOperation.operationId),
          taskTrackerReadIntent(graphOperation)
        )
        yield* journal.append(
          seededRunId,
          outcomeRecordKey(graphOperation.operationId),
          taskTrackerFactsObservedEvent(graphOperation.operationId, graphObservation)
        )
        yield* journal.append(
          seededRunId,
          taskWorkCapacityPolicyRecordKey(RunPolicyRevision.make(2)),
          TaskWorkCapacityChangedEvent.make({
            capacity: TaskWorkCapacity.make(7),
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            previousRevision: RunPolicyRevision.make(1),
            revision: RunPolicyRevision.make(2),
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          seededRunId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({
            operation: acquisitionOperation,
            version: workflowJournalEventVersion
          })
        )
      })
    )
    const first = yield* runRestartFixture(input)
    const second = yield* runRestartFixture(
      RestartFixtureInput.make({ ...input, label: "second-host-process", taskWorkCapacity: TaskWorkCapacity.make(7) })
    )
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
        selection: { _tag: "Recovered", runId: seededRunId }
      })
      expect(secondCompleted).toMatchObject({
        label: "second-host-process",
        selection: { _tag: "Recovered", runId: seededRunId }
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
      expect(records).toContainEqual(
        expect.objectContaining({
          event: expect.objectContaining({ _tag: "TaskWorkCapacityChanged", revision: 2, capacity: 7 })
        })
      )
    })
  )
)

it.effect("restarted production host reconstructs the active claim before its first GitHub task-claim read", () =>
  restartHostProcesses.pipe(
    Effect.map(({ first, input, second }) => {
      for (const events of [first, second]) {
        const reconstructed = eventsWithTag(events, "RecoveryReconstructed")[0]
        const selected = eventsWithTag(events, "TaskClaimCheckSelected")[0]
        const githubRead = eventsWithTag(events, "GithubReadStarted")[0]
        const reconstructionIndex = events.findIndex(({ _tag }) => _tag === "RecoveryReconstructed")
        const selectedIndex = events.findIndex(({ _tag }) => _tag === "TaskClaimCheckSelected")
        const githubReadIndex = events.findIndex(({ _tag }) => _tag === "GithubReadStarted")
        expect(events.map(({ _tag }) => _tag)).toEqual([
          "RestartChildStarted",
          "RecoveryReconstructed",
          "TaskClaimCheckSelected",
          "GithubReadStarted",
          "HostCompleted"
        ])
        expect(reconstructed).toMatchObject({
          acceptedPosition: 5,
          policy: { revision: 2, taskExecutionCapacity: 7 },
          responsibilities: [
            {
              _tag: "TaskClaimResponsibility",
              acquisition: {
                operationId: "production-restart-claim-acquisition",
                owner: "dalph:production-restart",
                taskId: input.taskId,
                token: "production-restart-token"
              },
              beganAt: 5,
              taskId: input.taskId
            }
          ],
          runId: input.runId
        })
        expect(selected).toEqual({
          _tag: "TaskClaimCheckSelected",
          operationId: input.responsibilityOperationId,
          taskId: input.taskId
        })
        if (selected === undefined) return
        expect(githubRead).toEqual(
          expect.objectContaining({
            _tag: "GithubReadStarted",
            operationId: selected.operationId,
            target: input.target
          })
        )
        expect(reconstructionIndex).toBeGreaterThanOrEqual(0)
        expect(reconstructionIndex).toBeLessThan(selectedIndex)
        expect(selectedIndex).toBeLessThan(githubReadIndex)
      }
    })
  )
)

interface UnsafeDiscoveryBoundaryCalls {
  readonly githubGraphqlRequests: number
  readonly gitCommandCalls: number
  readonly workflowGitCommandCalls: number
  readonly executorCalls: number
  readonly integratorOperations: number
  readonly evidenceWrites: number
  readonly journalMutations: number
  readonly boundaryAcquisitions: number
}

const noUnsafeDiscoveryBoundaryCalls: UnsafeDiscoveryBoundaryCalls = {
  githubGraphqlRequests: 0,
  gitCommandCalls: 0,
  workflowGitCommandCalls: 0,
  executorCalls: 0,
  integratorOperations: 0,
  evidenceWrites: 0,
  journalMutations: 0,
  boundaryAcquisitions: 0
}

const makeUnsafeDiscoveryGraph = (calls: Ref.Ref<UnsafeDiscoveryBoundaryCalls>) => {
  const count = (boundary: keyof UnsafeDiscoveryBoundaryCalls) =>
    Ref.update(calls, (current) => ({ ...current, [boundary]: current[boundary] + 1 }))
  const boundaryFailure = (boundary: Exclude<keyof UnsafeDiscoveryBoundaryCalls, "boundaryAcquisitions">) =>
    count(boundary).pipe(Effect.andThen(Effect.die(`unsafe discovery crossed ${boundary}`)))
  const githubClient = GithubGraphqlClient.of({ execute: () => boundaryFailure("githubGraphqlRequests") })
  const app = CodexAppServer.of({
    incarnation: CodexServerIncarnation.make("production-unsafe-discovery-incarnation"),
    startThread: () => boundaryFailure("executorCalls"),
    readThread: () => boundaryFailure("executorCalls"),
    resumeThread: () => boundaryFailure("executorCalls"),
    startTurn: () => boundaryFailure("executorCalls"),
    interruptTurn: () => boundaryFailure("executorCalls"),
    listBackgroundTerminals: () => boundaryFailure("executorCalls"),
    terminateBackgroundTerminal: () => boundaryFailure("executorCalls"),
    close: boundaryFailure("executorCalls")
  })
  const boundaryObserver = (boundary: ProductionRepositoryHostBoundary) => {
    switch (boundary) {
      case "journal.sqlite.open":
        // Discovery may open the real SQLite journal before rejecting unsafe history.
        return count("boundaryAcquisitions")
      case "evidence.acquire":
        // Unsafe discovery must fail before the Run graph builds its real evidence store.
        return count("boundaryAcquisitions")
      case "evidence.put":
        // Count only a real production EvidenceStore.put boundary, never layer acquisition.
        return boundaryFailure("evidenceWrites")
      case "git.acquire":
      case "git.run":
      case "git.runInWorktree":
      case "git.runBytesInWorktree":
        return boundaryFailure("gitCommandCalls")
      case "executor.acquire":
      case "executor.observe":
      case "executor.begin":
      case "executor.requestSuspension":
      case "executor.resume":
        return boundaryFailure("executorCalls")
      case "integrator.acquire":
      case "integrator.prepare":
        return boundaryFailure("integratorOperations")
      case "github.authority.acquire":
        return boundaryFailure("githubGraphqlRequests")
      case "coordinator.acquire":
        return Effect.void
    }
  }
  const productionGraph = productionRepositoryHostGraph({
    boundaryObserver,
    githubClient: () => Layer.effect(GithubGraphqlClient, count("boundaryAcquisitions").pipe(Effect.as(githubClient))),
    codexAppServer: () => Layer.effect(CodexAppServer, count("boundaryAcquisitions").pipe(Effect.as(app))),
    workflowGitCommandObserver: (operation) =>
      count("workflowGitCommandCalls").pipe(
        Effect.andThen(Effect.die(`unsafe discovery crossed workflow Git ${operation}`))
      )
  })
  const foundation = (configuration: ProductionRepositoryHostConfiguration) =>
    Layer.effectContext(
      Effect.gen(function* () {
        const context = yield* Effect.context<CoordinatorOwnership | JournalStore | RunLifecycleJournal>()
        const journal = Context.get(context, JournalStore)
        const lifecycle = Context.get(context, RunLifecycleJournal)
        const countJournalMutation = <A, E>(effect: Effect.Effect<A, E>) =>
          boundaryFailure("journalMutations").pipe(Effect.andThen(effect))
        const wrappedJournal = JournalStore.of({
          ...journal,
          append: (runId, key, event) => countJournalMutation(journal.append(runId, key, event)),
          beginRun: (runId, target, initialControlPolicy) =>
            countJournalMutation(journal.beginRun(runId, target, initialControlPolicy)),
          terminateRun: (runId, disposition, journalEvidence) =>
            countJournalMutation(journal.terminateRun(runId, disposition, journalEvidence)),
          retireTerminalRun: (runId) => countJournalMutation(journal.retireTerminalRun(runId))
        })
        const wrappedLifecycle = RunLifecycleJournal.of({
          ...lifecycle,
          beginRun: wrappedJournal.beginRun,
          terminateRun: wrappedJournal.terminateRun,
          retireTerminalRun: wrappedJournal.retireTerminalRun
        })
        return Context.add(Context.add(context, JournalStore, wrappedJournal), RunLifecycleJournal, wrappedLifecycle)
      })
    ).pipe(Layer.provide(productionGraph.foundation(configuration)))
  const graph = {
    ...productionGraph,
    foundation,
    run: (
      configuration: ProductionRepositoryHostConfiguration,
      selection: ProductionRunSelection,
      onFailure: (failure: unknown) => Effect.Effect<void>,
      applicationExit: ApplicationExitShellService<
        ApplicationExitResultReportLease<ApplicationExitPreFinalizationResult>
      >
    ) =>
      Layer.unwrap(
        Effect.gen(function* () {
          yield* count("boundaryAcquisitions")
          return productionGraph.run(configuration, selection, onFailure, applicationExit)
        })
      )
  }
  return graph
}

const assertNoProviderOrJournalStateChanges = (calls: UnsafeDiscoveryBoundaryCalls) => {
  expect({
    githubGraphqlRequests: calls.githubGraphqlRequests,
    gitCommandCalls: calls.gitCommandCalls,
    workflowGitCommandCalls: calls.workflowGitCommandCalls,
    executorCalls: calls.executorCalls,
    integratorOperations: calls.integratorOperations,
    evidenceWrites: calls.evidenceWrites,
    journalMutations: calls.journalMutations
  }).toEqual({
    githubGraphqlRequests: noUnsafeDiscoveryBoundaryCalls.githubGraphqlRequests,
    gitCommandCalls: noUnsafeDiscoveryBoundaryCalls.gitCommandCalls,
    workflowGitCommandCalls: noUnsafeDiscoveryBoundaryCalls.workflowGitCommandCalls,
    executorCalls: noUnsafeDiscoveryBoundaryCalls.executorCalls,
    integratorOperations: noUnsafeDiscoveryBoundaryCalls.integratorOperations,
    evidenceWrites: noUnsafeDiscoveryBoundaryCalls.evidenceWrites,
    journalMutations: noUnsafeDiscoveryBoundaryCalls.journalMutations
  })
  // Discovery must acquire only the SQLite journal adapter; no Run graph or provider adapter is built.
  expect(calls.boundaryAcquisitions).toBe(1)
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
  "two unfinished Runs fail before GitHub GraphQL requests, workflow Git commands, executor/Integrator Git commands, Codex executor calls, Integrator operations, evidence writes, or Journal mutations and name both identities",
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
        assertNoProviderOrJournalStateChanges(yield* Ref.get(calls))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
    )
)

it.effect(
  "mismatched unfinished history fails before GitHub GraphQL requests, workflow Git commands, executor/Integrator Git commands, Codex executor calls, Integrator operations, evidence writes, or Journal mutations",
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
        assertNoProviderOrJournalStateChanges(yield* Ref.get(calls))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
    )
)

it.effect(
  "malformed history fails before GitHub GraphQL requests, workflow Git commands, executor/Integrator Git commands, Codex executor calls, Integrator operations, evidence writes, or Journal mutations",
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
        assertNoProviderOrJournalStateChanges(yield* Ref.get(calls))
      }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.provide(NodeCrypto.layer))
    )
)

it.effect(
  "default production graph keeps one owner per mutation capability while H2 fails before every boundary and fresh H2 recovers",
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
        const adapters = {
          // This callback observes production layers and service methods; it cannot replace any of them.
          boundaryObserver: record,
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
          onFailure: (failure: unknown) => Effect.Effect<void>,
          applicationExit: ApplicationExitShellService<
            ApplicationExitResultReportLease<ApplicationExitPreFinalizationResult>
          >
        ) => productionGraph.run(configuration, selection, onFailure, applicationExit)
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
        // Only the network/process edges are replaceable in this fixture. The default graph owns every
        // workflow mutation capability, and the observer wraps those real services instead of installing fakes.
        for (const capability of [
          "journalStore",
          "gitCommand",
          "plannedAttemptExecutor",
          "integrator",
          "evidenceStore"
        ]) {
          expect(capability in adapters).toBe(false)
        }
        for (const event of [
          "coordinator.acquire",
          "journal.sqlite.open",
          "evidence.acquire",
          "git.acquire",
          "executor.acquire",
          "integrator.acquire",
          "github.authority.acquire",
          "github.acquire",
          "codex.acquire"
        ]) {
          expect(count(event), `${event}: ${JSON.stringify(afterFirst)}`).toBe(1)
        }
        expect(count("journal.scan")).toBeGreaterThan(0)
        expect(count("journal.begin")).toBe(1)
        expect(afterFirst.indexOf("journal.sqlite.open")).toBeLessThan(afterFirst.indexOf("journal.scan"))
        expect(afterFirst.indexOf("journal.scan")).toBeLessThan(afterFirst.indexOf("journal.begin"))
        expect(count("github.execute")).toBe(1)

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
        for (const event of [
          "coordinator.acquire",
          "journal.sqlite.open",
          "journal.scan",
          "journal.begin",
          "journal.append",
          "journal.retireTerminalRun",
          "journal.terminateRun",
          "evidence.acquire",
          "evidence.put",
          "git.acquire",
          "git.run",
          "git.runInWorktree",
          "git.runBytesInWorktree",
          "executor.acquire",
          "executor.observe",
          "executor.begin",
          "executor.requestSuspension",
          "executor.resume",
          "github.authority.acquire",
          "integrator.acquire",
          "integrator.prepare",
          "github.acquire",
          "github.execute",
          "codex.acquire",
          "codex.startThread",
          "codex.readThread",
          "codex.resumeThread",
          "codex.startTurn",
          "codex.interruptTurn",
          "codex.listBackgroundTerminals",
          "codex.terminateBackgroundTerminal",
          "codex.close"
        ]) {
          expect(count(event, duringSecond)).toBe(count(event, afterFirst))
        }
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
        for (const event of [
          "coordinator.acquire",
          "evidence.acquire",
          "git.acquire",
          "executor.acquire",
          "integrator.acquire",
          "github.authority.acquire",
          "github.acquire",
          "codex.acquire"
        ]) {
          expect(count(event, finalTrace)).toBe(2)
        }
        expect(count("journal.scan", finalTrace)).toBe(count("journal.scan") + 2)
        expect(count("journal.begin", finalTrace)).toBe(1)
        expect(finalTrace.indexOf("h2.lock-conflict")).toBeGreaterThan(finalTrace.indexOf("github.execute"))
        expect(finalTrace.lastIndexOf("journal.sqlite.open")).toBeGreaterThan(finalTrace.indexOf("h2.lock-conflict"))
      }).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeCrypto.layer))
    )
)
