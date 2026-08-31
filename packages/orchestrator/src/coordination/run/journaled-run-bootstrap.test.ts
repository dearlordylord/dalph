import {
  AttemptId,
  GitCommitSha,
  makeTaskWorkSpecification,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { NodeCrypto, NodeFileSystem, NodePath } from "@effect/platform-node"
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Queue,
  Ref,
  Scope,
  Stream
} from "effect"
import { JournalDatabaseLocator, JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { sqliteJournalTestLayer } from "../../workflow-journal/adapters/sqlite-store.js"
import { expect } from "vitest"
import { TestClock } from "effect/testing"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import {
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader
} from "../../authorities/task-tracker/graph-reader.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { taskWorkCapacityControlLayer } from "../../control/task-work-capacity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { DeliveryRuntimeResources } from "../delivery/delivery-runtime-resources.js"
import { Journal } from "../delivery/journal.js"
import { DeliveryRuntimeObservationPublication } from "../delivery/delivery-runtime-observation.js"
import { DeliveryRelationPublicationObserver } from "../delivery/delivery-publication-observer.js"
import { deliveryRuntime } from "../delivery/delivery-runtime-adapter.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "../delivery/in-memory-relations.js"
import { currentSignalOf, type DeliveryRelationInputBundle, TrackerGraphState } from "../delivery/relations.js"
import { RunFinalityDecision, type RunFinalityProof } from "../frontier/frontier.js"
import {
  activeWorkAuthorityRefreshSubjectsForRunState,
  type RunActivationOpportunity
} from "./run-activation-opportunity.js"
import { DispositionCleanupActivation } from "../../workflow/protocols/disposition-cleanup/loop.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  InRunJournal,
  JournalStorageUnavailable,
  JournalStore,
  journalStoreCapabilities,
  RunLifecycleJournal,
  WorkflowRunAlreadyTerminated,
  WorkflowRunTargetMismatch
} from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import {
  plannedAttemptProtocolControllerLayer,
  PlannedAttemptProtocolController
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { projectWorkflowOccurrences } from "../../workflow/registry/occurrence-projection.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  attemptPlanRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { makeRunFinalityEvidence, runTerminationDispositionOf } from "../frontier/run-finality.js"
import { AllocatedWorkflowRunId, freshWorkflowRunId } from "./fresh-run-identity.js"
import { RunRecoveryProjection } from "./recovery-activation.js"
import { JournaledRunBootstrap, type AcceptedRunReactivationObservers } from "./run.js"
import { journaledRunBootstrapLayer } from "./journaled-run-bootstrap.js"
import {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication,
  type PassivePlannedAttemptProjectionPublicationService
} from "./passive-planned-attempt-observer.js"
import {
  beginPlannedAttemptExecutorWorkWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "../../workflow/protocols/planned-attempt-executor-work/suspension-commands.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { requiredPlannedAttemptPositionsOf } from "./required-planned-attempt-positions.js"
import {
  type ApplicationExitShellService,
  type ApplicationProcessLifecycleService,
  makeApplicationExitShell
} from "../application-exit/application-shell.js"
import { ApplicationExitDiagnostic, ApplicationExitResult } from "../application-exit/lifecycle-decision.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { controlDirectionApplicationLayer } from "../../workflow/protocols/control-direction-application/protocol.js"
import { attemptChoiceControlLayer } from "../../workflow/protocols/attempt-choice/control.js"
import { taskClaimReacquisitionControlLayer } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "../../workflow/protocols/integration-quarantine/events.js"
import {
  IntegratorNotPreparedDetail,
  IntegratorRunCorrelation,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorResult,
  IntegratorSessionFixedEvent
} from "../../workflow/protocols/integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../../workflow/protocols/integrator/state.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { deterministicOperationIdAllocatorLayer } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import {
  type JournalMaintenanceDiagnostic,
  noopJournalMaintenanceObservation,
  type JournalMaintenanceObservationService
} from "../../workflow-journal/maintenance.js"

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const runtimePolicy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: initialPolicy.taskExecutionCapacity
})
type ActiveRunFinalityProof = Extract<RunFinalityProof, { readonly decision: { readonly _tag: "RunMustRemainActive" } }>

const finalityProof = (decision: ActiveRunFinalityProof["decision"]): ActiveRunFinalityProof => ({
  acceptedAt: JournalPosition.make(1),
  decision
})
const defaultOwnership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
const settledGraph = TaskDagSnapshot.project(
  TrackerSnapshot.make({
    revision: TrackerRevision.make("bootstrap-control-settled"),
    rootTaskId: TaskId.make("bootstrap-control-root"),
    tasks: [
      {
        id: TaskId.make("bootstrap-control-root"),
        lifecycle: { _tag: "CompletedSuccessfully" },
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
)
if (settledGraph._tag !== "Valid") throw new Error("bootstrap control fixture graph must project")

const defaultTrackerGraphReader = TrackerGraphReader.of({
  read: () => Effect.succeed(settledGraph.snapshot),
  readTaskWorkSpecification: () => Effect.die("unused")
})

const nodeFileSystemAndPath = Layer.merge(NodeFileSystem.layer, NodePath.layer)

const completedFinalityProof = (runId: RunId, target: ReturnType<typeof FixtureTarget.make>) =>
  Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* InRunJournal
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`finality:${runId}`),
      target
    )
    const snapshot = yield* interpreter.readTrackerGraph(operation)
    const observation = (yield* journal.read(runId)).findLast(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
    )
    if (observation?.event._tag !== "TaskTrackerFactsObserved")
      return yield* Effect.die("finality read was not recorded")
    const evidence = makeRunFinalityEvidence({
      observedAt: observation.position,
      operationId: operation.operationId,
      readShape: operation.readShape,
      rootTaskId: snapshot.rootTaskId ?? TaskId.make("root"),
      runId,
      snapshot,
      target
    })
    const disposition = runTerminationDispositionOf(evidence.graphOutcome, false)
    if (disposition === undefined) return yield* Effect.die("finality fixture graph must be terminal")
    return {
      acceptedAt: observation.position,
      decision: RunFinalityDecision.RunMayTerminate(),
      disposition,
      evidence
    } as const
  })

it.effect("fails closed when a terminal proof does not name its established graph read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-unfounded-terminal-proof")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("unrecorded-finality-read"),
        target
      )
      const evidence = makeRunFinalityEvidence({
        observedAt: JournalPosition.make(2),
        operationId: operation.operationId,
        readShape: operation.readShape,
        rootTaskId: TaskId.make("bootstrap-control-root"),
        runId,
        snapshot: settledGraph.snapshot,
        target
      })
      const proof = {
        acceptedAt: JournalPosition.make(2),
        decision: RunFinalityDecision.RunMayTerminate(),
        disposition: "Completed" as const,
        evidence
      }
      expect(yield* bootstrap.activate(target, Effect.succeed(initialPolicy), runId, Effect.succeed(proof))).toEqual({
        _tag: "RunMustRemainActive",
        reason: "TrackerTargetUnsettled"
      })

      const mismatched = completedFinalityProof(runId, target).pipe(
        Effect.map((result) => ({
          ...result,
          evidence: { ...result.evidence, operationId: OperationId.make("foreign-established-finality-read") }
        }))
      )
      expect(yield* bootstrap.activate(target, Effect.succeed(initialPolicy), runId, mismatched)).toEqual({
        _tag: "RunMustRemainActive",
        reason: "TrackerTargetUnsettled"
      })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

const unpausedRuntimeEvaluation = Effect.gen(function* () {
  const runtime = yield* deliveryRuntime.pipe(
    Effect.provide(
      makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(runtimePolicy),
        coherent: currentSignalOf({
          actionInputs: {
            proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
            reflectionProposals: [],
            runtimeFacts: {
              acceptedAt: null,
              cancellationApplied: false,
              pauseCoverage: {
                _tag: "PauseCoverageGraphNotEstablished",
                applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
              },
              quiescence: { _tag: "TrackerReconfirmationAllowed" },
              taskWork: { capacity: runtimePolicy.taskExecutionCapacity, held: [] }
            },
            trackerGraphProposals: []
          },
          publication: {
            exactEvidence: [],
            graph: TrackerGraphState.cases.GraphNotEstablished.make({}),
            policy: runtimePolicy
          }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return yield* runtime.get
})

const publicationBundle: DeliveryRelationInputBundle = {
  actionInputs: {
    proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt: null,
      cancellationApplied: false,
      pauseCoverage: {
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      },
      quiescence: { _tag: "TrackerReconfirmationAllowed" },
      taskWork: { capacity: runtimePolicy.taskExecutionCapacity, held: [] }
    },
    trackerGraphProposals: []
  },
  publication: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy: runtimePolicy }
}

const runtimeLayer = (
  runId: RunId,
  trackerGraphReader: TrackerGraphReader["Service"] = defaultTrackerGraphReader,
  publicationCount?: Ref.Ref<number>,
  passivePublicationCapture?: Deferred.Deferred<PassivePlannedAttemptProjectionPublicationService>,
  plannedAttemptExecutor?: PlannedAttemptExecutor["Service"]
) =>
  Layer.mergeAll(
    publicationCount === undefined
      ? Layer.empty
      : Layer.effectDiscard(
          Effect.gen(function* () {
            const observer = yield* DeliveryRelationPublicationObserver
            const first = yield* Ref.modify(publicationCount, (count) => [count === 0, count + 1] as const)
            if (first) yield* observer.observe(publicationBundle)
          })
        ),
    passivePublicationCapture === undefined
      ? Layer.empty
      : Layer.effectDiscard(
          Effect.gen(function* () {
            yield* Deferred.succeed(passivePublicationCapture, yield* PassivePlannedAttemptProjectionPublication)
          })
        ),
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    plannedAttemptExecutor === undefined
      ? Layer.mock(PlannedAttemptExecutor, {})
      : Layer.succeed(PlannedAttemptExecutor, plannedAttemptExecutor),
    Layer.mock(RunRecoveryProjection, {
      _tag: "AuthoritativeRunRecoveryProjection",
      runId: RunId.make("bootstrap-fixture"),
      readDeliveryProjection: Effect.succeed({
        evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
        frontier: { explanations: [], transitions: [] }
      }),
      reconstructedPlannedAttemptPositions: []
    }),
    taskWorkCapacityControlLayer,
    taskClaimReacquisitionControlLayer,
    deterministicOperationIdAllocatorLayer(`bootstrap-control:${runId}`),
    plannedAttemptProtocolControllerLayer,
    journaledWorkflowInterpreterLayer(
      runId,
      Layer.mock(WorkflowInterpreter, { readTrackerGraph: (operation) => trackerGraphReader.read(operation.target) })
    ),
    Layer.mock(WorkflowTrace, { emit: () => Effect.void }),
    Layer.succeed(
      DispositionCleanupActivation,
      DispositionCleanupActivation.of({
        responsibilities: { branch: [], candidate: [], worktree: [] },
        run: Effect.die("cleanup activation is not used by this bootstrap fixture")
      })
    )
  )

const buildBootstrap = Effect.fn("JournaledRunBootstrapTest.build")(function* (
  expectedRunId: RunId,
  storage: JournalStore["Service"],
  trackerGraphReader: TrackerGraphReader["Service"] = defaultTrackerGraphReader,
  applicationExit?: ApplicationExitShellService,
  processLifecycle?: ApplicationProcessLifecycleService,
  ownership: CoordinatorOwnership["Service"] = defaultOwnership,
  publicationCount?: Ref.Ref<number>,
  maintenanceObservation: JournalMaintenanceObservationService = noopJournalMaintenanceObservation,
  passivePublicationCapture?: Deferred.Deferred<PassivePlannedAttemptProjectionPublicationService>,
  plannedAttemptExecutor?: PlannedAttemptExecutor["Service"],
  lifecycleObservation: PlannedAttemptExecutorLifecycleObservation["Service"] = PlannedAttemptExecutorLifecycleObservation.of(
    { attach: () => Effect.die("the bootstrap fixture did not declare executor lifecycle observation") }
  )
) {
  const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage)))
  const dependencies = Layer.mergeAll(
    Layer.succeed(JournalStore, storage),
    Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
    Layer.succeed(CoordinatorOwnership, ownership),
    Layer.succeed(PlannedAttemptExecutorLifecycleObservation, lifecycleObservation)
  )
  const sharedApplicationExit =
    applicationExit ??
    (yield* makeApplicationExitShell(ownership, processLifecycle ?? { requestEnd: () => Effect.void }))
  const application = journaledRunBootstrapLayer(
    expectedRunId,
    ({ runId }) =>
      runtimeLayer(runId, trackerGraphReader, publicationCount, passivePublicationCapture, plannedAttemptExecutor),
    sharedApplicationExit,
    maintenanceObservation
  ).pipe(Layer.provide(dependencies))
  const bootstrap = Context.get(yield* Layer.build(application), JournaledRunBootstrap)
  return { ...bootstrap, applicationExitRequestBoundary: sharedApplicationExit.requestBoundary }
})

