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
import { Cause, Effect, Layer, Ref, Stream } from "effect"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
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
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import {
  observeTaskClaimThrough,
  releaseTaskClaimThrough,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  attemptPlanRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integrationStartedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  runCancellationAppliedRecordKey
} from "../../workflow-journal/record-key.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal,
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
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import { IntegrationStartedEvent } from "../../workflow/protocols/integration-admission/events.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import {
  CancelledAttemptImplementationResponsibilityRelinquishedEvent,
  RunCancellationAppliedEvent
} from "../../workflow/protocols/run-cancellation/events.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { executeAcceptedWorkflowAction, executeNewRecoveredAction } from "./recovered-delivery-action-adapter.js"
import { DeliveryActionExecutor, type DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import { makePlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
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
  integratorInitialRunCorrelationFor,
  integratorSuccessorCorrelationFor
} from "../../workflow/protocols/integrator/session.js"
import { executeFreshWorkflowOperation } from "./fresh-delivery-action-adapter.js"
import { executeFreshTrackerGraphRead, executeTrackerGraphRead } from "./delivery-action-adapter-common.js"
import { executePlannedAttemptTransition } from "./planned-attempt-delivery-action-adapter.js"
import { liveDeliveryActionExecutorLayer, makeLiveDeliveryActionExecutor } from "./live-delivery-action-executor.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import {
  completionClaimDeletionRequestFor,
  CompletionClaimBoundary,
  CompletionClaimReadFailure,
  CompletionClaimReplacedEvent,
  completionClaimReplacementOperationIdFor,
  completionClaimReplacementRequestFor,
  completionTaskRequestFor,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestFailure,
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal,
  FocusedTaskCompletionReadFailure
} from "../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import {
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskCompletionFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
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
import {
  failPreStartClaimBinding,
  PreStartClaimTaskWorkPositionBindingContradiction
} from "./delivery-runtime-task-work-position.js"

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
const queued = QueuedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget,
  plannedAttempt,
  preIntegrationCancellation: { attemptId: plannedAttempt.attemptId, queuedAt: JournalPosition.make(20), runId },
  queuedAt: JournalPosition.make(20)
})
const started = StartedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget,
  plannedAttempt,
  queuedAt: queued.queuedAt,
  startedAt: JournalPosition.make(21)
})
const unqueued = UnqueuedAcceptedResult.make({ acceptedResult, plannedAttempt, terminalAt: JournalPosition.make(19) })
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("accepted-claim"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("route-matrix-token")
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
  bindPreStartTaskWorkPosition: () => Effect.void,
  bindPreStartPlannedAttemptPosition: () => Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol lease")
}

const inertPlannedAttemptExecutor = PlannedAttemptExecutor.of({
  project: () => Effect.die("unused planned-attempt projection"),
  requestSuspension: () => Effect.die("unused planned-attempt suspension"),
  startOrContinue: () => Effect.die("unused planned-attempt continuation")
})

const appendableJournalFor = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  InRunJournal.of({
    append: (runId, key, event) =>
      Ref.modify(records, (current) => {
        const existing = current.find((candidate) => candidate.key === key)
        if (existing !== undefined) return [Effect.succeed(existing), current] as const
        const appended: JournalRecord = { event, key, position: JournalPosition.make(current.length + 1), runId }
        return [Effect.succeed(appended), [...current, appended]] as const
      }).pipe(Effect.flatten),
    read: () => Ref.get(records)
  })

