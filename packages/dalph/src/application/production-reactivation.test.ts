import { NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  attemptPlanRecordKey,
  type ApplicationExitDrainFailure,
  ApplicationExitShell,
  defaultTaskWorkCapacity,
  DeliveryRuntimeObservationObserver,
  FixtureTarget,
  GitCommand,
  GitCommonDirectoryTarget,
  InitialControlPolicy,
  JournaledRunBootstrap,
  JournalDatabaseLocator,
  JournalPosition,
  type JournalRecord,
  JournalStore,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  OperationId,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  PlannedWorktreeReady,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  WorkflowRunAlreadyBegan,
  memoryJournalTestLayer,
  sqliteJournalTestLayer,
  intentRecordKey,
  outcomeRecordKey,
  makeCurrentSignal,
  PlannedTaskAttemptPlanner,
  RunFinalityDecision,
  type RunActivationOpportunityValue,
  RunReactivationHint,
  RunReactivationOwner,
  TaskClaimAcquisitionPlanner,
  TaskTrackerMutationThrottled,
  TaskClaimReadFailure,
  TaskWorkCapacity,
  TaskWorkCapacityControl,
  taskWorkCapacityControlLayer,
  TrackerGraphReader,
  TrackerReadError,
  TrackerRevision,
  TrackerMutation,
  UnclaimedTask,
  WorkflowTrace,
  unavailableIntegratorCandidateProviderAuthority,
  workflowJournalEventVersion,
  taskTrackerReadIntent,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  projectTrackerSnapshot,
  nodeGitCommandLayer,
  sqliteJournalStoreLayer,
  journalStoreCapabilities,
  JournalStorageUnavailable,
  type AcceptedRunReactivationObservers
} from "@dalph/orchestrator"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  makeTaskWorkSpecification,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorCommandFailure,
  type PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ConfigProvider,
  Context,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Path,
  Queue,
  Ref,
  Schema,
  Stream
} from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  productionRunReactivationLayer,
  productionWorkflowInterpreterLayer,
  ProductionRunReactivationInterval
} from "./production.js"
import { completedRunFinalityFixture } from "../../../orchestrator/test/run-finality.js"
import {
  taskTrackerGraphFactsObserved,
  taskTrackerWorkSpecificationFactsObserved
} from "../../../orchestrator/test/task-tracker-facts.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "../../test-support/controlled-synchronous-planned-attempt-executor.js"

type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T
type ProductionExecutorCapabilitiesAreMandatory = Assert<
  IsExactly<
    Layer.Success<Parameters<typeof productionWorkflowInterpreterLayer>[4]>,
    PlannedAttemptExecutor | PlannedAttemptExecutorLifecycleObservation
  >
>

const productionExecutorCapabilitiesAreMandatory: ProductionExecutorCapabilitiesAreMandatory = true
void productionExecutorCapabilitiesAreMandatory

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

/**
 * Scenario mapping: a production owner reports a retryable activation failure
 * through the ordinary observer, and reports a throttle there even when no
 * separate non-retryable observer was configured.
 */
it.effect("reports both recoverable and unhandled non-retryable production activation failures", () =>
  Effect.gen(function* () {
    const failures = [
      new Error("recoverable tracker read failure"),
      new TaskTrackerMutationThrottled({
        detail: "GitHub rejected the claim mutation",
        operation: "AcquireTaskClaim",
        operationId: OperationId.make("production-reactivation-unhandled-throttle"),
        retry: null
      })
    ] as const

    for (const failure of failures) {
      const observed = yield* Deferred.make<unknown>()
      // The generic bootstrap method preserves any caller program error. This
      // controlled mock instead injects the exact runtime value asserted below.
      const injectedFailure = Effect.fail(failure) as Effect.Effect<never>
      const applicationExit = ApplicationExitShell.of({
        admission: {
          prepareForwardOwner: () => Effect.succeed({ cancel: Effect.void, register: Effect.die("unused") }),
          acquireForwardOwner: () => Effect.die("unused"),
          snapshot: Effect.succeed({ cutoffClosed: false, preparingOwnerCount: 0, registeredOwnerCount: 0 })
        },
        awaitExitRequested: Effect.never,
        awaitExecutorDrains: Effect.void,
        registerExecutorDrain: () => Effect.void,
        registerProcessLocalDrain: () => Effect.void,
        requestBoundary: { requestExit: Effect.never }
      })
      const bootstrap = Layer.mock(JournaledRunBootstrap, {
        activate: () => injectedFailure,
        activateActiveWorkAuthorityRefresh: () => injectedFailure,
        readRunReactivationControl: () => Effect.succeed("RunUnpaused" as const),
        registerAcceptedRunReactivationObservers: () => Effect.void,
        operatorControl: {
          applyRunCancellation: () => Effect.die("unused"),
          applyIntegrationQuarantineDirection: () => Effect.die("unused"),
          applyAttemptChoice: () => Effect.die("unused"),
          applyControlDirection: () => Effect.die("unused"),
          applyTaskClaimReacquisition: () => Effect.die("unused"),
          readAttemptChoice: () => Effect.die("unused"),
          readIntegrationQuarantineDirection: () => Effect.die("unused"),
          readTaskWorkCapacity: () => Effect.die("unused"),
          observePause: () => Stream.empty,
          setTaskWorkCapacity: () => Effect.die("unused")
        }
      })
      const layer = productionRunReactivationLayer(
        FixtureTarget.make("production-reactivation-failure-target"),
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })),
        RunId.make("production-reactivation-failure-run"),
        { onFailure: (reported) => Deferred.succeed(observed, reported).pipe(Effect.asVoid) }
      ).pipe(
        Layer.provide(bootstrap),
        Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)),
        Layer.provide(Layer.mock(PlannedTaskAttemptPlanner, {})),
        Layer.provide(Layer.mock(TaskClaimAcquisitionPlanner, {}))
      )

      const reported = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* RunReactivationOwner
          return yield* Deferred.await(observed)
        }).pipe(Effect.provide(layer))
      )
      expect(reported).toBe(failure)
    }
  })
)

type CapturedProductionOpportunity =
  | { readonly _tag: "OrdinaryRunEntry" }
  | {
      readonly _tag: "ActiveWorkAuthorityRefresh"
      readonly source: "TrackerNotification" | "Timer"
      readonly subjects: ReadonlySet<{ readonly runId: RunId; readonly attemptId: AttemptId }>
    }

const captureProductionOpportunity = (opportunity: RunActivationOpportunityValue): CapturedProductionOpportunity =>
  opportunity._tag === "OrdinaryRunEntry"
    ? opportunity
    : {
        _tag: "ActiveWorkAuthorityRefresh",
        source: opportunity.source,
        subjects: new Set([...opportunity.subjects].map(({ attemptId, runId }) => ({ attemptId, runId })))
      }

it.effect("rejects a non-positive production reactivation interval at configuration decoding", () =>
  Effect.gen(function* () {
    const failure = yield* Schema.decodeUnknownEffect(ProductionRunReactivationInterval)("0 seconds").pipe(Effect.flip)
    expect(String(failure)).toContain("reactivation intervals must be finite and greater than zero")
  })
)

type TerminalOwnerBoundaryCalls = {
  readonly activation: number
  readonly executor: number
  readonly git: number
  readonly provider: number
  readonly tracker: number
}

const seedRetiredTerminal = Effect.fn("ProductionReactivationTest.seedRetiredTerminal")(function* (
  journal: JournalStore["Service"],
  runId: RunId,
  target: ReturnType<typeof FixtureTarget.make>
) {
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity }))
  const fixture = completedRunFinalityFixture({ runId, target })
  yield* journal.append(runId, intentRecordKey(fixture.operation.operationId), fixture.intent)
  yield* journal.append(runId, outcomeRecordKey(fixture.operation.operationId), fixture.observation)
  yield* journal.terminateRun(runId, "Completed", fixture.evidence)
  yield* journal.retireTerminalRun(runId)
})

const makeTerminalBootstrap = (
  journal: JournalStore["Service"],
  calls: Ref.Ref<TerminalOwnerBoundaryCalls>,
  journalReads: Ref.Ref<number>
) =>
  JournaledRunBootstrap.of({
    activate: () =>
      Ref.update(calls, (current) => ({
        ...current,
        activation: current.activation + 1,
        executor: current.executor + 1,
        git: current.git + 1,
        provider: current.provider + 1,
        tracker: current.tracker + 1
      })).pipe(Effect.andThen(Effect.die("terminal Run must never activate"))),
    activateActiveWorkAuthorityRefresh: () => Effect.die("terminal Run must never activate"),
    readRunReactivationControl: (_target, requestedRunId) =>
      Ref.update(journalReads, (current) => current + 1).pipe(
        Effect.andThen(journal.read(requestedRunId)),
        Effect.map((records) =>
          records.at(-1)?.event._tag === "WorkflowRunTerminated" ? "RunTerminated" : "RunUnpaused"
        )
      ),
    registerAcceptedRunReactivationObservers: (_observers) => Effect.void,
    operatorControl: {
      applyRunCancellation: () => Effect.die("unused"),
      applyIntegrationQuarantineDirection: () => Effect.die("unused"),
      applyAttemptChoice: () => Effect.die("unused"),
      applyControlDirection: () => Effect.die("unused"),
      applyTaskClaimReacquisition: () => Effect.die("unused"),
      readAttemptChoice: () => Effect.die("unused"),
      readIntegrationQuarantineDirection: () => Effect.die("unused"),
      readTaskWorkCapacity: () => Effect.die("unused"),
      observePause: () => Stream.empty,
      setTaskWorkCapacity: () => Effect.die("unused")
    }
  })

const runTerminalProductionOwner = Effect.fn("ProductionReactivationTest.runTerminalOwner")(function* (
  journal: JournalStore["Service"],
  runId: RunId,
  target: ReturnType<typeof FixtureTarget.make>
) {
  const calls = yield* Ref.make<TerminalOwnerBoundaryCalls>({
    activation: 0,
    executor: 0,
    git: 0,
    provider: 0,
    tracker: 0
  })
  const journalReads = yield* Ref.make(0)
  const timerStates = yield* Ref.make<ReadonlyArray<"Started" | "Stopped">>([])
  const bootstrap = makeTerminalBootstrap(journal, calls, journalReads)
  const applicationExit = ApplicationExitShell.of({
    admission: {
      prepareForwardOwner: () => Effect.succeed({ cancel: Effect.void, register: Effect.die("unused") }),
      acquireForwardOwner: () => Effect.die("unused"),
      snapshot: Effect.succeed({ cutoffClosed: false, preparingOwnerCount: 0, registeredOwnerCount: 0 })
    },
    awaitExitRequested: Effect.never,
    awaitExecutorDrains: Effect.void,
    registerExecutorDrain: () => Effect.void,
    registerProcessLocalDrain: () => Effect.void,
    requestBoundary: { requestExit: Effect.never }
  })
  const productionLayer = productionRunReactivationLayer(
    target,
    Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })),
    runId,
    {
      activationInterval: ProductionRunReactivationInterval.make(Duration.seconds(1)),
      failureCooldown: ProductionRunReactivationInterval.make(Duration.seconds(1)),
      onFailure: () => Effect.die("terminal history must not report a reactivation failure"),
      onTimerStateChange: (state) => Ref.update(timerStates, (current) => [...current, state])
    }
  ).pipe(
    Layer.provide(Layer.succeed(JournaledRunBootstrap, bootstrap)),
    Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)),
    Layer.provide(Layer.mock(PlannedTaskAttemptPlanner, {})),
    Layer.provide(Layer.mock(TaskClaimAcquisitionPlanner, {}))
  )

  yield* Effect.scoped(
    Effect.gen(function* () {
      const owner = yield* RunReactivationOwner
      yield* owner.hint(RunReactivationHint.Timer())
      yield* TestClock.adjust("1 hour")
    }).pipe(Effect.provide(productionLayer))
  )
  // This raw store assertion covers the lower-level RunId reuse guard; ordinary
  // establishment is covered by the JournaledRunBootstrap cold-history tests.
  const runIdReuse = yield* journal
    .beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity }))
    .pipe(Effect.flip)
  return {
    calls: yield* Ref.get(calls),
    journalReads: yield* Ref.get(journalReads),
    runIdReuse,
    timerStates: yield* Ref.get(timerStates)
  }
})

it.effect("keeps a cold terminal memory Run closed in production-shaped reactivation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(memoryJournalTestLayer)
      const journal = Context.get(context, JournalStore)
      const runId = RunId.make("production-cold-memory-run")
      const target = FixtureTarget.make("production-cold-memory-target")
      yield* seedRetiredTerminal(journal, runId, target)

      const result = yield* runTerminalProductionOwner(journal, runId, target)

      expect(result.runIdReuse).toBeInstanceOf(WorkflowRunAlreadyBegan)
      expect(result.journalReads).toBe(1)
      expect(result.timerStates).toEqual([])
      expect(result.calls).toEqual({ activation: 0, executor: 0, git: 0, provider: 0, tracker: 0 })
    })
  )
)

