/* eslint-disable max-lines -- One scoped driver keeps the chronological DS-01 through DS-11 handoffs auditable. */
import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  passiveLifecycleObservationPurpose,
  type PlannedTaskAttempt,
  type RunId,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorRequest
} from "@dalph/contracts"
import {
  AllocatedWorkflowRunId,
  ApplicationExitShell,
  ClaimOwner,
  controlledTrackerMutationLayerFrom,
  CoordinatorOwnership,
  deliveryProposalOrderTaskId,
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
  JournaledRunBootstrap,
  RunReactivationOwner,
  RunReactivationHint,
  runReactivationOwnerLayer,
  runWorkflowWithControlledDeliveryActionExecutor,
  runWorkflowWithControlledDeliveryActionExecutorForActiveWorkAuthorityRefresh,
  taskClaimReacquisitionControlLayer,
  TaskClaimAcquisitionPlanner,
  taskWorkCapacityControlLayer,
  attemptChoiceControlWithProvidedProtocolLayer,
  controlDirectionApplicationLayer,
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
  type ApplicationExitTraceEvent,
  type DeliveryRelationInputBundle,
  type JournalRecord,
  type JournaledRuntimeLayerInput,
  type MaterializedDeliveryAction,
  type RunFinalityDecision,
  type RunActivationOpportunityValue,
  type RunReactivationOwnerService,
  type RunReactivationOwnerOptions,
  type TraceItem
} from "@dalph/orchestrator"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Ref, Scope, Stream } from "effect"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"
import type {
  Issue268Ds03BoundarySnapshot,
  Issue268Ds03Characterization,
  Issue268Ds03StartupCharacterization,
  Issue268Ds04Characterization,
  Issue268Ds04StartupCharacterization,
  Issue268Ds05Characterization,
  Issue268Ds05StartupCharacterization,
  Issue268Ds06Characterization,
  Issue268Ds06StartupCharacterization,
  Issue268Ds07Characterization,
  Issue268Ds07StartupCharacterization,
  Issue268Ds08BeforeLoss,
  Issue268Ds08Characterization,
  Issue268Ds08StartupCharacterization,
  Issue268Ds09Characterization,
  Issue268Ds09StartupCharacterization,
  Issue268Ds10Characterization,
  Issue268Ds10StartupCharacterization,
  Issue268Ds11Characterization,
  Issue268Ds11StartupCharacterization,
  Issue268ExecutorObservationCapture,
  Issue268ExecutorCommandCapture
} from "./issue-268-controlled-characterization-types.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "./controlled-synchronous-planned-attempt-executor.js"
import {
  actionStage,
  fixedAttemptPlannerLayer,
  releaseFor,
  requireExactlySelectedTaskIds,
  selectedTaskIds
} from "./issue-268-controlled-characterization-fixture.js"
import {
  isIssue268Ds04CompleteCheckpoint,
  isIssue268Ds04CheckpointPublication,
  runIssue268Ds04TimerCheckpoint
} from "./issue-268-controlled-ds04.js"
import { isIssue268Ds05CompleteCheckpoint } from "./issue-268-controlled-ds05.js"
import { isIssue268Ds06CompleteCheckpoint } from "./issue-268-controlled-ds06.js"
import { isIssue268Ds07CompleteCheckpoint } from "./issue-268-controlled-ds07.js"
import { isIssue268Ds10CompleteCheckpoint } from "./issue-268-controlled-ds10.js"
import { isIssue268Ds11CompleteCheckpoint } from "./issue-268-controlled-ds11.js"

const checkpointPublicationLimit = 128
type Issue268StartupMode = "DS01" | "DS02" | "DS03" | "DS04" | "DS05" | "DS06" | "DS07" | "DS08" | "DS09"
const ds04Modes: ReadonlySet<Issue268StartupMode> = new Set(["DS04", "DS05", "DS06", "DS07", "DS08"])
const ds05Modes: ReadonlySet<Issue268StartupMode> = new Set(["DS05", "DS06", "DS07", "DS08"])
const ds06Modes: ReadonlySet<Issue268StartupMode> = new Set(["DS06", "DS07", "DS08"])
const ds07Modes: ReadonlySet<Issue268StartupMode> = new Set(["DS07", "DS08"])

interface Issue268ProcessControls {
  readonly applicationBuildCount: Ref.Ref<number>
  readonly applicationExitTrace: Ref.Ref<ReadonlyArray<ApplicationExitTraceEvent>>
}

interface Issue268Ds08Controls extends Issue268ProcessControls {
  readonly beforeLoss: Ref.Ref<Issue268Ds08BeforeLoss | undefined>
  readonly childScopeFinalizationCount: Ref.Ref<number>
  readonly executorObserveCalls: Ref.Ref<number>
  readonly firstProcessReady: Deferred.Deferred<void>
  readonly p2PublicationReturned: Deferred.Deferred<void>
  readonly projectedReports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
  readonly snapshot: Ref.Ref<(() => Effect.Effect<Issue268Ds03BoundarySnapshot, unknown, never>) | undefined>
}

interface Issue268Ds09Controls extends Issue268ProcessControls {
  readonly after: Ref.Ref<Issue268Ds03BoundarySnapshot | undefined>
  readonly executorObserveCalls: Ref.Ref<number>
  readonly executorObservations: Ref.Ref<ReadonlyArray<Issue268ExecutorObservationCapture>>
  readonly observationAdmissions: Ref.Ref<
    ReadonlyMap<string, Pick<Issue268ExecutorObservationCapture, "admission" | "plannedAttempt">>
  >
  readonly observationReleases: ReadonlyArray<Deferred.Deferred<void>>
  readonly observationRequests: Queue.Queue<Issue268ExecutorObservationCapture>
  readonly observationReturned: ReadonlyArray<Deferred.Deferred<void>>
  readonly ordinaryOwnerActivationCount: Ref.Ref<number>
  readonly ordinaryOwnerActivationOpportunities: Ref.Ref<ReadonlyArray<"OrdinaryRunEntry">>
  readonly ownerFailure: Deferred.Deferred<unknown>
  readonly ownerRelease: Deferred.Deferred<void>
  readonly ownerStartup: Deferred.Deferred<{
    readonly decision: RunFinalityDecision
    readonly owner: RunReactivationOwnerService
  }>
  readonly projectedReports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
  readonly snapshot: Ref.Ref<(() => Effect.Effect<Issue268Ds03BoundarySnapshot, unknown, never>) | undefined>
  readonly ds10?: Issue268Ds10Controls
}

interface Issue268Ds10Controls {
  readonly activeRefreshCount: Ref.Ref<number>
  readonly activeRefreshDecision: Ref.Ref<RunFinalityDecision | undefined>
  readonly activeRefreshSettled: Deferred.Deferred<void>
  readonly activeRefreshSources: Ref.Ref<ReadonlyArray<"TrackerNotification">>
  readonly cLifecycleChanges: Queue.Queue<PlannedAttemptExecutorProjection>
  readonly checkpoint: Deferred.Deferred<DeliveryRelationInputBundle>
  readonly ds11?: Issue268Ds11Controls
  readonly idleHandoffCount: Ref.Ref<number>
  readonly idleHandoffReleases: ReadonlyArray<Deferred.Deferred<void>>
  readonly idleHandoffs: Queue.Queue<number>
  readonly phase: Ref.Ref<"DS09" | "DS10" | "DS11">
  readonly trailingActivationCount: Ref.Ref<number>
}

interface Issue268Ds11Controls {
  readonly checkpoint: Deferred.Deferred<DeliveryRelationInputBundle>
  readonly checkpointRelease: Deferred.Deferred<void>
}

interface Issue268SharedAuthorities {
  readonly gitTargetLineage: GitTargetLineage["Service"]
  readonly gitWorktree: GitWorktree["Service"]
  readonly journal: JournalStore["Service"]
  readonly testGitWorktree: TestGitWorktree["Service"]
  readonly testTrackerGraphReader: TestTrackerGraphReader["Service"]
  readonly trackerGraphReader: TrackerGraphReader["Service"]
  readonly trackerMutation: TrackerMutation["Service"]
}

interface Issue268StartupCharacterizationOptions {
  readonly ds08?: Issue268Ds08Controls
  readonly ds09?: Issue268Ds09Controls
  readonly sharedAuthorities?: Issue268SharedAuthorities
  readonly sharedAuthoritiesReady?: Deferred.Deferred<Issue268SharedAuthorities>
  readonly sharedScope?: Scope.Scope
}

const applicationExitTraceFor = (controls: Issue268ProcessControls | undefined) =>
  controls === undefined
    ? undefined
    : {
        emit: (event: ApplicationExitTraceEvent) =>
          Ref.update(controls.applicationExitTrace, (current) => [...current, event])
      }

const incrementApplicationBuildCount = (controls: Issue268ProcessControls | undefined) =>
  controls === undefined ? Effect.void : Ref.update(controls.applicationBuildCount, (count) => count + 1)

const signalP2PublicationReturned = (
  mode: Issue268StartupMode,
  bundle: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>,
  localSignal: Deferred.Deferred<void>,
  externalSignal: Deferred.Deferred<void> | undefined
) =>
  ds07Modes.has(mode) && isIssue268Ds07CompleteCheckpoint(bundle, records)
    ? Effect.gen(function* () {
        yield* Deferred.succeed(localSignal, undefined)
        if (externalSignal !== undefined) yield* Deferred.succeed(externalSignal, undefined)
      })
    : Effect.void

