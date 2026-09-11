import {
  AcceptedResult,
  AcceptedResultEvidenceManifest,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorRequest,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelation,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { describe, expect, expectTypeOf, it } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Context, Deferred, Effect, Fiber, Layer, Option, Queue, Ref, Result, Stream } from "effect"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { GraphProjectionError, projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import {
  FixtureReadError,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerReadError
} from "../../authorities/task-tracker/graph-reader.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import {
  ActiveTaskClaim,
  TrackerMutation,
  UnclaimedTask,
  type TaskClaimObservation
} from "../../authorities/task-tracker/claim-mutation.js"
import { TaskLifecycle, type Task, TrackerRevision } from "../../authorities/task-tracker/task.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import {
  makeFreshTaskAdmissionTestBasis,
  makeFreshTaskCommitmentForTest
} from "../../../test/support/fresh-task-admission.js"
import { makeExecutingAttemptHistory } from "../../../test/support/executing-attempt-history.js"
import { makeAcceptedIntegrationHistory } from "../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../test/support/promoted-integration-history.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  AuthoritativeTaskClaimAcquired,
  AuthoritativeTaskClaimObserved,
  observeTaskClaimThrough,
  releaseTaskClaimThrough,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { AuthoritativeTaskClaimReleased } from "../../workflow/protocols/task-claim-release/protocol.js"
import { AuthoritativeTaskWorktreeReady } from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import { TaskAttemptPlanRecordAcknowledged } from "../../workflow/protocols/task-attempt-planning/record.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  attemptPlanRecordKey,
  attemptChoiceAppliedRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  plannedAttemptContinuationAuthorizedRecordKey,
  runCancellationAppliedRecordKey
} from "../../workflow-journal/record-key.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  GitReadIntentRecordedEvent,
  PlannedAttemptWorktreeObservedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import {
  makeCompletionTaskFactsObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTargetLineageObservationOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import {
  QueuedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import {
  CancelledAttemptImplementationResponsibilityRelinquishedEvent,
  RunCancellationAppliedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import { PlannedAttemptContinuationAuthorizedEvent } from "../../workflow/protocols/planned-attempt-continuation/events.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import { deliveryProposalsOf, freshContinuationDecisionsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { executeAcceptedWorkflowAction, executeNewRecoveredAction } from "./recovered-delivery-action-adapter.js"
import { DeliveryActionExecutor, type DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import {
  makePlannedAttemptProtocolController,
  PlannedAttemptProtocolController
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import type {
  AcceptedIdentityDeliveryProposal,
  DeliveryActionProposal,
  FreshIdentityDeliveryProposal,
  IdentityFreeDeliveryProposal,
  TrackerGraphActionProposal
} from "./delivery-action-proposal.js"
import { executeIntegrationAction } from "./integration-delivery-action-adapter.js"
import {
  Integrator,
  IntegratorCallFailure,
  IntegratorCandidateText,
  IntegratorGit,
  IntegratorGitReadFailure,
  IntegratorNotPreparedDetail,
  IntegratorProviderActivityAbsent,
  IntegratorRunProtocolResult,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorResult
} from "../../workflow/protocols/integrator/protocol.js"
import {
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  integrationQuarantineDirectionSubject
} from "../../workflow/protocols/integration-quarantine/events.js"
import { IntegratorBoundaryUnavailable } from "./integrator-boundary.js"
import {
  integratorCorrelationFor,
  integratorInitialRunCorrelationFor,
  integratorSuccessorCorrelationFor
} from "../../workflow/protocols/integrator/session.js"
import { executeFreshWorkflowOperation } from "./fresh-delivery-action-adapter.js"
import { executeFreshTrackerGraphRead, executeTrackerGraphRead } from "./delivery-action-adapter-common.js"
import { executePlannedAttemptTransition as executePlannedAttemptTransitionRaw } from "./planned-attempt-delivery-action-adapter.js"
import { publishPlannedAttemptExecutorProjectionResultWithPermit } from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication
} from "../run/passive-planned-attempt-observer.js"
import {
  continuationTaskAuthorityFor,
  evaluatePlannedAttemptContinuationAuthorization
} from "../../workflow/protocols/planned-attempt-continuation/authorization-evaluation.js"
import {
  authorizePlannedAttemptContinuation,
  authorizePlannedAttemptContinuationWithPermit
} from "../../workflow/protocols/planned-attempt-continuation/protocol.js"
import { liveDeliveryActionExecutorLayer, makeLiveDeliveryActionExecutor } from "./live-delivery-action-executor.js"
import { makeDeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import {
  completionClaimDeletionRequestFor,
  CompletionClaimBoundary,
  CompletionClaimMarkerAbsent,
  CompletionClaimReadFailure,
  completionClaimReplacementOperationIdFor,
  completionClaimReplacementRequestFor,
  completionTaskRequestFor,
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestFailure,
  CompletionTaskRequestLookup,
  FocusedCompletedTaskObservation,
  FocusedTaskCompletionFacts,
  FocusedTaskCompletionReadFailure
} from "../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture as sourceIntegrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeFocusedTaskCompletionFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  TaskTrackerFactsReadFailed,
  TaskTrackerFactsObservedEvent,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { TargetPromotionGitReadObservation } from "../../workflow/protocols/target-promotion/events.js"
import { TargetPromotionRuntime } from "../../workflow/protocols/target-promotion/runtime.js"
import {
  EvidenceStore,
  EvidenceStoreFailure,
  type EvidenceStoreService
} from "../../workflow/protocols/evidence-store.js"
import { IntegrationFinalityRuntimeUnavailable } from "./integration-finality-boundary.js"
import { TargetPromotionRuntimeUnavailable } from "./target-promotion-boundary.js"
import { postPromotionBlockerClearAuthorizationFor } from "../../workflow/protocols/integration-finality/post-promotion-blocker-ancestry.js"
import { liveJournalTestLayer } from "./live-journal-test-layer.js"

const runId = RunId.make("route-matrix-run")
const taskId = TaskId.make("A")
const target = FixtureTarget.make("route-matrix-target")
const task: Task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
const specification = makeTaskWorkSpecification({ body: "Route matrix body", taskId, title: "Route matrix task" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("route-matrix-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/A"),
  executor: TaskExecutorLocator.make("executor:fake"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/A")
})
const inactivePassiveObserver = PassivePlannedAttemptObserver.of({
  attach: () => Effect.die("the inactive route fixture must not attach executor lifecycle observation")
})
const inactivePassivePublication = PassivePlannedAttemptProjectionPublication.of({
  publish: () => Effect.die("the inactive route fixture must not publish executor lifecycle changes"),
  publishWithPermit: () => Effect.die("the inactive route fixture must not publish an executor current projection")
})
const executePlannedAttemptTransition = (...args: Parameters<typeof executePlannedAttemptTransitionRaw>) =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const journal = yield* InRunJournal
    const accepted = yield* AcceptedJournalReader
    const observer = PassivePlannedAttemptObserver.of({
      attach: (input) =>
        executor
          .observe(plannedAttemptExecutorCorrelation(input.plannedAttempt), passiveLifecycleObservationPurpose)
          .pipe(Effect.flatMap(input.publishCurrent), Effect.provideService(AcceptedJournalReader, accepted))
    })
    const publication = PassivePlannedAttemptProjectionPublication.of({
      publish: () => Effect.die("the one-shot route fixture emits no later lifecycle changes"),
      publishWithPermit: (permit, plannedAttempt, projection) =>
        publishPlannedAttemptExecutorProjectionResultWithPermit(permit, plannedAttempt, projection).pipe(
          Effect.provideService(InRunJournal, journal),
          Effect.provideService(AcceptedJournalReader, accepted)
        )
    })
    return yield* executePlannedAttemptTransitionRaw(...args).pipe(
      Effect.provideService(PassivePlannedAttemptObserver, observer),
      Effect.provideService(PassivePlannedAttemptProjectionPublication, publication)
    )
  })
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const acceptedResult = AcceptedResult.make({
  commit: GitCommitSha.make("2".repeat(40)),
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("2".repeat(64)) })
})

it("makes stopped and ordinary claim-release route authorities mutually unconstructible", () => {
  type StoppedRelease = Extract<Transition, { readonly _tag: "ReleaseStoppedAttemptClaim" }>["operation"]
  type ExternalRelease = Extract<Transition, { readonly _tag: "ReleaseExternallyCompletedTaskClaim" }>["operation"]

  expectTypeOf<StoppedRelease["authority"]["_tag"]>().toEqualTypeOf<"StoppedAttemptClaimReleaseAuthority">()
  expectTypeOf<ExternalRelease["authority"]["_tag"]>().toEqualTypeOf<"WorkflowClaimReleaseAuthority">()
})

it("routes cancellation claim release through settlement as a new operation action", () => {
  type CancelledRelease = Extract<Transition, { readonly _tag: "ReleaseCancelledAttemptClaim" }>["operation"]
  expectTypeOf<CancelledRelease["authority"]["_tag"]>().toEqualTypeOf<"CancelledAttemptClaimReleaseAuthority">()
})
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("accepted-claim"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("route-matrix-token")
})
const acceptedExecutingHistory = makeExecutingAttemptHistory({
  activeClaim,
  plannedAttempt,
  runId,
  taskSpecification: specification,
  trackerTarget: target
})
const acceptedIntegrationHistory = makeAcceptedIntegrationHistory({
  acceptedResult,
  activeClaim,
  integrationTarget,
  plannedAttempt,
  runId,
  targetHeadSha: GitCommitSha.make("4".repeat(40)),
  taskSpecification: specification,
  trackerTarget: target
})
const finalitySpecification = makeTaskWorkSpecification({
  body: "Exercise exact finality routes through an accepted integration history.",
  taskId: sourceIntegrationFinalityFixture.taskId,
  title: "Delivery proposal finality fixture"
})
const acceptedFinalityHistory = makeAcceptedIntegrationHistory({
  acceptedResult: sourceIntegrationFinalityFixture.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: sourceIntegrationFinalityFixture.activeClaim,
  integrationTarget: sourceIntegrationFinalityFixture.integrationTarget,
  plannedAttempt: {
    ...sourceIntegrationFinalityFixture.plannedAttempt,
    taskRevision: finalitySpecification.fingerprint
  },
  runId: sourceIntegrationFinalityFixture.runId,
  targetHeadSha: sourceIntegrationFinalityFixture.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: finalitySpecification,
  trackerTarget: sourceIntegrationFinalityFixture.target
})
const promotedFinalityHistory = makePromotedIntegrationHistory({
  candidateCommit: sourceIntegrationFinalityFixture.qualifiedCandidate.candidateCommit,
  candidateText: sourceIntegrationFinalityFixture.qualifiedCandidate.candidateText,
  originalClaim: acceptedFinalityHistory.activeClaim,
  records: acceptedFinalityHistory.records,
  session: integratorCorrelationFor(acceptedFinalityHistory)
})
const finalityFocusedOperation = makeCompletionTaskFactsObservationOperation(
  promotedFinalityHistory.completionRequest,
  sourceIntegrationFinalityFixture.target,
  sourceIntegrationFinalityFixture.focusedSuccessFactsEvent.observation.purpose
)
const finalityFocusedFacts = FocusedTaskCompletionFacts.make({
  ...sourceIntegrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
  currentClaim: promotedFinalityHistory.claim,
  operationId: finalityFocusedOperation.operationId,
  taskRevision: acceptedFinalityHistory.plannedAttempt.taskRevision
})
const finalityFocusedObservation = makeFocusedTaskCompletionFactsObserved(
  finalityFocusedOperation,
  finalityFocusedFacts
)
const finalityFocusedEvent = {
  _tag: "TaskTrackerFactsObserved",
  observation: finalityFocusedObservation,
  operationId: finalityFocusedOperation.operationId,
  version: workflowJournalEventVersion
} satisfies TaskTrackerFactsObservedEvent
const integrationFinalityFixture = {
  ...sourceIntegrationFinalityFixture,
  claim: promotedFinalityHistory.claim,
  completionRequest: promotedFinalityHistory.completionRequest,
  focusedSuccessFactsEvent: finalityFocusedEvent,
  plannedAttempt: acceptedFinalityHistory.plannedAttempt,
  promotionCorrelation: promotedFinalityHistory.promotionCorrelation,
  promotionSuccess: promotedFinalityHistory.promotionSuccess,
  qualifiedCandidate: promotedFinalityHistory.qualifiedCandidate,
  successObservation: FocusedCompletedTaskObservation.make({
    ...sourceIntegrationFinalityFixture.successObservation,
    claim: promotedFinalityHistory.claim,
    operationId: finalityFocusedOperation.operationId,
    taskRevision: acceptedFinalityHistory.plannedAttempt.taskRevision
  })
}
const started = acceptedIntegrationHistory.responsibility
const queued = QueuedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget,
  plannedAttempt,
  preIntegrationCancellation: { attemptId: plannedAttempt.attemptId, queuedAt: started.queuedAt, runId },
  queuedAt: started.queuedAt
})
const acceptedTerminalRecord = acceptedIntegrationHistory.records.find(
  ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
)
if (acceptedTerminalRecord === undefined) throw new Error("accepted integration history lacks its terminal report")
const unqueued = UnqueuedAcceptedResult.make({
  acceptedResult,
  plannedAttempt,
  terminalAt: acceptedTerminalRecord.position
})
const responsibilityBeganAt = JournalPosition.make(18)

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const isAcceptedIdentityProposal = (proposal: DeliveryActionProposal): proposal is AcceptedIdentityDeliveryProposal =>
  proposal.actionIdentity._tag === "ExistingOperationId"

type FreshOperationProposal = Extract<
  FreshIdentityDeliveryProposal,
  { readonly actionIdentity: { readonly _tag: "FreshOperationIdRequired" } }
>

const isFreshOperationProposal = (proposal: DeliveryActionProposal): proposal is FreshOperationProposal =>
  proposal.actionIdentity._tag === "FreshOperationIdRequired"

type FreshTrackerGraphProposal = Extract<
  TrackerGraphActionProposal,
  {
    readonly actionIdentity: { readonly _tag: "FreshOperationIdRequired" }
    readonly route: { readonly _tag: "TrackerGraphReadRoute" }
  }
>

const isFreshTrackerGraphProposal = (proposal: TrackerGraphActionProposal): proposal is FreshTrackerGraphProposal =>
  proposal.actionIdentity._tag === "FreshOperationIdRequired"

const proposalsFor = (transition: Transition, acceptedOperationIds: ReadonlySet<OperationId> = new Set()) => {
  const result = deliveryProposalsOf({
    acceptedOperationIds,
    fresh: [],
    integrationResponsibilities: [started],
    responsibilities: [
      { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: responsibilityBeganAt, plannedAttempt }
    ],
    runId,
    transitions: [transition]
  })
  return { issues: result.issues, proposals: [...result.ticketDelivery, ...result.deliverySettlement] }
}

it("derives a fresh settlement proposal for the exact cancelled-attempt claim release", () => {
  const observationOperationId = OperationId.make("cancelled-route-observation")
  const release = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
      cancellationAppliedAt: JournalPosition.make(22),
      implementationRelinquishedAt: JournalPosition.make(23),
      observationOperationId
    }),
    predecessorOperationIds: [activeClaim.operationId, observationOperationId],
    release: { claim: activeClaim, operationId: OperationId.make("cancelled-route-release") }
  })
  const result = proposalsFor(
    RunnableFrontierTransition.ReleaseCancelledAttemptClaim({ operation: release, plannedAttempt })
  )
  expect(result.issues).toEqual([])
  expect(result.proposals).toMatchObject([
    {
      owner: "DeliverySettlement",
      actionIdentity: { _tag: "FreshOperationIdRequired" },
      route: {
        _tag: "RecoveredNewActionRoute",
        action: {
          _tag: "ReleaseCancelledAttemptClaim",
          plannedAttempt,
          operation: {
            _tag: "ReleaseTaskClaim",
            authority: { _tag: "CancelledAttemptClaimReleaseAuthority" },
            predecessorOperationIds: [activeClaim.operationId, observationOperationId]
          }
        }
      }
    }
  ])
})

const inertLease: DeliveryActionExecutionLease = {
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    isActive: () => Effect.succeed(false),
    isHeld: () => Effect.succeed(false),
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilities: [], heldResponsibilities: [] }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol lease")
}

const inertPlannedAttemptExecutor = PlannedAttemptExecutor.of({
  observe: () => Effect.die("unused planned-attempt observation"),
  requestSuspension: () => Effect.die("unused planned-attempt suspension"),
  begin: () => Effect.die("unused planned-attempt begin"),
  resume: () => Effect.die("unused planned-attempt resume")
})

interface LiveJournalHarness {
  readonly accepted: AcceptedJournalReader["Service"]
  readonly journal: InRunJournal["Service"]
  readonly records: ReturnType<InRunJournal["Service"]["read"]>
}

const makeLiveJournalHarness = Effect.fn("DeliveryProposalRoutesTest.makeLiveJournalHarness")(function* (
  records: ReadonlyArray<JournalRecord>,
  journalRunId: RunId = runId,
  trackerTarget: typeof target = target
) {
  const context = yield* Layer.build(
    liveJournalTestLayer({ records, runId: journalRunId, target: trackerTarget }).pipe(Layer.orDie)
  )
  const journal = Context.get(context, InRunJournal)
  return {
    accepted: Context.get(context, AcceptedJournalReader),
    journal,
    records: journal.read(journalRunId)
  } satisfies LiveJournalHarness
})

const provideLiveJournal = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  harness: LiveJournalHarness,
  journal: InRunJournal["Service"] = harness.journal
) =>
  effect.pipe(
    Effect.provideService(AcceptedJournalReader, harness.accepted),
    Effect.provideService(InRunJournal, journal)
  )

effectIt.effect("executes cancellation no-release only for a fresh foreign claim observation", () =>
  Effect.gen(function* () {
    const harness = yield* makeLiveJournalHarness(acceptedExecutingHistory.records)
    const cancellation = yield* harness.journal.append(
      runId,
      runCancellationAppliedRecordKey,
      RunCancellationAppliedEvent.make({
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    })
    yield* harness.journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Suspend",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: suspendOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* harness.journal.append(
      runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal: suspendOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report: safeReport,
        version: workflowJournalEventVersion
      })
    )
    const safeOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
    yield* harness.journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, safeOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: safeOrdinal,
        report: safeReport,
        version: workflowJournalEventVersion
      })
    )
    const relinquished = yield* harness.journal.append(
      runId,
      describeJournalEvent(
        CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
          authorizedClaim: activeClaim,
          cancellationAppliedAt: cancellation.position,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          plannedAttempt,
          proof: { _tag: "AcceptedReport", reportOrdinal: safeOrdinal },
          version: workflowJournalEventVersion
        })
      ).expectedKey,
      CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
        authorizedClaim: activeClaim,
        cancellationAppliedAt: cancellation.position,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        plannedAttempt,
        proof: { _tag: "AcceptedReport", reportOrdinal: safeOrdinal },
        version: workflowJournalEventVersion
      })
    )
    const observationOperation = makeTaskClaimObservationOperation(
      OperationId.make("route-matrix-cancelled-claim-read"),
      target,
      taskId,
      [activeClaim.operationId]
    )
    const foreignClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("route-matrix-foreign-claim"),
      owner: ClaimOwner.make("foreign-owner"),
      taskId,
      token: ClaimToken.make("route-matrix-foreign-token")
    })
    const readIntent = yield* harness.journal.append(
      runId,
      intentRecordKey(observationOperation.operationId),
      taskTrackerReadIntent(observationOperation)
    )
    const observation = yield* harness.journal.append(
      runId,
      outcomeRecordKey(observationOperation.operationId),
      taskTrackerFactsObservedEvent(
        observationOperation.operationId,
        makeFocusedTaskClaimFactsObserved(observationOperation, foreignClaim)
      )
    )
    const transition = RunnableFrontierTransition.RecordCancelledAttemptClaimNoRelease({
      observationOperationId: observationOperation.operationId,
      plannedAttempt
    })
    const proposal = proposalsFor(transition).proposals[0]
    if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
      return yield* Effect.die("missing cancellation no-release proposal")
    }
    const result = yield* executePlannedAttemptTransition(
      { _tag: "IdentityFreeAction", proposal },
      transition,
      inertLease
    ).pipe(
      (effect) => provideLiveJournal(effect, harness),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(result).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(
      (yield* harness.records).findLast(({ event }) => event._tag === "CancelledAttemptClaimNoReleaseObserved")?.event
    ).toMatchObject({
      _tag: "CancelledAttemptClaimNoReleaseObserved",
      expectedClaim: activeClaim,
      observationOperationId: observationOperation.operationId,
      plannedAttempt
    })

    const missingReadIntentRecords = [cancellation, relinquished, observation]
    expect(reduceWorkflowJournalHistory(runId, missingReadIntentRecords)._tag).toBe("InvalidWorkflowJournalHistory")

    const noPredecessorOperation = makeTaskClaimObservationOperation(
      observationOperation.operationId,
      target,
      taskId,
      []
    )
    const noPredecessorRead: JournalRecord = {
      event: taskTrackerReadIntent(noPredecessorOperation),
      key: JournalRecordKey.make("route-matrix-cancelled-claim-no-predecessor-read"),
      position: JournalPosition.make(3),
      runId
    }
    const noPredecessorObservation: JournalRecord = {
      event: taskTrackerFactsObservedEvent(
        noPredecessorOperation.operationId,
        makeFocusedTaskClaimFactsObserved(noPredecessorOperation, foreignClaim)
      ),
      key: JournalRecordKey.make("route-matrix-cancelled-claim-no-predecessor-observation"),
      position: JournalPosition.make(4),
      runId
    }
    const exactObservation: JournalRecord = {
      ...observation,
      event: taskTrackerFactsObservedEvent(
        observationOperation.operationId,
        makeFocusedTaskClaimFactsObserved(observationOperation, activeClaim)
      )
    }
    const mismatchedReadKind: JournalRecord = {
      event: taskTrackerReadIntent(
        makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          observationOperation.operationId,
          target
        )
      ),
      key: JournalRecordKey.make("route-matrix-cancelled-claim-mismatched-read-kind"),
      position: JournalPosition.make(3),
      runId
    }
    const cases: ReadonlyArray<ReadonlyArray<JournalRecord>> = [
      [cancellation, readIntent, observation],
      [cancellation, relinquished, readIntent],
      [cancellation, relinquished, mismatchedReadKind, observation],
      [cancellation, relinquished, noPredecessorRead, noPredecessorObservation],
      [cancellation, relinquished, readIntent, exactObservation],
      yield* harness.records
    ]
    for (const rawBoundaryHistory of cases) {
      expect(
        rawBoundaryHistory.filter(({ event }) => event._tag === "CancelledAttemptClaimNoReleaseObserved")
      ).toHaveLength(rawBoundaryHistory === cases.at(-1) ? 1 : 0)
    }
  })
)