it.effect("keeps a reopened SQLite cold terminal Run closed in production-shaped reactivation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-cold-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const runId = RunId.make("production-cold-sqlite-run")
      const target = FixtureTarget.make("production-cold-sqlite-target")
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* seedRetiredTerminal(yield* JournalStore, runId, target)
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
      )
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(sqliteJournalTestLayer({ filename }))
          return yield* runTerminalProductionOwner(Context.get(context, JournalStore), runId, target)
        })
      )
      expect(result.runIdReuse).toBeInstanceOf(WorkflowRunAlreadyBegan)
      expect(result.journalReads).toBe(1)
      expect(result.timerStates).toEqual([])
      expect(result.calls).toEqual({ activation: 0, executor: 0, git: 0, provider: 0, tracker: 0 })
    }).pipe(Effect.provide(nodePathAndFileSystemLayer))
  )
)

it.effect("production composition wires current-first tracker notifications and fresh checks", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activations = yield* Ref.make(0)
      const firstActivation = yield* Deferred.make<void>()
      const secondActivation = yield* Deferred.make<void>()
      const thirdActivation = yield* Deferred.make<void>()
      const fourthActivation = yield* Deferred.make<void>()
      const trackerNotifications = yield* Queue.unbounded<void>()
      const trackerNotificationSource = makeCurrentSignal(
        Effect.succeed({ current: undefined, changes: Stream.fromQueue(trackerNotifications) })
      )
      const registeredDrains = yield* Ref.make<ReadonlyArray<Effect.Effect<void, ApplicationExitDrainFailure>>>([])
      const registeredObservers = yield* Ref.make<AcceptedRunReactivationObservers | undefined>(undefined)
      const bootstrapTrace = yield* Ref.make<ReadonlyArray<"journal-read" | "bootstrap-activate">>([])
      const opportunities = yield* Ref.make<ReadonlyArray<CapturedProductionOpportunity>>([])
      const bootstrap = JournaledRunBootstrap.of({
        activate: (_target, _policy, _runId, _program, opportunity) =>
          Ref.update(opportunities, (current) =>
            opportunity === undefined ? current : [...current, captureProductionOpportunity(opportunity)]
          ).pipe(
            Effect.andThen(Ref.update(bootstrapTrace, (current) => [...current, "bootstrap-activate" as const])),
            Effect.andThen(Ref.updateAndGet(activations, (current) => current + 1)),
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(firstActivation, undefined)
                : count === 2
                  ? Deferred.succeed(secondActivation, undefined)
                  : count === 3
                    ? Deferred.succeed(thirdActivation, undefined)
                    : Deferred.succeed(fourthActivation, undefined)
            ),
            Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          ),
        activateActiveWorkAuthorityRefresh: (_target, _policy, _runId, _program, source) =>
          Ref.update(opportunities, (current) => [
            ...current,
            {
              _tag: "ActiveWorkAuthorityRefresh" as const,
              source,
              subjects: new Set([
                {
                  runId: RunId.make("production-reactivation-run"),
                  attemptId: AttemptId.make("production-reactivation-attempt")
                }
              ])
            }
          ]).pipe(
            Effect.andThen(Ref.update(bootstrapTrace, (current) => [...current, "bootstrap-activate" as const])),
            Effect.andThen(Ref.updateAndGet(activations, (current) => current + 1)),
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(firstActivation, undefined)
                : count === 2
                  ? Deferred.succeed(secondActivation, undefined)
                  : count === 3
                    ? Deferred.succeed(thirdActivation, undefined)
                    : Deferred.succeed(fourthActivation, undefined)
            ),
            Effect.as(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          ),
        readRunReactivationControl: () =>
          Ref.update(bootstrapTrace, (current) => [...current, "journal-read" as const]).pipe(
            Effect.as("RunUnpaused" as const)
          ),
        registerAcceptedRunReactivationObservers: (observers) => Ref.set(registeredObservers, observers),
        operatorControl: {
          applyRunCancellation: () => Effect.die("unused"),
          applyIntegrationQuarantineDirection: () => Effect.die("unused"),
          applyAttemptChoice: () => Effect.die("unused"),
          applyControlDirection: () => Effect.die("unused"),
          applyTaskClaimReacquisition: () => Effect.die("unused"),
          readAttemptChoice: () => Effect.die("unused"),
          readIntegrationQuarantineDirection: () => Effect.die("unused"),
          readTaskWorkCapacity: () => Effect.die("unused"),
          observePause: () => Stream.empty,
          setTaskWorkCapacity: () => Effect.die("unused")
        }
      })
      const applicationExit = ApplicationExitShell.of({
        admission: {
          prepareForwardOwner: () => Effect.succeed({ cancel: Effect.void, register: Effect.die("unused") }),
          acquireForwardOwner: () => Effect.die("unused"),
          snapshot: Effect.succeed({ cutoffClosed: false, preparingOwnerCount: 0, registeredOwnerCount: 0 })
        },
        awaitExitRequested: Effect.never,
        awaitExecutorDrains: Effect.void,
        registerExecutorDrain: () => Effect.void,
        registerProcessLocalDrain: ({ closeProcessLocalResources }) =>
          Ref.update(registeredDrains, (drains) => [...drains, closeProcessLocalResources]),
        requestBoundary: { requestExit: Effect.never }
      })
      const productionLayer = productionRunReactivationLayer(
        FixtureTarget.make("production-reactivation-target"),
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })),
        RunId.make("production-reactivation-run"),
        {
          activationInterval: ProductionRunReactivationInterval.make(Duration.seconds(1)),
          failureCooldown: ProductionRunReactivationInterval.make(Duration.seconds(1)),
          onFailure: () => Effect.void,
          trackerNotificationSource
        }
      )
      const providedProductionLayer = productionLayer.pipe(
        Layer.provide(Layer.succeed(JournaledRunBootstrap, bootstrap)),
        Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)),
        Layer.provide(Layer.mock(PlannedTaskAttemptPlanner, {})),
        Layer.provide(Layer.mock(TaskClaimAcquisitionPlanner, {}))
      )
      const run = Effect.gen(function* () {
        const firstOwner = yield* RunReactivationOwner
        const secondOwner = yield* RunReactivationOwner
        expect(firstOwner).toBe(secondOwner)
        yield* Deferred.await(firstActivation)
        yield* Queue.offer(trackerNotifications, undefined)
        yield* Deferred.await(secondActivation)
        yield* TestClock.adjust("1 second")
        yield* Deferred.await(thirdActivation)
        expect(yield* Ref.get(activations)).toBe(3)
        expect(yield* Ref.get(bootstrapTrace)).toEqual([
          "journal-read",
          "bootstrap-activate",
          "bootstrap-activate",
          "bootstrap-activate"
        ])
        const observers = yield* Ref.get(registeredObservers)
        if (observers === undefined) return yield* Effect.die("production owner did not register its observers")
        yield* observers.acceptedFactPublication()
        yield* Deferred.await(fourthActivation)
        expect(yield* Ref.get(activations)).toBe(4)
        expect(yield* Ref.get(opportunities)).toEqual([
          {
            _tag: "ActiveWorkAuthorityRefresh",
            source: "TrackerNotification",
            subjects: new Set([
              {
                runId: RunId.make("production-reactivation-run"),
                attemptId: AttemptId.make("production-reactivation-attempt")
              }
            ])
          },
          {
            _tag: "ActiveWorkAuthorityRefresh",
            source: "TrackerNotification",
            subjects: new Set([
              {
                runId: RunId.make("production-reactivation-run"),
                attemptId: AttemptId.make("production-reactivation-attempt")
              }
            ])
          },
          {
            _tag: "ActiveWorkAuthorityRefresh",
            source: "Timer",
            subjects: new Set([
              {
                runId: RunId.make("production-reactivation-run"),
                attemptId: AttemptId.make("production-reactivation-attempt")
              }
            ])
          },
          { _tag: "OrdinaryRunEntry" }
        ])
        const [exitDrain] = yield* Ref.get(registeredDrains)
        if (exitDrain === undefined) return yield* Effect.die("production owner did not register its Exit drain")
        yield* exitDrain
        yield* Effect.yieldNow
        yield* TestClock.adjust("1 hour")
        expect(yield* Ref.get(activations)).toBe(4)
      }).pipe(Effect.provide(Layer.mergeAll(providedProductionLayer)))
      yield* run
    })
  )
)

type ProductionRefreshHarnessOptions = {
  readonly source?: "TrackerNotification" | "Timer" | "AcceptedFactPublication" | "OperatorWake"
  readonly report?: "Running" | "SafelySuspended" | "Terminal"
  readonly coalesce?: boolean
  readonly discoverFAndG?: boolean
  readonly editDuringActiveRead?: boolean
  readonly claim?: "Exact" | "Missing" | "Foreign" | "Unreadable"
  readonly specification?: "Exact" | "Changed"
  readonly laterSpecificationChange?: boolean
  readonly repeatAfterUncertainty?: boolean
  readonly changedTask?: "A" | "B"
  readonly threeExecuting?: boolean
  readonly capacityTwo?: boolean
  readonly executingTaskIds?: { readonly primary: TaskId; readonly independent: TaskId; readonly third: TaskId }
  readonly suspensionSubjectTaskId?: TaskId
  readonly includeFreshWaitingTaskE?: boolean
  readonly verifyNoSpontaneousActivation?: boolean
  readonly publishAfterActiveReturn?: boolean
  readonly suspensionSettlement?: "Safe" | "Terminal"
  readonly graph?:
    | "Readable"
    | "Unreadable"
    | "TaskCompleted"
    | "TaskClosedWithoutSuccess"
    | "MembershipLost"
    | "BlockerAdded"
  readonly git?: "Ready" | "LostWorktree" | "LineageRewrite" | "Unreadable"
  readonly includeIndependentTask?: boolean
  readonly crash?: ProductionRefreshCrash
}

type ProductionRefreshCrash =
  | "AfterConstraintBeforeSuspendIntent"
  | "AfterG2"
  | "AfterSuspendIntentBeforeProvider"
  | "SuspendResponseLost"

type ProductionRefreshFailpoint = {
  readonly tag: ProductionRefreshCrash
  readonly position: JournalRecord["position"] | undefined
}

