import {
  AcceptedResultEvidenceManifest,
  type AttemptId,
  makeTaskWorkSpecification,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  type TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  AllocatedWorkflowRunId,
  attemptChoiceControlWithProvidedProtocolLayer,
  ClaimOwner,
  type CompletionClaimBoundary,
  type CompletionTaskBoundary,
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
  type IntegratorRunCorrelation,
  type WorkflowJournalEvent as WorkflowEvent
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Layer, Queue, Ref, Stream } from "effect"
import { makeSixTaskGitAndEvidence } from "./six-task-finality-boundaries.js"

import type { makeSixTaskDeliveryFacts } from "./six-task-delivery-facts.js"
import { makeSixTaskIntegratorGit } from "./six-task-integrator-git.js"

export type SixTaskTerminalCut = "BeforeObservation" | "AfterObservation" | "AfterAcceptance"

/** Independent G5 boundary controls; all admission and report decisions belong to production. */
export const makeSixTaskDeliveryRuntime = Effect.fn("SixTaskDelivery.makeRuntime")(function* (
  facts: ReturnType<typeof makeSixTaskDeliveryFacts>,
  control: {
    readonly beforeAppend: (event: WorkflowEvent) => Effect.Effect<void>
    readonly afterAppend: (event: WorkflowEvent) => Effect.Effect<void>
    readonly makeFinality: (
      tracker: TrackerMutation["Service"]
    ) => Effect.Effect<{
      readonly claimBoundary: CompletionClaimBoundary["Service"]
      readonly taskBoundary: CompletionTaskBoundary["Service"]
    }>
  }
) {
  const { baseSha, capacity, graph, integrationTarget, namespace, runId, target, taskFacts, taskFactsById, tasks } =
    facts
  if (graph._tag === "Invalid") return yield* Effect.die("invalid controlled G5")
  const shared = yield* Layer.build(
    Layer.mergeAll(
      memoryJournalStoreLayer,
      memoryEvidenceStoreLayer,
      controlledTrackerMutationLayerFrom([]),
      trackerGraphReaderTestLayer(
        graph.snapshot,
        tasks.map(({ taskId }) =>
          makeTaskWorkSpecification({
            taskId,
            title: `Implement ${taskId}`,
            body: `Implement controlled task ${taskId}.`
          })
        )
      ),
      gitWorktreeTestLayer(PlannedWorktreeAbsent.make({}))
    )
  )
  const journal = Context.get(shared, JournalStore)
  const cut = yield* Ref.make<
    { readonly _tag: "Disabled" } | { readonly _tag: "Armed"; readonly at: SixTaskTerminalCut }
  >({ _tag: "Disabled" })
  const cutReached = yield* Queue.unbounded<SixTaskTerminalCut>()
  const controlledJournal = JournalStore.of({
    ...journal,
    append: (id, key, event) =>
      Effect.gen(function* () {
        const selected = yield* Ref.get(cut)
        yield* control.beforeAppend(event)
        const matches =
          selected._tag === "Armed" &&
          (selected.at === "BeforeObservation"
            ? event._tag === "PlannedAttemptExecutorStateObserved"
            : selected.at === "AfterObservation"
              ? event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
              : event._tag === "IntegrationResponsibilityBegan")
        if (selected._tag === "Armed" && matches) {
          yield* Queue.offer(cutReached, selected.at)
          return yield* Effect.interrupt
        }
        const result = yield* journal.append(id, key, event)
        yield* control.afterAppend(event)
        return result
      })
  })
  const { evidence, evidenceReads, head, promotionGit, promotionReads, promotions } = yield* makeSixTaskGitAndEvidence(
    Context.get(shared, EvidenceStore),
    baseSha
  )
  const settlementControl = yield* control.makeFinality(Context.get(shared, TrackerMutation))
  const publications = yield* Ref.make<ReadonlyArray<DeliveryRelationInputBundle>>([])
  const publicationQueue = yield* Queue.unbounded<DeliveryRelationInputBundle>()
  const commands = yield* Ref.make<ReadonlyArray<PlannedTaskAttempt>>([])
  const reports = yield* Ref.make<ReadonlyMap<AttemptId, PlannedAttemptExecutorReport>>(new Map())
  const changes = new Map(
    yield* Effect.forEach(tasks, ({ taskId }) =>
      Queue.unbounded<PlannedAttemptExecutorProjection>().pipe(Effect.map((queue) => [taskId, queue] as const))
    )
  )
  const integrations = yield* Ref.make<ReadonlyArray<IntegratorRunCorrelation>>([])
  const integrationEntered = yield* Queue.unbounded<IntegratorRunCorrelation>()
  const releaseIntegration: ReadonlyMap<TaskId, Deferred.Deferred<void>> = new Map(
    yield* Effect.forEach(tasks, ({ taskId }) =>
      Deferred.make<void>().pipe(Effect.map((release) => [taskId, release] as const))
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
    resume: () => Effect.die("six-task delivery must not Resume an executing attempt"),
    requestSuspension: () => Effect.die("six-task delivery must not suspend task work"),
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
          const task = tasks.find(({ attemptId }) => correlation.attemptId === attemptId)
          const queue = task === undefined ? undefined : changes.get(task.taskId)
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
    deterministicOperationIdAllocatorLayer(namespace),
    deterministicTaskClaimAcquisitionPlannerLayer({ owner: ClaimOwner.make(namespace), tokenPrefix: namespace }),
    Layer.succeed(PlannedTaskAttemptPlanner, {
      plan: (request) =>
        Effect.gen(function* () {
          const task = taskFactsById.get(request.specification.taskId)
          if (task === undefined) return yield* Effect.die("cannot plan an unknown controlled task")
          return PlannedTaskAttempt.make({
            attemptId: task.attemptId,
            baseSha,
            branch: TaskBranchRef.make(`refs/heads/${namespace}-${request.specification.taskId}`),
            executor: TaskExecutorLocator.make(`executor:${request.specification.taskId}`),
            runId,
            taskId: request.specification.taskId,
            taskRevision: request.specification.fingerprint,
            worktree: WorktreeLocator.make(`/controlled/${namespace}/${request.specification.taskId}`)
          })
        })
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
  const { candidateReads, git } = yield* makeSixTaskIntegratorGit(integrations, facts)
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
    Layer.succeed(IntegratorGit, git)
  )
  const activate = Effect.scoped(
    Effect.gen(function* () {
      const failure = yield* Deferred.make<unknown>()
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
        activateActiveWorkAuthorityRefresh: () => Effect.die("six-task delivery has no tracker refresh stimulus"),
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
  const terminalReport = (name: keyof typeof taskFacts) =>
    Effect.gen(function* () {
      const attempt = (yield* Ref.get(commands)).find((attempt) => attempt.taskId === name)
      const queue = changes.get(taskFacts[name].taskId)
      if (attempt === undefined || queue === undefined) return yield* Effect.die(`task ${name} has not begun`)
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const commit = taskFacts[name].acceptedCommit
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
  const publish = (name: keyof typeof taskFacts, projection: PlannedAttemptExecutorProjection) => {
    const queue = changes.get(taskFacts[name].taskId)
    return queue === undefined ? Effect.die("missing exact executor stream") : Queue.offer(queue, projection)
  }
  const terminal = (name: keyof typeof taskFacts) =>
    Effect.gen(function* () {
      const report = yield* terminalReport(name)
      yield* Ref.update(reports, (all) => new Map(all).set(report.correlation.attemptId, report))
      yield* publish(name, PlannedAttemptExecutorProjection.cases.Exact.make({ report }))
    })
  const unresolved = (kind: "Unavailable" | "Foreign") =>
    Effect.gen(function* () {
      const expected = { runId, attemptId: taskFacts.B.attemptId }
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
    candidateReads,
    journal,
    evidence,
    evidenceReads,
    head,
    promotions,
    promotionReads,
    publications,
    publicationQueue,
    releaseIntegration,
    runId,
    terminal,
    unresolved
  }
})
