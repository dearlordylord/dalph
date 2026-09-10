import {
  AcceptedResultEvidenceManifest,
  AttemptId,
  GitCommitSha,
  makeTaskWorkSpecification,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  AllocatedWorkflowRunId,
  attemptChoiceControlWithProvidedProtocolLayer,
  ClaimOwner,
  CoordinatorOwnership,
  controlDirectionApplicationLayer,
  controlledTrackerMutationLayerFrom,
  DeliveryRelationPublicationObserver,
  deterministicOperationIdAllocatorLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  EvidenceStore,
  GitTargetLineage,
  GitWorktree,
  gitWorktreeTestLayer,
  InitialControlPolicy,
  Integrator,
  IntegratorCandidateText,
  IntegratorGit,
  IntegratorResult,
  JournaledRunBootstrap,
  journaledRunBootstrapLayer,
  journaledWorkflowInterpreterLayer,
  JournalStore,
  journalStoreCapabilities,
  makeApplicationExitShell,
  makeLiveDeliveryActionExecutor,
  memoryEvidenceStoreLayer,
  memoryJournalStoreLayer,
  noopJournalMaintenanceObservation,
  PlannedTaskAttemptPlanner,
  PlannedWorktreeAbsent,
  preservingDispositionCleanupBoundaryLayer,
  runWorkflowWithControlledDeliveryActionExecutor,
  taskClaimReacquisitionControlLayer,
  taskWorkCapacityControlLayer,
  TaskWorkCapacity,
  TrackerGraphReader,
  trackerGraphReaderTestLayer,
  TrackerMutation,
  validatedRunActivationLayer,
  WorkflowTrace,
  workflowInterpreterLayer,
  RunReactivationOwner,
  runReactivationOwnerLayer,
  ApplicationExitShell,
  type DeliveryRelationInputBundle,
  type JournaledRuntimeLayerInput,
  OperationIdAllocator,
  TaskClaimAcquisitionPlanner,
  type IntegratorRunCorrelation
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Layer, Queue, Ref, Stream } from "effect"
import {
  makeIssue276IntegrationSettlementControl,
  makeIssue276PromotionGit
} from "./issue-276-integration-settlement-control.js"

import {
  names,
  runId,
  target,
  shaLength,
  capacity,
  candidateDigits,
  acceptedDigits,
  baseSha,
  integrationTarget,
  graph
} from "./issue-276-g5-facts.js"

export type Issue276TerminalCut = "BeforeObservation" | "AfterObservation" | "AfterAcceptance"