const runProductionRefreshHarness = (options: ProductionRefreshHarnessOptions = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-refresh-healthy-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init", "--initial-branch=master"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "production active refresh\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())

      const source = options.source ?? "TrackerNotification"
      const coalesce = options.coalesce === true && source === "TrackerNotification"
      const claimMode = options.claim ?? "Exact"
      const specificationMode = options.specification ?? "Exact"
      const graphMode = options.graph ?? "Readable"
      const gitMode = options.git ?? "Ready"
      const threeExecuting = options.threeExecuting === true
      const seedCapacity = TaskWorkCapacity.make(threeExecuting ? 3 : 1)
      const configuredCapacity = TaskWorkCapacity.make(options.capacityTwo === true ? 2 : threeExecuting ? 3 : 1)
      const includeIndependentTask = options.includeIndependentTask === true || threeExecuting
      const changedTask = options.changedTask ?? "A"
      const target = FixtureTarget.make("production-refresh-healthy-target")
      const runId = RunId.make("production-refresh-healthy-run")
      const taskId = options.executingTaskIds?.primary ?? TaskId.make(options.discoverFAndG === true ? "B" : "A")
      const independentTaskId =
        options.executingTaskIds?.independent ?? TaskId.make(options.discoverFAndG === true ? "C" : "B")
      const thirdTaskId = options.executingTaskIds?.third ?? TaskId.make(options.discoverFAndG === true ? "D" : "C")
      const freshTaskId = TaskId.make("E")
      const blockerTaskId = TaskId.make("D")
      const constrainedTaskId = options.suspensionSubjectTaskId ?? (changedTask === "B" ? independentTaskId : taskId)
      const specification = makeTaskWorkSpecification({ body: "Complete A.", taskId, title: "Complete A" })
      const independentSpecification = makeTaskWorkSpecification({
        body: "Complete B.",
        taskId: independentTaskId,
        title: "Complete B"
      })
      const thirdSpecification = makeTaskWorkSpecification({
        body: "Complete C.",
        taskId: thirdTaskId,
        title: "Complete C"
      })
      const changedSpecification = makeTaskWorkSpecification({
        body: "Changed F2 instructions.",
        taskId,
        title: "Changed F2"
      })
      const changedIndependentSpecification = makeTaskWorkSpecification({
        body: "Changed F2 instructions.",
        taskId: independentTaskId,
        title: "Changed F2"
      })
      const graphTaskIds = [
        taskId,
        ...(includeIndependentTask ? [independentTaskId] : []),
        ...(threeExecuting ? [thirdTaskId] : []),
        ...(options.includeFreshWaitingTaskE === true ? [freshTaskId] : [])
      ]
      const activeGraphTasks = [
        ...graphTaskIds
          .filter((selectedTaskId) => graphMode !== "MembershipLost" || selectedTaskId !== constrainedTaskId)
          .map((selectedTaskId) => ({
            id: selectedTaskId,
            lifecycle:
              graphMode === "TaskCompleted" && selectedTaskId === constrainedTaskId
                ? ({ _tag: "CompletedSuccessfully" } as const)
                : graphMode === "TaskClosedWithoutSuccess" && selectedTaskId === constrainedTaskId
                  ? ({ _tag: "TerminalWithoutSuccess" } as const)
                  : ({ _tag: "Open" } as const),
            parentTaskId: null,
            prerequisiteIds: graphMode === "BlockerAdded" && selectedTaskId === constrainedTaskId ? [blockerTaskId] : []
          })),
        ...(graphMode === "BlockerAdded"
          ? [{ id: blockerTaskId, lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] }]
          : [])
      ]
      const projected = projectTrackerSnapshot({
        revision: "production-refresh-healthy-graph",
        rootTaskId: graphMode === "MembershipLost" && constrainedTaskId === taskId ? independentTaskId : taskId,
        tasks: activeGraphTasks
      })
      if (projected._tag === "Invalid") return yield* Effect.die("healthy production graph must be valid")
      const snapshot = projected.snapshot
      const expanded = projectTrackerSnapshot({
        revision: "G5",
        rootTaskId: taskId,
        tasks: [
          ...activeGraphTasks,
          ...["F", "G"].map((id) => ({
            id: TaskId.make(id),
            lifecycle: { _tag: "Open" },
            parentTaskId: null,
            prerequisiteIds: []
          }))
        ]
      })
      if (expanded._tag === "Invalid") return yield* Effect.die("invalid expanded production graph")
      const independentBaseSha =
        gitMode === "LineageRewrite" && constrainedTaskId === independentTaskId
          ? GitCommitSha.make(
              (yield* git.runInWorktree(directory, [
                "commit-tree",
                (yield* git.runInWorktree(directory, ["rev-parse", `${baseSha}^{tree}`])).stdout.trim(),
                "-m",
                "unrelated B base"
              ])).stdout.trim()
            )
          : baseSha
      const attempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-refresh-healthy-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-refresh-healthy"),
        executor: TaskExecutorLocator.make("executor:production-refresh-healthy"),
        runId,
        taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      const independentAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-refresh-independent-attempt"),
        baseSha: independentBaseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-refresh-independent"),
        executor: TaskExecutorLocator.make("executor:production-refresh-independent"),
        runId,
        taskId: independentTaskId,
        taskRevision: independentSpecification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/independent-worktree`)
      })
      const thirdAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-refresh-third-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-refresh-third"),
        executor: TaskExecutorLocator.make("executor:production-refresh-third"),
        runId,
        taskId: thirdTaskId,
        taskRevision: thirdSpecification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/third-worktree`)
      })
      const targetRef =
        gitMode === "LineageRewrite" && constrainedTaskId === taskId
          ? IntegrationTargetRef.make("refs/heads/rewritten-target")
          : IntegrationTargetRef.make("refs/heads/master")
      if (gitMode === "LineageRewrite" && constrainedTaskId === taskId) {
        const treeSha = (yield* git.runInWorktree(directory, ["rev-parse", `${baseSha}^{tree}`])).stdout.trim()
        const rewrittenSha = (yield* git.runInWorktree(directory, [
          "commit-tree",
          treeSha,
          "-m",
          "rewritten target"
        ])).stdout.trim()
        yield* git.runInWorktree(directory, ["update-ref", targetRef, rewrittenSha])
      }
      const integrationTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make(
          gitMode === "Unreadable" ? `${directory}/missing.git` : `${directory}/.git`
        ),
        ref: targetRef
      })
      yield* git.runInWorktree(directory, [
        "worktree",
        "add",
        "-b",
        attempt.branch.slice("refs/heads/".length),
        attempt.worktree,
        attempt.baseSha
      ])
      if (includeIndependentTask) {
        yield* git.runInWorktree(directory, [
          "worktree",
          "add",
          "-b",
          independentAttempt.branch.slice("refs/heads/".length),
          independentAttempt.worktree,
          independentAttempt.baseSha
        ])
      }
      if (threeExecuting) {
        yield* git.runInWorktree(directory, [
          "worktree",
          "add",
          "-b",
          thirdAttempt.branch.slice("refs/heads/".length),
          thirdAttempt.worktree,
          thirdAttempt.baseSha
        ])
      }
      if (gitMode === "LostWorktree") {
        yield* git.runInWorktree(directory, [
          "worktree",
          "remove",
          "--force",
          constrainedTaskId === independentTaskId ? independentAttempt.worktree : attempt.worktree
        ])
      }
      const journalFilename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const seedJournalLayer = sqliteJournalTestLayer({ filename: journalFilename })
      const acquisition = {
        operationId: OperationId.make("production-refresh-healthy-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("production-refresh-healthy-token")
      }
      const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
      const graphOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("production-refresh-healthy-graph"),
        target,
        [acquisition.operationId],
        graphTaskIds
      )
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("production-refresh-healthy-specification"),
        target,
        taskId,
        [graphOperation.operationId]
      )
      const planOperation = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("production-refresh-healthy-plan"),
        plannedAttempt: attempt,
        predecessorOperationIds: [specificationOperation.operationId]
      })
      const worktreeOperation = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("production-refresh-healthy-worktree"),
        plannedAttempt: attempt,
        predecessorOperationIds: [planOperation.operationId]
      })
      const claim = ActiveTaskClaim.make(acquisition)
      const independentAcquisition = {
        operationId: OperationId.make("production-refresh-independent-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: independentTaskId,
        token: ClaimToken.make("production-refresh-independent-token")
      }
      const thirdAcquisition = {
        operationId: OperationId.make("production-refresh-third-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: thirdTaskId,
        token: ClaimToken.make("production-refresh-third-token")
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: seedCapacity }))
          yield* journal.append(
            runId,
            intentRecordKey(acquisition.operationId),
            TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(acquisition.operationId),
            TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            intentRecordKey(graphOperation.operationId),
            taskTrackerReadIntent(graphOperation)
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(graphOperation.operationId),
            taskTrackerGraphFactsObserved(graphOperation, {
              revision: TrackerRevision.make("production-refresh-healthy-seed"),
              taskIds: graphTaskIds
            })
          )
          yield* journal.append(
            runId,
            intentRecordKey(specificationOperation.operationId),
            taskTrackerReadIntent(specificationOperation)
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(specificationOperation.operationId),
            taskTrackerWorkSpecificationFactsObserved(specificationOperation, specification)
          )
          yield* journal.append(
            runId,
            attemptPlanRecordKey(attempt.attemptId),
            TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            intentRecordKey(worktreeOperation.operationId),
            TaskWorktreeReconciliationIntendedEvent.make({
              operation: worktreeOperation,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(worktreeOperation.operationId),
            TaskWorktreeReadyEvent.make({
              operationId: worktreeOperation.operationId,
              proof: PlannedWorktreeReady.make({
                baseSha: attempt.baseSha,
                branch: attempt.branch,
                headSha: attempt.baseSha,
                worktree: attempt.worktree
              }),
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
            PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
              plannedAttempt: attempt,
              version: workflowJournalEventVersion
            })
          )
          const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
          yield* journal.append(
            runId,
            plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, commandOrdinal),
            PlannedAttemptExecutorCommandIntendedEvent.make({
              command: "Begin",
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              ordinal: commandOrdinal,
              plannedAttempt: attempt,
              version: workflowJournalEventVersion
            })
          )
          const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: plannedAttemptExecutorCorrelation(attempt)
          })
          yield* journal.append(
            runId,
            plannedAttemptExecutorCommandResponseObservedRecordKey(attempt.attemptId, commandOrdinal),
            PlannedAttemptExecutorCommandResponseObservedEvent.make({
              commandOrdinal,
              occurrenceClassification: "NonActionOccurrence",
              plannedAttempt: attempt,
              report: executingReport,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, PlannedAttemptExecutorReportOrdinal.make(1)),
            PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
              report: executingReport,
              version: workflowJournalEventVersion
            })
          )
          const seedExecutingPeer = Effect.fn("ProductionRefreshTest.seedExecutingPeer")(function* (
            peerAttempt: PlannedTaskAttempt,
            peerAcquisition: typeof independentAcquisition,
            peerSpecification: typeof independentSpecification
          ) {
            const peerClaimOperation = makeTaskClaimAcquisitionOperation({
              acquisition: peerAcquisition,
              predecessorOperationIds: []
            })
            const peerGraphOperation = makeTrackerGraphObservationOperation(
              { _tag: "WorkflowEstablishment" },
              OperationId.make(`production-refresh-${peerAttempt.taskId}-graph`),
              target,
              [peerAcquisition.operationId],
              graphTaskIds
            )
            const peerSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
              OperationId.make(`production-refresh-${peerAttempt.taskId}-specification`),
              target,
              peerAttempt.taskId,
              [peerGraphOperation.operationId]
            )
            const peerPlanOperation = makeTaskAttemptPlanOperation({
              operationId: OperationId.make(`production-refresh-${peerAttempt.taskId}-plan`),
              plannedAttempt: peerAttempt,
              predecessorOperationIds: [peerSpecificationOperation.operationId]
            })
            const peerWorktreeOperation = makeTaskWorktreeReconciliationOperation({
              operationId: OperationId.make(`production-refresh-${peerAttempt.taskId}-worktree`),
              plannedAttempt: peerAttempt,
              predecessorOperationIds: [peerPlanOperation.operationId]
            })
            yield* journal.append(
              runId,
              intentRecordKey(peerAcquisition.operationId),
              TaskClaimAcquisitionIntendedEvent.make({
                operation: peerClaimOperation,
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              outcomeRecordKey(peerAcquisition.operationId),
              TaskClaimAcquiredEvent.make({
                claim: ActiveTaskClaim.make(peerAcquisition),
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              intentRecordKey(peerGraphOperation.operationId),
              taskTrackerReadIntent(peerGraphOperation)
            )
            yield* journal.append(
              runId,
              outcomeRecordKey(peerGraphOperation.operationId),
              taskTrackerGraphFactsObserved(peerGraphOperation, {
                revision: TrackerRevision.make(`production-refresh-${peerAttempt.taskId}-seed`),
                taskIds: graphTaskIds
              })
            )
            yield* journal.append(
              runId,
              intentRecordKey(peerSpecificationOperation.operationId),
              taskTrackerReadIntent(peerSpecificationOperation)
            )
            yield* journal.append(
              runId,
              outcomeRecordKey(peerSpecificationOperation.operationId),
              taskTrackerWorkSpecificationFactsObserved(peerSpecificationOperation, peerSpecification)
            )
            yield* journal.append(
              runId,
              attemptPlanRecordKey(peerAttempt.attemptId),
              TaskAttemptPlannedEvent.make({ operation: peerPlanOperation, version: workflowJournalEventVersion })
            )
            yield* journal.append(
              runId,
              intentRecordKey(peerWorktreeOperation.operationId),
              TaskWorktreeReconciliationIntendedEvent.make({
                operation: peerWorktreeOperation,
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              outcomeRecordKey(peerWorktreeOperation.operationId),
              TaskWorktreeReadyEvent.make({
                operationId: peerWorktreeOperation.operationId,
                proof: PlannedWorktreeReady.make({
                  baseSha: peerAttempt.baseSha,
                  branch: peerAttempt.branch,
                  headSha: peerAttempt.baseSha,
                  worktree: peerAttempt.worktree
                }),
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              plannedAttemptExecutorWorkResponsibilityBeganRecordKey(peerAttempt.attemptId),
              PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
                plannedAttempt: peerAttempt,
                version: workflowJournalEventVersion
              })
            )
            const peerCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
            yield* journal.append(
              runId,
              plannedAttemptExecutorCommandIntendedRecordKey(peerAttempt.attemptId, peerCommandOrdinal),
              PlannedAttemptExecutorCommandIntendedEvent.make({
                command: "Begin",
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                ordinal: peerCommandOrdinal,
                plannedAttempt: peerAttempt,
                version: workflowJournalEventVersion
              })
            )
            const peerExecuting = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
              correlation: plannedAttemptExecutorCorrelation(peerAttempt)
            })
            yield* journal.append(
              runId,
              plannedAttemptExecutorCommandResponseObservedRecordKey(peerAttempt.attemptId, peerCommandOrdinal),
              PlannedAttemptExecutorCommandResponseObservedEvent.make({
                commandOrdinal: peerCommandOrdinal,
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt: peerAttempt,
                report: peerExecuting,
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              plannedAttemptExecutorWorkReportedRecordKey(
                peerAttempt.attemptId,
                PlannedAttemptExecutorReportOrdinal.make(1)
              ),
              PlannedAttemptExecutorWorkReportedEvent.make({
                ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
                report: peerExecuting,
                version: workflowJournalEventVersion
              })
            )
          })
          if (threeExecuting) {
            yield* seedExecutingPeer(independentAttempt, independentAcquisition, independentSpecification)
            yield* seedExecutingPeer(thirdAttempt, thirdAcquisition, thirdSpecification)
          }
          if (options.capacityTwo === true) {
            const capacityControl = yield* TaskWorkCapacityControl
            const current = yield* capacityControl.read(runId)
            yield* capacityControl.apply({ capacity: configuredCapacity, expectedRevision: current.revision, runId })
          }
          if (options.report !== undefined && options.report !== "Running") {
            const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
            yield* journal.append(
              runId,
              plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, commandOrdinal),
              PlannedAttemptExecutorCommandIntendedEvent.make({
                command: "Suspend",
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                ordinal: commandOrdinal,
                plannedAttempt: attempt,
                version: workflowJournalEventVersion
              })
            )
            const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
            const report =
              options.report === "SafelySuspended"
                ? PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
                    correlation: plannedAttemptExecutorCorrelation(attempt)
                  })
                : PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                    correlation: plannedAttemptExecutorCorrelation(attempt),
                    result: { _tag: "Completed" }
                  })
            yield* journal.append(
              runId,
              plannedAttemptExecutorCommandResponseObservedRecordKey(attempt.attemptId, commandOrdinal),
              PlannedAttemptExecutorCommandResponseObservedEvent.make({
                commandOrdinal,
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt: attempt,
                report,
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, reportOrdinal),
              PlannedAttemptExecutorWorkReportedEvent.make({
                ordinal: reportOrdinal,
                report,
                version: workflowJournalEventVersion
              })
            )
          }
        }).pipe(
          Effect.provide(
            Layer.merge(seedJournalLayer, taskWorkCapacityControlLayer.pipe(Layer.provide(seedJournalLayer)))
          )
        )
      )
      type ProductionExecutorCall = {
        readonly command: "observe" | "Begin" | "Resume" | "Suspend"
        readonly taskId: TaskId
      }
      const foreignClaim = ActiveTaskClaim.make({
        operationId: OperationId.make("production-refresh-foreign-claim"),
        owner: ClaimOwner.make("another-dalph"),
        taskId: constrainedTaskId,
        token: ClaimToken.make("production-refresh-foreign-token")
      })
      const exactConstrainedClaim =
        constrainedTaskId === independentTaskId ? ActiveTaskClaim.make(independentAcquisition) : claim
      const claimObservation =
        claimMode === "Missing"
          ? UnclaimedTask.make({ taskId: constrainedTaskId })
          : claimMode === "Foreign"
            ? foreignClaim
            : exactConstrainedClaim
      const acquiredClaims = yield* Ref.make<ReadonlyMap<TaskId, ActiveTaskClaim>>(
        threeExecuting
          ? new Map([
              [independentTaskId, ActiveTaskClaim.make(independentAcquisition)],
              [thirdTaskId, ActiveTaskClaim.make(thirdAcquisition)]
            ])
          : new Map()
      )
      const phase = yield* Ref.make<"Startup" | "Active">("Startup")
      const currentSpecificationMode = yield* Ref.make<"Exact" | "Changed">(
        options.laterSpecificationChange === true ? "Exact" : specificationMode
      )
      const trackerCalls = yield* Ref.make<ReadonlyArray<"graph" | "specification" | "claim" | "acquire">>([])
      const graphReadsInFlight = yield* Ref.make(0)
      const maximumGraphReadsInFlight = yield* Ref.make(0)
      const activeSelections = yield* Ref.make<ReadonlyArray<string>>([])
      const activeSelectionTrace = yield* Ref.make<ReadonlyArray<string>>([])
      const activeSelectionOperationKeys = yield* Ref.make<ReadonlyArray<string>>([])
      const executorCalls = yield* Ref.make<ReadonlyArray<ProductionExecutorCall>>([])
      const executorEntries = yield* Ref.make<ReadonlyArray<ProductionExecutorCall>>([])
      const suspendedTasks = yield* Ref.make<ReadonlySet<TaskId>>(new Set())
      const activationKinds = yield* Ref.make<ReadonlyArray<"OrdinaryRunEntry" | "ActiveWorkAuthorityRefresh">>([])
      const activeSources = yield* Ref.make<ReadonlyArray<"TrackerNotification" | "Timer">>([])
      const activeActivationCount = yield* Ref.make(0)
      const activeActivationTimeline = yield* Ref.make<ReadonlyArray<"Start" | "Return">>([])
      const activeConcurrent = yield* Ref.make(0)
      const maximumActiveConcurrent = yield* Ref.make(0)
      const taskWorkSnapshots = yield* Ref.make<ReadonlyArray<ReadonlyArray<TaskId>>>([])
      const beforeExplicitExitCounts = yield* Ref.make<
        ReadonlyArray<{ readonly processEnds: number; readonly requests: number }>
      >([])
      const beforeSecondOpportunity = yield* Ref.make<
        | {
            readonly activeActivationCount: number
            readonly activeSelectionOperationKeys: ReadonlyArray<string>
            readonly executorCalls: ReadonlyArray<ProductionExecutorCall>
            readonly trackerCalls: ReadonlyArray<"graph" | "specification" | "claim" | "acquire">
          }
        | undefined
      >(undefined)
      const latestJournalPosition = yield* Ref.make<JournalRecord["position"] | undefined>(undefined)
      const failpoint = yield* Ref.make<ProductionRefreshFailpoint | undefined>(undefined)
      const failpointConsumed = yield* Ref.make(false)
      const activeReadStarted = yield* Deferred.make<void>()
      const releaseActiveRead = yield* Deferred.make<void>()
      const firstActiveSettled = yield* Deferred.make<void>()
      const secondActiveSettled = yield* Deferred.make<void>()
      const expectedActiveSelections = [
        "ReadTrackerGraph",
        "ReadTaskWorkSpecification",
        "ReadTaskClaim",
        "ReadTaskWorktree",
        "ReadTargetLineage"
      ]

      const recordActiveSelection = (tag: string) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(phase)) !== "Active" || !expectedActiveSelections.includes(tag)) return
          yield* Ref.update(activeSelectionTrace, (current) => [...current, tag])
          yield* Ref.update(activeSelections, (current) => (current.includes(tag) ? current : [...current, tag]))
        })

      const recordActiveSelectionOperation = (tag: string, operationId: string) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(phase)) !== "Active" || !expectedActiveSelections.includes(tag)) return
          yield* recordActiveSelection(tag)
          yield* Ref.update(activeSelectionOperationKeys, (current) => [...current, `${tag}:${operationId}`])
        })

      const readJournal = () =>
        Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            return yield* journal.read(runId)
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: journalFilename })))
        )

      const runProcess = (processNumber: number) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* Ref.set(phase, "Startup")
            const processCrash = processNumber === 1 ? options.crash : undefined
            const ordinaryActivationCount = yield* Ref.make(0)
            const registeredObservers = yield* Ref.make<AcceptedRunReactivationObservers | undefined>(undefined)
            const trackerMutation = TrackerMutation.of({
              acquireTaskClaim: (requested) =>
                Ref.update(trackerCalls, (calls) => [...calls, "acquire" as const]).pipe(
                  Effect.andThen(
                    Ref.update(acquiredClaims, (current) =>
                      new Map(current).set(requested.taskId, ActiveTaskClaim.make(requested))
                    )
                  ),
                  Effect.andThen(Effect.succeed(ActiveTaskClaim.make(requested)))
                ),
              readTaskClaim: (selectedTaskId) =>
                Ref.update(trackerCalls, (calls) => [...calls, "claim" as const]).pipe(
                  Effect.andThen(
                    selectedTaskId === constrainedTaskId && claimMode === "Unreadable"
                      ? Effect.fail(new TaskClaimReadFailure({ detail: "claim unreadable", taskId: selectedTaskId }))
                      : selectedTaskId === constrainedTaskId
                        ? Effect.succeed(claimObservation)
                        : selectedTaskId === taskId
                          ? Effect.succeed(claim)
                          : Effect.map(
                              Ref.get(acquiredClaims),
                              (current) => current.get(selectedTaskId) ?? UnclaimedTask.make({ taskId: selectedTaskId })
                            )
                  )
                ),
              releaseTaskClaim: () => Effect.void
            })
            const trackerGraphReader = TrackerGraphReader.of({
              read: () =>
                Effect.acquireUseRelease(
                  Ref.updateAndGet(graphReadsInFlight, (count) => count + 1).pipe(
                    Effect.tap((count) => Ref.update(maximumGraphReadsInFlight, (maximum) => Math.max(maximum, count)))
                  ),
                  () =>
                    Ref.update(trackerCalls, (calls) => [...calls, "graph" as const]).pipe(
                      Effect.andThen(
                        graphMode === "Unreadable"
                          ? Effect.fail(
                              new TrackerReadError({
                                operation: "TrackerGraphReader.parse",
                                detail: "graph unreadable"
                              })
                            )
                          : Effect.gen(function* () {
                              if (
                                coalesce &&
                                options.editDuringActiveRead !== true &&
                                (yield* Ref.get(phase)) === "Active"
                              ) {
                                yield* Deferred.succeed(activeReadStarted, undefined)
                                yield* Deferred.await(releaseActiveRead)
                              }
                              return options.discoverFAndG === true ? expanded.snapshot : snapshot
                            })
                      )
                    ),
                  () => Ref.update(graphReadsInFlight, (count) => count - 1)
                ),
              readTaskWorkSpecification: (_target, selectedTaskId) =>
                Effect.gen(function* () {
                  yield* Ref.update(trackerCalls, (calls) => [...calls, "specification" as const])
                  const selectedSpecificationMode = yield* Ref.get(currentSpecificationMode)
                  if (
                    coalesce &&
                    options.editDuringActiveRead === true &&
                    selectedTaskId === constrainedTaskId &&
                    (yield* Ref.get(phase)) === "Active" &&
                    (yield* Ref.get(activeActivationCount)) === 1
                  ) {
                    yield* Deferred.succeed(activeReadStarted, undefined)
                    yield* Deferred.await(releaseActiveRead)
                  }
                  return selectedTaskId === taskId
                    ? selectedSpecificationMode === "Changed" && constrainedTaskId === taskId
                      ? changedSpecification
                      : specification
                    : selectedTaskId === independentTaskId
                      ? selectedSpecificationMode === "Changed" && constrainedTaskId === independentTaskId
                        ? changedIndependentSpecification
                        : independentSpecification
                      : thirdSpecification
                })
            })
            const runStartedCommand = (command: "Begin" | "Resume", request: PlannedAttemptExecutorRequest) =>
              Effect.gen(function* () {
                const call = { command, taskId: request.plannedAttempt.taskId }
                yield* Ref.update(executorEntries, (calls) => [...calls, call])
                yield* Ref.update(executorCalls, (calls) => [...calls, call])
                return request.plannedAttempt.taskId === independentTaskId
                  ? PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                      correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
                      result: { _tag: "Completed" }
                    })
                  : PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                      correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
                    })
              })
            const executor = PlannedAttemptExecutor.of({
              observe: (correlation) =>
                Effect.gen(function* () {
                  const projectedTaskId =
                    correlation.attemptId === attempt.attemptId
                      ? taskId
                      : correlation.attemptId === independentAttempt.attemptId
                        ? independentTaskId
                        : thirdTaskId
                  const call = { command: "observe" as const, taskId: projectedTaskId }
                  yield* Ref.update(executorEntries, (calls) => [...calls, call])
                  yield* Ref.update(executorCalls, (calls) => [...calls, call])
                  const suspended = (yield* Ref.get(suspendedTasks)).has(projectedTaskId)
                  return PlannedAttemptExecutorProjection.cases.Exact.make({
                    report: suspended
                      ? PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
                      : PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
                  })
                }),
              requestSuspension: (requested) =>
                Effect.gen(function* () {
                  const selectedSpecificationMode = yield* Ref.get(currentSpecificationMode)
                  const constrained =
                    claimMode !== "Exact" ||
                    selectedSpecificationMode === "Changed" ||
                    graphMode === "TaskCompleted" ||
                    graphMode === "TaskClosedWithoutSuccess" ||
                    graphMode === "MembershipLost" ||
                    graphMode === "BlockerAdded" ||
                    gitMode === "LostWorktree" ||
                    gitMode === "LineageRewrite"
                  if (!constrained) return yield* Effect.die("healthy refresh must not suspend executor work")
                  const call = { command: "Suspend" as const, taskId: requested.taskId }
                  yield* Ref.update(executorEntries, (calls) => [...calls, call])
                  if (processCrash === "AfterSuspendIntentBeforeProvider") {
                    const consume = yield* Ref.modify(failpointConsumed, (current) => [!current, true] as const)
                    if (consume) {
                      yield* Ref.set(failpoint, { tag: processCrash, position: yield* Ref.get(latestJournalPosition) })
                      return yield* new PlannedAttemptExecutorCommandFailure({
                        command: "Suspend",
                        correlation: plannedAttemptExecutorCorrelation(requested),
                        detail: "test crash before executor provider call"
                      })
                    }
                  }
                  yield* Ref.update(executorCalls, (calls) => [...calls, call])
                  yield* Ref.update(suspendedTasks, (current) => new Set([...current, requested.taskId]))
                  return options.suspensionSettlement === "Terminal"
                    ? PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                        correlation: plannedAttemptExecutorCorrelation(requested),
                        result: { _tag: "Completed" }
                      })
                    : PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
                        correlation: plannedAttemptExecutorCorrelation(requested)
                      })
                }),
              begin: (request) => runStartedCommand("Begin", request),
              resume: (request) => runStartedCommand("Resume", request)
            })
            const trace = WorkflowTrace.of({
              emit: (item) =>
                item._tag === "OperationSelected"
                  ? recordActiveSelectionOperation(
                      item.operation._tag,
                      "operationId" in item.operation
                        ? item.operation.operationId
                        : item.operation._tag === "ReleaseTaskClaim"
                          ? item.operation.release.operationId
                          : item.operation.acquisition.operationId
                    )
                  : Effect.void
            })
            const journalStoreLayer =
              processCrash === undefined
                ? undefined
                : journalStoreCapabilities(
                    Layer.effect(
                      JournalStore,
                      Effect.gen(function* () {
                        const journal = yield* JournalStore
                        const append: JournalStore["Service"]["append"] = (requestedRunId, key, event) =>
                          Effect.gen(function* () {
                            if (
                              processCrash === "AfterG2" &&
                              event._tag === "TaskTrackerFactsObserved" &&
                              event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed" &&
                              (yield* Ref.get(phase)) === "Active"
                            ) {
                              const beforeAppend = yield* journal.read(requestedRunId)
                              const suspensionIsAccepted = beforeAppend.some(
                                ({ event: recorded }) =>
                                  recorded._tag === "PlannedAttemptExecutorWorkReported" &&
                                  recorded.report._tag === "ExecutorWorkSafelySuspended" &&
                                  recorded.report.correlation.attemptId === independentAttempt.attemptId
                              )
                              if (suspensionIsAccepted) {
                                const consume = yield* Ref.modify(
                                  failpointConsumed,
                                  (current) => [!current, true] as const
                                )
                                if (consume) {
                                  const record = yield* journal.append(requestedRunId, key, event)
                                  yield* Ref.set(latestJournalPosition, record.position)
                                  yield* Ref.set(failpoint, { tag: processCrash, position: record.position })
                                  return yield* new JournalStorageUnavailable({
                                    operation: "JournalStore.append",
                                    detail: "test process cut after durable G2"
                                  })
                                }
                              }
                            }
                            const shouldFail =
                              (processCrash === "AfterConstraintBeforeSuspendIntent" &&
                                event._tag === "PlannedAttemptExecutorCommandIntended" &&
                                event.command === "Suspend" &&
                                event.plannedAttempt.attemptId === attempt.attemptId) ||
                              (processCrash === "SuspendResponseLost" &&
                                event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
                                event.report._tag === "ExecutorWorkSafelySuspended" &&
                                event.plannedAttempt.attemptId === attempt.attemptId)
                            if (shouldFail) {
                              const consume = yield* Ref.modify(
                                failpointConsumed,
                                (current) => [!current, true] as const
                              )
                              if (consume) {
                                const records = yield* journal.read(requestedRunId)
                                const position = records.at(-1)?.position
                                yield* Ref.set(latestJournalPosition, position)
                                yield* Ref.set(failpoint, { tag: processCrash, position })
                                return yield* new JournalStorageUnavailable({
                                  operation: "JournalStore.append",
                                  detail: `test crash at ${processCrash}`
                                })
                              }
                            }
                            const record = yield* journal.append(requestedRunId, key, event)
                            yield* Ref.set(latestJournalPosition, record.position)
                            return record
                          })
                        return JournalStore.of({ ...journal, append })
                      })
                    ).pipe(Layer.provide(sqliteJournalStoreLayer({ filename: journalFilename })))
                  )
            const applicationExitRequests = yield* Ref.make(0)
            const applicationProcessEnds = yield* Ref.make(0)
            const applicationExitEvents = yield* Ref.make<ReadonlyArray<string>>([])
            const observeApplicationExit = source === "TrackerNotification"
            const runtimeBoundaries = {
              ...(journalStoreLayer === undefined ? {} : { journalStoreLayer }),
              applicationExit: observeApplicationExit
                ? {
                    _tag: "ConstructOrdinaryShell" as const,
                    processEndObserver: () => Ref.update(applicationProcessEnds, (count) => count + 1),
                    requestObserver: () => Ref.update(applicationExitRequests, (count) => count + 1),
                    traceObserver: (event: { readonly _tag: string }) =>
                      Ref.update(applicationExitEvents, (current) => [...current, event._tag])
                  }
                : { _tag: "ConstructOrdinaryShell" as const }
            }
            const runtimeObservation = DeliveryRuntimeObservationObserver.of({
              observe: (observation) =>
                Ref.update(taskWorkSnapshots, (current) => [
                  ...current,
                  observation.evaluation.taskWork.held.map(({ taskId }) => taskId).toSorted()
                ])
            })
            const application = productionWorkflowInterpreterLayer(
              runId,
              GitCommonDirectoryTarget.make(`${directory}/.git`),
              integrationTarget,
              Layer.succeed(TrackerMutation, trackerMutation),
              controlledSynchronousPlannedAttemptExecutorLayer(Layer.succeed(PlannedAttemptExecutor, executor)),
              unavailableIntegratorCandidateProviderAuthority,
              runtimeBoundaries
            ).pipe(
              Layer.provide(Layer.succeed(TrackerGraphReader, trackerGraphReader)),
              Layer.provide(Layer.succeed(WorkflowTrace, trace)),
              Layer.provide(Layer.succeed(DeliveryRuntimeObservationObserver, runtimeObservation))
            )
            const applicationContext = yield* Layer.build(application).pipe(
              Effect.provide(nodePathAndFileSystemLayer),
              Effect.provide(nodeGitCommandLayer),
              Effect.provide(NodeServices.layer),
              Effect.provide(
                ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: journalFilename }))
              )
            )
            const startupActivation = yield* Deferred.make<void>()
            const acceptedActivation = yield* Deferred.make<void>()
            const activeActivation = yield* Deferred.make<"Success" | "Failure">()
            const activeDecisions = yield* Ref.make<ReadonlyArray<RunFinalityDecision>>([])
            const settleActiveActivation = Effect.gen(function* () {
              yield* Ref.update(activeActivationTimeline, (current) => [...current, "Return" as const])
              yield* Ref.update(activeConcurrent, (count) => count - 1)
              const completed = yield* Ref.get(activeActivationCount)
              yield* Deferred.succeed(completed === 1 ? firstActiveSettled : secondActiveSettled, undefined)
            })
            const applicationBootstrap = Context.get(applicationContext, JournaledRunBootstrap)
            const wrappedBootstrap = JournaledRunBootstrap.of({
              ...applicationBootstrap,
              registerAcceptedRunReactivationObservers: (observers) =>
                Ref.set(registeredObservers, observers).pipe(
                  Effect.andThen(applicationBootstrap.registerAcceptedRunReactivationObservers(observers))
                ),
              activate: (target, initialControlPolicySource, allocatedRunId, program, opportunity) => {
                const activationOpportunity: RunActivationOpportunityValue = opportunity ?? { _tag: "OrdinaryRunEntry" }
                const activationTag =
                  activationOpportunity._tag === "ActiveWorkAuthorityRefresh"
                    ? ("ActiveWorkAuthorityRefresh" as const)
                    : ("OrdinaryRunEntry" as const)
                const recordActivation = Ref.update(activationKinds, (current) => [...current, activationTag])
                return activationOpportunity._tag === "OrdinaryRunEntry"
                  ? recordActivation.pipe(
                      Effect.andThen(
                        Ref.modify(ordinaryActivationCount, (count) => {
                          const next = count + 1
                          return [next, next] as const
                        })
                      ),
                      Effect.tap((count) =>
                        count === 1
                          ? Deferred.succeed(startupActivation, undefined)
                          : count === 2
                            ? Effect.gen(function* () {
                                if (options.publishAfterActiveReturn === true) {
                                  expect(yield* Ref.get(activeConcurrent)).toBe(0)
                                }
                                yield* Deferred.succeed(acceptedActivation, undefined)
                              })
                            : Effect.void
                      ),
                      Effect.andThen(
                        Effect.succeed(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
                      )
                    )
                  : Effect.gen(function* () {
                      yield* recordActivation
                      yield* Ref.update(activeSources, (sources) => [...sources, activationOpportunity.source])
                      yield* Ref.update(activeActivationTimeline, (current) => [...current, "Start" as const])
                      yield* Ref.update(activeActivationCount, (count) => count + 1)
                      const concurrent = yield* Ref.updateAndGet(activeConcurrent, (count) => count + 1)
                      yield* Ref.update(maximumActiveConcurrent, (maximum) => Math.max(maximum, concurrent))
                      return yield* applicationBootstrap
                        .activate(target, initialControlPolicySource, allocatedRunId, program, activationOpportunity)
                        .pipe(
                          Effect.tap((decision) =>
                            Ref.update(activeDecisions, (current) => [...current, decision]).pipe(
                              Effect.andThen(Deferred.succeed(activeActivation, "Success"))
                            )
                          ),
                          Effect.tapError(() => Deferred.succeed(activeActivation, "Failure")),
                          Effect.ensuring(settleActiveActivation)
                        )
                    })
              },
              activateActiveWorkAuthorityRefresh: (
                target,
                initialControlPolicySource,
                allocatedRunId,
                program,
                source
              ) => {
                const recordActivation = Ref.update(activationKinds, (current) => [
                  ...current,
                  "ActiveWorkAuthorityRefresh" as const
                ])
                const observedProgram = (opportunity: RunActivationOpportunityValue) =>
                  Effect.gen(function* () {
                    yield* recordActivation
                    yield* Ref.update(activeSources, (sources) => [...sources, source])
                    yield* Ref.update(activeActivationTimeline, (current) => [...current, "Start" as const])
                    yield* Ref.update(activeActivationCount, (count) => count + 1)
                    const concurrent = yield* Ref.updateAndGet(activeConcurrent, (count) => count + 1)
                    yield* Ref.update(maximumActiveConcurrent, (maximum) => Math.max(maximum, concurrent))
                    return yield* program(opportunity)
                  })
                return applicationBootstrap
                  .activateActiveWorkAuthorityRefresh(
                    target,
                    initialControlPolicySource,
                    allocatedRunId,
                    observedProgram,
                    source
                  )
                  .pipe(
                    Effect.tap(() =>
                      options.publishAfterActiveReturn === true
                        ? Effect.gen(function* () {
                            // The production runtime has returned, so its bounded
                            // publication-freshness cut is necessarily complete.
                            // A later accepted-publication notice belongs to the
                            // owner's next activation, not the finished runtime.
                            const observers = yield* Ref.get(registeredObservers)
                            if (observers === undefined) return yield* Effect.die("owner observers are missing")
                            yield* observers.acceptedFactPublication()
                            yield* observers.acceptedFactPublication()
                          })
                        : Effect.void
                    ),
                    Effect.tap((decision) =>
                      Ref.update(activeDecisions, (current) => [...current, decision]).pipe(
                        Effect.andThen(Deferred.succeed(activeActivation, "Success"))
                      )
                    ),
                    Effect.tapError(() => Deferred.succeed(activeActivation, "Failure")),
                    Effect.ensuring(settleActiveActivation)
                  )
              }
            })
            const applicationExit = Context.get(applicationContext, ApplicationExitShell)
            const ownerLayer = productionRunReactivationLayer(
              target,
              Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: configuredCapacity })),
              runId,
              {
                activationInterval: ProductionRunReactivationInterval.make(
                  source === "Timer" ? Duration.seconds(1) : Duration.hours(1)
                ),
                failureCooldown: ProductionRunReactivationInterval.make(Duration.seconds(1)),
                onFailure: () => Effect.void
              }
            ).pipe(
              Layer.provide(Layer.succeed(JournaledRunBootstrap, wrappedBootstrap)),
              Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)),
              Layer.provide(
                Layer.succeed(
                  TaskClaimAcquisitionPlanner,
                  TaskClaimAcquisitionPlanner.of({
                    plan: (operationId, selectedTaskId) =>
                      Effect.succeed({
                        operationId,
                        owner: ClaimOwner.make("dalph"),
                        taskId: selectedTaskId,
                        token: ClaimToken.make("production-refresh-healthy-token")
                      })
                  })
                )
              ),
              Layer.provide(
                Layer.succeed(
                  PlannedTaskAttemptPlanner,
                  PlannedTaskAttemptPlanner.of({
                    plan: (request) =>
                      Effect.succeed(
                        request.specification.taskId === taskId
                          ? attempt
                          : request.specification.taskId === independentTaskId
                            ? independentAttempt
                            : thirdAttempt
                      )
                  })
                )
              )
            )
            yield* Effect.gen(function* () {
              const owner = yield* RunReactivationOwner
              yield* Effect.yieldNow
              yield* Deferred.await(startupActivation)
              if (source === "AcceptedFactPublication") {
                const observers = yield* Ref.get(registeredObservers)
                if (observers === undefined) return yield* Effect.die("production owner did not register its observers")
                yield* observers.acceptedFactPublication()
                yield* Deferred.await(acceptedActivation)
              } else if (source === "OperatorWake") {
                yield* owner.hint(RunReactivationHint.OperatorWake())
                yield* Deferred.await(acceptedActivation)
              } else if (coalesce) {
                yield* Ref.set(phase, "Active")
                yield* owner.hint(RunReactivationHint.TrackerNotification())
                yield* Deferred.await(activeReadStarted)
                if (options.editDuringActiveRead === true) {
                  yield* Ref.set(currentSpecificationMode, "Changed")
                }
                const observers = yield* Ref.get(registeredObservers)
                if (observers === undefined) return yield* Effect.die("production owner did not register its observers")
                yield* observers.acceptedFactPublication()
                yield* owner.hint(RunReactivationHint.Timer())
                yield* owner.hint(RunReactivationHint.TrackerNotification())
                yield* owner.hint(RunReactivationHint.Timer())
                yield* Deferred.succeed(releaseActiveRead, undefined)
                yield* Effect.raceFirst(Deferred.await(secondActiveSettled), Deferred.await(acceptedActivation))
                if (options.verifyNoSpontaneousActivation === true) {
                  const settledCount = yield* Ref.get(activeActivationCount)
                  yield* TestClock.adjust("30 minutes")
                  yield* Effect.yieldNow
                  expect(yield* Ref.get(activeActivationCount)).toBe(settledCount)
                }
              } else {
                yield* Ref.set(phase, "Active")
                if (source === "Timer") {
                  yield* TestClock.adjust("1 second")
                } else {
                  yield* owner.hint(RunReactivationHint.TrackerNotification())
                }
                yield* Deferred.await(activeActivation)
                yield* Deferred.await(firstActiveSettled)
                if (options.publishAfterActiveReturn === true) {
                  yield* Deferred.await(acceptedActivation)
                  yield* TestClock.adjust("30 minutes")
                  yield* Effect.yieldNow
                  expect(yield* Ref.get(ordinaryActivationCount)).toBe(2)
                  expect(yield* Ref.get(activeActivationCount)).toBe(1)
                }
                if (options.laterSpecificationChange === true || options.repeatAfterUncertainty === true) {
                  if (options.laterSpecificationChange === true) {
                    yield* Ref.set(currentSpecificationMode, "Changed")
                    yield* TestClock.adjust("30 minutes")
                  } else {
                    yield* TestClock.adjust("1 second")
                  }
                  yield* Ref.set(beforeSecondOpportunity, {
                    activeActivationCount: yield* Ref.get(activeActivationCount),
                    activeSelectionOperationKeys: yield* Ref.get(activeSelectionOperationKeys),
                    executorCalls: yield* Ref.get(executorCalls),
                    trackerCalls: yield* Ref.get(trackerCalls)
                  })
                  yield* owner.hint(RunReactivationHint.TrackerNotification())
                  yield* Deferred.await(secondActiveSettled)
                }
              }
            }).pipe(
              Effect.provide(ownerLayer),
              Effect.provide(
                ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: journalFilename }))
              )
            )
            const requestsBeforeExplicitExit = yield* Ref.get(applicationExitRequests)
            const processEndsBeforeExplicitExit = yield* Ref.get(applicationProcessEnds)
            yield* Ref.update(beforeExplicitExitCounts, (current) => [
              ...current,
              { processEnds: processEndsBeforeExplicitExit, requests: requestsBeforeExplicitExit }
            ])
            const applicationExitResult = yield* applicationExit.requestBoundary.requestExit
            const expectedApplicationExitResult =
              processCrash === "AfterConstraintBeforeSuspendIntent" ||
              processCrash === "SuspendResponseLost" ||
              processCrash === "AfterG2"
                ? "Failed"
                : "Succeeded"
            expect(applicationExitResult._tag).toBe(expectedApplicationExitResult)
            expect(yield* Ref.get(applicationExitRequests)).toBe(observeApplicationExit ? 1 : 0)
            expect(yield* Ref.get(applicationProcessEnds)).toBe(observeApplicationExit ? 1 : 0)
            if (observeApplicationExit) {
              expect(yield* Ref.get(applicationExitEvents)).toContain("ExitResultReported")
            } else {
              expect(yield* Ref.get(applicationExitEvents)).toEqual([])
            }
            return {
              activeActivation:
                source === "AcceptedFactPublication" || source === "OperatorWake"
                  ? undefined
                  : yield* Deferred.await(activeActivation),
              activeDecisions: yield* Ref.get(activeDecisions)
            }
          }).pipe(
            Effect.provide(nodePathAndFileSystemLayer),
            Effect.provide(nodeGitCommandLayer),
            Effect.provide(NodeServices.layer)
          )
        )

      const firstProcess = yield* runProcess(1)
      const firstJournalRecords = options.crash === undefined ? undefined : yield* readJournal()
      const secondProcess = options.crash === undefined ? undefined : yield* runProcess(2)
      const journalRecords = yield* readJournal()
      return {
        activeActivation:
          source === "AcceptedFactPublication" || source === "OperatorWake"
            ? undefined
            : (secondProcess?.activeActivation ?? firstProcess.activeActivation),
        activeDecision: secondProcess?.activeDecisions.at(-1) ?? firstProcess.activeDecisions.at(-1),
        activeDecisions: [...firstProcess.activeDecisions, ...(secondProcess?.activeDecisions ?? [])],
        activationKinds: yield* Ref.get(activationKinds),
        activeSelectionOperationKeys: yield* Ref.get(activeSelectionOperationKeys),
        activeSelectionTrace: yield* Ref.get(activeSelectionTrace),
        activeSelections: yield* Ref.get(activeSelections),
        activeSources: yield* Ref.get(activeSources),
        activeActivationCount: yield* Ref.get(activeActivationCount),
        activeActivationTimeline: yield* Ref.get(activeActivationTimeline),
        beforeSecondOpportunity: yield* Ref.get(beforeSecondOpportunity),
        beforeExplicitExitCounts: yield* Ref.get(beforeExplicitExitCounts),
        maximumActiveConcurrent: yield* Ref.get(maximumActiveConcurrent),
        maximumGraphReadsInFlight: yield* Ref.get(maximumGraphReadsInFlight),
        executorCalls: yield* Ref.get(executorCalls),
        executorEntries: yield* Ref.get(executorEntries),
        failpoint: yield* Ref.get(failpoint),
        firstJournalRecords,
        graphTaskIds: snapshot.taskIds(),
        journalRecords,
        taskWorkSnapshots: yield* Ref.get(taskWorkSnapshots),
        trackerCalls: yield* Ref.get(trackerCalls)
      }
    }).pipe(
      Effect.provide(nodePathAndFileSystemLayer),
      Effect.provide(nodeGitCommandLayer),
      Effect.provide(NodeServices.layer)
    )
  )