effectIt.effect("executes cancellation no-release only for a fresh foreign claim observation", () =>
  Effect.gen(function* () {
    const cancellationPosition = JournalPosition.make(1)
    const cancellation: JournalRecord = {
      event: RunCancellationAppliedEvent.make({
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("route-matrix-cancellation"),
      position: cancellationPosition,
      runId
    }
    const relinquished: JournalRecord = {
      event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
        authorizedClaim: activeClaim,
        cancellationAppliedAt: cancellationPosition,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        plannedAttempt,
        proof: { _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2) },
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("route-matrix-relinquished"),
      position: JournalPosition.make(2),
      runId
    }
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
    const observation: JournalRecord = {
      event: taskTrackerFactsObservedEvent(
        observationOperation.operationId,
        makeFocusedTaskClaimFactsObserved(observationOperation, foreignClaim)
      ),
      key: JournalRecordKey.make("route-matrix-cancelled-claim-observation"),
      position: JournalPosition.make(4),
      runId
    }
    const readIntent: JournalRecord = {
      event: taskTrackerReadIntent(observationOperation),
      key: JournalRecordKey.make("route-matrix-cancelled-claim-read-intent"),
      position: JournalPosition.make(3),
      runId
    }
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([cancellation, relinquished, readIntent, observation])
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
      Effect.provideService(InRunJournal, appendableJournalFor(records)),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(result).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(
      (yield* Ref.get(records)).findLast(({ event }) => event._tag === "CancelledAttemptClaimNoReleaseObserved")?.event
    ).toMatchObject({
      _tag: "CancelledAttemptClaimNoReleaseObserved",
      expectedClaim: activeClaim,
      observationOperationId: observationOperation.operationId,
      plannedAttempt
    })

    const missingReadIntentRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      cancellation,
      relinquished,
      observation
    ])
    yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, inertLease).pipe(
      Effect.provideService(InRunJournal, appendableJournalFor(missingReadIntentRecords)),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(
      (yield* Ref.get(missingReadIntentRecords)).some(
        ({ event }) => event._tag === "CancelledAttemptClaimNoReleaseObserved"
      )
    ).toBe(false)

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
    const cases: ReadonlyArray<ReadonlyArray<JournalRecord>> = [
      [cancellation, readIntent, observation],
      [cancellation, relinquished, readIntent],
      [cancellation, relinquished, noPredecessorRead, noPredecessorObservation],
      [cancellation, relinquished, readIntent, exactObservation],
      yield* Ref.get(records)
    ]
    yield* Effect.forEach(cases, (initial) =>
      Effect.gen(function* () {
        const controlled = yield* Ref.make(initial)
        const before = initial.filter(({ event }) => event._tag === "CancelledAttemptClaimNoReleaseObserved").length
        yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, inertLease).pipe(
          Effect.provideService(InRunJournal, appendableJournalFor(controlled)),
          Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
        )
        const after = (yield* Ref.get(controlled)).filter(
          ({ event }) => event._tag === "CancelledAttemptClaimNoReleaseObserved"
        ).length
        expect(after).toBe(before)
      })
    )
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
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("route-matrix-cancellation-chronology-plan"),
      plannedAttempt,
      predecessorOperationIds: [activeClaim.operationId]
    })
    const cancellationPosition = JournalPosition.make(8)
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
    const initialRunningReport = PlannedAttemptExecutorReport.cases.Running.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    })
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
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
        event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
        key: attemptPlanRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(4),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(5),
        runId
      },
      {
        event: PlannedAttemptExecutorCommandIntendedEvent.make({
          command: "StartOrContinue",
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: initialCommandOrdinal,
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, initialCommandOrdinal),
        position: JournalPosition.make(6),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: initialReportOrdinal,
          report: initialRunningReport,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, initialReportOrdinal),
        position: JournalPosition.make(7),
        runId
      },
      cancellation
    ])
    const journal = appendableJournalFor(records)
    const safeReport = PlannedAttemptExecutorReport.cases.SafelySuspended.make({
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
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () =>
            Effect.succeed(
              PlannedAttemptExecutorProjection.cases.NoReport.make({
                correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
              })
            ),
          requestSuspension: () => Effect.succeed(safeReport),
          startOrContinue: () => Effect.die("unexpected continuation after cancellation")
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
      ),
      Effect.provideService(
        DeliveryAcceptedFactPublication,
        DeliveryAcceptedFactPublication.of({ awaitCurrent: Effect.void })
      )
    )

    const suspendTransition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    const suspendProposal = proposalsFor(suspendTransition).proposals[0]
    if (suspendProposal === undefined || !isIdentityFreeProposal(suspendProposal)) {
      return yield* Effect.die("missing cancellation suspension proposal")
    }
    yield* live.execute({ _tag: "IdentityFreeAction", proposal: suspendProposal }, lease)
    expect((yield* Ref.get(records)).some(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toBe(
      true
    )

    const relinquishedTransition = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: { _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2) }
    })
    const relinquishedProposal = proposalsFor(relinquishedTransition).proposals[0]
    if (relinquishedProposal === undefined || !isIdentityFreeProposal(relinquishedProposal)) {
      return yield* Effect.die("missing cancellation relinquishment proposal")
    }
    yield* live.execute({ _tag: "IdentityFreeAction", proposal: relinquishedProposal }, lease)
    const afterRelinquishment = yield* Ref.get(records)
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
      (yield* Ref.get(records)).some(
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
    const releasedRecords = yield* Ref.get(records)
    expect(releasedRecords.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(releasedRecords.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    expect(yield* Ref.get(trackerReads)).toBe(3)
    expect(yield* Ref.get(trackerReleases)).toBe(1)

    // Re-delivery of the same fresh release operation must replay its durable outcome without another tracker call.
    yield* live.execute(
      { _tag: "FreshOperationAction", operationId: releaseOperation.release.operationId, proposal: releaseProposal },
      lease
    )
    const replayedRecords = yield* Ref.get(records)
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
    const acquisition = {
      operationId: activeClaim.operationId,
      owner: activeClaim.owner,
      taskId: activeClaim.taskId,
      token: activeClaim.token
    }
    const acquisitionOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("route-matrix-cancelled-plan"),
      plannedAttempt,
      predecessorOperationIds: [activeClaim.operationId]
    })
    const report = (position: number, ordinal: number): JournalRecord => ({
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(ordinal),
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        }),
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkReportedRecordKey(
        plannedAttempt.attemptId,
        PlannedAttemptExecutorReportOrdinal.make(ordinal)
      ),
      position: JournalPosition.make(position),
      runId
    })
    const cancellationPosition = JournalPosition.make(6)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
      {
        event: TaskClaimAcquisitionIntendedEvent.make({
          operation: acquisitionOperation,
          version: workflowJournalEventVersion
        }),
        key: intentRecordKey(acquisition.operationId),
        position: JournalPosition.make(1),
        runId
      },
      {
        event: TaskClaimAcquiredEvent.make({ claim: activeClaim, version: workflowJournalEventVersion }),
        key: outcomeRecordKey(acquisition.operationId),
        position: JournalPosition.make(2),
        runId
      },
      {
        event: TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }),
        key: attemptPlanRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(3),
        runId
      },
      {
        event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(4),
        runId
      },
      report(5, 5),
      {
        event: RunCancellationAppliedEvent.make({
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("route-matrix-cancellation-revalidation"),
        position: cancellationPosition,
        runId
      },
      report(7, 7)
    ])
    const transition = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: { _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(7) }
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
      proof: { _tag: "CommandResponse", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(5) }
    })
    const cancellationRecords = yield* Ref.get(records)
    yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, staleTransition, lease).pipe(
      Effect.provideService(InRunJournal, appendableJournalFor(records)),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(
      (yield* Ref.get(records)).some(
        ({ event }) => event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
      )
    ).toBe(false)

    yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, lease).pipe(
      Effect.provideService(InRunJournal, appendableJournalFor(records)),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(
      (yield* Ref.get(records)).findLast(
        ({ event }) => event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
      )?.event
    ).toMatchObject({
      _tag: "CancelledAttemptImplementationResponsibilityRelinquished",
      authorizedClaim: activeClaim,
      cancellationAppliedAt: cancellationPosition,
      plannedAttempt
    })

    const preCancellationSafeRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>(
      (yield* Ref.get(records)).filter(({ position }) => position <= cancellationPosition)
    )
    yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, staleTransition, lease).pipe(
      Effect.provideService(InRunJournal, appendableJournalFor(preCancellationSafeRecords)),
      Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
    )
    expect(
      (yield* Ref.get(preCancellationSafeRecords)).some(
        ({ event }) => event._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
      )
    ).toBe(true)

    const executeAgainst = (candidateRecords: ReadonlyArray<JournalRecord>, candidateTransition = transition) =>
      Effect.gen(function* () {
        const journalRecords = yield* Ref.make(candidateRecords)
        yield* executePlannedAttemptTransition(
          { _tag: "IdentityFreeAction", proposal },
          candidateTransition,
          lease
        ).pipe(
          Effect.provideService(InRunJournal, appendableJournalFor(journalRecords)),
          Effect.provideService(PlannedAttemptExecutor, inertPlannedAttemptExecutor)
        )
        return yield* Ref.get(journalRecords)
      })
    const settledRecords = yield* Ref.get(records)
    const projectionProof = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: {
        _tag: "CommandProjection",
        commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(7),
        projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(7)
      }
    })
    const stateProof = RunnableFrontierTransition.RelinquishCancelledAttemptImplementation({
      plannedAttempt,
      proof: { _tag: "StateProjection", observationOrdinal: PlannedAttemptExecutorStateObservationOrdinal.make(7) }
    })
    const projectedSafeReport = PlannedAttemptExecutorReport.cases.SafelySuspended.make({
      correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
    })
    const projectionEvidence: JournalRecord = {
      event: PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(7),
        observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
          report: projectedSafeReport
        }),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(7),
        version: workflowJournalEventVersion
      }),
      key: JournalRecordKey.make("route-matrix-cancellation-projection-evidence"),
      position: JournalPosition.make(7),
      runId
    }
    const projectionRecords = [
      ...cancellationRecords.filter(({ event }) => event._tag !== "PlannedAttemptExecutorWorkReported"),
      projectionEvidence
    ]
    const terminalEvidence = {
      ...cancellationRecords.findLast(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"),
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(7),
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
          result: { _tag: "Completed" }
        }),
        version: workflowJournalEventVersion
      })
    } as JournalRecord
    for (const [candidateRecords, candidateTransition] of [
      [settledRecords, transition],
      [cancellationRecords.filter(({ event }) => event._tag !== "RunCancellationApplied"), transition],
      [cancellationRecords.filter(({ event }) => event._tag !== "TaskClaimAcquired"), transition],
      [cancellationRecords.filter(({ event }) => event._tag !== "PlannedAttemptExecutorWorkReported"), transition],
      [projectionRecords, projectionProof],
      [
        [
          ...cancellationRecords.filter(({ event }) => event._tag !== "PlannedAttemptExecutorWorkReported"),
          terminalEvidence
        ],
        transition
      ],
      [cancellationRecords, stateProof]
    ] as const) {
      yield* executeAgainst(candidateRecords, candidateTransition)
    }
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
    const graphOperation = makeTrackerGraphObservationOperation(OperationId.make("observe-graph"), target)
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
        transition: RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
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
    const start = RunnableFrontierTransition.StartPlannedAttemptExecutorWork({ plannedAttempt })
    const step = FreshWorkflowStep.StartPlannedAttemptExecutorWork({ plannedAttempt, specification, task })
    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [{ step, transition: start }],
      runId,
      transitions: [start]
    }).ticketDelivery
    expect(proposal).toMatchObject({
      actionIdentity: { _tag: "NoWorkflowOperationIdentity" },
      admission: { taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "Existing", taskId } },
      route: { _tag: "FreshExecutorWorkflowRoute", step }
    })

    for (const transition of [
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId, taskRevision: plannedAttempt.taskRevision }),
      RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: OperationId.make("fresh-predecessor"),
        taskId
      }),
      start
    ]) {
      expect(proposalsFor(transition)).toMatchObject({
        issues: [{ _tag: "FreshRouteProvenanceMissing", taskId, transition: transition._tag }],
        proposals: []
      })
    }
  })

  it("allows a current-facts continuation to reuse or reserve its task-work position", () => {
    const continuation = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWorkAfterCurrentFacts({
      acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
      plannedAttempt,
      witness: {
        activeTaskContinuationRead: {
          graphObservationOperationId: OperationId.make("current-facts-graph"),
          taskClaimObservationOperationId: OperationId.make("current-facts-claim"),
          taskWorkSpecificationObservationOperationId: OperationId.make("current-facts-specification")
        },
        worktreeObservationOperationId: OperationId.make("current-facts-worktree")
      }
    })
    expect(proposalsFor(continuation).proposals).toMatchObject([
      {
        admission: { taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId } },
        route: { _tag: "IdentityFreeWorkflowRoute", transition: continuation }
      }
    ])
  })

  effectIt.effect("executes the identity-free acquire route and names missing Integrator boundaries", () =>
    Effect.gen(function* () {
      const candidateJournal = InRunJournal.of({
        append: (_runId, _key, _event) => Effect.die("candidate journal must not append"),
        read: (_runId) => Effect.succeed([])
      })
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
        ).pipe(Effect.provideService(InRunJournal, candidateJournal))
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
        ).pipe(Effect.provideService(InRunJournal, candidateJournal))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: releaseProposal.id })

      const lineage = TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: plannedAttempt.baseSha,
        targetHeadSha: GitCommitSha.make("4".repeat(40))
      })
      const preparation = { lineage, lineageObservedAt: JournalPosition.make(19), responsibility: started }
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
          Effect.provideService(InRunJournal, candidateJournal),
          Effect.flip
        )
      ).toEqual(new IntegratorBoundaryUnavailable({ boundary: "Integrator" }))
      expect(
        yield* executeIntegrationAction(integratorAction, runIntegrator, inertLease, target).pipe(
          Effect.provideService(
            Integrator,
            Integrator.of({ prepare: () => Effect.die("Integrator must not run without its Git boundary") })
          ),
          Effect.provideService(InRunJournal, candidateJournal),
          Effect.flip
        )
      ).toEqual(new IntegratorBoundaryUnavailable({ boundary: "Git" }))

      const lineageOperationId = OperationId.make("route-matrix-integrator-lineage")
      const lineageOperation = makeTargetLineageObservationOperation({
        integrationTarget: started.integrationTarget,
        operationId: lineageOperationId,
        plannedAttempt: started.plannedAttempt,
        predecessorOperationIds: []
      })
      const integratorRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: GitReadIntentRecordedEvent.make({
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            operation: lineageOperation,
            version: workflowJournalEventVersion
          }),
          key: intentRecordKey(lineageOperationId),
          position: JournalPosition.make(18),
          runId
        },
        {
          event: TargetLineageObservedEvent.make({
            observation: lineage,
            occurrenceClassification: "NonActionOccurrence",
            operationId: lineageOperationId,
            plannedAttempt: started.plannedAttempt,
            version: workflowJournalEventVersion
          }),
          key: outcomeRecordKey(lineageOperationId),
          position: JournalPosition.make(19),
          runId
        },
        {
          event: IntegrationStartedEvent.make({
            acceptedResult: started.acceptedResult,
            integrationTarget: started.integrationTarget,
            plannedAttempt: started.plannedAttempt,
            responsibilityBeganAt: started.queuedAt,
            version: workflowJournalEventVersion
          }),
          key: integrationStartedRecordKey(started.plannedAttempt.attemptId),
          position: started.startedAt,
          runId
        }
      ])
      const integratorJournal = InRunJournal.of({
        append: (requestedRunId, key, event) =>
          Ref.modify(integratorRecords, (records) => {
            const existing = records.find((record) => record.key === key)
            if (existing !== undefined) return [Effect.succeed(existing), records] as const
            const position = JournalPosition.make(Math.max(...records.map((record) => record.position)) + 1)
            const appended: JournalRecord = { event, key, position, runId: requestedRunId }
            return [Effect.succeed(appended), [...records, appended]] as const
          }).pipe(Effect.flatten),
        read: () => Ref.get(integratorRecords)
      })
      const unreadableRecords = yield* Ref.make(yield* Ref.get(integratorRecords))
      const unreadableJournal = InRunJournal.of({
        append: (requestedRunId, key, event) =>
          Ref.modify(unreadableRecords, (records) => {
            const existing = records.find((record) => record.key === key)
            if (existing !== undefined) return [Effect.succeed(existing), records] as const
            const position = JournalPosition.make(Math.max(...records.map((record) => record.position)) + 1)
            const appended: JournalRecord = { event, key, position, runId: requestedRunId }
            return [Effect.succeed(appended), [...records, appended]] as const
          }).pipe(Effect.flatten),
        read: () => Ref.get(unreadableRecords)
      })
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
        Effect.provideService(InRunJournal, unreadableJournal)
      )
      expect(deferred).toMatchObject({
        _tag: "ActionDeferred",
        proposalId: integratorProposal.id,
        reason: { _tag: "IntegratorGitReadFailure", candidateText }
      })

      const providerFailureRecords = yield* Ref.make(yield* Ref.get(integratorRecords))
      const providerFailureJournal = InRunJournal.of({
        append: (requestedRunId, key, event) =>
          Ref.modify(providerFailureRecords, (records) => {
            const existing = records.find((record) => record.key === key)
            if (existing !== undefined) return [Effect.succeed(existing), records] as const
            const position = JournalPosition.make(Math.max(...records.map((record) => record.position)) + 1)
            const appended: JournalRecord = { event, key, position, runId: requestedRunId }
            return [Effect.succeed(appended), [...records, appended]] as const
          }).pipe(Effect.flatten),
        read: () => Ref.get(providerFailureRecords)
      })
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
        Effect.provideService(InRunJournal, providerFailureJournal),
        Effect.flip
      )
      expect(ordinaryFailure).toMatchObject({ _tag: "IntegratorCallFailure" })
      expect(
        (yield* Ref.get(providerFailureRecords)).filter(
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
        Effect.provideService(InRunJournal, providerFailureJournal)
      )
      expect(providerAbsent).toMatchObject({ _tag: "ActionCompleted", proposalId: integratorProposal.id })
      expect((yield* Ref.get(providerFailureRecords)).map(({ event }) => event._tag).slice(-2)).toEqual([
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
        ).pipe(Effect.provideService(InRunJournal, providerFailureJournal))
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
        Effect.provideService(InRunJournal, integratorJournal)
      )
      expect(completed).toMatchObject({ _tag: "ActionCompleted", proposalId: integratorProposal.id })
      expect((yield* Ref.get(integratorRecords)).map(({ event }) => event._tag).slice(-2)).toEqual([
        "IntegratorRunResultRecorded",
        "IntegrationQuarantined"
      ])

      yield* Ref.update(integratorRecords, (records) =>
        records.filter(({ event }) => event._tag !== "IntegrationQuarantined")
      )
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
        ).pipe(Effect.provideService(InRunJournal, integratorJournal))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: recoveryProposal.id })
      expect(
        (yield* Ref.get(integratorRecords)).filter(({ event }) => event._tag === "IntegrationQuarantined")
      ).toHaveLength(1)

      const initialQuarantine = (yield* Ref.get(integratorRecords)).find(
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
      const retryDirection = yield* integratorJournal.append(
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
      yield* integratorJournal.append(
        runId,
        intentRecordKey(retryLineageOperationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: retryLineageOperation,
          version: workflowJournalEventVersion
        })
      )
      const retryLineageRecord = yield* integratorJournal.append(
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
                Ref.update(deliveredSessions, (sessions) => [...sessions, request.correlation.sessionId]).pipe(
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
          Effect.provideService(InRunJournal, integratorJournal)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: retryProposal.id })
      expect(
        (yield* Ref.get(integratorRecords)).filter(
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
        ).pipe(Effect.provideService(InRunJournal, integratorJournal))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: retryRecoveryProposal.id })

      const retryQuarantine = (yield* Ref.get(integratorRecords))
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
      const fullRerunDirection = yield* integratorJournal.append(
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
      yield* integratorJournal.append(
        runId,
        intentRecordKey(successorLineageOperationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: successorLineageOperation,
          version: workflowJournalEventVersion
        })
      )
      const successorLineageRecord = yield* integratorJournal.append(
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
      ).pipe(Effect.provideService(InRunJournal, integratorJournal))

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
              Ref.update(deliveredSessions, (sessions) => [...sessions, request.correlation.sessionId]).pipe(
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
        Effect.provideService(InRunJournal, integratorJournal)
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
      const acceptedRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt: unqueued.plannedAttempt,
            version: workflowJournalEventVersion
          }),
          key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(unqueued.plannedAttempt.attemptId),
          position: JournalPosition.make(1),
          runId
        },
        {
          event: PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
            report: PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation: { attemptId: unqueued.plannedAttempt.attemptId, runId },
              result: { _tag: "Accepted", acceptedResult: unqueued.acceptedResult }
            }),
            version: workflowJournalEventVersion
          }),
          key: plannedAttemptExecutorWorkReportedRecordKey(
            unqueued.plannedAttempt.attemptId,
            PlannedAttemptExecutorReportOrdinal.make(1)
          ),
          position: JournalPosition.make(2),
          runId
        }
      ])
      const acceptedJournal = appendableJournalFor(acceptedRecords)

      expect(
        yield* executeIntegrationAction(queueAction, queue, inertLease, target).pipe(
          Effect.provideService(InRunJournal, acceptedJournal)
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
          Effect.provideService(InRunJournal, acceptedJournal)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: { _tag: "AcceptedResultEvidenceUnavailable" } })

      const conflictingEvidence = EvidenceStore.of({
        put: () => Effect.die("acceptance evidence tests never publish evidence"),
        read: () => Effect.succeed(new TextEncoder().encode("{}"))
      })
      expect(
        yield* executeIntegrationAction(queueAction, queue, inertLease, target).pipe(
          Effect.provideService(EvidenceStore, conflictingEvidence),
          Effect.provideService(InRunJournal, acceptedJournal)
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
      expect(
        yield* executeIntegrationAction(promotionAction, promotion, inertLease, target).pipe(
          Effect.provideService(InRunJournal, acceptedJournal),
          Effect.flip
        )
      ).toBeInstanceOf(TargetPromotionRuntimeUnavailable)
      expect(
        yield* executeIntegrationAction(promotionAction, promotion, inertLease, target).pipe(
          Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
          Effect.provideService(InRunJournal, acceptedJournal),
          Effect.flip
        )
      ).toBeInstanceOf(TargetPromotionRuntimeUnavailable)
    })
  )

  effectIt.effect("executes completion-claim replacement and deletion through the configured boundary", () =>
    Effect.gen(function* () {
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: integrationFinalityFixture.promotionSuccess,
          key: JournalRecordKey.make("integration-finality-action:promotion"),
          position: JournalPosition.make(1),
          runId: integrationFinalityFixture.runId
        }
      ])
      const journal = appendableJournalFor(records)
      let currentClaim: typeof integrationFinalityFixture.activeClaim | typeof integrationFinalityFixture.claim =
        integrationFinalityFixture.activeClaim
      const boundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.void,
        readTaskClaim: () => Effect.succeed(currentClaim),
        replaceTaskClaim: (request) =>
          Effect.sync(() => {
            currentClaim = request.claim
            return request.claim
          })
      })
      const replacement = RunnableFrontierTransition.ReplacePromotedTaskClaim({
        request: completionClaimReplacementRequestFor(integrationFinalityFixture.claim),
        responsibility: started
      })
      const replacementProposal = proposalsFor(replacement).proposals[0]
      if (replacementProposal === undefined || !isIdentityFreeProposal(replacementProposal)) {
        return yield* Effect.die("missing completion-claim replacement proposal")
      }
      const replacementAction = { _tag: "IdentityFreeAction" as const, proposal: replacementProposal }
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease, target).pipe(
          Effect.provideService(InRunJournal, journal),
          Effect.flip
        )
      ).toEqual(new IntegrationFinalityRuntimeUnavailable())
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease, target).pipe(
          Effect.provideService(CompletionClaimBoundary, boundary),
          Effect.provideService(InRunJournal, journal)
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
        responsibility: started
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
          target
        ).pipe(Effect.provideService(CompletionClaimBoundary, boundary), Effect.provideService(InRunJournal, journal))
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: deletionProposal.id })
      expect(yield* Ref.get(interruptibleBoundaryEntries)).toBeGreaterThan(0)
      expect((yield* Ref.get(records)).at(-1)?.event._tag).toBe("IntegrationFinalitySettled")

      const waitingRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: integrationFinalityFixture.promotionSuccess,
          key: JournalRecordKey.make("integration-finality-action:foreign-promotion"),
          position: JournalPosition.make(1),
          runId: integrationFinalityFixture.runId
        }
      ])
      const waitingJournal = appendableJournalFor(waitingRecords)
      const foreignBoundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.die("foreign wait must not delete"),
        readTaskClaim: () =>
          Effect.succeed({
            ...integrationFinalityFixture.activeClaim,
            operationId: OperationId.make("foreign-finality-action-claim")
          }),
        replaceTaskClaim: () => Effect.die("foreign wait must not replace")
      })
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease, target).pipe(
          Effect.provideService(CompletionClaimBoundary, foreignBoundary),
          Effect.provideService(InRunJournal, waitingJournal)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimConflict" })

      const unreadableBoundary = CompletionClaimBoundary.of({
        deleteTaskClaim: () => Effect.die("unreadable claim must not be deleted"),
        readTaskClaim: (taskId) =>
          Effect.fail(new CompletionClaimReadFailure({ detail: "tracker claim is unreadable", taskId })),
        replaceTaskClaim: () => Effect.die("unreadable claim must not be replaced")
      })
      expect(
        yield* executeIntegrationAction(replacementAction, replacement, inertLease, target).pipe(
          Effect.provideService(CompletionClaimBoundary, unreadableBoundary),
          Effect.provideService(InRunJournal, waitingJournal)
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionClaimReadUnavailable" })

      const deletionPrefix = (yield* Ref.get(records)).filter(({ event }) =>
        ["TargetPromotionObservedSuccess", "CompletionClaimReplaced", "TaskTrackerFactsObserved"].includes(event._tag)
      )
      const deletionWaitingRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>(deletionPrefix)
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: deletionProposal },
          deletion,
          deletionLease,
          target
        ).pipe(
          Effect.provideService(CompletionClaimBoundary, unreadableBoundary),
          Effect.provideService(InRunJournal, appendableJournalFor(deletionWaitingRecords))
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "FocusedTaskCompletionSuccessRequired" })

      const readableSuccessPrefix = (yield* Ref.get(records)).filter(
        ({ event }) =>
          event._tag !== "CompletionClaimDeletionIntended" &&
          event._tag !== "CompletionClaimDeletionAttemptIntended" &&
          event._tag !== "CompletionClaimDeleted" &&
          event._tag !== "IntegrationFinalitySettled"
      )
      expect(
        yield* executeIntegrationAction(
          { _tag: "IdentityFreeAction", proposal: deletionProposal },
          deletion,
          deletionLease,
          target
        ).pipe(
          Effect.provideService(CompletionClaimBoundary, unreadableBoundary),
          Effect.provideService(
            InRunJournal,
            appendableJournalFor(yield* Ref.make<ReadonlyArray<JournalRecord>>(readableSuccessPrefix))
          )
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
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: CompletionClaimReplacedEvent.make({
            claim: integrationFinalityFixture.claim,
            operationId: completionClaimReplacementOperationIdFor(integrationFinalityFixture.claim),
            version: workflowJournalEventVersion
          }),
          key: JournalRecordKey.make("integration-finality-action:focused-claim-replaced"),
          position: JournalPosition.make(1),
          runId: integrationFinalityFixture.runId
        },
        {
          event: CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion }),
          key: JournalRecordKey.make("integration-finality-action:completion-intended"),
          position: JournalPosition.make(2),
          runId: integrationFinalityFixture.runId
        },
        {
          event: CompletionTaskAcknowledgedEvent.make({
            acknowledgement,
            attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
            request,
            version: workflowJournalEventVersion
          }),
          key: JournalRecordKey.make("integration-finality-action:acknowledged"),
          position: JournalPosition.make(3),
          runId: integrationFinalityFixture.runId
        }
      ])
      const journal = appendableJournalFor(records)
      const lifecycle = yield* Ref.make<"CompletedSuccessfully" | "Open">("Open")
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("focused observation never sends another completion request"),
        readCompletionRequest: () => Effect.die("focused observation never performs request lookup"),
        readFocusedTaskCompletion: (_taskId, _target, operationId) =>
          Ref.get(lifecycle).pipe(
            Effect.map((currentLifecycle) => ({
              ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
              currentClaim: integrationFinalityFixture.claim,
              lifecycle: currentLifecycle,
              operationId,
              target
            }))
          )
      })
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({ request, responsibility: started })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused completion proposal")
      }
      const action = { _tag: "IdentityFreeAction" as const, proposal }
      const pending = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
        Effect.provideService(CompletionTaskBoundary, boundary),
        Effect.provideService(InRunJournal, journal)
      )
      expect(pending).toMatchObject({
        _tag: "ActionDeferred",
        reason: { _tag: "IntegrationFinality.CompletionTaskConfirmationWait" }
      })

      yield* Ref.set(lifecycle, "CompletedSuccessfully")
      expect(
        yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
          Effect.provideService(CompletionTaskBoundary, boundary),
          Effect.provideService(InRunJournal, journal)
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(
        (yield* Ref.get(records)).filter(
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
      const attemptOrdinal = CompletionTaskRequestOrdinal.make(1)
      const purpose = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
        attemptOrdinal,
        confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
      })
      const focusedOperation = makeCompletionTaskFactsObservationOperation(request, target, purpose)
      const focusedIntent = taskTrackerReadIntent(focusedOperation)
      const focusedOutcome = taskTrackerFactsObservedEvent(
        focusedOperation.operationId,
        makeFocusedTaskCompletionFactsObserved(focusedOperation, {
          ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
          currentClaim: integrationFinalityFixture.claim,
          operationId: focusedOperation.operationId,
          target
        })
      )
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: CompletionClaimReplacedEvent.make({
            claim: integrationFinalityFixture.claim,
            operationId: completionClaimReplacementOperationIdFor(integrationFinalityFixture.claim),
            version: workflowJournalEventVersion
          }),
          key: JournalRecordKey.make("integration-finality-restart:claim-replaced"),
          position: JournalPosition.make(1),
          runId: integrationFinalityFixture.runId
        },
        {
          event: CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion }),
          key: JournalRecordKey.make("integration-finality-restart:completion-intended"),
          position: JournalPosition.make(2),
          runId: integrationFinalityFixture.runId
        },
        {
          event: CompletionTaskAcknowledgedEvent.make({
            acknowledgement: CompletionTaskAcknowledgement.make({
              operationId: request.operationId,
              taskId: request.taskId
            }),
            attemptOrdinal,
            request,
            version: workflowJournalEventVersion
          }),
          key: JournalRecordKey.make("integration-finality-restart:acknowledged"),
          position: JournalPosition.make(3),
          runId: integrationFinalityFixture.runId
        },
        {
          event: focusedIntent,
          key: JournalRecordKey.make("integration-finality-restart:focused-intent"),
          position: JournalPosition.make(4),
          runId: integrationFinalityFixture.runId
        },
        {
          event: focusedOutcome,
          key: JournalRecordKey.make("integration-finality-restart:focused-outcome"),
          position: JournalPosition.make(5),
          runId: integrationFinalityFixture.runId
        }
      ])
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({ request, responsibility: started })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing restart focused-completion proposal")
      }
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("restart normalization never completes the task again"),
        readCompletionRequest: () => Effect.die("restart normalization never looks up the request"),
        readFocusedTaskCompletion: () => Effect.die("durable focused success must not be read again")
      })

      expect(
        yield* executeIntegrationAction({ _tag: "IdentityFreeAction", proposal }, transition, inertLease, target).pipe(
          Effect.provideService(CompletionTaskBoundary, boundary),
          Effect.provideService(InRunJournal, appendableJournalFor(records))
        )
      ).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
      expect(
        (yield* Ref.get(records)).filter(
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
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({ request, responsibility: started })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused completion proposal")
      }
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("focused confirmation never completes the task"),
        readCompletionRequest: () => Effect.die("focused confirmation never looks up the request"),
        readFocusedTaskCompletion: () => Effect.die("missing confirmation basis must stop before the tracker read")
      })

      expect(
        yield* executeIntegrationAction({ _tag: "IdentityFreeAction", proposal }, transition, inertLease, target).pipe(
          Effect.provideService(CompletionTaskBoundary, boundary),
          Effect.provideService(InRunJournal, appendableJournalFor(yield* Ref.make<ReadonlyArray<JournalRecord>>([])))
        )
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
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({ request, responsibility: started })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused confirmation proposal")
      }
      const intent = CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion })
      const journalRecord = (position: number, event: JournalRecord["event"]): JournalRecord => ({
        event,
        key: JournalRecordKey.make(`focused-confirmation-adapter:${position}`),
        position: JournalPosition.make(position),
        runId: integrationFinalityFixture.runId
      })
      const acknowledgement = CompletionTaskAcknowledgedEvent.make({
        acknowledgement: CompletionTaskAcknowledgement.make({
          operationId: request.operationId,
          taskId: request.taskId
        }),
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        request,
        version: workflowJournalEventVersion
      })
      const waitingRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        journalRecord(1, intent),
        journalRecord(2, acknowledgement)
      ])
      const waitingBoundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("focused confirmation wait must not complete the task"),
        readCompletionRequest: () => Effect.die("focused confirmation wait must not look up the request"),
        readFocusedTaskCompletion: (taskId) =>
          Effect.fail(new FocusedTaskCompletionReadFailure({ detail: "focused facts unavailable", taskId }))
      })
      expect(
        yield* executeIntegrationAction({ _tag: "IdentityFreeAction", proposal }, transition, inertLease, target).pipe(
          Effect.provideService(CompletionTaskBoundary, waitingBoundary),
          Effect.provideService(InRunJournal, appendableJournalFor(waitingRecords))
        )
      ).toMatchObject({
        _tag: "ActionDeferred",
        reason: { _tag: "IntegrationFinality.CompletionTaskConfirmationWait" }
      })

      const focusedOperation = makeCompletionTaskFactsObservationOperation(
        request,
        target,
        integrationFinalityFixture.focusedSuccessFactsEvent.observation.purpose
      )
      const conflictingFacts = makeFocusedTaskCompletionFactsObserved(focusedOperation, {
        ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
        currentClaim: integrationFinalityFixture.activeClaim,
        lifecycle: "Open",
        operationId: focusedOperation.operationId,
        target
      })
      const conflictingRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        journalRecord(1, intent),
        journalRecord(2, acknowledgement),
        journalRecord(3, taskTrackerFactsObservedEvent(focusedOperation.operationId, conflictingFacts))
      ])
      const neverCalledBoundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("durable conflicting facts must stop before completion"),
        readCompletionRequest: () => Effect.die("durable conflicting facts must stop before lookup"),
        readFocusedTaskCompletion: () => Effect.die("durable conflicting facts must not be reread")
      })
      expect(
        yield* executeIntegrationAction({ _tag: "IdentityFreeAction", proposal }, transition, inertLease, target).pipe(
          Effect.provideService(CompletionTaskBoundary, neverCalledBoundary),
          Effect.provideService(InRunJournal, appendableJournalFor(conflictingRecords))
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
      const attemptOrdinal = CompletionTaskRequestOrdinal.make(1)
      const lookup = CompletionTaskRequestLookupObservedEvent.make({
        attemptOrdinal,
        lookup: CompletionTaskRequestLookup.cases.Applied.make({ request }),
        operationId: OperationId.make(`${request.operationId}:lookup:1`),
        request,
        version: workflowJournalEventVersion
      })
      const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([
        {
          event: lookup,
          key: JournalRecordKey.make("integration-finality-action:applied-lookup"),
          position: JournalPosition.make(1),
          runId: integrationFinalityFixture.runId
        }
      ])
      const boundary = CompletionTaskBoundary.of({
        completeTask: () => Effect.die("focused confirmation never completes the task"),
        readCompletionRequest: () => Effect.die("the Applied lookup is already durable"),
        readFocusedTaskCompletion: (_taskId, _target, operationId) =>
          Effect.succeed({
            ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
            currentClaim: integrationFinalityFixture.claim,
            lifecycle: "Open",
            operationId,
            target
          })
      })
      const transition = RunnableFrontierTransition.ObserveFocusedTaskCompletion({ request, responsibility: started })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing focused completion proposal")
      }

      const appliedLookupResult = yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        inertLease,
        target
      ).pipe(
        Effect.provideService(CompletionTaskBoundary, boundary),
        Effect.provideService(InRunJournal, appendableJournalFor(records))
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
      const transition = RunnableFrontierTransition.CompletePromotedTask({ request, responsibility: started })
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
      const unavailable = yield* Effect.flip(
        executeIntegrationAction(action, transition, inertLease, target).pipe(
          Effect.provideService(InRunJournal, appendableJournalFor(yield* Ref.make<ReadonlyArray<JournalRecord>>([])))
        )
      )
      expect(unavailable).toBeInstanceOf(IntegrationFinalityRuntimeUnavailable)
      expect(
        yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
          Effect.provideService(CompletionTaskBoundary, neverCalledBoundary),
          Effect.provideService(InRunJournal, appendableJournalFor(yield* Ref.make<ReadonlyArray<JournalRecord>>([])))
        )
      ).toMatchObject({ _tag: "ActionDeferred", reason: "CompletionTaskUnavailable" })

      const scenarios = [
        {
          expected: { _tag: "IntegrationFinality.CompletionTaskAuthorizationWait" },
          makeBoundary: () =>
            CompletionTaskBoundary.of({
              completeTask: () => Effect.die("authorization conflict must stop before completion"),
              readCompletionRequest: () => Effect.die("authorization conflict must stop before lookup"),
              readFocusedTaskCompletion: (taskId) =>
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
              readFocusedTaskCompletion: (taskId, _target, operationId) => {
                focusedReadCount += 1
                return focusedReadCount === 1
                  ? Effect.succeed({
                      ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                      currentClaim: integrationFinalityFixture.claim,
                      lifecycle: "Open" as const,
                      operationId,
                      target
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
              readFocusedTaskCompletion: (_taskId, _target, operationId) =>
                Effect.succeed({
                  ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                  currentClaim: integrationFinalityFixture.claim,
                  lifecycle: "Open" as const,
                  operationId,
                  target
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
              readFocusedTaskCompletion: (_taskId, _target, operationId) =>
                Effect.succeed({
                  ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                  currentClaim: integrationFinalityFixture.claim,
                  lifecycle: "Open" as const,
                  operationId,
                  target
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
              readFocusedTaskCompletion: (_taskId, _target, operationId) =>
                Effect.succeed({
                  ...integrationFinalityFixture.focusedSuccessFactsEvent.observation.facts,
                  currentClaim: integrationFinalityFixture.claim,
                  lifecycle: "Open" as const,
                  operationId,
                  target
                })
            })
        }
      ] as const

      for (const scenario of scenarios) {
        const result = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
          Effect.provideService(CompletionTaskBoundary, scenario.makeBoundary()),
          Effect.provideService(TargetPromotionRuntime, completionPromotionRuntime),
          Effect.provideService(EvidenceStore, completionEvidenceStore),
          Effect.provideService(InRunJournal, appendableJournalFor(yield* Ref.make<ReadonlyArray<JournalRecord>>([])))
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
        fresh: [{ step, transition }],
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

  effectIt.effect("propagates a fresh claim position contradiction as a typed action failure", () =>
    Effect.gen(function* () {
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make("claim-binding-contradiction-operation"),
          owner: ClaimOwner.make("dalph"),
          taskId,
          token: ClaimToken.make("claim-binding-contradiction-token")
        },
        predecessorOperationIds: []
      })
      const step = FreshWorkflowStep.AcquireTaskClaim({
        predecessorOperationId: claimOperation.acquisition.operationId,
        task
      })
      const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: claimOperation.acquisition.operationId,
        taskId
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set<OperationId>(),
        fresh: [{ step, transition }],
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (
        proposal === undefined ||
        !isFreshOperationProposal(proposal) ||
        proposal.route._tag !== "FreshWorkflowRoute"
      ) {
        return yield* Effect.die("a fresh claim route must be derivable")
      }

      const claim = ActiveTaskClaim.make({
        operationId: claimOperation.acquisition.operationId,
        owner: claimOperation.acquisition.owner,
        taskId: claimOperation.acquisition.taskId,
        token: claimOperation.acquisition.token
      })
      const contradiction = failPreStartClaimBinding({
        claimOperationId: claimOperation.acquisition.operationId,
        position: undefined,
        reason: "PositionMissing",
        taskId
      })
      const exit = yield* Effect.exit(
        executeFreshWorkflowOperation(
          {
            _tag: "FreshOperationAction",
            operationId: OperationId.make("claim-binding-contradiction-action"),
            proposal
          },
          proposal.route,
          { ...inertLease, bindPreStartTaskWorkPosition: () => contradiction },
          target
        ).pipe(
          Effect.provideService(
            WorkflowInterpreter,
            WorkflowInterpreter.of({
              acquireTaskClaim: (_operation, onIntentRecorded = Effect.void) =>
                onIntentRecorded.pipe(
                  Effect.andThen(Effect.succeed({ _tag: "AuthoritativeTaskClaimAcquired" as const, claim }))
                ),
              readTaskClaim: () => Effect.die("unused claim read"),
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
            TaskClaimAcquisitionPlanner.of({
              plan: (operationId, selectedTaskId) =>
                Effect.succeed({
                  operationId,
                  owner: claimOperation.acquisition.owner,
                  taskId: selectedTaskId,
                  token: claimOperation.acquisition.token
                })
            })
          )
        )
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") return
      expect(
        exit.cause.reasons.some(
          (reason) =>
            Cause.isFailReason(reason) && reason.error instanceof PreStartClaimTaskWorkPositionBindingContradiction
        )
      ).toBe(true)
      expect(exit.cause.reasons.some((reason) => Cause.isDieReason(reason))).toBe(false)
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
        makeTrackerGraphObservationOperation(OperationId.make("fresh-graph-read-success"), target)
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

  effectIt.effect("retains the task position while a continued executor still reports running", () =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing continued executor proposal")
      }
      const releases = yield* Ref.make(0)
      const protocolController = yield* makePlannedAttemptProtocolController()
      const lease: DeliveryActionExecutionLease = {
        ...inertLease,
        releasePlannedAttemptPosition: () => Ref.update(releases, (count) => count + 1),
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }
      const correlation = { attemptId: plannedAttempt.attemptId, runId }
      const report = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("route-matrix-executor-specification"),
        target,
        taskId,
        []
      )
      const specificationRecord = {
        event: TaskTrackerFactsObservedEvent.make({
          observation: makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification),
          operationId: specificationOperation.operationId,
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("route-matrix-executor-specification"),
        position: JournalPosition.make(1),
        runId
      }
      const result = yield* executePlannedAttemptTransition(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        lease
      ).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({
            append: (_runId, key, event) => Effect.succeed({ event, key, position: JournalPosition.make(100), runId }),
            read: () => Effect.succeed([specificationRecord])
          })
        ),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            project: () =>
              Effect.succeed(
                PlannedAttemptExecutorProjection.cases.NoReport.make({
                  correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
                })
              ),
            requestSuspension: () => Effect.die("suspension was not requested"),
            startOrContinue: () => Effect.succeed(report)
          })
        )
      )

      expect(result._tag).toBe("ExecutorReportPublished")
      if (result._tag !== "ExecutorReportPublished") return yield* Effect.die("executor report was not published")
      expect(result.report).toEqual(report)
      expect(yield* Ref.get(releases)).toBe(0)
    })
  )

  effectIt.effect("rejects a recovered continuation without current witnesses before executor contact", () =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWorkAfterCurrentFacts({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt,
        witness: {
          activeTaskContinuationRead: {
            graphObservationOperationId: OperationId.make("missing-current-graph"),
            taskClaimObservationOperationId: OperationId.make("missing-current-claim"),
            taskWorkSpecificationObservationOperationId: OperationId.make("missing-current-specification")
          },
          worktreeObservationOperationId: OperationId.make("missing-current-worktree")
        }
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing current-facts continuation proposal")
      }
      const executorContacts = yield* Ref.make(0)
      const protocolController = yield* makePlannedAttemptProtocolController()
      const lease: DeliveryActionExecutionLease = {
        ...inertLease,
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }
      const failure = yield* executePlannedAttemptTransition(
        { _tag: "IdentityFreeAction", proposal },
        transition,
        lease
      ).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({
            append: () => Effect.die("rejected continuation must not append"),
            read: () => Effect.succeed([])
          })
        ),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            project: () => Effect.die("rejected continuation must not project executor state"),
            requestSuspension: () => Effect.die("rejected continuation must not request suspension"),
            startOrContinue: () =>
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

  effectIt.effect("defers a recovered continuation when newer executor evidence makes its witnesses stale", () =>
    Effect.gen(function* () {
      const graphOperation = makeTrackerGraphObservationOperation(
        OperationId.make("stale-continuation-graph"),
        target,
        [],
        [taskId]
      )
      const witness = {
        activeTaskContinuationRead: {
          graphObservationOperationId: graphOperation.operationId,
          taskClaimObservationOperationId: OperationId.make("stale-continuation-claim"),
          taskWorkSpecificationObservationOperationId: OperationId.make("stale-continuation-specification")
        },
        worktreeObservationOperationId: OperationId.make("stale-continuation-worktree")
      }
      const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWorkAfterCurrentFacts({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt,
        witness
      })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing stale current-facts continuation proposal")
      }
      const record = (position: number, key: JournalRecordKey, event: JournalRecord["event"]): JournalRecord => ({
        event,
        key,
        position: JournalPosition.make(position),
        runId
      })
      const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
      const records = [
        record(
          1,
          plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
          PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        ),
        record(2, intentRecordKey(graphOperation.operationId), taskTrackerReadIntent(graphOperation)),
        record(
          3,
          outcomeRecordKey(graphOperation.operationId),
          taskTrackerGraphFactsObserved(graphOperation, {
            revision: TrackerRevision.make("stale-continuation-graph-revision"),
            taskIds: [taskId]
          })
        ),
        record(
          4,
          plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: reportOrdinal,
            report: PlannedAttemptExecutorReport.cases.Running.make({
              correlation: { attemptId: plannedAttempt.attemptId, runId }
            }),
            version: workflowJournalEventVersion
          })
        )
      ]
      const executorContacts = yield* Ref.make(0)
      const protocolController = yield* makePlannedAttemptProtocolController()
      const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
        ...inertLease,
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({
            append: () => Effect.die("stale continuation must not append"),
            read: () => Effect.succeed(records)
          })
        ),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            project: () => Effect.die("stale continuation must not project executor state"),
            requestSuspension: () => Effect.die("stale continuation must not request suspension"),
            startOrContinue: () =>
              Ref.update(executorContacts, (count) => count + 1).pipe(Effect.andThen(Effect.die("unreachable")))
          })
        )
      )

      expect(result).toMatchObject({ _tag: "ActionDeferred", reason: "ContinuationAuthorizationStale" })
      expect(yield* Ref.get(executorContacts)).toBe(0)
    })
  )

  effectIt.effect("observes executor state when no ambiguous command needs reconciliation", () =>
    Effect.gen(function* () {
      const transition = RunnableFrontierTransition.ObservePlannedAttemptContinuationExecutor({ plannedAttempt })
      const proposal = proposalsFor(transition).proposals[0]
      if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
        return yield* Effect.die("missing executor observation proposal")
      }
      const report = PlannedAttemptExecutorReport.cases.Running.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId }
      })
      const responsibility = {
        event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt,
          version: workflowJournalEventVersion
        }),
        key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
        position: JournalPosition.make(1),
        runId
      }
      const protocolController = yield* makePlannedAttemptProtocolController()
      const result = yield* executePlannedAttemptTransition({ _tag: "IdentityFreeAction", proposal }, transition, {
        ...inertLease,
        withPlannedAttemptProtocol: (correlation, effect) => protocolController.withPermit(correlation, effect)
      }).pipe(
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({
            append: (_requestedRunId, key, event) =>
              Effect.succeed({ event, key, position: JournalPosition.make(2), runId }),
            read: () => Effect.succeed([responsibility])
          })
        ),
        Effect.provideService(
          PlannedAttemptExecutor,
          PlannedAttemptExecutor.of({
            project: () => Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report })),
            requestSuspension: () => Effect.die("observation must not request suspension"),
            startOrContinue: () => Effect.die("observation must not continue executor work")
          })
        )
      )

      expect(result).toMatchObject({ _tag: "ExecutorReportPublished", report })
    })
  )

  effectIt.effect("routes every recovered observation and reconciliation variant through its exact adapter", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (name: string) =>
        Ref.update(calls, (current) => [...current, name]).pipe(Effect.as(undefined as never))
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => record("acquireTaskClaim"),
        readTaskClaim: () => record("readTaskClaim"),
        readTaskWorktree: () => record("readTaskWorktree"),
        readTargetLineage: () => record("readTargetLineage"),
        readTrackerGraph: () => record("readTrackerGraph"),
        readTaskWorkSpecification: () => record("readTaskWorkSpecification"),
        reconcileTaskWorktree: () => record("reconcileTaskWorktree"),
        recordTaskAttemptPlan: () => record("recordTaskAttemptPlan"),
        releaseTaskClaim: () => record("releaseTaskClaim")
      })
      const withAdapterServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(
            InRunJournal,
            InRunJournal.of({ append: () => Effect.die("unused append"), read: () => Effect.succeed([]) })
          ),
          Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
          Effect.provideService(
            TaskClaimAcquisitionPlanner,
            TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planner") })
          ),
          Effect.provideService(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              project: () =>
                Effect.succeed(
                  PlannedAttemptExecutorProjection.cases.NoReport.make({
                    correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
                  })
                ),
              requestSuspension: () => Effect.die("unused executor suspension"),
              startOrContinue: () => Effect.die("unused executor continuation")
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
      const graphOperation = makeTrackerGraphObservationOperation(OperationId.make("adapter-observe-graph"), target)
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
      const directExecutor = yield* withAdapterServices(
        makeLiveDeliveryActionExecutor(runId, target).pipe(
          Effect.provideService(
            DeliveryAcceptedFactPublication,
            DeliveryAcceptedFactPublication.of({ awaitCurrent: Effect.void })
          )
        )
      )
      expect(yield* directExecutor.execute(acceptedAction, inertLease)).toMatchObject({
        _tag: "ActionCompleted",
        proposalId: acceptedProposal.id
      })
      const layeredExecutor = yield* withAdapterServices(
        DeliveryActionExecutor.pipe(
          Effect.provide(liveDeliveryActionExecutorLayer(runId, target)),
          Effect.provideService(
            DeliveryAcceptedFactPublication,
            DeliveryAcceptedFactPublication.of({ awaitCurrent: Effect.void })
          )
        )
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
        Effect.provideService(
          InRunJournal,
          InRunJournal.of({ append: () => Effect.die("unused append"), read: () => Effect.succeed([]) })
        ),
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