effectIt.effect("executes cancellation settlement through suspension, relinquishment, reread, and exact release", () =>
  Effect.gen(function* () {
    const acquisitionOperation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: activeClaim.operationId,
        owner: activeClaim.owner,
        taskId: activeClaim.taskId,
        token: activeClaim.token
      },
      predecessorOperationIds: []
    })
    const postClaimGraphOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("route-matrix-cancellation-chronology-post-claim-graph"),
      target,
      [activeClaim.operationId],
      [taskId]
    )
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("route-matrix-cancellation-chronology-specification"),
      target,
      taskId,
      [postClaimGraphOperation.operationId]
    )
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("route-matrix-cancellation-chronology-plan"),
      plannedAttempt,
      predecessorOperationIds: [specificationOperation.operationId]
    })
    const worktreeOperation = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("route-matrix-cancellation-chronology-worktree"),
      plannedAttempt,
      predecessorOperationIds: [planOperation.operationId]
    })
    const worktreeProof = PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    })
    const cancellationPosition = JournalPosition.make(15)
    const cancellation: JournalRecord = {
      event: RunCancellationAppliedEvent.make({
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      key: runCancellationAppliedRecordKey,
      position: cancellationPosition,
      runId
    }
    const initialCommandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    const initialReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    const initialExecutingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    })
    const harness = yield* makeLiveJournalHarness([
      makeWorkflowRunBeganRecord(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      ),
      {
        event: TaskClaimAcquisitionIntendedEvent.make({
          operation: acquisitionOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(acquisitionOperation.acquisition.operationId),
        position: JournalPosition.make(2),
        runId
      },
      {
        event: TaskClaimAcquiredEvent.make({ claim: activeClaim, version: workflowJournalEventVersion }),
        key: outcomeRecordKey(acquisitionOperation.acquisition.operationId),
        position: JournalPosition.make(3),
        runId
      },
      {
        event: taskTrackerReadIntent(postClaimGraphOperation),
        key: intentRecordKey(postClaimGraphOperation.operationId),
        position: JournalPosition.make(4),
        runId
      },
      {
        event: taskTrackerGraphFactsObserved(postClaimGraphOperation, {
          revision: TrackerRevision.make("route-matrix-cancellation-chronology-graph"),
          taskIds: [taskId]
        }),
        key: outcomeRecordKey(postClaimGraphOperation.operationId),
        position: JournalPosition.make(5),
        runId
      },
      {
        event: taskTrackerReadIntent(specificationOperation),
        key: intentRecordKey(specificationOperation.operationId),
        position: JournalPosition.make(6),
        runId
      },
      {
        event: taskTrackerFactsObservedEvent(
          specificationOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
        ),
        key: outcomeRecordKey(specificationOperation.operationId),
        position: JournalPosition.make(7),
        runId
      },
      {
        event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
        key: attemptPlanRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(8),
        runId
      },
      {
        event: TaskWorktreeReconciliationIntendedEvent.make({
          operation: worktreeOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(worktreeOperation.operationId),
        position: JournalPosition.make(9),
        runId
      },
      {
        event: TaskWorktreeReadyEvent.make({
          operationId: worktreeOperation.operationId,
          proof: worktreeProof,
          version: workflowJournalEventVersion
        }),
        key: outcomeRecordKey(worktreeOperation.operationId),
        position: JournalPosition.make(10),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(11),
        runId
      },
      {
        event: PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Begin",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: initialCommandOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, initialCommandOrdinal),
        position: JournalPosition.make(12),
        runId
      },
      {
        event: PlannedAttemptExecutorCommandResponseObservedEvent.make({
          commandOrdinal: initialCommandOrdinal,
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt,
          report: initialExecutingReport,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, initialCommandOrdinal),
        position: JournalPosition.make(13),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: initialReportOrdinal,
          report: initialExecutingReport,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, initialReportOrdinal),
        position: JournalPosition.make(14),
        runId
      },
      cancellation
    ])
    const journal = harness.journal
    const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    })
    const trackerObservation = yield* Ref.make<TaskClaimObservation>(activeClaim)
    const trackerReads = yield* Ref.make(0)
    const trackerReleases = yield* Ref.make(0)
    const tracker = TrackerMutation.of({
      acquireTaskClaim: () => Effect.die("unused claim acquisition"),
      readTaskClaim: (_task) =>
        Ref.update(trackerReads, (count) => count + 1).pipe(Effect.andThen(Ref.get(trackerObservation))),
      releaseTaskClaim: (release) =>
        Ref.update(trackerReleases, (count) => count + 1).pipe(
          Effect.andThen(Ref.set(trackerObservation, UnclaimedTask.make({ taskId: release.claim.taskId })))
        )
    })
    const baseInterpreterLayer = Layer.effect(
      WorkflowInterpreter,
      Effect.succeed(
        WorkflowInterpreter.of({
          acquireTaskClaim: () => Effect.die("unused claim acquisition"),
          readTaskClaim: (operation) => observeTaskClaimThrough(tracker, operation),
          readTaskWorktree: () => Effect.die("unused worktree read"),
          readTargetLineage: () => Effect.die("unused target-lineage read"),
          readTrackerGraph: () => Effect.die("unused tracker graph read"),
          readTaskWorkSpecification: () => Effect.die("unused specification read"),
          reconcileTaskWorktree: () => Effect.die("unused worktree reconciliation"),
          recordTaskAttemptPlan: () => Effect.die("unused attempt planning"),
          releaseTaskClaim: (operation) => releaseTaskClaimThrough(tracker, operation)
        })
      )
    )
    const journaledInterpreter = journaledWorkflowInterpreterLayer(runId, baseInterpreterLayer).pipe(
      Layer.provide(Layer.succeed(InRunJournal, journal)),
      Layer.provide(Layer.succeed(TrackerMutation, tracker))
    )
    const protocolController = yield* makePlannedAttemptProtocolController()
    const lease: DeliveryActionExecutionLease = {
      ...inertLease,
      forwardBoundary: {
        _tag: "InterruptibleBoundary",
        execution: { run: (_intent, effect, recordResult) => effect.pipe(Effect.flatMap(recordResult)) }
      },
      withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
    }
    const live = yield* makeLiveDeliveryActionExecutor(runId, target).pipe(
      Effect.provide(journaledInterpreter),
      Effect.provideService(InRunJournal, journal),
      Effect.provideService(AcceptedJournalReader, harness.accepted),
      Effect.provideService(PassivePlannedAttemptObserver, inactivePassiveObserver),
      Effect.provideService(PassivePlannedAttemptProjectionPublication, inactivePassivePublication),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          observe: () =>
            Effect.succeed(
              PlannedAttemptExecutorProjection.cases.NoReport.make({
                correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
              })
            ),
          requestSuspension: () => Effect.succeed(safeReport),
          begin: () => Effect.die("unexpected begin after cancellation"),
          resume: () => Effect.die("unexpected resume after cancellation")
        })
      ),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planner") })
      ),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.die("unused operation allocator") })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused attempt planner") })
      )
    )

    const suspendTransition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    const suspendProposal = proposalsFor(suspendTransition).proposals[0]
    if (suspendProposal === undefined || !isIdentityFreeProposal(suspendProposal)) {
      return yield* Effect.die("missing cancellation suspension proposal")
    }
    yield* live.execute({ _tag: "IdentityFreeAction", proposal: suspendProposal }, lease)
    expect((yield* harness.records).some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(true)

    const relinquishedTransition = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2) }
    })
    const relinquishedProposal = proposalsFor(relinquishedTransition).proposals[0]
    if (relinquishedProposal === undefined || !isIdentityFreeProposal(relinquishedProposal)) {
      return yield* Effect.die("missing cancellation relinquishment proposal")
    }
    yield* live.execute({ _tag: "IdentityFreeAction", proposal: relinquishedProposal }, lease)
    const afterRelinquishment = yield* harness.records
    const relinquishedRecord = afterRelinquishment.findLast(
      ({ event }) => event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
    )
    if (relinquishedRecord === undefined) return yield* Effect.die("missing cancellation relinquishment event")

    const claimReadOperation = makeTaskClaimObservationOperation(
      OperationId.make("route-matrix-cancellation-chronology-claim-read"),
      target,
      taskId,
      [activeClaim.operationId]
    )
    const claimReadTransition = RunnableFrontierTransition.ObserveCancelledAttemptClaim({
      operation: claimReadOperation,
      plannedAttempt
    })
    const claimReadProposal = proposalsFor(claimReadTransition).proposals[0]
    if (claimReadProposal === undefined || !isFreshOperationProposal(claimReadProposal)) {
      return yield* Effect.die("missing cancellation claim observation proposal")
    }
    yield* live.execute(
      { _tag: "FreshOperationAction", operationId: claimReadOperation.operationId, proposal: claimReadProposal },
      lease
    )
    expect(
      (yield* harness.records).some(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === claimReadOperation.operationId
      )
    ).toBe(true)

    const releaseOperation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
        cancellationAppliedAt: cancellationPosition,
        implementationRelinquishedAt: relinquishedRecord.position,
        observationOperationId: claimReadOperation.operationId
      }),
      predecessorOperationIds: [activeClaim.operationId, claimReadOperation.operationId],
      release: {
        claim: activeClaim,
        operationId: OperationId.make("route-matrix-cancellation-chronology-claim-release")
      }
    })
    const releaseTransition = RunnableFrontierTransition.ReleaseCancelledAttemptClaim({
      operation: releaseOperation,
      plannedAttempt
    })
    const releaseProposal = proposalsFor(releaseTransition).proposals[0]
    if (releaseProposal === undefined || !isFreshOperationProposal(releaseProposal)) {
      return yield* Effect.die("missing cancellation claim release proposal")
    }
    yield* live.execute(
      { _tag: "FreshOperationAction", operationId: releaseOperation.release.operationId, proposal: releaseProposal },
      lease
    )
    const releasedRecords = yield* harness.records
    expect(releasedRecords.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(releasedRecords.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    expect(yield* Ref.get(trackerReads)).toBe(3)
    expect(yield* Ref.get(trackerReleases)).toBe(1)

    // Re-delivery of the same fresh release operation must replay its durable outcome without another tracker call.
    yield* live.execute(
      { _tag: "FreshOperationAction", operationId: releaseOperation.release.operationId, proposal: releaseProposal },
      lease
    )
    const replayedRecords = yield* harness.records
    expect(replayedRecords.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(replayedRecords.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    expect(yield* Ref.get(trackerReads)).toBe(3)
    expect(yield* Ref.get(trackerReleases)).toBe(1)
    expect(
      replayedRecords.filter(({ event }) =>
        ["AttemptImplementationAbandoned", "AttemptChoiceApplied", "PlannedAttemptReplaced"].includes(event._tag)
      )
    ).toHaveLength(0)
    expect(
      replayedRecords
        .filter(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
            event._tag === "PlannedAttemptExecutorCommandIntended" ||
            event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
        )
        .every(({ event }) => "plannedAttempt" in event && event.plannedAttempt.worktree === plannedAttempt.worktree)
    ).toBe(true)
    expect(
      replayedRecords
        .flatMap(({ event }) => (event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report] : []))
        .every(
          (report) =>
            report.correlation.runId === plannedAttempt.runId &&
            report.correlation.attemptId === plannedAttempt.attemptId
        )
    ).toBe(true)
    expect(reduceWorkflowJournalHistory(runId, replayedRecords)._tag).toBe("ValidWorkflowJournalHistory")
  })
)

effectIt.effect("revalidates cancellation quiescence while holding the attempt protocol", () =>
  Effect.gen(function* () {
    const makeCancellationHarness = Effect.fn("DeliveryProposalRoutesTest.makeCancellationHarness")(function* (
      safeBeforeCancellation: boolean
    ) {
      const harness = yield* makeLiveJournalHarness(acceptedExecutingHistory.records)
      const safeOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
      const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
      const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      })
      const appendSafe = Effect.gen(function* () {
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Suspend",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: suspendOrdinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: suspendOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt,
            report: safe,
            version: workflowJournalEventVersion
          })
        )
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, safeOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: safeOrdinal,
            report: safe,
            version: workflowJournalEventVersion
          })
        )
      })
      if (safeBeforeCancellation) yield* appendSafe
      const cancellation = yield* harness.journal.append(
        runId,
        runCancellationAppliedRecordKey,
        RunCancellationAppliedEvent.make({
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          version: workflowJournalEventVersion
        })
      )
      if (!safeBeforeCancellation) yield* appendSafe
      return { cancellation, harness, safeOrdinal }
    })
    const current = yield* makeCancellationHarness(false)
    const transition = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: current.safeOrdinal }
    })
    const proposal = proposalsFor(transition).proposals[0]
    if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
      return yield* Effect.die("missing cancellation relinquishment proposal")
    }
    const protocolController = yield* makePlannedAttemptProtocolController()
    const lease: DeliveryActionExecutionLease = {
      ...inertLease,
      withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
    }
    const staleTransition = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(1) }
    })
    yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, staleTransition, lease).pipe(
      (effect) => provideLiveJournal(effect, current.harness),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(
      (yield* current.harness.records).some(
        ({ event }) => event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
      )
    ).toBe(false)

    yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, lease).pipe(
      (effect) => provideLiveJournal(effect, current.harness),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(
      (yield* current.harness.records).findLast(
        ({ event }) => event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
      )?.event
    ).toMatchObject({
      _tag: "CancelledAttemptImplementationResponsibilityRelinquished",
      authorizedClaim: activeClaim,
      cancellationAppliedAt: current.cancellation.position,
      plannedAttempt
    })

    const preCancellationSafe = yield* makeCancellationHarness(true)
    const preCancellationTransition = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: { _tag: "AcceptedReport", reportOrdinal: preCancellationSafe.safeOrdinal }
    })
    yield* executePlannedAttemptTransition(
      { _tag: "IdentityFreeAction", proposal },
      preCancellationTransition,
      lease
    ).pipe(
      (effect) => provideLiveJournal(effect, preCancellationSafe.harness),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(
      (yield* preCancellationSafe.harness.records).some(
        ({ event }) => event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
      )
    ).toBe(true)
  })
)

const encodedEvidence = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

const completionEvidenceStore: EvidenceStoreService = {
  put: () => Effect.die("completion adapter tests never publish evidence"),
  read: (reference) => {
    if (
      reference.digest ===
      integrationFinalityFixture.claim.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult
        .evidenceManifest.digest
    ) {
      return Effect.succeed(
        encodedEvidence(
          AcceptedResultEvidenceManifest.make({
            commit:
              integrationFinalityFixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult.commit,
            correlation: {
              attemptId: integrationFinalityFixture.plannedAttempt.attemptId,
              runId: integrationFinalityFixture.runId
            },
            formatVersion: 1,
            outcome: "Accepted",
            predecessor: null
          })
        )
      )
    }
    return Effect.die(`unexpected evidence read: ${reference.digest}`)
  }
}

const completionPromotionRuntime = TargetPromotionRuntime.of({
  git: {
    compareAndSet: () => Effect.die("task completion only rereads Git"),
    read: () =>
      Effect.succeed(
        TargetPromotionGitReadObservation.cases.CandidateCurrent.make({
          currentHeadSha: integrationFinalityFixture.promotionCorrelation.qualifiedCandidate.candidateCommit
        })
      )
  }
})