const expectOneSuspensionAfterObservation = (
  records: ReadonlyArray<JournalRecord>,
  observation: (event: JournalRecord["event"]) => boolean,
  constrainedTaskId: TaskId,
  constrainedAttemptId: AttemptId,
  unaffectedTaskIds: ReadonlyArray<TaskId>
) => {
  const observations = records.filter(({ event }) => observation(event))
  const suspendIntents = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "Suspend" &&
      event.plannedAttempt.taskId === constrainedTaskId
  )
  const safelySuspendedReports = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report._tag === "ExecutorWorkSafelySuspended" &&
      event.report.correlation.attemptId === constrainedAttemptId
  )
  expect(observations.length).toBeGreaterThan(0)
  expect(suspendIntents).toHaveLength(1)
  expect(safelySuspendedReports).toHaveLength(1)
  const observationPosition = observations.at(-1)?.position
  const suspendPosition = suspendIntents[0]?.position
  const safelySuspendedPosition = safelySuspendedReports[0]?.position
  if (observationPosition === undefined || suspendPosition === undefined || safelySuspendedPosition === undefined) {
    return expect.fail("missing active-refresh observation or suspension settlement")
  }
  expect(observationPosition < suspendPosition).toBe(true)
  expect(suspendPosition < safelySuspendedPosition).toBe(true)
  expect(
    records.some(
      ({ event, position }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        unaffectedTaskIds.includes(event.plannedAttempt.taskId) &&
        position > observationPosition &&
        position < safelySuspendedPosition
    )
  ).toBe(false)
}