/** Independent G5 boundary controls; all admission and report decisions belong to production. */
export const makeIssue276PositionRelease = Effect.fn("Issue276.makePositionRelease")(function* () {
  if (graph._tag === "Invalid") return yield* Effect.die("invalid controlled G5")
  const shared = yield* Layer.build(
    Layer.mergeAll(
      memoryJournalStoreLayer,
      memoryEvidenceStoreLayer,
      controlledTrackerMutationLayerFrom([]),
      trackerGraphReaderTestLayer(
        graph.snapshot,
        names.map((name) =>
          makeTaskWorkSpecification({
            taskId: TaskId.make(name),
            title: `Implement ${name}`,
            body: `Implement controlled task ${name}.`
          })
        )
      ),
      gitWorktreeTestLayer(PlannedWorktreeAbsent.make({}))
    )
  )
  const journal = Context.get(shared, JournalStore)
  const cut = yield* Ref.make<Issue276TerminalCut | undefined>(undefined)
  const cutReached = yield* Queue.unbounded<Issue276TerminalCut>()
  const controlledJournal = JournalStore.of({
    ...journal,
    append: (id, key, event) =>
      Effect.gen(function* () {
        const selected = yield* Ref.get(cut)
        const matches =
          selected === "BeforeObservation"
            ? event._tag === "PlannedAttemptExecutorStateObserved"
            : selected === "AfterObservation"
              ? event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
              : selected === "AfterAcceptance" && event._tag === "IntegrationResponsibilityBegan"
        if (selected !== undefined && matches) {
          yield* Queue.offer(cutReached, selected)
          return yield* Effect.interrupt
        }
        return yield* journal.append(id, key, event)
      })
  })
  const evidence = Context.get(shared, EvidenceStore)
  const settlementControl = yield* makeIssue276IntegrationSettlementControl(Context.get(shared, TrackerMutation))
  const head = yield* Ref.make(baseSha)
  const promotionGit = makeIssue276PromotionGit(head)
  const publications = yield* Ref.make<ReadonlyArray<DeliveryRelationInputBundle>>([])
  const failure = yield* Deferred.make<unknown>()
  const publicationQueue = yield* Queue.unbounded<DeliveryRelationInputBundle>()
  const commands = yield* Ref.make<ReadonlyArray<PlannedTaskAttempt>>([])
  const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
  const changes = new Map(
    yield* Effect.forEach(names, (name) =>
      Queue.unbounded<PlannedAttemptExecutorProjection>().pipe(Effect.map((queue) => [name, queue] as const))
    )
  )
  const integrations = yield* Ref.make<ReadonlyArray<IntegratorRunCorrelation>>([])
  const integrationEntered = yield* Queue.unbounded<IntegratorRunCorrelation>()
  const releaseIntegration: ReadonlyMap<string, Deferred.Deferred<void>> = new Map(
    yield* Effect.forEach(names, (name) =>
      Deferred.make<void>().pipe(Effect.map((release) => [name, release] as const))
    )
  )
  const executor = PlannedAttemptExecutor.of({
    begin: (request) =>
      Effect.gen(function* () {
        const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
        })
        yield* Ref.update(commands, (all) => [...all, request.plannedAttempt])
        yield* Ref.update(reports, (all) => new Map(all).set(request.plannedAttempt.attemptId, report))
        return report
      }),
    resume: () => Effect.die("#276 must not Resume an executing attempt"),
    requestSuspension: () => Effect.die("#276 must not suspend task work"),
    observe: (correlation) =>
      Ref.get(reports).pipe(
        Effect.flatMap((all) => {
          const report = all.get(correlation.attemptId)
          return report === undefined
            ? Effect.die("missing controlled executor")
            : Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report }))
        })
      )
  })
  const executorLayer = Layer.merge(
    Layer.succeed(PlannedAttemptExecutor, executor),
    Layer.succeed(PlannedAttemptExecutorLifecycleObservation, {
      attach: (correlation) =>
        Effect.gen(function* () {
          const name = names.find((name) => correlation.attemptId === `attempt:${name}`)
          const queue = name === undefined ? undefined : changes.get(name)
          if (queue === undefined) return yield* Effect.die("missing exact executor stream")
          return {
            current: yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" }),
            changes: Stream.fromQueue(queue),
            close: Effect.void
          }
        })
    })
  )
  const planning = Layer.mergeAll(
    deterministicOperationIdAllocatorLayer("issue-276"),
    deterministicTaskClaimAcquisitionPlannerLayer({ owner: ClaimOwner.make("issue-276"), tokenPrefix: "issue-276" }),
    Layer.succeed(PlannedTaskAttemptPlanner, {
      plan: (request) =>
        Effect.succeed(
          PlannedTaskAttempt.make({
            attemptId: AttemptId.make(`attempt:${request.specification.taskId}`),
            baseSha,
            branch: TaskBranchRef.make(`refs/heads/issue-276-${request.specification.taskId}`),
            executor: TaskExecutorLocator.make(`executor:${request.specification.taskId}`),
            runId,
            taskId: request.specification.taskId,
            taskRevision: request.specification.fingerprint,
            worktree: WorktreeLocator.make(`/controlled/issue-276/${request.specification.taskId}`)
          })
        )
    })
  )
  const planningContext = yield* Layer.build(planning)
  const sharedPlanning = Layer.mergeAll(
    Layer.succeed(OperationIdAllocator, Context.get(planningContext, OperationIdAllocator)),
    Layer.succeed(TaskClaimAcquisitionPlanner, Context.get(planningContext, TaskClaimAcquisitionPlanner)),
    Layer.succeed(PlannedTaskAttemptPlanner, Context.get(planningContext, PlannedTaskAttemptPlanner))
  )
  const interpreter = workflowInterpreterLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(TrackerGraphReader, Context.get(shared, TrackerGraphReader)),
        Layer.succeed(TrackerMutation, Context.get(shared, TrackerMutation)),
        Layer.succeed(GitWorktree, Context.get(shared, GitWorktree)),
        Layer.succeed(GitTargetLineage, {
          read: () =>
            Ref.get(head).pipe(
              Effect.map((targetHeadSha) => ({
                plannedBaseSha: baseSha,
                targetHeadSha,
                plannedBaseIsAncestorOfTargetHead: true
              }))
            )
        })
      )
    )
  )
  const controls = Layer.mergeAll(
    attemptChoiceControlWithProvidedProtocolLayer,
    controlDirectionApplicationLayer,
    taskClaimReacquisitionControlLayer,
    taskWorkCapacityControlLayer
  )
  const integratorLayer = Layer.merge(
    Layer.succeed(Integrator, {
      prepare: (request) =>
        Effect.gen(function* () {
          yield* Ref.update(integrations, (all) => [...all, request.correlation])
          yield* Queue.offer(integrationEntered, request.correlation)
          const release = releaseIntegration.get(request.correlation.session.plannedAttempt.taskId)
          if (release === undefined) return yield* Effect.die("unknown integration task")
          yield* Deferred.await(release).pipe(Effect.interruptible)
          return IntegratorResult.cases.PreparedCandidate.make({
            correlation: request.correlation,
            candidateText: IntegratorCandidateText.make(
              `candidate:${request.correlation.session.plannedAttempt.taskId}`
            )
          })
        })
    }),
    Layer.succeed(IntegratorGit, {
      readCandidate: (_target, candidateText) =>
        Effect.gen(function* () {
          const run = (yield* Ref.get(integrations)).find(
            (run) => candidateText === `candidate:${run.session.plannedAttempt.taskId}`
          )
          if (run === undefined) return yield* Effect.die("unknown exact candidate")
          const digit = candidateDigits[names.findIndex((name) => name === run.session.plannedAttempt.taskId)]
          if (digit === undefined) return yield* Effect.die("candidate has no controlled commit")
          const commit = GitCommitSha.make(digit.repeat(shaLength))
          return {
            _tag: "Commit" as const,
            candidateText,
            commit,
            directParents: [run.session.expectedTargetHead, run.session.acceptedResult.commit]
          }
        })
    })
  )
  const activate = Effect.scoped(
    Effect.gen(function* () {
      const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (effect) => effect })
      const shell = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const runtime = ({ opportunity }: JournaledRuntimeLayerInput) =>
        validatedRunActivationLayer(
          runId,
          integrationTarget,
          { git: promotionGit },
          settlementControl.claimBoundary,
          settlementControl.taskBoundary,
          preservingDispositionCleanupBoundaryLayer,
          evidence,
          false,
          opportunity
        ).pipe(
          Layer.provide(
            Layer.mergeAll(
              integratorLayer,
              controls,
              executorLayer,
              sharedPlanning,
              journaledWorkflowInterpreterLayer(runId, interpreter),
              Layer.succeed(WorkflowTrace, { emit: () => Effect.void })
            )
          )
        )
      const application = journaledRunBootstrapLayer(runId, runtime, shell, noopJournalMaintenanceObservation).pipe(
        Layer.provide(journalStoreCapabilities(Layer.succeed(JournalStore, controlledJournal))),
        Layer.provide(Layer.succeed(CoordinatorOwnership, ownership)),
        Layer.provide(executorLayer)
      )
      const applicationContext = yield* Layer.build(application)
      const ordinaryActivation = runWorkflowWithControlledDeliveryActionExecutor(
        target,
        Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(capacity) })),
        AllocatedWorkflowRunId.make(runId),
        makeLiveDeliveryActionExecutor,
        false
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(JournaledRunBootstrap, Context.get(applicationContext, JournaledRunBootstrap)),
            sharedPlanning,
            Layer.succeed(DeliveryRelationPublicationObserver, {
              observe: (bundle) =>
                Ref.update(publications, (all) => [...all, bundle]).pipe(
                  Effect.andThen(Queue.offer(publicationQueue, bundle)),
                  Effect.asVoid
                )
            })
          )
        )
      )
      const bootstrap = Context.get(applicationContext, JournaledRunBootstrap)
      const ownerLayer = runReactivationOwnerLayer({
        runId,
        activate: () => ordinaryActivation,
        activationInterval: "1 hour",
        failureCooldown: "1 hour",
        activateActiveWorkAuthorityRefresh: () => Effect.die("#276 has no tracker refresh stimulus"),
        readControl: bootstrap.readRunReactivationControl(target, runId),
        installAcceptedRunReactivationObservers: ({ acceptedFactPublication, control }) =>
          bootstrap
            .registerAcceptedRunReactivationObservers({
              acceptedFactPublication: () => acceptedFactPublication,
              control
            })
            .pipe(Effect.orDie),
        isTerminationFailure: () => false,
        onFailure: (error) => Deferred.succeed(failure, error).pipe(Effect.asVoid)
      }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, shell)))
      yield* ordinaryActivation
      return yield* RunReactivationOwner.pipe(
        Effect.andThen(Deferred.await(failure).pipe(Effect.flatMap(Effect.die))),
        Effect.provide(ownerLayer)
      )
    })
  )
  const terminalReport = (name: (typeof names)[number]) =>
    Effect.gen(function* () {
      const attempt = (yield* Ref.get(commands)).find((attempt) => attempt.taskId === name)
      const queue = changes.get(name)
      if (attempt === undefined || queue === undefined) return yield* Effect.die(`task ${name} has not begun`)
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const digit = acceptedDigits[names.indexOf(name)]
      if (digit === undefined) return yield* Effect.die("accepted result has no controlled commit")
      const commit = GitCommitSha.make(digit.repeat(shaLength))
      const evidenceManifest = yield* evidence.put(
        new TextEncoder().encode(
          JSON.stringify(
            AcceptedResultEvidenceManifest.make({
              commit,
              correlation,
              formatVersion: 1,
              outcome: "Accepted",
              predecessor: null
            })
          )
        )
      )
      return PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation,
        result: { _tag: "Accepted", acceptedResult: { commit, evidenceManifest } }
      })
    })
  const publish = (name: (typeof names)[number], projection: PlannedAttemptExecutorProjection) => {
    const queue = changes.get(name)
    return queue === undefined ? Effect.die("missing exact executor stream") : Queue.offer(queue, projection)
  }
  const terminal = (name: (typeof names)[number]) =>
    Effect.gen(function* () {
      const report = yield* terminalReport(name)
      yield* Ref.update(reports, (all) => new Map(all).set(report.correlation.attemptId, report))
      yield* publish(name, PlannedAttemptExecutorProjection.cases.Exact.make({ report }))
    })
  const unresolved = (kind: "Unavailable" | "Foreign") =>
    Effect.gen(function* () {
      const expected = { runId, attemptId: AttemptId.make("attempt:B") }
      const projection =
        kind === "Unavailable"
          ? PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation: expected })
          : PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
              expected,
              observed: yield* terminalReport("C")
            })
      yield* publish("B", projection)
    })
  return {
    activate,
    cut,
    cutReached,
    commands,
    integrationEntered,
    integrations,
    journal,
    publications,
    publicationQueue,
    releaseIntegration,
    runId,
    terminal,
    unresolved
  }
})
