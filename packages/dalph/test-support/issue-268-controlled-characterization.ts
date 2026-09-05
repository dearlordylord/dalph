import {
  AttemptId,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  type RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorRequest
} from "@dalph/contracts"
import {
  AllocatedWorkflowRunId,
  ClaimOwner,
  controlledTrackerMutationLayerFrom,
  CoordinatorOwnership,
  DeliveryActionExecutor,
  DeliveryRelationPublicationObserver,
  deterministicOperationIdAllocatorLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  GitTargetLineage,
  GitWorktree,
  gitTargetLineageTestLayer,
  gitWorktreeTestLayer,
  journaledRunBootstrapLayer,
  journaledWorkflowInterpreterLayer,
  JournalStore,
  journalStoreCapabilities,
  makeApplicationExitShell,
  makeLiveDeliveryActionExecutor,
  memoryJournalStoreLayer,
  noopJournalMaintenanceObservation,
  OperationIdAllocator,
  PlannedTaskAttemptPlanner,
  PlannedWorktreeAbsent,
  preservingDispositionCleanupBoundaryLayer,
  runWorkflowWithControlledDeliveryActionExecutor,
  taskClaimReacquisitionControlLayer,
  TaskClaimAcquisitionPlanner,
  taskWorkCapacityControlLayer,
  attemptChoiceControlWithProvidedProtocolLayer,
  controlDirectionApplicationLayer,
  type MaterializedDeliveryAction,
  type TaskClaimAcquisition,
  TargetLineageObservation,
  TestGitWorktree,
  TestTrackerGraphReader,
  TrackerGraphReader,
  type TrackerTarget,
  trackerGraphReaderTestLayer,
  TrackerMutation,
  validatedRunActivationLayer,
  workflowInterpreterLayer,
  WorkflowTrace,
  type DeliveryRelationInputBundle,
  type JournaledRuntimeLayerInput,
  type RunFinalityDecision,
  type TraceItem
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Fiber, Layer, Option, Queue, Ref } from "effect"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"
import type {
  Issue268Ds03Characterization,
  Issue268Ds03StartupCharacterization,
  Issue268ExecutorCommandCapture
} from "./issue-268-controlled-characterization-types.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "./controlled-synchronous-planned-attempt-executor.js"

const attemptIdByTaskId = new Map([
  [scenario.taskIds.A, scenario.attempts.A1],
  [scenario.taskIds.B, scenario.attempts.B1],
  [scenario.taskIds.C, scenario.attempts.C1],
  [scenario.taskIds.D, scenario.attempts.D1],
  [scenario.taskIds.E, AttemptId.make("attempt:E:1")]
])

const fixedAttemptPlannerLayer = Layer.effect(
  PlannedTaskAttemptPlanner,
  Effect.gen(function* () {
    const plans = yield* Ref.make<ReadonlyMap<string, PlannedTaskAttempt>>(new Map())
    return PlannedTaskAttemptPlanner.of({
      plan: (request) =>
        Effect.gen(function* () {
          const taskId = request.specification.taskId
          const attemptId = attemptIdByTaskId.get(taskId)
          if (attemptId === undefined) return yield* Effect.die(`unknown C2b task ${taskId}`)
          const existing = (yield* Ref.get(plans)).get(taskId)
          if (existing !== undefined) return existing
          const planned = PlannedTaskAttempt.make({
            attemptId,
            baseSha: request._tag === "Fresh" ? scenario.baseSha : request.baseSha,
            branch: TaskBranchRef.make(`refs/heads/dalph/issue-268-${taskId.toLowerCase()}-1`),
            executor: TaskExecutorLocator.make("executor:issue-268-controlled"),
            runId: scenario.runId,
            taskId,
            taskRevision: request.specification.fingerprint,
            worktree: WorktreeLocator.make(`/dalph/controlled-characterization/issue-268/${taskId}-1`)
          })
          yield* Ref.update(plans, (current) => new Map(current).set(taskId, planned))
          return planned
        })
    })
  })
)