const expectRunningResponsibilityRemains = (records: ReadonlyArray<JournalRecord>) => {
  expect(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "ExecutorWorkExecuting" &&
        event.report.correlation.attemptId === "production-refresh-healthy-attempt"
    )
  ).toHaveLength(1)
  expect(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "ExecutorWorkSafelySuspended" &&
        event.report.correlation.attemptId === "production-refresh-healthy-attempt"
    )
  ).toHaveLength(0)
}

it.effect(
  "unchanged active-work refresh calls each ordinary provider once records reconfirmation and does not loop",
  () =>
    Effect.gen(function* () {
      const result = yield* runProductionRefreshHarness()
      expect(result.activeSelections).toEqual([
        "ReadTrackerGraph",
        "ReadTaskWorkSpecification",
        "ReadTaskClaim",
        "ReadTaskWorktree",
        "ReadTargetLineage"
      ])
      const activeGitSelectionKeys = result.activeSelectionOperationKeys.filter(
        (key) => key.startsWith("ReadTaskWorktree:") || key.startsWith("ReadTargetLineage:")
      )
      expect(activeGitSelectionKeys).toHaveLength(2)
      expect(new Set(activeGitSelectionKeys).size).toBe(2)
      expect(result.journalRecords.filter(({ event }) => event._tag === "PlannedAttemptWorktreeObserved")).toHaveLength(
        1
      )
      expect(result.journalRecords.filter(({ event }) => event._tag === "TargetLineageObserved")).toHaveLength(1)
      expect(result.trackerCalls).toEqual(["graph", "specification", "claim", "graph"])
      expect(result.executorCalls).toEqual([])
      expect(result.activationKinds).toEqual(["OrdinaryRunEntry", "ActiveWorkAuthorityRefresh"])
      expect(result.activeActivationCount).toBe(1)
      expect(result.graphTaskIds).toEqual(["A"])
      const activeGraphIntents = result.journalRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
      )
      expect(activeGraphIntents).toHaveLength(1)
      expect(
        result.journalRecords.some(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
        )
      ).toBe(true)
      expect(result.journalRecords.some(({ event }) => event._tag === "WorkflowRunBegan")).toBe(true)
    })
)