const runIssue268StartupCharacterizationFor = (
  mode: Issue268StartupMode,
  options: Issue268StartupCharacterizationOptions = {}
) =>
  Effect.suspend(() =>
    // eslint-disable-next-line complexity -- One chronological controlled driver preserves the exact DS-01 through DS-11 causal handoffs.
    Effect.gen(function* () {
      const ds08Controls = options.ds08
      const ds09Controls = options.ds09
      const processControls = ds08Controls ?? ds09Controls
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
      const projectedReports =
        ds08Controls?.projectedReports ??
        ds09Controls?.projectedReports ??
        (yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map()))
      const executorObserveCalls =
        ds08Controls?.executorObserveCalls ?? ds09Controls?.executorObserveCalls ?? (yield* Ref.make(0))
      const ds05LifecycleChanges = yield* Queue.unbounded<PlannedAttemptExecutorProjection>()
      const ds06DActionReached = yield* Deferred.make<void>()
      const ds06DActionRelease = yield* Deferred.make<void>()
      const ds06DActionAbsentBeforeBRelease = yield* Ref.make(false)
      const ds06R5ReleaseCount = yield* Ref.make(0)
      const lifecycleAttachAttemptIds = yield* Ref.make<ReadonlyArray<string>>([])
      const commands = yield* Ref.make<ReadonlyArray<Issue268ExecutorCommandCapture>>([])
      const plans = yield* Ref.make<ReadonlyArray<PlannedTaskAttempt>>([])
      const publications = yield* Ref.make<ReadonlyArray<DeliveryRelationInputBundle>>([])
      const publicationQueue = yield* Queue.unbounded<DeliveryRelationInputBundle>()
      const ds09ObservationIndex = yield* Ref.make(0)
      const executor = PlannedAttemptExecutor.of({
        observe: (correlation, purpose) =>
          // eslint-disable-next-line complexity -- Restart branches fail-close DS-09 observations plus DS-10/DS-11 suspension lifecycle gates.
          Effect.gen(function* () {
            yield* Ref.update(executorObserveCalls, (count) => count + 1)
            const reports = yield* Ref.get(projectedReports)
            const report = reports.get(plannedAttemptExecutorCorrelationKey(correlation))
            const projection =
              report === undefined
                ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
            if (ds09Controls === undefined) return projection
            if (purpose._tag !== "PassiveLifecycleObservation") {
              return yield* Effect.die(`DS-09 must not reconcile ${correlation.attemptId}`)
            }
            const currentPublication = (yield* Ref.get(publications)).findLast(
              ({ publication }) => publication.graph._tag === "GraphEstablished"
            )
            const index = yield* Ref.getAndUpdate(ds09ObservationIndex, (current) => current + 1)
            const expectedAttemptId = [scenario.attempts.A1, scenario.attempts.C1, scenario.attempts.D1][index]
            const release = ds09Controls.observationReleases[index]
            const returned = ds09Controls.observationReturned[index]
            if (expectedAttemptId === undefined || release === undefined || returned === undefined) {
              return yield* Effect.die(`DS-09 observed an unexpected executor attempt ${correlation.attemptId}`)
            }
            if (correlation.attemptId !== expectedAttemptId) {
              return yield* Effect.die(
                `DS-09 expected ${expectedAttemptId} passive observation, received ${correlation.attemptId}`
              )
            }
            const admission = (yield* Ref.get(ds09Controls.observationAdmissions)).get(
              plannedAttemptExecutorCorrelationKey(correlation)
            )
            if (admission === undefined) {
              return yield* Effect.die(`DS-09 observed ${correlation.attemptId} without its admitted action`)
            }
            const capture: Issue268ExecutorObservationCapture = {
              ...admission,
              correlation,
              currentGraphPublication: currentPublication,
              process: "DS09",
              projection,
              purpose
            }
            yield* Ref.update(ds09Controls.executorObservations, (current) => [...current, capture])
            yield* Queue.offer(ds09Controls.observationRequests, capture)
            yield* Deferred.await(release)
            yield* Deferred.succeed(returned, undefined)
            return projection
          }),
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
        requestSuspension: (plannedAttempt) =>
          Effect.gen(function* () {
            const ds10Phase = ds09Controls?.ds10 === undefined ? undefined : yield* Ref.get(ds09Controls.ds10.phase)
            const isDs04Suspend = ds04Modes.has(mode) && plannedAttempt.attemptId === scenario.attempts.B1
            const isDs10Suspend = ds10Phase === "DS10" && plannedAttempt.attemptId === scenario.attempts.C1
            if (!isDs04Suspend && !isDs10Suspend) {
              return yield* Effect.die(`C2b startup must not suspend ${plannedAttempt.attemptId}`)
            }
            yield* Ref.update(commands, (current) => [
              ...current,
              { attemptId: plannedAttempt.attemptId, command: "Suspend" as const }
            ])
            return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
              correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
            })
          }),
        resume: (request) => Effect.die(`C2b startup must not resume ${request.plannedAttempt.attemptId}`)
      })
      const executorLayer =
        ds05Modes.has(mode) || ds09Controls !== undefined
          ? Layer.merge(
              Layer.succeed(PlannedAttemptExecutor, executor),
              Layer.succeed(
                PlannedAttemptExecutorLifecycleObservation,
                PlannedAttemptExecutorLifecycleObservation.of({
                  attach: (correlation) =>
                    Effect.gen(function* () {
                      const current = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
                      yield* Ref.update(lifecycleAttachAttemptIds, (attemptIds) => [
                        ...attemptIds,
                        correlation.attemptId
                      ])
                      return {
                        changes:
                          correlation.attemptId === scenario.attempts.B1
                            ? Stream.fromQueue(ds05LifecycleChanges)
                            : ds09Controls?.ds10 !== undefined && correlation.attemptId === scenario.attempts.C1
                              ? Stream.fromQueue(ds09Controls.ds10.cLifecycleChanges)
                              : Stream.never,
                        close: Effect.void,
                        current
                      }
                    })
                })
              )
            )
          : controlledSynchronousPlannedAttemptExecutorLayer(Layer.succeed(PlannedAttemptExecutor, executor))
      const currentScope = yield* Effect.scope
      const sharedContext =
        options.sharedAuthorities === undefined
          ? yield* Layer.build(
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
            ).pipe(Scope.provide(options.sharedScope ?? currentScope))
          : Context.empty().pipe(
              Context.add(JournalStore, options.sharedAuthorities.journal),
              Context.add(TrackerMutation, options.sharedAuthorities.trackerMutation),
              Context.add(TrackerGraphReader, options.sharedAuthorities.trackerGraphReader),
              Context.add(TestTrackerGraphReader, options.sharedAuthorities.testTrackerGraphReader),
              Context.add(GitWorktree, options.sharedAuthorities.gitWorktree),
              Context.add(TestGitWorktree, options.sharedAuthorities.testGitWorktree),
              Context.add(GitTargetLineage, options.sharedAuthorities.gitTargetLineage)
            )
      const sharedAuthorities: Issue268SharedAuthorities = options.sharedAuthorities ?? {
        gitTargetLineage: Context.get(sharedContext, GitTargetLineage),
        gitWorktree: Context.get(sharedContext, GitWorktree),
        journal: Context.get(sharedContext, JournalStore),
        testGitWorktree: Context.get(sharedContext, TestGitWorktree),
        testTrackerGraphReader: Context.get(sharedContext, TestTrackerGraphReader),
        trackerGraphReader: Context.get(sharedContext, TrackerGraphReader),
        trackerMutation: Context.get(sharedContext, TrackerMutation)
      }
      if (options.sharedAuthoritiesReady !== undefined) {
        yield* Deferred.succeed(options.sharedAuthoritiesReady, sharedAuthorities)
      }
      const sharedJournal = sharedAuthorities.journal
      const journalLayer = journalStoreCapabilities(Layer.succeed(JournalStore, sharedJournal))
      const trackerGraphReaderLayer = Layer.succeed(TrackerGraphReader, sharedAuthorities.trackerGraphReader)
      const baseTrackerMutation = sharedAuthorities.trackerMutation
      const controlledTrackerMutation = TrackerMutation.of({
        ...baseTrackerMutation,
        acquireTaskClaim: (acquisition) =>
          Effect.gen(function* () {
            yield* Ref.update(claimRequests, (current) => [...current, acquisition])
            yield* Queue.offer(claimRequestQueue, acquisition)
            if (mode !== "DS01" && !(ds06Modes.has(mode) && acquisition.taskId === scenario.taskIds.D)) {
              const release = releaseFor(acquisition.taskId, claimReleases)
              if (release === undefined)
                return yield* Effect.die(`outside-bound claim request for ${acquisition.taskId}`)
              yield* Deferred.await(release)
            }
            return yield* baseTrackerMutation.acquireTaskClaim(acquisition)
          })
      })
      const trackerMutationLayer = Layer.succeed(TrackerMutation, controlledTrackerMutation)
      const testTrackerGraphReader = sharedAuthorities.testTrackerGraphReader
      const gitWorktreeLayer = Layer.succeed(GitWorktree, sharedAuthorities.gitWorktree)
      const testGitWorktree = sharedAuthorities.testGitWorktree
      const gitTargetLineageLayer = Layer.succeed(GitTargetLineage, sharedAuthorities.gitTargetLineage)
      const traceItems = yield* Ref.make<ReadonlyArray<TraceItem>>([])
      const trace = WorkflowTrace.of({ emit: (item) => Ref.update(traceItems, (current) => [...current, item]) })
      const ds04CheckpointPublicationRelease = yield* Deferred.make<void>()
      const ds05CheckpointPublicationReached = yield* Deferred.make<void>()
      const ds05CheckpointPublicationRelease = yield* Deferred.make<void>()
      const ds06CheckpointPublicationReached = yield* Deferred.make<void>()
      const ds06CheckpointPublicationRelease = yield* Deferred.make<void>()
      const ds07P2PublicationReached = yield* Deferred.make<void>()
      const ds07P2PublicationRelease = yield* Deferred.make<void>()
      const ds07P2PublicationReturned = yield* Deferred.make<void>()
      const ds04CheckpointBaseline = yield* Ref.make<number | undefined>(undefined)
      const holdDs04CheckpointPublication = (
        bundle: DeliveryRelationInputBundle,
        records: ReadonlyArray<JournalRecord>,
        baseline: number
      ) =>
        isIssue268Ds04CheckpointPublication(bundle) &&
        isIssue268Ds04CompleteCheckpoint(bundle, records.slice(baseline), scenario.attempts.B1)
          ? Deferred.await(ds04CheckpointPublicationRelease)
          : Effect.void
      const holdDs05CheckpointPublication = (
        bundle: DeliveryRelationInputBundle,
        records: ReadonlyArray<JournalRecord>
      ) =>
        ds05Modes.has(mode) && isIssue268Ds05CompleteCheckpoint(bundle, records)
          ? Deferred.succeed(ds05CheckpointPublicationReached, undefined).pipe(
              Effect.andThen(Deferred.await(ds05CheckpointPublicationRelease))
            )
          : Effect.void
      const holdDs06CheckpointPublication = (
        bundle: DeliveryRelationInputBundle,
        records: ReadonlyArray<JournalRecord>
      ) =>
        ds06Modes.has(mode) && isIssue268Ds06CompleteCheckpoint(bundle, records)
          ? Deferred.succeed(ds06CheckpointPublicationReached, undefined).pipe(
              Effect.andThen(Deferred.await(ds06CheckpointPublicationRelease))
            )
          : Effect.void
      const holdDs07P2Publication = (bundle: DeliveryRelationInputBundle, records: ReadonlyArray<JournalRecord>) =>
        ds07Modes.has(mode) && isIssue268Ds07CompleteCheckpoint(bundle, records)
          ? Deferred.succeed(ds07P2PublicationReached, undefined).pipe(
              Effect.andThen(Deferred.await(ds07P2PublicationRelease))
            )
          : Effect.void
      const publicationObserver = DeliveryRelationPublicationObserver.of({
        observe: (bundle) =>
          // eslint-disable-next-line complexity -- One observer routes content-qualified DS-04 through DS-11 checkpoint signals without changing production.
          Effect.gen(function* () {
            yield* Ref.update(publications, (current) => [...current, bundle])
            yield* Queue.offer(publicationQueue, bundle)
            const ds10Controls = ds09Controls?.ds10
            const restartPhase = ds10Controls === undefined ? undefined : yield* Ref.get(ds10Controls.phase)
            if (ds10Controls !== undefined && restartPhase === "DS10") {
              const records = yield* sharedJournal
                .read(scenario.runId)
                .pipe(Effect.catch((failure) => Effect.die(`DS-10 checkpoint Journal read failed: ${failure._tag}`)))
              if (isIssue268Ds10CompleteCheckpoint(bundle, records)) {
                yield* Deferred.succeed(ds10Controls.checkpoint, bundle)
              }
            }
            if (ds10Controls?.ds11 !== undefined && restartPhase === "DS11") {
              const records = yield* sharedJournal
                .read(scenario.runId)
                .pipe(Effect.catch((failure) => Effect.die(`DS-11 checkpoint Journal read failed: ${failure._tag}`)))
              if (isIssue268Ds11CompleteCheckpoint(bundle, records)) {
                yield* Deferred.succeed(ds10Controls.ds11.checkpoint, bundle)
                yield* Deferred.await(ds10Controls.ds11.checkpointRelease)
              }
            }
            const baseline = yield* Ref.get(ds04CheckpointBaseline)
            if (!ds04Modes.has(mode) || baseline === undefined) return
            const records = yield* sharedJournal
              .read(scenario.runId)
              .pipe(Effect.catch((failure) => Effect.die(`DS-04 checkpoint Journal read failed: ${failure._tag}`)))
            yield* holdDs04CheckpointPublication(bundle, records, baseline)
            yield* holdDs05CheckpointPublication(bundle, records)
            yield* holdDs06CheckpointPublication(bundle, records)
            yield* holdDs07P2Publication(bundle, records)
            yield* signalP2PublicationReturned(
              mode,
              bundle,
              records,
              ds07P2PublicationReturned,
              ds08Controls?.p2PublicationReturned
            )
          })
      })
      const ordinaryInterpreterLayer = workflowInterpreterLayer.pipe(
        Layer.provide(Layer.merge(trackerGraphReaderLayer, trackerMutationLayer)),
        Layer.provide(gitWorktreeLayer),
        Layer.provide(gitTargetLineageLayer)
      )
      const planningLayer = Layer.mergeAll(
        deterministicOperationIdAllocatorLayer(
          `issue-268:${scenario.runId}:${mode === "DS09" ? "restart" : "startup"}`
        ),
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
      const applicationExit = yield* makeApplicationExitShell(
        coordinatorOwnership,
        { requestEnd: () => Effect.void },
        applicationExitTraceFor(processControls)
      )
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
      const applicationContext = yield* Layer.build(application)
      yield* incrementApplicationBuildCount(processControls)
      const sharedBootstrap = Context.get(applicationContext, JournaledRunBootstrap)
      const sharedBootstrapLayer = Layer.succeed(JournaledRunBootstrap, sharedBootstrap)
      const controlledExecutorFactory = (runId: RunId, target: TrackerTarget) =>
        Effect.gen(function* () {
          const live = yield* makeLiveDeliveryActionExecutor(runId, target)
          const validateRestartAction = (action: MaterializedDeliveryAction) =>
            // eslint-disable-next-line complexity -- Restart admission is fail-closed across the exact DS-09 and DS-10 action vocabularies.
            Effect.gen(function* () {
              if (ds09Controls === undefined) return
              if (action._tag === "FreshOperationAction" && action.proposal.route._tag === "TrackerGraphReadRoute") {
                return
              }
              const ds10Phase = ds09Controls.ds10 === undefined ? undefined : yield* Ref.get(ds09Controls.ds10.phase)
              if (ds10Phase === "DS11") {
                return yield* Effect.die("DS-11 materialized an unexpected delivery action")
              }
              if (ds10Phase === "DS10") {
                const orderedTaskId = deliveryProposalOrderTaskId(action.proposal.order)
                if (
                  action._tag === "FreshOperationAction" &&
                  action.proposal.route._tag === "RecoveredNewActionRoute"
                ) {
                  const recovered = action.proposal.route.action
                  if (
                    recovered._tag === "ReadTrackerGraph" &&
                    recovered.plannedAttempt.attemptId === scenario.attempts.A1
                  ) {
                    return
                  }
                  if (
                    (recovered._tag === "ReadTaskWorkSpecification" ||
                      recovered._tag === "ReadTaskClaim" ||
                      recovered._tag === "ReadTaskWorktree" ||
                      recovered._tag === "ReadTargetLineage") &&
                    recovered.plannedAttempt !== null &&
                    ((orderedTaskId === scenario.taskIds.A &&
                      recovered.plannedAttempt.attemptId === scenario.attempts.A1) ||
                      (orderedTaskId === scenario.taskIds.D &&
                        recovered.plannedAttempt.attemptId === scenario.attempts.D1))
                  ) {
                    return
                  }
                }
                if (
                  orderedTaskId === scenario.taskIds.C &&
                  action._tag === "IdentityFreeAction" &&
                  action.proposal.route._tag === "IdentityFreeWorkflowRoute" &&
                  action.proposal.route.transition._tag === "SuspendPlannedAttemptExecutorWork" &&
                  action.proposal.route.transition.plannedAttempt.attemptId === scenario.attempts.C1
                ) {
                  return
                }
                return yield* Effect.die(`DS-10 materialized unexpected action for ${orderedTaskId ?? "the Run"}`)
              }
              if (
                action._tag !== "IdentityFreeAction" ||
                action.proposal.route._tag !== "IdentityFreeWorkflowRoute" ||
                action.proposal.route.transition._tag !== "ObservePlannedAttemptExecutorWork"
              ) {
                return yield* Effect.die(`DS-09 materialized unexpected action ${action._tag}`)
              }
              const { admission } = action.proposal
              const { plannedAttempt } = action.proposal.route.transition
              const expectedCorrelation = plannedAttemptExecutorCorrelation(plannedAttempt)
              if (
                admission.taskWorkPosition._tag !== "TaskWorkPositionRequired" ||
                admission.taskWorkPosition.mode !== "ReserveOrReuse" ||
                admission.taskWorkPosition.taskId !== plannedAttempt.taskId ||
                admission.plannedAttemptProtocol._tag !== "PlannedAttemptProtocolRequired" ||
                plannedAttemptExecutorCorrelationKey(admission.plannedAttemptProtocol.correlation) !==
                  plannedAttemptExecutorCorrelationKey(expectedCorrelation)
              ) {
                return yield* Effect.die(
                  `DS-09 admitted ${plannedAttempt.attemptId} without exact reusable-position authority`
                )
              }
              const taskWorkPosition = admission.taskWorkPosition
              const plannedAttemptProtocolCorrelation = admission.plannedAttemptProtocol.correlation
              yield* Ref.update(ds09Controls.observationAdmissions, (current) =>
                new Map(current).set(plannedAttemptExecutorCorrelationKey(expectedCorrelation), {
                  admission: { plannedAttemptProtocolCorrelation, taskWorkPosition },
                  plannedAttempt
                })
              )
            })
          const awaitDs01Claim = (stage: ReturnType<typeof actionStage>) =>
            mode === "DS01" && stage?.stage === "AcquireTaskClaim"
              ? Effect.gen(function* () {
                  yield* Ref.update(pendingClaimTaskIds, (current) => [...current, stage.taskId])
                  yield* Queue.offer(pendingClaimQueue, stage.taskId)
                  yield* Deferred.await(ds01ClaimGate)
                })
              : Effect.void
          const holdDs05AdditionalClaim = (stage: ReturnType<typeof actionStage>) =>
            mode === "DS05" &&
            stage?.stage === "AcquireTaskClaim" &&
            (stage.taskId === scenario.taskIds.D || stage.taskId === scenario.taskIds.E)
              ? Effect.never
              : Effect.void
          const awaitDs06DAction = (stage: ReturnType<typeof actionStage>) =>
            ds06Modes.has(mode) && stage?.taskId === scenario.taskIds.D
              ? Effect.gen(function* () {
                  yield* Deferred.succeed(ds06DActionReached, undefined)
                  yield* Deferred.await(ds06DActionRelease)
                })
              : Effect.void
          const rejectDs06EAction = (stage: ReturnType<typeof actionStage>) =>
            ds06Modes.has(mode) && stage?.taskId === scenario.taskIds.E
              ? Effect.die("DS-06 must not materialize any E action")
              : Effect.void
          return DeliveryActionExecutor.of({
            execute: (action, lease) =>
              Effect.gen(function* () {
                const stage = actionStage(action)
                yield* validateRestartAction(action)
                yield* rejectDs06EAction(stage)
                yield* awaitDs01Claim(stage)
                yield* holdDs05AdditionalClaim(stage)
                yield* awaitDs06DAction(stage)
                if (stage !== undefined) {
                  yield* Ref.update(executedActions, (current) => [...current, stage])
                }
                return yield* live.execute(action, lease)
              })
          })
        })
      const activationLayer = Layer.mergeAll(
        sharedBootstrapLayer,
        sharedPlanningLayer,
        Layer.succeed(DeliveryRelationPublicationObserver, publicationObserver)
      )
      const ordinaryActivation = (opportunity?: RunActivationOpportunityValue) =>
        runWorkflowWithControlledDeliveryActionExecutor(
          scenario.target,
          mode === "DS09"
            ? Effect.die("DS-09 must reconstruct the existing Run")
            : Effect.succeed(scenario.policies.P1),
          AllocatedWorkflowRunId.make(scenario.runId),
          controlledExecutorFactory,
          false,
          opportunity
        ).pipe(Effect.provide(activationLayer))
      const fiber = yield* (
        ds09Controls === undefined
          ? ordinaryActivation()
          : Effect.gen(function* () {
              const activationResult = yield* Ref.make<RunFinalityDecision | undefined>(undefined)
              const activationSettled = yield* Deferred.make<void>()
              const ds10Controls = ds09Controls.ds10
              const activeRefresh = (source: "TrackerNotification" | "Timer") => {
                if (ds10Controls === undefined) {
                  return Effect.die(`DS-09 received an unexpected ${source} refresh before restart settlement`)
                }
                if (source !== "TrackerNotification") {
                  return Effect.die(`DS-10 received unexpected active refresh source ${source}`)
                }
                return Effect.gen(function* () {
                  yield* Ref.update(ds10Controls.activeRefreshCount, (count) => count + 1)
                  yield* Ref.update(ds10Controls.activeRefreshSources, (current) => [...current, source])
                  const result = yield* runWorkflowWithControlledDeliveryActionExecutorForActiveWorkAuthorityRefresh(
                    scenario.target,
                    Effect.die("DS-10 must refresh the existing Run"),
                    AllocatedWorkflowRunId.make(scenario.runId),
                    controlledExecutorFactory,
                    source,
                    false
                  ).pipe(Effect.provide(activationLayer))
                  yield* Ref.set(ds10Controls.activeRefreshDecision, result)
                  return result
                })
              }
              const ownerLayer = runReactivationOwnerLayer({
                activate: (opportunity) =>
                  Effect.gen(function* () {
                    if (opportunity._tag !== "OrdinaryRunEntry") {
                      return yield* Effect.die("DS-09 owner invoked its ordinary callback with an active refresh")
                    }
                    yield* Ref.update(ds09Controls.ordinaryOwnerActivationCount, (count) => count + 1)
                    yield* Ref.update(ds09Controls.ordinaryOwnerActivationOpportunities, (current) => [
                      ...current,
                      opportunity._tag
                    ])
                    const result = yield* ordinaryActivation(opportunity)
                    yield* Ref.set(activationResult, result)
                    return result
                  }),
                activateActiveWorkAuthorityRefresh: activeRefresh,
                activationInterval: "1 hour",
                failureCooldown: "1 hour",
                installAcceptedRunReactivationObservers: ({ acceptedFactPublication, control }) =>
                  sharedBootstrap
                    .registerAcceptedRunReactivationObservers({
                      acceptedFactPublication: () => acceptedFactPublication,
                      control
                    })
                    .pipe(Effect.orDie),
                isTerminationFailure: () => false,
                onActivationFinalizationStart: (kind) => {
                  if (kind === "Ordinary") return Deferred.succeed(activationSettled, undefined).pipe(Effect.asVoid)
                  return ds10Controls === undefined
                    ? Effect.die("DS-09 finalized an unexpected active refresh")
                    : Deferred.succeed(ds10Controls.activeRefreshSettled, undefined).pipe(Effect.asVoid)
                },
                ...(ds10Controls === undefined
                  ? {}
                  : {
                      onActivationHandoffIdle: () =>
                        Effect.gen(function* () {
                          const count = yield* Ref.updateAndGet(ds10Controls.idleHandoffCount, (current) => current + 1)
                          yield* Queue.offer(ds10Controls.idleHandoffs, count)
                          const release = ds10Controls.idleHandoffReleases[count - 1]
                          if (release === undefined) {
                            return yield* Effect.die(`DS-10 observed unexpected idle handoff ${count}`)
                          }
                          yield* Deferred.await(release)
                        }),
                      onTrailingActivationRecorded: () =>
                        Ref.update(ds10Controls.trailingActivationCount, (count) => count + 1)
                    }),
                onFailure: (failure) => Deferred.succeed(ds09Controls.ownerFailure, failure).pipe(Effect.asVoid),
                readControl: sharedBootstrap.readRunReactivationControl(scenario.target, scenario.runId),
                runId: scenario.runId
              }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)))
              return yield* Effect.gen(function* () {
                const owner = yield* RunReactivationOwner
                yield* Deferred.await(activationSettled).pipe(
                  Effect.raceFirst(
                    Deferred.await(ds09Controls.ownerFailure).pipe(
                      Effect.flatMap((failure) => Effect.die(`DS-09 reactivation owner failed: ${String(failure)}`))
                    )
                  )
                )
                const result = yield* Ref.get(activationResult)
                if (result === undefined) return yield* Effect.die("DS-09 owner finalized without an activation result")
                yield* Deferred.succeed(ds09Controls.ownerStartup, { decision: result, owner })
                yield* Deferred.await(ds09Controls.ownerRelease)
                return result
              }).pipe(Effect.provide(ownerLayer))
            })
      ).pipe(Effect.forkIn(currentScope))

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
      if (ds09Controls !== undefined) yield* Ref.set(ds09Controls.snapshot, ds03Snapshot)

      let decision: RunFinalityDecision | undefined
      let ds03: Issue268Ds03Characterization | undefined
      let ds04: Issue268Ds04Characterization | undefined
      let ds05: Issue268Ds05Characterization | undefined
      let ds06: Issue268Ds06Characterization | undefined
      let ds07: Issue268Ds07Characterization | undefined

      const makeCheckpointInput = (beforeTimer: Issue268Ds03BoundarySnapshot, startupDecision: RunFinalityDecision) => {
        const activationLayer = Layer.mergeAll(
          sharedBootstrapLayer,
          sharedPlanningLayer,
          Layer.succeed(DeliveryRelationPublicationObserver, publicationObserver)
        )
        return {
          activateActiveRefresh: (source: "TrackerNotification" | "Timer") =>
            runWorkflowWithControlledDeliveryActionExecutorForActiveWorkAuthorityRefresh(
              scenario.target,
              Effect.succeed(scenario.policies.P1),
              AllocatedWorkflowRunId.make(scenario.runId),
              controlledExecutorFactory,
              source,
              false
            ).pipe(Effect.provide(activationLayer)),
          applicationExit,
          attemptId: scenario.attempts.B1,
          beforeTimer,
          installObservers: (
            observers: Parameters<RunReactivationOwnerOptions<never>["installAcceptedRunReactivationObservers"]>[0]
          ) =>
            sharedBootstrap
              .registerAcceptedRunReactivationObservers({
                control: observers.control,
                acceptedFactPublication: () => observers.acceptedFactPublication
              })
              .pipe(Effect.orDie),
          nextPublication: Queue.take(publicationQueue),
          readControl: sharedBootstrap.readRunReactivationControl(scenario.target, scenario.runId),
          readRecords: sharedJournal.read(scenario.runId),
          releaseCheckpointPublication: Deferred.succeed(ds04CheckpointPublicationRelease, undefined).pipe(
            Effect.asVoid
          ),
          runId: scenario.runId,
          snapshot: ds03Snapshot(),
          startupDecision
        }
      }

      const runDs04Checkpoint = (beforeTimer: Issue268Ds03BoundarySnapshot, startupDecision: RunFinalityDecision) =>
        Effect.gen(function* () {
          const timer = yield* runIssue268Ds04TimerCheckpoint(makeCheckpointInput(beforeTimer, startupDecision))
          ds04 = timer.checkpoint
        })

      const runDs05Checkpoint = (beforeTimer: Issue268Ds03BoundarySnapshot, startupDecision: RunFinalityDecision) =>
        Effect.gen(function* () {
          const awaitDs05Checkpoint = (
            remaining = checkpointPublicationLimit
          ): Effect.Effect<{
            readonly after: Issue268Ds03BoundarySnapshot
            readonly checkpointPublication: DeliveryRelationInputBundle
          }> =>
            Queue.take(publicationQueue).pipe(
              Effect.flatMap((publication) =>
                sharedJournal.read(scenario.runId).pipe(
                  Effect.catch((failure) => Effect.die(`DS-05 checkpoint Journal read failed: ${failure._tag}`)),
                  Effect.map((records) => ({ publication, records }))
                )
              ),
              Effect.flatMap(({ publication, records }) =>
                isIssue268Ds05CompleteCheckpoint(publication, records)
                  ? Deferred.await(ds05CheckpointPublicationReached).pipe(
                      Effect.andThen(ds03Snapshot()),
                      Effect.catch((failure) => Effect.die(`DS-05 checkpoint snapshot failed: ${failure._tag}`)),
                      Effect.map((after) => ({ after, checkpointPublication: publication }))
                    )
                  : remaining === 0
                    ? Effect.die("DS-05 exceeded its bounded publication search")
                    : awaitDs05Checkpoint(remaining - 1)
              )
            )
          const timer = yield* runIssue268Ds04TimerCheckpoint(makeCheckpointInput(beforeTimer, startupDecision), {
            awaitResult: awaitDs05Checkpoint().pipe(
              Effect.ensuring(Deferred.succeed(ds05CheckpointPublicationRelease, undefined))
            ),
            begin: Effect.gen(function* () {
              const report = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
                correlation: plannedAttemptExecutorCorrelation(
                  yield* Ref.get(plans).pipe(
                    Effect.flatMap((current) => {
                      const plannedAttempt = current.find(({ attemptId }) => attemptId === scenario.attempts.B1)
                      return plannedAttempt === undefined
                        ? Effect.die("DS-05 cannot find B1's retained plan")
                        : Effect.succeed(plannedAttempt)
                    })
                  )
                )
              })
              yield* Ref.update(projectedReports, (current) =>
                new Map(current).set(plannedAttemptExecutorCorrelationKey(report.correlation), report)
              )
              yield* Queue.offer(ds05LifecycleChanges, PlannedAttemptExecutorProjection.cases.Exact.make({ report }))
            })
          })
          ds04 = timer.checkpoint
          if (timer.continuation === undefined) return yield* Effect.die("DS-05 continuation did not run")
          ds05 = {
            ...timer.continuation,
            beforeSafe: timer.checkpoint.after,
            lifecycleAttachAttemptIds: yield* Ref.get(lifecycleAttachAttemptIds)
          }
        })

      const runDs06Checkpoint = (beforeTimer: Issue268Ds03BoundarySnapshot, startupDecision: RunFinalityDecision) =>
        Effect.gen(function* () {
          const awaitDs05Checkpoint = (
            remaining = checkpointPublicationLimit
          ): Effect.Effect<{
            readonly after: Issue268Ds03BoundarySnapshot
            readonly checkpointPublication: DeliveryRelationInputBundle
          }> =>
            Queue.take(publicationQueue).pipe(
              Effect.flatMap((publication) =>
                sharedJournal.read(scenario.runId).pipe(
                  Effect.catch((failure) => Effect.die(`DS-05 checkpoint Journal read failed: ${failure._tag}`)),
                  Effect.map((records) => ({ publication, records }))
                )
              ),
              Effect.flatMap(({ publication, records }) =>
                isIssue268Ds05CompleteCheckpoint(publication, records)
                  ? Deferred.await(ds05CheckpointPublicationReached).pipe(
                      Effect.andThen(ds03Snapshot()),
                      Effect.catch((failure) => Effect.die(`DS-05 checkpoint snapshot failed: ${failure._tag}`)),
                      Effect.map((after) => ({ after, checkpointPublication: publication }))
                    )
                  : remaining === 0
                    ? Effect.die("DS-06 exceeded its bounded search for the DS-05 checkpoint")
                    : awaitDs05Checkpoint(remaining - 1)
              )
            )
          const awaitDs06Checkpoint = (
            remaining = checkpointPublicationLimit
          ): Effect.Effect<{
            readonly after: Issue268Ds03BoundarySnapshot
            readonly checkpointPublication: DeliveryRelationInputBundle
          }> =>
            Queue.take(publicationQueue).pipe(
              Effect.flatMap((publication) =>
                sharedJournal.read(scenario.runId).pipe(
                  Effect.catch((failure) => Effect.die(`DS-06 checkpoint Journal read failed: ${failure._tag}`)),
                  Effect.map((records) => ({ publication, records })),
                  Effect.orDie
                )
              ),
              Effect.flatMap(({ publication, records }) =>
                isIssue268Ds06CompleteCheckpoint(publication, records)
                  ? Deferred.await(ds06CheckpointPublicationReached).pipe(
                      Effect.andThen(ds03Snapshot()),
                      Effect.orDie,
                      Effect.map((after) => ({ after, checkpointPublication: publication }))
                    )
                  : remaining === 0
                    ? Effect.die("DS-06 exceeded its bounded publication search")
                    : awaitDs06Checkpoint(remaining - 1)
              )
            )
          const awaitDs07Checkpoint = (
            remaining = checkpointPublicationLimit
          ): Effect.Effect<{
            readonly after: Issue268Ds03BoundarySnapshot
            readonly checkpointPublication: DeliveryRelationInputBundle
          }> =>
            Queue.take(publicationQueue).pipe(
              Effect.flatMap((publication) =>
                sharedJournal.read(scenario.runId).pipe(
                  Effect.catch((failure) => Effect.die(`DS-07 checkpoint Journal read failed: ${failure._tag}`)),
                  Effect.map((records) => ({ publication, records })),
                  Effect.orDie
                )
              ),
              Effect.flatMap(({ publication, records }) =>
                isIssue268Ds07CompleteCheckpoint(publication, records)
                  ? Deferred.await(ds07P2PublicationReached).pipe(
                      Effect.andThen(ds03Snapshot()),
                      Effect.orDie,
                      Effect.map((after) => ({ after, checkpointPublication: publication }))
                    )
                  : remaining === 0
                    ? Effect.die("DS-07 exceeded its bounded publication search")
                    : awaitDs07Checkpoint(remaining - 1)
              )
            )
          const timer = yield* runIssue268Ds04TimerCheckpoint(makeCheckpointInput(beforeTimer, startupDecision), {
            awaitResult: Effect.gen(function* () {
              const ds05Checkpoint = yield* awaitDs05Checkpoint()
              const earlyDAction = yield* Deferred.poll(ds06DActionReached)
              if (Option.isSome(earlyDAction)) {
                return yield* Effect.die("DS-06 materialized D work before B1's Safe publication released its position")
              }
              yield* Ref.set(ds06DActionAbsentBeforeBRelease, true)
              // The publication observer is intentionally held until this explicit release. D must not be awaited
              // while the accepted-fact publication remains blocked at the DS-05 callback boundary.
              yield* Deferred.succeed(ds05CheckpointPublicationRelease, undefined)
              yield* Deferred.await(ds06DActionReached)
              yield* Ref.update(ds06R5ReleaseCount, (count) => count + 1)
              yield* Deferred.succeed(ds06DActionRelease, undefined)
              const ds06Checkpoint = yield* awaitDs06Checkpoint()
              if (!ds07Modes.has(mode)) return { ds05Checkpoint, ds06Checkpoint }
              const beforeCapacity = yield* ds03Snapshot()
              const p1 = yield* sharedBootstrap.operatorControl.readTaskWorkCapacity(scenario.runId)
              const request = { capacity: scenario.policies.P2, expectedRevision: p1.revision, runId: scenario.runId }
              const returned = yield* sharedBootstrap.operatorControl.setTaskWorkCapacity(request)
              const records = yield* sharedJournal.read(scenario.runId)
              const capacityRecords = records.filter(({ event }) => event._tag === "TaskWorkCapacityChanged")
              const capacityRecord = capacityRecords[capacityRecords.length - 1]
              if (capacityRecord === undefined) return yield* Effect.die("DS-07 must record P2's capacity change")
              const readback = yield* sharedBootstrap.operatorControl.readTaskWorkCapacity(scenario.runId)
              // The DS-06 observer owns the publication gate; release it before waiting for its queued P2 refresh.
              yield* Deferred.succeed(ds06CheckpointPublicationRelease, undefined)
              const p2 = yield* awaitDs07Checkpoint().pipe(
                Effect.ensuring(Deferred.succeed(ds07P2PublicationRelease, undefined))
              )
              const ds07 = {
                after: p2.after,
                beforeCapacity,
                capacityRecord,
                checkpointPublication: ds06Checkpoint.checkpointPublication,
                p1,
                p2Publication: p2.checkpointPublication,
                readback,
                request,
                returned
              }
              if (ds08Controls !== undefined) {
                yield* Deferred.await(ds08Controls.p2PublicationReturned)
                const snapshot = yield* ds03Snapshot()
                yield* Ref.set(ds08Controls.beforeLoss, {
                  ds07,
                  executorObserveCalls: yield* Ref.get(ds08Controls.executorObserveCalls),
                  projectedReports: new Map(yield* Ref.get(ds08Controls.projectedReports)),
                  snapshot
                })
                yield* Ref.set(ds08Controls.snapshot, ds03Snapshot)
                yield* Deferred.succeed(ds08Controls.firstProcessReady, undefined)
                return yield* Effect.never
              }
              return { ds05Checkpoint, ds06Checkpoint, ds07 }
            }).pipe(
              Effect.ensuring(
                Effect.all([
                  Deferred.succeed(ds05CheckpointPublicationRelease, undefined),
                  Deferred.succeed(ds06CheckpointPublicationRelease, undefined),
                  Deferred.succeed(ds07P2PublicationRelease, undefined)
                ]).pipe(Effect.asVoid)
              )
            ),
            begin: Effect.gen(function* () {
              const report = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
                correlation: plannedAttemptExecutorCorrelation(
                  yield* Ref.get(plans).pipe(
                    Effect.flatMap((current) => {
                      const plannedAttempt = current.find(({ attemptId }) => attemptId === scenario.attempts.B1)
                      return plannedAttempt === undefined
                        ? Effect.die("DS-06 cannot find B1's retained plan")
                        : Effect.succeed(plannedAttempt)
                    })
                  )
                )
              })
              yield* Ref.update(projectedReports, (current) =>
                new Map(current).set(plannedAttemptExecutorCorrelationKey(report.correlation), report)
              )
              yield* Queue.offer(ds05LifecycleChanges, PlannedAttemptExecutorProjection.cases.Exact.make({ report }))
            })
          })
          ds04 = timer.checkpoint
          if (timer.continuation === undefined) return yield* Effect.die("DS-06 continuation did not run")
          ds05 = {
            ...timer.continuation.ds05Checkpoint,
            beforeSafe: timer.checkpoint.after,
            lifecycleAttachAttemptIds: yield* Ref.get(lifecycleAttachAttemptIds)
          }
          ds06 = {
            ...timer.continuation.ds06Checkpoint,
            beforeD: timer.continuation.ds05Checkpoint.after,
            dActionAbsentBeforeBRelease: yield* Ref.get(ds06DActionAbsentBeforeBRelease),
            r5ReleaseCount: yield* Ref.get(ds06R5ReleaseCount)
          }
          if (ds07Modes.has(mode)) {
            if (timer.continuation.ds07 === undefined)
              return yield* Effect.die("DS-07 continuation lost capacity evidence")
            ds07 = timer.continuation.ds07
          }
        })

      const completeTrackerEdit = (startupDecision: RunFinalityDecision) =>
        Effect.gen(function* () {
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
          if (ds04Modes.has(mode)) {
            const beforeTimer = yield* ds03Snapshot()
            yield* Ref.set(ds04CheckpointBaseline, beforeTimer.records.length)
            if (ds06Modes.has(mode)) {
              yield* runDs06Checkpoint(beforeTimer, startupDecision)
            } else if (mode === "DS05") yield* runDs05Checkpoint(beforeTimer, startupDecision)
            else yield* runDs04Checkpoint(beforeTimer, startupDecision)
          }
        })

      const completeDs01 = Effect.gen(function* () {
        const pending = yield* Effect.forEach(selectedTaskIds, () => takeWhileRuntimeActive(pendingClaimQueue))
        yield* requireExactlySelectedTaskIds("DS-01 pending claims", pending)
        yield* Fiber.interrupt(fiber)
      })

      const completeDs02 = Effect.gen(function* () {
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
        const startupDecision = yield* Fiber.join(fiber)
        decision = startupDecision
        if (mode !== "DS02") yield* completeTrackerEdit(startupDecision)
      })

      if (mode === "DS09") {
        decision = yield* Fiber.join(fiber)
        if (ds09Controls !== undefined) yield* Ref.set(ds09Controls.after, yield* ds03Snapshot())
      } else if (mode === "DS01") yield* completeDs01
      else yield* completeDs02
      return {
        claimReleaseOrder: yield* Ref.get(claimReleaseOrder),
        claimRequests: yield* Ref.get(claimRequests),
        commands: yield* Ref.get(commands),
        decision,
        ds03,
        ds04,
        ds05,
        ds06,
        ds07,
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
export const runIssue268Ds01Characterization = Effect.scoped(runIssue268StartupCharacterizationFor("DS01"))

/** Releases the three independently pending claim responses in explicit R1 order. */
export const runIssue268Ds02Characterization = Effect.scoped(runIssue268StartupCharacterizationFor("DS02"))

/** Applies Alice's external F2/G1 tracker edit after DS-02 without triggering a Dalph refresh. */
export const runIssue268Ds03Characterization = Effect.scoped(runIssue268StartupCharacterizationFor("DS03")).pipe(
  Effect.flatMap(
    (run): Effect.Effect<Issue268Ds03StartupCharacterization> =>
      run.ds03 === undefined
        ? Effect.die("DS-03 runner completed without its required edit evidence")
        : Effect.succeed({ ...run, ds03: run.ds03 })
  )
)

/** Recovers the lost B/F2 notification through one real bounded-timer refresh. */
export const runIssue268Ds04Characterization = Effect.scoped(runIssue268StartupCharacterizationFor("DS04")).pipe(
  Effect.flatMap(
    (run): Effect.Effect<Issue268Ds04StartupCharacterization> =>
      run.ds03 === undefined || run.ds04 === undefined
        ? Effect.die("DS-04 runner completed without its required edit and timer evidence")
        : Effect.succeed({ ...run, ds03: run.ds03, ds04: run.ds04 })
  )
)

/** Observes B1 become safely suspended, then proves its exact position releases while B1 is retained. */
export const runIssue268Ds05Characterization = Effect.scoped(runIssue268StartupCharacterizationFor("DS05")).pipe(
  Effect.flatMap(
    (run): Effect.Effect<Issue268Ds05StartupCharacterization> =>
      run.ds03 === undefined || run.ds04 === undefined || run.ds05 === undefined
        ? Effect.die("DS-05 runner completed without its required edit, timer, and Safe evidence")
        : Effect.succeed({ ...run, ds03: run.ds03, ds04: run.ds04, ds05: run.ds05 })
  )
)

/** Admits D only after the exact B1 Safe publication releases its position. */
export const runIssue268Ds06Characterization = Effect.scoped(runIssue268StartupCharacterizationFor("DS06")).pipe(
  Effect.flatMap(
    (run): Effect.Effect<Issue268Ds06StartupCharacterization> =>
      run.ds03 === undefined || run.ds04 === undefined || run.ds05 === undefined || run.ds06 === undefined
        ? Effect.die("DS-06 runner completed without its required edit, Safe, and D evidence")
        : Effect.succeed({ ...run, ds03: run.ds03, ds04: run.ds04, ds05: run.ds05, ds06: run.ds06 })
  )
)

/** Applies P2 through the active-Run Operator boundary while A1/C1/D1 remain held. */
export const runIssue268Ds07Characterization = Effect.scoped(runIssue268StartupCharacterizationFor("DS07")).pipe(
  Effect.flatMap(
    (run): Effect.Effect<Issue268Ds07StartupCharacterization> =>
      run.ds03 === undefined ||
      run.ds04 === undefined ||
      run.ds05 === undefined ||
      run.ds06 === undefined ||
      run.ds07 === undefined
        ? Effect.die("DS-07 runner completed without its required edit, Safe, D, and capacity evidence")
        : Effect.succeed({ ...run, ds03: run.ds03, ds04: run.ds04, ds05: run.ds05, ds06: run.ds06, ds07: run.ds07 })
  )
)

/** Interrupts the first coordinator after the accepted P2 publication callback returns; outer authorities survive. */
export const runIssue268Ds08Characterization = Effect.scoped(
  Effect.gen(function* () {
    const outerScope = yield* Effect.scope
    const processScope = yield* Scope.make()
    const applicationBuildCount = yield* Ref.make(0)
    const applicationExitTrace = yield* Ref.make<ReadonlyArray<ApplicationExitTraceEvent>>([])
    const beforeLoss = yield* Ref.make<Issue268Ds08BeforeLoss | undefined>(undefined)
    const childScopeFinalizationCount = yield* Ref.make(0)
    const executorObserveCalls = yield* Ref.make(0)
    const firstProcessInterruptionCount = yield* Ref.make(0)
    const firstProcessReady = yield* Deferred.make<void>()
    const p2PublicationReturned = yield* Deferred.make<void>()
    const projectedReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
    const snapshot = yield* Ref.make<(() => Effect.Effect<Issue268Ds03BoundarySnapshot, unknown, never>) | undefined>(
      undefined
    )

    yield* Scope.addFinalizer(
      processScope,
      Ref.update(childScopeFinalizationCount, (count) => count + 1)
    )
    yield* Effect.addFinalizer((exit) => Scope.close(processScope, exit))

    const firstProcess = yield* runIssue268StartupCharacterizationFor("DS08", {
      sharedScope: outerScope,
      ds08: {
        applicationBuildCount,
        applicationExitTrace,
        beforeLoss,
        childScopeFinalizationCount,
        executorObserveCalls,
        firstProcessReady,
        p2PublicationReturned,
        projectedReports,
        snapshot
      }
    }).pipe(Effect.provideService(Scope.Scope, processScope), Effect.forkIn(processScope))
    const awaitFirstProcessReady = Deferred.await(firstProcessReady).pipe(
      Effect.raceFirst(
        Fiber.await(firstProcess).pipe(
          Effect.flatMap((exit) => Effect.die(`DS-08 first coordinator exited before crash readiness: ${exit._tag}`))
        )
      )
    )
    yield* awaitFirstProcessReady
    const preLoss = yield* Ref.get(beforeLoss)
    if (preLoss === undefined) return yield* Effect.die("DS-08 did not capture its pre-loss boundary")

    yield* Ref.update(firstProcessInterruptionCount, (count) => count + 1)
    yield* Fiber.interrupt(firstProcess)
    yield* Scope.close(processScope, Exit.void)

    const readAfterLoss = yield* Ref.get(snapshot)
    if (readAfterLoss === undefined) return yield* Effect.die("DS-08 did not retain its outer snapshot seam")
    const afterLoss = yield* readAfterLoss().pipe(Effect.orDie)
    return {
      ds08: {
        applicationExitTrace: yield* Ref.get(applicationExitTrace),
        beforeLoss: preLoss,
        childScopeFinalizationCount: yield* Ref.get(childScopeFinalizationCount),
        executorObserveCallsAfterLoss: yield* Ref.get(executorObserveCalls),
        executorObserveCallsBeforeLoss: preLoss.executorObserveCalls,
        firstProcessInterruptionCount: yield* Ref.get(firstProcessInterruptionCount),
        afterLoss,
        applicationBuildCount: yield* Ref.get(applicationBuildCount),
        projectedReports: new Map(yield* Ref.get(projectedReports))
      } satisfies Issue268Ds08Characterization
    } satisfies Issue268Ds08StartupCharacterization
  })
)

type Issue268RestartContinuation = "DS09" | "DS10" | "DS11"

/** Reconstructs the same Run in a fresh coordinator and optionally continues through DS-11. */
const runIssue268RestartCharacterization = (continuation: Issue268RestartContinuation) =>
  Effect.scoped(
    // eslint-disable-next-line complexity -- One restart scenario owns process loss, fresh owner startup, three observation gates, and exact settlement.
    Effect.gen(function* () {
      const outerScope = yield* Effect.scope
      const firstProcessScope = yield* Scope.make()
      const applicationBuildCount = yield* Ref.make(0)
      const applicationExitTrace = yield* Ref.make<ReadonlyArray<ApplicationExitTraceEvent>>([])
      const beforeLoss = yield* Ref.make<Issue268Ds08BeforeLoss | undefined>(undefined)
      const childScopeFinalizationCount = yield* Ref.make(0)
      const executorObserveCalls = yield* Ref.make(0)
      const firstProcessInterruptionCount = yield* Ref.make(0)
      const firstProcessReady = yield* Deferred.make<void>()
      const p2PublicationReturned = yield* Deferred.make<void>()
      const projectedReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
      const snapshot = yield* Ref.make<(() => Effect.Effect<Issue268Ds03BoundarySnapshot, unknown, never>) | undefined>(
        undefined
      )
      const sharedAuthoritiesReady = yield* Deferred.make<Issue268SharedAuthorities>()

      yield* Scope.addFinalizer(
        firstProcessScope,
        Ref.update(childScopeFinalizationCount, (count) => count + 1)
      )
      yield* Effect.addFinalizer((exit) => Scope.close(firstProcessScope, exit))

      const firstProcess = yield* runIssue268StartupCharacterizationFor("DS08", {
        sharedAuthoritiesReady,
        sharedScope: outerScope,
        ds08: {
          applicationBuildCount,
          applicationExitTrace,
          beforeLoss,
          childScopeFinalizationCount,
          executorObserveCalls,
          firstProcessReady,
          p2PublicationReturned,
          projectedReports,
          snapshot
        }
      }).pipe(Effect.provideService(Scope.Scope, firstProcessScope), Effect.forkIn(firstProcessScope))
      yield* Deferred.await(firstProcessReady).pipe(
        Effect.raceFirst(
          Fiber.await(firstProcess).pipe(
            Effect.flatMap((exit) => Effect.die(`DS-09 first coordinator exited before process loss: ${exit._tag}`))
          )
        )
      )
      const preLoss = yield* Ref.get(beforeLoss)
      if (preLoss === undefined) return yield* Effect.die("DS-09 did not capture its pre-loss boundary")
      yield* Ref.update(firstProcessInterruptionCount, (count) => count + 1)
      yield* Fiber.interrupt(firstProcess)
      yield* Scope.close(firstProcessScope, Exit.void)

      const sharedAuthorities = yield* Deferred.await(sharedAuthoritiesReady)
      const secondProcessScope = yield* Scope.make()
      const executorObservations = yield* Ref.make<ReadonlyArray<Issue268ExecutorObservationCapture>>([])
      const observationAdmissions = yield* Ref.make<
        ReadonlyMap<string, Pick<Issue268ExecutorObservationCapture, "admission" | "plannedAttempt">>
      >(new Map())
      const observationRequests = yield* Queue.unbounded<Issue268ExecutorObservationCapture>()
      const observationReleases = [
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>()
      ]
      const observationReturned = [
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>(),
        yield* Deferred.make<void>()
      ]
      const ordinaryOwnerActivationCount = yield* Ref.make(0)
      const ordinaryOwnerActivationOpportunities = yield* Ref.make<ReadonlyArray<"OrdinaryRunEntry">>([])
      const activeRefreshCount = yield* Ref.make(0)
      const activeRefreshDecision = yield* Ref.make<RunFinalityDecision | undefined>(undefined)
      const activeRefreshSettled = yield* Deferred.make<void>()
      const activeRefreshSources = yield* Ref.make<ReadonlyArray<"TrackerNotification">>([])
      const cLifecycleChanges = yield* Queue.unbounded<PlannedAttemptExecutorProjection>()
      const ds10Checkpoint = yield* Deferred.make<DeliveryRelationInputBundle>()
      const ds11Checkpoint = yield* Deferred.make<DeliveryRelationInputBundle>()
      const ds11CheckpointRelease = yield* Deferred.make<void>()
      const idleHandoffCount = yield* Ref.make(0)
      const idleHandoffReleases = [yield* Deferred.make<void>(), yield* Deferred.make<void>()]
      const idleHandoffs = yield* Queue.unbounded<number>()
      const restartPhase = yield* Ref.make<"DS09" | "DS10" | "DS11">("DS09")
      const trailingActivationCount = yield* Ref.make(0)
      const notificationCount = yield* Ref.make(0)
      const ownerFailure = yield* Deferred.make<unknown>()
      const ownerRelease = yield* Deferred.make<void>()
      const ownerStartup = yield* Deferred.make<{
        readonly decision: RunFinalityDecision
        readonly owner: RunReactivationOwnerService
      }>()
      const secondProcessSnapshot = yield* Ref.make<
        (() => Effect.Effect<Issue268Ds03BoundarySnapshot, unknown, never>) | undefined
      >(undefined)
      const after = yield* Ref.make<Issue268Ds03BoundarySnapshot | undefined>(undefined)

      yield* Effect.addFinalizer((exit) => Scope.close(secondProcessScope, exit))
      const secondProcess = yield* runIssue268StartupCharacterizationFor("DS09", {
        ds09: {
          after,
          applicationBuildCount,
          applicationExitTrace,
          executorObserveCalls,
          executorObservations,
          observationAdmissions,
          observationReleases,
          observationRequests,
          observationReturned,
          ordinaryOwnerActivationCount,
          ordinaryOwnerActivationOpportunities,
          ownerFailure,
          ownerRelease,
          ownerStartup,
          projectedReports,
          snapshot: secondProcessSnapshot,
          ...(continuation !== "DS09"
            ? {
                ds10: {
                  activeRefreshCount,
                  activeRefreshDecision,
                  activeRefreshSettled,
                  activeRefreshSources,
                  cLifecycleChanges,
                  checkpoint: ds10Checkpoint,
                  ...(continuation === "DS11"
                    ? { ds11: { checkpoint: ds11Checkpoint, checkpointRelease: ds11CheckpointRelease } }
                    : {}),
                  idleHandoffCount,
                  idleHandoffReleases,
                  idleHandoffs,
                  phase: restartPhase,
                  trailingActivationCount
                }
              }
            : {})
        },
        sharedAuthorities,
        sharedScope: outerScope
      }).pipe(Effect.provideService(Scope.Scope, secondProcessScope), Effect.forkIn(secondProcessScope))

      const takeObservationWhileRunning = Queue.take(observationRequests).pipe(
        Effect.raceFirst(
          Fiber.await(secondProcess).pipe(
            Effect.flatMap((exit) => Effect.die(`DS-09 second coordinator exited before R7: ${JSON.stringify(exit)}`))
          )
        )
      )
      const awaitObservationReturned = (index: number) => {
        const returned = observationReturned[index]
        return returned === undefined
          ? Effect.die(`DS-09 has no return gate for observation ${index}`)
          : Deferred.await(returned).pipe(
              Effect.raceFirst(
                Fiber.await(secondProcess).pipe(
                  Effect.flatMap((exit) =>
                    Effect.die(`DS-09 second coordinator exited during R7: ${JSON.stringify(exit)}`)
                  )
                )
              )
            )
      }
      const expectedAttemptIds = [scenario.attempts.A1, scenario.attempts.C1, scenario.attempts.D1]
      for (const [index, expectedAttemptId] of expectedAttemptIds.entries()) {
        const capture = yield* takeObservationWhileRunning
        if (capture.correlation.attemptId !== expectedAttemptId) {
          return yield* Effect.die(
            `DS-09 expected ${expectedAttemptId} passive observation, received ${capture.correlation.attemptId}`
          )
        }
        if (capture.correlation.runId !== scenario.runId || capture.purpose._tag !== "PassiveLifecycleObservation") {
          return yield* Effect.die("DS-09 passive observation carried the wrong identity or purpose")
        }
        const release = observationReleases[index]
        if (release === undefined) return yield* Effect.die(`DS-09 has no release gate for observation ${index}`)
        yield* Deferred.succeed(release, undefined)
        yield* awaitObservationReturned(index)
      }

      const startup = yield* Deferred.await(ownerStartup).pipe(
        Effect.raceFirst(
          Fiber.await(secondProcess).pipe(
            Effect.flatMap((exit) => Effect.die(`DS-09 second coordinator exited before owner return: ${exit._tag}`))
          )
        )
      )
      const readSecondProcessSnapshot = yield* Ref.get(secondProcessSnapshot)
      if (readSecondProcessSnapshot === undefined) return yield* Effect.die("DS-09 did not expose its live snapshot")
      const afterLoss = yield* readSecondProcessSnapshot()
      yield* Ref.set(after, afterLoss)
      if (startup.decision._tag !== "RunMustRemainActive" || startup.decision.reason !== "RunnableTransition") {
        return yield* Effect.die("DS-09 did not return exact RunMustRemainActive(RunnableTransition)")
      }
      const decision = { _tag: "RunMustRemainActive", reason: "RunnableTransition" } as const
      const reconstructedPublication = afterLoss.publications.findLast(
        ({ publication }) => publication.graph._tag === "GraphEstablished"
      )
      if (reconstructedPublication === undefined) {
        return yield* Effect.die("DS-09 did not publish reconstructed current graph state")
      }
      const ds09 = {
        after: afterLoss,
        applicationBuildCount: yield* Ref.get(applicationBuildCount),
        applicationExitTrace: yield* Ref.get(applicationExitTrace),
        beforeLoss: preLoss,
        decision,
        executorObservations: yield* Ref.get(executorObservations),
        firstProcessInterruptionCount: yield* Ref.get(firstProcessInterruptionCount),
        ordinaryOwnerActivationCount: yield* Ref.get(ordinaryOwnerActivationCount),
        ordinaryOwnerActivationOpportunities: yield* Ref.get(ordinaryOwnerActivationOpportunities),
        projectedReports: new Map(yield* Ref.get(projectedReports)),
        reconstructedPublication
      } satisfies Issue268Ds09Characterization
      if (continuation === "DS09") {
        yield* Deferred.succeed(ownerRelease, undefined)
        const secondRun = yield* Fiber.join(secondProcess)
        if (secondRun.decision?._tag !== "RunMustRemainActive" || secondRun.decision.reason !== "RunnableTransition") {
          return yield* Effect.die("DS-09 coordinator result changed after owner release")
        }
        yield* Scope.close(secondProcessScope, Exit.void)
        return { ds09 } satisfies Issue268Ds09StartupCharacterization
      }

      const awaitLiveSecondProcess = <A>(effect: Effect.Effect<A>, boundary: string) =>
        effect.pipe(
          Effect.raceFirst(
            Deferred.await(ownerFailure).pipe(
              Effect.flatMap((failure) => Effect.die(`DS-10 owner failed at ${boundary}: ${String(failure)}`))
            )
          ),
          Effect.raceFirst(
            Fiber.await(secondProcess).pipe(
              Effect.flatMap((exit) => Effect.die(`DS-10 second process exited at ${boundary}: ${exit._tag}`))
            )
          )
        )
      const firstIdle = yield* awaitLiveSecondProcess(Queue.take(idleHandoffs), "first idle handoff")
      const firstIdleOrdinaryCount = yield* Ref.get(ordinaryOwnerActivationCount)
      const firstIdleActiveCount = yield* Ref.get(activeRefreshCount)
      const firstIdleTrailingCount = yield* Ref.get(trailingActivationCount)
      if (
        firstIdle !== 1 ||
        firstIdleOrdinaryCount !== 1 ||
        firstIdleActiveCount !== 0 ||
        firstIdleTrailingCount !== 0
      ) {
        return yield* Effect.die(
          `DS-10 first idle state differed: idle=${firstIdle}, ordinary=${firstIdleOrdinaryCount}, active=${firstIdleActiveCount}, trailing=${firstIdleTrailingCount}`
        )
      }
      yield* sharedAuthorities.testTrackerGraphReader.setSnapshot(scenario.graphs.G2)
      yield* Ref.set(restartPhase, "DS10")
      yield* Ref.update(notificationCount, (count) => count + 1)
      const notification = yield* startup.owner.hint(RunReactivationHint.TrackerNotification()).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      if ((yield* Ref.get(activeRefreshCount)) !== 0) {
        return yield* Effect.die("DS-10 active refresh began before the guarded owner handoff was released")
      }
      const firstIdleRelease = idleHandoffReleases[0]
      if (firstIdleRelease === undefined) return yield* Effect.die("DS-10 lacks its first idle release")
      yield* Deferred.succeed(firstIdleRelease, undefined)
      yield* awaitLiveSecondProcess(Fiber.join(notification), "tracker notification delivery")
      const checkpointPublication = yield* awaitLiveSecondProcess(
        Deferred.await(ds10Checkpoint),
        "live suspension checkpoint"
      )
      const liveDecision = yield* Ref.get(activeRefreshDecision)
      if (liveDecision !== undefined) return yield* Effect.die("DS-10 active refresh finalized before C1 became Safe")
      const afterDs10 = yield* readSecondProcessSnapshot()
      const ds10 = {
        activeRefreshCount: yield* Ref.get(activeRefreshCount),
        activeRefreshDecision: liveDecision,
        activeRefreshSources: yield* Ref.get(activeRefreshSources),
        after: afterDs10,
        before: ds09,
        checkpointPublication,
        executorObserveCallCount: yield* Ref.get(executorObserveCalls),
        idleHandoffCount: yield* Ref.get(idleHandoffCount),
        notificationCount: yield* Ref.get(notificationCount),
        trailingActivationCount: yield* Ref.get(trailingActivationCount)
      } satisfies Issue268Ds10Characterization
      if (continuation === "DS10") {
        yield* Fiber.interrupt(secondProcess)
        yield* Scope.close(secondProcessScope, Exit.void)
        return { ds09, ds10 } satisfies Issue268Ds10StartupCharacterization
      }

      const cObservation = ds09.executorObservations.find(
        ({ plannedAttempt }) => plannedAttempt.attemptId === scenario.attempts.C1
      )
      if (cObservation === undefined) return yield* Effect.die("DS-11 cannot find C1's retained planned attempt")
      const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(cObservation.plannedAttempt)
      })
      yield* Ref.set(restartPhase, "DS11")
      yield* Ref.update(projectedReports, (current) =>
        new Map(current).set(plannedAttemptExecutorCorrelationKey(safeReport.correlation), safeReport)
      )
      yield* Queue.offer(cLifecycleChanges, PlannedAttemptExecutorProjection.cases.Exact.make({ report: safeReport }))
      const ds11CheckpointPublication = yield* awaitLiveSecondProcess(
        Deferred.await(ds11Checkpoint),
        "safe-suspension release checkpoint"
      )
      const ds11LiveDecision = yield* Ref.get(activeRefreshDecision)
      if (ds11LiveDecision !== undefined) {
        return yield* Effect.die("DS-11 active refresh finalized before its release publication was inspected")
      }
      const afterDs11 = yield* readSecondProcessSnapshot()
      const ds11 = {
        activeRefreshCount: yield* Ref.get(activeRefreshCount),
        activeRefreshDecision: ds11LiveDecision,
        after: afterDs11,
        before: ds10,
        checkpointPublication: ds11CheckpointPublication,
        executorObserveCallCount: yield* Ref.get(executorObserveCalls)
      } satisfies Issue268Ds11Characterization
      yield* Deferred.succeed(ds11CheckpointRelease, undefined)
      yield* Fiber.interrupt(secondProcess)
      yield* Scope.close(secondProcessScope, Exit.void)
      return { ds09, ds10, ds11 } satisfies Issue268Ds11StartupCharacterization
    })
  )

/** Reconstructs the same Run in a fresh coordinator after the DS-08 process cut. */
export const runIssue268Ds09Characterization = runIssue268RestartCharacterization("DS09").pipe(
  Effect.map((result) => ({ ds09: result.ds09 }))
)

/** Continues the same restarted owner through Alice's closed-C notification and active refresh. */
export const runIssue268Ds10Characterization = runIssue268RestartCharacterization("DS10").pipe(
  Effect.flatMap((result) => {
    if (!("ds10" in result)) {
      return Effect.die("DS-10 continuation was not constructed")
    }
    return Effect.succeed({ ds09: result.ds09, ds10: result.ds10 } satisfies Issue268Ds10StartupCharacterization)
  })
)

/** Continues the same live C1 lifecycle attachment through exact safe suspension and position release. */
export const runIssue268Ds11Characterization = runIssue268RestartCharacterization("DS11").pipe(
  Effect.flatMap((result) => {
    if (!("ds10" in result) || !("ds11" in result)) {
      return Effect.die("DS-11 continuation was not constructed")
    }
    return Effect.succeed({
      ds09: result.ds09,
      ds10: result.ds10,
      ds11: result.ds11
    } satisfies Issue268Ds11StartupCharacterization)
  })
)