describe("delivery proposal route matrix", () => {
  it("reuses accepted identity for every operation-reconciliation route", () => {
    const operationId = OperationId.make("accepted-operation")
    const transitions = [
      RunnableFrontierTransition.CheckTaskClaim({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskClaimRelease({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskWorktree({ operationId, taskId })
    ]

    for (const transition of transitions) {
      expect(proposalsFor(transition, new Set([operationId]))).toMatchObject({
        issues: [],
        proposals: [
          {
            actionIdentity: { _tag: "ExistingOperationId" },
            owner: "TicketDelivery",
            route: { _tag: "AcceptedWorkflowRoute", transition }
          }
        ]
      })
    }

    const firstTransition = transitions[0]
    if (firstTransition === undefined) return expect.fail("route matrix must contain one accepted-operation transition")
    expect(proposalsFor(firstTransition)).toMatchObject({
      issues: [{ _tag: "AcceptedOperationEvidenceMissing", operationId }],
      proposals: []
    })
  })

  it("retries Alice's exact stopped-claim release after reconciliation keeps the claim current", () => {
    const requestId = AttemptChoiceRequestId.make({ nonce: "retry-stopped-release", runId })
    const observationOperationId = OperationId.make("retry-stopped-release-observation")
    const operationId = OperationId.make("retry-stopped-release-operation")
    const operation = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId,
        requestId
      }),
      predecessorOperationIds: [activeClaim.operationId, observationOperationId],
      release: { claim: activeClaim, operationId }
    })
    const transition = RunnableFrontierTransition.RetryStoppedAttemptClaimRelease({
      operation,
      requestId,
      subject: { observedTaskRevision: TaskRevision.make("retry-stopped-release-F2"), plannedAttempt }
    })

    expect(proposalsFor(transition, new Set([operationId]))).toMatchObject({
      issues: [],
      proposals: [
        { actionIdentity: { _tag: "ExistingOperationId" }, route: { _tag: "AcceptedWorkflowRoute", transition } }
      ]
    })
  })

  it("distinguishes new observation reads from accepted observation reconciliation", () => {
    const graphOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("observe-graph"),
      target
    )
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("observe-specification"),
      target,
      taskId
    )
    const claimOperation = makeTaskClaimObservationOperation(OperationId.make("observe-claim"), target, taskId)
    const worktreeOperation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("observe-worktree"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("observe-lineage"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const observations = [
      {
        actionTag: "ReadTrackerGraph",
        operationId: graphOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
          operation: graphOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTaskWorkSpecification",
        operationId: specificationOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
          operation: specificationOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTaskClaim",
        operationId: claimOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
          operation: claimOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTaskWorktree",
        operationId: worktreeOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
          operation: worktreeOperation,
          plannedAttempt
        })
      },
      {
        actionTag: "ReadTargetLineage",
        operationId: lineageOperation.operationId,
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
          operation: lineageOperation,
          plannedAttempt
        })
      }
    ] as const

    for (const { actionTag, operationId, transition } of observations) {
      const fresh = proposalsFor(transition)
      const accepted = proposalsFor(transition, new Set([operationId]))

      expect(proposalsFor(transition)).toEqual(fresh)
      expect(proposalsFor(transition, new Set([operationId]))).toEqual(accepted)
      expect(fresh).toMatchObject({
        issues: [],
        proposals: [
          {
            actionIdentity: { _tag: "FreshOperationIdRequired" },
            route: { _tag: "RecoveredNewActionRoute", action: { _tag: actionTag } }
          }
        ]
      })
      expect(JSON.stringify(fresh)).not.toContain(operationId)
      expect(accepted).toMatchObject({
        issues: [],
        proposals: [
          { actionIdentity: { _tag: "ExistingOperationId" }, route: { _tag: "AcceptedWorkflowRoute", transition } }
        ]
      })
    }

    const responsibleClaimOperation = makeTaskClaimObservationOperation(
      OperationId.make("observe-responsible-claim"),
      target,
      taskId
    )
    const claimTransition = RunnableFrontierTransition.ObserveResponsibleTaskClaim({
      operation: responsibleClaimOperation,
      taskId
    })
    expect(proposalsFor(claimTransition)).toMatchObject({
      issues: [],
      proposals: [
        {
          actionIdentity: { _tag: "FreshOperationIdRequired" },
          route: { _tag: "RecoveredNewActionRoute", action: { _tag: "ReadTaskClaim", plannedAttempt: null } }
        }
      ]
    })
    expect(proposalsFor(claimTransition, new Set([responsibleClaimOperation.operationId]))).toMatchObject({
      issues: [],
      proposals: [{ actionIdentity: { _tag: "ExistingOperationId" } }]
    })
  })

  it("keeps new recovery actions identity-free until admission", () => {
    const release = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [activeClaim.operationId],
      release: { claim: activeClaim, operationId: OperationId.make("release-placeholder") }
    })
    const transitions = [
      RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
        plannedAttempt,
        requestId: TaskClaimReacquisitionRequestId.make("reacquire-A"),
        taskId
      }),
      RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation: release, plannedAttempt })
    ]

    for (const transition of transitions) {
      const result = proposalsFor(transition)
      expect(result).toMatchObject({
        issues: [],
        proposals: [
          {
            actionIdentity: { _tag: "FreshOperationIdRequired" },
            order: { _tag: "RecoveredWorkflowOrder", responsibilityBeganAt },
            owner: "TicketDelivery",
            route: { _tag: "RecoveredNewActionRoute", action: { plannedAttempt } }
          }
        ]
      })
      expect(JSON.stringify(result)).not.toContain("release-placeholder")
    }
  })

  it("keeps exact attempt provenance in recovered proposal identity", () => {
    const otherAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("route-matrix-other-attempt")
    })
    const requestId = TaskClaimReacquisitionRequestId.make("same-reacquisition-request")
    const proposalForAttempt = (attempt: PlannedTaskAttempt) =>
      proposalsFor(
        RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({ plannedAttempt: attempt, requestId, taskId })
      ).proposals[0]

    const first = proposalForAttempt(plannedAttempt)
    const second = proposalForAttempt(otherAttempt)

    expect(first).toMatchObject({ route: { action: { plannedAttempt } } })
    expect(second).toMatchObject({ route: { action: { plannedAttempt: otherAttempt } } })
    expect(first?.id).not.toBe(second?.id)
  })

  it("assigns every identity-free executor and integration route to its exact owner and resource", () => {
    const lineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: plannedAttempt.baseSha,
      targetHeadSha: GitCommitSha.make("3".repeat(40))
    })
    const cases = [
      {
        access: "NoIntegrationTargetResource",
        owner: "TicketDelivery",
        position: "ReserveOrReuse",
        transition: RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
          acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
          plannedAttempt
        })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "TicketDelivery",
        position: "Existing",
        transition: RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.QueueAcceptedResultIntegrationResponsibility({
          accepted: unqueued,
          integrationTarget
        })
      },
      {
        access: "Acquire",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.StartQueuedIntegration({ responsibility: queued })
      },
      {
        access: "Acquire",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: started })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.RecordInitialConclusiveIntegrationQuarantine({
          responsibility: started,
          result: IntegratorRunProtocolResult.cases.NotPrepared.make({
            detail: IntegratorNotPreparedDetail.make("route matrix conclusive result"),
            run: integratorInitialRunCorrelationFor({
              responsibility: started,
              targetLineage: lineage,
              targetLineageObservedAt: JournalPosition.make(91)
            })
          })
        })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.RecordProviderRunFailureIntegrationQuarantine({
          input: {
            detail: IntegrationQuarantineFailureDetail.make("route matrix provider absence"),
            run: integratorInitialRunCorrelationFor({
              responsibility: started,
              targetLineage: lineage,
              targetLineageObservedAt: JournalPosition.make(91)
            })
          },
          responsibility: started
        })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.RecordRetryConclusiveIntegrationQuarantine({
          responsibility: started,
          result: IntegratorRunProtocolResult.cases.NotPrepared.make({
            detail: IntegratorNotPreparedDetail.make("route matrix retry result"),
            run: IntegratorRunCorrelation.make({
              ordinal: IntegratorRunOrdinal.make(2),
              session: integratorInitialRunCorrelationFor({
                responsibility: started,
                targetLineage: lineage,
                targetLineageObservedAt: JournalPosition.make(91)
              }).session
            })
          })
        })
      },
      {
        access: "UseHeld",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.FixIntegratorSuccessorSession({
          input: {
            directionAppliedAt: JournalPosition.make(94),
            predecessor: integratorInitialRunCorrelationFor({
              responsibility: started,
              targetLineage: lineage,
              targetLineageObservedAt: JournalPosition.make(91)
            }).session,
            quarantineAt: JournalPosition.make(93),
            targetLineage: lineage,
            targetLineageObservedAt: JournalPosition.make(96)
          },
          responsibility: started
        })
      },
      {
        access: "Release",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility: started })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.ReplacePromotedTaskClaim({
          request: completionClaimReplacementRequestFor(integrationFinalityFixture.claim),
          responsibility: started
        })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.CompletePromotedTask({
          request: completionTaskRequestFor(integrationFinalityFixture.claim),
          responsibility: started
        })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.ObserveFocusedTaskCompletion({
          request: completionTaskRequestFor(integrationFinalityFixture.claim),
          responsibility: started
        })
      },
      {
        access: "NoIntegrationTargetResource",
        owner: "DeliverySettlement",
        position: null,
        transition: RunnableFrontierTransition.DeleteCompletedTaskCompletionClaim({
          replacementOperationId: completionClaimReplacementOperationIdFor(integrationFinalityFixture.claim),
          request: completionClaimDeletionRequestFor(
            integrationFinalityFixture.claim,
            integrationFinalityFixture.successObservation
          ),
          responsibility: started
        })
      }
    ] as const

    for (const routeCase of cases) {
      const proposals = proposalsFor(routeCase.transition).proposals
      expect(proposals).toHaveLength(1)
      const proposal = proposals[0]
      if (proposal === undefined) continue
      const { admission, owner, route } = proposal
      expect(owner).toBe(routeCase.owner)
      expect(route).toMatchObject({ _tag: "IdentityFreeWorkflowRoute", transition: routeCase.transition })
      expect(admission.integrationTarget._tag).toBe(
        routeCase.access === "NoIntegrationTargetResource"
          ? "NoIntegrationTargetResource"
          : "IntegrationTargetResourceRequired"
      )
      if (admission.integrationTarget._tag === "IntegrationTargetResourceRequired") {
        expect(admission.integrationTarget.access).toBe(routeCase.access)
        expect(admission.integrationTarget.integrationTarget).toEqual(integrationTarget)
      }
      expect(admission.taskWorkPosition).toMatchObject(
        routeCase.position === null
          ? { _tag: "NoTaskWorkPosition" }
          : { _tag: "TaskWorkPositionRequired", mode: routeCase.position, taskId }
      )
    }
  })

  it("requires fresh provenance for all three fresh-only transition tags", () => {
    const beginTransition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
    const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
      claimOperationId: OperationId.make("fresh-begin-claim"),
      plannedAttempt,
      specification,
      task
    })
    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: Result.getOrThrow(
        freshContinuationDecisionsOf(
          [{ step, transition: beginTransition }],
          [makeFreshTaskCommitmentForTest(taskId, step.claimOperationId, runId)]
        )
      ),
      runId,
      transitions: [beginTransition]
    }).ticketDelivery
    expect(proposal).toMatchObject({
      actionIdentity: { _tag: "NoWorkflowOperationIdentity" },
      admission: { taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId } },
      route: { _tag: "FreshExecutorWorkflowRoute", step }
    })

    for (const transition of [
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId, taskRevision: plannedAttempt.taskRevision }),
      RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: OperationId.make("fresh-predecessor"),
        taskId
      }),
      beginTransition
    ]) {
      expect(proposalsFor(transition)).toMatchObject({
        issues: [{ _tag: "FreshRouteProvenanceMissing", taskId, transition: transition._tag }],
        proposals: []
      })
    }
  })

  effectIt.effect("executes the identity-free acquire route and names missing Integrator boundaries", () =>
    Effect.gen(function* () {
      const candidateHarness = yield* makeLiveJournalHarness(acceptedIntegrationHistory.records)
      const acquire = RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: started })
      const acquireProposal = proposalsFor(acquire).proposals[0]
      if (acquireProposal === undefined || !isIdentityFreeProposal(acquireProposal)) {
        return yield* Effect.die("missing identity-free acquire proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: acquireProposal },
          acquire,
          inertLease,
          target
        ).pipe((effect) => provideLiveJournal(effect, candidateHarness))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: acquireProposal.id })

      const release = RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility: started })
      const releaseProposal = proposalsFor(release).proposals[0]
      if (releaseProposal === undefined || !isIdentityFreeProposal(releaseProposal)) {
        return yield* Effect.die("missing identity-free release proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: releaseProposal },
          release,
          inertLease,
          target
        ).pipe((effect) => provideLiveJournal(effect, candidateHarness))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: releaseProposal.id })

      const lineage = acceptedIntegrationHistory.targetLineage
      const preparation = {
        lineage,
        lineageObservedAt: acceptedIntegrationHistory.targetLineageObservedAt,
        responsibility: started
      }
      const runIntegrator = RunnableFrontierTransition.RunIntegrator({
        ...preparation,
        run: integratorInitialRunCorrelationFor({
          responsibility: preparation.responsibility,
          targetLineage: preparation.lineage,
          targetLineageObservedAt: preparation.lineageObservedAt
        })
      })
      const integratorProposal = proposalsFor(runIntegrator).proposals[0]
      if (integratorProposal === undefined || !isIdentityFreeProposal(integratorProposal)) {
        return yield* Effect.die("missing identity-free Integrator proposal")
      }
      const integratorAction = { _tag: "IdentityFreeAction" as const, proposal: integratorProposal }
      expect(
        yield* executeIntegrationAction(integratorAction, runIntegrator, inertLease, target).pipe(
          (effect) => provideLiveJournal(effect, candidateHarness),
          Effect.flip
        )
      ).toEqual(new IntegratorBoundaryUnavailable({ boundary: "Integrator" }))
      expect(
        yield* executeIntegrationAction(integratorAction, runIntegrator, inertLease, target).pipe(
          Effect.provideService(
            Integrator,
            Integrator.of({ prepare: () => Effect.die("Integrator must not run without its Git boundary") })
          ),
          (effect) => provideLiveJournal(effect, candidateHarness),
          Effect.flip
        )
      ).toEqual(new IntegratorBoundaryUnavailable({ boundary: "Git" }))

      const integratorHarness = yield* makeLiveJournalHarness(acceptedIntegrationHistory.records)
      const unreadableHarness = yield* makeLiveJournalHarness(acceptedIntegrationHistory.records)
      const candidateText = IntegratorCandidateText.make("refs/heads/unreadable-integrator-candidate")
      const deferred = yield* executeIntegrationAction(integratorAction, runIntegrator, inertLease, target).pipe(
        Effect.provideService(
          Integrator,
          Integrator.of({
            prepare: (request) =>
              Effect.succeed(
                IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: request.correlation })
              )
          })
        ),
        Effect.provideService(
          IntegratorGit,
          IntegratorGit.of({
            readCandidate: (integrationTarget) =>
              Effect.fail(
                new IntegratorGitReadFailure({
                  candidateText,
                  detail: "controlled unreadable Git qualification",
                  target: integrationTarget
                })
              )
          })
        ),
        (effect) => provideLiveJournal(effect, unreadableHarness)
      )
      expect(deferred).toMatchObject({
        _tag: "ActionDeferred",
        proposalId: integratorProposal.id,
        reason: { _tag: "IntegratorGitReadFailure", candidateText }
      })

      const providerFailureHarness = yield* makeLiveJournalHarness(acceptedIntegrationHistory.records)
      const ordinaryFailure = yield* executeIntegrationAction(integratorAction, runIntegrator, inertLease, target).pipe(
        Effect.provideService(
          Integrator,
          Integrator.of({
            prepare: (request) =>
              Effect.fail(
                new IntegratorCallFailure({
                  correlation: request.correlation,
                  detail: "controlled ambiguous provider failure"
                })
              )
          })
        ),
        Effect.provideService(IntegratorGit, IntegratorGit.of({ readCandidate: () => Effect.die("unused") })),
        (effect) => provideLiveJournal(effect, providerFailureHarness),
        Effect.flip
      )
      expect(ordinaryFailure).toMatchObject({ _tag: "IntegratorCallFailure" })
      expect(
        (yield* providerFailureHarness.records).filter(
          ({ event }) =>
            event._tag === "IntegrationProviderRunActivityAbsent" || event._tag === "IntegrationQuarantined"
        )
      ).toHaveLength(0)

      const providerAbsent = yield* executeIntegrationAction(integratorAction, runIntegrator, inertLease, target).pipe(
        Effect.provideService(
          Integrator,
          Integrator.of({
            prepare: (request) =>
              Effect.fail(
                new IntegratorProviderActivityAbsent({
                  correlation: request.correlation,
                  detail: "controlled provider confirms no owned activity"
                })
              )
          })
        ),
        Effect.provideService(IntegratorGit, IntegratorGit.of({ readCandidate: () => Effect.die("unused") })),
        (effect) => provideLiveJournal(effect, providerFailureHarness)
      )
      expect(providerAbsent).toMatchObject({ _tag: "ActionCompleted", proposalId: integratorProposal.id })
      expect((yield* providerFailureHarness.records).map(({ event }) => event._tag).slice(-2)).toEqual([
        "IntegrationProviderRunActivityAbsent",
        "IntegrationQuarantined"
      ])

      const providerRecovery = RunnableFrontierTransition.RecordProviderRunFailureIntegrationQuarantine({
        input: {
          detail: IntegrationQuarantineFailureDetail.make("controlled provider confirms no owned activity"),
          run: runIntegrator.run
        },
        responsibility: started
      })
      const providerRecoveryProposal = proposalsFor(providerRecovery).proposals[0]
      if (providerRecoveryProposal === undefined || !isIdentityFreeProposal(providerRecoveryProposal)) {
        return yield* Effect.die("missing provider-failure recovery proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: providerRecoveryProposal },
          providerRecovery,
          inertLease,
          target
        ).pipe((effect) => provideLiveJournal(effect, providerFailureHarness))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: providerRecoveryProposal.id })

      const completed = yield* executeIntegrationAction(integratorAction, runIntegrator, inertLease, target).pipe(
        Effect.provideService(
          Integrator,
          Integrator.of({
            prepare: (request) =>
              Effect.succeed(
                IntegratorResult.cases.NotPrepared.make({
                  correlation: request.correlation,
                  detail: IntegratorNotPreparedDetail.make("controlled route result")
                })
              )
          })
        ),
        Effect.provideService(IntegratorGit, IntegratorGit.of({ readCandidate: () => Effect.die("unused") })),
        (effect) => provideLiveJournal(effect, integratorHarness)
      )
      expect(completed).toMatchObject({ _tag: "ActionCompleted", proposalId: integratorProposal.id })
      expect((yield* integratorHarness.records).map(({ event }) => event._tag).slice(-2)).toEqual([
        "IntegratorRunResultRecorded",
        "IntegrationQuarantined"
      ])

      const recoveryHarness = yield* makeLiveJournalHarness(
        (yield* integratorHarness.records).filter(({ event }) => event._tag !== "IntegrationQuarantined")
      )
      const recoveryJournal = recoveryHarness.journal
      const recovery = RunnableFrontierTransition.RecordInitialConclusiveIntegrationQuarantine({
        responsibility: started,
        result: IntegratorRunProtocolResult.cases.NotPrepared.make({
          detail: IntegratorNotPreparedDetail.make("controlled route result"),
          run: runIntegrator.run
        })
      })
      const recoveryProposal = proposalsFor(recovery).proposals[0]
      if (recoveryProposal === undefined || !isIdentityFreeProposal(recoveryProposal)) {
        return yield* Effect.die("missing initial quarantine recovery proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: recoveryProposal },
          recovery,
          inertLease,
          target
        ).pipe((effect) => provideLiveJournal(effect, recoveryHarness))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: recoveryProposal.id })
      expect(
        (yield* recoveryHarness.records).filter(({ event }) => event._tag === "IntegrationQuarantined")
      ).toHaveLength(1)

      const initialQuarantine = (yield* recoveryHarness.records).find(
        ({ event }) => event._tag === "IntegrationQuarantined"
      )
      if (initialQuarantine?.event._tag !== "IntegrationQuarantined") {
        return yield* Effect.die("Retry delivery fixture requires Q1")
      }
      const retryFingerprint = IntegrationQuarantineDirectionFingerprint.make({
        direction: "Retry",
        quarantineAt: initialQuarantine.position,
        sessionId: runIntegrator.run.session.sessionId
      })
      const retryDirection = yield* recoveryJournal.append(
        runId,
        integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(retryFingerprint)),
        IntegrationQuarantineDirectionAppliedEvent.make({
          fingerprint: retryFingerprint,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "route-matrix-retry", runId }),
          version: workflowJournalEventVersion
        })
      )
      const retryLineageOperationId = OperationId.make("route-matrix-retry-lineage")
      const retryLineageOperation = makeTargetLineageObservationOperation({
        integrationTarget: started.integrationTarget,
        operationId: retryLineageOperationId,
        plannedAttempt: started.plannedAttempt,
        predecessorOperationIds: []
      })
      yield* recoveryJournal.append(
        runId,
        intentRecordKey(retryLineageOperationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: retryLineageOperation,
          version: workflowJournalEventVersion
        })
      )
      const retryLineageRecord = yield* recoveryJournal.append(
        runId,
        outcomeRecordKey(retryLineageOperationId),
        TargetLineageObservedEvent.make({
          observation: lineage,
          occurrenceClassification: "NonActionOccurrence",
          operationId: retryLineageOperationId,
          plannedAttempt: started.plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      expect(retryDirection.position).toBeLessThan(retryLineageRecord.position)

      const retryRun = IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(2),
        session: runIntegrator.run.session
      })
      const retryTransition = RunnableFrontierTransition.RunIntegrator({
        lineage,
        lineageObservedAt: retryLineageRecord.position,
        responsibility: started,
        run: retryRun
      })
      const retryProposal = proposalsFor(retryTransition).proposals[0]
      if (retryProposal === undefined || !isIdentityFreeProposal(retryProposal)) {
        return yield* Effect.die("missing Retry Integrator delivery proposal")
      }
      const deliveredSessions = yield* Ref.make<ReadonlyArray<string>>([])
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: retryProposal },
          retryTransition,
          inertLease,
          target
        ).pipe(
          Effect.provideService(
            Integrator,
            Integrator.of({
              prepare: (request) =>
                Ref.update(deliveredSessions, (sessions) => [...sessions, request.correlation.session.sessionId]).pipe(
                  Effect.as(
                    IntegratorResult.cases.NotPrepared.make({
                      correlation: request.correlation,
                      detail: IntegratorNotPreparedDetail.make("controlled Retry route result")
                    })
                  )
                )
            })
          ),
          Effect.provideService(IntegratorGit, IntegratorGit.of({ readCandidate: () => Effect.die("unused") })),
          (effect) => provideLiveJournal(effect, recoveryHarness)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: retryProposal.id })
      expect(
        (yield* recoveryHarness.records).filter(
          ({ event }) => event._tag === "IntegratorRunStarted" && event.run.ordinal === IntegratorRunOrdinal.make(2)
        )
      ).toHaveLength(1)

      const retryRecovery = RunnableFrontierTransition.RecordRetryConclusiveIntegrationQuarantine({
        responsibility: started,
        result: IntegratorRunProtocolResult.cases.NotPrepared.make({
          detail: IntegratorNotPreparedDetail.make("controlled Retry route result"),
          run: retryRun
        })
      })
      const retryRecoveryProposal = proposalsFor(retryRecovery).proposals[0]
      if (retryRecoveryProposal === undefined || !isIdentityFreeProposal(retryRecoveryProposal)) {
        return yield* Effect.die("missing retry-quarantine recovery proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: retryRecoveryProposal },
          retryRecovery,
          inertLease,
          target
        ).pipe((effect) => provideLiveJournal(effect, recoveryHarness))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: retryRecoveryProposal.id })

      const retryQuarantine = (yield* recoveryHarness.records)
        .filter(({ event }) => event._tag === "IntegrationQuarantined")
        .at(-1)
      if (retryQuarantine?.event._tag !== "IntegrationQuarantined") {
        return yield* Effect.die("FullRerun delivery fixture requires Q2")
      }
      const fullRerunFingerprint = IntegrationQuarantineDirectionFingerprint.make({
        direction: "FullRerun",
        quarantineAt: retryQuarantine.position,
        sessionId: runIntegrator.run.session.sessionId
      })
      const fullRerunDirection = yield* recoveryJournal.append(
        runId,
        integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(fullRerunFingerprint)),
        IntegrationQuarantineDirectionAppliedEvent.make({
          fingerprint: fullRerunFingerprint,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "route-matrix-full-rerun", runId }),
          version: workflowJournalEventVersion
        })
      )
      const successorLineage = TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: GitCommitSha.make("5".repeat(40))
      })
      const successorLineageOperationId = OperationId.make("route-matrix-successor-lineage")
      const successorLineageOperation = makeTargetLineageObservationOperation({
        integrationTarget: started.integrationTarget,
        operationId: successorLineageOperationId,
        plannedAttempt: started.plannedAttempt,
        predecessorOperationIds: []
      })
      yield* recoveryJournal.append(
        runId,
        intentRecordKey(successorLineageOperationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: successorLineageOperation,
          version: workflowJournalEventVersion
        })
      )
      const successorLineageRecord = yield* recoveryJournal.append(
        runId,
        outcomeRecordKey(successorLineageOperationId),
        TargetLineageObservedEvent.make({
          observation: successorLineage,
          occurrenceClassification: "NonActionOccurrence",
          operationId: successorLineageOperationId,
          plannedAttempt: started.plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const successorInput = {
        directionAppliedAt: fullRerunDirection.position,
        predecessor: runIntegrator.run.session,
        quarantineAt: retryQuarantine.position,
        targetLineage: successorLineage,
        targetLineageObservedAt: successorLineageRecord.position
      }
      const fixSuccessor = RunnableFrontierTransition.FixIntegratorSuccessorSession({
        input: successorInput,
        responsibility: started
      })
      const fixSuccessorProposal = proposalsFor(fixSuccessor).proposals[0]
      if (fixSuccessorProposal === undefined || !isIdentityFreeProposal(fixSuccessorProposal)) {
        return yield* Effect.die("missing FullRerun successor delivery proposal")
      }
      yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal: fixSuccessorProposal },
        fixSuccessor,
        inertLease,
        target
      ).pipe((effect) => provideLiveJournal(effect, recoveryHarness))

      const successor = integratorSuccessorCorrelationFor(successorInput)
      const successorRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: successor })
      const successorTransition = RunnableFrontierTransition.RunIntegrator({
        lineage: successorLineage,
        lineageObservedAt: successorLineageRecord.position,
        responsibility: started,
        run: successorRun
      })
      const successorProposal = proposalsFor(successorTransition).proposals[0]
      if (successorProposal === undefined || !isIdentityFreeProposal(successorProposal)) {
        return yield* Effect.die("missing S2 Integrator delivery proposal")
      }
      yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal: successorProposal },
        successorTransition,
        inertLease,
        target
      ).pipe(
        Effect.provideService(
          Integrator,
          Integrator.of({
            prepare: (request) =>
              Ref.update(deliveredSessions, (sessions) => [...sessions, request.correlation.session.sessionId]).pipe(
                Effect.as(
                  IntegratorResult.cases.NotPrepared.make({
                    correlation: request.correlation,
                    detail: IntegratorNotPreparedDetail.make("controlled S2 route result")
                  })
                )
              )
          })
        ),
        Effect.provideService(IntegratorGit, IntegratorGit.of({ readCandidate: () => Effect.die("unused") })),
        (effect) => provideLiveJournal(effect, recoveryHarness)
      )
      expect(yield* Ref.get(deliveredSessions)).toEqual([runIntegrator.run.session.sessionId, successor.sessionId])
    })
  )

  effectIt.effect("defers missing or contradictory acceptance evidence and rejects incomplete promotion runtime", () =>
    Effect.gen(function* () {
      const queue = RunnableFrontierTransition.QueueAcceptedResultIntegrationResponsibility({
        accepted: unqueued,
        integrationTarget
      })
      const queueProposal = proposalsFor(queue).proposals[0]
      if (queueProposal === undefined || !isIdentityFreeProposal(queueProposal)) {
        return yield* Effect.die("missing acceptance-evidence proposal")
      }
      const queueAction = { _tag: "IdentityFreeAction" as const, proposal: queueProposal }
      const queuedIndex = acceptedIntegrationHistory.records.findIndex(
        ({ event }) => event._tag === "IntegrationResponsibilityBegan"
      )
      if (queuedIndex < 0) return yield* Effect.die("accepted integration history lacks its queue event")
      const acceptedHarness = yield* makeLiveJournalHarness(acceptedIntegrationHistory.records.slice(0, queuedIndex))

      expect(
        yield* executeIntegrationAction(queueAction, queue, inertLease, target).pipe((effect) =>
          provideLiveJournal(effect, acceptedHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: { _tag: "AcceptedResultEvidenceUnavailable" } })

      const unavailableEvidence = EvidenceStore.of({
        put: () => Effect.die("acceptance evidence tests never publish evidence"),
        read: () =>
          Effect.fail(
            new EvidenceStoreFailure({ detail: "controlled evidence read failure", operation: "EvidenceStore.read" })
          )
      })
      expect(
        yield* executeIntegrationAction(queueAction, queue, inertLease, target).pipe(
          Effect.provideService(EvidenceStore, unavailableEvidence),
          (effect) => provideLiveJournal(effect, acceptedHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: { _tag: "AcceptedResultEvidenceUnavailable" } })

      const conflictingEvidence = EvidenceStore.of({
        put: () => Effect.die("acceptance evidence tests never publish evidence"),
        read: () => Effect.succeed(new TextEncoder().encode("{}"))
      })
      expect(
        yield* executeIntegrationAction(queueAction, queue, inertLease, target).pipe(
          Effect.provideService(EvidenceStore, conflictingEvidence),
          (effect) => provideLiveJournal(effect, acceptedHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: { _tag: "AcceptedResultEvidenceConflict" } })

      const promotion = RunnableFrontierTransition.RunTargetPromotion({
        candidate: integrationFinalityFixture.qualifiedCandidate,
        responsibility: started
      })
      const promotionProposal = proposalsFor(promotion).proposals[0]
      if (promotionProposal === undefined || !isIdentityFreeProposal(promotionProposal)) {
        return yield* Effect.die("missing target-promotion proposal")
      }
      const promotionAction = { _tag: "IdentityFreeAction" as const, proposal: promotionProposal }
      const promotionHarness = yield* makeLiveJournalHarness(acceptedIntegrationHistory.records)
      expect(
        yield* executeIntegrationAction(promotionAction, promotion, inertLease, target).pipe(
          (effect) => provideLiveJournal(effect, promotionHarness),
          Effect.flip
        )
      ).toBeInstanceOf(TargetPromotionRuntimeUnavailable)
      expect(
        yield* executeIntegrationAction(promotionAction, promotion, inertLease, target).pipe(
          Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
          (effect) => provideLiveJournal(effect, promotionHarness),
          Effect.flip
        )
      ).toBeInstanceOf(TargetPromotionRuntimeUnavailable)

      const reconciliation = RunnableFrontierTransition.ReconcileTargetPromotionAttempt({
        candidate: integrationFinalityFixture.qualifiedCandidate,
        responsibility: started
      })
      const reconciliationProposal = proposalsFor(reconciliation).proposals[0]
      if (reconciliationProposal === undefined || !isIdentityFreeProposal(reconciliationProposal)) {
        return yield* Effect.die("missing target-promotion reconciliation proposal")
      }
      const reconciliationAction = { _tag: "IdentityFreeAction" as const, proposal: reconciliationProposal }
      expect(
        yield* executeIntegrationAction(reconciliationAction, reconciliation, inertLease, target).pipe(
          (effect) => provideLiveJournal(effect, promotionHarness),
          Effect.flip
        )
      ).toBeInstanceOf(TargetPromotionRuntimeUnavailable)
      expect(
        yield* executeIntegrationAction(reconciliationAction, reconciliation, inertLease, target).pipe(
          Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
          (effect) => provideLiveJournal(effect, promotionHarness),
          Effect.flip
        )
      ).toBeInstanceOf(TargetPromotionRuntimeUnavailable)
    })
  )

  const executeCompletionFixture = Effect.fn("DeliveryProposalRoutesTest.executeCompletionFixture")(function* (
    boundary: CompletionTaskBoundary["Service"]
  ) {
    const request = completionTaskRequestFor(integrationFinalityFixture.claim)
    const transition = RunnableFrontierTransition.CompletePromotedTask({
      request,
      responsibility: acceptedFinalityHistory.responsibility
    })
    const proposal = proposalsFor(transition).proposals[0]
    if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
      return yield* Effect.die("missing completion fixture proposal")
    }
    const harness = yield* makeLiveJournalHarness(
      promotedFinalityHistory.replacedRecords,
      integrationFinalityFixture.runId,
      integrationFinalityFixture.target
    )
    const result = yield* executeIntegrationAction(
      { _tag: "IdentityFreeAction", proposal },
      transition,
      inertLease,
      integrationFinalityFixture.target
    ).pipe(
      Effect.provideService(CompletionTaskBoundary, boundary),
      Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
      Effect.provideService(EvidenceStore, completionEvidenceStore),
      (effect) => provideLiveJournal(effect, harness)
    )
    return { harness, proposal, request, result }
  })

  effectIt.effect("defers ancestry rereads without promotion runtime and completes them through configured Git", () =>
    Effect.gen(function* () {
      const harness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.promotedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      const blocker = TaskId.make("route-matrix-post-promotion-blocker")
      const appendGraph = (name: string, blockerLifecycle: TaskLifecycle) =>
        Effect.gen(function* () {
          const operation = makeTrackerGraphObservationOperation(
            { _tag: "WorkflowEstablishment" },
            OperationId.make(name),
            integrationFinalityFixture.target,
            [],
            [blocker, integrationFinalityFixture.taskId]
          )
          const projected = projectTrackerSnapshot({
            revision: TrackerRevision.make(`${name}-revision`),
            tasks: [
              { id: blocker, lifecycle: blockerLifecycle, parentTaskId: null, prerequisiteIds: [] },
              {
                id: integrationFinalityFixture.taskId,
                lifecycle: TaskLifecycle.cases.Open.make({}),
                parentTaskId: null,
                prerequisiteIds: [blocker]
              }
            ]
          })
          if (projected._tag === "Invalid") return yield* Effect.die("post-promotion graph must project")
          yield* harness.journal.append(
            integrationFinalityFixture.runId,
            intentRecordKey(operation.operationId),
            taskTrackerReadIntent(operation)
          )
          yield* harness.journal.append(
            integrationFinalityFixture.runId,
            outcomeRecordKey(operation.operationId),
            taskTrackerFactsObservedEvent(
              operation.operationId,
              makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
            )
          )
        })
      yield* appendGraph("route-matrix-post-promotion-blocked", TaskLifecycle.cases.Open.make({}))
      yield* appendGraph("route-matrix-post-promotion-cleared", TaskLifecycle.cases.CompletedSuccessfully.make({}))
      const authorization = postPromotionBlockerClearAuthorizationFor(
        yield* harness.records,
        integrationFinalityFixture.claim
      )
      if (authorization === undefined) return yield* Effect.die("post-promotion blocker clear was not authorized")
      const transition = RunnableFrontierTransition.ObservePromotedCandidateAncestryAfterBlockerClear({
        authorization,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing post-promotion ancestry proposal")
      }
      const action = { _tag: "IdentityFreeAction" as const, proposal }
      expect(
        yield* executeIntegrationAction(action, transition, inertLease, target).pipe((effect) =>
          provideLiveJournal(effect, harness)
        )
      ).toEqual({ _tag: "ActionDeferred", proposalId: proposal.id, reason: "CompletionTaskUnavailable" })

      expect(
        yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
          Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
          (effect) => provideLiveJournal(effect, harness)
        )
      ).toEqual({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(
        (yield* harness.records).some(({ event }) => event._tag === "PostPromotionBlockerCandidateAncestryObserved")
      ).toBe(true)
    })
  )

  effectIt.effect("executes completion-claim replacement and deletion through the configured boundary", () =>
    Effect.gen(function* () {
      const harness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.promotedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      const journal = harness.journal
      let activeClaim: typeof integrationFinalityFixture.activeClaim | undefined =
        integrationFinalityFixture.activeClaim
      let completionMarker: typeof integrationFinalityFixture.claim | undefined
      const boundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () =>
          Effect.sync(() => {
            completionMarker = undefined
          }),
        readCompletionClaimMarker: () =>
          Effect.succeed(
            completionMarker ?? CompletionClaimMarkerAbsent.make({ taskId: integrationFinalityFixture.taskId })
          ),
        readOriginalTaskClaim: () =>
          Effect.succeed(activeClaim ?? UnclaimedTask.make({ taskId: integrationFinalityFixture.taskId })),
        readTaskClaim: () =>
          Effect.succeed(
            completionMarker ?? activeClaim ?? UnclaimedTask.make({ taskId: integrationFinalityFixture.taskId })
          ),
        releaseOriginalTaskClaim: () =>
          Effect.sync(() => {
            activeClaim = undefined
          }),
        replaceTaskClaim: (request) =>
          Effect.sync(() => {
            completionMarker = request.claim
            return request.claim
          })
      })
      const replacement = RunnableFrontierTransition.ReplacePromotedTaskClaim({
        request: completionClaimReplacementRequestFor(integrationFinalityFixture.claim),
        responsibility: acceptedFinalityHistory.responsibility
      })
      const replacementProposal = proposalsFor(replacement).proposals[0]
      if (replacementProposal === undefined || !isIdentityFreeProposal(replacementProposal)) {
        return yield* Effect.die("missing completion-claim replacement proposal")
      }
      const replacementAction = { _tag: "IdentityFreeAction" as const, proposal: replacementProposal }
      expect(
        yield* executeIntegrationAction(
          replacementAction,
          replacement,
          inertLease,
          integrationFinalityFixture.target
        ).pipe((effect) => provideLiveJournal(effect, harness), Effect.flip)
      ).toEqual(new IntegrationFinalityRuntimeUnavailable())
      expect(
        yield* executeIntegrationAction(
          replacementAction,
          replacement,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionClaimBoundary, boundary), (effect) =>
          provideLiveJournal(effect, harness)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: replacementProposal.id })

      const completionIntent = CompletionTaskIntendedEvent.make({
        request: integrationFinalityFixture.completionRequest,
        version: workflowJournalEventVersion
      })
      yield* journal.append(
        integrationFinalityFixture.runId,
        describeJournalEvent(completionIntent).expectedKey,
        completionIntent
      )
      const focusedFacts = integrationFinalityFixture.focusedSuccessFactsEvent
      const focusedReadOperation = makeCompletionTaskFactsObservationOperation(
        focusedFacts.observation.request,
        focusedFacts.observation.target,
        focusedFacts.observation.purpose
      )
      const focusedReadIntent = taskTrackerReadIntent(focusedReadOperation)
      yield* journal.append(
        integrationFinalityFixture.runId,
        describeJournalEvent(focusedReadIntent).expectedKey,
        focusedReadIntent
      )
      const focusedFactsRecord = yield* journal.append(
        integrationFinalityFixture.runId,
        describeJournalEvent(focusedFacts).expectedKey,
        focusedFacts
      )
      const successObservation = {
        ...integrationFinalityFixture.successObservation,
        observedAt: focusedFactsRecord.position
      }
      const deletion = RunnableFrontierTransition.DeleteCompletedTaskCompletionClaim({
        replacementOperationId: completionClaimReplacementOperationIdFor(integrationFinalityFixture.claim),
        request: completionClaimDeletionRequestFor(integrationFinalityFixture.claim, successObservation),
        responsibility: acceptedFinalityHistory.responsibility
      })
      const deletionProposal = proposalsFor(deletion).proposals[0]
      if (deletionProposal === undefined || !isIdentityFreeProposal(deletionProposal)) {
        return yield* Effect.die("missing completion-claim deletion proposal")
      }
      const interruptibleBoundaryEntries = yield* Ref.make(0)
      const deletionLease: DeliveryActionExecutionLease = {
        ...inertLease,
        forwardBoundary: {
          _tag: "InterruptibleBoundary",
          execution: {
            run: (_intent, call, recordResult) =>
              Ref.update(interruptibleBoundaryEntries, (count) => count + 1).pipe(
                Effect.andThen(call),
                Effect.flatMap(recordResult)
              )
          }
        }
      }
      expect(deletionLease.forwardBoundary._tag).toBe("InterruptibleBoundary")
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: deletionProposal },
          deletion,
          deletionLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionClaimBoundary, boundary), (effect) =>
          provideLiveJournal(effect, harness)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: deletionProposal.id })
      expect(yield* Ref.get(interruptibleBoundaryEntries)).toBeGreaterThan(0)
      expect((yield* harness.records).at(-1)?.event._tag).toBe("IntegrationFinalitySettled")

      const waitingHarness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.promotedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      const foreignBoundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.die("foreign wait must not delete"),
        readCompletionClaimMarker: () => Effect.die("foreign replacement must not enter cleanup"),
        readOriginalTaskClaim: () => Effect.die("foreign replacement must not enter cleanup"),
        readTaskClaim: () =>
          Effect.succeed({
            ...integrationFinalityFixture.activeClaim,
            operationId: OperationId.make("foreign-finality-action-claim")
          }),
        releaseOriginalTaskClaim: () => Effect.die("foreign replacement must not enter cleanup"),
        replaceTaskClaim: () => Effect.die("foreign wait must not replace")
      })
      expect(
        yield* executeIntegrationAction(
          replacementAction,
          replacement,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionClaimBoundary, foreignBoundary), (effect) =>
          provideLiveJournal(effect, waitingHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimConflict" })

      const unreadableBoundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.die("unreadable claim must not be deleted"),
        readCompletionClaimMarker: (request) =>
          Effect.fail(
            new CompletionClaimReadFailure({ detail: "tracker claim is unreadable", taskId: request.taskId })
          ),
        readOriginalTaskClaim: () => Effect.die("unreadable claim must not enter cleanup"),
        readTaskClaim: (request) =>
          Effect.fail(
            new CompletionClaimReadFailure({ detail: "tracker claim is unreadable", taskId: request.taskId })
          ),
        releaseOriginalTaskClaim: () => Effect.die("unreadable claim must not enter cleanup"),
        replaceTaskClaim: () => Effect.die("unreadable claim must not be replaced")
      })
      expect(
        yield* executeIntegrationAction(
          replacementAction,
          replacement,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionClaimBoundary, unreadableBoundary), (effect) =>
          provideLiveJournal(effect, waitingHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimReadUnavailable" })

      const deletionWaitingHarness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.replacedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: deletionProposal },
          deletion,
          deletionLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionClaimBoundary, unreadableBoundary), (effect) =>
          provideLiveJournal(effect, deletionWaitingHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "FocusedTaskCompletionSuccessRequired" })

      const deletionIntentIndex = (yield* harness.records).findIndex(
        ({ event }) => event._tag === "CompletionClaimDeletionIntended"
      )
      if (deletionIntentIndex < 0) return yield* Effect.die("completion deletion lacks its intent")
      const readableSuccessPrefix = (yield* harness.records).slice(0, deletionIntentIndex)
      const readableSuccessHarness = yield* makeLiveJournalHarness(
        readableSuccessPrefix,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: deletionProposal },
          deletion,
          deletionLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionClaimBoundary, unreadableBoundary), (effect) =>
          provideLiveJournal(effect, readableSuccessHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimReadUnavailable" })
    })
  )

  effectIt.effect("keeps an exact-open confirmation pending and a later focused success completes it", () =>
    Effect.gen(function* () {
      const request = completionTaskRequestFor(integrationFinalityFixture.claim)
      const acknowledgement = CompletionTaskAcknowledgement.make({
        operationId: request.operationId,
        taskId: request.taskId
      })
      const harness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.replacedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      const lifecycle = yield* Ref.make<"CompletedSuccessfully" | "Open">("Open")
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.succeed(acknowledgement),
        readCompletionRequest: () => Effect.die("focused observation never performs request lookup"),
        readFocusedTaskCompletion: ({ operationId }) =>
          Ref.get(lifecycle).pipe(
            Effect.map((currentLifecycle) => ({
              ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
              currentClaim: integrationFinalityFixture.claim,
              lifecycle: currentLifecycle,
              operationId,
              target: integrationFinalityFixture.target
            }))
          )
      })
      const completion = RunnableFrontierTransition.CompletePromotedTask({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const completionProposal = proposalsFor(completion).proposals[0]
      if (completionProposal === undefined || !isIdentityFreeProposal(completionProposal)) {
        return yield* Effect.die("missing completion seed proposal")
      }
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: completionProposal },
          completion,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(
          Effect.provideService(CompletionTaskBoundary, boundary),
          Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
          Effect.provideService(EvidenceStore, completionEvidenceStore),
          (effect) => provideLiveJournal(effect, harness)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: completionProposal.id })
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused completion proposal")
      }
      const action = { _tag: "IdentityFreeAction" as const, proposal }
      const pending = yield* executeIntegrationAction(
        action,
        transition,
        inertLease,
        integrationFinalityFixture.target
      ).pipe(Effect.provideService(CompletionTaskBoundary, boundary), (effect) => provideLiveJournal(effect, harness))
      expect(pending).toMatchObject({
        _tag: "ActionDeferred",
        reason: { _tag: "IntegrationFinality.CompletionTaskConfirmationWait" }
      })

      yield* Ref.set(lifecycle, "CompletedSuccessfully")
      expect(
        yield* executeIntegrationAction(action, transition, inertLease, integrationFinalityFixture.target).pipe(
          Effect.provideService(CompletionTaskBoundary, boundary),
          (effect) => provideLiveJournal(effect, harness)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(
        (yield* harness.records).filter(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            event.observation._tag === "FocusedTaskCompletionFacts" &&
            event.observation.facts.lifecycle === "CompletedSuccessfully"
        )
      ).toHaveLength(1)
    })
  )

  effectIt.effect("restart derives durable focused success without reading the tracker again", () =>
    Effect.gen(function* () {
      const request = completionTaskRequestFor(integrationFinalityFixture.claim)
      const initialHarness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.replacedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      const completion = RunnableFrontierTransition.CompletePromotedTask({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const completionProposal = proposalsFor(completion).proposals[0]
      if (completionProposal === undefined || !isIdentityFreeProposal(completionProposal)) {
        return yield* Effect.die("missing restart completion seed proposal")
      }
      const seedBoundary = CompletionTaskBoundary.of({
        completeTask: () =>
          Effect.succeed(
            CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
          ),
        readCompletionRequest: () => Effect.die("successful completion does not need lookup"),
        readFocusedTaskCompletion: ({ operationId }) =>
          Effect.succeed({
            ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
            currentClaim: integrationFinalityFixture.claim,
            lifecycle: "Open",
            operationId,
            target: integrationFinalityFixture.target
          })
      })
      yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal: completionProposal },
        completion,
        inertLease,
        integrationFinalityFixture.target
      ).pipe(
        Effect.provideService(CompletionTaskBoundary, seedBoundary),
        Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
        Effect.provideService(EvidenceStore, completionEvidenceStore),
        (effect) => provideLiveJournal(effect, initialHarness)
      )
      const completionAttempt = (yield* initialHarness.records).find(
        ({ event }) => event._tag === "CompletionTaskAttemptIntended"
      )?.event
      if (completionAttempt?._tag !== "CompletionTaskAttemptIntended") {
        return yield* Effect.die("completion attempt intent was not recorded")
      }
      const confirmationOperation = makeCompletionTaskFactsObservationOperation(
        request,
        integrationFinalityFixture.target,
        CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
          attemptOrdinal: completionAttempt.attemptOrdinal,
          confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
        })
      )
      const confirmationIntent = taskTrackerReadIntent(confirmationOperation)
      const confirmationFacts = FocusedTaskCompletionFacts.make({
        ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
        currentClaim: integrationFinalityFixture.claim,
        lifecycle: "CompletedSuccessfully",
        operationId: confirmationOperation.operationId,
        target: integrationFinalityFixture.target
      })
      const confirmationEvent = taskTrackerFactsObservedEvent(
        confirmationOperation.operationId,
        makeFocusedTaskCompletionFactsObserved(confirmationOperation, confirmationFacts)
      )
      yield* initialHarness.journal.append(
        integrationFinalityFixture.runId,
        describeJournalEvent(confirmationIntent).expectedKey,
        confirmationIntent
      )
      yield* initialHarness.journal.append(
        integrationFinalityFixture.runId,
        describeJournalEvent(confirmationEvent).expectedKey,
        confirmationEvent
      )
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing restart focused-completion proposal")
      }
      const harness = yield* makeLiveJournalHarness(
        yield* initialHarness.records,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("restart normalization never completes the task again"),
        readCompletionRequest: () => Effect.die("restart normalization never looks up the request"),
        readFocusedTaskCompletion: () => Effect.die("durable focused success must not be read again")
      })

      const restartResult = yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        inertLease,
        integrationFinalityFixture.target
      ).pipe(Effect.provideService(CompletionTaskBoundary, boundary), (effect) => provideLiveJournal(effect, harness))
      expect(restartResult).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(
        (yield* harness.records).filter(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            event.observation._tag === "FocusedTaskCompletionFacts" &&
            event.observation.facts.lifecycle === "CompletedSuccessfully"
        )
      ).toHaveLength(1)
    })
  )

  effectIt.effect("requires an exact acknowledgement or Applied lookup before focused confirmation", () =>
    Effect.gen(function* () {
      const request = completionTaskRequestFor(integrationFinalityFixture.claim)
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused completion proposal")
      }
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("focused confirmation never completes the task"),
        readCompletionRequest: () => Effect.die("focused confirmation never looks up the request"),
        readFocusedTaskCompletion: () => Effect.die("missing confirmation basis must stop before the tracker read")
      })
      const harness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.replacedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )

      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal },
          transition,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionTaskBoundary, boundary), (effect) => provideLiveJournal(effect, harness))
      ).toMatchObject({
        _tag: "ActionDeferred",
        reason: {
          _tag: "IntegrationFinality.CompletionTaskAuthorizationConflict",
          reason: "RequestIdentityContradiction"
        }
      })
    })
  )

  effectIt.effect("translates focused confirmation waits and precondition conflicts", () =>
    Effect.gen(function* () {
      const request = completionTaskRequestFor(integrationFinalityFixture.claim)
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused confirmation proposal")
      }
      const seedBoundary = CompletionTaskBoundary.of({
        completeTask: () =>
          Effect.succeed(
            CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
          ),
        readCompletionRequest: () => Effect.die("successful completion does not need lookup"),
        readFocusedTaskCompletion: ({ operationId }) =>
          Effect.succeed({
            ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
            currentClaim: integrationFinalityFixture.claim,
            lifecycle: "Open",
            operationId,
            target: integrationFinalityFixture.target
          })
      })
      const waitingFixture = yield* executeCompletionFixture(seedBoundary)
      const waitingBoundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("focused confirmation wait must not complete the task"),
        readCompletionRequest: () => Effect.die("focused confirmation wait must not look up the request"),
        readFocusedTaskCompletion: ({ taskId }) =>
          Effect.fail(new FocusedTaskCompletionReadFailure({ detail: "focused facts unavailable", taskId }))
      })
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal },
          transition,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionTaskBoundary, waitingBoundary), (effect) =>
          provideLiveJournal(effect, waitingFixture.harness)
        )
      ).toMatchObject({
        _tag: "ActionDeferred",
        reason: { _tag: "IntegrationFinality.CompletionTaskConfirmationWait" }
      })

      const conflictingFixture = yield* executeCompletionFixture(seedBoundary)
      const conflictingBoundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("durable conflicting facts must stop before completion"),
        readCompletionRequest: () => Effect.die("durable conflicting facts must stop before lookup"),
        readFocusedTaskCompletion: ({ operationId }) =>
          Effect.succeed({
            ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
            currentClaim: integrationFinalityFixture.activeClaim,
            lifecycle: "Open",
            operationId,
            target: integrationFinalityFixture.target
          })
      })
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal },
          transition,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(Effect.provideService(CompletionTaskBoundary, conflictingBoundary), (effect) =>
          provideLiveJournal(effect, conflictingFixture.harness)
        )
      ).toMatchObject({
        _tag: "ActionDeferred",
        reason: { _tag: "IntegrationFinality.CompletionTaskPreconditionConflict" }
      })
    })
  )

  effectIt.effect("uses a durable Applied lookup as the focused confirmation basis", () =>
    Effect.gen(function* () {
      const request = completionTaskRequestFor(integrationFinalityFixture.claim)
      const fixture = yield* executeCompletionFixture(
        CompletionTaskBoundary.of({
          completeTask: (received) =>
            Effect.fail(
              new CompletionTaskRequestFailure({ detail: "response lost", outcome: "Unknown", request: received })
            ),
          readCompletionRequest: (received) =>
            Effect.succeed(CompletionTaskRequestLookup.cases.Applied.make({ request: received })),
          readFocusedTaskCompletion: ({ operationId }) =>
            Effect.succeed({
              ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
              currentClaim: integrationFinalityFixture.claim,
              lifecycle: "Open",
              operationId,
              target: integrationFinalityFixture.target
            })
        })
      )
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("focused confirmation never completes the task"),
        readCompletionRequest: () => Effect.die("the Applied lookup is already durable"),
        readFocusedTaskCompletion: ({ operationId }) =>
          Effect.succeed({
            ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
            currentClaim: integrationFinalityFixture.claim,
            lifecycle: "Open",
            operationId,
            target: integrationFinalityFixture.target
          })
      })
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused completion proposal")
      }

      const appliedLookupResult = yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        inertLease,
        integrationFinalityFixture.target
      ).pipe(Effect.provideService(CompletionTaskBoundary, boundary), (effect) =>
        provideLiveJournal(effect, fixture.harness)
      )
      expect(appliedLookupResult).toMatchObject({
        _tag: "ActionDeferred",
        reason: { _tag: "IntegrationFinality.CompletionTaskConfirmationWait" }
      })
    })
  )

  effectIt.effect("translates task-completion protocol waits and conflicts into exact deferred actions", () =>
    Effect.gen(function* () {
      const request = completionTaskRequestFor(integrationFinalityFixture.claim)
      const transition = RunnableFrontierTransition.CompletePromotedTask({
        request,
        responsibility: acceptedFinalityHistory.responsibility
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing task-completion proposal")
      }
      const action = { _tag: "IdentityFreeAction" as const, proposal }
      const neverCalledBoundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("unavailable completion runtime must stop before the tracker call"),
        readCompletionRequest: () => Effect.die("unavailable completion runtime must stop before lookup"),
        readFocusedTaskCompletion: () => Effect.die("unavailable completion runtime must stop before reads")
      })
      const unavailableHarness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.replacedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      const unavailable = yield* Effect.flip(
        executeIntegrationAction(action, transition, inertLease, integrationFinalityFixture.target).pipe((effect) =>
          provideLiveJournal(effect, unavailableHarness)
        )
      )
      expect(unavailable).toBeInstanceOf(IntegrationFinalityRuntimeUnavailable)
      const incompleteHarness = yield* makeLiveJournalHarness(
        promotedFinalityHistory.replacedRecords,
        integrationFinalityFixture.runId,
        integrationFinalityFixture.target
      )
      expect(
        yield* executeIntegrationAction(action, transition, inertLease, integrationFinalityFixture.target).pipe(
          Effect.provideService(CompletionTaskBoundary, neverCalledBoundary),
          (effect) => provideLiveJournal(effect, incompleteHarness)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionTaskUnavailable" })

      const scenarios = [
        {
          expected: {
            _tag: "IntegrationFinality.CompletionTaskAuthorizationConflict",
            reason: "CompletionClaimForeign"
          },
          makeBoundary: () =>
            CompletionTaskBoundary.of({
              completeTask: () => Effect.die("foreign current claim must stop before completion"),
              readCompletionRequest: () => Effect.die("foreign current claim must stop before lookup"),
              readFocusedTaskCompletion: ({ operationId }) =>
                Effect.succeed({
                  ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                  currentClaim: integrationFinalityFixture.activeClaim,
                  operationId,
                  target: integrationFinalityFixture.target
                })
            })
        },
        {
          expected: { _tag: "IntegrationFinality.CompletionTaskAuthorizationWait" },
          makeBoundary: () =>
            CompletionTaskBoundary.of({
              completeTask: () => Effect.die("authorization conflict must stop before completion"),
              readCompletionRequest: () => Effect.die("authorization conflict must stop before lookup"),
              readFocusedTaskCompletion: ({ taskId }) =>
                Effect.fail(new FocusedTaskCompletionReadFailure({ detail: "focused facts unavailable", taskId }))
            })
        },
        {
          expected: { _tag: "IntegrationFinality.CompletionTaskConfirmationWait" },
          makeBoundary: () => {
            let focusedReadCount = 0
            return CompletionTaskBoundary.of({
              completeTask: (received) =>
                Effect.fail(
                  new CompletionTaskRequestFailure({ detail: "response lost", outcome: "Unknown", request: received })
                ),
              readCompletionRequest: () => Effect.die("failed confirmation must stop before lookup"),
              readFocusedTaskCompletion: ({ operationId, taskId }) => {
                focusedReadCount += 1
                return focusedReadCount === 1
                  ? Effect.succeed({
                      ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                      currentClaim: integrationFinalityFixture.claim,
                      lifecycle: "Open" as const,
                      operationId,
                      target: integrationFinalityFixture.target
                    })
                  : Effect.fail(new FocusedTaskCompletionReadFailure({ detail: "confirmation unavailable", taskId }))
              }
            })
          }
        },
        {
          expected: { _tag: "IntegrationFinality.CompletionTaskAmbiguousWait" },
          makeBoundary: () =>
            CompletionTaskBoundary.of({
              completeTask: (received) =>
                Effect.fail(
                  new CompletionTaskRequestFailure({ detail: "response lost", outcome: "Unknown", request: received })
                ),
              readCompletionRequest: (received) =>
                Effect.succeed(
                  CompletionTaskRequestLookup.cases.Unreadable.make({ detail: "lookup unavailable", request: received })
                ),
              readFocusedTaskCompletion: ({ operationId }) =>
                Effect.succeed({
                  ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                  currentClaim: integrationFinalityFixture.claim,
                  lifecycle: "Open" as const,
                  operationId,
                  target: integrationFinalityFixture.target
                })
            })
        },
        {
          expected: "CompletionTaskNonConvergent",
          makeBoundary: () =>
            CompletionTaskBoundary.of({
              completeTask: (received) =>
                Effect.fail(
                  new CompletionTaskRequestFailure({ detail: "response lost", outcome: "Unknown", request: received })
                ),
              readCompletionRequest: (received) =>
                Effect.succeed(CompletionTaskRequestLookup.cases.NotApplied.make({ request: received })),
              readFocusedTaskCompletion: ({ operationId }) =>
                Effect.succeed({
                  ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                  currentClaim: integrationFinalityFixture.claim,
                  lifecycle: "Open" as const,
                  operationId,
                  target: integrationFinalityFixture.target
                })
            })
        },
        {
          expected: { _tag: "IntegrationFinality.CompletionTaskPreconditionConflict" },
          makeBoundary: () =>
            CompletionTaskBoundary.of({
              completeTask: (received) =>
                Effect.succeed(
                  CompletionTaskAcknowledgement.make({
                    operationId: received.operationId,
                    taskId: TaskId.make("another-task")
                  })
                ),
              readCompletionRequest: () => Effect.die("mismatched acknowledgement must stop before lookup"),
              readFocusedTaskCompletion: ({ operationId }) =>
                Effect.succeed({
                  ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                  currentClaim: integrationFinalityFixture.claim,
                  lifecycle: "Open" as const,
                  operationId,
                  target: integrationFinalityFixture.target
                })
            })
        }
      ] as const

      for (const scenario of scenarios) {
        const harness = yield* makeLiveJournalHarness(
          promotedFinalityHistory.replacedRecords,
          integrationFinalityFixture.runId,
          integrationFinalityFixture.target
        )
        const result = yield* executeIntegrationAction(
          action,
          transition,
          inertLease,
          integrationFinalityFixture.target
        ).pipe(
          Effect.provideService(CompletionTaskBoundary, scenario.makeBoundary()),
          Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
          Effect.provideService(EvidenceStore, completionEvidenceStore),
          (effect) => provideLiveJournal(effect, harness)
        )
        expect(result).toMatchObject({ _tag: "ActionDeferred", reason: scenario.expected })
      }
    })
  )

  effectIt.effect("does not admit executor work after an ordinary post-claim read makes the task ineligible", () =>
    Effect.gen(function* () {
      const projected = projectTrackerSnapshot({ revision: "post-claim-ineligible", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("the empty tracker graph must be valid")
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make("post-claim-ineligible-claim"),
          owner: ClaimOwner.make("dalph"),
          taskId,
          token: ClaimToken.make("post-claim-ineligible-token")
        },
        predecessorOperationIds: []
      })
      const step = FreshWorkflowStep.ReadPostClaimGraph({
        claimOperation,
        predecessorOperationId: claimOperation.acquisition.operationId,
        task
      })
      const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: claimOperation.acquisition.operationId,
        taskId
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set<OperationId>(),
        fresh: Result.getOrThrow(
          freshContinuationDecisionsOf(
            [{ step, transition }],
            [makeFreshTaskCommitmentForTest(taskId, claimOperation.acquisition.operationId, runId)]
          )
        ),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (
        proposal === undefined ||
        !isFreshOperationProposal(proposal) ||
        proposal.route._tag !== "FreshWorkflowRoute"
      ) {
        return yield* Effect.die("a fresh post-claim route must be derivable")
      }
      const traceTags = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* executeFreshWorkflowOperation(
        { _tag: "FreshOperationAction", operationId: OperationId.make("post-claim-ineligible-read"), proposal },
        proposal.route,
        inertLease,
        target
      ).pipe(
        Effect.provideService(
          WorkflowInterpreter,
          WorkflowInterpreter.of({
            acquireTaskClaim: () => Effect.die("unused claim acquisition"),
            readTaskClaim: () => Effect.die("unused claim read"),
            readTaskWorktree: () => Effect.die("unused worktree read"),
            readTargetLineage: () => Effect.die("unused lineage read"),
            readTrackerGraph: () => Effect.succeed(projected.snapshot),
            readTaskWorkSpecification: () => Effect.die("unused specification read"),
            reconcileTaskWorktree: () => Effect.die("unused worktree reconciliation"),
            recordTaskAttemptPlan: () => Effect.die("unused attempt planning"),
            releaseTaskClaim: () => Effect.die("unused claim release")
          })
        ),
        Effect.provideService(
          WorkflowTrace,
          WorkflowTrace.of({ emit: (item) => Ref.update(traceTags, (current) => [...current, item._tag]) })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planning") })
        )
      )

      expect(result).toEqual({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(yield* Ref.get(traceTags)).not.toContain("TrackerExecutionAdmitted")
    })
  )

  effectIt.effect("rereads a rejected task claim without consuming a task-work position", () =>
    Effect.gen(function* () {
      const rejectedClaimOperationId = OperationId.make("rejected-fresh-claim")
      const graphObservationOperationId = OperationId.make("rejected-fresh-claim-graph-wake")
      const step = FreshWorkflowStep.ReadRejectedTaskClaim({
        predecessorOperationId: graphObservationOperationId,
        rejectedClaimOperationId,
        task
      })
      const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: graphObservationOperationId,
        taskId
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set<OperationId>(),
        fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [])),
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (
        proposal === undefined ||
        !isFreshOperationProposal(proposal) ||
        proposal.route._tag !== "FreshWorkflowRoute"
      ) {
        return yield* Effect.die("a rejected-claim observation route must be derivable")
      }
      expect(proposal.admission.taskWorkPosition).toEqual({ _tag: "NoTaskWorkPosition" })

      const observedOperations = yield* Ref.make<
        ReadonlyArray<{
          readonly operationId: OperationId
          readonly predecessorOperationIds: ReadonlyArray<OperationId>
          readonly taskId: TaskId
        }>
      >([])
      const foreign = ActiveTaskClaim.make({
        operationId: OperationId.make("rejected-fresh-claim-foreign"),
        owner: ClaimOwner.make("rejected-fresh-claim-foreign-owner"),
        taskId,
        token: ClaimToken.make("rejected-fresh-claim-foreign-token")
      })
      const actionOperationId = OperationId.make("rejected-fresh-claim-focused-read")
      const result = yield* executeFreshWorkflowOperation(
        { _tag: "FreshOperationAction", operationId: actionOperationId, proposal },
        proposal.route,
        inertLease,
        target
      ).pipe(
        Effect.provideService(
          WorkflowInterpreter,
          WorkflowInterpreter.of({
            acquireTaskClaim: () => Effect.die("unused claim acquisition"),
            readTaskClaim: (operation) =>
              Ref.update(observedOperations, (operations) => [...operations, operation]).pipe(
                Effect.as({ _tag: "AuthoritativeTaskClaimObserved" as const, observation: foreign })
              ),
            readTaskWorktree: () => Effect.die("unused worktree read"),
            readTargetLineage: () => Effect.die("unused lineage read"),
            readTrackerGraph: () => Effect.die("unused graph read"),
            readTaskWorkSpecification: () => Effect.die("unused specification read"),
            reconcileTaskWorktree: () => Effect.die("unused worktree reconciliation"),
            recordTaskAttemptPlan: () => Effect.die("unused attempt planning"),
            releaseTaskClaim: () => Effect.die("unused claim release")
          })
        ),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planning") })
        )
      )

      expect(result).toEqual({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(yield* Ref.get(observedOperations)).toEqual([
        {
          _tag: "ReadTaskClaim",
          operationId: actionOperationId,
          predecessorOperationIds: [graphObservationOperationId, rejectedClaimOperationId].toSorted(),
          target,
          taskId
        }
      ])
    })
  )

  effectIt.effect("normalizes fresh graph-read failures while preserving boundary-decode errors", () =>
    Effect.gen(function* () {
      const proposal = trackerGraphReadProposalOf({ acceptedAt: null, purpose: "EstablishCurrentGraph", runId, target })
      if (!isFreshTrackerGraphProposal(proposal)) {
        return yield* Effect.die("missing fresh tracker graph-read proposal")
      }
      const action = {
        _tag: "FreshOperationAction" as const,
        operationId: OperationId.make("fresh-graph-read"),
        proposal
      }
      const failures = [
        new FixtureReadError({ detail: "fixture unavailable", target }),
        new GraphProjectionError({ issues: [] }),
        new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
          detail: "incomplete tracker snapshot",
          reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
        }),
        new TrackerReadError({ detail: "tracker response was malformed", operation: "TrackerGraphReader.parse" }),
        new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
          detail: "tracker boundary could not decode",
          reason: TrackerAdapterReadFailureReason.cases.BoundaryDecode.make({})
        })
      ] as const

      for (const failure of failures) {
        const result = yield* executeFreshTrackerGraphRead(action, proposal.route, inertLease).pipe(
          Effect.provideService(
            WorkflowInterpreter,
            WorkflowInterpreter.of({
              acquireTaskClaim: () => Effect.die("unused claim acquisition"),
              readTaskClaim: () => Effect.die("unused claim read"),
              readTaskWorktree: () => Effect.die("unused worktree read"),
              readTargetLineage: () => Effect.die("unused lineage read"),
              readTrackerGraph: () => Effect.fail(failure),
              readTaskWorkSpecification: () => Effect.die("unused specification read"),
              reconcileTaskWorktree: () => Effect.die("unused worktree reconciliation"),
              recordTaskAttemptPlan: () => Effect.die("unused attempt planning"),
              releaseTaskClaim: () => Effect.die("unused claim release")
            })
          ),
          Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
          Effect.exit
        )
        const isBoundaryDecode =
          failure._tag === "TrackerGraphReader.AdapterReadError" && failure.reason._tag === "BoundaryDecode"
        expect(result._tag).toBe(isBoundaryDecode ? "Failure" : "Success")
        if (!isBoundaryDecode && result._tag === "Success") {
          expect(result.value).toEqual({
            _tag: "ActionDeferred",
            proposalId: proposal.id,
            reason: "TrackerGraphReadUnavailable"
          })
        }
      }

      const projected = projectTrackerSnapshot({ revision: "fresh-graph-read-success", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("the empty tracker graph must be valid")
      const snapshot = yield* executeTrackerGraphRead(
        makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          OperationId.make("fresh-graph-read-success"),
          target
        )
      ).pipe(
        Effect.provideService(
          WorkflowInterpreter,
          WorkflowInterpreter.of({
            acquireTaskClaim: () => Effect.die("unused claim acquisition"),
            readTaskClaim: () => Effect.die("unused claim read"),
            readTaskWorktree: () => Effect.die("unused worktree read"),
            readTargetLineage: () => Effect.die("unused lineage read"),
            readTrackerGraph: () => Effect.succeed(projected.snapshot),
            readTaskWorkSpecification: () => Effect.die("unused specification read"),
            reconcileTaskWorktree: () => Effect.die("unused worktree reconciliation"),
            recordTaskAttemptPlan: () => Effect.die("unused attempt planning"),
            releaseTaskClaim: () => Effect.die("unused claim release")
          })
        ),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
      )
      expect(snapshot).toBe(projected.snapshot)
    })
  )

  const acceptedExecutingExecutorRecords = (): ReadonlyArray<JournalRecord> => acceptedExecutingHistory.records

  effectIt.effect("retains the task position while a passive observation still reports executing", () =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(1) },
        plannedAttempt
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing continued executor proposal")
      }
      const releases = yield* Ref.make(0)
      const appends = yield* Ref.make(0)
      const protocolController = yield* makePlannedAttemptProtocolController()
      const lease: DeliveryActionExecutionLease = {
        ...inertLease,
        releasePlannedAttemptPosition: () => Ref.update(releases, (count) => count + 1),
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }
      const correlation = { attemptId: plannedAttempt.attemptId, runId }
      const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      const harness = yield* makeLiveJournalHarness(acceptedExecutingExecutorRecords())
      const result = yield* executePlannedAttemptTransition(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        lease
      ).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report })),
            requestSuspension: () => Effect.die("suspension was not requested"),
            begin: () => Effect.die("passive observation must not begin work"),
            resume: () => Effect.die("passive observation must not resume work")
          })
        )
      )

      expect(result._tag).toBe("ExecutorReportPublished")
      if (result._tag !== "ExecutorReportPublished") return yield* Effect.die("executor report was not published")
      expect(result.acceptedFacts).toBe("UnchangedPassiveObservation")
      expect(result.report).toEqual(report)
      expect(yield* Ref.get(appends)).toBe(0)
      expect(yield* Ref.get(releases)).toBe(0)
    })
  )

  effectIt.effect("after Suspend returns Executing observes exact Safe and releases only that attempt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        const foreignAttempt = PlannedTaskAttempt.make({
          ...plannedAttempt,
          attemptId: AttemptId.make("route-matrix-foreign-attempt"),
          branch: TaskBranchRef.make("refs/heads/dalph/B"),
          executor: TaskExecutorLocator.make("executor:foreign"),
          taskId: TaskId.make("B"),
          worktree: WorktreeLocator.make("/worktrees/B")
        })
        const foreignCorrelation = plannedAttemptExecutorCorrelation(foreignAttempt)
        const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
        const transition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
        const proposal = proposalsFor(transition).proposals[0]
        if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
          return yield* Effect.die("missing executor suspension proposal")
        }

        const harness = yield* makeLiveJournalHarness(acceptedExecutingExecutorRecords())
        const protocolController = yield* makePlannedAttemptProtocolController()
        const admission = yield* makeDeliveryRuntimeAdmissionController(
          makeFreshTaskAdmissionTestBasis({
            capacity: TaskWorkCapacity.make(2),
            held: [plannedAttempt, foreignAttempt]
          }),
          yield* makeIntegrationTargetResourceController(),
          (yield* makeApplicationExitLifecycle()).admission
        ).pipe(Effect.provideService(PlannedAttemptProtocolController, protocolController))
        const suspensionCalls = yield* Ref.make(0)
        const attachments = yield* Ref.make(0)
        const boundaryCalls = yield* Ref.make<ReadonlyArray<"Suspend" | "Attach">>([])
        const lifecycleChanges = yield* Queue.unbounded<PlannedAttemptExecutorProjection>()
        const changePublished = yield* Deferred.make<void>()
        const processScope = yield* Effect.scope

        const publication = PassivePlannedAttemptProjectionPublication.of({
          publish: (attempt, projection) =>
            protocolController
              .withPermit(plannedAttemptExecutorCorrelation(attempt), (permit) =>
                publishPlannedAttemptExecutorProjectionResultWithPermit(permit, attempt, projection).pipe((effect) =>
                  provideLiveJournal(effect, harness)
                )
              )
              .pipe(
                Effect.tap((result) =>
                  result.report._tag === "ExecutorWorkSafelySuspended" || result.report._tag === "ExecutorWorkTerminal"
                    ? admission.releasePlannedAttemptPosition(result.report.correlation)
                    : Effect.void
                )
              ),
          publishWithPermit: (permit, attempt, projection) =>
            publishPlannedAttemptExecutorProjectionResultWithPermit(permit, attempt, projection).pipe((effect) =>
              provideLiveJournal(effect, harness)
            )
        })
        const observer = PassivePlannedAttemptObserver.of({
          attach: (input) =>
            Effect.gen(function* () {
              yield* Ref.update(attachments, (count) => count + 1)
              yield* Ref.update(boundaryCalls, (calls) => [...calls, "Attach" as const])
              yield* Queue.take(lifecycleChanges).pipe(
                Effect.flatMap(input.publishChange),
                Effect.andThen(Deferred.succeed(changePublished, undefined)),
                Effect.forkIn(processScope)
              )
              return yield* input.publishCurrent(
                PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing })
              )
            })
        })

        const result = yield* executePlannedAttemptTransitionRaw({ _tag: "IdentityFreeAction", proposal }, transition, {
          ...inertLease,
          releasePlannedAttemptPosition: (subject) =>
            admission.releasePlannedAttemptPosition(subject).pipe(Effect.asVoid),
          withPlannedAttemptProtocol: (subject, effect) => protocolController.withPermit(subject, effect)
        }).pipe(
          (effect) => provideLiveJournal(effect, harness),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              observe: () => Effect.die("Suspend attachment reads through the passive observer"),
              requestSuspension: (attempt) =>
                Effect.gen(function* () {
                  yield* Ref.update(suspensionCalls, (count) => count + 1)
                  yield* Ref.update(boundaryCalls, (calls) => [...calls, "Suspend" as const])
                  return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                    correlation: plannedAttemptExecutorCorrelation(attempt)
                  })
                }),
              begin: () => Effect.die("suspension must not begin work"),
              resume: () => Effect.die("suspension must not resume work")
            })
          ),
          Effect.provideService(PassivePlannedAttemptObserver, observer),
          Effect.provideService(PassivePlannedAttemptProjectionPublication, publication)
        )

        expect(result).toMatchObject({ _tag: "ExecutorReportPublished", report: executing })
        expect(yield* Ref.get(suspensionCalls)).toBe(1)
        expect(yield* Ref.get(attachments)).toBe(1)
        expect(yield* Ref.get(boundaryCalls)).toEqual(["Suspend", "Attach"])
        const heldPositions = yield* admission.snapshot
        const plannedPosition = heldPositions.positions.get(plannedAttempt.taskId)
        const foreignHeldPosition = heldPositions.positions.get(foreignAttempt.taskId)
        expect(plannedPosition).toMatchObject({
          _tag: "ExactAttemptHeld",
          plannedAttempt: { attemptId: correlation.attemptId, runId: correlation.runId, taskId: plannedAttempt.taskId }
        })
        expect(foreignHeldPosition).toMatchObject({
          _tag: "ExactAttemptHeld",
          plannedAttempt: {
            attemptId: foreignCorrelation.attemptId,
            runId: foreignCorrelation.runId,
            taskId: foreignAttempt.taskId
          }
        })

        yield* Queue.offer(lifecycleChanges, PlannedAttemptExecutorProjection.cases.Exact.make({ report: safe }))
        yield* Deferred.await(changePublished)

        expect((yield* admission.snapshot).positions.has(plannedAttempt.taskId)).toBe(false)
        const foreignPosition = (yield* admission.snapshot).positions.get(foreignAttempt.taskId)
        expect(foreignPosition).toMatchObject({
          _tag: "ExactAttemptHeld",
          plannedAttempt: {
            attemptId: foreignCorrelation.attemptId,
            runId: foreignCorrelation.runId,
            taskId: foreignAttempt.taskId
          }
        })
        expect(
          (yield* harness.records).flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
          )
        ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
      })
    )
  )

  const assertPassiveFinalProjection = (kind: "Safe" | "Terminal") =>
    Effect.gen(function* () {
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const testCase =
        kind === "Terminal"
          ? {
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                correlation,
                result: { _tag: "Completed" }
              }),
              transition: RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
                acceptedProgress: {
                  _tag: "ExecutorReportAccepted",
                  ordinal: PlannedAttemptExecutorReportOrdinal.make(1)
                },
                plannedAttempt
              })
            }
          : {
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }),
              transition: RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt })
            }

      const proposal = proposalsFor(testCase.transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing passive executor proposal")
      }
      const releases = yield* Ref.make(0)
      const releaseDispositions = yield* Ref.make<ReadonlyArray<"Released" | "AlreadyAbsent">>([])
      const appends = yield* Ref.make(0)
      const harness = yield* makeLiveJournalHarness(acceptedExecutingExecutorRecords())
      if (testCase.report._tag === "ExecutorWorkSafelySuspended") {
        const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Suspend",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: suspendOrdinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: suspendOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
            version: workflowJournalEventVersion
          })
        )
      }
      const countedJournal = InRunJournal.of({
        append: (requestedRunId, key, event) =>
          harness.journal
            .append(requestedRunId, key, event)
            .pipe(Effect.tap(() => Ref.update(appends, (count) => count + 1))),
        read: harness.journal.read
      })
      const protocolController = yield* makePlannedAttemptProtocolController()
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        makeFreshTaskAdmissionTestBasis({ capacity: TaskWorkCapacity.make(1), held: [plannedAttempt] }),
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      ).pipe(Effect.provideService(PlannedAttemptProtocolController, protocolController))
      const result = yield* executePlannedAttemptTransition(
        { _tag: "IdentityFreeAction", proposal },
        testCase.transition,
        {
          ...inertLease,
          releasePlannedAttemptPosition: (subject) =>
            Ref.update(releases, (count) => count + 1).pipe(
              Effect.andThen(admission.releasePlannedAttemptPosition(subject)),
              Effect.tap((disposition) => Ref.update(releaseDispositions, (current) => [...current, disposition])),
              Effect.asVoid
            ),
          withPlannedAttemptProtocol: (subject, effect) => protocolController.withPermit(subject, effect)
        }
      ).pipe(
        (effect) => provideLiveJournal(effect, harness, countedJournal),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () =>
              Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report: testCase.report })),
            requestSuspension: () => Effect.die("passive observation must not request suspension"),
            begin: () => Effect.die("passive observation must not begin work"),
            resume: () => Effect.die("passive observation must not resume work")
          })
        )
      )

      expect(result).toMatchObject({
        _tag: "ExecutorReportPublished",
        acceptedFacts: "Changed",
        report: testCase.report
      })
      expect(yield* Ref.get(appends)).toBe(2)
      expect(yield* Ref.get(releases)).toBe(1)
      expect(yield* Ref.get(releaseDispositions)).toEqual(["Released"])
      expect((yield* admission.snapshot).positions.size).toBe(0)
    })

  effectIt.effect("observes live terminal executor change once and releases the exact position", () =>
    assertPassiveFinalProjection("Terminal")
  )

  effectIt.effect("observes safe suspension only after exact suspend intent and releases only that attempt", () =>
    assertPassiveFinalProjection("Safe")
  )

  effectIt.effect(
    "accepts a pending Safe observation after process death with causal Suspend history and one release",
    () =>
      Effect.gen(function* () {
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
        const transition = RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt })
        const proposal = proposalsFor(transition).proposals[0]
        if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
          return yield* Effect.die("missing pending Safe proposal")
        }
        const harness = yield* makeLiveJournalHarness(acceptedExecutingExecutorRecords())
        const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "Suspend",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal: suspendOrdinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: suspendOrdinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt,
            report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }),
            version: workflowJournalEventVersion
          })
        )
        const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
          PlannedAttemptExecutorStateObservedEvent.make({
            observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: safe }),
            occurrenceClassification: "NonActionOccurrence",
            ordinal: observationOrdinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        const executorCalls = yield* Ref.make(0)
        const protocolController = yield* makePlannedAttemptProtocolController()
        const admission = yield* makeDeliveryRuntimeAdmissionController(
          makeFreshTaskAdmissionTestBasis({ capacity: TaskWorkCapacity.make(1), held: [plannedAttempt] }),
          yield* makeIntegrationTargetResourceController(),
          (yield* makeApplicationExitLifecycle()).admission
        ).pipe(Effect.provideService(PlannedAttemptProtocolController, protocolController))
        const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
          ...inertLease,
          releasePlannedAttemptPosition: admission.releasePlannedAttemptPosition,
          withPlannedAttemptProtocol: (subject, effect) => protocolController.withPermit(subject, effect)
        }).pipe(
          (effect) => provideLiveJournal(effect, harness),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              observe: () =>
                Ref.update(executorCalls, (count) => count + 1).pipe(
                  Effect.as(PlannedAttemptExecutorProjection.cases.Exact.make({ report: safe }))
                ),
              requestSuspension: () => Ref.update(executorCalls, (count) => count + 1).pipe(Effect.as(safe)),
              begin: () => Ref.update(executorCalls, (count) => count + 1).pipe(Effect.as(safe)),
              resume: () => Ref.update(executorCalls, (count) => count + 1).pipe(Effect.as(safe))
            })
          )
        )

        expect(result).toMatchObject({ _tag: "ExecutorReportPublished", report: safe })
        expect(yield* Ref.get(executorCalls)).toBe(0)
        expect((yield* admission.snapshot).positions.size).toBe(0)
        expect(yield* admission.releasePlannedAttemptPosition(correlation)).toBe("AlreadyAbsent")
        expect(
          (yield* harness.records).flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" ? [[event.ordinal, event.report._tag] as const] : []
          )
        ).toEqual([
          [1, "ExecutorWorkExecuting"],
          [2, "ExecutorWorkSafelySuspended"]
        ])
      })
  )

  effectIt.effect("releases the task position without appending an exact accepted safe or terminal replay", () =>
    Effect.gen(function* () {
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const cases = [
        {
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation,
            result: { _tag: "Completed" }
          }),
          transition: RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
            acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(2) },
            plannedAttempt
          })
        },
        {
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }),
          transition: RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt })
        }
      ] as const

      for (const testCase of cases) {
        const proposal = proposalsFor(testCase.transition).proposals[0]
        if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
          return yield* Effect.die("missing passive executor proposal")
        }
        const harness = yield* makeLiveJournalHarness(acceptedExecutingExecutorRecords())
        if (testCase.report._tag === "ExecutorWorkSafelySuspended") {
          const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
          yield* harness.journal.append(
            runId,
            plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
            PlannedAttemptExecutorCommandIntendedEvent.make({
              command: "Suspend",
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              ordinal: suspendOrdinal,
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
          yield* harness.journal.append(
            runId,
            plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
            PlannedAttemptExecutorCommandResponseObservedEvent.make({
              commandOrdinal: suspendOrdinal,
              occurrenceClassification: "NonActionOccurrence",
              plannedAttempt,
              report: testCase.report,
              version: workflowJournalEventVersion
            })
          )
        } else {
          const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
          yield* harness.journal.append(
            runId,
            plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
            PlannedAttemptExecutorStateObservedEvent.make({
              observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({
                report: testCase.report
              }),
              occurrenceClassification: "NonActionOccurrence",
              ordinal: observationOrdinal,
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
        }
        const acceptedReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
        yield* harness.journal.append(
          runId,
          plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, acceptedReportOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: acceptedReportOrdinal,
            report: testCase.report,
            version: workflowJournalEventVersion
          })
        )
        const releases = yield* Ref.make(0)
        const appends = yield* Ref.make(0)
        const protocolController = yield* makePlannedAttemptProtocolController()
        const result = yield* executePlannedAttemptTransition(
          { _tag: "IdentityFreeAction", proposal },
          testCase.transition,
          {
            ...inertLease,
            releasePlannedAttemptPosition: () => Ref.update(releases, (count) => count + 1),
            withPlannedAttemptProtocol: (subject, effect) => protocolController.withPermit(subject, effect)
          }
        ).pipe(
          (effect) => provideLiveJournal(effect, harness),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              observe: () =>
                Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report: testCase.report })),
              requestSuspension: () => Effect.die("passive observation must not request suspension"),
              begin: () => Effect.die("passive observation must not begin work"),
              resume: () => Effect.die("passive observation must not resume work")
            })
          )
        )

        expect(result).toMatchObject({
          _tag: "ExecutorReportPublished",
          acceptedFacts: "UnchangedPassiveObservation",
          report: testCase.report
        })
        expect(yield* Ref.get(appends)).toBe(0)
        expect(yield* Ref.get(releases)).toBe(1)
      }
    })
  )

  type ContinuationSupersession = "Claim" | "Executor" | "Graph" | "Lineage" | "Specification" | "Worktree"
  type ContinuationTrackerRefresh =
    | "GraphPending"
    | "GraphFailed"
    | "SpecificationPending"
    | "ClaimPending"
    | "ClaimUnreadable"
  type ContinuationTrackerReadFamily = "Graph" | "Specification" | "Claim"

  const continuationAuthorizationRecords = (options?: {
    readonly acceptedExecuting?: boolean
    readonly continueObservedSpecification?: typeof specification
    readonly currentSpecification?: typeof specification
    readonly graphOmitsTask?: boolean
    readonly graphMissingExplicitCoverage?: boolean
    readonly safeConsumed?: boolean
    readonly specificationMismatch?: boolean
    readonly supersededBy?: ContinuationSupersession
    readonly foreignTrackerRead?: boolean
    readonly foreignPlanWitness?: ContinuationTrackerReadFamily
    readonly foreignPlanLaterRead?: ContinuationTrackerReadFamily
    readonly immutableRunTarget?: typeof target
    readonly trackerReadTarget?: typeof target
    readonly trackerRefresh?: ContinuationTrackerRefresh
    readonly unsettledCommand?: boolean
  }) => {
    const records: Array<JournalRecord> = [...acceptedExecutingHistory.records]
    const append = (key: JournalRecordKey, event: JournalRecord["event"]) => {
      records.push({ event, key, position: JournalPosition.make(records.length + 1), runId })
    }
    const trackerReadTarget = options?.trackerReadTarget ?? target
    const acceptedPlan = records.find(({ event }) => event._tag === "TaskAttemptPlanned")
    if (acceptedPlan?.event._tag !== "TaskAttemptPlanned") {
      throw new Error("accepted executing history lacks its attempt plan")
    }
    const attemptPlanOperationId = acceptedPlan.event.operation.operationId
    const foreignPlanOperationId = OperationId.make("continuation-foreign-plan")
    const foreignPlanAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("continuation-foreign-plan-attempt")
    })
    const hasForeignPlan = options?.foreignPlanWitness !== undefined || options?.foreignPlanLaterRead !== undefined
    const graphPlanOperationId =
      options?.foreignPlanWitness === "Graph" ? foreignPlanOperationId : attemptPlanOperationId
    const specificationPlanOperationId =
      options?.foreignPlanWitness === "Specification" ? foreignPlanOperationId : attemptPlanOperationId
    const claimPlanOperationId =
      options?.foreignPlanWitness === "Claim" ? foreignPlanOperationId : attemptPlanOperationId
    const graphOperation = makeTrackerGraphObservationOperation(
      { _tag: "AttemptContinuation" },
      OperationId.make("continuation-current-graph"),
      trackerReadTarget,
      [graphPlanOperationId],
      options?.graphMissingExplicitCoverage === true ? [] : [taskId]
    )
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("continuation-current-specification"),
      trackerReadTarget,
      taskId,
      [specificationPlanOperationId, graphOperation.operationId]
    )
    const claimOperation = makeTaskClaimObservationOperation(
      OperationId.make("continuation-current-claim"),
      trackerReadTarget,
      taskId,
      [claimPlanOperationId, graphOperation.operationId, specificationOperation.operationId]
    )
    const worktreeOperation = makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("continuation-current-worktree"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("continuation-current-lineage"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const witness = {
      activeTaskContinuationRead: {
        graphObservationOperationId: graphOperation.operationId,
        taskClaimObservationOperationId: claimOperation.operationId,
        taskWorkSpecificationObservationOperationId: specificationOperation.operationId
      },
      targetLineageObservationOperationId: lineageOperation.operationId,
      worktreeObservationOperationId: worktreeOperation.operationId
    }
    if (hasForeignPlan) {
      append(
        attemptPlanRecordKey(foreignPlanAttempt.attemptId),
        TaskAttemptPlannedEvent.make({
          operation: makeTaskAttemptPlanOperation({
            operationId: foreignPlanOperationId,
            plannedAttempt: foreignPlanAttempt,
            predecessorOperationIds: [activeClaim.operationId]
          }),
          version: workflowJournalEventVersion
        })
      )
    }
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    })
    const safe = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    })
    if (options?.acceptedExecuting !== true) {
      const suspendOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
      append(
        plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Suspend",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: suspendOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      append(
        plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, suspendOrdinal),
        PlannedAttemptExecutorCommandResponseObservedEvent.make({
          commandOrdinal: suspendOrdinal,
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt,
          report: safe,
          version: workflowJournalEventVersion
        })
      )
      const safeOrdinal = PlannedAttemptExecutorReportOrdinal.make(2)
      append(
        plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, safeOrdinal),
        PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: safeOrdinal,
          report: safe,
          version: workflowJournalEventVersion
        })
      )
    }
    if (options?.continueObservedSpecification !== undefined) {
      const observedSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("continuation-choice-observed-specification"),
        trackerReadTarget,
        taskId,
        [attemptPlanOperationId]
      )
      append(
        intentRecordKey(observedSpecificationOperation.operationId),
        taskTrackerReadIntent(observedSpecificationOperation)
      )
      append(
        outcomeRecordKey(observedSpecificationOperation.operationId),
        taskTrackerFactsObservedEvent(
          observedSpecificationOperation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(
            observedSpecificationOperation,
            options.continueObservedSpecification
          )
        )
      )
      const requestId = AttemptChoiceRequestId.make({ nonce: "continuation-exact-changed-facts", runId })
      append(
        attemptChoiceAppliedRecordKey(requestId),
        AttemptChoiceAppliedEvent.make({
          choice: "ContinueExistingAttempt",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId,
          subject: { observedTaskRevision: options.continueObservedSpecification.fingerprint, plannedAttempt },
          version: workflowJournalEventVersion
        })
      )
    }
    append(intentRecordKey(graphOperation.operationId), taskTrackerReadIntent(graphOperation))
    append(
      outcomeRecordKey(graphOperation.operationId),
      taskTrackerGraphFactsObserved(graphOperation, {
        revision: TrackerRevision.make("continuation-current-graph"),
        taskIds: options?.graphOmitsTask === true ? [] : [taskId]
      })
    )
    const selectedSpecification =
      options?.currentSpecification ??
      (options?.specificationMismatch === true
        ? makeTaskWorkSpecification({ body: "Superseding instructions", taskId, title: "Superseding task" })
        : (options?.continueObservedSpecification ?? specification))
    append(intentRecordKey(specificationOperation.operationId), taskTrackerReadIntent(specificationOperation))
    append(
      outcomeRecordKey(specificationOperation.operationId),
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, selectedSpecification)
      )
    )
    append(intentRecordKey(claimOperation.operationId), taskTrackerReadIntent(claimOperation))
    append(
      outcomeRecordKey(claimOperation.operationId),
      taskTrackerFactsObservedEvent(
        claimOperation.operationId,
        makeFocusedTaskClaimFactsObserved(claimOperation, activeClaim)
      )
    )
    append(
      intentRecordKey(worktreeOperation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: worktreeOperation,
        version: workflowJournalEventVersion
      })
    )
    const exactWorktree = PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    })
    append(
      outcomeRecordKey(worktreeOperation.operationId),
      PlannedAttemptWorktreeObservedEvent.make({
        observation: exactWorktree,
        occurrenceClassification: "NonActionOccurrence",
        operationId: worktreeOperation.operationId,
        version: workflowJournalEventVersion
      })
    )
    append(
      intentRecordKey(lineageOperation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    )
    const exactLineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: plannedAttempt.baseSha,
      targetHeadSha: plannedAttempt.baseSha
    })
    append(
      outcomeRecordKey(lineageOperation.operationId),
      TargetLineageObservedEvent.make({
        observation: exactLineage,
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )

    const supersededBy = options?.supersededBy
    if (supersededBy === "Graph") {
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        OperationId.make("continuation-later-graph"),
        trackerReadTarget,
        [attemptPlanOperationId],
        [taskId]
      )
      append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      append(
        outcomeRecordKey(operation.operationId),
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("continuation-later-graph"),
          taskIds: [taskId]
        })
      )
    }
    if (supersededBy === "Specification") {
      const operation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("continuation-later-specification"),
        trackerReadTarget,
        taskId,
        [attemptPlanOperationId]
      )
      append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      append(
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeFocusedTaskWorkSpecificationFactsObserved(operation, specification)
        )
      )
    }
    if (supersededBy === "Claim") {
      const operation = makeTaskClaimObservationOperation(
        OperationId.make("continuation-later-claim"),
        trackerReadTarget,
        taskId,
        [attemptPlanOperationId]
      )
      append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      append(
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(operation.operationId, makeFocusedTaskClaimFactsObserved(operation, activeClaim))
      )
    }
    if (supersededBy === "Worktree") {
      const operation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("continuation-later-worktree"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      append(
        intentRecordKey(operation.operationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation,
          version: workflowJournalEventVersion
        })
      )
      append(
        outcomeRecordKey(operation.operationId),
        PlannedAttemptWorktreeObservedEvent.make({
          observation: exactWorktree,
          occurrenceClassification: "NonActionOccurrence",
          operationId: operation.operationId,
          version: workflowJournalEventVersion
        })
      )
    }
    if (supersededBy === "Lineage") {
      const operation = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make("continuation-later-lineage"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      append(
        intentRecordKey(operation.operationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation,
          version: workflowJournalEventVersion
        })
      )
      append(
        outcomeRecordKey(operation.operationId),
        TargetLineageObservedEvent.make({
          observation: exactLineage,
          occurrenceClassification: "NonActionOccurrence",
          operationId: operation.operationId,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
    }
    if (supersededBy === "Executor") {
      const ordinal = PlannedAttemptExecutorCommandOrdinal.make(3)
      append(
        plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal),
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "Resume",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      append(
        plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, ordinal),
        PlannedAttemptExecutorCommandResponseObservedEvent.make({
          commandOrdinal: ordinal,
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt,
          report: executing,
          version: workflowJournalEventVersion
        })
      )
    }
    if (options?.trackerRefresh !== undefined) {
      const refresh = options.trackerRefresh
      const family = refresh.startsWith("Graph")
        ? "Graph"
        : refresh.startsWith("Specification")
          ? "Specification"
          : "Claim"
      const operation =
        family === "Graph"
          ? makeTrackerGraphObservationOperation(
              { _tag: "AttemptContinuation" },
              OperationId.make(`continuation-refresh-${refresh.toLowerCase()}`),
              trackerReadTarget,
              [attemptPlanOperationId],
              [taskId]
            )
          : family === "Specification"
            ? makeTaskWorkSpecificationObservationOperation(
                OperationId.make(`continuation-refresh-${refresh.toLowerCase()}`),
                trackerReadTarget,
                taskId,
                [attemptPlanOperationId]
              )
            : makeTaskClaimObservationOperation(
                OperationId.make(`continuation-refresh-${refresh.toLowerCase()}`),
                trackerReadTarget,
                taskId,
                [attemptPlanOperationId]
              )
      append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      if (refresh === "GraphFailed") {
        append(
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(
            operation.operationId,
            TaskTrackerFactsReadFailed.make({
              completeness: "Unreadable",
              failure: { _tag: "FixtureReadError", detail: `refresh ${refresh} failed` },
              operationId: operation.operationId,
              target: trackerReadTarget
            })
          )
        )
      } else if (refresh === "ClaimUnreadable") {
        const claimOperation = makeTaskClaimObservationOperation(operation.operationId, trackerReadTarget, taskId)
        append(
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(operation.operationId, makeFocusedTaskClaimFactsUnreadable(claimOperation))
        )
      }
    }
    if (options?.foreignTrackerRead === true) {
      const foreignTaskId = TaskId.make("foreign-continuation-task")
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        OperationId.make("continuation-foreign-graph"),
        trackerReadTarget,
        [attemptPlanOperationId],
        [foreignTaskId]
      )
      append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      append(
        outcomeRecordKey(operation.operationId),
        taskTrackerGraphFactsObserved(operation, {
          revision: TrackerRevision.make("continuation-foreign-graph"),
          taskIds: [foreignTaskId]
        })
      )
    }
    if (options?.foreignPlanLaterRead !== undefined) {
      const family = options.foreignPlanLaterRead
      if (family === "Graph") {
        const operation = makeTrackerGraphObservationOperation(
          { _tag: "AttemptContinuation" },
          OperationId.make("continuation-foreign-plan-later-graph"),
          trackerReadTarget,
          [foreignPlanOperationId],
          [taskId]
        )
        append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        append(
          outcomeRecordKey(operation.operationId),
          taskTrackerGraphFactsObserved(operation, {
            revision: TrackerRevision.make("continuation-foreign-plan-later-graph"),
            taskIds: [taskId]
          })
        )
      } else if (family === "Specification") {
        const operation = makeTaskWorkSpecificationObservationOperation(
          OperationId.make("continuation-foreign-plan-later-specification"),
          trackerReadTarget,
          taskId,
          [foreignPlanOperationId]
        )
        append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        append(
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(
            operation.operationId,
            makeFocusedTaskWorkSpecificationFactsObserved(operation, specification)
          )
        )
      } else {
        const operation = makeTaskClaimObservationOperation(
          OperationId.make("continuation-foreign-plan-later-claim"),
          trackerReadTarget,
          taskId,
          [foreignPlanOperationId]
        )
        append(intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        append(
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(
            operation.operationId,
            makeFocusedTaskClaimFactsObserved(operation, activeClaim)
          )
        )
      }
    }
    if (options?.safeConsumed === true || options?.unsettledCommand === true) {
      const ordinal = PlannedAttemptExecutorCommandOrdinal.make(3)
      const command = options.safeConsumed === true ? "Resume" : "Suspend"
      append(
        plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal),
        PlannedAttemptExecutorCommandIntendedEvent.make({
          command,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      if (options.safeConsumed === true) {
        append(
          plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, ordinal),
          PlannedAttemptExecutorCommandResponseObservedEvent.make({
            commandOrdinal: ordinal,
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt,
            report: safe,
            version: workflowJournalEventVersion
          })
        )
      }
    }
    return { records, witness }
  }

  it("authorizes the immutable attempt after Continue accepts its exact changed specification", () => {
    const changedSpecification = makeTaskWorkSpecification({
      body: "Accepted changed instructions",
      taskId,
      title: "Accepted changed task"
    })
    const fixture = continuationAuthorizationRecords({ continueObservedSpecification: changedSpecification })

    expect(evaluatePlannedAttemptContinuationAuthorization(fixture.records, plannedAttempt, fixture.witness)).toEqual({
      _tag: "Authorized"
    })
    const laterExecutorObservation = JournalPosition.make(fixture.records.length + 10)
    expect(
      continuationTaskAuthorityFor(fixture.records, plannedAttempt, fixture.witness, laterExecutorObservation)
        .freshnessBaseline
    ).toBe(laterExecutorObservation)
  })

  it("rejects a later specification not named by the applied Continue choice", () => {
    const acceptedSpecification = makeTaskWorkSpecification({
      body: "Accepted changed instructions",
      taskId,
      title: "Accepted changed task"
    })
    const laterSpecification = makeTaskWorkSpecification({
      body: "Later unaccepted instructions",
      taskId,
      title: "Later unaccepted task"
    })
    const fixture = continuationAuthorizationRecords({
      continueObservedSpecification: acceptedSpecification,
      currentSpecification: laterSpecification
    })

    expect(
      evaluatePlannedAttemptContinuationAuthorization(fixture.records, plannedAttempt, fixture.witness)
    ).toMatchObject({ _tag: "Rejected", reason: "WrongAttemptWitness", witness: "ActiveTaskContinuationSpecification" })
  })

  it("authorizes the unchanged planned revision after an earlier changed-revision Continue", () => {
    const changedSpecification = makeTaskWorkSpecification({
      body: "Previously accepted changed instructions",
      taskId,
      title: "Previously accepted changed task"
    })
    const fixture = continuationAuthorizationRecords({
      continueObservedSpecification: changedSpecification,
      currentSpecification: specification
    })

    expect(evaluatePlannedAttemptContinuationAuthorization(fixture.records, plannedAttempt, fixture.witness)).toEqual({
      _tag: "Authorized"
    })
  })

  it("rejects an earlier current-revision Continue superseded by a later choice for another revision", () => {
    const acceptedSpecification = makeTaskWorkSpecification({
      body: "Accepted changed instructions",
      taskId,
      title: "Accepted changed task"
    })
    const anotherSpecification = makeTaskWorkSpecification({
      body: "Another accepted revision",
      taskId,
      title: "Another accepted task"
    })
    const fixture = continuationAuthorizationRecords({ continueObservedSpecification: acceptedSpecification })
    const graphIntentIndex = fixture.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation.operationId === fixture.witness.activeTaskContinuationRead.graphObservationOperationId
    )
    const graphIntent = fixture.records[graphIntentIndex]
    if (graphIntent === undefined) return expect.fail("fixture lacks its continuation graph intent")
    const requestId = AttemptChoiceRequestId.make({ nonce: "continuation-another-changed-revision", runId })
    const anotherChoice: JournalRecord = {
      event: AttemptChoiceAppliedEvent.make({
        choice: "ContinueExistingAttempt",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject: { observedTaskRevision: anotherSpecification.fingerprint, plannedAttempt },
        version: workflowJournalEventVersion
      }),
      key: attemptChoiceAppliedRecordKey(requestId),
      position: graphIntent.position,
      runId
    }
    const records = [
      ...fixture.records.slice(0, graphIntentIndex),
      anotherChoice,
      ...fixture.records
        .slice(graphIntentIndex)
        .map((record) => ({ ...record, position: JournalPosition.make(record.position + 1) }))
    ]

    expect(evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, fixture.witness)).toMatchObject({
      _tag: "Rejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationSpecification"
    })
  })

  it("rejects continuation facts collected before the applied Continue choice", () => {
    const changedSpecification = makeTaskWorkSpecification({
      body: "Accepted changed instructions",
      taskId,
      title: "Accepted changed task"
    })
    const fixture = continuationAuthorizationRecords({ continueObservedSpecification: changedSpecification })
    const choiceIndex = fixture.records.findIndex(({ event }) => event._tag === "AttemptChoiceApplied")
    const choice = fixture.records[choiceIndex]
    if (choice?.event._tag !== "AttemptChoiceApplied") return expect.fail("fixture lacks its Continue choice")
    const records = fixture.records
      .toSpliced(choiceIndex, 1)
      .concat({ ...choice, position: JournalPosition.make(fixture.records.length + 1) })

    expect(evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, fixture.witness)).toMatchObject({
      _tag: "Rejected",
      reason: "StaleWitness",
      witness: "ActiveTaskContinuationGraph"
    })
  })

  it("rejects changed continuation facts authorized for another attempt", () => {
    const changedSpecification = makeTaskWorkSpecification({
      body: "Accepted changed instructions",
      taskId,
      title: "Accepted changed task"
    })
    const fixture = continuationAuthorizationRecords({ continueObservedSpecification: changedSpecification })
    const choiceIndex = fixture.records.findIndex(({ event }) => event._tag === "AttemptChoiceApplied")
    const choice = fixture.records[choiceIndex]
    if (choice?.event._tag !== "AttemptChoiceApplied") return expect.fail("fixture lacks its Continue choice")
    const foreignAttempt = PlannedTaskAttempt.make({
      ...plannedAttempt,
      attemptId: AttemptId.make("continuation-choice-foreign-attempt")
    })
    const records = fixture.records.with(choiceIndex, {
      ...choice,
      event: AttemptChoiceAppliedEvent.make({
        ...choice.event,
        subject: { ...choice.event.subject, plannedAttempt: foreignAttempt }
      })
    })

    expect(evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, fixture.witness)).toMatchObject({
      _tag: "Rejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationSpecification"
    })
  })

  effectIt.effect("releases a reserved task position after the adapter records a proof-based Stop", () =>
    Effect.gen(function* () {
      const observedSpecification = makeTaskWorkSpecification({
        body: "Operator-observed Stop instructions",
        taskId,
        title: "Operator-observed Stop task"
      })
      const fixture = continuationAuthorizationRecords({ continueObservedSpecification: observedSpecification })
      const stopPrefix = fixture.records
        .filter(({ event }) => event._tag !== "AttemptChoiceApplied")
        .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
      const stopRequestId = AttemptChoiceRequestId.make({ nonce: "adapter-stop-release", runId })
      const stopSubject = { observedTaskRevision: observedSpecification.fingerprint, plannedAttempt }
      const harness = yield* makeLiveJournalHarness([
        ...stopPrefix,
        {
          event: AttemptChoiceAppliedEvent.make({
            choice: "StopTaskImplementation",
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            requestId: stopRequestId,
            subject: stopSubject,
            version: workflowJournalEventVersion
          }),
          key: attemptChoiceAppliedRecordKey(stopRequestId),
          position: JournalPosition.make(stopPrefix.length + 1),
          runId
        }
      ])
      const transition = RunnableFrontierTransition.AdvanceAttemptStoppage({
        requestId: stopRequestId,
        subject: stopSubject,
        taskWorkPosition: "ReserveOrReuse"
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing proof-based Stop adapter proposal")
      }
      const releases = yield* Ref.make(0)
      const controller = yield* makePlannedAttemptProtocolController()
      const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
        ...inertLease,
        releasePlannedAttemptPosition: () => Ref.update(releases, (count) => count + 1),
        withPlannedAttemptProtocol: (correlation, effect) => controller.withPermit(correlation, effect)
      }).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
      )

      expect(result).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(yield* Ref.get(releases)).toBe(1)
      const recordsAfterStop = yield* harness.records
      const abandonedRecordsAfterStop = recordsAfterStop.filter(
        ({ event }) => event._tag === "AttemptImplementationAbandoned"
      )
      expect(abandonedRecordsAfterStop).toHaveLength(1)
      const durableRecordCountAfterStop = recordsAfterStop.length

      const observationTransition = RunnableFrontierTransition.ObserveAttemptStoppageExecutor({
        requestId: stopRequestId,
        subject: stopSubject
      })
      const observationProposal = proposalsFor(observationTransition).proposals[0]
      if (observationProposal === undefined || !isIdentityFreeProposal(observationProposal)) {
        return yield* Effect.die("missing replayed Stop observation proposal")
      }
      const observationResult = yield* executePlannedAttemptTransition(
        { _tag: "IdentityFreeAction", proposal: observationProposal },
        observationTransition,
        {
          ...inertLease,
          releasePlannedAttemptPosition: () => Ref.update(releases, (count) => count + 1),
          withPlannedAttemptProtocol: (correlation, effect) => controller.withPermit(correlation, effect)
        }
      ).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
      )
      expect(observationResult).toMatchObject({ _tag: "ActionCompleted", proposalId: observationProposal.id })
      expect(yield* Ref.get(releases)).toBe(2)
      const recordsAfterReplay = yield* harness.records
      expect(recordsAfterReplay).toHaveLength(durableRecordCountAfterStop)
      expect(recordsAfterReplay.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(
        abandonedRecordsAfterStop.length
      )
    })
  )

  effectIt.effect("rejects a recovered continuation without current witnesses before executor contact", () =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ResumePlannedAttemptExecutorWorkAfterCurrentFacts({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt,
        witness: {
          activeTaskContinuationRead: {
            graphObservationOperationId: OperationId.make("missing-current-graph"),
            taskClaimObservationOperationId: OperationId.make("missing-current-claim"),
            taskWorkSpecificationObservationOperationId: OperationId.make("missing-current-specification")
          },
          targetLineageObservationOperationId: OperationId.make("missing-current-target-lineage"),
          worktreeObservationOperationId: OperationId.make("missing-current-worktree")
        }
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing current-facts continuation proposal")
      }
      expect(proposal.admission.taskWorkPosition).toEqual({
        _tag: "TaskWorkPositionRequired",
        mode: "ReserveOrReuse",
        taskId
      })
      const executorContacts = yield* Ref.make(0)
      const protocolController = yield* makePlannedAttemptProtocolController()
      const lease: DeliveryActionExecutionLease = {
        ...inertLease,
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }
      const harness = yield* makeLiveJournalHarness(continuationAuthorizationRecords().records)
      const failure = yield* executePlannedAttemptTransition(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        lease
      ).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.die("rejected resume must not observe executor state"),
            requestSuspension: () => Effect.die("rejected resume must not request suspension"),
            begin: () => Effect.die("rejected resume must not begin executor work"),
            resume: () =>
              Ref.update(executorContacts, (count) => count + 1).pipe(Effect.andThen(Effect.die("unreachable")))
          })
        ),
        Effect.flip
      )

      expect(failure).toMatchObject({
        _tag: "PlannedAttemptContinuationAuthorizationRejected",
        reason: "MissingWitness",
        witness: "ActiveTaskContinuationGraph"
      })
      expect(yield* Ref.get(executorContacts)).toBe(0)
    })
  )

  effectIt.effect("resumes only from accepted safe work and the exact current tracker and Git facts", () =>
    Effect.gen(function* () {
      for (const fixture of [
        continuationAuthorizationRecords(),
        continuationAuthorizationRecords({ foreignTrackerRead: true })
      ]) {
        const transition = RunnableFrontierTransition.ResumePlannedAttemptExecutorWorkAfterCurrentFacts({
          acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(2) },
          plannedAttempt,
          witness: fixture.witness
        })
        const proposal = proposalsFor(transition).proposals[0]
        if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
          return yield* Effect.die("missing exact current-facts continuation proposal")
        }
        const harness = yield* makeLiveJournalHarness(fixture.records)
        const resumeRequests = yield* Ref.make<ReadonlyArray<PlannedAttemptExecutorRequest>>([])
        const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        })
        const protocolController = yield* makePlannedAttemptProtocolController()
        const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
          ...inertLease,
          withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
        }).pipe(
          (effect) => provideLiveJournal(effect, harness),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              observe: () => Effect.die("settled continuation must not observe executor state"),
              requestSuspension: () => Effect.die("continuation must not request suspension"),
              begin: () => Effect.die("continuation must not begin executor work"),
              resume: (request) =>
                Ref.update(resumeRequests, (current) => [...current, request]).pipe(Effect.as(executing))
            })
          )
        )

        expect(result).toMatchObject({ _tag: "ExecutorReportPublished", report: executing })
        expect(yield* Ref.get(resumeRequests)).toEqual([
          expect.objectContaining({
            plannedAttempt: expect.objectContaining({
              attemptId: plannedAttempt.attemptId,
              runId: plannedAttempt.runId
            })
          })
        ])
        expect(
          (yield* harness.records).flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
          )
        ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended", "ExecutorWorkExecuting"])
      }

      for (const foreignPlanLaterRead of ["Graph", "Specification", "Claim"] as const) {
        const fixture = continuationAuthorizationRecords({ foreignPlanLaterRead })
        expect(
          evaluatePlannedAttemptContinuationAuthorization(fixture.records, plannedAttempt, fixture.witness),
          `unrelated ${foreignPlanLaterRead} plan evidence`
        ).toMatchObject({ _tag: "Authorized" })
      }
    })
  )

  effectIt.effect("coalesces an exact continuation authorization append on redelivery", () =>
    Effect.gen(function* () {
      const fixture = continuationAuthorizationRecords()
      const harness = yield* makeLiveJournalHarness(fixture.records)
      const controller = yield* makePlannedAttemptProtocolController()
      const permit = yield* controller.reserve(plannedAttemptExecutorCorrelation(plannedAttempt))
      if (Option.isNone(permit)) return yield* Effect.die("continuation authorization permit was not available")
      const baseJournal = harness.journal
      const appendEntered = yield* Deferred.make<void>()
      const allowAppend = yield* Deferred.make<void>()
      const journal = InRunJournal.of({
        append: (requestedRunId, key, event) =>
          event._tag === "PlannedAttemptContinuationAuthorized"
            ? Deferred.succeed(appendEntered, undefined).pipe(
                Effect.andThen(Deferred.await(allowAppend)),
                Effect.andThen(baseJournal.append(requestedRunId, key, event))
              )
            : baseJournal.append(requestedRunId, key, event),
        read: baseJournal.read
      })
      const authorization = yield* authorizePlannedAttemptContinuationWithPermit(
        permit.value,
        plannedAttempt,
        fixture.witness
      ).pipe((effect) => provideLiveJournal(effect, harness, journal), Effect.forkChild)
      yield* Deferred.await(appendEntered)

      const concurrent = yield* baseJournal.append(
        runId,
        plannedAttemptContinuationAuthorizedRecordKey(plannedAttempt.attemptId, fixture.witness),
        PlannedAttemptContinuationAuthorizedEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion,
          witness: fixture.witness
        })
      )
      yield* Deferred.succeed(allowAppend, undefined)
      const result = yield* Fiber.join(authorization)

      expect(result).toEqual(concurrent)
      expect(
        (yield* harness.records).filter(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized")
      ).toHaveLength(1)
      yield* permit.value.release
    })
  )

  effectIt.effect("authorizes exact continuation facts through the shared controller entrypoint", () =>
    Effect.gen(function* () {
      const fixture = continuationAuthorizationRecords()
      const harness = yield* makeLiveJournalHarness(fixture.records)
      const controller = yield* makePlannedAttemptProtocolController()
      const authorize = authorizePlannedAttemptContinuation(plannedAttempt, fixture.witness).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(PlannedAttemptProtocolController, controller)
      )

      const first = yield* authorize
      const second = yield* authorize

      expect(second).toEqual(first)
      expect(
        (yield* harness.records).filter(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized")
      ).toHaveLength(1)
    })
  )

  effectIt.effect("cancels continuation authorization when a terminal choice wins before its append", () =>
    Effect.gen(function* () {
      const changedSpecification = makeTaskWorkSpecification({
        body: "Stop this implementation after observing changed work.",
        taskId,
        title: "Changed continuation work"
      })
      const fixture = continuationAuthorizationRecords({ currentSpecification: changedSpecification })
      const transition = RunnableFrontierTransition.ResumePlannedAttemptExecutorWorkAfterCurrentFacts({
        acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(2) },
        plannedAttempt,
        witness: fixture.witness
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing append-boundary continuation proposal")
      }
      const harness = yield* makeLiveJournalHarness(fixture.records)
      const releasedPositions = yield* Ref.make<ReadonlyArray<PlannedAttemptExecutorCorrelation>>([])
      const resumeContacts = yield* Ref.make(0)
      const terminalEntered = yield* Deferred.make<void>()
      const finishTerminal = yield* Deferred.make<void>()
      const requestId = AttemptChoiceRequestId.make({ nonce: "continuation-race-stop", runId })
      const choice = AttemptChoiceAppliedEvent.make({
        choice: "StopTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject: { observedTaskRevision: changedSpecification.fingerprint, plannedAttempt },
        version: workflowJournalEventVersion
      })
      const controller = yield* makePlannedAttemptProtocolController()
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const terminal = yield* controller
        .withTerminalPermit(correlation, () =>
          harness.journal
            .append(runId, attemptChoiceAppliedRecordKey(requestId), choice)
            .pipe(
              Effect.andThen(Deferred.succeed(terminalEntered, undefined)),
              Effect.andThen(Deferred.await(finishTerminal))
            )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(terminalEntered)
      const execution = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
        ...inertLease,
        releasePlannedAttemptPosition: (released) => Ref.update(releasedPositions, (current) => [...current, released]),
        withPlannedAttemptProtocol: (exactCorrelation, effect) => controller.withPermit(exactCorrelation, effect)
      }).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.die("terminal choice race must not observe executor state"),
            requestSuspension: () => Effect.die("terminal choice race must not suspend executor state"),
            begin: () => Effect.die("terminal choice race must not begin executor state"),
            resume: () =>
              Ref.update(resumeContacts, (count) => count + 1).pipe(Effect.andThen(Effect.die("Resume contacted")))
          })
        ),
        Effect.forkChild
      )
      yield* Deferred.succeed(finishTerminal, undefined)
      const result = yield* Fiber.join(execution)
      yield* Fiber.join(terminal)

      expect(result).toMatchObject({ _tag: "ActionDeferred", reason: "ContinuationAuthorizationStale" })
      expect(yield* Ref.get(releasedPositions)).toEqual([correlation])
      expect(yield* Ref.get(resumeContacts)).toBe(0)
      expect(
        (yield* harness.records).some(
          ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
        )
      ).toBe(false)
      expect((yield* harness.records).some(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized")).toBe(
        false
      )
    })
  )

  it("rejects a malformed terminal choice after continuation authorization before Resume intent", () => {
    const fixture = continuationAuthorizationRecords()
    const authorization = PlannedAttemptContinuationAuthorizedEvent.make({
      plannedAttempt,
      version: workflowJournalEventVersion,
      witness: fixture.witness
    })
    const requestId = AttemptChoiceRequestId.make({ nonce: "continuation-after-authorization", runId })
    const choice = AttemptChoiceAppliedEvent.make({
      choice: "StopTaskImplementation",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject: { observedTaskRevision: TaskRevision.make("continuation-after-authorization-revision"), plannedAttempt },
      version: workflowJournalEventVersion
    })
    const records = [
      ...fixture.records,
      {
        event: authorization,
        key: plannedAttemptContinuationAuthorizedRecordKey(plannedAttempt.attemptId, fixture.witness),
        position: JournalPosition.make(fixture.records.length + 1),
        runId
      },
      {
        event: choice,
        key: attemptChoiceAppliedRecordKey(requestId),
        position: JournalPosition.make(fixture.records.length + 2),
        runId
      }
    ]

    expect(reduceWorkflowJournalHistory(runId, records)).toMatchObject({ _tag: "InvalidWorkflowJournalHistory" })
    expect(
      records.some(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume")
    ).toBe(false)
  })

  effectIt.effect("never contacts Resume for invalid or superseded continuation authority", () =>
    Effect.gen(function* () {
      type InvalidContinuationCase = {
        readonly expected:
          | "AcceptedSafeExecutorReport"
          | "ActiveTaskContinuationGraph"
          | "ActiveTaskContinuationSpecification"
          | "ActiveTaskContinuationClaim"
          | "Stale"
        readonly name: string
        readonly options: Parameters<typeof continuationAuthorizationRecords>[0]
      }
      const cases: ReadonlyArray<InvalidContinuationCase> = [
        {
          expected: "AcceptedSafeExecutorReport",
          name: "latest accepted report is executing",
          options: { acceptedExecuting: true }
        },
        {
          expected: "ActiveTaskContinuationGraph",
          name: "current graph omits the task",
          options: { graphOmitsTask: true }
        },
        {
          expected: "ActiveTaskContinuationGraph",
          name: "current graph omits explicit task coverage",
          options: { graphMissingExplicitCoverage: true }
        },
        {
          expected: "ActiveTaskContinuationGraph",
          name: "current graph is attached to a same-task foreign plan",
          options: { foreignPlanWitness: "Graph" }
        },
        {
          expected: "ActiveTaskContinuationGraph",
          name: "current witness target differs from immutable Run target",
          options: {
            immutableRunTarget: target,
            trackerReadTarget: FixtureTarget.make("route-matrix-foreign-read-target")
          }
        },
        {
          expected: "ActiveTaskContinuationSpecification",
          name: "current specification has another fingerprint",
          options: { specificationMismatch: true }
        },
        {
          expected: "ActiveTaskContinuationSpecification",
          name: "current specification is attached to a same-task foreign plan",
          options: { foreignPlanWitness: "Specification" }
        },
        {
          expected: "ActiveTaskContinuationClaim",
          name: "current claim is attached to a same-task foreign plan",
          options: { foreignPlanWitness: "Claim" }
        },
        { expected: "Stale", name: "later graph evidence", options: { supersededBy: "Graph" } },
        { expected: "Stale", name: "later graph read remains pending", options: { trackerRefresh: "GraphPending" } },
        { expected: "Stale", name: "later graph read failed", options: { trackerRefresh: "GraphFailed" } },
        {
          expected: "Stale",
          name: "later specification read remains pending",
          options: { trackerRefresh: "SpecificationPending" }
        },
        { expected: "Stale", name: "later claim read remains pending", options: { trackerRefresh: "ClaimPending" } },
        { expected: "Stale", name: "later claim read is unreadable", options: { trackerRefresh: "ClaimUnreadable" } },
        { expected: "Stale", name: "later specification evidence", options: { supersededBy: "Specification" } },
        { expected: "Stale", name: "later claim evidence", options: { supersededBy: "Claim" } },
        { expected: "Stale", name: "later worktree evidence", options: { supersededBy: "Worktree" } },
        { expected: "Stale", name: "later target-lineage evidence", options: { supersededBy: "Lineage" } },
        { expected: "Stale", name: "later executor evidence", options: { supersededBy: "Executor" } },
        { expected: "Stale", name: "accepted safe report was consumed", options: { safeConsumed: true } },
        { expected: "Stale", name: "executor command remains unsettled", options: { unsettledCommand: true } }
      ]

      for (const testCase of cases) {
        const fixture = continuationAuthorizationRecords(testCase.options)
        const reduced = reduceWorkflowJournalHistory(runId, fixture.records)
        if (reduced._tag === "InvalidWorkflowJournalHistory") {
          const evaluation = evaluatePlannedAttemptContinuationAuthorization(
            fixture.records,
            plannedAttempt,
            fixture.witness
          )
          if (testCase.options?.unsettledCommand === true) {
            expect(evaluation, testCase.name).toMatchObject({
              _tag: "Rejected",
              reason: "StaleWitness",
              witness: "AcceptedSafeExecutorReport"
            })
          } else if (testCase.expected === "Stale") {
            expect(evaluation, testCase.name).toMatchObject({ _tag: "Stale" })
          } else {
            expect(evaluation, testCase.name).toMatchObject({
              _tag: "Rejected",
              reason: "WrongAttemptWitness",
              witness: testCase.expected
            })
          }
          continue
        }
        const transition = RunnableFrontierTransition.ResumePlannedAttemptExecutorWorkAfterCurrentFacts({
          acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(2) },
          plannedAttempt,
          witness: fixture.witness
        })
        const proposal = proposalsFor(transition).proposals[0]
        if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
          return yield* Effect.die(`missing invalid continuation proposal for ${testCase.name}`)
        }
        const harness = yield* makeLiveJournalHarness(fixture.records)
        const recordCountBeforeExecution = fixture.records.length
        const executorContacts = yield* Ref.make(0)
        const protocolController = yield* makePlannedAttemptProtocolController()
        const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
          ...inertLease,
          withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
        }).pipe(
          (effect) => provideLiveJournal(effect, harness),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              observe: () => Effect.die(`invalid continuation ${testCase.name} must not observe executor state`),
              requestSuspension: () => Effect.die(`invalid continuation ${testCase.name} must not request suspension`),
              begin: () => Effect.die(`invalid continuation ${testCase.name} must not begin executor work`),
              resume: () =>
                Ref.update(executorContacts, (count) => count + 1).pipe(
                  Effect.andThen(Effect.die(`invalid continuation ${testCase.name} contacted Resume`))
                )
            })
          ),
          Effect.catchTag("PlannedAttemptContinuationAuthorizationRejected", (rejection) => Effect.succeed(rejection))
        )

        if (testCase.expected === "Stale") {
          expect(result, testCase.name).toMatchObject({
            _tag: "ActionDeferred",
            reason: "ContinuationAuthorizationStale"
          })
        } else {
          expect(result, testCase.name).toMatchObject({
            _tag: "PlannedAttemptContinuationAuthorizationRejected",
            reason: "WrongAttemptWitness",
            witness: testCase.expected
          })
        }
        expect(yield* Ref.get(executorContacts), testCase.name).toBe(0)
        expect((yield* harness.records).length, testCase.name).toBe(recordCountBeforeExecution)
      }
    })
  )

  it("rejects a failed current graph witness before continuation authorization", () => {
    const fixture = continuationAuthorizationRecords()
    const graphOutcomeIndex = fixture.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.operationId === fixture.witness.activeTaskContinuationRead.graphObservationOperationId
    )
    const graphOutcome = fixture.records[graphOutcomeIndex]
    if (graphOutcome?.event._tag !== "TaskTrackerFactsObserved") return expect.fail("test fixture lacks graph outcome")
    const failedGraph = TaskTrackerFactsReadFailed.make({
      completeness: "Unreadable",
      failure: { _tag: "FixtureReadError", detail: "current graph failed" },
      operationId: graphOutcome.event.operationId,
      target: graphOutcome.event.observation.target
    })
    const records = fixture.records.with(graphOutcomeIndex, {
      ...graphOutcome,
      event: TaskTrackerFactsObservedEvent.make({
        operationId: graphOutcome.event.operationId,
        observation: failedGraph,
        version: workflowJournalEventVersion
      })
    })
    expect(evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, fixture.witness)).toMatchObject({
      _tag: "Rejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationGraph"
    })
  })

  effectIt.effect("defers a recovered continuation when newer executor evidence makes its witnesses stale", () =>
    Effect.gen(function* () {
      const fixture = continuationAuthorizationRecords({ supersededBy: "Executor" })
      const witness = fixture.witness
      const transition = RunnableFrontierTransition.ResumePlannedAttemptExecutorWorkAfterCurrentFacts({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt,
        witness
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing stale current-facts continuation proposal")
      }
      const harness = yield* makeLiveJournalHarness(fixture.records)
      const executorContacts = yield* Ref.make(0)
      const protocolController = yield* makePlannedAttemptProtocolController()
      const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
        ...inertLease,
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.die("stale resume must not observe executor state"),
            requestSuspension: () => Effect.die("stale resume must not request suspension"),
            begin: () => Effect.die("stale resume must not begin executor work"),
            resume: () =>
              Ref.update(executorContacts, (count) => count + 1).pipe(Effect.andThen(Effect.die("unreachable")))
          })
        )
      )

      expect(result).toMatchObject({ _tag: "ActionDeferred", reason: "ContinuationAuthorizationStale" })
      expect(yield* Ref.get(executorContacts)).toBe(0)
    })
  )

  effectIt.effect("reconciles executor state after an ambiguous Begin response", () =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing executor observation proposal")
      }
      const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      })
      const beginOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
      const responseIndex = acceptedExecutingExecutorRecords().findIndex(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved"
      )
      if (responseIndex < 0) return yield* Effect.die("accepted executing history lacks its Begin response")
      const harness = yield* makeLiveJournalHarness(acceptedExecutingExecutorRecords().slice(0, responseIndex))
      const protocolController = yield* makePlannedAttemptProtocolController()
      const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
        ...inertLease,
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            observe: () => Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report })),
            requestSuspension: () => Effect.die("observation must not request suspension"),
            begin: () => Effect.die("observation must not begin executor work"),
            resume: () => Effect.die("observation must not resume executor work")
          })
        )
      )

      expect(result).toMatchObject({ _tag: "ExecutorReportPublished", report })
      const durableRecords = (yield* harness.records).filter(({ event }) =>
        event._tag.startsWith("PlannedAttemptExecutor")
      )
      expect(durableRecords.map(({ event }) => event._tag)).toEqual([
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorCommandIntended",
        "PlannedAttemptExecutorCommandProjectionObserved",
        "PlannedAttemptExecutorWorkReported"
      ])
      const beginResponses = durableRecords.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved"
      )
      expect(beginResponses).toEqual([
        expect.objectContaining({
          key: plannedAttemptExecutorCommandProjectionObservedRecordKey(
            plannedAttempt.attemptId,
            beginOrdinal,
            PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
          ),
          event: expect.objectContaining({
            commandOrdinal: beginOrdinal,
            observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({ report }),
            plannedAttempt,
            projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
          })
        })
      ])
      const acceptedReports = durableRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
      expect(acceptedReports).toEqual([
        expect.objectContaining({
          key: plannedAttemptExecutorWorkReportedRecordKey(
            plannedAttempt.attemptId,
            PlannedAttemptExecutorReportOrdinal.make(1)
          ),
          event: expect.objectContaining({ ordinal: PlannedAttemptExecutorReportOrdinal.make(1), report })
        })
      ])
      expect(
        durableRecords.filter(
          ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Begin"
        )
      ).toHaveLength(1)
    })
  )

  effectIt.effect("routes every recovered observation and reconciliation variant through its exact adapter", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const harness = yield* makeLiveJournalHarness(acceptedExecutingHistory.records)
      const record = <A>(name: string, value: A) =>
        Ref.update(calls, (current) => [...current, name]).pipe(Effect.as(value))
      const projected = projectTrackerSnapshot({ revision: "adapter-routes", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("adapter graph fixture is invalid")
      const exactWorktree = PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      })
      const exactLineage = TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: plannedAttempt.baseSha
      })
      const placeholderRelease = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
        predecessorOperationIds: [activeClaim.operationId],
        release: { claim: activeClaim, operationId: OperationId.make("adapter-interpreter-release") }
      }).release
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => record("acquireTaskClaim", AuthoritativeTaskClaimAcquired.make({ claim: activeClaim })),
        readTaskClaim: () => record("readTaskClaim", AuthoritativeTaskClaimObserved.make({ observation: activeClaim })),
        readTaskWorktree: () =>
          record("readTaskWorktree", AuthoritativePlannedAttemptWorktreeObserved.make({ observation: exactWorktree })),
        readTargetLineage: () =>
          record("readTargetLineage", AuthoritativeTargetLineageObserved.make({ observation: exactLineage })),
        readTrackerGraph: () => record("readTrackerGraph", projected.snapshot),
        readTaskWorkSpecification: () => record("readTaskWorkSpecification", specification),
        reconcileTaskWorktree: () =>
          record("reconcileTaskWorktree", AuthoritativeTaskWorktreeReady.make({ proof: exactWorktree })),
        recordTaskAttemptPlan: () =>
          record("recordTaskAttemptPlan", TaskAttemptPlanRecordAcknowledged.make({ plannedAttempt })),
        releaseTaskClaim: () =>
          record("releaseTaskClaim", AuthoritativeTaskClaimReleased.make({ release: placeholderRelease }))
      })
      const withAdapterServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          (candidate) => provideLiveJournal(candidate, harness),
          Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
          Effect.provideService(PassivePlannedAttemptObserver, inactivePassiveObserver),
          Effect.provideService(PassivePlannedAttemptProjectionPublication, inactivePassivePublication),
          Effect.provideService(
            TaskClaimAcquisitionPlanner,
            TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planner") })
          ),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              observe: () =>
                Effect.succeed(
                  PlannedAttemptExecutorProjection.cases.NoReport.make({
                    correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
                  })
                ),
              requestSuspension: () => Effect.die("unused executor suspension"),
              begin: () => Effect.die("unused executor begin"),
              resume: () => Effect.die("unused executor resume")
            })
          ),
          Effect.provideService(
            OperationIdAllocator,
            OperationIdAllocator.of({ allocate: () => Effect.die("unused operation allocator") })
          ),
          Effect.provideService(
            PlannedTaskAttemptPlanner,
            PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused attempt planner") })
          ),
          Effect.provideService(WorkflowInterpreter, interpreter)
        )
      const graphOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("adapter-observe-graph"),
        target
      )
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("adapter-observe-specification"),
        target,
        taskId
      )
      const claimOperation = makeTaskClaimObservationOperation(
        OperationId.make("adapter-observe-claim"),
        target,
        taskId
      )
      const cancelledClaimOperation = makeTaskClaimObservationOperation(
        OperationId.make("adapter-observe-cancelled-claim"),
        target,
        taskId,
        [activeClaim.operationId]
      )
      const worktreeOperation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("adapter-observe-worktree"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      const lineageOperation = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make("adapter-observe-lineage"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      const observations = [
        RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
          operation: graphOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
          operation: specificationOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
          operation: claimOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObserveCancelledAttemptClaim({ operation: cancelledClaimOperation, plannedAttempt }),
        RunnableFrontierTransition.ObserveResponsibleTaskClaim({ operation: claimOperation, taskId }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
          operation: worktreeOperation,
          plannedAttempt
        }),
        RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
          operation: lineageOperation,
          plannedAttempt
        })
      ] as const

      for (const transition of observations) {
        const fresh = proposalsFor(transition).proposals[0]
        if (fresh?.route._tag !== "RecoveredNewActionRoute") {
          return yield* Effect.die(new Error(`missing fresh adapter route for ${transition._tag}`))
        }
        yield* withAdapterServices(
          executeNewRecoveredAction(fresh.route.action, OperationId.make(`fresh:${transition._tag}`), inertLease, runId)
        )
        yield* withAdapterServices(executeAcceptedWorkflowAction(runId, transition, inertLease))
      }

      const recoveryOperationId = OperationId.make("adapter-recovery-operation")
      for (const transition of [
        RunnableFrontierTransition.CheckTaskClaim({ operationId: recoveryOperationId, taskId }),
        RunnableFrontierTransition.ReconcileTaskClaim({ operationId: recoveryOperationId, taskId }),
        RunnableFrontierTransition.ReconcileTaskClaimRelease({ operationId: recoveryOperationId, taskId }),
        RunnableFrontierTransition.ReconcileTaskWorktree({ operationId: recoveryOperationId, taskId })
      ]) {
        yield* withAdapterServices(executeAcceptedWorkflowAction(runId, transition, inertLease))
      }

      const acceptedTransition = RunnableFrontierTransition.CheckTaskClaim({ operationId: recoveryOperationId, taskId })
      const acceptedProposal = proposalsFor(acceptedTransition, new Set([recoveryOperationId])).proposals[0]
      if (acceptedProposal === undefined || !isAcceptedIdentityProposal(acceptedProposal)) {
        return yield* Effect.die("missing accepted live-dispatch proposal")
      }
      const acceptedAction = { _tag: "AcceptedOperationAction" as const, proposal: acceptedProposal }
      const directExecutor = yield* withAdapterServices(makeLiveDeliveryActionExecutor(runId, target))
      expect(yield* directExecutor.execute(acceptedAction, inertLease)).toMatchObject({
        _tag: "ActionCompleted",
        proposalId: acceptedProposal.id
      })
      const layeredExecutor = yield* withAdapterServices(
        DeliveryActionExecutor.pipe(Effect.provide(liveDeliveryActionExecutorLayer(runId, target)))
      )
      expect(yield* layeredExecutor.execute(acceptedAction, inertLease)).toMatchObject({
        _tag: "ActionCompleted",
        proposalId: acceptedProposal.id
      })

      const release = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
        predecessorOperationIds: [activeClaim.operationId],
        release: { claim: activeClaim, operationId: OperationId.make("adapter-release-placeholder") }
      })
      const releaseProposal = proposalsFor(
        RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation: release, plannedAttempt })
      ).proposals[0]
      if (releaseProposal?.route._tag !== "RecoveredNewActionRoute") {
        return yield* Effect.die(new Error("missing external release adapter route"))
      }
      yield* withAdapterServices(
        executeNewRecoveredAction(releaseProposal.route.action, OperationId.make("adapter-release"), inertLease, runId)
      )

      const cancelledRelease = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
          cancellationAppliedAt: JournalPosition.make(22),
          implementationRelinquishedAt: JournalPosition.make(23),
          observationOperationId: cancelledClaimOperation.operationId
        }),
        predecessorOperationIds: [activeClaim.operationId, cancelledClaimOperation.operationId],
        release: { claim: activeClaim, operationId: OperationId.make("adapter-cancelled-release-placeholder") }
      })
      const cancelledReleaseProposal = proposalsFor(
        RunnableFrontierTransition.ReleaseCancelledAttemptClaim({ operation: cancelledRelease, plannedAttempt })
      ).proposals[0]
      if (cancelledReleaseProposal?.route._tag !== "RecoveredNewActionRoute") {
        return yield* Effect.die(new Error("missing cancelled release adapter route"))
      }
      yield* withAdapterServices(
        executeNewRecoveredAction(
          cancelledReleaseProposal.route.action,
          OperationId.make("adapter-cancelled-release"),
          inertLease,
          runId
        )
      )

      const reacquisitionProposal = proposalsFor(
        RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
          plannedAttempt,
          requestId: TaskClaimReacquisitionRequestId.make("adapter-reacquisition"),
          taskId
        })
      ).proposals[0]
      if (reacquisitionProposal?.route._tag !== "RecoveredNewActionRoute") {
        return yield* Effect.die(new Error("missing reacquisition adapter route"))
      }
      yield* executeNewRecoveredAction(
        reacquisitionProposal.route.action,
        OperationId.make("adapter-reacquisition-operation"),
        inertLease,
        runId
      ).pipe(
        (effect) => provideLiveJournal(effect, harness),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({
            plan: (operationId, selectedTaskId) =>
              Effect.succeed({
                operationId,
                owner: ClaimOwner.make("dalph"),
                taskId: selectedTaskId,
                token: ClaimToken.make("adapter-reacquisition-token")
              })
          })
        ),
        Effect.provideService(WorkflowInterpreter, interpreter)
      )

      expect(yield* Ref.get(calls)).toEqual([
        "readTrackerGraph",
        "readTrackerGraph",
        "readTaskWorkSpecification",
        "readTaskWorkSpecification",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskClaim",
        "readTaskWorktree",
        "readTaskWorktree",
        "readTargetLineage",
        "readTargetLineage",
        "releaseTaskClaim",
        "releaseTaskClaim",
        "acquireTaskClaim"
      ])
    })
  )
})