it.effect(
  "lost or pre-subscription tracker notification is recovered by the ordinary timer and executes an active authority read",
  () =>
    Effect.gen(function* () {
      const result = yield* runProductionRefreshHarness({ source: "Timer" })
      expect(result.activeSources).toEqual(["Timer"])
      expect(result.activeActivationCount).toBe(1)
      expect(result.activeSelections).toEqual([
        "ReadTrackerGraph",
        "ReadTaskWorkSpecification",
        "ReadTaskClaim",
        "ReadTaskWorktree",
        "ReadTargetLineage"
      ])
      expect(result.trackerCalls).toEqual(["graph", "specification", "claim", "graph"])
      expect(result.executorCalls).toEqual([])
    })
)

it.effect("a later tracker edit waits for the next independent notification or timer", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({ laterSpecificationChange: true })
    const beforeSecond = result.beforeSecondOpportunity
    expect(beforeSecond).toBeDefined()
    if (beforeSecond === undefined) return yield* Effect.die("missing post-edit independent-opportunity cut")
    expect(beforeSecond.activeActivationCount).toBe(1)
    expect(beforeSecond.executorCalls).toEqual([])
    expect(result.activeActivationCount).toBe(2)
    expect(result.activeSources).toEqual(["TrackerNotification", "TrackerNotification"])
    expect(result.executorCalls).toEqual([{ command: "Suspend", taskId: "A" }])
    expect(
      result.journalRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
          event.observation.factFamily.body === "Changed F2 instructions."
      )
    ).toHaveLength(1)
  })
)

const completeAuthorityConstraintCases: ReadonlyArray<{
  readonly name: string
  readonly observation: (event: JournalRecord["event"]) => boolean
  readonly options: ProductionRefreshHarnessOptions
}> = [
  {
    name: "changed instructions",
    observation: (event) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === "B" &&
      event.observation.factFamily.body === "Changed F2 instructions.",
    options: { specification: "Changed" }
  },
  {
    name: "completed lifecycle",
    observation: (event) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "CompleteTaskTrackerFacts" &&
      event.observation.factFamilies.some(
        (family) =>
          family._tag === "TaskLifecycles" &&
          family.lifecycles.some(
            ({ lifecycle, taskId }) => taskId === "B" && lifecycle._tag === "CompletedSuccessfully"
          )
      ),
    options: { graph: "TaskCompleted" }
  },
  {
    name: "target-membership loss",
    observation: (event) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "CompleteTaskTrackerFacts" &&
      event.observation.factFamilies.some(
        (family) => family._tag === "TaskTargetMembership" && !family.memberTaskIds.includes(TaskId.make("B"))
      ),
    options: { graph: "MembershipLost" }
  },
  {
    name: "new unfinished blocker",
    observation: (event) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "CompleteTaskTrackerFacts" &&
      event.observation.factFamilies.some(
        (family) =>
          family._tag === "TaskPrerequisites" &&
          family.prerequisites.some(
            ({ prerequisiteTaskIds, taskId }) => taskId === "B" && prerequisiteTaskIds.includes(TaskId.make("D"))
          )
      ),
    options: { graph: "BlockerAdded" }
  },
  {
    name: "missing exact claim",
    observation: (event) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskClaimFacts" &&
      event.observation.observation._tag === "UnclaimedTask",
    options: { claim: "Missing" }
  },
  {
    name: "foreign exact claim",
    observation: (event) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskClaimFacts" &&
      event.observation.observation._tag === "ActiveTaskClaim" &&
      event.observation.observation.owner === "another-dalph",
    options: { claim: "Foreign" }
  },
  {
    name: "lost planned worktree",
    observation: (event) =>
      event._tag === "PlannedAttemptWorktreeObserved" && event.observation._tag !== "PlannedWorktreeReady",
    options: { git: "LostWorktree" }
  },
  {
    name: "incompatible target lineage",
    observation: (event) =>
      event._tag === "TargetLineageObserved" && !event.observation.plannedBaseIsAncestorOfTargetHead,
    options: { git: "LineageRewrite" }
  }
]