const selectedTaskIds = [scenario.taskIds.A, scenario.taskIds.B, scenario.taskIds.C] as const

const requireExactlySelectedTaskIds = (checkpoint: string, observed: ReadonlyArray<string>) =>
  observed.length === selectedTaskIds.length && selectedTaskIds.every((taskId) => observed.includes(taskId))
    ? Effect.void
    : Effect.die(`${checkpoint} expected only A/B/C, observed ${observed.join(",")}`)

const releaseFor = <A>(taskId: string, controls: { readonly A: A; readonly B: A; readonly C: A }): A | undefined =>
  taskId === scenario.taskIds.A
    ? controls.A
    : taskId === scenario.taskIds.B
      ? controls.B
      : taskId === scenario.taskIds.C
        ? controls.C
        : undefined

const actionStage = (action: MaterializedDeliveryAction) => {
  const route = action.proposal.route
  return "step" in route ? { stage: route.step._tag, taskId: route.step.task.id } : undefined
}

const runIssue268StartupCharacterizationFor = (mode: "DS01" | "DS02" | "DS03") =>
  Effect.scoped(
    Effect.gen(function* () {
      const claimRequestQueue = yield* Queue.unbounded<TaskClaimAcquisition>()
      const claimRequests = yield* Ref.make<ReadonlyArray<TaskClaimAcquisition>>([])
      const claimReleaseOrder = yield* Ref.make<ReadonlyArray<string>>([])
      const claimReleases = {
        A: yield* Deferred.make<void>(),
        B: yield* Deferred.make<void>(),
        C: yield* Deferred.make<void>()
      }
      const pendingClaimQueue = yield* Queue.unbounded<string>()
      const pendingClaimTaskIds = yield* Ref.make<ReadonlyArray<string>>([])
      const ds01ClaimGate = yield* Deferred.make<void>()
      const executedActions = yield* Ref.make<ReadonlyArray<{ readonly stage: string; readonly taskId: string }>>([])
      const projectedReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
      const commands = yield* Ref.make<ReadonlyArray<Issue268ExecutorCommandCapture>>([])
      const plans = yield* Ref.make<ReadonlyArray<PlannedTaskAttempt>>([])
      const executor = PlannedAttemptExecutor.of({
        observe: (correlation) =>
          Ref.get(projectedReports).pipe(
            Effect.map((reports) => {
              const report = reports.get(plannedAttemptExecutorCorrelationKey(correlation))
              return report === undefined
                ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
            })
          ),
        begin: (request: PlannedAttemptExecutorRequest) =>
          Effect.gen(function* () {
            const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
              correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
            })
            yield* Ref.update(commands, (current) => [
              ...current,
              { attemptId: request.plannedAttempt.attemptId, command: "Begin" as const }
            ])
            yield* Ref.update(plans, (current) => [...current, request.plannedAttempt])
            yield* Ref.update(projectedReports, (current) =>
              new Map(current).set(plannedAttemptExecutorCorrelationKey(report.correlation), report)
            )
            return report
          }),
        requestSuspension: (plannedAttempt) => Effect.die(`C2b startup must not suspend ${plannedAttempt.attemptId}`),
        resume: (request) => Effect.die(`C2b startup must not resume ${request.plannedAttempt.attemptId}`)
      })
      const executorLayer = controlledSynchronousPlannedAttemptExecutorLayer(
        Layer.succeed(PlannedAttemptExecutor, executor)
      )
      const sharedContext = yield* Layer.build(
        Layer.mergeAll(
          memoryJournalStoreLayer,
          controlledTrackerMutationLayerFrom([]),
          trackerGraphReaderTestLayer(scenario.graphs.G0, Object.values(scenario.specifications.F1)),
          gitWorktreeTestLayer(PlannedWorktreeAbsent.make({})),
          gitTargetLineageTestLayer(
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: scenario.baseSha,
              targetHeadSha: scenario.baseSha
            })
          )
        )
      )
      const sharedJournal = Context.get(sharedContext, JournalStore)
      const journalLayer = journalStoreCapabilities(Layer.succeed(JournalStore, sharedJournal))
      const trackerGraphReaderLayer = Layer.succeed(TrackerGraphReader, Context.get(sharedContext, TrackerGraphReader))
      const baseTrackerMutation = Context.get(sharedContext, TrackerMutation)
      const controlledTrackerMutation = TrackerMutation.of({
        ...baseTrackerMutation,
        acquireTaskClaim: (acquisition) =>
          Effect.gen(function* () {
            yield* Ref.update(claimRequests, (current) => [...current, acquisition])
            yield* Queue.offer(claimRequestQueue, acquisition)
            if (mode !== "DS01") {
              const release = releaseFor(acquisition.taskId, claimReleases)
              if (release === undefined)
                return yield* Effect.die(`outside-bound claim request for ${acquisition.taskId}`)
              yield* Deferred.await(release)
            }
            return yield* baseTrackerMutation.acquireTaskClaim(acquisition)
          })
      })
      const trackerMutationLayer = Layer.succeed(TrackerMutation, controlledTrackerMutation)
      const testTrackerGraphReader = Context.get(sharedContext, TestTrackerGraphReader)
      const gitWorktreeLayer = Layer.succeed(GitWorktree, Context.get(sharedContext, GitWorktree))
      const testGitWorktree = Context.get(sharedContext, TestGitWorktree)
      const gitTargetLineageLayer = Layer.succeed(GitTargetLineage, Context.get(sharedContext, GitTargetLineage))
      const traceItems = yield* Ref.make<ReadonlyArray<TraceItem>>([])
      const trace = WorkflowTrace.of({ emit: (item) => Ref.update(traceItems, (current) => [...current, item]) })
      const publications = yield* Ref.make<ReadonlyArray<DeliveryRelationInputBundle>>([])
      const publicationQueue = yield* Queue.unbounded<DeliveryRelationInputBundle>()
      const publicationObserver = DeliveryRelationPublicationObserver.of({
        observe: (bundle) =>
          Effect.all([
            Ref.update(publications, (current) => [...current, bundle]),
            Queue.offer(publicationQueue, bundle)
          ]).pipe(Effect.asVoid)
      })
      const ordinaryInterpreterLayer = workflowInterpreterLayer.pipe(
        Layer.provide(Layer.merge(trackerGraphReaderLayer, trackerMutationLayer)),
        Layer.provide(gitWorktreeLayer),
        Layer.provide(gitTargetLineageLayer)
      )
      const planningLayer = Layer.mergeAll(
        deterministicOperationIdAllocatorLayer(`issue-268:${scenario.runId}:startup`),
        deterministicTaskClaimAcquisitionPlannerLayer({
          owner: ClaimOwner.make("issue-268-controlled-owner"),
          tokenPrefix: "issue-268-controlled-claim"
        }),
        fixedAttemptPlannerLayer
      )
      const planningContext = yield* Layer.build(planningLayer)
      const sharedPlanningLayer = Layer.mergeAll(
        Layer.succeed(OperationIdAllocator, Context.get(planningContext, OperationIdAllocator)),
        Layer.succeed(TaskClaimAcquisitionPlanner, Context.get(planningContext, TaskClaimAcquisitionPlanner)),
        Layer.succeed(PlannedTaskAttemptPlanner, Context.get(planningContext, PlannedTaskAttemptPlanner))
      )
      const controls = Layer.mergeAll(
        attemptChoiceControlWithProvidedProtocolLayer,
        controlDirectionApplicationLayer,
        taskClaimReacquisitionControlLayer,
        taskWorkCapacityControlLayer
      )
      const coordinatorOwnership = CoordinatorOwnership.of({
        release: Effect.void,
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(coordinatorOwnership, { requestEnd: () => Effect.void })
      const runtimeLayer = ({ opportunity }: JournaledRuntimeLayerInput) =>
        validatedRunActivationLayer(
          scenario.runId,
          scenario.integrationTarget,
          undefined,
          undefined,
          undefined,
          preservingDispositionCleanupBoundaryLayer,
          undefined,
          false,
          opportunity
        ).pipe(
          Layer.provide(journaledWorkflowInterpreterLayer(scenario.runId, ordinaryInterpreterLayer)),
          Layer.provide(controls),
          Layer.provide(executorLayer),
          Layer.provide(Layer.succeed(WorkflowTrace, trace)),
          Layer.provide(sharedPlanningLayer)
        )
      const application = journaledRunBootstrapLayer(
        scenario.runId,
        runtimeLayer,
        applicationExit,
        noopJournalMaintenanceObservation
      ).pipe(
        Layer.provide(journalLayer),
        Layer.provide(Layer.succeed(CoordinatorOwnership, coordinatorOwnership)),
        Layer.provide(executorLayer)
      )
      const controlledExecutorFactory = (runId: RunId, target: TrackerTarget) =>
        Effect.gen(function* () {
          const live = yield* makeLiveDeliveryActionExecutor(runId, target)
          return DeliveryActionExecutor.of({
            execute: (action, lease) =>
              Effect.gen(function* () {
                const stage = actionStage(action)
                if (mode === "DS01" && stage?.stage === "AcquireTaskClaim") {
                  yield* Ref.update(pendingClaimTaskIds, (current) => [...current, stage.taskId])
                  yield* Queue.offer(pendingClaimQueue, stage.taskId)
                  yield* Deferred.await(ds01ClaimGate)
                }
                if (stage !== undefined) {
                  yield* Ref.update(executedActions, (current) => [...current, stage])
                }
                return yield* live.execute(action, lease)
              })
          })
        })
      const fiber = yield* runWorkflowWithControlledDeliveryActionExecutor(
        scenario.target,
        Effect.succeed(scenario.policies.P1),
        AllocatedWorkflowRunId.make(scenario.runId),
        controlledExecutorFactory,
        false
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            application,
            sharedPlanningLayer,
            Layer.succeed(DeliveryRelationPublicationObserver, publicationObserver)
          )
        ),
        Effect.forkChild
      )

      const takeWhileRuntimeActive = <A>(queue: Queue.Dequeue<A>): Effect.Effect<A> =>
        Queue.take(queue).pipe(
          Effect.raceFirst(
            Fiber.await(fiber).pipe(
              Effect.flatMap((exit) => Effect.die(`C2b runtime exited before its checkpoint: ${exit._tag}`))
            )
          )
        )

      const awaitHeld = (attemptId: string): Effect.Effect<void> =>
        takeWhileRuntimeActive(publicationQueue).pipe(
          Effect.flatMap((bundle) =>
            bundle.actionInputs.runtimeFacts.taskWork.held.some(
              ({ correlation }) => correlation.attemptId === attemptId
            )
              ? Effect.void
              : awaitHeld(attemptId)
          )
        )

      const ds03Snapshot = () =>
        Effect.all({
          claimRequests: Ref.get(claimRequests),
          commands: Ref.get(commands),
          executedActions: Ref.get(executedActions),
          plans: Ref.get(plans),
          publications: Ref.get(publications),
          records: sharedJournal.read(scenario.runId),
          requestedTargets: testTrackerGraphReader.requestedTargets(),
          trace: Ref.get(traceItems),
          worktreeCreateRequests: testGitWorktree.createRequests()
        })

      let decision: RunFinalityDecision | undefined
      let ds03: Issue268Ds03Characterization | undefined
      if (mode === "DS01") {
        const pending = yield* Effect.forEach(selectedTaskIds, () => takeWhileRuntimeActive(pendingClaimQueue))
        yield* requireExactlySelectedTaskIds("DS-01 pending claims", pending)
        yield* Fiber.interrupt(fiber)
      } else {
        const pending = yield* Effect.forEach(selectedTaskIds, () => takeWhileRuntimeActive(claimRequestQueue))
        const pendingTaskIds = pending.map(({ taskId }) => taskId)
        yield* requireExactlySelectedTaskIds("R1 claim requests", pendingTaskIds)
        for (const taskId of selectedTaskIds) {
          const release = releaseFor(taskId, claimReleases)
          if (release === undefined) return yield* Effect.die(`missing R1 release for ${taskId}`)
          yield* Ref.update(claimReleaseOrder, (current) => [...current, taskId])
          yield* Deferred.succeed(release, undefined)
          const attemptId = releaseFor(taskId, {
            A: scenario.attempts.A1,
            B: scenario.attempts.B1,
            C: scenario.attempts.C1
          })
          if (attemptId === undefined) return yield* Effect.die(`missing attempt for ${taskId}`)
          yield* awaitHeld(attemptId)
        }
        decision = yield* Fiber.join(fiber)
        if (mode === "DS03") {
          const before = yield* ds03Snapshot()
          const trackerBefore = yield* testTrackerGraphReader.inspectTask(scenario.taskIds.B)
          const priorSpecification = yield* Option.match(trackerBefore.specification, {
            onNone: () => Effect.die("DS-03 tracker lacks B/F1 before Alice's edit"),
            onSome: Effect.succeed
          })
          yield* testTrackerGraphReader.setTaskWorkSpecification(scenario.specifications.F2.B)
          yield* testTrackerGraphReader.setSnapshot(scenario.graphs.G1)
          const trackerAfter = yield* testTrackerGraphReader.inspectTask(scenario.taskIds.B)
          const nextSpecification = yield* Option.match(trackerAfter.specification, {
            onNone: () => Effect.die("DS-03 tracker lacks B/F2 after Alice's edit"),
            onSome: Effect.succeed
          })
          ds03 = {
            after: yield* ds03Snapshot(),
            before,
            edit: {
              graphRevision: trackerAfter.snapshot.revision,
              nextFingerprint: nextSpecification.fingerprint,
              priorFingerprint: priorSpecification.fingerprint,
              taskId: nextSpecification.taskId
            }
          }
        }
      }
      return {
        claimReleaseOrder: yield* Ref.get(claimReleaseOrder),
        claimRequests: yield* Ref.get(claimRequests),
        commands: yield* Ref.get(commands),
        decision,
        ds03,
        executedActions: yield* Ref.get(executedActions),
        pendingClaimTaskIds: yield* Ref.get(pendingClaimTaskIds),
        plans: yield* Ref.get(plans),
        publications: yield* Ref.get(publications),
        records: yield* sharedJournal.read(scenario.runId),
        trace: yield* Ref.get(traceItems),
        worktreeCreateRequests: yield* testGitWorktree.createRequests()
      }
    })
  )

/** Pauses after G0 placement and before any selected claim action executes. */
export const runIssue268Ds01Characterization = runIssue268StartupCharacterizationFor("DS01")

/** Releases the three independently pending claim responses in explicit R1 order. */
export const runIssue268Ds02Characterization = runIssue268StartupCharacterizationFor("DS02")

/** Applies Alice's external F2/G1 tracker edit after DS-02 without triggering a Dalph refresh. */
export const runIssue268Ds03Characterization = runIssue268StartupCharacterizationFor("DS03").pipe(
  Effect.flatMap(
    (run): Effect.Effect<Issue268Ds03StartupCharacterization> =>
      run.ds03 === undefined
        ? Effect.die("DS-03 runner completed without its required edit evidence")
        : Effect.succeed({ ...run, ds03: run.ds03 })
  )
)