const appendExecutorHistory = (
  journal: JournalStore["Service"],
  runId: RunId,
  plannedAttempt: PlannedTaskAttempt,
  reportTag: "Running" | "SafelySuspended" | "Terminal"
) =>
  Effect.gen(function* () {
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make(`bootstrap-capture-plan:${plannedAttempt.attemptId}`),
      plannedAttempt,
      predecessorOperationIds: []
    })
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report: executing,
        version: workflowJournalEventVersion
      })
    )
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: executing,
        version: workflowJournalEventVersion
      })
    )
    if (reportTag === "Running") return
    const settledReport =
      reportTag === "SafelySuspended"
        ? PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
        : PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } })
    const settledCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, settledCommandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Suspend",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: settledCommandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, settledCommandOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal: settledCommandOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report: settledReport,
        version: workflowJournalEventVersion
      })
    )
    const settledOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, settledOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: settledOrdinal,
        report: settledReport,
        version: workflowJournalEventVersion
      })
    )
  })

const captureTestAttempt = (runId: RunId, suffix: string, taskSuffix: string) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`bootstrap-capture-attempt-${suffix}`),
    baseSha: GitCommitSha.make("a".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/bootstrap-capture-${suffix}`),
    executor: TaskExecutorLocator.make("executor:bootstrap-capture"),
    runId,
    taskId: TaskId.make(`bootstrap-capture-task-${taskSuffix}`),
    taskRevision: TaskRevision.make(`bootstrap-capture-revision-${suffix}`),
    worktree: WorktreeLocator.make(`/worktrees/bootstrap-capture-${suffix}`)
  })

it.effect("captures only unfinished Running responsibilities at the active refresh boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-active-refresh-capture")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(runId, target, initialPolicy)

      const runningA = captureTestAttempt(runId, "running-a", "a")
      const runningB = captureTestAttempt(runId, "running-b", "b")
      const safelySuspended = captureTestAttempt(runId, "safely-suspended", "c")
      const terminal = captureTestAttempt(runId, "terminal", "d")
      yield* appendExecutorHistory(storage, runId, runningA, "Running")
      yield* appendExecutorHistory(storage, runId, runningB, "Running")
      yield* appendExecutorHistory(storage, runId, safelySuspended, "SafelySuspended")
      yield* appendExecutorHistory(storage, runId, terminal, "Terminal")

      const captured = yield* Ref.make<RunActivationOpportunity | undefined>(undefined)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const decision = yield* bootstrap.activateActiveWorkAuthorityRefresh(
        target,
        Effect.die("an existing Run must not reread its initial policy"),
        runId,
        (opportunity) =>
          Ref.set(captured, opportunity).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          ),
        "Timer"
      )
      expect(decision).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      const opportunity = yield* Ref.get(captured)
      if (opportunity?._tag !== "ActiveWorkAuthorityRefresh") {
        return yield* Effect.die("active refresh did not receive its captured opportunity")
      }
      const capturedSubjects = [...opportunity.subjects].map(({ attemptId, runId: subjectRunId }) => ({
        attemptId,
        runId: subjectRunId
      }))
      expect(capturedSubjects).toEqual([
        { runId, attemptId: runningA.attemptId },
        { runId, attemptId: runningB.attemptId }
      ])

      const late = captureTestAttempt(runId, "late-running", "e")
      yield* appendExecutorHistory(storage, runId, late, "Running")
      const laterHistory = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
      if (laterHistory._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("late running fixture must preserve valid journal history")
      }
      expect(
        [...activeWorkAuthorityRefreshSubjectsForRunState(laterHistory.runState)].map(({ attemptId }) => attemptId)
      ).toEqual([runningA.attemptId, runningB.attemptId, late.attemptId])
      expect([...opportunity.subjects].map(({ attemptId }) => attemptId)).toEqual([
        runningA.attemptId,
        runningB.attemptId
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("lets an admitted active refresh record its read outcome before Exit rejects a later refresh", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-active-refresh-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const readOperationId = OperationId.make("journaled-bootstrap-active-refresh-exit-read")
      const outcomeAppendStarted = yield* Deferred.make<void>()
      const releaseOutcomeAppend = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "TaskTrackerFactsObserved" && event.operationId === readOperationId
            ? Deferred.succeed(outcomeAppendStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseOutcomeAppend)),
                Effect.andThen(delegate.append(requestedRunId, key, event))
              )
            : delegate.append(requestedRunId, key, event)
      })
      yield* storage.beginRun(runId, target, initialPolicy)
      const running = captureTestAttempt(runId, "active-refresh-exit", "active-refresh-exit")
      yield* appendExecutorHistory(storage, runId, running, "Running")

      const readStarted = yield* Deferred.make<void>()
      const releaseRead = yield* Deferred.make<void>()
      const trackerGraphReader = TrackerGraphReader.of({
        read: () =>
          Deferred.succeed(readStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseRead)),
            Effect.as(settledGraph.snapshot)
          ),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const correlation = plannedAttemptExecutorCorrelation(running)
      const executor = PlannedAttemptExecutor.of({
        begin: () => Effect.die("the recovered executing attempt must not begin again"),
        observe: () => Effect.die("application Exit suspends through the command boundary"),
        requestSuspension: () =>
          Effect.succeed(PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })),
        resume: () => Effect.die("application Exit must not resume executor work")
      })
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        trackerGraphReader,
        applicationExit,
        undefined,
        defaultOwnership,
        undefined,
        noopJournalMaintenanceObservation,
        undefined,
        executor
      )
      const enteredLaterRefresh = yield* Ref.make(false)
      const read = makeTrackerGraphObservationOperation(
        { _tag: "ExecutingWorkAuthorityCheck" },
        readOperationId,
        target
      )
      const admittedRefresh = yield* bootstrap
        .activateActiveWorkAuthorityRefresh(
          target,
          Effect.die("the established Run must not reread its initial policy"),
          runId,
          () =>
            Effect.gen(function* () {
              const interpreter = yield* WorkflowInterpreter
              yield* interpreter.readTrackerGraph(read)
              return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            }),
          "TrackerNotification"
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(readStarted)

      expect(
        (yield* storage.read(runId)).filter(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === readOperationId
        )
      ).toHaveLength(1)
      expect(
        (yield* storage.read(runId)).filter(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === readOperationId
        )
      ).toHaveLength(0)

      const exiting = yield* applicationExit.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* applicationExit.awaitExitRequested
      const laterRefresh = yield* bootstrap
        .activateActiveWorkAuthorityRefresh(
          target,
          Effect.die("the established Run must not reread its initial policy"),
          runId,
          () =>
            Ref.set(enteredLaterRefresh, true).pipe(
              Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
            ),
          "Timer"
        )
        .pipe(Effect.forkChild)

      expect(exiting.pollUnsafe()).toBeUndefined()
      expect(yield* Ref.get(enteredLaterRefresh)).toBe(false)
      yield* Deferred.succeed(releaseRead, undefined)
      yield* Deferred.await(outcomeAppendStarted)

      expect(exiting.pollUnsafe()).toBeUndefined()
      expect(admittedRefresh.pollUnsafe()).toBeUndefined()
      expect(
        (yield* delegate.read(runId)).filter(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === readOperationId
        )
      ).toHaveLength(0)
      yield* Deferred.succeed(releaseOutcomeAppend, undefined)

      expect(yield* Fiber.join(admittedRefresh)).toEqual({
        _tag: "RunMustRemainActive",
        reason: "UnsettledResponsibility"
      })
      expect(yield* Fiber.join(exiting)).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
      expect(yield* Fiber.join(laterRefresh).pipe(Effect.flip)).toMatchObject({ _tag: "ApplicationExiting" })
      expect(yield* Ref.get(enteredLaterRefresh)).toBe(false)
      expect(
        (yield* storage.read(runId)).filter(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === readOperationId
        )
      ).toHaveLength(1)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

const withTemporaryDatabase = <A, E, R>(use: (filename: JournalDatabaseLocator) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-bootstrap-cold-" })
    return yield* use(JournalDatabaseLocator.make(path.join(directory, "journal.sqlite")))
  }).pipe(Effect.provide(nodeFileSystemAndPath))

it.effect("records Alice's Run cancellation once and coalesces semantic redelivery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-cancel-redelivery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeActive = yield* Deferred.make<void>()
      const finishRuntime = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(Deferred.await(finishRuntime)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      expect(
        yield* bootstrap.operatorControl
          .applyRunCancellation({ runId: RunId.make("foreign-cancellation-control-run") })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournaledRunIdentityMismatch", expectedRunId: runId })

      expect(yield* bootstrap.operatorControl.applyRunCancellation({ runId })).toMatchObject({
        _tag: "RunCancellationApplied",
        appliedAt: 2
      })
      expect(yield* bootstrap.operatorControl.applyRunCancellation({ runId })).toMatchObject({
        _tag: "RunCancellationAlreadyApplied",
        appliedAt: 2
      })

      yield* Deferred.succeed(finishRuntime, undefined)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "RunCancellationApplied"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("returns the existing terminal result when cancellation loses the Run-termination race", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-cancel-after-terminal")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      yield* bootstrap.activate(target, Effect.succeed(initialPolicy), runId, completedFinalityProof(runId, target))

      expect(yield* bootstrap.operatorControl.applyRunCancellation({ runId })).toMatchObject({
        _tag: "RunCancellationRunTerminated",
        disposition: "Completed",
        terminatedAt: 4
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).not.toContain("RunCancellationApplied")
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an unapplied Run cancellation after the application Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-exiting-cancellation")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      const runtimeActive = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      yield* bootstrap.applicationExitRequestBoundary.requestExit
      expect(yield* bootstrap.operatorControl.applyRunCancellation({ runId }).pipe(Effect.flip)).toMatchObject({
        _tag: "ApplicationExiting"
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("an idle application Exit closes its runtime, releases the coordinator lock, and journals no Exit fact", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-idle-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Deferred.make<void>()
      const requestedStatus = yield* Deferred.make<number>()
      const chronology = yield* Ref.make<Array<string>>([])
      const ownership = CoordinatorOwnership.of({
        release: Ref.update(chronology, (events) => [...events, "coordinator-lock-released"]).pipe(
          Effect.andThen(Deferred.succeed(lockReleased, undefined)),
          Effect.asVoid
        ),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, {
        requestEnd: ({ status }) =>
          Ref.update(chronology, (events) => [...events, "process-end-requested"]).pipe(
            Effect.andThen(Deferred.succeed(requestedStatus, status)),
            Effect.asVoid
          )
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))),
            Effect.ensuring(Ref.update(chronology, (events) => [...events, "runtime-closed"]))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      const result = yield* bootstrap.applicationExitRequestBoundary.requestExit

      expect(result).toMatchObject({ _tag: "Succeeded", requestedStatus: 0 })
      expect(yield* Deferred.isDone(lockReleased)).toBe(true)
      expect(yield* Deferred.await(requestedStatus)).toBe(0)
      expect(yield* Ref.get(chronology)).toEqual([
        "runtime-closed",
        "coordinator-lock-released",
        "process-end-requested"
      ])
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      const records = yield* storage.read(runId)
      expect(records.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect((yield* projectWorkflowOccurrences(records)).occurrences).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps the active Run alive until its exact executor-family Exit drain finishes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-executor-exit-drain")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const executorDrainStarted = yield* Deferred.make<void>()
      const releaseExecutorDrain = yield* Deferred.make<void>()
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const observedApplicationExit: ApplicationExitShellService = {
        ...applicationExit,
        awaitExecutorDrains: applicationExit.awaitExecutorDrains,
        registerExecutorDrain: (drain) =>
          applicationExit.registerExecutorDrain({
            suspendExecutingExecutorWork: Deferred.succeed(executorDrainStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseExecutorDrain)),
              Effect.andThen(drain.suspendExecutingExecutorWork)
            )
          })
      }
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, observedApplicationExit)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const exiting = yield* applicationExit.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(executorDrainStarted)

      expect(running.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(releaseExecutorDrain, undefined)
      expect(yield* Fiber.join(exiting)).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("times out instead of interrupting a non-idle Run whose family owner has not drained", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-non-idle-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Ref.make(false)
      const requestedStatuses = yield* Ref.make<ReadonlyArray<number>>([])
      const ownership = CoordinatorOwnership.of({
        release: Ref.set(lockReleased, true),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, {
        requestEnd: ({ status }) => Ref.update(requestedStatuses, (statuses) => [...statuses, status])
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const exiting = yield* bootstrap.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "TimedOut", requestedStatus: 1 })
      expect(yield* Ref.get(lockReleased)).toBe(false)
      expect(yield* Ref.get(requestedStatuses)).toEqual([1])
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(running.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("finishes an already-admitted Run termination append before successful Exit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-termination-append-at-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const terminationStarted = yield* Deferred.make<void>()
      const releaseTermination = yield* Deferred.make<void>()
      const lockReleased = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        terminateRun: (requestedRunId, disposition, evidence) =>
          Deferred.succeed(terminationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseTermination)),
            Effect.andThen(delegate.terminateRun(requestedRunId, disposition, evidence))
          )
      })
      const ownership = CoordinatorOwnership.of({
        release: Deferred.succeed(lockReleased, undefined).pipe(Effect.asVoid),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(target, Effect.succeed(initialPolicy), runId, completedFinalityProof(runId, target))
        .pipe(Effect.forkChild)
      yield* Deferred.await(terminationStarted)

      const exiting = yield* bootstrap.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(lockReleased)).toBe(false)

      yield* Deferred.succeed(releaseTermination, undefined)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMayTerminate" })
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded", requestedStatus: 0 })
      expect(yield* Deferred.isDone(lockReleased)).toBe(true)
      expect((yield* delegate.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "WorkflowRunTerminated"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reopens an unfinished Run normally after an authored Exit death cut", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-reopen-after-exit-death")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(runId, target, initialPolicy)

      const restarted = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      )
      const entered = yield* Ref.make(false)
      const finality = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })

      expect(
        yield* restarted.activate(
          target,
          Effect.die("ordinary reopening must retain the recorded initial policy"),
          runId,
          Ref.set(entered, true).pipe(Effect.as(finalityProof(finality)))
        )
      ).toEqual(finality)
      expect(yield* Ref.get(entered)).toBe(true)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("one application Exit driver and cutoff are shared by every Run bootstrap", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstTarget = FixtureTarget.make("shared-exit-first-run")
      const secondTarget = FixtureTarget.make("shared-exit-second-run")
      const firstRunId = yield* freshWorkflowRunId(firstTarget)
      const secondRunId = yield* freshWorkflowRunId(secondTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const processEnds = yield* Ref.make(0)
      const lockReleases = yield* Ref.make(0)
      const ownership = CoordinatorOwnership.of({
        release: Ref.update(lockReleases, (count) => count + 1),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, {
        requestEnd: () => Ref.update(processEnds, (count) => count + 1)
      })
      const nextDrainId = yield* Ref.make(0)
      const drained = yield* Ref.make<ReadonlyArray<number>>([])
      const observedApplicationExit: ApplicationExitShellService = {
        ...applicationExit,
        awaitExecutorDrains: applicationExit.awaitExecutorDrains,
        registerProcessLocalDrain: (drain) =>
          Ref.getAndUpdate(nextDrainId, (id) => id + 1).pipe(
            Effect.flatMap((drainId) =>
              applicationExit.registerProcessLocalDrain({
                closeProcessLocalResources: drain.closeProcessLocalResources.pipe(
                  Effect.ensuring(Ref.update(drained, (ids) => [...ids, drainId]))
                )
              })
            )
          )
      }
      const first = yield* buildBootstrap(
        firstRunId,
        storage,
        defaultTrackerGraphReader,
        observedApplicationExit,
        undefined,
        ownership
      )
      const second = yield* buildBootstrap(
        secondRunId,
        storage,
        defaultTrackerGraphReader,
        observedApplicationExit,
        undefined,
        ownership
      )

      const firstResult = yield* first.applicationExitRequestBoundary.requestExit
      const repeatedResult = yield* second.applicationExitRequestBoundary.requestExit

      expect(repeatedResult).toEqual(firstResult)
      expect(yield* Ref.get(drained)).toEqual([0, 1])
      expect(yield* Ref.get(lockReleases)).toBe(1)
      expect(yield* Ref.get(processEnds)).toBe(1)
      expect(
        (yield* applicationExit.admission.prepareForwardOwner("InterruptibleBoundary").pipe(Effect.flip))._tag
      ).toBe("ApplicationExiting")
      expect(yield* applicationExit.admission.snapshot).toEqual({
        cutoffClosed: true,
        preparingOwnerCount: 0,
        registeredOwnerCount: 0
      })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a Run activation that reaches the application after the Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-activation-after-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      yield* applicationExit.requestBoundary.requestExit

      expect(
        yield* bootstrap
          .activate(
            target,
            Effect.succeed(initialPolicy),
            runId,
            Effect.die("a post-cutoff activation must not enter its runtime")
          )
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "ApplicationExiting" })
      expect(yield* storage.read(runId)).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("does not append Run termination when the program reaches finality only after the Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-finality-after-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const proof = yield* completedFinalityProof(runId, target)
            yield* Deferred.succeed(runtimeActive, undefined)
            yield* applicationExit.awaitExitRequested
            return proof
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      const exiting = yield* applicationExit.requestBoundary.requestExit.pipe(Effect.forkChild)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an activation queued before Exit when it reaches the cutoff after the active Run closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-queued-activation-at-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const first = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)
      const queuedProgramEntered = yield* Ref.make(false)
      const queued = yield* bootstrap
        .activate(
          target,
          Effect.die("the established Run must not reread an initial policy"),
          runId,
          Ref.set(queuedProgramEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow

      const exiting = yield* applicationExit.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(exiting)

      expect(yield* Fiber.join(queued).pipe(Effect.flip)).toMatchObject({ _tag: "ApplicationExiting" })
      expect(yield* Ref.get(queuedProgramEntered)).toBe(false)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("establishes an absent Run before activating its journal-backed runtime once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-fresh")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const observed = yield* Ref.make<Option.Option<Record<string, unknown>>>(Option.none())

      yield* bootstrap.activate(
        target,
        Effect.succeed(initialPolicy),
        runId,
        Effect.gen(function* () {
          const context = yield* Effect.context<never>()
          const journal = yield* Journal
          yield* Ref.set(
            observed,
            Option.some({
              graph: (yield* journal.state.get).graph._tag,
              hasInRunJournal: Option.isSome(Context.getOption(context, InRunJournal)),
              hasRawJournal: Option.isSome(Context.getOption(context, JournalStore)),
              hasLifecycleJournal: Option.isSome(Context.getOption(context, RunLifecycleJournal))
            })
          )
          return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
        })
      )

      expect(Option.getOrThrow(yield* Ref.get(observed))).toEqual({
        graph: "GraphNotEstablished",
        hasInRunJournal: true,
        hasLifecycleJournal: false,
        hasRawJournal: false
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("retries an unacknowledged Run beginning through the same entry without appending it twice", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-lost-begin-response")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const storage = JournalStore.of({
        ...delegate,
        beginRun: (requestedRunId, requestedTarget, policy) =>
          delegate
            .beginRun(requestedRunId, requestedTarget, policy)
            .pipe(
              Effect.andThen(
                Effect.fail(
                  new JournalStorageUnavailable({
                    detail: "the beginning committed before its response was lost",
                    operation: "JournalStore.beginRun"
                  })
                )
              )
            )
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const activations = yield* Ref.make(0)
      const active = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })

      expect(
        yield* bootstrap.activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Ref.update(activations, (count) => count + 1).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)
      expect(yield* Ref.get(activations)).toBe(1)
      expect((yield* delegate.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(yield* bootstrap.applicationExitRequestBoundary.requestExit).toMatchObject({ _tag: "Succeeded" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("retries a pre-commit Run beginning failure without entering activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pre-commit-begin-failure")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const beginAttempts = yield* Ref.make(0)
      const scans = yield* Ref.make(0)
      const initialPolicyEvaluations = yield* Ref.make(0)
      const programCalls = yield* Ref.make(0)
      const preCommitFailure = new JournalStorageUnavailable({
        detail: "the beginning failed before any row was committed",
        operation: "JournalStore.beginRun"
      })
      const storage = JournalStore.of({
        ...delegate,
        beginRun: (requestedRunId, requestedTarget, policy) =>
          Ref.getAndUpdate(beginAttempts, (count) => count + 1).pipe(
            Effect.flatMap((attempt) =>
              attempt === 0 ? Effect.fail(preCommitFailure) : delegate.beginRun(requestedRunId, requestedTarget, policy)
            )
          ),
        scanHot: () => Ref.update(scans, (count) => count + 1).pipe(Effect.andThen(delegate.scanHot()))
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const policy = Ref.update(initialPolicyEvaluations, (count) => count + 1).pipe(Effect.as(initialPolicy))
      const active = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
      const activation = Ref.update(programCalls, (count) => count + 1).pipe(Effect.as(finalityProof(active)))

      expect(yield* bootstrap.activate(target, policy, runId, activation).pipe(Effect.flip)).toBe(preCommitFailure)
      expect(yield* delegate.read(runId)).toEqual([])
      expect(yield* Ref.get(initialPolicyEvaluations)).toBe(1)
      // Tracker, Git, and executor boundaries exist only inside the activation program's context.
      expect(yield* Ref.get(programCalls)).toBe(0)

      expect(yield* bootstrap.activate(target, policy, runId, activation)).toEqual(active)
      expect(yield* Ref.get(initialPolicyEvaluations)).toBe(2)
      expect(yield* Ref.get(beginAttempts)).toBe(2)
      expect(yield* Ref.get(scans)).toBe(2)
      expect(yield* Ref.get(programCalls)).toBe(1)
      expect((yield* delegate.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(yield* bootstrap.applicationExitRequestBoundary.requestExit).toMatchObject({ _tag: "Succeeded" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("classifies a failed beginning from the immediately reconciled durable Run fact", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const recordedTarget = FixtureTarget.make("journaled-bootstrap-racing-recorded-target")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-racing-requested-target")
      const runId = yield* freshWorkflowRunId(requestedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const beginFailure = new JournalStorageUnavailable({
        detail: "the beginning append failed before its outcome was known",
        operation: "JournalStore.beginRun"
      })
      const targetMismatch = new WorkflowRunTargetMismatch({ recordedTarget, requestedTarget, runId })
      const alreadyTerminated = new WorkflowRunAlreadyTerminated({ runId, terminatedAt: JournalPosition.make(2) })
      const reconciliationUnavailable = new JournalStorageUnavailable({
        detail: "the reconciliation read was unavailable",
        operation: "JournalStore.readRunForRecovery"
      })
      const cases = [
        { expected: targetMismatch, reconciliationFailure: targetMismatch },
        { expected: alreadyTerminated, reconciliationFailure: alreadyTerminated },
        { expected: beginFailure, reconciliationFailure: reconciliationUnavailable }
      ] as const

      for (const { expected, reconciliationFailure } of cases) {
        const storage = JournalStore.of({
          ...delegate,
          beginRun: () => Effect.fail(beginFailure),
          readRunForRecovery: () => Effect.fail(reconciliationFailure)
        })
        const bootstrap = yield* buildBootstrap(runId, storage)
        const runtimeEntered = yield* Ref.make(false)
        const failure = yield* bootstrap
          .activate(
            requestedTarget,
            Effect.succeed(initialPolicy),
            runId,
            Ref.set(runtimeEntered, true).pipe(
              Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
            )
          )
          .pipe(Effect.flip)

        expect(failure).toBe(expected)
        expect(yield* Ref.get(runtimeEntered)).toBe(false)
      }
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("re-enters an unfinished Run without evaluating the initial policy source", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-incomplete-recovery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const activations = yield* Ref.make(0)
      const initialPolicyEvaluations = yield* Ref.make(0)
      const active = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })

      expect(
        yield* bootstrap.activate(
          target,
          Ref.update(initialPolicyEvaluations, (count) => count + 1).pipe(Effect.as(initialPolicy)),
          runId,
          Ref.update(activations, (count) => count + 1).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)
      expect(
        yield* bootstrap.activate(
          target,
          Effect.die("an established Run must not evaluate a replacement initial policy"),
          runId,
          Ref.update(activations, (count) => count + 1).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)

      expect(yield* Ref.get(activations)).toBe(2)
      expect(yield* Ref.get(initialPolicyEvaluations)).toBe(1)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a different fresh Run identity before recording its beginning", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const expectedTarget = FixtureTarget.make("journaled-bootstrap-expected")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-requested")
      const expectedRunId = yield* freshWorkflowRunId(expectedTarget)
      const requestedRunId = yield* freshWorkflowRunId(requestedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(expectedRunId, storage)

      const mismatch = yield* bootstrap
        .activate(
          requestedTarget,
          Effect.succeed(initialPolicy),
          requestedRunId,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
        )
        .pipe(Effect.flip)

      expect(mismatch).toMatchObject({ _tag: "JournaledRunIdentityMismatch", expectedRunId, requestedRunId })
      expect(yield* storage.read(requestedRunId)).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an established Run whose target differs before activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const recordedTarget = FixtureTarget.make("journaled-bootstrap-recorded-target")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-mismatched-target")
      const runId = yield* freshWorkflowRunId(recordedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(runId, recordedTarget, initialPolicy)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          requestedTarget,
          Effect.die("existing history must supply the initial policy"),
          runId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "WorkflowRunTargetMismatch", recordedTarget, requestedTarget, runId })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("names every unfinished Run and activates none when startup discovery finds several", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstTarget = FixtureTarget.make("journaled-bootstrap-first-unfinished-target")
      const secondTarget = FixtureTarget.make("journaled-bootstrap-second-unfinished-target")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-requested-after-several")
      const firstRunId = yield* freshWorkflowRunId(firstTarget)
      const secondRunId = yield* freshWorkflowRunId(secondTarget)
      const requestedRunId = yield* freshWorkflowRunId(requestedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(firstRunId, firstTarget, initialPolicy)
      yield* storage.beginRun(secondRunId, secondTarget, initialPolicy)
      const bootstrap = yield* buildBootstrap(requestedRunId, storage)
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          requestedTarget,
          Effect.die("several unfinished Runs must block initial policy evaluation"),
          requestedRunId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "StartupRecoveryBlocked",
        issues: [
          { _tag: "OtherUnfinishedRunIssue", requestedRunId, unfinishedRunId: firstRunId },
          { _tag: "OtherUnfinishedRunIssue", requestedRunId, unfinishedRunId: secondRunId }
        ]
      })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
      expect(yield* storage.read(requestedRunId)).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a terminated Run before constructing activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-terminated")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const terminatingBootstrap = yield* buildBootstrap(runId, storage)
      yield* terminatingBootstrap.activate(
        target,
        Effect.succeed(initialPolicy),
        runId,
        completedFinalityProof(runId, target)
      )
      expect((yield* storage.scanHot()).runs).toEqual([])
      expect((yield* storage.auditAll()).runs).toContainEqual(expect.objectContaining({ runId, partition: "Cold" }))
      const bootstrap = yield* buildBootstrap(runId, storage)
      expect(yield* bootstrap.readRunReactivationControl(target, runId)).toBe("RunTerminated")
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          target,
          Effect.die("terminated history must not evaluate the initial policy"),
          runId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a reopened cold SQLite Run before constructing activation", () =>
  Effect.scoped(
    withTemporaryDatabase((filename) =>
      Effect.gen(function* () {
        const target = FixtureTarget.make("journaled-bootstrap-reopened-cold-sqlite")
        const runId = yield* freshWorkflowRunId(target)

        yield* Effect.scoped(
          Effect.gen(function* () {
            const storage = yield* JournalStore
            const terminatingBootstrap = yield* buildBootstrap(runId, storage)
            expect(
              yield* terminatingBootstrap.activate(
                target,
                Effect.succeed(initialPolicy),
                runId,
                completedFinalityProof(runId, target)
              )
            ).toEqual({ _tag: "RunMayTerminate" })
            expect((yield* storage.scanHot()).runs).toEqual([])
            expect((yield* storage.auditAll()).runs).toContainEqual(
              expect.objectContaining({ runId, partition: "Cold" })
            )
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )

        yield* Effect.scoped(
          Effect.gen(function* () {
            const storage = yield* JournalStore
            expect((yield* storage.scanHot()).runs).toEqual([])
            expect((yield* storage.auditAll()).runs).toContainEqual(
              expect.objectContaining({ runId, partition: "Cold" })
            )
            const bootstrap = yield* buildBootstrap(runId, storage)
            expect(yield* bootstrap.readRunReactivationControl(target, runId)).toBe("RunTerminated")
            const runtimeEntered = yield* Ref.make(false)
            const failure = yield* bootstrap
              .activate(
                target,
                Effect.die("reopened terminal history must not evaluate the initial policy"),
                runId,
                Ref.set(runtimeEntered, true).pipe(
                  Effect.as(
                    finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
                  )
                )
              )
              .pipe(Effect.flip)

            expect(failure).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
            expect(yield* Ref.get(runtimeEntered)).toBe(false)
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename })))
        )
      })
    )
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reports one immediate retirement diagnostic after termination commits and keeps the terminal Run Hot", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-retirement-failure")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const retireAttempts = yield* Ref.make(0)
      const diagnostics = yield* Ref.make<ReadonlyArray<JournalMaintenanceDiagnostic>>([])
      const maintenanceObservation: JournalMaintenanceObservationService = {
        observe: (diagnostic) => Ref.update(diagnostics, (current) => [...current, diagnostic])
      }
      const storage = JournalStore.of({
        ...delegate,
        retireTerminalRun: () =>
          Ref.update(retireAttempts, (current) => current + 1).pipe(
            Effect.andThen(
              Effect.fail(
                new JournalStorageUnavailable({
                  detail: "controlled immediate retirement failure",
                  operation: "JournalStore.retireTerminalRun"
                })
              )
            )
          )
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        undefined,
        undefined,
        defaultOwnership,
        undefined,
        maintenanceObservation
      )

      const result = yield* bootstrap.activate(
        target,
        Effect.succeed(initialPolicy),
        runId,
        completedFinalityProof(runId, target)
      )
      const records = yield* delegate.read(runId)
      const observed = yield* Ref.get(diagnostics)

      expect(result).toEqual({ _tag: "RunMayTerminate" })
      expect(yield* Ref.get(retireAttempts)).toBe(1)
      expect(observed).toHaveLength(1)
      expect(observed[0]).toMatchObject({
        _tag: "JournalMaintenanceDiagnostic",
        operation: "JournalStore.retireTerminalRun",
        runId,
        failure: {
          _tag: "JournalStorageUnavailable",
          detail: "controlled immediate retirement failure",
          operation: "JournalStore.retireTerminalRun"
        }
      })
      expect(records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Completed" })
      expect((yield* delegate.scanHot()).runs).toContainEqual(expect.objectContaining({ runId }))
      expect((yield* delegate.auditAll()).runs).toContainEqual(expect.objectContaining({ runId, partition: "Hot" }))
      expect(yield* bootstrap.readRunReactivationControl(target, runId)).toBe("RunTerminated")

      const reactivationRuntimeEntered = yield* Ref.make(false)
      const reactivationFailure = yield* bootstrap
        .activate(
          target,
          Effect.die("terminal reactivation must not evaluate the initial policy"),
          runId,
          Ref.set(reactivationRuntimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)
      expect(reactivationFailure).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
      expect(yield* Ref.get(reactivationRuntimeEntered)).toBe(false)
      expect(yield* Ref.get(retireAttempts)).toBe(1)
      expect(yield* Ref.get(diagnostics)).toHaveLength(1)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("blocks runtime construction when the freshly read journal prefix is invalid", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-invalid-prefix")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      yield* delegate.beginRun(runId, target, initialPolicy)
      const storage = JournalStore.of({
        ...delegate,
        read: (requestedRunId) =>
          delegate
            .read(requestedRunId)
            .pipe(
              Effect.map((records) =>
                Option.match(Option.fromUndefinedOr(records[0]), {
                  onNone: () => records,
                  onSome: (began) => [...records, { ...began, position: JournalPosition.make(2) }]
                })
              )
            )
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          target,
          Effect.die("invalid existing history must not evaluate the initial policy"),
          runId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "StartupRecoveryBlocked" })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
      expect(yield* delegate.read(runId)).toHaveLength(1)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("uses the configured Run identity when establishment finds no unfinished Run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-empty-recovery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)

      const failure = yield* bootstrap
        .activate(
          target,
          Effect.fail("initial-policy-failure"),
          runId,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
        )
        .pipe(Effect.flip)

      expect(failure).toBe("initial-policy-failure")
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("publishes an Operator Pause through the active journal without exposing runtime services", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pause")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeActive = yield* Deferred.make<void>()
      const inspectPause = yield* Deferred.make<void>()
      const observedPause = yield* Deferred.make<string>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const journal = yield* Journal
            yield* Deferred.succeed(runtimeActive, undefined)
            yield* Deferred.await(inspectPause)
            yield* Deferred.succeed(observedPause, (yield* journal.state.get).reconstructed.pause.run._tag)
            yield* Deferred.await(finish)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      yield* bootstrap.operatorControl.applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
      yield* bootstrap.operatorControl.applyTaskClaimReacquisition({
        requestId: TaskClaimReacquisitionRequestId.make("pause-test-reacquisition"),
        subject: { runId, taskId: TaskId.make("pause-test-task") }
      })
      yield* Deferred.succeed(inspectPause, undefined)
      expect(yield* Deferred.await(observedPause)).toBe("RunPaused")
      expect((yield* storage.read(runId)).filter(({ event }) => event._tag === "ControlDirectionApplied")).toHaveLength(
        1
      )
      expect(
        (yield* storage.read(runId)).filter(({ event }) => event._tag === "TaskClaimReacquisitionDirected")
      ).toHaveLength(1)

      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
      const unpaused = yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Unpause",
        subject: { _tag: "Run", runId }
      })
      expect(unpaused.event).toMatchObject({ _tag: "ControlDirectionApplied", direction: "Unpause" })
      expect((yield* storage.read(runId)).filter(({ event }) => event._tag === "ControlDirectionApplied")).toHaveLength(
        2
      )
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps the Journal-backed quarantine direction route available after delivery stabilizes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-quarantine-direction")
      const runId = AllocatedWorkflowRunId.make(integrationFinalityFixture.runId)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      yield* bootstrap.activate(
        target,
        Effect.succeed(initialPolicy),
        runId,
        Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
      )

      const fixtureRun = integrationFinalityFixture.qualifiedCandidate.run
      const lineage = yield* storage.append(
        runId,
        JournalRecordKey.make("journaled-bootstrap:quarantine-direction:lineage"),
        TargetLineageObservedEvent.make({
          observation: TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: fixtureRun.session.plannedAttempt.baseSha,
            targetHeadSha: fixtureRun.session.expectedTargetHead
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: OperationId.make("journaled-bootstrap:quarantine-direction:lineage"),
          plannedAttempt: fixtureRun.session.plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const run = IntegratorRunCorrelation.make({
        ordinal: fixtureRun.ordinal,
        session: { ...fixtureRun.session, targetLineageObservedAt: lineage.position }
      })
      yield* storage.append(
        runId,
        integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(run.session)),
        IntegratorSessionFixedEvent.make({ correlation: run.session, version: workflowJournalEventVersion })
      )
      yield* storage.append(
        runId,
        integratorRunStartedRecordKey(run),
        IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
      )
      const detail = IntegratorNotPreparedDetail.make("operator must choose the next disposition")
      const result = yield* storage.append(
        runId,
        integratorRunResultRecordedRecordKey(run),
        IntegratorRunResultRecordedEvent.make({
          result: IntegratorResult.cases.NotPrepared.make({ correlation: run.session, detail }),
          run,
          version: workflowJournalEventVersion
        })
      )
      const basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
        cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail }),
        evidence: IntegrationQuarantineResultEvidence.make({ resultRecordedAt: result.position })
      })
      const quarantine = yield* storage.append(
        runId,
        integrationQuarantinedRecordKey(run.session.sessionId, basis),
        IntegrationQuarantinedEvent.make({
          basis,
          correlation: run.session,
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
      const requestId = IntegrationQuarantineDirectionRequestId.make({ nonce: "post-stabilization", runId })
      const request = {
        fingerprint: IntegrationQuarantineDirectionFingerprint.make({
          direction: "Retry",
          quarantineAt: quarantine.position,
          sessionId: run.session.sessionId
        }),
        requestId
      }
      const applied = yield* bootstrap.operatorControl.applyIntegrationQuarantineDirection(request)

      expect(applied.application.event.fingerprint.direction).toBe("Retry")
      expect(yield* bootstrap.operatorControl.applyIntegrationQuarantineDirection(request)).toEqual(applied)
      expect(yield* bootstrap.operatorControl.readIntegrationQuarantineDirection({ requestId })).toEqual(applied)
      expect(
        yield* bootstrap.operatorControl
          .readIntegrationQuarantineDirection({
            requestId: IntegrationQuarantineDirectionRequestId.make({
              nonce: "foreign-read-bootstrap",
              runId: RunId.make("foreign-quarantine-read-run")
            })
          })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournaledRunIdentityMismatch", expectedRunId: runId })
      expect(
        yield* bootstrap.operatorControl
          .applyIntegrationQuarantineDirection({
            ...request,
            requestId: IntegrationQuarantineDirectionRequestId.make({
              nonce: "foreign-bootstrap",
              runId: RunId.make("foreign-quarantine-direction-run")
            })
          })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournaledRunIdentityMismatch", expectedRunId: runId })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TargetLineageObserved",
        "IntegratorSessionFixed",
        "IntegratorRunStarted",
        "IntegratorRunResultRecorded",
        "IntegrationQuarantined",
        "IntegrationQuarantineDirectionApplied"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an unapplied Operator Pause after the application Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-exiting-pause")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      const runtimeActive = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      yield* bootstrap.applicationExitRequestBoundary.requestExit
      for (const direction of ["Pause", "Unpause"] as const) {
        expect(
          yield* bootstrap.operatorControl
            .applyControlDirection({ direction, subject: { _tag: "Run", runId } })
            .pipe(Effect.flip)
        ).toMatchObject({ _tag: "ApplicationExiting" })
      }
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reports a failed already-produced Pause write through the application Exit result", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-failed-write-at-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "ControlDirectionApplied"
            ? Effect.fail(
                new JournalStorageUnavailable({
                  detail: "authored produced-write failure",
                  operation: "JournalStore.append"
                })
              )
            : delegate.append(requestedRunId, key, event)
      })
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Ref.make(false)
      const ownership = CoordinatorOwnership.of({
        release: Ref.set(lockReleased, true),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      expect(
        yield* bootstrap.operatorControl
          .applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournalStorageUnavailable" })
      expect(yield* bootstrap.applicationExitRequestBoundary.requestExit).toEqual(
        ApplicationExitResult.cases.Failed.make({
          diagnostics: [ApplicationExitDiagnostic.make("Run journal append failed before application Exit completed")],
          requestedStatus: 1
        })
      )
      expect(yield* Ref.get(lockReleased)).toBe(true)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("tells Alice that her exact Run Pause is not applied", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-observe-unpaused")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const bootstrap = yield* buildBootstrap(runId, Context.get(journalContext, JournalStore))
      const ready = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const observation = yield* DeliveryRuntimeObservationPublication
            const journal = yield* Journal
            const acceptedAt = (yield* journal.state.get).position
            yield* observation.publish({ ...(yield* unpausedRuntimeEvaluation), acceptedAt }, [])
            yield* Deferred.succeed(ready, undefined)
            yield* Deferred.await(finish)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(ready)

      const failure = yield* bootstrap.operatorControl
        .observePause({ _tag: "Run", runId })
        .pipe(Stream.runDrain, Effect.flip)

      expect(failure).toMatchObject({ _tag: "PauseNotApplied", subject: { _tag: "Run", runId } })
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("does not keep the Run open for Alice's Pause subscription and ends it with the bootstrap scope", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-observe-disconnect")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const bootstrapScope = yield* Scope.make()
      const bootstrap = yield* buildBootstrap(runId, Context.get(journalContext, JournalStore)).pipe(
        Scope.provide(bootstrapScope)
      )
      const ready = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(ready)

      const observing = yield* bootstrap.operatorControl
        .observePause({ _tag: "Run", runId })
        .pipe(Stream.runDrain, Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(finish, undefined)

      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
      expect(observing.pollUnsafe()).toBeUndefined()
      yield* Scope.close(bootstrapScope, Exit.void)
      yield* Fiber.join(observing)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect(
  "serializes recovery inspection with the preceding runtime so no queued activation keeps a stale prefix",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = FixtureTarget.make("journaled-bootstrap-recovery-order")
        const runId = yield* freshWorkflowRunId(target)
        const journalContext = yield* Layer.build(memoryJournalStoreLayer)
        const storage = Context.get(journalContext, JournalStore)
        yield* storage.beginRun(runId, target, initialPolicy)
        const bootstrap = yield* buildBootstrap(runId, storage)
        const firstActive = yield* Deferred.make<void>()
        const appendFirst = yield* Deferred.make<void>()
        const firstAppended = yield* Deferred.make<void>()
        const finishFirst = yield* Deferred.make<void>()
        const secondActive = yield* Deferred.make<void>()
        const firstOperation = makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          OperationId.make("recovery-first-prefix"),
          target
        )
        const secondOperation = makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          OperationId.make("recovery-second-prefix"),
          target
        )

        const first = yield* bootstrap
          .activate(
            target,
            Effect.die("existing history must supply the initial policy"),
            runId,
            Effect.gen(function* () {
              const journal = yield* InRunJournal
              yield* Deferred.succeed(firstActive, undefined)
              yield* Deferred.await(appendFirst)
              yield* journal.append(
                runId,
                intentRecordKey(firstOperation.operationId),
                taskTrackerReadIntent(firstOperation)
              )
              yield* Deferred.succeed(firstAppended, undefined)
              yield* Deferred.await(finishFirst)
              return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            })
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(firstActive)
        const second = yield* bootstrap
          .activate(
            target,
            Effect.die("existing history must supply the initial policy"),
            runId,
            Effect.gen(function* () {
              const journal = yield* InRunJournal
              yield* Deferred.succeed(secondActive, undefined)
              expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
                "WorkflowRunBegan",
                "TaskTrackerReadIntentRecorded"
              ])
              yield* journal.append(
                runId,
                intentRecordKey(secondOperation.operationId),
                taskTrackerReadIntent(secondOperation)
              )
              return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            })
          )
          .pipe(Effect.forkChild)

        yield* Deferred.succeed(appendFirst, undefined)
        yield* Deferred.await(firstAppended)
        expect(yield* Deferred.isDone(secondActive)).toBe(false)
        yield* Deferred.succeed(finishFirst, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(yield* Deferred.isDone(secondActive)).toBe(true)
        expect((yield* storage.read(runId)).map(({ position }) => position)).toEqual([1, 2, 3])
      })
    ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("drains accepted Operator calls and records termination before another recovery can enter", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-close-order")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const capacityAppendStarted = yield* Deferred.make<void>()
      const releaseCapacityAppend = yield* Deferred.make<void>()
      const runtimeActive = yield* Deferred.make<void>()
      const finishRuntime = yield* Deferred.make<void>()
      const terminationStarted = yield* Deferred.make<void>()
      const allowTermination = yield* Deferred.make<void>()
      const recoveryActive = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "TaskWorkCapacityChanged"
            ? Deferred.succeed(capacityAppendStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseCapacityAppend)),
                Effect.andThen(delegate.append(requestedRunId, key, event))
              )
            : delegate.append(requestedRunId, key, event),
        terminateRun: (requestedRunId, disposition, evidence) =>
          Deferred.succeed(terminationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(allowTermination)),
            Effect.andThen(delegate.terminateRun(requestedRunId, disposition, evidence))
          )
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const proof = yield* completedFinalityProof(runId, target)
            yield* Deferred.succeed(runtimeActive, undefined)
            yield* Deferred.await(finishRuntime)
            return proof
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const currentPolicy = yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)
      const capacityChange = yield* bootstrap.operatorControl
        .setTaskWorkCapacity({ capacity: 1, expectedRevision: currentPolicy.revision, runId })
        .pipe(Effect.forkChild)
      yield* Deferred.await(capacityAppendStarted)
      yield* Deferred.succeed(finishRuntime, undefined)

      const awaitClosedAdmission = (): Effect.Effect<void> =>
        bootstrap.operatorControl
          .readTaskWorkCapacity(runId)
          .pipe(
            Effect.matchEffect({
              onFailure: (failure) => (failure._tag === "JournaledRunNotActive" ? Effect.void : Effect.die(failure)),
              onSuccess: () => Effect.yieldNow.pipe(Effect.andThen(Effect.suspend(awaitClosedAdmission)))
            })
          )
      yield* awaitClosedAdmission()
      expect(yield* Deferred.isDone(terminationStarted)).toBe(false)

      yield* Deferred.succeed(releaseCapacityAppend, undefined)
      yield* Fiber.join(capacityChange)
      yield* Deferred.await(terminationStarted)
      const queuedRecovery = yield* bootstrap
        .activate(
          target,
          Effect.die("terminated history must not evaluate the initial policy"),
          runId,
          Deferred.succeed(recoveryActive, undefined).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip, Effect.forkChild)
      expect(yield* Deferred.isDone(recoveryActive)).toBe(false)

      yield* Deferred.succeed(allowTermination, undefined)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMayTerminate" })
      expect(yield* Fiber.join(queuedRecovery)).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
      expect(yield* Deferred.isDone(recoveryActive)).toBe(false)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "TaskWorkCapacityChanged",
        "WorkflowRunTerminated"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rechecks a terminal decision after an already-accepted Operator Pause finishes appending", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pause-before-termination")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const pauseAppendStarted = yield* Deferred.make<void>()
      const releasePauseAppend = yield* Deferred.make<void>()
      const runtimeActive = yield* Deferred.make<void>()
      const finishRuntime = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "ControlDirectionApplied"
            ? Deferred.succeed(pauseAppendStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releasePauseAppend)),
                Effect.andThen(delegate.append(requestedRunId, key, event))
              )
            : delegate.append(requestedRunId, key, event)
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const proof = yield* completedFinalityProof(runId, target)
            yield* Deferred.succeed(runtimeActive, undefined)
            yield* Deferred.await(finishRuntime)
            return proof
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const pause = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
        .pipe(Effect.forkChild)
      yield* Deferred.await(pauseAppendStarted)
      yield* Deferred.succeed(finishRuntime, undefined)
      yield* Effect.yieldNow

      yield* Deferred.succeed(releasePauseAppend, undefined)
      yield* Fiber.join(pause)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "ControlDirectionApplied"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("flushes an already-started Pause append before successful Exit and preserves the applied direction", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pause-flush-before-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const pauseAppendStarted = yield* Deferred.make<void>()
      const releasePauseAppend = yield* Deferred.make<void>()
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "ControlDirectionApplied"
            ? Deferred.succeed(pauseAppendStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releasePauseAppend)),
                Effect.andThen(delegate.append(requestedRunId, key, event))
              )
            : delegate.append(requestedRunId, key, event)
      })
      const ownership = CoordinatorOwnership.of({
        release: Deferred.succeed(lockReleased, undefined).pipe(Effect.asVoid),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const pause = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
        .pipe(Effect.forkChild)
      yield* Deferred.await(pauseAppendStarted)

      const exiting = yield* bootstrap.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(lockReleased)).toBe(false)

      yield* Deferred.succeed(releasePauseAppend, undefined)
      yield* Fiber.join(pause)
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
      expect(yield* Deferred.isDone(lockReleased)).toBe(true)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "ControlDirectionApplied"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

const graphContaining = (taskId: TaskId) => {
  const projection = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(`bootstrap-control-${taskId}`),
      tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
  )
  if (projection._tag !== "Valid") throw new Error("bootstrap control fixture graph must project")
  return projection.snapshot
}

it.effect("reads the current Run target before applying Alice's task Pause", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-current-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const taskId = TaskId.make("task-2")
      const requestedTargets = yield* Ref.make<ReadonlyArray<typeof target>>([])
      const tracker = TrackerGraphReader.of({
        read: (requestedTarget) =>
          Ref.update(requestedTargets, (current) => [...current, requestedTarget as typeof target]).pipe(
            Effect.as(graphContaining(taskId))
          ),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const applied = yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId }
      })

      expect(yield* Ref.get(requestedTargets)).toEqual([target])
      expect(applied.event).toMatchObject({
        _tag: "ControlDirectionApplied",
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId }
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "ControlDirectionApplied"
      ])
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects Alice's stale task Pause and Unpause visibly without applying either direction", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-stale-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const taskId = TaskId.make("task-2")
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      for (const direction of ["Pause", "Unpause"] as const) {
        const rejection = yield* bootstrap.operatorControl
          .applyControlDirection({ direction, subject: { _tag: "Task", runId, taskId } })
          .pipe(Effect.flip)

        expect(rejection).toMatchObject({
          _tag: "TaskControlSubjectOutsideRun",
          direction,
          reason: "OutsideCurrentTargetClosure",
          runId,
          taskId
        })
      }
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps an unreadable task membership distinct from stale rejection and applies nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-unreadable-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const taskId = TaskId.make("task-2")
      const unreadable = new TrackerAdapterReadError({
        context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
        detail: "current target closure is incomplete",
        reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
      })
      const tracker = TrackerGraphReader.of({
        read: () => Effect.fail(unreadable),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const failure = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Unpause", subject: { _tag: "Task", runId, taskId } })
        .pipe(Effect.flip)

      expect(failure).toBe(unreadable)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      const observed = (yield* storage.read(runId)).find(({ event }) => event._tag === "TaskTrackerFactsObserved")
      expect(
        observed?.event._tag === "TaskTrackerFactsObserved" ? observed.event.observation : undefined
      ).toMatchObject({
        _tag: "TaskTrackerFactsReadFailed",
        completeness: "Unreadable",
        failure: { _tag: "TrackerAdapterReadError", reason: { _tag: "IncompleteSnapshot" } }
      })
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects another Run's task subject before reading this Run's target", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-foreign-run-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const foreignRunId = yield* freshWorkflowRunId(FixtureTarget.make("another-run-target"))
      const taskId = TaskId.make("task-2")
      const tracker = TrackerGraphReader.of({
        read: () => Effect.die("a foreign Run request must not read the active Run target"),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const failure = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Pause", subject: { _tag: "Task", runId: foreignRunId, taskId } })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "InRunJournalRunMismatch",
        expectedRunId: runId,
        requestedRunId: foreignRunId
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("applies Alice's Run Pause without a task-membership read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-run-control-without-membership")
      const runId = yield* freshWorkflowRunId(target)
      const tracker = TrackerGraphReader.of({
        read: () => Effect.die("Run control must not read task membership"),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const applied = yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Run", runId }
      })
      expect(applied.event).toMatchObject({ _tag: "ControlDirectionApplied", subject: { _tag: "Run", runId } })
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("applies inactive Run controls through the Journal while inactive Task control stays NotActive", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-inactive-run-control")
      const runId = yield* freshWorkflowRunId(target)
      const tracker = TrackerGraphReader.of({
        read: () => Effect.die("inactive Run control must not read tracker facts"),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      expect(yield* bootstrap.readRunReactivationControl(target, runId)).toBe("RunUnpaused")
      expect(
        yield* bootstrap.readRunReactivationControl(target, RunId.make("different-reactivation-run")).pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournaledRunIdentityMismatch" })
      yield* storage.beginRun(runId, target, initialPolicy)
      expect(
        yield* bootstrap
          .readRunReactivationControl(FixtureTarget.make("different-reactivation-target"), runId)
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "WorkflowRunTargetMismatch" })
      const observed = yield* Ref.make<ReadonlyArray<string>>([])
      yield* bootstrap.registerAcceptedRunReactivationObservers({
        control: (direction) => Ref.update(observed, (current) => [...current, direction]),
        acceptedFactPublication: () => Effect.void
      })
      expect(
        yield* bootstrap.operatorControl
          .applyControlDirection({
            direction: "Pause",
            subject: { _tag: "Run", runId: RunId.make("different-reactivation-run") }
          })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournaledRunIdentityMismatch" })

      const paused = yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Run", runId }
      })
      expect(paused.event).toMatchObject({ _tag: "ControlDirectionApplied", direction: "Pause" })
      expect(yield* bootstrap.readRunReactivationControl(target, runId)).toBe("RunPaused")
      expect(yield* Ref.get(observed)).toEqual(["Pause"])

      const taskFailure = yield* bootstrap.operatorControl
        .applyControlDirection({
          direction: "Pause",
          subject: { _tag: "Task", runId, taskId: TaskId.make("inactive-task") }
        })
        .pipe(Effect.flip)
      expect(taskFailure).toMatchObject({ _tag: "JournaledRunNotActive" })

      const unpaused = yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Unpause",
        subject: { _tag: "Run", runId }
      })
      expect(unpaused.event).toMatchObject({ _tag: "ControlDirectionApplied", direction: "Unpause" })
      expect(yield* bootstrap.readRunReactivationControl(target, runId)).toBe("RunUnpaused")
      expect(yield* Ref.get(observed)).toEqual(["Pause", "Unpause"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reads inactive integration quarantine control from the Journal", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-inactive-quarantine-control")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const requestId = IntegrationQuarantineDirectionRequestId.make({ nonce: "inactive-quarantine-read", runId })

      const failure = yield* bootstrap.operatorControl
        .readIntegrationQuarantineDirection({ requestId })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "IntegrationQuarantineDirectionResultNotFound", requestId })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps an initial delivery publication harmless before reactivation observers are registered", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-publication-without-observer")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const publicationCount = yield* Ref.make(0)
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        undefined,
        undefined,
        defaultOwnership,
        publicationCount
      )

      expect(
        yield* bootstrap.activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
        )
      ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect(yield* Ref.get(publicationCount)).toBe(1)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("publishes an accepted delivery fact through the bootstrap's attached Run observer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-publication-hint")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const publicationCount = yield* Ref.make(0)
      const hints = yield* Ref.make(0)
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        undefined,
        undefined,
        defaultOwnership,
        publicationCount
      )
      yield* bootstrap.registerAcceptedRunReactivationObservers({
        control: () => Effect.void,
        acceptedFactPublication: () => Ref.update(hints, (current) => current + 1)
      })

      yield* bootstrap.activate(
        target,
        Effect.succeed(initialPolicy),
        runId,
        Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
      )

      expect(yield* Ref.get(publicationCount)).toBe(1)
      expect(yield* Ref.get(hints)).toBe(1)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("observes live terminal executor change once and releases the exact position", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-passive-terminal")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const taskId = TaskId.make("journaled-bootstrap-passive-terminal-task")
      const specification = makeTaskWorkSpecification({ body: "Complete A.", taskId, title: "Complete A" })
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("journaled-bootstrap-passive-terminal-attempt"),
        baseSha: GitCommitSha.make("7".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/journaled-bootstrap-passive-terminal"),
        executor: TaskExecutorLocator.make("executor:journaled-bootstrap-passive-terminal"),
        runId,
        taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make("/worktrees/journaled-bootstrap-passive-terminal")
      })
      yield* storage.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("journaled-bootstrap-passive-terminal-specification"),
        target,
        taskId,
        []
      )
      yield* storage.append(
        runId,
        intentRecordKey(specificationOperation.operationId),
        taskTrackerReadIntent(specificationOperation)
      )
      yield* storage.append(
        runId,
        outcomeRecordKey(specificationOperation.operationId),
        TaskTrackerFactsObservedEvent.make({
          observation: makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification),
          operationId: specificationOperation.operationId,
          version: workflowJournalEventVersion
        })
      )
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("journaled-bootstrap-passive-terminal-plan"),
        plannedAttempt,
        predecessorOperationIds: [specificationOperation.operationId]
      })
      yield* storage.append(
        runId,
        attemptPlanRecordKey(plannedAttempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
      )

      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      const terminal = PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: { _tag: "Completed" }
        })
      })
      const changes = yield* Queue.unbounded<typeof terminal>()
      const terminalAccepted = yield* Deferred.make<void>()
      const beginCalls = yield* Ref.make(0)
      const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
        attach: () =>
          Effect.succeed({
            changes: Stream.fromQueue(changes),
            close: Effect.void,
            current: PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing })
          })
      })
      const executor = PlannedAttemptExecutor.of({
        begin: () => Ref.update(beginCalls, (count) => count + 1).pipe(Effect.as(executing)),
        observe: () => Effect.die("the lifecycle attachment owns passive projection"),
        requestSuspension: () => Effect.die("terminal observation must not suspend"),
        resume: () => Effect.die("terminal observation must not resume")
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        undefined,
        undefined,
        defaultOwnership,
        undefined,
        noopJournalMaintenanceObservation,
        undefined,
        executor,
        lifecycle
      )
      const admissionCapture =
        yield* Deferred.make<
          Effect.Success<ReturnType<DeliveryRuntimeResources["Service"]["makeAdmissionController"]>>
        >()

      expect(
        yield* bootstrap.activate(
          target,
          Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
          runId,
          Effect.gen(function* () {
            const resources = yield* DeliveryRuntimeResources
            const observer = yield* PassivePlannedAttemptObserver
            const admission = yield* resources.makeAdmissionController({ capacity: TaskWorkCapacity.make(1), held: [] })
            const protocol = yield* PlannedAttemptProtocolController
            const publication = yield* PassivePlannedAttemptProjectionPublication
            yield* protocol.withPermit(correlation, (permit) =>
              Effect.gen(function* () {
                const beginReport = yield* beginPlannedAttemptExecutorWorkWithPermit(
                  permit,
                  plannedAttempt,
                  specification
                )
                expect(beginReport).toEqual(executing)
                yield* admission.synchronize({ capacity: TaskWorkCapacity.make(1), held: [{ correlation, taskId }] })
                yield* observer.attach({
                  plannedAttempt,
                  publishCurrent: (projection) => publication.publishWithPermit(permit, plannedAttempt, projection),
                  publishChange: (projection) =>
                    publication.publish(plannedAttempt, projection).pipe(
                      Effect.tap(() => Deferred.succeed(terminalAccepted, undefined)),
                      Effect.asVoid
                    )
                })
              })
            )
            yield* Deferred.succeed(admissionCapture, admission)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
          })
        )
      ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })

      const admission = yield* Deferred.await(admissionCapture)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({ correlation })
      yield* Queue.offer(changes, terminal)
      yield* Deferred.await(terminalAccepted)

      const records = yield* storage.read(runId)
      expect(yield* Ref.get(beginCalls)).toBe(1)
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" ? [[event.ordinal, event.report._tag] as const] : []
        )
      ).toEqual([
        [1, "ExecutorWorkExecuting"],
        [2, "ExecutorWorkTerminal"]
      ])
      expect((yield* admission.snapshot).positions.size).toBe(0)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("observes safe suspension only after exact suspend intent and releases only that attempt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-passive-safe")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const taskId = TaskId.make("journaled-bootstrap-passive-safe-task")
      const specification = makeTaskWorkSpecification({ body: "Suspend A.", taskId, title: "Suspend A" })
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("journaled-bootstrap-passive-safe-attempt"),
        baseSha: GitCommitSha.make("8".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/journaled-bootstrap-passive-safe"),
        executor: TaskExecutorLocator.make("executor:journaled-bootstrap-passive-safe"),
        runId,
        taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make("/worktrees/journaled-bootstrap-passive-safe")
      })
      const independentAttempt = captureTestAttempt(runId, "passive-safe-independent", "passive-safe-independent")
      const independentCorrelation = plannedAttemptExecutorCorrelation(independentAttempt)
      yield* storage.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
      )
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("journaled-bootstrap-passive-safe-specification"),
        target,
        taskId,
        []
      )
      yield* storage.append(
        runId,
        intentRecordKey(specificationOperation.operationId),
        taskTrackerReadIntent(specificationOperation)
      )
      yield* storage.append(
        runId,
        outcomeRecordKey(specificationOperation.operationId),
        TaskTrackerFactsObservedEvent.make({
          observation: makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification),
          operationId: specificationOperation.operationId,
          version: workflowJournalEventVersion
        })
      )
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("journaled-bootstrap-passive-safe-plan"),
        plannedAttempt,
        predecessorOperationIds: [specificationOperation.operationId]
      })
      yield* storage.append(
        runId,
        attemptPlanRecordKey(plannedAttempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
      )

      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      const safe = PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
      const changes = yield* Queue.unbounded<typeof safe>()
      const safeAccepted = yield* Deferred.make<void>()
      const beginCalls = yield* Ref.make(0)
      const suspendCalls = yield* Ref.make(0)
      const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
        attach: () =>
          Effect.succeed({
            changes: Stream.fromQueue(changes),
            close: Effect.void,
            current: PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing })
          })
      })
      const executor = PlannedAttemptExecutor.of({
        begin: () => Ref.update(beginCalls, (count) => count + 1).pipe(Effect.as(executing)),
        observe: () => Effect.die("the lifecycle attachment owns passive projection"),
        requestSuspension: () => Ref.update(suspendCalls, (count) => count + 1).pipe(Effect.as(executing)),
        resume: () => Effect.die("safe observation must not resume")
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        undefined,
        undefined,
        defaultOwnership,
        undefined,
        noopJournalMaintenanceObservation,
        undefined,
        executor,
        lifecycle
      )
      const admissionCapture =
        yield* Deferred.make<
          Effect.Success<ReturnType<DeliveryRuntimeResources["Service"]["makeAdmissionController"]>>
        >()

      expect(
        yield* bootstrap.activate(
          target,
          Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })),
          runId,
          Effect.gen(function* () {
            const resources = yield* DeliveryRuntimeResources
            const observer = yield* PassivePlannedAttemptObserver
            const admission = yield* resources.makeAdmissionController({ capacity: TaskWorkCapacity.make(2), held: [] })
            const protocol = yield* PlannedAttemptProtocolController
            const publication = yield* PassivePlannedAttemptProjectionPublication
            yield* protocol.withPermit(correlation, (permit) =>
              Effect.gen(function* () {
                yield* beginPlannedAttemptExecutorWorkWithPermit(permit, plannedAttempt, specification)
                yield* requestPlannedAttemptExecutorSuspensionWithPermit(permit, plannedAttempt)
                yield* admission.synchronize({
                  capacity: TaskWorkCapacity.make(2),
                  held: [
                    { correlation, taskId },
                    { correlation: independentCorrelation, taskId: independentAttempt.taskId }
                  ]
                })
                yield* observer.attach({
                  plannedAttempt,
                  publishCurrent: (projection) => publication.publishWithPermit(permit, plannedAttempt, projection),
                  publishChange: (projection) =>
                    publication.publish(plannedAttempt, projection).pipe(
                      Effect.tap(() => Deferred.succeed(safeAccepted, undefined)),
                      Effect.asVoid
                    )
                })
              })
            )
            yield* Deferred.succeed(admissionCapture, admission)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
          })
        )
      ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })

      const admission = yield* Deferred.await(admissionCapture)
      expect((yield* admission.snapshot).positions.get(taskId)).toMatchObject({ correlation })
      yield* Queue.offer(changes, safe)
      yield* Deferred.await(safeAccepted)

      const records = yield* storage.read(runId)
      expect(yield* Ref.get(beginCalls)).toBe(1)
      expect(yield* Ref.get(suspendCalls)).toBe(1)
      expect(
        records.flatMap(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? [event.command] : []))
      ).toEqual(["Begin", "Suspend"])
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" ? [[event.ordinal, event.report._tag] as const] : []
        )
      ).toEqual([
        [1, "ExecutorWorkExecuting"],
        [2, "ExecutorWorkSafelySuspended"]
      ])
      const snapshot = yield* admission.snapshot
      expect(snapshot.positions.size).toBe(1)
      expect(snapshot.positions.get(taskId)).toBeUndefined()
      expect(snapshot.positions.get(independentAttempt.taskId)).toMatchObject({ correlation: independentCorrelation })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("bootstrap composition can reconstruct and manually attach the exact executing attempt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-passive-restart-executing")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      const plannedAttempt = captureTestAttempt(runId, "restart-executing", "restart-executing")
      yield* appendExecutorHistory(storage, runId, plannedAttempt, "Running")
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const recordsBeforeRestart = yield* storage.read(runId)
      const reconstruction = reduceWorkflowJournalHistory(runId, recordsBeforeRestart)
      if (reconstruction._tag === "InvalidWorkflowJournalHistory") {
        return yield* Effect.die("the controlled shared Journal prefix must reconstruct")
      }
      const positions = requiredPlannedAttemptPositionsOf(reconstruction.runState)
      expect(positions).toEqual([{ attemptId: plannedAttempt.attemptId, runId, taskId: plannedAttempt.taskId }])
      const executing = PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
      const attachments = yield* Ref.make(0)
      const beginCalls = yield* Ref.make(0)
      const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
        attach: () =>
          Ref.update(attachments, (count) => count + 1).pipe(
            Effect.as({ changes: Stream.never, close: Effect.void, current: executing })
          )
      })
      const executor = PlannedAttemptExecutor.of({
        begin: () => Ref.update(beginCalls, (count) => count + 1).pipe(Effect.as(executing.report)),
        observe: () => Effect.die("restart lifecycle attachment owns the exact current projection"),
        requestSuspension: () => Effect.die("restart while Executing must not suspend"),
        resume: () => Effect.die("restart while Executing must not resume")
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        undefined,
        undefined,
        defaultOwnership,
        undefined,
        noopJournalMaintenanceObservation,
        undefined,
        executor,
        lifecycle
      )
      const admissionCapture =
        yield* Deferred.make<
          Effect.Success<ReturnType<DeliveryRuntimeResources["Service"]["makeAdmissionController"]>>
        >()

      yield* bootstrap.activate(
        target,
        Effect.die("restart must not evaluate a fresh initial policy"),
        runId,
        Effect.gen(function* () {
          const resources = yield* DeliveryRuntimeResources
          const observer = yield* PassivePlannedAttemptObserver
          const admission = yield* resources.makeAdmissionController({
            capacity: TaskWorkCapacity.make(1),
            held: positions.map(({ attemptId, runId, taskId }) => ({ correlation: { attemptId, runId }, taskId }))
          })
          const protocol = yield* PlannedAttemptProtocolController
          const publication = yield* PassivePlannedAttemptProjectionPublication
          yield* protocol.withPermit(correlation, (permit) =>
            observer.attach({
              plannedAttempt,
              publishCurrent: (projection) => publication.publishWithPermit(permit, plannedAttempt, projection),
              publishChange: (projection) => publication.publish(plannedAttempt, projection).pipe(Effect.asVoid)
            })
          )
          yield* Deferred.succeed(admissionCapture, admission)
          return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
        })
      )

      expect(yield* Ref.get(attachments)).toBe(1)
      expect(yield* Ref.get(beginCalls)).toBe(0)
      expect(
        (yield* (yield* Deferred.await(admissionCapture)).snapshot).positions.get(plannedAttempt.taskId)
      ).toMatchObject({ correlation })
      expect(yield* storage.read(runId)).toHaveLength(recordsBeforeRestart.length)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("recovers process death before terminal publication by reprojecting and accepting terminal once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-passive-restart-terminal")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      const plannedAttempt = captureTestAttempt(runId, "restart-terminal", "restart-terminal")
      yield* appendExecutorHistory(storage, runId, plannedAttempt, "Running")
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const reconstruction = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
      if (reconstruction._tag === "InvalidWorkflowJournalHistory") {
        return yield* Effect.die("the controlled shared Journal prefix must reconstruct")
      }
      const positions = requiredPlannedAttemptPositionsOf(reconstruction.runState)
      const terminal = PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: { _tag: "Completed" }
        })
      })
      const attachments = yield* Ref.make(0)
      const beginCalls = yield* Ref.make(0)
      const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
        attach: () =>
          Ref.update(attachments, (count) => count + 1).pipe(
            Effect.as({ changes: Stream.empty, close: Effect.void, current: terminal })
          )
      })
      const executor = PlannedAttemptExecutor.of({
        begin: () => Ref.update(beginCalls, (count) => count + 1).pipe(Effect.as(terminal.report)),
        observe: () => Effect.die("restart lifecycle attachment owns the retained Terminal projection"),
        requestSuspension: () => Effect.die("Terminal restart must not suspend"),
        resume: () => Effect.die("Terminal restart must not resume")
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        undefined,
        undefined,
        defaultOwnership,
        undefined,
        noopJournalMaintenanceObservation,
        undefined,
        executor,
        lifecycle
      )
      const admissionCapture =
        yield* Deferred.make<
          Effect.Success<ReturnType<DeliveryRuntimeResources["Service"]["makeAdmissionController"]>>
        >()

      yield* bootstrap.activate(
        target,
        Effect.die("restart must not evaluate a fresh initial policy"),
        runId,
        Effect.gen(function* () {
          const resources = yield* DeliveryRuntimeResources
          const observer = yield* PassivePlannedAttemptObserver
          const admission = yield* resources.makeAdmissionController({
            capacity: TaskWorkCapacity.make(1),
            held: positions.map(({ attemptId, runId, taskId }) => ({ correlation: { attemptId, runId }, taskId }))
          })
          const protocol = yield* PlannedAttemptProtocolController
          const publication = yield* PassivePlannedAttemptProjectionPublication
          const observed = yield* protocol.withPermit(correlation, (permit) =>
            observer.attach({
              plannedAttempt,
              publishCurrent: (projection) => publication.publishWithPermit(permit, plannedAttempt, projection),
              publishChange: () => Effect.die("Terminal current projection must end the attachment")
            })
          )
          expect(observed.report._tag).toBe("ExecutorWorkTerminal")
          yield* Deferred.succeed(admissionCapture, admission)
          return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
        })
      )

      expect(yield* Ref.get(attachments)).toBe(1)
      expect(yield* Ref.get(beginCalls)).toBe(0)
      expect((yield* (yield* Deferred.await(admissionCapture)).snapshot).positions.size).toBe(1)
      expect(
        (yield* storage.read(runId)).flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" ? [[event.ordinal, event.report._tag] as const] : []
        )
      ).toEqual([
        [1, "ExecutorWorkExecuting"],
        [2, "ExecutorWorkTerminal"]
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("retains responsibility and position for absent unavailable unreadable or foreign projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const cases = [
        {
          errorTag: "PlannedAttemptExecutorStateNoCurrentReport",
          observationTag: "ExecutorStateNoCurrentReport",
          projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
            PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
        },
        {
          errorTag: "PlannedAttemptExecutorStateTemporarilyUnavailable",
          observationTag: "ExecutorStateTemporarilyUnavailable",
          projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
            PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation })
        },
        {
          errorTag: "PlannedAttemptExecutorStateUnreadable",
          observationTag: "ExecutorStateUnreadable",
          projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
            PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation })
        },
        {
          errorTag: "PlannedAttemptExecutorCorrelationMismatch",
          observationTag: "ExecutorReportContradiction",
          projection: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) =>
            PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
              expected: correlation,
              observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                correlation: {
                  attemptId: AttemptId.make("journaled-bootstrap-passive-failure-foreign"),
                  runId: correlation.runId
                }
              })
            })
        }
      ] as const

      for (const [index, testCase] of cases.entries()) {
        const target = FixtureTarget.make(`journaled-bootstrap-passive-failure-${index}`)
        const runId = yield* freshWorkflowRunId(target)
        const journalContext = yield* Layer.build(memoryJournalStoreLayer)
        const storage = Context.get(journalContext, JournalStore)
        yield* storage.beginRun(
          runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        const plannedAttempt = captureTestAttempt(runId, `failure-${index}`, `failure-${index}`)
        yield* appendExecutorHistory(storage, runId, plannedAttempt, "Running")
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        const projection = testCase.projection(correlation)
        const attachments = yield* Ref.make(0)
        const closes = yield* Ref.make(0)
        const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
          attach: () =>
            Ref.update(attachments, (count) => count + 1).pipe(
              Effect.as({ changes: Stream.empty, close: Ref.update(closes, (count) => count + 1), current: projection })
            )
        })
        const bootstrap = yield* buildBootstrap(
          runId,
          storage,
          defaultTrackerGraphReader,
          undefined,
          undefined,
          defaultOwnership,
          undefined,
          noopJournalMaintenanceObservation,
          undefined,
          undefined,
          lifecycle
        )
        const admissionCapture =
          yield* Deferred.make<
            Effect.Success<ReturnType<DeliveryRuntimeResources["Service"]["makeAdmissionController"]>>
          >()
        const failureCapture = yield* Deferred.make<string>()

        yield* bootstrap.activate(
          target,
          Effect.succeed(InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })),
          runId,
          Effect.gen(function* () {
            const resources = yield* DeliveryRuntimeResources
            const observer = yield* PassivePlannedAttemptObserver
            const admission = yield* resources.makeAdmissionController({
              capacity: TaskWorkCapacity.make(1),
              held: [{ correlation, taskId: plannedAttempt.taskId }]
            })
            const protocol = yield* PlannedAttemptProtocolController
            const publication = yield* PassivePlannedAttemptProjectionPublication
            const failure = yield* protocol.withPermit(correlation, (permit) =>
              observer
                .attach({
                  plannedAttempt,
                  publishCurrent: (candidate) => publication.publishWithPermit(permit, plannedAttempt, candidate),
                  publishChange: () => Effect.die("a non-exact current projection must end the attachment")
                })
                .pipe(Effect.flip)
            )
            yield* Deferred.succeed(failureCapture, String(failure._tag))
            yield* Deferred.succeed(admissionCapture, admission)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
          })
        )

        expect(yield* Deferred.await(failureCapture)).toBe(testCase.errorTag)
        expect({ attachments: yield* Ref.get(attachments), closes: yield* Ref.get(closes) }).toEqual({
          attachments: 1,
          closes: 1
        })
        const admission = yield* Deferred.await(admissionCapture)
        expect((yield* admission.snapshot).positions.get(plannedAttempt.taskId)).toMatchObject({ correlation })
        const records = yield* storage.read(runId)
        expect(
          records.flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorStateObserved" ? [event.observation._tag] : []
          )
        ).toEqual([testCase.observationTag])
        expect(records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
      }
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect(
  "accepted executor report publication grants no report-specific tracker read and leaves generic reactivation ordinary",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = FixtureTarget.make("journaled-bootstrap-passive-report-hint")
        const runId = yield* freshWorkflowRunId(target)
        const journalContext = yield* Layer.build(memoryJournalStoreLayer)
        const storage = Context.get(journalContext, JournalStore)
        yield* storage.beginRun(runId, target, initialPolicy)
        const plannedAttempt = captureTestAttempt(runId, "passive-publication", "passive-publication")
        yield* appendExecutorHistory(storage, runId, plannedAttempt, "Running")
        const trackerReads = yield* Ref.make(0)
        const hints = yield* Ref.make(0)
        const positionPresentAtHint = yield* Ref.make<ReadonlyArray<boolean>>([])
        const publicationCapture = yield* Deferred.make<PassivePlannedAttemptProjectionPublicationService>()
        const admissionCapture =
          yield* Deferred.make<
            Effect.Success<ReturnType<DeliveryRuntimeResources["Service"]["makeAdmissionController"]>>
          >()
        const bootstrap = yield* buildBootstrap(
          runId,
          storage,
          TrackerGraphReader.of({
            read: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(settledGraph.snapshot)),
            readTaskWorkSpecification: () => Effect.die("passive report publication must not read task work")
          }),
          undefined,
          undefined,
          defaultOwnership,
          undefined,
          noopJournalMaintenanceObservation,
          publicationCapture
        )
        yield* bootstrap.registerAcceptedRunReactivationObservers({
          control: () => Effect.void,
          acceptedFactPublication: () =>
            Effect.gen(function* () {
              const admission = yield* Deferred.await(admissionCapture)
              const snapshot = yield* admission.snapshot
              yield* Ref.update(positionPresentAtHint, (current) => [
                ...current,
                snapshot.positions.has(plannedAttempt.taskId)
              ])
              yield* Ref.update(hints, (count) => count + 1)
            })
        })
        yield* bootstrap.activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const resources = yield* DeliveryRuntimeResources
            const admission = yield* resources.makeAdmissionController({
              capacity: TaskWorkCapacity.make(1),
              held: [{ correlation: plannedAttemptExecutorCorrelation(plannedAttempt), taskId: plannedAttempt.taskId }]
            })
            yield* Deferred.succeed(admissionCapture, admission)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
          })
        )

        const publication = yield* Deferred.await(publicationCapture)
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        const terminal = PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation,
            result: { _tag: "Completed" }
          })
        })
        const first = yield* publication.publish(plannedAttempt, terminal)
        const repeated = yield* publication.publish(plannedAttempt, terminal)

        expect(yield* Ref.get(trackerReads)).toBe(0)
        expect(yield* Ref.get(hints)).toBe(1)
        expect(yield* Ref.get(positionPresentAtHint)).toEqual([false])
        expect([first.acceptedFacts, repeated.acceptedFacts]).toEqual(["Changed", "UnchangedPassiveObservation"])
        expect(
          (yield* storage.read(runId)).filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkTerminal" &&
              event.report.correlation.attemptId === plannedAttempt.attemptId
          )
        ).toHaveLength(1)
      })
    ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a second process-local Run reactivation observer pair instead of stealing owner updates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-single-owner-observer")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const observers: AcceptedRunReactivationObservers = {
        control: () => Effect.void,
        acceptedFactPublication: () => Effect.void
      }
      yield* bootstrap.registerAcceptedRunReactivationObservers(observers)
      const failure = yield* bootstrap.registerAcceptedRunReactivationObservers(observers).pipe(Effect.flip)
      expect(failure).toMatchObject({ _tag: "JournaledRunReactivationObserverAlreadyRegistered" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)