it.effect.each(completeAuthorityConstraintCases)(
  "complete authoritative constraints including a missing or foreign exact claim suspend only their affected attempt: $name",
  (constraint) =>
    Effect.gen(function* () {
      const result = yield* runProductionRefreshHarness({
        ...constraint.options,
        changedTask: "B",
        source: "Timer",
        threeExecuting: true
      })
      expect(result.executorCalls).toEqual([{ command: "Suspend", taskId: "B" }])
      expect(result.executorCalls.filter(({ taskId }) => taskId === "A" || taskId === "C")).toEqual([])
      expectOneSuspensionAfterObservation(
        result.journalRecords,
        constraint.observation,
        TaskId.make("B"),
        AttemptId.make("production-refresh-independent-attempt"),
        [TaskId.make("A"), TaskId.make("C")]
      )
    })
)

it.effect("accepted B F2 refresh suspends only B1 while A1 and C1 continue executing", () =>
  Effect.gen(function* () {
    for (const suspensionSettlement of ["Safe", "Terminal"] as const) {
      const result = yield* runProductionRefreshHarness({
        source: "Timer",
        specification: "Changed",
        changedTask: "B",
        threeExecuting: true,
        suspensionSettlement
      })
      expect(result.graphTaskIds).toEqual(["A", "B", "C"])
      expect(result.executorCalls.filter(({ command }) => command !== "observe")).toEqual([
        { command: "Suspend", taskId: "B" }
      ])
      expect(result.executorCalls.filter(({ taskId }) => taskId === "A" || taskId === "C")).toEqual([])
      const activeGraph = result.journalRecords.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
      )
      expect(activeGraph).toBeDefined()
      const activeGraphPosition = activeGraph?.position ?? JournalPosition.make(0)
      const focused = result.journalRecords.filter(
        ({ event, position }) =>
          position > activeGraphPosition &&
          event._tag === "TaskTrackerFactsObserved" &&
          (event.observation._tag === "FocusedTaskWorkSpecificationFacts" ||
            event.observation._tag === "FocusedTaskClaimFacts")
      )
      for (const selectedTaskId of ["A", "B", "C"]) {
        expect(
          focused.filter(({ event }) =>
            event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
              ? event.observation.factFamily.taskId === selectedTaskId
              : false
          )
        ).toHaveLength(1)
        if (selectedTaskId !== "B") {
          expect(
            focused.filter(({ event }) =>
              event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
                ? event.observation.coverage.taskId === selectedTaskId
                : false
            )
          ).toHaveLength(1)
        }
      }
      const activeGitSelections = result.activeSelectionOperationKeys.filter(
        (key) => key.startsWith("ReadTaskWorktree:") || key.startsWith("ReadTargetLineage:")
      )
      expect(activeGitSelections).toHaveLength(4)
      expect(new Set(activeGitSelections).size).toBe(4)
      const changed = focused.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
          event.observation.factFamily.taskId === "B" &&
          event.observation.factFamily.body === "Changed F2 instructions."
      )
      const suspend = result.journalRecords.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Suspend" &&
          event.plannedAttempt.taskId === "B"
      )
      const settlement = result.journalRecords.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === "production-refresh-independent-attempt" &&
          event.report._tag ===
            (suspensionSettlement === "Safe" ? "ExecutorWorkSafelySuspended" : "ExecutorWorkTerminal")
      )
      expect(changed?.position).toBeDefined()
      expect(suspend?.position).toBeDefined()
      expect(settlement?.position).toBeDefined()
      if (changed === undefined || suspend === undefined || settlement === undefined) {
        return yield* Effect.die("missing B F2 suspension chronology")
      }
      expect(changed.position < suspend.position).toBe(true)
      expect(suspend.position < settlement.position).toBe(true)
      expect(
        result.taskWorkSnapshots.some(
          (held) => held.length === 3 && held[0] === "A" && held[1] === "B" && held[2] === "C"
        )
      ).toBe(true)
      expect(result.taskWorkSnapshots.at(-1)).toEqual(["A", "C"])
    }
  })
)

it.effect(
  "incomplete unavailable unreadable malformed or identity-contradictory active-work reads authorize no executor action",
  () =>
    Effect.gen(function* () {
      // The normalized production graph boundary exposes one TrackerReadError for
      // unavailable, unreadable, malformed, or throttled provider input; it
      // cannot return an incomplete snapshot. The focused claim and Git
      // boundaries retain their own typed unreadable/unsettled evidence.
      for (const uncertainty of [
        { name: "normalized tracker graph read failure", options: { graph: "Unreadable" } },
        { name: "focused claim unreadable after its bounded reads", options: { claim: "Unreadable" } },
        { name: "ordinary Git read failure with an unsettled intent", options: { git: "Unreadable" } }
      ] as const) {
        const result = yield* runProductionRefreshHarness({
          ...uncertainty.options,
          source: "TrackerNotification",
          repeatAfterUncertainty: true
        })
        const beforeSecond = result.beforeSecondOpportunity
        expect(beforeSecond, uncertainty.name).toBeDefined()
        if (beforeSecond === undefined)
          return yield* Effect.die(`missing independent-opportunity cut for ${uncertainty.name}`)
        expect(beforeSecond.activeActivationCount, uncertainty.name).toBe(1)
        expect(beforeSecond.executorCalls, uncertainty.name).toEqual([])
        expect(result.activeActivationCount, uncertainty.name).toBe(2)
        expect(result.activeSources, uncertainty.name).toEqual(["TrackerNotification", "TrackerNotification"])
        expect(result.maximumActiveConcurrent, uncertainty.name).toBe(1)
        expect(result.executorCalls, uncertainty.name).toEqual([])
        expect(result.trackerCalls.length, uncertainty.name).toBeGreaterThan(beforeSecond.trackerCalls.length)
        expect(result.activeSelectionOperationKeys.length, uncertainty.name).toBeGreaterThan(
          beforeSecond.activeSelectionOperationKeys.length
        )
        expectRunningResponsibilityRemains(result.journalRecords)
        if ("graph" in uncertainty.options) {
          expect(
            result.journalRecords.some(
              ({ event }) =>
                event._tag === "TaskTrackerFactsObserved" &&
                event.observation._tag === "TaskTrackerFactsReadFailed" &&
                event.observation.failure._tag === "TrackerReadError"
            ),
            uncertainty.name
          ).toBe(true)
        } else if ("claim" in uncertainty.options) {
          expect(
            result.journalRecords.some(
              ({ event }) =>
                event._tag === "TaskTrackerFactsObserved" &&
                event.observation._tag === "FocusedTaskClaimFactsUnreadable"
            ),
            uncertainty.name
          ).toBe(true)
        } else {
          expect(
            result.journalRecords.some(
              ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
            ),
            uncertainty.name
          ).toBe(true)
          expect(result.journalRecords.some(({ event }) => event._tag === "TargetLineageObserved")).toBe(false)
        }
      }
    })
)

it.effect("AcceptedFactPublication for a Running report uses ordinary entry without A authority reads", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({ source: "AcceptedFactPublication" })
    expect(result.activationKinds).toEqual(["OrdinaryRunEntry", "OrdinaryRunEntry"])
    expect(result.trackerCalls).toEqual([])
    expect(result.activeSelections).toEqual([])
    expect(result.executorCalls).toEqual([])
  })
)

it.effect("accepted executor report publication never refreshes tracker or Git authority", () =>
  Effect.gen(function* () {
    for (const report of ["Running", "SafelySuspended", "Terminal"] as const) {
      const result = yield* runProductionRefreshHarness({ source: "AcceptedFactPublication", report })
      expect(result.activationKinds).toEqual(["OrdinaryRunEntry", "OrdinaryRunEntry"])
      expect(result.trackerCalls).toEqual([])
      expect(result.activeSelections).toEqual([])
      expect(result.activeSelectionTrace).toEqual([])
      expect(result.executorEntries).toEqual([])
      expect(result.executorCalls).toEqual([])
    }
  })
)

it.effect("Operator Wake remains an ordinary entry without active authority reads", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({ source: "OperatorWake", report: "Running" })
    expect(result.activationKinds).toEqual(["OrdinaryRunEntry", "OrdinaryRunEntry"])
    expect(result.trackerCalls).toEqual([])
    expect(result.activeSelections).toEqual([])
    expect(result.activeSelectionTrace).toEqual([])
    expect(result.executorEntries).toEqual([])
    expect(result.executorCalls).toEqual([])
  })
)

it.effect("accepted publication notification and timer coalesce into one trailing active refresh", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({ coalesce: true })
    expect(result.activationKinds).toEqual([
      "OrdinaryRunEntry",
      "ActiveWorkAuthorityRefresh",
      "ActiveWorkAuthorityRefresh"
    ])
    expect(result.activeActivationCount).toBe(2)
    expect(result.activeSources).toEqual(["TrackerNotification", "Timer"])
    expect(result.maximumActiveConcurrent).toBe(1)
    expect(result.activeSelectionOperationKeys.filter((key) => key.startsWith("ReadTrackerGraph:"))).toHaveLength(4)
    expect(result.executorEntries).toEqual([])
    expect(result.executorCalls).toEqual([])
  })
)

it.effect("hands a publication after the capacity-wait freshness cut to one nonconcurrent trailing activation", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      capacityTwo: true,
      executingTaskIds: { primary: TaskId.make("A"), independent: TaskId.make("C"), third: TaskId.make("D") },
      graph: "TaskClosedWithoutSuccess",
      includeFreshWaitingTaskE: true,
      publishAfterActiveReturn: true,
      suspensionSubjectTaskId: TaskId.make("C"),
      threeExecuting: true
    })
    expect(result.activeDecisions).toEqual([RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })])
    expect(result.activationKinds).toEqual(["OrdinaryRunEntry", "ActiveWorkAuthorityRefresh", "OrdinaryRunEntry"])
    expect(result.activeActivationTimeline).toEqual(["Start", "Return"])
    expect(result.maximumActiveConcurrent).toBe(1)
    expect(result.trackerCalls.filter((call) => call === "graph")).toHaveLength(2)
    expect(result.trackerCalls.filter((call) => call === "acquire")).toEqual([])
    expect(result.executorCalls.filter(({ command }) => command !== "observe")).toEqual([
      { command: "Suspend", taskId: "C" }
    ])
    expect(result.journalRecords.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toEqual([])
  })
)

it.effect(
  "returns RunMustRemainActive RunnableTransition and starts one queued trailing activation only after the current activation returns",
  () =>
    Effect.gen(function* () {
      const result = yield* runProductionRefreshHarness({
        capacityTwo: true,
        coalesce: true,
        executingTaskIds: { primary: TaskId.make("A"), independent: TaskId.make("C"), third: TaskId.make("D") },
        graph: "TaskClosedWithoutSuccess",
        includeFreshWaitingTaskE: true,
        suspensionSubjectTaskId: TaskId.make("C"),
        threeExecuting: true,
        verifyNoSpontaneousActivation: true
      })

      expect(result.graphTaskIds).toEqual(["A", "C", "D", "E"])
      expect(result.taskWorkSnapshots).toContainEqual(["A", "C", "D"])
      expect(result.taskWorkSnapshots.at(-1)).toEqual(["A", "D"])
      expect(result.executorCalls.filter(({ command }) => command !== "observe")).toEqual([
        { command: "Suspend", taskId: "C" }
      ])
      expect(result.trackerCalls.filter((call) => call === "acquire")).toEqual([])
      expect(
        result.journalRecords.filter(
          ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.taskId === "E"
        )
      ).toEqual([])
      expect(result.activeDecision).toEqual(RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" }))
      expect(result.activeDecisions).toEqual([
        RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" }),
        RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })
      ])
      expect(result.activeActivationCount).toBe(2)
      expect(result.activeSources).toEqual(["TrackerNotification", "Timer"])
      expect(result.activeActivationTimeline).toEqual(["Start", "Return", "Start", "Return"])
      expect(result.maximumActiveConcurrent).toBe(1)
      expect(result.trackerCalls.filter((call) => call === "graph")).toHaveLength(3)
      const activeGraphIntents = result.journalRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
      )
      const g2Intents = result.journalRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "PostQuiescenceReconfirmation"
      )
      expect(activeGraphIntents).toHaveLength(2)
      expect(g2Intents).toHaveLength(1)
      const initialExecutingPositions = result.journalRecords.flatMap(({ event, position }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkExecuting"
          ? [position]
          : []
      )
      const capacityChanged = result.journalRecords.find(({ event }) => event._tag === "TaskWorkCapacityChanged")
      expect(initialExecutingPositions).toHaveLength(3)
      expect(capacityChanged?.position).toBeDefined()
      expect(initialExecutingPositions.every((position) => position < (capacityChanged?.position ?? position))).toBe(
        true
      )
      if (capacityChanged === undefined || activeGraphIntents[0] === undefined) {
        return yield* Effect.die("missing capacity contraction or active G1 intent")
      }
      expect(capacityChanged.position < activeGraphIntents[0].position).toBe(true)
      expect(result.journalRecords.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
      expect(result.beforeExplicitExitCounts).toEqual([{ processEnds: 0, requests: 0 }])
    })
)

