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
  FixtureTarget,
  GitCommand,
  GitCommonDirectoryTarget,
  InitialControlPolicy,
  JournaledRunBootstrap,
  JournalDatabaseLocator,
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
  TaskWorkCapacity,
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
  PlannedAttemptExecutorCommandFailure,
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

const nodePathAndFileSystemLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)

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
      const opportunities = yield* Ref.make<ReadonlyArray<RunActivationOpportunityValue>>([])
      const bootstrap = JournaledRunBootstrap.of({
        activate: (_target, _policy, _runId, _program, opportunity) =>
          Ref.update(opportunities, (current) =>
            opportunity === undefined ? current : [...current, opportunity]
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
          { _tag: "OrdinaryRunEntry" },
          { _tag: "ActiveWorkAuthorityRefresh", source: "TrackerNotification" },
          { _tag: "ActiveWorkAuthorityRefresh", source: "Timer" },
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
  readonly source?: "TrackerNotification" | "Timer" | "AcceptedFactPublication"
  readonly claim?: "Exact" | "Missing" | "Foreign"
  readonly graph?: "Readable" | "Unreadable"
  readonly git?: "Ready" | "LostWorktree" | "LineageRewrite" | "Unreadable"
  readonly includeIndependentTask?: boolean
  readonly crash?: ProductionRefreshCrash
}

type ProductionRefreshCrash =
  | "AfterConstraintBeforeSuspendIntent"
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
      const claimMode = options.claim ?? "Exact"
      const graphMode = options.graph ?? "Readable"
      const gitMode = options.git ?? "Ready"
      const includeIndependentTask = options.includeIndependentTask === true
      const target = FixtureTarget.make("production-refresh-healthy-target")
      const runId = RunId.make("production-refresh-healthy-run")
      const taskId = TaskId.make("A")
      const independentTaskId = TaskId.make("B")
      const specification = makeTaskWorkSpecification({ body: "Complete A.", taskId, title: "Complete A" })
      const independentSpecification = makeTaskWorkSpecification({
        body: "Complete B.",
        taskId: independentTaskId,
        title: "Complete B"
      })
      const projected = projectTrackerSnapshot({
        revision: "production-refresh-healthy-graph",
        rootTaskId: taskId,
        tasks: [
          { id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
          ...(includeIndependentTask
            ? [{ id: independentTaskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
            : [])
        ]
      })
      if (projected._tag === "Invalid") return yield* Effect.die("healthy production graph must be valid")
      const snapshot = projected.snapshot
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
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-refresh-independent"),
        executor: TaskExecutorLocator.make("executor:production-refresh-independent"),
        runId,
        taskId: independentTaskId,
        taskRevision: independentSpecification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/independent-worktree`)
      })
      const targetRef =
        gitMode === "LineageRewrite"
          ? IntegrationTargetRef.make("refs/heads/rewritten-target")
          : IntegrationTargetRef.make("refs/heads/master")
      if (gitMode === "LineageRewrite") {
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
      if (gitMode === "LostWorktree") {
        yield* git.runInWorktree(directory, ["worktree", "remove", "--force", attempt.worktree])
      }
      const journalFilename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const acquisition = {
        operationId: OperationId.make("production-refresh-healthy-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("production-refresh-healthy-token")
      }
      const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
      const graphOperation = makeTrackerGraphObservationOperation(
        OperationId.make("production-refresh-healthy-graph"),
        target,
        [acquisition.operationId],
        includeIndependentTask ? [taskId, independentTaskId] : [taskId]
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
      yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* journal.beginRun(
            runId,
            target,
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
          )
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
              taskIds: includeIndependentTask ? [taskId, independentTaskId] : [taskId]
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
              command: "StartOrContinue",
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              ordinal: commandOrdinal,
              plannedAttempt: attempt,
              version: workflowJournalEventVersion
            })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, PlannedAttemptExecutorReportOrdinal.make(1)),
            PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
              report: PlannedAttemptExecutorReport.cases.Running.make({
                correlation: plannedAttemptExecutorCorrelation(attempt)
              }),
              version: workflowJournalEventVersion
            })
          )
        }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: journalFilename })))
      )
      type ProductionExecutorCall = {
        readonly command: "project" | "StartOrContinue" | "Suspend"
        readonly taskId: TaskId
      }
      const foreignClaim = ActiveTaskClaim.make({
        operationId: OperationId.make("production-refresh-foreign-claim"),
        owner: ClaimOwner.make("another-dalph"),
        taskId,
        token: ClaimToken.make("production-refresh-foreign-token")
      })
      const claimObservation =
        claimMode === "Missing" ? UnclaimedTask.make({ taskId }) : claimMode === "Foreign" ? foreignClaim : claim
      const acquiredClaims = yield* Ref.make<ReadonlyMap<TaskId, ActiveTaskClaim>>(new Map())
      const phase = yield* Ref.make<"Startup" | "Active">("Startup")
      const trackerCalls = yield* Ref.make<ReadonlyArray<"graph" | "specification" | "claim" | "acquire">>([])
      const activeSelections = yield* Ref.make<ReadonlyArray<string>>([])
      const activeSelectionTrace = yield* Ref.make<ReadonlyArray<string>>([])
      const executorCalls = yield* Ref.make<ReadonlyArray<ProductionExecutorCall>>([])
      const executorEntries = yield* Ref.make<ReadonlyArray<ProductionExecutorCall>>([])
      const suspendedTasks = yield* Ref.make<ReadonlySet<TaskId>>(new Set())
      const activationKinds = yield* Ref.make<ReadonlyArray<"OrdinaryRunEntry" | "ActiveWorkAuthorityRefresh">>([])
      const latestJournalPosition = yield* Ref.make<JournalRecord["position"] | undefined>(undefined)
      const failpoint = yield* Ref.make<ProductionRefreshFailpoint | undefined>(undefined)
      const failpointConsumed = yield* Ref.make(false)
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
                    selectedTaskId === taskId
                      ? Effect.succeed(claimObservation)
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
                Ref.update(trackerCalls, (calls) => [...calls, "graph" as const]).pipe(
                  Effect.andThen(
                    graphMode === "Unreadable"
                      ? Effect.fail(
                          new TrackerReadError({ operation: "TrackerGraphReader.parse", detail: "graph unreadable" })
                        )
                      : Effect.succeed(snapshot)
                  )
                ),
              readTaskWorkSpecification: (_target, selectedTaskId) =>
                Ref.update(trackerCalls, (calls) => [...calls, "specification" as const]).pipe(
                  Effect.andThen(Effect.succeed(selectedTaskId === taskId ? specification : independentSpecification))
                )
            })
            const executor = PlannedAttemptExecutor.of({
              project: (correlation) =>
                Effect.gen(function* () {
                  const projectedTaskId = correlation.attemptId === attempt.attemptId ? taskId : independentTaskId
                  const call = { command: "project" as const, taskId: projectedTaskId }
                  yield* Ref.update(executorEntries, (calls) => [...calls, call])
                  yield* Ref.update(executorCalls, (calls) => [...calls, call])
                  const suspended = (yield* Ref.get(suspendedTasks)).has(projectedTaskId)
                  return PlannedAttemptExecutorProjection.cases.Exact.make({
                    report: suspended
                      ? PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
                      : PlannedAttemptExecutorReport.cases.Running.make({ correlation })
                  })
                }),
              requestSuspension: (requested) =>
                claimMode !== "Exact" || gitMode === "LostWorktree" || gitMode === "LineageRewrite"
                  ? Effect.gen(function* () {
                      const call = { command: "Suspend" as const, taskId: requested.taskId }
                      yield* Ref.update(executorEntries, (calls) => [...calls, call])
                      if (processCrash === "AfterSuspendIntentBeforeProvider") {
                        const consume = yield* Ref.modify(failpointConsumed, (current) => [!current, true] as const)
                        if (consume) {
                          yield* Ref.set(failpoint, {
                            tag: processCrash,
                            position: yield* Ref.get(latestJournalPosition)
                          })
                          return yield* new PlannedAttemptExecutorCommandFailure({
                            command: "Suspend",
                            correlation: plannedAttemptExecutorCorrelation(requested),
                            detail: "test crash before executor provider call"
                          })
                        }
                      }
                      yield* Ref.update(executorCalls, (calls) => [...calls, call])
                      yield* Ref.update(suspendedTasks, (current) => new Set([...current, requested.taskId]))
                      return PlannedAttemptExecutorReport.cases.SafelySuspended.make({
                        correlation: plannedAttemptExecutorCorrelation(requested)
                      })
                    })
                  : Effect.die("healthy refresh must not suspend executor work"),
              startOrContinue: (request) =>
                Effect.gen(function* () {
                  const call = { command: "StartOrContinue" as const, taskId: request.plannedAttempt.taskId }
                  yield* Ref.update(executorEntries, (calls) => [...calls, call])
                  yield* Ref.update(executorCalls, (calls) => [...calls, call])
                  return request.plannedAttempt.taskId === independentTaskId
                    ? PlannedAttemptExecutorReport.cases.Terminal.make({
                        correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt),
                        result: { _tag: "Completed" }
                      })
                    : PlannedAttemptExecutorReport.cases.Running.make({
                        correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
                      })
                })
            })
            const trace = WorkflowTrace.of({
              emit: (item) =>
                item._tag === "OperationSelected" ? recordActiveSelection(item.operation._tag) : Effect.void
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
                            const shouldFail =
                              (processCrash === "AfterConstraintBeforeSuspendIntent" &&
                                event._tag === "PlannedAttemptExecutorCommandIntended" &&
                                event.command === "Suspend" &&
                                event.plannedAttempt.attemptId === attempt.attemptId) ||
                              (processCrash === "SuspendResponseLost" &&
                                event._tag === "PlannedAttemptExecutorWorkReported" &&
                                event.report._tag === "SafelySuspended" &&
                                event.report.correlation.attemptId === attempt.attemptId)
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
            const runtimeBoundaries = journalStoreLayer === undefined ? undefined : { journalStoreLayer }
            const application = productionWorkflowInterpreterLayer(
              runId,
              GitCommonDirectoryTarget.make(`${directory}/.git`),
              integrationTarget,
              Layer.succeed(TrackerMutation, trackerMutation),
              Layer.succeed(PlannedAttemptExecutor, executor),
              unavailableIntegratorCandidateProviderAuthority,
              runtimeBoundaries
            ).pipe(
              Layer.provide(Layer.succeed(TrackerGraphReader, trackerGraphReader)),
              Layer.provide(Layer.succeed(WorkflowTrace, trace))
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
            const activeDecision = yield* Ref.make<RunFinalityDecision | undefined>(undefined)
            const applicationBootstrap = Context.get(applicationContext, JournaledRunBootstrap)
            const wrappedBootstrap = JournaledRunBootstrap.of({
              ...applicationBootstrap,
              registerAcceptedRunReactivationObservers: (observers) =>
                Ref.set(registeredObservers, observers).pipe(
                  Effect.andThen(applicationBootstrap.registerAcceptedRunReactivationObservers(observers))
                ),
              activate: (target, initialControlPolicySource, allocatedRunId, program, opportunity) => {
                const activationTag =
                  opportunity?._tag === "ActiveWorkAuthorityRefresh"
                    ? ("ActiveWorkAuthorityRefresh" as const)
                    : ("OrdinaryRunEntry" as const)
                const recordActivation = Ref.update(activationKinds, (current) => [...current, activationTag])
                return opportunity?._tag === "OrdinaryRunEntry"
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
                            ? Deferred.succeed(acceptedActivation, undefined)
                            : Effect.void
                      ),
                      Effect.andThen(
                        Effect.succeed(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
                      )
                    )
                  : Effect.gen(function* () {
                      yield* recordActivation
                      return yield* applicationBootstrap
                        .activate(target, initialControlPolicySource, allocatedRunId, program, opportunity)
                        .pipe(
                          Effect.tap((decision) =>
                            Ref.set(activeDecision, decision).pipe(
                              Effect.andThen(Deferred.succeed(activeActivation, "Success"))
                            )
                          ),
                          Effect.tapError(() => Deferred.succeed(activeActivation, "Failure"))
                        )
                    })
              }
            })
            const applicationExit = Context.get(applicationContext, ApplicationExitShell)
            const ownerLayer = productionRunReactivationLayer(
              target,
              Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
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
                      Effect.succeed(request.specification.taskId === taskId ? attempt : independentAttempt)
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
              } else {
                yield* Ref.set(phase, "Active")
                if (source === "Timer") {
                  yield* TestClock.adjust("1 second")
                } else {
                  yield* owner.hint(RunReactivationHint.TrackerNotification())
                }
                yield* Deferred.await(activeActivation)
              }
            }).pipe(
              Effect.provide(ownerLayer),
              Effect.provide(
                ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: journalFilename }))
              )
            )
            return {
              activeActivation:
                source === "AcceptedFactPublication" ? undefined : yield* Deferred.await(activeActivation),
              activeDecision: yield* Ref.get(activeDecision)
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
          source === "AcceptedFactPublication"
            ? undefined
            : (secondProcess?.activeActivation ?? firstProcess.activeActivation),
        activeDecision: secondProcess?.activeDecision ?? firstProcess.activeDecision,
        activationKinds: yield* Ref.get(activationKinds),
        activeSelectionTrace: yield* Ref.get(activeSelectionTrace),
        activeSelections: yield* Ref.get(activeSelections),
        executorCalls: yield* Ref.get(executorCalls),
        executorEntries: yield* Ref.get(executorEntries),
        failpoint: yield* Ref.get(failpoint),
        firstJournalRecords,
        graphTaskIds: snapshot.taskIds(),
        journalRecords,
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
  observation: (event: JournalRecord["event"]) => boolean
) => {
  const observations = records.filter(({ event }) => observation(event))
  const suspendIntents = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "Suspend" &&
      event.plannedAttempt.taskId === "A"
  )
  const safelySuspendedReports = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report._tag === "SafelySuspended" &&
      event.report.correlation.attemptId === "production-refresh-healthy-attempt"
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
        event.plannedAttempt.taskId === "B" &&
        position < safelySuspendedPosition
    )
  ).toBe(false)
}

const expectRunningResponsibilityRemains = (records: ReadonlyArray<JournalRecord>) => {
  expect(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "Running" &&
        event.report.correlation.attemptId === "production-refresh-healthy-attempt"
    )
  ).toHaveLength(1)
  expect(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "SafelySuspended" &&
        event.report.correlation.attemptId === "production-refresh-healthy-attempt"
    )
  ).toHaveLength(0)
}

it.effect("production owner refreshes Running work once for a TrackerNotification without an executor command", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness()
    expect(result.activeSelections).toEqual([
      "ReadTrackerGraph",
      "ReadTaskWorkSpecification",
      "ReadTaskClaim",
      "ReadTaskWorktree",
      "ReadTargetLineage"
    ])
    expect(result.activeSelectionTrace).toEqual([
      "ReadTrackerGraph",
      "ReadTaskWorkSpecification",
      "ReadTaskClaim",
      "ReadTaskWorktree",
      "ReadTaskWorktree",
      "ReadTargetLineage",
      "ReadTargetLineage",
      "ReadTrackerGraph",
      "ReadTaskWorkSpecification",
      "ReadTaskClaim",
      "ReadTaskWorktree",
      "ReadTaskWorktree",
      "ReadTargetLineage",
      "ReadTargetLineage"
    ])
    expect(result.trackerCalls).toEqual(["graph", "specification", "claim", "graph", "specification", "claim"])
    expect(result.executorCalls).toEqual([])
    expect(result.activationKinds).toEqual(["OrdinaryRunEntry", "ActiveWorkAuthorityRefresh"])
    expect(result.graphTaskIds).toEqual(["A"])
    expect(result.journalRecords.some(({ event }) => event._tag === "WorkflowRunBegan")).toBe(true)
  })
)

it.effect("timer refresh suspends A after a missing claim while retaining independent B", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      source: "Timer",
      claim: "Missing",
      includeIndependentTask: true
    })
    expect(result.executorCalls).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "project", taskId: "A" },
      { command: "StartOrContinue", taskId: "B" }
    ])
    expect(result.graphTaskIds).toEqual(["A", "B"])
    expectOneSuspensionAfterObservation(
      result.journalRecords,
      (event) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFacts" &&
        event.observation.observation._tag === "UnclaimedTask"
    )
  })
)

it.effect("timer refresh suspends A after a foreign claim without consuming independent B", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      source: "Timer",
      claim: "Foreign",
      includeIndependentTask: true
    })
    expect(result.executorCalls).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "project", taskId: "A" },
      { command: "StartOrContinue", taskId: "B" }
    ])
    expect(result.graphTaskIds).toEqual(["A", "B"])
    expectOneSuspensionAfterObservation(
      result.journalRecords,
      (event) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFacts" &&
        event.observation.observation._tag === "ActiveTaskClaim" &&
        event.observation.observation.owner === "another-dalph"
    )
  })
)

it.effect("timer refresh suspends A after its worktree is lost without consuming independent B", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      source: "Timer",
      git: "LostWorktree",
      includeIndependentTask: true
    })
    expect(result.executorCalls).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "project", taskId: "A" },
      { command: "StartOrContinue", taskId: "B" }
    ])
    expect(result.graphTaskIds).toEqual(["A", "B"])
    expectOneSuspensionAfterObservation(
      result.journalRecords,
      (event) => event._tag === "PlannedAttemptWorktreeObserved" && event.observation._tag !== "PlannedWorktreeReady"
    )
  })
)

it.effect("timer refresh suspends A after target lineage is rewritten without consuming independent B", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({
      source: "Timer",
      git: "LineageRewrite",
      includeIndependentTask: true
    })
    expect(result.executorCalls).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "project", taskId: "A" },
      { command: "StartOrContinue", taskId: "B" }
    ])
    expect(result.graphTaskIds).toEqual(["A", "B"])
    expectOneSuspensionAfterObservation(
      result.journalRecords,
      (event) => event._tag === "TargetLineageObserved" && !event.observation.plannedBaseIsAncestorOfTargetHead
    )
  })
)

it.effect("timer refresh records an unreadable graph without issuing an executor command", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({ source: "Timer", graph: "Unreadable" })
    expect(result.executorCalls).toEqual([])
    expect(result.activeActivation).toBe("Failure")
    expect(result.activeSelections).toEqual(["ReadTrackerGraph"])
    expect(
      result.journalRecords.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "TaskTrackerFactsReadFailed" &&
          event.observation.failure._tag === "TrackerReadError"
      )
    ).toBe(true)
    expectRunningResponsibilityRemains(result.journalRecords)
  })
)

it.effect("timer refresh records an unreadable Git outcome without issuing an executor command", () =>
  Effect.gen(function* () {
    const result = yield* runProductionRefreshHarness({ source: "Timer", git: "Unreadable" })
    expect(result.executorCalls).toEqual([])
    expect(result.activeActivation).toBe("Failure")
    expect(
      result.journalRecords.some(
        ({ event }) =>
          event._tag === "ActiveWorkAuthorityRefreshGitReadFailed" &&
          event.failure._tag === "GitTargetLineageReadFailure"
      )
    ).toBe(true)
    expectRunningResponsibilityRemains(result.journalRecords)
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
        event.report._tag === "SafelySuspended" &&
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
      { command: "project", taskId: "A" },
      { command: "StartOrContinue", taskId: "B" }
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
      { command: "project", taskId: "A" }
    ])
    expect(result.executorCalls).toEqual([{ command: "project", taskId: "A" }])
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
    expect(projection.observation.report._tag).toBe("Running")
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
    expect(result.executorEntries).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "project", taskId: "A" },
      { command: "StartOrContinue", taskId: "B" }
    ])
    expect(result.executorCalls).toEqual([
      { command: "Suspend", taskId: "A" },
      { command: "project", taskId: "A" },
      { command: "StartOrContinue", taskId: "B" }
    ])
    expect(projections).toHaveLength(1)
    const projection = projections[0]?.event
    if (projection === undefined || projection._tag !== "PlannedAttemptExecutorCommandProjectionObserved") {
      return yield* Effect.die("missing suspension reconciliation projection")
    }
    expect(projection.observation._tag).toBe("ExactExecutorReport")
    if (projection.observation._tag !== "ExactExecutorReport") {
      return yield* Effect.die("missing exact suspension reconciliation report")
    }
    expect(projection.observation.report._tag).toBe("SafelySuspended")
    expect(
      result.journalRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "SafelySuspended" &&
          event.report.correlation.attemptId === "production-refresh-healthy-attempt"
      )
    ).toHaveLength(0)
    expect(
      result.journalRecords.some(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.plannedAttempt.taskId === "B"
      )
    ).toBe(true)
  })
)