it.effect("restart after accepted G2 preserves A0 D0 C1 E identities and does not repeat C1 Suspend", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      capacityTwo: true,
      crash: "AfterG2",
      executingTaskIds: { primary: TaskId.make("A"), independent: TaskId.make("C"), third: TaskId.make("D") },
      graph: "TaskClosedWithoutSuccess",
      includeFreshWaitingTaskE: true,
      suspensionSubjectTaskId: TaskId.make("C"),
      threeExecuting: true
    })

    const firstRecords = result.firstJournalRecords ?? []
    expect(result.failpoint?.tag).toBe("AfterG2")
    const g2Position = result.failpoint?.position
    expect(g2Position).toBeDefined()
    expect(
      firstRecords.some(
        ({ event, position }) =>
          position === g2Position &&
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
      )
    ).toBe(true)
    const committedG2 = firstRecords.find(
      ({ event, position }) => position === g2Position && event._tag === "TaskTrackerFactsObserved"
    )
    if (committedG2?.event._tag !== "TaskTrackerFactsObserved") {
      return yield* Effect.die("the first process did not retain its exact committed G2")
    }
    const committedG2OperationId = committedG2.event.operationId
    const committedG2Intent = firstRecords.find(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTrackerGraph" &&
        event.operation.operationId === committedG2OperationId
    )
    expect(committedG2Intent?.event).toMatchObject({ operation: { cause: { _tag: "PostQuiescenceReconfirmation" } } })
    expect(
      result.journalRecords.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
      )
    ).toHaveLength(1)
    expect(result.executorCalls.filter(({ command }) => command === "Suspend")).toEqual([
      { command: "Suspend", taskId: "C" }
    ])
    expect(result.graphTaskIds).toEqual(["A", "C", "D", "E"])
    expect(result.taskWorkSnapshots.at(-1)).toEqual(["A", "D"])
    expect(result.beforeExplicitExitCounts).toEqual([
      { processEnds: 0, requests: 0 },
      { processEnds: 0, requests: 0 }
    ])
    expect(
      result.journalRecords.filter(
        ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.taskId === "E"
      )
    ).toEqual([])
    const plannedAttemptsOf = (records: ReadonlyArray<JournalRecord>) =>
      records.flatMap(({ event }) => (event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []))
    const firstPlans = plannedAttemptsOf(firstRecords)
    expect(firstPlans.map(({ attemptId, taskId }) => [taskId, attemptId])).toEqual([
      ["A", "production-refresh-healthy-attempt"],
      ["C", "production-refresh-independent-attempt"],
      ["D", "production-refresh-third-attempt"]
    ])
    expect(plannedAttemptsOf(result.journalRecords)).toEqual(firstPlans)
    expect(result.trackerCalls.filter((call) => call === "acquire")).toEqual([])
    expect(result.journalRecords.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
  })
)

it.effect("production discovers F and G without admitting them while B C and D hold capacity three", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({ discoverFAndG: true, threeExecuting: true, coalesce: true })
    expect(result.activeActivationCount).toBe(2)
    expect(result.maximumActiveConcurrent).toBe(1)
    expect(result.maximumGraphReadsInFlight).toBe(1)
    expect(result.trackerCalls.filter((call) => call === "graph")).toHaveLength(2)
    expect(result.executorCalls).toEqual([])
    expect(result.executorEntries).toEqual([])
    expect(result.trackerCalls.filter((call) => call === "acquire")).toEqual([])
    expect(result.taskWorkSnapshots.length).toBeGreaterThan(0)
    expect([...new Set(result.taskWorkSnapshots.map((held) => held.toSorted().join(",")))]).toEqual(["B,C,D"])
    expect(result.taskWorkSnapshots.every((held) => held.toSorted().join(",") === "B,C,D")).toBe(true)
    expect(
      result.journalRecords.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies[0].contentIdentity === "G5"
      )
    ).toBe(true)
    expect(
      result.journalRecords.filter(
        ({ event }) => event._tag === "TaskAttemptPlanned" && ["F", "G"].includes(event.operation.plannedAttempt.taskId)
      )
    ).toEqual([])
  })
)

it.effect("unreadable F G discovery preserves B C D and waits for another independent tracker hint", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      discoverFAndG: true,
      threeExecuting: true,
      graph: "Unreadable",
      repeatAfterUncertainty: true
    })
    expect(result.beforeSecondOpportunity?.trackerCalls.filter((call) => call === "graph")).toHaveLength(1)
    expect(result.trackerCalls.filter((call) => call === "graph")).toHaveLength(2)
    expect(result.maximumActiveConcurrent).toBe(1)
    expect(result.activeActivationCount).toBe(2)
    expect(result.executorCalls).toEqual([])
    expect(result.executorEntries).toEqual([])
    expect(result.trackerCalls.filter((call) => call === "acquire")).toEqual([])
    expect(result.taskWorkSnapshots.length).toBeGreaterThan(0)
    expect([...new Set(result.taskWorkSnapshots.map((held) => held.toSorted().join(",")))]).toEqual(["B,C,D"])
    expect(result.taskWorkSnapshots.every((held) => held.toSorted().join(",") === "B,C,D")).toBe(true)
    expect(
      result.journalRecords.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies[0].contentIdentity === "G5"
      )
    ).toBe(false)
    expect(
      result.journalRecords.filter(
        ({ event }) => event._tag === "TaskAttemptPlanned" && ["F", "G"].includes(event.operation.plannedAttempt.taskId)
      )
    ).toEqual([])
  })
)

it.effect("a tracker edit during one active read is preserved as one serialized trailing active refresh", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      changedTask: "B",
      coalesce: true,
      editDuringActiveRead: true,
      threeExecuting: true
    })
    expect(result.activationKinds).toEqual([
      "OrdinaryRunEntry",
      "ActiveWorkAuthorityRefresh",
      "ActiveWorkAuthorityRefresh"
    ])
    expect(result.activeActivationCount).toBe(2)
    expect(result.maximumActiveConcurrent).toBe(1)
    expect(result.executorCalls.filter(({ command }) => command !== "observe")).toEqual([
      { command: "Suspend", taskId: "B" }
    ])
    expect(result.executorCalls.filter(({ taskId }) => taskId === "A" || taskId === "C")).toEqual([])
    expect(
      result.journalRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
          event.observation.factFamily.taskId === "B" &&
          event.observation.factFamily.body === "Changed F2 instructions."
      )
    ).toHaveLength(1)
  })
)

it.effect("production refresh recovers a constraint observed before a crashed suspension intent", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      source: "Timer",
      claim: "Missing",
      includeIndependentTask: true,
      crash: "AfterConstraintBeforeSuspendIntent"
    })
    const firstRecords = result.firstJournalRecords ?? []
    const firstSuspendIntents = firstRecords.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.taskId === "A"
    )
    const finalSuspendIntents = result.journalRecords.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.taskId === "A"
    )
    const constraint = firstRecords.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFacts" &&
        event.observation.observation._tag === "UnclaimedTask"
    )
    const finalSafe = result.journalRecords.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "ExecutorWorkSafelySuspended" &&
        event.report.correlation.attemptId === "production-refresh-healthy-attempt"
    )
    expect(result.failpoint?.tag).toBe("AfterConstraintBeforeSuspendIntent")
    expect(result.failpoint?.position).toBeDefined()
    expect(firstSuspendIntents).toHaveLength(0)
    if (finalSuspendIntents.length !== 1) {
      return yield* Effect.die(
        JSON.stringify(
          result.journalRecords.map(({ event, position }) => ({
            position,
            tag: event._tag,
            operationId: "operationId" in event ? event.operationId : undefined,
            command: event._tag === "PlannedAttemptExecutorCommandIntended" ? event.command : undefined,
            ordinal: event._tag === "PlannedAttemptExecutorCommandIntended" ? event.ordinal : undefined,
            projection:
              event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ? event.observation._tag : undefined
          }))
        )
      )
    }
    expect(result.executorCalls).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "Begin", taskId: "B" }
    ])
    if (constraint === undefined) {
      return yield* Effect.die(
        JSON.stringify(firstRecords.slice(13).map(({ event, position }) => ({ position, event })))
      )
    }
    expect(finalSafe).toBeDefined()
    const finalSuspendIntent = finalSuspendIntents.at(0)
    if (finalSuspendIntent === undefined || finalSafe === undefined) {
      return yield* Effect.die("missing crash-before-intent evidence")
    }
    if (finalSuspendIntent.event._tag !== "PlannedAttemptExecutorCommandIntended") {
      return yield* Effect.die("missing persisted suspension intent")
    }
    expect(constraint.position < finalSuspendIntent.position).toBe(true)
    expect(finalSuspendIntent.event.plannedAttempt.attemptId).toBe("production-refresh-healthy-attempt")
    expect(finalSuspendIntent.position < finalSafe.position).toBe(true)
  })
)

it.effect("production refresh reuses a persisted suspension intent after a provider-entry crash", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      source: "Timer",
      claim: "Missing",
      includeIndependentTask: true,
      crash: "AfterSuspendIntentBeforeProvider"
    })
    const firstRecords = result.firstJournalRecords ?? []
    const finalSuspendIntents = result.journalRecords.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.taskId === "A"
    )
    const projections = result.journalRecords.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
        event.plannedAttempt.attemptId === "production-refresh-healthy-attempt"
    )
    expect(result.failpoint?.tag).toBe("AfterSuspendIntentBeforeProvider")
    expect(result.failpoint?.position).toBeDefined()
    expect(
      firstRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Suspend" &&
          event.plannedAttempt.taskId === "A"
      )
    ).toHaveLength(1)
    if (finalSuspendIntents.length !== 1) {
      return yield* Effect.die(
        JSON.stringify(
          result.journalRecords.map(({ event, position }) => ({
            position,
            tag: event._tag,
            operationId: "operationId" in event ? event.operationId : undefined,
            command: event._tag === "PlannedAttemptExecutorCommandIntended" ? event.command : undefined,
            ordinal: event._tag === "PlannedAttemptExecutorCommandIntended" ? event.ordinal : undefined,
            projection:
              event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ? event.observation._tag : undefined
          }))
        )
      )
    }
    expect(result.executorEntries).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "observe", taskId: "A" }
    ])
    expect(result.executorCalls).toEqual([{ command: "observe", taskId: "A" }])
    expect(result.activeActivation).toBe("Success")
    expect(result.activeDecision).toEqual(
      RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
    )
    expect(projections).toHaveLength(1)
    const projection = projections[0]?.event
    if (projection === undefined || projection._tag !== "PlannedAttemptExecutorCommandProjectionObserved") {
      return yield* Effect.die("missing suspension reconciliation projection")
    }
    expect(projection.observation._tag).toBe("ExactExecutorReport")
    if (projection.observation._tag !== "ExactExecutorReport") {
      return yield* Effect.die("missing exact suspension reconciliation report")
    }
    expect(projection.observation.report._tag).toBe("ExecutorWorkExecuting")
    expectRunningResponsibilityRemains(result.journalRecords)
    expect(
      result.journalRecords.some(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.plannedAttempt.taskId === "B"
      )
    ).toBe(false)
  })
)

it.effect("production refresh reconciles an accepted suspension when its response append is lost", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      source: "Timer",
      claim: "Missing",
      includeIndependentTask: true,
      crash: "SuspendResponseLost"
    })
    const firstRecords = result.firstJournalRecords ?? []
    const finalSuspendIntents = result.journalRecords.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.taskId === "A"
    )
    const projections = result.journalRecords.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
        event.plannedAttempt.attemptId === "production-refresh-healthy-attempt"
    )
    expect(result.failpoint?.tag).toBe("SuspendResponseLost")
    expect(result.failpoint?.position).toBeDefined()
    expect(
      firstRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Suspend" &&
          event.plannedAttempt.taskId === "A"
      )
    ).toHaveLength(1)
    expect(finalSuspendIntents).toHaveLength(1)
    expect(result.executorEntries.filter(({ command }) => command !== "observe")).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "Begin", taskId: "B" }
    ])
    expect(result.executorEntries.filter(({ command }) => command === "observe").length).toBeGreaterThan(0)
    expect(result.executorEntries.findIndex(({ command }) => command === "observe")).toBeGreaterThan(0)
    expect(result.executorEntries.findLastIndex(({ command }) => command === "observe")).toBeLessThan(
      result.executorEntries.length - 1
    )
    expect(result.executorCalls.filter(({ command }) => command !== "observe")).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "Begin", taskId: "B" }
    ])
    expect(result.executorCalls.filter(({ command }) => command === "observe").length).toBeGreaterThan(0)
    expect(projections).toHaveLength(1)
    const projection = projections[0]?.event
    if (projection === undefined || projection._tag !== "PlannedAttemptExecutorCommandProjectionObserved") {
      return yield* Effect.die("missing suspension reconciliation projection")
    }
    expect(projection.observation._tag).toBe("ExactExecutorReport")
    if (projection.observation._tag !== "ExactExecutorReport") {
      return yield* Effect.die("missing exact suspension reconciliation report")
    }
    expect(projection.observation.report._tag).toBe("ExecutorWorkSafelySuspended")
    expect(
      result.journalRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkSafelySuspended" &&
          event.report.correlation.attemptId === "production-refresh-healthy-attempt"
      )
    ).toHaveLength(1)
    expect(
      result.journalRecords.some(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.plannedAttempt.taskId === "B"
      )
    ).toBe(true)
  })
)
