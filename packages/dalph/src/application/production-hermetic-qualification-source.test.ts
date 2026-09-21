import { remotePublicationTargetForTest } from "../../../orchestrator/test/support/direct-publication.js"
import {
  EvidenceDigest,
  EvidenceReference,
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  plannedAttemptExecutorCorrelation,
  RunId,
  RemotePublicationEndpoint,
  RemotePublicationTarget,
  TaskId,
  makeTaskWorkSpecification,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { NodeServices } from "@effect/platform-node"
import {
  ActiveTaskClaim,
  boundedParallelTicketsOf,
  ClaimToken,
  CleanupMutationOrdinal,
  CleanupObservationOrdinal,
  CompletionClaimRequestOrdinal,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  completionTaskCandidateAncestryReadOperationIdFor,
  CompletionTaskClaim,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupIntendedEvent,
  completionTaskRequestLookupOperationIdFor,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal,
  CompletionTaskResponseLostEvent,
  completionClaimDeletionOperationIdFor,
  completionClaimDeletionRequestFor,
  completionClaimReplacementRequestFor,
  completionTaskRequestFor,
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  deliveryProposalIdOf,
  deliverySettlementsOf,
  describeJournalEvent,
  FocusedCompletedTaskObservation,
  FocusedTaskCompletionFacts,
  FocusedTaskCompletionFactsObserved,
  frontierOf,
  freshWorkflowRunId,
  InitialControlPolicy,
  initialRunPolicyRevision,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupAuthorizedEvent,
  IntegratorCandidateCleanupOccurred,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupMutationIntendedEvent,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateCleanupObservationIntendedEvent,
  IntegratorCandidateCleanupObservedEvent,
  IntegratorCandidateCleanupOwner,
  IntegratorCandidateCleanupSettledDisposition,
  IntegratorCandidateText,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  integratorCorrelationFor,
  JournalPosition,
  makeCompleteTaskTrackerFactsObserved,
  makeCompletionTaskFactsObservationOperation,
  makeDeliveryReflection,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeTaskWorkSpecificationObservationOperation,
  makeTraceReader,
  makeWorkflowRunBeganRecord,
  OperationId,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationIntendedEvent,
  RemotePublicationProofBasis,
  RemotePublicationSucceededEvent,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor,
  remoteBaselineCorrelationFor,
  QueuedIntegrationResponsibility,
  RunControlPolicy,
  StartedIntegrationResponsibility,
  TargetLineageObservation,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionIntendedEvent,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionSuccessObservation,
  targetPromotionCorrelationFor,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisition,
  TaskDagSnapshot,
  TaskWorkCapacity,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  ticketDeliveriesOf,
  TraceAtCursor,
  TraceCleanupStatus,
  TraceCursor,
  TraceIntegratorCandidateCleanupProgress,
  TraceIntegratorCandidateCleanupStep,
  TracePositionIdentity,
  TraceWorktreeCleanupProgress,
  TraceWorktreeCleanupStep,
  TrackerGraphState,
  TrackerSnapshot,
  TrackerTask,
  TrackerTarget,
  trackerGraphReadProposalOf,
  trackerRevisionFor,
  githubFocusedCompletionRevisionFor,
  currentSignalOf,
  ProductionRunSelection,
  TaskTrackerMutationThrottled,
  TaskTrackerFactsReadFailed,
  UnclaimedTask,
  UnqueuedAcceptedResult,
  WorkflowJournalEvent,
  WorkflowOperation,
  WorkflowActor,
  WorktreeCleanupAuthorization,
  WorktreeCleanupAuthorizedEvent,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOccurred,
  WorktreeCleanupOwner,
  PlannedAttemptCleanupDisposition,
  type DeliveryActionProposal,
  type TaskTrackerFactsObservation,
  type DeliveryRuntimeObservationState,
  type JournalRecord,
  type TicketDeliveryEvidence,
  type WorkflowOccurrence,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { makeFreshTaskAdmissionTestBasis } from "../../../orchestrator/test/support/fresh-task-admission.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../orchestrator/test/journaled-graph-observation.js"
import { ticketOwnerSnapshotForTest } from "../../../orchestrator/test/support/delivery-runtime-live-owner.js"
import {
  contextFor,
  HermeticQualificationSourceRejected,
  qualificationPlannedAttemptFor,
  validatePlannedAttempt,
  validateSpecification,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import {
  validateCompletionFacts,
  validateGraph,
  validateTrackerFacts
} from "./production-hermetic-qualification-fixture-source.js"
import { validateProposal } from "./production-hermetic-qualification-proposal-source.js"
import { Cause, Effect, Option, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { decodeProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { HermeticFixtureManifest, HermeticRegistrationScopeId } from "./production-hermetic-contract.js"
import {
  currentDeliveryStatusRecord,
  productionCliFailureForSelectedRun,
  productionCliFailureRecord,
  ProductionCliDeliveryError,
  ProductionCliLifecycleError,
  type ProductionCliHostObservation
} from "./production-cli.js"
import {
  hermeticCanonicalRecordDigest,
  HermeticControllerEndpoint,
  HermeticExpectedRecordRegistration
} from "./production-hermetic-provider-bridge.js"
import { withHermeticQualificationFailureRegistration } from "./production-hermetic-qualification-host.js"
import { encodeRuntimeDiagnostic, projectRuntimeCause } from "./runtime-diagnostic.js"
import type { ProductionCliHostRunner } from "./live-cli.js"
// The fixture observes a real qualification HTTP ACK, never a live provider.
// eslint-disable-next-line import/no-nodejs-modules
import { createServer, type ServerResponse } from "node:http"
import {
  validateHermeticQualificationDeliveryFailure,
  validateHermeticQualificationHistory,
  validateHermeticQualificationStatus
} from "./production-hermetic-qualification-source.js"

const fixture = Effect.gen(function* () {
  const configuration = yield* decodeProductionRepositoryHostConfiguration({
    target: { _tag: "GithubIssue", owner: "qualification", repository: "controlled", issueNumber: 1 },
    repository: "/fixture/repository",
    commonDirectory: "/fixture/repository/.git",
    integrationRef: "refs/heads/master",
    plannedAttemptBaseSha: "a".repeat(40),
    plannedAttemptExecutor: "codex:production",
    claimOwner: "qualification",
    taskWorkCapacity: 1,
    journalDatabase: "/fixture/journal.sqlite",
    evidenceStoreRoot: "/fixture/evidence",
    plannedAttemptWorktreeRoot: "/fixture/attempts",
    codexExecutorPrivateStateDirectory: "/fixture/codex-executor-private",
    integratorCandidateWorktreeRoot: "/fixture/candidates",
    integratorPrivateStore: "/fixture/private.json",
    remotePublicationTarget: remotePublicationTargetForTest,
    activationInterval: "1 minute",
    failureCooldown: "5 seconds",
    codexExecutable: "/bin/codex",
    codexClientName: "dalph",
    codexClientVersion: "0.0.0",
    githubToken: "private-credential"
  })
  const manifest = yield* Schema.decodeUnknownEffect(HermeticFixtureManifest)({
    invocationId: "qualification",
    sourceBaseSha: "b".repeat(40),
    builtEntry: "/built/production.js",
    builtEntryDigest: "c".repeat(64),
    repository: configuration.repository,
    commonDirectory: configuration.commonDirectory,
    integrationRef: configuration.integrationRef,
    baseSha: configuration.plannedAttemptBaseSha,
    journalDatabase: configuration.journalDatabase,
    evidenceRoot: configuration.evidenceStoreRoot,
    attemptWorktreeRoot: configuration.plannedAttemptWorktreeRoot,
    codexExecutorPrivateStateDirectory: configuration.codexExecutorPrivateStateDirectory,
    candidateRoot: configuration.integratorCandidateWorktreeRoot,
    privateStore: configuration.integratorPrivateStore,
    ownershipMarker: "/fixture/marker"
  })
  return { configuration, manifest, runId: yield* freshWorkflowRunId(configuration.target) }
}).pipe(Effect.provide(NodeServices.layer))

const readyFor = (
  context: QualificationContext,
  proposals: ReadonlyArray<DeliveryActionProposal>,
  evidence: ReadonlyArray<TicketDeliveryEvidence> = []
): DeliveryRuntimeObservationState => {
  const tasks = [
    TrackerTask.make({ id: context.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] })
  ]
  const projected = TaskDagSnapshot.project(TrackerSnapshot.make({ revision: trackerRevisionFor(tasks), tasks }))
  if (projected._tag === "Invalid") return expect.fail("fixed public task graph must project")
  const observation = makeTestJournaledTrackerGraphObservation({
    snapshot: projected.snapshot,
    operationId: OperationId.make("01990a72-38c0-7000-8000-000000000002"),
    recordedAt: JournalPosition.make(4)
  })
  const graph = TrackerGraphState.cases.GraphEstablished.make({ observation })
  const capacity = TaskWorkCapacity.make(1)
  const policy = RunControlPolicy.make({ revision: initialRunPolicyRevision, taskExecutionCapacity: capacity })
  const tickets = boundedParallelTicketsOf(frontierOf({ exactEvidence: evidence, graph, policy }))
  const deliveries = ticketDeliveriesOf(tickets, evidence)
  const settlements = deliverySettlementsOf(deliveries)
  return {
    _tag: "Ready",
    liveOwners: [],
    evaluation: {
      _tag: "DeliveryRuntimeEvaluation",
      acceptedAt: JournalPosition.make(5),
      runId: context.runId,
      current: {
        _tag: "DeliveryRuntimeSnapshot",
        runId: context.runId,
        cancellationApplied: false,
        reflection: makeDeliveryReflection(settlements),
        settlements,
        ticketDeliveries: deliveries,
        trackerGraph: graph
      },
      pauseCoverage: {
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      },
      proposedActions: { _tag: "DeliveryProposalsAvailable", freshTaskCandidates: [], isolatedIssues: [], proposals },
      quiescence: { _tag: "TrackerReconfirmationAllowed" },
      taskWork: makeFreshTaskAdmissionTestBasis({ capacity, runId: context.runId }),
      cancellationApplied: false
    }
  }
}

const completionFixture = (
  context: QualificationContext,
  positions = { queued: 10, started: 11, lineage: 12, qualified: 13 },
  taskId: QualificationContext["taskId"] = context.taskId
) => {
  const plannedAttempt = qualificationPlannedAttemptFor(context, taskId)
  const integrationTarget = IntegrationTarget.make({
    repository: context.configuration.repository,
    ref: context.configuration.integrationRef
  })
  const responsibility = StartedIntegrationResponsibility.make({
    plannedAttempt,
    integrationTarget,
    acceptedResult: {
      commit: GitCommitSha.make("e".repeat(40)),
      evidenceManifest: EvidenceReference.make({ digest: EvidenceDigest.make("e".repeat(64)), byteLength: 1 })
    },
    queuedAt: JournalPosition.make(positions.queued),
    startedAt: JournalPosition.make(positions.started)
  })
  const lineage = TargetLineageObservation.make({
    plannedBaseSha: plannedAttempt.baseSha,
    targetHeadSha: plannedAttempt.baseSha,
    plannedBaseIsAncestorOfTargetHead: true
  })
  const session = integratorCorrelationFor({
    responsibility,
    targetLineage: lineage,
    targetLineageObservedAt: JournalPosition.make(positions.lineage)
  })
  const run = IntegratorRunCorrelation.make({ session, ordinal: IntegratorRunOrdinal.make(1) })
  const candidate = IntegratorRunQualifiedCandidate.make({
    run,
    candidateCommit: GitCommitSha.make("f".repeat(40)),
    candidateText: IntegratorCandidateText.make("f".repeat(40)),
    directParents: [session.expectedTargetHead, session.acceptedResult.commit],
    qualifiedAt: JournalPosition.make(positions.qualified)
  })
  const originalClaim = ActiveTaskClaim.make({
    taskId,
    owner: context.configuration.claimOwner,
    operationId: OperationId.make("01990a72-38c0-7000-8000-000000000003"),
    token: ClaimToken.make("01990a72-38c0-7000-8000-000000000004")
  })
  const claim = CompletionTaskClaim.make({
    originalClaim,
    plannedAttempt,
    promotionCorrelation: targetPromotionCorrelationFor(candidate)
  })
  const request = completionTaskRequestFor(claim)
  const route = {
    _tag: "IdentityFreeWorkflowRoute",
    transition: { _tag: "CompletePromotedTask", request, responsibility }
  } as const
  const base = trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(5),
    purpose: "EstablishCurrentGraph",
    runId: context.runId,
    target: context.configuration.target
  })
  const proposal: DeliveryActionProposal = {
    ...base,
    route,
    actionIdentity: { _tag: "NoWorkflowOperationIdentity" },
    id: deliveryProposalIdOf(context.runId, route),
    order: {
      _tag: "IntegrationOrder",
      frontierOrdinal: DeliveryProposalOrdinal.make(0),
      taskId: context.taskId,
      queuedAt: responsibility.queuedAt,
      startedAt: responsibility.startedAt
    }
  }
  return { request, proposal, claim, responsibility, candidate, run, lineage }
}

const routeFixtures = (
  context: QualificationContext
): { readonly routes: ReadonlyArray<DeliveryActionProposal["route"]>; readonly context: QualificationContext } => {
  const fixture = completionFixture(context)
  const task = TrackerTask.make({
    id: context.taskId,
    lifecycle: { _tag: "Open" },
    parentTaskId: null,
    prerequisiteIds: []
  })
  const operationId = fixture.claim.originalClaim.operationId
  const plannedAttempt = fixture.claim.plannedAttempt
  const claimOperation = WorkflowOperation.cases.AcquireTaskClaim.make({
    predecessorOperationIds: [],
    authority: { _tag: "TaskSelectionAuthority" },
    acquisition: TaskClaimAcquisition.make({
      taskId: context.taskId,
      owner: context.configuration.claimOwner,
      token: fixture.claim.originalClaim.token,
      operationId
    })
  })
  const queued = QueuedIntegrationResponsibility.make({
    plannedAttempt,
    integrationTarget: fixture.responsibility.integrationTarget,
    acceptedResult: fixture.responsibility.acceptedResult,
    queuedAt: fixture.responsibility.queuedAt,
    preIntegrationCancellation: {
      attemptId: plannedAttempt.attemptId,
      runId: context.runId,
      queuedAt: fixture.responsibility.queuedAt
    }
  })
  const accepted = UnqueuedAcceptedResult.make({
    plannedAttempt,
    acceptedResult: fixture.responsibility.acceptedResult,
    terminalAt: JournalPosition.make(9)
  })
  const focused = makeCompletionTaskFactsObservationOperation(fixture.request, context.configuration.target, {
    _tag: "Confirmation",
    attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(2)
  })
  const success = FocusedCompletedTaskObservation.make({
    claim: fixture.claim,
    lifecycle: "CompletedSuccessfully",
    observedAt: JournalPosition.make(20),
    operationId: focused.operationId,
    taskId: context.taskId,
    taskRevision: context.specification.fingerprint,
    target: context.configuration.target,
    trackerRevision: Effect.runSync(
      githubFocusedCompletionRevisionFor({
        currentClaim: fixture.claim,
        lifecycle: "CompletedSuccessfully",
        target: context.configuration.target,
        targetMembership: "Member",
        taskId: context.taskId,
        taskRevision: context.specification.fingerprint,
        unfinishedPrerequisiteTaskIds: []
      })
    )
  })
  const deletion = completionClaimDeletionRequestFor(fixture.claim, success)
  const routes: ReadonlyArray<DeliveryActionProposal["route"]> = [
    { _tag: "TrackerGraphReadRoute", purpose: "EstablishCurrentGraph", target: context.configuration.target },
    { _tag: "FreshWorkflowRoute", step: { _tag: "AcquireTaskClaim", task, predecessorOperationId: operationId } },
    { _tag: "FreshWorkflowRoute", step: { _tag: "ReadCurrentTaskGraph", task, predecessorOperationId: operationId } },
    {
      _tag: "FreshWorkflowRoute",
      step: { _tag: "ReadPostClaimGraph", task, predecessorOperationId: operationId, claimOperation }
    },
    {
      _tag: "FreshWorkflowRoute",
      step: {
        _tag: "ReadTaskWorkSpecification",
        task,
        predecessorOperationId: operationId,
        claimOperationId: operationId
      }
    },
    {
      _tag: "FreshWorkflowRoute",
      step: {
        _tag: "RecordTaskAttemptPlan",
        task,
        predecessorOperationId: operationId,
        claimOperationId: operationId,
        specification: context.specification
      }
    },
    {
      _tag: "FreshWorkflowRoute",
      step: {
        _tag: "ReconcileTaskWorktree",
        task,
        predecessorOperationId: operationId,
        claimOperationId: operationId,
        plannedAttempt
      }
    },
    {
      _tag: "FreshExecutorWorkflowRoute",
      step: {
        _tag: "BeginPlannedAttemptExecutorWork",
        task,
        plannedAttempt,
        claimOperationId: operationId,
        specification: context.specification
      }
    },
    {
      _tag: "FreshExecutorWorkflowRoute",
      step: {
        _tag: "ObservePlannedAttemptExecutorWork",
        task,
        plannedAttempt,
        specification: context.specification,
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(6) }
      }
    },
    {
      _tag: "RecoveredNewActionRoute",
      action: {
        _tag: "ReadTrackerGraph",
        plannedAttempt,
        operation: {
          _tag: "ReadTrackerGraph",
          cause: { _tag: "ExecutingWorkAuthorityCheck" },
          predecessorOperationIds: [operationId],
          readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [context.taskId] },
          target: context.configuration.target
        }
      }
    },
    {
      _tag: "RecoveredNewActionRoute",
      action: {
        _tag: "ReadTaskWorkSpecification",
        plannedAttempt,
        operation: {
          _tag: "ReadTaskWorkSpecification",
          predecessorOperationIds: [operationId],
          taskId: context.taskId,
          target: context.configuration.target
        }
      }
    },
    {
      _tag: "RecoveredNewActionRoute",
      action: {
        _tag: "ReadTaskWorktree",
        plannedAttempt,
        operation: { _tag: "ReadTaskWorktree", predecessorOperationIds: [operationId], plannedAttempt }
      }
    },
    {
      _tag: "RecoveredNewActionRoute",
      action: {
        _tag: "ReadTargetLineage",
        plannedAttempt,
        operation: {
          _tag: "ReadTargetLineage",
          plannedAttempt,
          predecessorOperationIds: [],
          integrationTarget: fixture.responsibility.integrationTarget
        }
      }
    },
    {
      _tag: "RecoveredNewActionRoute",
      action: {
        _tag: "ReadTaskClaim",
        plannedAttempt,
        taskId: context.taskId,
        operation: {
          _tag: "ReadTaskClaim",
          predecessorOperationIds: [],
          target: context.configuration.target,
          taskId: context.taskId
        }
      }
    },
    ...(["CheckTaskClaim", "ReconcileTaskWorktree", "ReconcileTaskClaimRelease"] as const).map((_tag) => ({
      _tag: "AcceptedWorkflowRoute" as const,
      transition: { _tag, operationId, taskId: context.taskId }
    })),
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "QueueAcceptedResultIntegrationResponsibility",
        accepted,
        integrationTarget: fixture.responsibility.integrationTarget
      }
    },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "EstablishRemoteBaseline",
        correlation: remoteBaselineCorrelationFor(
          context.runId,
          {
            acceptedResult: fixture.responsibility.acceptedResult,
            integrationTarget: fixture.responsibility.integrationTarget,
            plannedAttempt: fixture.responsibility.plannedAttempt,
            queuedAt: fixture.responsibility.queuedAt,
            startedAt: fixture.responsibility.startedAt
          },
          fixture.responsibility.integrationTarget,
          context.configuration.remotePublicationTarget
        ),
        responsibility: fixture.responsibility
      }
    },
    { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "StartQueuedIntegration", responsibility: queued } },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: { _tag: "AcquireStartedIntegrationTarget", responsibility: fixture.responsibility }
    },
    { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "ReconcilePlannedAttemptExecutorWork", plannedAttempt } },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "RunIntegrator",
        responsibility: fixture.responsibility,
        lineage: fixture.lineage,
        lineageObservedAt: JournalPosition.make(12),
        run: fixture.run
      }
    },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "RunTargetPromotion",
        responsibility: fixture.responsibility,
        candidate: fixture.candidate,
        publication: RemotePublicationSucceededEvent.make({
          correlation: remotePublicationCorrelationFor(
            fixture.candidate,
            context.configuration.remotePublicationTarget
          ),
          occurrenceClassification: "NonActionOccurrence",
          proof: RemotePublicationProofBasis.cases.PushApplied.make({
            attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
            remoteHead: fixture.candidate.candidateCommit
          }),
          version: workflowJournalEventVersion
        })
      }
    },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "RecordPromotionStaleIntegrationQuarantine",
        responsibility: fixture.responsibility,
        input: { correlation: fixture.claim.promotionCorrelation, targetPromotionStaleAt: JournalPosition.make(14) }
      }
    },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "ReplacePromotedTaskClaim",
        responsibility: fixture.responsibility,
        request: completionClaimReplacementRequestFor(fixture.claim)
      }
    },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: { _tag: "CompletePromotedTask", responsibility: fixture.responsibility, request: fixture.request }
    },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "ObserveFocusedTaskCompletion",
        responsibility: fixture.responsibility,
        request: fixture.request
      }
    },
    {
      _tag: "IdentityFreeWorkflowRoute",
      transition: {
        _tag: "DeleteCompletedTaskCompletionClaim",
        responsibility: fixture.responsibility,
        request: deletion,
        replacementOperationId: completionClaimReplacementRequestFor(fixture.claim).operationId
      }
    }
  ]
  return { routes, context: { ...context, derivedOperationIds: [focused.operationId] } }
}

const specificationHistory = (context: QualificationContext, specification: TaskWorkSpecification) => {
  const operation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make("01990a72-38c0-7000-8000-000000000005"),
    context.configuration.target,
    context.taskId
  )
  const event = taskTrackerReadIntent(operation)
  const observed = taskTrackerFactsObservedEvent(
    operation.operationId,
    makeFocusedTaskWorkSpecificationFactsObserved(operation, specification)
  )
  const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
    event,
    position: JournalPosition.make(position),
    runId: context.runId,
    key: describeJournalEvent(event).expectedKey
  })
  const records = [
    makeWorkflowRunBeganRecord(
      context.runId,
      context.configuration.target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      remotePublicationTargetForTest
    ),
    record(2, event),
    record(3, observed)
  ]
  return makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
    TraceCursor.make({ runId: context.runId, position: JournalPosition.make(3) })
  )
}

const executorHistory = (context: QualificationContext, taskId: QualificationContext["taskId"], foreign = false) => {
  const plannedAttempt = qualificationPlannedAttemptFor(context, taskId)
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const report = {
    _tag: "ExecutorWorkExecuting" as const,
    correlation: foreign ? { ...correlation, attemptId: AttemptId.make("foreign-attempt") } : correlation
  }
  const events = [
    TaskAttemptPlannedEvent.make({
      operation: WorkflowOperation.cases.RecordTaskAttemptPlan.make({
        operationId: OperationId.make("01990a72-38c0-7000-8000-000000000099"),
        plannedAttempt,
        predecessorOperationIds: []
      }),
      version: workflowJournalEventVersion
    }),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion }),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Begin",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      plannedAttempt,
      version: workflowJournalEventVersion
    }),
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(1),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report,
      version: workflowJournalEventVersion
    }),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report,
      version: workflowJournalEventVersion
    })
  ]
  const records: ReadonlyArray<JournalRecord> = [
    makeWorkflowRunBeganRecord(
      context.runId,
      context.configuration.target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      remotePublicationTargetForTest
    ),
    ...events.map((event, offset) => ({
      event,
      position: JournalPosition.make(offset + 2),
      runId: context.runId,
      key: describeJournalEvent(event).expectedKey
    }))
  ]
  return makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
    TraceCursor.make({ runId: context.runId, position: JournalPosition.make(records.length) })
  )
}

const lookupHistory = (context: QualificationContext, detail: string, acknowledged = false) => {
  const { candidate, claim, lineage, request, responsibility } = completionFixture(context, {
    queued: 7,
    started: 8,
    lineage: 10,
    qualified: 15
  })
  const attemptOrdinal = CompletionTaskRequestOrdinal.make(1)
  const purpose = {
    _tag: "Authorization" as const,
    attemptOrdinal,
    authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
  }
  const operation = makeCompletionTaskFactsObservationOperation(request, context.configuration.target, purpose)
  const facts = FocusedTaskCompletionFacts.make({
    operationId: operation.operationId,
    taskId: context.taskId,
    taskRevision: context.specification.fingerprint,
    trackerRevision: Effect.runSync(
      githubFocusedCompletionRevisionFor({
        currentClaim: claim,
        lifecycle: "Open",
        target: context.configuration.target,
        targetMembership: "Member",
        taskId: context.taskId,
        taskRevision: context.specification.fingerprint,
        unfinishedPrerequisiteTaskIds: []
      })
    ),
    target: context.configuration.target,
    lifecycle: "Open",
    targetMembership: "Member",
    currentClaim: claim,
    unfinishedPrerequisiteTaskIds: []
  })
  const observation = FocusedTaskCompletionFactsObserved.make({
    facts,
    operationId: operation.operationId,
    purpose,
    request,
    target: context.configuration.target
  })
  const ancestryOperationId = completionTaskCandidateAncestryReadOperationIdFor(request, purpose)
  const lookupOperationId = completionTaskRequestLookupOperationIdFor(request, attemptOrdinal)
  const confirmation = makeCompletionTaskFactsObservationOperation(request, context.configuration.target, {
    _tag: "Confirmation",
    attemptOrdinal,
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
  })
  const confirmationObservation = FocusedTaskCompletionFactsObserved.make({
    request,
    purpose: confirmation.purpose,
    operationId: confirmation.operationId,
    target: context.configuration.target,
    facts: FocusedTaskCompletionFacts.make({ ...facts, operationId: confirmation.operationId })
  })
  const lineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
    operationId: OperationId.make("01990a72-38c0-7000-8000-000000000009"),
    plannedAttempt: claim.plannedAttempt,
    integrationTarget: responsibility.integrationTarget,
    predecessorOperationIds: []
  })
  const event = (value: JournalRecord["event"]) => WorkflowJournalEvent.make(value)
  const events = [
    event({
      _tag: "TaskClaimAcquisitionIntended",
      operation: WorkflowOperation.cases.AcquireTaskClaim.make({
        acquisition: {
          operationId: claim.originalClaim.operationId,
          taskId: context.taskId,
          owner: claim.originalClaim.owner,
          token: claim.originalClaim.token
        },
        authority: { _tag: "TaskSelectionAuthority" },
        predecessorOperationIds: []
      }),
      version: workflowJournalEventVersion
    }),
    TaskClaimAcquiredEvent.make({ claim: claim.originalClaim, version: workflowJournalEventVersion }),
    TaskAttemptPlannedEvent.make({
      operation: WorkflowOperation.cases.RecordTaskAttemptPlan.make({
        operationId: OperationId.make("01990a72-38c0-7000-8000-000000000008"),
        plannedAttempt: claim.plannedAttempt,
        predecessorOperationIds: [claim.originalClaim.operationId]
      }),
      version: workflowJournalEventVersion
    }),
    event({
      _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
      plannedAttempt: claim.plannedAttempt,
      version: workflowJournalEventVersion
    }),
    event({
      _tag: "PlannedAttemptExecutorWorkReported",
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: {
        _tag: "ExecutorWorkTerminal",
        correlation: { runId: context.runId, attemptId: claim.plannedAttempt.attemptId },
        result: { _tag: "Accepted", acceptedResult: responsibility.acceptedResult }
      },
      version: workflowJournalEventVersion
    }),
    event({
      _tag: "IntegrationResponsibilityBegan",
      plannedAttempt: claim.plannedAttempt,
      acceptedResult: responsibility.acceptedResult,
      integrationTarget: responsibility.integrationTarget,
      version: workflowJournalEventVersion
    }),
    event({
      _tag: "IntegrationStarted",
      plannedAttempt: claim.plannedAttempt,
      acceptedResult: responsibility.acceptedResult,
      integrationTarget: responsibility.integrationTarget,
      responsibilityBeganAt: responsibility.queuedAt,
      version: workflowJournalEventVersion
    }),
    event({
      _tag: "GitReadIntentRecorded",
      operation: lineageOperation,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    event({
      _tag: "TargetLineageObserved",
      observation: lineage,
      operationId: lineageOperation.operationId,
      plannedAttempt: claim.plannedAttempt,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    }),
    event({ _tag: "IntegratorSessionFixed", correlation: candidate.run.session, version: workflowJournalEventVersion }),
    event({ _tag: "IntegratorRunStarted", run: candidate.run, version: workflowJournalEventVersion }),
    event({
      _tag: "IntegratorRunResultRecorded",
      run: candidate.run,
      result: { _tag: "PreparedCandidate", correlation: candidate.run, candidateText: candidate.candidateText },
      version: workflowJournalEventVersion
    }),
    event({
      _tag: "IntegratorRunCandidateGitReadIntended",
      run: candidate.run,
      candidateText: candidate.candidateText,
      version: workflowJournalEventVersion
    }),
    WorkflowJournalEvent.make({
      _tag: "IntegratorRunCandidateGitObserved",
      run: candidate.run,
      candidateText: candidate.candidateText,
      observation: {
        _tag: "Commit",
        candidateText: candidate.candidateText,
        commit: candidate.candidateCommit,
        directParents: candidate.directParents
      },
      version: workflowJournalEventVersion
    }),
    RemotePublicationIntendedEvent.make({
      correlation: remotePublicationCorrelationFor(candidate, context.configuration.remotePublicationTarget),
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    RemotePublicationAttemptIntendedEvent.make({
      correlation: remotePublicationCorrelationFor(candidate, context.configuration.remotePublicationTarget),
      attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      refspec: remotePublicationRefspecFor(
        candidate.candidateCommit,
        context.configuration.remotePublicationTarget.branch
      ),
      version: workflowJournalEventVersion
    }),
    RemotePublicationSucceededEvent.make({
      correlation: remotePublicationCorrelationFor(candidate, context.configuration.remotePublicationTarget),
      occurrenceClassification: "NonActionOccurrence",
      proof: RemotePublicationProofBasis.cases.PushApplied.make({
        attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
        remoteHead: candidate.candidateCommit
      }),
      version: workflowJournalEventVersion
    }),
    TargetPromotionIntendedEvent.make({
      correlation: claim.promotionCorrelation,
      version: workflowJournalEventVersion
    }),
    TargetPromotionAttemptIntendedEvent.make({
      correlation: claim.promotionCorrelation,
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
      reason: {
        _tag: "Initial",
        observedHeadSha: claim.promotionCorrelation.qualifiedCandidate.run.session.expectedTargetHead
      },
      version: workflowJournalEventVersion
    }),
    TargetPromotionObservedSuccessEvent.make({
      correlation: claim.promotionCorrelation,
      basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
      observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
        candidateAncestry: "Current",
        targetHeadSha: candidate.candidateCommit
      }),
      version: workflowJournalEventVersion
    }),
    CompletionClaimReplacementIntendedEvent.make({
      claim,
      operationId: completionClaimReplacementRequestFor(claim).operationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimReplacementAttemptIntendedEvent.make({
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      claim,
      operationId: completionClaimReplacementRequestFor(claim).operationId,
      version: workflowJournalEventVersion
    }),
    CompletionClaimReplacedEvent.make({
      claim,
      operationId: completionClaimReplacementRequestFor(claim).operationId,
      version: workflowJournalEventVersion
    }),
    taskTrackerReadIntent(operation),
    taskTrackerFactsObservedEvent(operation.operationId, observation),
    CompletionTaskCandidateAncestryReadIntendedEvent.make({
      request,
      attemptOrdinal,
      operationId: ancestryOperationId,
      version: workflowJournalEventVersion
    }),
    CompletionTaskCandidateAncestryObservedEvent.make({
      request,
      attemptOrdinal,
      operationId: ancestryOperationId,
      observation: { _tag: "CandidateCurrent", currentHeadSha: candidate.candidateCommit },
      version: workflowJournalEventVersion
    }),
    CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion }),
    CompletionTaskAttemptIntendedEvent.make({
      request,
      attemptOrdinal,
      focusedFactsOperationId: operation.operationId,
      gitReadOperationId: ancestryOperationId,
      version: workflowJournalEventVersion
    }),
    acknowledged
      ? WorkflowJournalEvent.make({
          _tag: "CompletionTaskAcknowledged",
          request,
          attemptOrdinal,
          acknowledgement: { operationId: request.operationId, taskId: request.taskId },
          version: workflowJournalEventVersion
        })
      : CompletionTaskResponseLostEvent.make({ request, attemptOrdinal, version: workflowJournalEventVersion }),
    taskTrackerReadIntent(confirmation),
    taskTrackerFactsObservedEvent(confirmation.operationId, confirmationObservation),
    CompletionTaskRequestLookupIntendedEvent.make({
      request,
      attemptOrdinal,
      operationId: lookupOperationId,
      version: workflowJournalEventVersion
    }),
    CompletionTaskRequestLookupObservedEvent.make({
      request,
      attemptOrdinal,
      operationId: lookupOperationId,
      lookup: CompletionTaskRequestLookup.cases.Unreadable.make({ request, detail }),
      version: workflowJournalEventVersion
    })
  ]
  const selectedEvents = acknowledged
    ? events.slice(0, events.findIndex((event) => event._tag === "CompletionTaskAcknowledged") + 1)
    : events
  const records: Array<JournalRecord> = [
    makeWorkflowRunBeganRecord(
      context.runId,
      context.configuration.target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      remotePublicationTargetForTest
    ),
    ...selectedEvents.map((event, index) => ({
      event,
      position: JournalPosition.make(index + 2),
      runId: context.runId,
      key: describeJournalEvent(event).expectedKey
    }))
  ]
  return makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
    TraceCursor.make({ runId: context.runId, position: JournalPosition.make(selectedEvents.length + 1) })
  )
}

type CompletionSourceEvent = Extract<
  WorkflowOccurrence,
  { readonly _tag: "IntegrationFocusedCompletionOccurred" }
>["event"]
const proposalForRoute = (
  route: DeliveryActionProposal["route"],
  context: QualificationContext
): DeliveryActionProposal => {
  const base = trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(5),
    purpose: "EstablishCurrentGraph",
    runId: context.runId,
    target: context.configuration.target
  })
  const id = deliveryProposalIdOf(context.runId, route)
  switch (route._tag) {
    case "AcceptedWorkflowRoute":
      return { ...base, route, id, actionIdentity: { _tag: "ExistingOperationId" } }
    case "IdentityFreeWorkflowRoute":
    case "FreshExecutorWorkflowRoute":
      return { ...base, route, id, actionIdentity: { _tag: "NoWorkflowOperationIdentity" } }
    case "FreshWorkflowRoute": {
      const step = route.step
      if (step._tag === "RecordTaskAttemptPlan")
        return {
          ...base,
          route: { ...route, step },
          id,
          actionIdentity: { _tag: "FreshOperationAndAttemptIdsRequired" }
        }
      return {
        ...base,
        route: { ...route, step },
        id,
        actionIdentity: { _tag: "FreshOperationIdRequired", source: { _tag: "Allocate" } }
      }
    }
    case "RecoveredNewActionRoute":
    case "TrackerGraphReadRoute":
      return { ...base, route, id, actionIdentity: { _tag: "FreshOperationIdRequired", source: { _tag: "Allocate" } } }
    default:
      return expect.fail("route fixture contains an unsupported delivery route")
  }
}
// Start from an ordinary reader's snapshot and keep its item/facet projections coherent while counterfeiting only a nested source atom.
const coherentCompletionMutation = (
  snapshot: TraceAtCursor,
  mutate: (event: CompletionSourceEvent) => CompletionSourceEvent
): TraceAtCursor =>
  TraceAtCursor.make({
    ...snapshot,
    items: snapshot.items.map((item) => {
      if (item.occurrence._tag !== "IntegrationFocusedCompletionOccurred") return item
      const event = mutate(item.occurrence.event)
      const operationIds =
        event._tag === "CompletionTaskAttemptIntended"
          ? [...new Set([event.request.operationId, event.focusedFactsOperationId, event.gitReadOperationId])]
          : event._tag === "CompletionTaskAcknowledged"
            ? [...new Set([event.request.operationId, event.acknowledgement.operationId])]
            : item.operationIds
      return { ...item, operationIds, occurrence: { ...item.occurrence, event } }
    }),
    facets: {
      ...snapshot.facets,
      integration: {
        ...snapshot.facets.integration,
        facts: snapshot.facets.integration.facts.map((fact) =>
          fact._tag === "FocusedCompletion" ? { ...fact, event: mutate(fact.event) } : fact
        )
      }
    }
  })

const candidateCleanupHistory = Effect.fn("QualificationTest.candidateCleanupHistory")(function* (
  context: QualificationContext,
  overrides: Partial<{ observationOperationId: OperationId; mutationOperationId: OperationId }> = {},
  through: "ObservationIntent" | "MutationIntent" = "MutationIntent"
) {
  const { candidate, claim } = completionFixture(context)
  const session = candidate.run.session
  const authorizationOperationId = OperationId.make(`disposition-cleanup:integrator-candidate:${session.sessionId}`)
  const observationOrdinal = CleanupObservationOrdinal.make(1)
  const mutationAttempt = CleanupMutationOrdinal.make(1)
  const observationOperationId =
    overrides.observationOperationId ?? OperationId.make(`${authorizationOperationId}:observe:${observationOrdinal}`)
  const mutationOperationId =
    overrides.mutationOperationId ?? OperationId.make(`${authorizationOperationId}:mutation:${mutationAttempt}`)
  const settlementOperationId = completionClaimDeletionOperationIdFor(claim)
  const authorization = IntegratorCandidateCleanupAuthorization.make({
    causalPredecessors: [settlementOperationId],
    disposition: IntegratorCandidateCleanupSettledDisposition.make({
      dispositionAt: JournalPosition.make(30),
      qualifiedCandidate: candidate,
      settlementOperationId
    }),
    evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
    locator: session.candidateResource,
    observationAt: session.targetLineageObservedAt,
    observationOperationId: OperationId.make("qualification-candidate-lineage"),
    operationId: authorizationOperationId,
    owner: IntegratorCandidateCleanupOwner.make({ sessionId: session.sessionId }),
    writerQuiescent: true
  })
  const events = [
    IntegratorCandidateCleanupAuthorizedEvent.make({
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    IntegratorCandidateCleanupObservationIntendedEvent.make({
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operationId: observationOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    }),
    IntegratorCandidateCleanupObservedEvent.make({
      authorization,
      observation: IntegratorCandidateCleanupObservation.cases.Present.make({
        locator: session.candidateResource,
        revision: authorization.evidenceRevision,
        sessionId: session.sessionId,
        writerQuiescent: true
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: observationOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    }),
    IntegratorCandidateCleanupMutationIntendedEvent.make({
      attempt: mutationAttempt,
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operationId: mutationOperationId,
      version: workflowJournalEventVersion
    })
  ]
  const selectedEvents = through === "ObservationIntent" ? events.slice(0, 2) : events
  const base = yield* specificationHistory(context, context.specification)
  const start = Number(base.cursor.position)
  const items = selectedEvents.map((event, index) => {
    const position = JournalPosition.make(start + index + 1)
    const occurrence = IntegratorCandidateCleanupOccurred.make({
      event,
      occurrenceClassification: "NonActionOccurrence",
      recordedAt: position,
      runId: context.runId
    })
    return {
      identity: TracePositionIdentity.make({ position, runId: context.runId }),
      occurrence,
      operationIds: "operationId" in event ? [event.operationId] : [authorization.operationId],
      taskIds: [context.taskId]
    }
  })
  const pendingSource = TracePositionIdentity.make({
    position: JournalPosition.make(start + selectedEvents.length),
    runId: context.runId
  })
  return TraceAtCursor.make({
    ...base,
    cursor: TraceCursor.make({ runId: context.runId, position: JournalPosition.make(start + selectedEvents.length) }),
    facets: {
      ...base.facets,
      controlDisposition: {
        ...base.facets.controlDisposition,
        cleanup: [
          ...base.facets.controlDisposition.cleanup,
          TraceIntegratorCandidateCleanupProgress.make({
            authorization,
            status:
              through === "ObservationIntent"
                ? TraceCleanupStatus.cases.ObservationPending.make({ source: pendingSource })
                : TraceCleanupStatus.cases.MutationPending.make({ source: pendingSource }),
            steps: items.map(({ identity, occurrence }) =>
              TraceIntegratorCandidateCleanupStep.make({ event: occurrence.event, source: identity })
            )
          })
        ]
      }
    },
    items: [...base.items, ...items]
  })
})

const worktreeCleanupAuthorizationHistory = Effect.fn("QualificationTest.worktreeCleanupAuthorizationHistory")(
  function* (context: QualificationContext, taskId: QualificationContext["taskId"]) {
    const { claim, responsibility } = completionFixture(context, undefined, taskId)
    const plannedAttempt = responsibility.plannedAttempt
    const settlementOperationId = completionClaimDeletionOperationIdFor(claim)
    const authorization = WorktreeCleanupAuthorization.make({
      causalPredecessors: [settlementOperationId],
      disposition: PlannedAttemptCleanupDisposition.cases.Settled.make({
        dispositionAt: JournalPosition.make(30),
        plannedAttempt,
        settlementOperationId
      }),
      evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
      expectedHead: responsibility.acceptedResult.commit,
      locator: plannedAttempt.worktree,
      observationAt: JournalPosition.make(9),
      observationOperationId: OperationId.make("01990a72-38c0-7000-8000-000000000098"),
      operationId: OperationId.make(`disposition-cleanup:worktree:${plannedAttempt.attemptId}`),
      owner: WorktreeCleanupOwner.make({ attemptId: plannedAttempt.attemptId, branch: plannedAttempt.branch }),
      writerQuiescent: true
    })
    const event = WorktreeCleanupAuthorizedEvent.make({
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
    const base = yield* specificationHistory(context, context.specification)
    const position = JournalPosition.make(31)
    const identity = TracePositionIdentity.make({ position, runId: context.runId })
    const occurrence = WorktreeCleanupOccurred.make({
      event,
      occurrenceClassification: "NonActionOccurrence",
      recordedAt: position,
      runId: context.runId
    })
    const item = { identity, occurrence, operationIds: [authorization.operationId], taskIds: [taskId] }
    return TraceAtCursor.make({
      ...base,
      cursor: TraceCursor.make({ runId: context.runId, position }),
      facets: {
        ...base.facets,
        controlDisposition: {
          ...base.facets.controlDisposition,
          cleanup: [
            ...base.facets.controlDisposition.cleanup,
            TraceWorktreeCleanupProgress.make({
              authorization,
              status: TraceCleanupStatus.cases.Authorized.make({ source: identity }),
              steps: [TraceWorktreeCleanupStep.make({ event, source: identity })]
            })
          ]
        }
      },
      items: [...base.items, item]
    })
  }
)

const controlledRegistrationServer = async () => {
  let calls = 0
  let receive: (registration: {
    readonly response: ServerResponse
    readonly body: unknown
    readonly scope: string | Array<string> | undefined
  }) => void = () => undefined
  const captured = new Promise<{
    readonly response: ServerResponse
    readonly body: unknown
    readonly scope: string | Array<string> | undefined
  }>((resolve) => {
    receive = resolve
  })
  const server = createServer((request, response) => {
    calls += 1
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () =>
      receive({ response, body: JSON.parse(body), scope: request.headers["x-dalph-registration-scope"] })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("controlled HTTP server has no TCP address")
  return {
    endpoint: HermeticControllerEndpoint.make(`http://127.0.0.1:${address.port}`),
    captured,
    calls: () => calls,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      )
    }
  }
}

describe("qualification original source boundary", () => {
  it("binds both exact fixture tasks while rejecting foreign attempt and specification identities", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const dependantAttempt = qualificationPlannedAttemptFor(context, context.dependantTaskId)

    expect(await Effect.runPromise(validateSpecification(context.dependantSpecification, context))).toEqual(
      context.dependantSpecification
    )
    expect(await Effect.runPromise(validatePlannedAttempt(dependantAttempt, context))).toEqual(dependantAttempt)

    const foreignTaskId = TaskId.make("qualification-foreign-task")
    const foreignSpecification = makeTaskWorkSpecification({
      body: context.dependantSpecification.body,
      taskId: foreignTaskId,
      title: context.dependantSpecification.title
    })
    expect(
      await Effect.runPromise(validateSpecification(foreignSpecification, context).pipe(Effect.flip))
    ).toBeInstanceOf(HermeticQualificationSourceRejected)
    expect(
      await Effect.runPromise(
        validatePlannedAttempt({ ...dependantAttempt, taskId: foreignTaskId }, context).pipe(Effect.flip)
      )
    ).toBeInstanceOf(HermeticQualificationSourceRejected)
  })

  it("acknowledges an outer host throttle using the original Ready or closed final source before propagation", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const completion = completionFixture(context)
    const ready = readyFor(context, [completion.proposal])
    if (ready._tag !== "Ready") throw new Error("pure source fixture must be ready")
    const throttle = new TaskTrackerMutationThrottled({
      operation: "CompleteTask",
      operationId: completion.request.operationId,
      retry: null,
      detail: "controlled HTTP429"
    })
    const mapped = productionCliFailureForSelectedRun(throttle, runId)
    if (mapped?._tag !== "ProductionCliDeliveryError")
      throw new Error("controlled throttle must map to the literal delivery failure")
    const scope = HermeticRegistrationScopeId.make("controlled-registration-scope")
    for (const state of [ready, { _tag: "Closed" as const, final: ready }]) {
      const transport = await controlledRegistrationServer()
      try {
        const observation: ProductionCliHostObservation = {
          current: currentSignalOf(state),
          acceptedHistory: currentSignalOf(TraceCursor.make({ runId, position: JournalPosition.make(1) })),
          selection: ProductionRunSelection.cases.Allocated.make({ runId }),
          runTermination: { await: Effect.never, poll: Effect.succeed(Option.none()) },
          traceReader: { readAt: () => Effect.die(new Error("history is not read by this failure fixture")) }
        }
        const ordinary: ProductionCliHostRunner<TaskTrackerMutationThrottled, never> = (_configuration, use) =>
          use(observation, { requestExit: Effect.never }).pipe(Effect.andThen(Effect.fail(throttle)))
        const host = withHermeticQualificationFailureRegistration(manifest, transport.endpoint, scope, ordinary)
        let propagated = false
        const result = Effect.runPromiseExit(host(configuration, () => Effect.void)).then((exit) => {
          propagated = true
          return exit
        })
        const captured = await transport.captured
        expect(propagated).toBe(false)
        expect(captured.scope).toBe(scope)
        const registration = Schema.decodeUnknownSync(HermeticExpectedRecordRegistration, {
          onExcessProperty: "error"
        })(captured.body)
        expect(registration.digest).toBe(hermeticCanonicalRecordDigest(productionCliFailureRecord(mapped)))
        captured.response.end("{}")
        const exit = await result
        if (exit._tag !== "Failure") throw new Error("original throttle must propagate")
        expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBe(throttle)
        expect(transport.calls()).toBe(1)
      } finally {
        await transport.close()
      }
    }
  })

  it("preserves an observed callback error without fabricating a delivery registration", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const transport = await controlledRegistrationServer()
    try {
      const error = new ProductionCliLifecycleError({
        code: "lifecycle.exit_failed",
        detail: "controlled exit failure",
        subject: runId
      })
      const observation: ProductionCliHostObservation = {
        current: currentSignalOf({ _tag: "NotReady" }),
        acceptedHistory: currentSignalOf(TraceCursor.make({ runId, position: JournalPosition.make(1) })),
        selection: ProductionRunSelection.cases.Allocated.make({ runId }),
        runTermination: { await: Effect.never, poll: Effect.succeed(Option.none()) },
        traceReader: { readAt: () => Effect.never }
      }
      const ordinary: ProductionCliHostRunner<never, never> = (_configuration, use) =>
        use(observation, { requestExit: Effect.never })
      const host = withHermeticQualificationFailureRegistration(
        manifest,
        transport.endpoint,
        HermeticRegistrationScopeId.make("controlled-registration-scope"),
        ordinary
      )
      const observed = await Effect.runPromise(host(configuration, () => Effect.fail(error)).pipe(Effect.flip))
      expect(observed).toBe(error)
      expect(transport.calls()).toBe(0)
    } finally {
      await transport.close()
    }
  })

  it("rejects absent original observations and missing current or closed final completion sources without registration", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const completion = completionFixture(context)
    const raw = new TaskTrackerMutationThrottled({
      operation: "CompleteTask",
      operationId: completion.request.operationId,
      retry: null,
      detail: "controlled HTTP429"
    })
    const mapped = productionCliFailureForSelectedRun(raw, runId)
    if (mapped?._tag !== "ProductionCliDeliveryError") throw new Error("controlled throttle must map")
    const transport = await controlledRegistrationServer()
    try {
      const scope = HermeticRegistrationScopeId.make("controlled-registration-scope")
      for (const error of [raw, mapped]) {
        const ordinary: ProductionCliHostRunner<typeof error, never> = () => Effect.fail(error)
        const exit = await Effect.runPromiseExit(
          withHermeticQualificationFailureRegistration(
            manifest,
            transport.endpoint,
            scope,
            ordinary
          )(configuration, () => Effect.void)
        )
        if (exit._tag !== "Failure") throw new Error("missing source must reject")
        expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBeInstanceOf(HermeticQualificationSourceRejected)
      }
      for (const state of [{ _tag: "NotReady" } as const, { _tag: "Closed", final: null } as const]) {
        const observation: ProductionCliHostObservation = {
          current: currentSignalOf(state),
          acceptedHistory: currentSignalOf(TraceCursor.make({ runId, position: JournalPosition.make(1) })),
          selection: ProductionRunSelection.cases.Allocated.make({ runId }),
          runTermination: { await: Effect.never, poll: Effect.succeed(Option.none()) },
          traceReader: { readAt: () => Effect.never }
        }
        const ordinary: ProductionCliHostRunner<TaskTrackerMutationThrottled, never> = (_configuration, use) =>
          use(observation, { requestExit: Effect.never }).pipe(Effect.andThen(Effect.fail(raw)))
        const exit = await Effect.runPromiseExit(
          withHermeticQualificationFailureRegistration(
            manifest,
            transport.endpoint,
            scope,
            ordinary
          )(configuration, () => Effect.void)
        )
        if (exit._tag !== "Failure") throw new Error("missing final source must reject")
        expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBeInstanceOf(HermeticQualificationSourceRejected)
      }
      expect(transport.calls()).toBe(0)
    } finally {
      await transport.close()
    }
  })
  it("binds the actual selected Run before a not-ready or closed status is presented", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    for (const state of [{ _tag: "NotReady" } as const, { _tag: "Closed", final: null } as const]) {
      const checked = await Effect.runPromise(
        validateHermeticQualificationStatus(manifest, configuration, state, runId)
      )
      expect(checked.registration.digest).toBe(
        hermeticCanonicalRecordDigest(currentDeliveryStatusRecord(checked.status))
      )
    }
  })

  it("rejects a private sentinel inside an opaque Run identity before any digest is returned", async () => {
    const { configuration, manifest } = await Effect.runPromise(fixture)
    const rejected = await Effect.runPromise(
      validateHermeticQualificationStatus(
        manifest,
        configuration,
        { _tag: "NotReady" },
        RunId.make("private-thread-sentinel")
      ).pipe(Effect.flip)
    )
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(JSON.stringify(rejected)).not.toContain("private-thread-sentinel")
  })

  it("rejects a manifest whose original Git Base does not match configuration", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const rejected = await Effect.runPromise(
      validateHermeticQualificationStatus(
        { ...manifest, baseSha: GitCommitSha.make("d".repeat(40)) },
        configuration,
        { _tag: "NotReady" },
        runId
      ).pipe(Effect.flip)
    )
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
  })

  it("rejects a mapped throttle without an original observed completion request", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const error = new ProductionCliDeliveryError({
      code: "delivery.provider_throttled",
      detail: "the task tracker throttled a production delivery mutation",
      subject: {
        _tag: "TaskTrackerMutation",
        runId,
        operationId: OperationId.make("01990a72-38c0-7000-8000-000000000001"),
        operation: "CompleteTask",
        retry: null
      }
    })
    const absent = await Effect.runPromise(
      validateHermeticQualificationDeliveryFailure(manifest, configuration, error, runId, { _tag: "NotReady" }).pipe(
        Effect.flip
      )
    )
    expect(absent._tag).toBe("HermeticQualificationSourceRejected")
    const rejected = await Effect.runPromise(
      validateHermeticQualificationDeliveryFailure(
        manifest,
        configuration,
        new ProductionCliDeliveryError({
          code: error.code,
          detail: error.detail,
          subject: { ...error.subject, operationId: OperationId.make("private-session-sentinel") }
        }),
        runId,
        { _tag: "NotReady" }
      ).pipe(Effect.flip)
    )
    expect(JSON.stringify(rejected)).not.toContain("private-session-sentinel")
  })

  it("binds focused revisions to original claim and lifecycle facts rather than graph revisions", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const { claim } = completionFixture(context)
    const variants: ReadonlyArray<Pick<FocusedTaskCompletionFacts, "lifecycle" | "currentClaim">> = [
      { lifecycle: "Open", currentClaim: claim },
      { lifecycle: "CompletedSuccessfully", currentClaim: claim },
      { lifecycle: "CompletedSuccessfully", currentClaim: { _tag: "UnclaimedTask", taskId: context.taskId } }
    ]
    const revisions = []
    for (const variant of variants) {
      const content = {
        ...variant,
        target: configuration.target,
        targetMembership: "Member" as const,
        taskId: context.taskId,
        taskRevision: context.specification.fingerprint,
        unfinishedPrerequisiteTaskIds: []
      }
      const trackerRevision = await Effect.runPromise(githubFocusedCompletionRevisionFor(content))
      const facts = FocusedTaskCompletionFacts.make({
        ...content,
        operationId: claim.originalClaim.operationId,
        trackerRevision
      })
      await Effect.runPromise(validateCompletionFacts(facts, context))
      revisions.push(trackerRevision)
      const privateTaskId = TaskId.make("private-session-sentinel")
      const privateContent = {
        ...content,
        taskId: privateTaskId,
        currentClaim: { _tag: "UnclaimedTask" as const, taskId: privateTaskId }
      }
      const privateFacts = FocusedTaskCompletionFacts.make({
        ...facts,
        ...privateContent,
        trackerRevision: await Effect.runPromise(githubFocusedCompletionRevisionFor(privateContent))
      })
      const rejected = await Effect.runPromise(validateCompletionFacts(privateFacts, context).pipe(Effect.flip))
      expect(JSON.stringify(rejected)).not.toContain("private-session-sentinel")
    }
    expect(new Set(revisions).size).toBe(variants.length)
  })

  it("checks a pure Ready source fixture and rejects counterfeit opaque proposal identity before a token", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const proposal = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(5),
      purpose: "EstablishCurrentGraph",
      runId,
      target: configuration.target
    })
    const valid = await Effect.runPromise(
      validateHermeticQualificationStatus(manifest, configuration, readyFor(context, [proposal]), runId)
    )
    expect(Schema.is(EvidenceDigest)(valid.registration.digest)).toBe(true)
    const counterfeit = { ...proposal, id: proposal.id + "private-thread-sentinel" }
    const rejected = await Effect.runPromise(
      validateHermeticQualificationStatus(
        manifest,
        configuration,
        readyFor(context, [{ ...counterfeit, id: Schema.decodeUnknownSync(DeliveryProposalId)(counterfeit.id) }]),
        runId
      ).pipe(Effect.flip)
    )
    expect(rejected).toMatchObject({
      _tag: "HermeticQualificationSourceRejected",
      transitionTag: "TrackerGraphReadRoute"
    })
    expect(JSON.stringify(rejected)).not.toContain("private-thread-sentinel")
  })

  it("binds the real constructor-derived completion request to the original Ready source before a throttle token", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const completion = completionFixture(context)
    const state = readyFor(context, [completion.proposal])
    const error = new ProductionCliDeliveryError({
      code: "delivery.provider_throttled",
      detail: "the task tracker throttled a production delivery mutation",
      subject: {
        _tag: "TaskTrackerMutation",
        operation: "CompleteTask",
        operationId: completion.request.operationId,
        runId,
        retry: null
      }
    })
    const checked = await Effect.runPromise(
      validateHermeticQualificationDeliveryFailure(manifest, configuration, error, runId, state)
    )
    expect(checked.error).toBe(error)
    const rejected = await Effect.runPromise(
      validateHermeticQualificationDeliveryFailure(
        manifest,
        configuration,
        new ProductionCliDeliveryError({
          code: error.code,
          detail: error.detail,
          subject: { ...error.subject, operationId: OperationId.make("private-request-sentinel") }
        }),
        runId,
        state
      ).pipe(Effect.flip)
    )
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(JSON.stringify(rejected)).not.toContain("private-request-sentinel")
  })

  it("maps a canonical projector conflict to safe typed source rejection without a publication token", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const proposal = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(5),
      purpose: "EstablishCurrentGraph",
      runId,
      target: configuration.target
    })
    const owner = ticketOwnerSnapshotForTest(proposal)
    const ready = readyFor(context, [proposal])
    if (ready._tag !== "Ready") return expect.fail("pure source fixture must be ready")
    const rejected = await Effect.runPromise(
      validateHermeticQualificationStatus(
        manifest,
        configuration,
        { ...ready, liveOwners: [owner, owner] },
        runId
      ).pipe(Effect.flip)
    )
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(rejected).not.toHaveProperty("registration")
    expect(JSON.stringify(rejected)).not.toContain("DeliveryStatusProjectionConflict")
  })

  it("registers the original pending read status only for its acknowledged materialized owner identity", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const allocatedId = OperationId.make("01990a72-38c0-7000-8000-000000000021")
    const route = routeFixtures(context).routes.find(
      (candidate) => candidate._tag === "RecoveredNewActionRoute" && candidate.action._tag === "ReadTrackerGraph"
    )
    if (route?._tag !== "RecoveredNewActionRoute") return expect.fail("fixture must contain the graph read route")
    const admitted = {
      ...proposalForRoute(route, context),
      route,
      actionIdentity: { _tag: "FreshOperationIdRequired" as const, source: { _tag: "Allocate" as const } },
      order: {
        _tag: "RecoveredWorkflowOrder" as const,
        acceptedAt: JournalPosition.make(4),
        frontierOrdinal: DeliveryProposalOrdinal.make(0),
        responsibilityBeganAt: null,
        taskId: context.taskId,
        transition: "ObservePlannedAttemptContinuationGraph" as const
      }
    }
    const current = {
      ...admitted,
      actionIdentity: {
        _tag: "FreshOperationIdRequired" as const,
        source: { _tag: "Preserve" as const, operationId: allocatedId }
      },
      order: { ...admitted.order, acceptedAt: JournalPosition.make(5) }
    }
    const owner = ticketOwnerSnapshotForTest(admitted, {
      _tag: "MaterializedDeliveryAction",
      intent: "IntentRecorded",
      operationId: allocatedId
    })
    const ready = readyFor(context, [current])
    if (ready._tag !== "Ready") return expect.fail("source fixture must be ready")
    expect(
      await Effect.runPromise(
        validateHermeticQualificationStatus(manifest, configuration, { ...ready, liveOwners: [owner] }, runId)
      )
    ).toHaveProperty("registration")
    const foreign = {
      ...current,
      actionIdentity: {
        _tag: "FreshOperationIdRequired" as const,
        source: { _tag: "Preserve" as const, operationId: OperationId.make("01990a72-38c0-7000-8000-000000000022") }
      }
    }
    const foreignReady = readyFor(context, [foreign])
    if (foreignReady._tag !== "Ready") return expect.fail("foreign source fixture must be ready")
    const rejected = await Effect.runPromise(
      validateHermeticQualificationStatus(
        manifest,
        configuration,
        { ...foreignReady, liveOwners: [owner] },
        runId
      ).pipe(Effect.flip)
    )
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(rejected).not.toHaveProperty("registration")
  })

  it("checks all six measured route families and twenty-eight direct roots without accepting added opaque source fields", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const originalContext = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const { context, routes } = routeFixtures(originalContext)
    expect(routes).toHaveLength(29)
    expect(new Set(routes.map((route) => route._tag)).size).toBe(6)
    for (const route of routes) {
      const proposal = proposalForRoute(route, context)
      const checked = await Effect.runPromise(Effect.result(validateProposal(proposal, context)))
      expect(checked._tag, JSON.stringify(route)).toBe("Success")
      const counterfeitRoute = { ...route, privateSource: "private-thread-sentinel" }
      const rejected = await Effect.runPromise(
        validateProposal(proposalForRoute(counterfeitRoute, context), context).pipe(Effect.flip)
      )
      expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
      expect(JSON.stringify(rejected)).not.toContain("private-thread-sentinel")
    }
  })

  it("reports the closed unsupported transition tag without retaining proposal data", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const responsibility = completionFixture(context).responsibility
    const route = {
      _tag: "IdentityFreeWorkflowRoute",
      transition: { _tag: "ReleaseStartedIntegrationTarget", responsibility }
    } as const
    const rejected = await Effect.runPromise(
      validateProposal(proposalForRoute(route, context), context).pipe(Effect.flip)
    )
    expect(rejected).toMatchObject({
      _tag: "HermeticQualificationSourceRejected",
      transitionTag: "ReleaseStartedIntegrationTarget"
    })
    expect(rejected).not.toHaveProperty("responsibility")
  })

  it("reconstructs proposal identity and order while checking live-operation identity sources", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const originalContext = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const { context, routes } = routeFixtures(originalContext)
    const route = routes.find(
      (candidate) => candidate._tag === "RecoveredNewActionRoute" && candidate.action._tag === "ReadTrackerGraph"
    )
    if (route === undefined) return expect.fail("proposal fixture must contain a recovered graph read")
    const proposal = proposalForRoute(route, context)
    if (proposal.route._tag !== "RecoveredNewActionRoute")
      return expect.fail("proposal fixture must retain the recovered graph read route")
    if (proposal.actionIdentity._tag !== "FreshOperationIdRequired")
      return expect.fail("recovered graph read must require one fresh operation identity")
    const expectedId = deliveryProposalIdOf(context.runId, proposal.route)
    expect(proposal.id).toBe(expectedId)
    expect(proposal.order).toEqual({ _tag: "TrackerGraphOrder", acceptedAt: JournalPosition.make(5) })
    await Effect.runPromise(validateProposal(proposal, context))

    const preserved: DeliveryActionProposal = {
      _tag: "DeliveryActionProposal",
      admission: proposal.admission,
      id: proposal.id,
      order: proposal.order,
      owner: proposal.owner,
      route: proposal.route,
      actionIdentity: {
        _tag: "FreshOperationIdRequired" as const,
        source: { _tag: "Preserve" as const, operationId: OperationId.make("01990a72-38c0-7000-8000-000000000013") }
      },
      waitsForLiveOperationId: OperationId.make("01990a72-38c0-7000-8000-000000000014")
    }
    await Effect.runPromise(validateProposal(preserved, context))
    expect(preserved.id).toBe(deliveryProposalIdOf(context.runId, preserved.route))

    const externallyReleased: DeliveryActionProposal = {
      _tag: "DeliveryActionProposal",
      admission: proposal.admission,
      id: proposal.id,
      order: proposal.order,
      owner: proposal.owner,
      route: proposal.route,
      waitsForLiveOperationId: proposal.waitsForLiveOperationId,
      actionIdentity: {
        _tag: "FreshOperationIdRequired" as const,
        source: {
          _tag: "ExternalSuccessReleaseClaim" as const,
          claimOperationId: OperationId.make("01990a72-38c0-7000-8000-000000000015")
        }
      }
    }
    await Effect.runPromise(validateProposal(externallyReleased, context))

    const counterfeit: DeliveryActionProposal = {
      _tag: "DeliveryActionProposal",
      admission: preserved.admission,
      id: preserved.id,
      order: preserved.order,
      owner: preserved.owner,
      route: proposal.route,
      actionIdentity: preserved.actionIdentity,
      waitsForLiveOperationId: OperationId.make("private-proposal-operation")
    }
    const rejected = await Effect.runPromise(validateProposal(counterfeit, context).pipe(Effect.flip))
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(rejected).not.toHaveProperty("registration")
  })

  it("validates continuation read sources before registering status and rejects substituted source atoms", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const originalContext = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const { context, routes } = routeFixtures(originalContext)
    const validate = (route: DeliveryActionProposal["route"]) =>
      validateHermeticQualificationStatus(
        manifest,
        configuration,
        readyFor(context, [proposalForRoute(route, context)]),
        runId
      )
    const reject = async (route: DeliveryActionProposal["route"]) => {
      const rejected = await Effect.runPromise(validate(route).pipe(Effect.flip))
      expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
      expect(rejected).not.toHaveProperty("registration")
      expect(JSON.stringify(rejected)).not.toContain("private-source-sentinel")
    }
    const withPrivateSource = <A>(source: A) => ({ ...source, privateSource: "private-source-sentinel" })
    const foreignTarget = await Effect.runPromise(
      Schema.decodeUnknownEffect(TrackerTarget)({
        _tag: "GithubIssue",
        owner: "foreign",
        repository: "controlled",
        issueNumber: 1
      })
    )
    for (const route of routes) {
      if (route._tag !== "RecoveredNewActionRoute") continue
      const action = route.action
      if (
        action._tag !== "ReadTrackerGraph" &&
        action._tag !== "ReadTaskWorkSpecification" &&
        action._tag !== "ReadTaskWorktree"
      )
        continue
      expect(await Effect.runPromise(validate(route))).toHaveProperty("registration")
      await reject({ ...route, action: withPrivateSource(action) })
      await reject({
        ...route,
        action: { ...action, plannedAttempt: { ...action.plannedAttempt, baseSha: GitCommitSha.make("f".repeat(40)) } }
      })
      // Keep each tagged operation paired with its original action while changing its source atoms.
      switch (action._tag) {
        case "ReadTrackerGraph":
          await reject({ ...route, action: { ...action, operation: { ...action.operation, target: foreignTarget } } })
          await reject({
            ...route,
            action: {
              ...action,
              operation: { ...action.operation, predecessorOperationIds: [OperationId.make("private-source-sentinel")] }
            }
          })
          await reject({
            ...route,
            action: {
              ...action,
              operation: {
                ...action.operation,
                readShape: { ...action.operation.readShape, explicitlyCoveredTaskIds: [] }
              }
            }
          })
          await reject({
            ...route,
            action: {
              ...action,
              operation: {
                ...action.operation,
                readShape: { ...action.operation.readShape, explicitlyCoveredTaskIds: [TaskId.make("foreign")] }
              }
            }
          })
          await reject({
            ...route,
            action: { ...action, operation: { ...action.operation, cause: { _tag: "WorkflowEstablishment" } } }
          })
          await reject({ ...route, action: { ...action, operation: withPrivateSource(action.operation) } })
          expect(
            await Effect.runPromise(
              validate({
                ...route,
                action: { ...action, operation: { ...action.operation, cause: { _tag: "AttemptContinuation" } } }
              })
            )
          ).toHaveProperty("registration")
          break
        case "ReadTaskWorkSpecification":
          await reject({ ...route, action: { ...action, operation: { ...action.operation, target: foreignTarget } } })
          await reject({
            ...route,
            action: { ...action, operation: { ...action.operation, taskId: TaskId.make("foreign") } }
          })
          await reject({ ...route, action: { ...action, operation: withPrivateSource(action.operation) } })
          break
        case "ReadTaskWorktree":
          await reject({
            ...route,
            action: {
              ...action,
              operation: {
                ...action.operation,
                plannedAttempt: { ...action.plannedAttempt, baseSha: GitCommitSha.make("f".repeat(40)) }
              }
            }
          })
          await reject({ ...route, action: { ...action, operation: withPrivateSource(action.operation) } })
          break
      }
    }
  })

  it("accepts real tracker-facts variants and rejects one-field fixture counterfeits", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const originalContext = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const { context, routes } = routeFixtures(originalContext)
    const graphRoute = routes.find(
      (route) => route._tag === "RecoveredNewActionRoute" && route.action._tag === "ReadTrackerGraph"
    )
    const specificationRoute = routes.find(
      (route) => route._tag === "RecoveredNewActionRoute" && route.action._tag === "ReadTaskWorkSpecification"
    )
    const claimRoute = routes.find(
      (route) => route._tag === "RecoveredNewActionRoute" && route.action._tag === "ReadTaskClaim"
    )
    if (graphRoute?._tag !== "RecoveredNewActionRoute" || graphRoute.action._tag !== "ReadTrackerGraph")
      return expect.fail("fixture must contain the original graph read")
    if (
      specificationRoute?._tag !== "RecoveredNewActionRoute" ||
      specificationRoute.action._tag !== "ReadTaskWorkSpecification"
    )
      return expect.fail("fixture must contain the original specification read")
    if (claimRoute?._tag !== "RecoveredNewActionRoute" || claimRoute.action._tag !== "ReadTaskClaim")
      return expect.fail("fixture must contain the original claim read")

    const completedTask = TrackerTask.make({
      id: context.taskId,
      lifecycle: { _tag: "CompletedSuccessfully" },
      parentTaskId: null,
      prerequisiteIds: []
    })
    const completedGraph = TaskDagSnapshot.project(
      TrackerSnapshot.make({ revision: trackerRevisionFor([completedTask]), tasks: [completedTask] })
    )
    if (completedGraph._tag === "Invalid") return expect.fail("completed graph fixture must project")
    const openRootTask = TrackerTask.make({ ...completedTask, lifecycle: { _tag: "Open" } })
    const dependantTask = TrackerTask.make({
      id: context.dependantTaskId,
      lifecycle: { _tag: "Open" },
      parentTaskId: context.taskId,
      prerequisiteIds: [context.taskId]
    })
    const openGraphWithDependant = TaskDagSnapshot.project(
      TrackerSnapshot.make({
        revision: trackerRevisionFor([openRootTask, dependantTask]),
        tasks: [openRootTask, dependantTask]
      })
    )
    const completedGraphWithDependant = TaskDagSnapshot.project(
      TrackerSnapshot.make({
        revision: trackerRevisionFor([completedTask, dependantTask]),
        tasks: [completedTask, dependantTask]
      })
    )
    if (openGraphWithDependant._tag === "Invalid" || completedGraphWithDependant._tag === "Invalid")
      return expect.fail("dependant graph fixtures must project")
    const graphOperation = WorkflowOperation.cases.ReadTrackerGraph.make({
      ...graphRoute.action.operation,
      operationId: OperationId.make("01990a72-38c0-7000-8000-000000000010"),
      predecessorOperationIds: []
    })
    const specificationOperation = WorkflowOperation.cases.ReadTaskWorkSpecification.make({
      ...specificationRoute.action.operation,
      operationId: OperationId.make("01990a72-38c0-7000-8000-000000000011")
    })
    const claimOperation = WorkflowOperation.cases.ReadTaskClaim.make({
      ...claimRoute.action.operation,
      operationId: OperationId.make("01990a72-38c0-7000-8000-000000000012")
    })
    const completeFacts = makeCompleteTaskTrackerFactsObserved(graphOperation, completedGraph.snapshot)
    const openDependantFacts = makeCompleteTaskTrackerFactsObserved(graphOperation, openGraphWithDependant.snapshot)
    const completedDependantFacts = makeCompleteTaskTrackerFactsObserved(
      graphOperation,
      completedGraphWithDependant.snapshot
    )
    const specificationFacts = makeFocusedTaskWorkSpecificationFactsObserved(
      specificationOperation,
      context.specification
    )
    const activeClaimFacts = makeFocusedTaskClaimFactsObserved(
      claimOperation,
      completionFixture(context).claim.originalClaim
    )
    const unclaimedFacts = makeFocusedTaskClaimFactsObserved(
      claimOperation,
      UnclaimedTask.make({ taskId: context.taskId })
    )
    const unreadableFacts = makeFocusedTaskClaimFactsUnreadable(claimOperation)
    const readFailure = TaskTrackerFactsReadFailed.make({
      completeness: "Unreadable",
      failure: { _tag: "TrackerReadError", detail: "controlled read failure" },
      operationId: graphOperation.operationId,
      target: context.configuration.target
    })
    const circuitOpen = TaskTrackerFactsReadFailed.make({
      completeness: "Unreadable",
      failure: { _tag: "TrackerAdapterReadError", detail: "controlled local circuit", reason: { _tag: "CircuitOpen" } },
      operationId: graphOperation.operationId,
      target: context.configuration.target
    })
    const validFacts: ReadonlyArray<TaskTrackerFactsObservation> = [
      completeFacts,
      openDependantFacts,
      completedDependantFacts,
      specificationFacts,
      activeClaimFacts,
      unclaimedFacts
    ]
    for (const facts of validFacts) {
      await Effect.runPromise(validateTrackerFacts(facts, context))
    }
    const circuitEvents = [
      taskTrackerReadIntent(graphOperation),
      taskTrackerFactsObservedEvent(graphOperation.operationId, circuitOpen)
    ]
    const circuitRecords: ReadonlyArray<JournalRecord> = [
      makeWorkflowRunBeganRecord(
        runId,
        configuration.target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        remotePublicationTargetForTest
      ),
      ...circuitEvents.map((event, index) => ({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(index + 2),
        runId
      }))
    ]
    const circuitPrefix = await Effect.runPromise(
      makeTraceReader({ read: () => Effect.succeed(circuitRecords) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(3), runId })
      )
    )
    expect(
      (await Effect.runPromise(validateHermeticQualificationHistory(manifest, configuration, circuitPrefix, runId)))
        .snapshot
    ).toBe(circuitPrefix)
    const foreignTarget = await Effect.runPromise(
      Schema.decodeUnknownEffect(TrackerTarget)({
        _tag: "GithubIssue",
        owner: "foreign",
        repository: "controlled",
        issueNumber: 1
      })
    )
    for (const facts of validFacts) {
      const rejected = await Effect.runPromise(
        validateTrackerFacts({ ...facts, target: foreignTarget }, context).pipe(Effect.flip)
      )
      expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    }
    for (const facts of [
      unreadableFacts,
      readFailure,
      { ...circuitOpen, failure: { ...circuitOpen.failure, reason: { _tag: "Throttled" as const } } }
    ] as const) {
      const rejected = await Effect.runPromise(validateTrackerFacts(facts, context).pipe(Effect.flip))
      expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    }

    const graph = completedGraph.snapshot.toWire()
    await Effect.runPromise(validateGraph(graph, context))
    await Effect.runPromise(validateGraph(openGraphWithDependant.snapshot.toWire(), context))
    await Effect.runPromise(validateGraph(completedGraphWithDependant.snapshot.toWire(), context))
    const wrongRevision = await Effect.runPromise(
      validateGraph(
        {
          ...graph,
          revision: trackerRevisionFor([TrackerTask.make({ ...completedTask, lifecycle: { _tag: "Open" } })])
        },
        context
      ).pipe(Effect.flip)
    )
    expect(wrongRevision._tag).toBe("HermeticQualificationSourceRejected")
    const extraTask = TrackerTask.make({
      id: TaskId.make("extra-task"),
      lifecycle: { _tag: "Open" },
      parentTaskId: null,
      prerequisiteIds: []
    })
    const wrongCardinality = await Effect.runPromise(
      validateGraph({ ...graph, tasks: [...graph.tasks, extraTask] }, context).pipe(Effect.flip)
    )
    expect(wrongCardinality._tag).toBe("HermeticQualificationSourceRejected")
    const duplicateDependant = await Effect.runPromise(
      validateGraph(
        { ...openGraphWithDependant.snapshot.toWire(), tasks: [openRootTask, dependantTask, dependantTask] },
        context
      ).pipe(Effect.flip)
    )
    expect(duplicateDependant._tag).toBe("HermeticQualificationSourceRejected")
  })

  it("checks the original ordinary history view and rejects a valid private specification before digest registration", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const snapshot = await Effect.runPromise(specificationHistory(context, context.specification))
    const valid = await Effect.runPromise(
      validateHermeticQualificationHistory(manifest, configuration, snapshot, runId)
    )
    expect(valid.snapshot).toBe(snapshot)
    const privateSpecification = makeTaskWorkSpecification({
      taskId: context.taskId,
      title: context.specification.title,
      body: "private-prompt-sentinel"
    })
    const unsafe = await Effect.runPromise(specificationHistory(context, privateSpecification))
    const rejected = await Effect.runPromise(
      validateHermeticQualificationHistory(manifest, configuration, unsafe, runId).pipe(Effect.flip)
    )
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(JSON.stringify(rejected)).not.toContain("private-prompt-sentinel")
  })

  it("accepts exact A/B executor reports after their own responsibility and rejects a foreign correlation", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    for (const taskId of [context.taskId, context.dependantTaskId]) {
      const exact = await Effect.runPromise(executorHistory(context, taskId))
      expect(
        (await Effect.runPromise(validateHermeticQualificationHistory(manifest, configuration, exact, runId))).snapshot
      ).toBe(exact)
      expect(exact.items.map(({ occurrence }) => occurrence._tag)).toEqual([
        "TaskAttemptPlanned",
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorWorkReported"
      ])
    }
    const rejected = await Effect.runPromise(executorHistory(context, context.taskId, true).pipe(Effect.flip))
    expect(rejected._tag).toBe("TraceProjectionInvalid")
    if (rejected._tag === "TraceProjectionInvalid")
      expect(rejected.detail).toBe("ExecutorReportWithoutResponsibilityBegan")
  })

  it("accepts derived candidate cleanup operation IDs and rejects observation or mutation mismatches", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const exact = await Effect.runPromise(candidateCleanupHistory(context))
    expect(
      (await Effect.runPromise(validateHermeticQualificationHistory(manifest, configuration, exact, runId))).snapshot
    ).toBe(exact)

    for (const [mismatch, transitionTag] of [
      [
        { observationOperationId: OperationId.make("private-cleanup-observation-sentinel") },
        "IntegratorCandidateCleanupObservationIntended"
      ],
      [
        { mutationOperationId: OperationId.make("private-cleanup-mutation-sentinel") },
        "IntegratorCandidateCleanupMutationIntended"
      ]
    ] as const) {
      const unsafe = await Effect.runPromise(candidateCleanupHistory(context, mismatch))
      const rejected = await Effect.runPromise(
        validateHermeticQualificationHistory(manifest, configuration, unsafe, runId).pipe(Effect.flip)
      )
      expect(rejected).toMatchObject({ _tag: "HermeticQualificationSourceRejected", transitionTag })
      expect(JSON.stringify(rejected)).not.toContain("private-cleanup")
      const diagnostic = JSON.parse(encodeRuntimeDiagnostic(projectRuntimeCause(Cause.die(rejected), [])))
      expect(diagnostic.reasons[0].error).toMatchObject({
        errorTag: "HermeticQualificationSourceRejected",
        operation: transitionTag,
        safeMessage: `${transitionTag} failed`
      })
      expect(JSON.stringify(diagnostic)).not.toContain("private-cleanup")
    }
  })

  it("accepts exact root and dependant settled-worktree cleanup authorization prefixes", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    for (const taskId of [context.taskId, context.dependantTaskId]) {
      const prefix = await Effect.runPromise(worktreeCleanupAuthorizationHistory(context, taskId))
      expect(prefix.items.at(-1)?.occurrence).toMatchObject({
        _tag: "WorktreeCleanupOccurred",
        event: { _tag: "WorktreeCleanupAuthorized" },
        runId
      })
      expect(
        (await Effect.runPromise(validateHermeticQualificationHistory(manifest, configuration, prefix, runId))).snapshot
      ).toBe(prefix)
    }
  })

  it("accepts the first candidate-cleanup observation intent prefix", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const intentOnly = await Effect.runPromise(candidateCleanupHistory(context, {}, "ObservationIntent"))
    expect(intentOnly.items.at(-1)?.occurrence).toMatchObject({
      _tag: "IntegratorCandidateCleanupOccurred",
      event: { _tag: "IntegratorCandidateCleanupObservationIntended" }
    })
    expect(
      (await Effect.runPromise(validateHermeticQualificationHistory(manifest, configuration, intentOnly, runId)))
        .snapshot
    ).toBe(intentOnly)
  })

  it("accepts the exact ordered remote-baseline family and rejects a foreign remote target", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const snapshot = await Effect.runPromise(specificationHistory(context, context.specification))
    const { responsibility } = completionFixture(context)
    const facts = {
      acceptedResult: responsibility.acceptedResult,
      integrationTarget: responsibility.integrationTarget,
      plannedAttempt: responsibility.plannedAttempt,
      queuedAt: responsibility.queuedAt,
      startedAt: responsibility.startedAt
    }
    const correlation = remoteBaselineCorrelationFor(
      runId,
      facts,
      responsibility.integrationTarget,
      configuration.remotePublicationTarget
    )
    const localHead = configuration.plannedAttemptBaseSha
    const remoteHead = GitCommitSha.make("b".repeat(40))
    const occurrences: ReadonlyArray<WorkflowOccurrence> = [
      {
        _tag: "RemoteBaselineReadInitiated",
        correlation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        recordedAt: JournalPosition.make(4),
        runId
      },
      {
        _tag: "RemoteBaselineObserved",
        correlation,
        observation: { _tag: "LocalAncestor", localHead, remoteHead },
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: JournalPosition.make(5),
        runId
      },
      {
        _tag: "LocalTargetCatchUpInitiated",
        correlation,
        expectedLocalHead: localHead,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        recordedAt: JournalPosition.make(6),
        remoteHead,
        runId
      },
      {
        _tag: "LocalTargetCatchUpObserved",
        correlation,
        expectedLocalHead: localHead,
        occurrenceClassification: "NonActionOccurrence",
        recordedAt: JournalPosition.make(7),
        remoteHead,
        result: { _tag: "Applied", newHead: remoteHead },
        runId
      }
    ]
    const items = occurrences.map((occurrence, index) => ({
      identity: TracePositionIdentity.make({ runId, position: JournalPosition.make(index + 4) }),
      occurrence,
      operationIds: [],
      taskIds: []
    }))
    const exact = TraceAtCursor.make({
      ...snapshot,
      cursor: TraceCursor.make({ runId, position: JournalPosition.make(7) }),
      items: [...snapshot.items, ...items]
    })
    expect(
      (await Effect.runPromise(validateHermeticQualificationHistory(manifest, configuration, exact, runId))).snapshot
    ).toBe(exact)
    const foreignCorrelation = remoteBaselineCorrelationFor(
      runId,
      facts,
      responsibility.integrationTarget,
      RemotePublicationTarget.make({
        ...configuration.remotePublicationTarget,
        endpoint: RemotePublicationEndpoint.make("/foreign/publication.git")
      })
    )
    const foreign = TraceAtCursor.make({
      ...exact,
      items: exact.items.map((item) =>
        item.occurrence._tag === "RemoteBaselineReadInitiated"
          ? { ...item, occurrence: { ...item.occurrence, correlation: foreignCorrelation } }
          : item
      )
    })
    expect(
      (
        await Effect.runPromise(
          validateHermeticQualificationHistory(manifest, configuration, foreign, runId).pipe(Effect.flip)
        )
      )._tag
    ).toBe("HermeticQualificationSourceRejected")
  })

  it("keeps the actual response-lost and unreadable lookup history but rejects private provider detail", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const snapshot = await Effect.runPromise(
      lookupHistory(context, "GitHub cannot query a prior CloseIssue request by clientMutationId")
    )
    const checked = await Effect.runPromise(
      validateHermeticQualificationHistory(manifest, configuration, snapshot, runId)
    )
    expect(checked.snapshot).toBe(snapshot)
    expect(snapshot.items.map((item) => item.occurrence._tag)).toContain("IntegrationFocusedCompletionOccurred")
    const unsafe = await Effect.runPromise(lookupHistory(context, "private-provider-detail-sentinel"))
    const rejected = await Effect.runPromise(
      validateHermeticQualificationHistory(manifest, configuration, unsafe, runId).pipe(Effect.flip)
    )
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(JSON.stringify(rejected)).not.toContain("private-provider-detail-sentinel")
    const malformed = { ...snapshot, privateSource: "private-history-sentinel" }
    const malformedRejected = await Effect.runPromise(
      validateHermeticQualificationHistory(manifest, configuration, malformed, runId).pipe(Effect.flip)
    )
    expect(malformedRejected._tag).toBe("HermeticQualificationSourceRejected")
    expect(JSON.stringify(malformedRejected)).not.toContain("private-history-sentinel")
  })

  it("rejects coherent counterfeit numbered-call tracker and Git references before registration", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const snapshot = await Effect.runPromise(
      lookupHistory(context, "GitHub cannot query a prior CloseIssue request by clientMutationId")
    )
    for (const field of ["focusedFactsOperationId", "gitReadOperationId"] as const) {
      const unsafe = coherentCompletionMutation(snapshot, (event) =>
        event._tag === "CompletionTaskAttemptIntended"
          ? { ...event, [field]: OperationId.make("private-completion-reference-sentinel") }
          : event
      )
      expect(Schema.is(TraceAtCursor)(unsafe)).toBe(true)
      const rejected = await Effect.runPromise(
        validateHermeticQualificationHistory(manifest, configuration, unsafe, runId).pipe(Effect.flip)
      )
      expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
      expect(rejected).not.toHaveProperty("registration")
      expect(JSON.stringify(rejected)).not.toContain("private-completion-reference-sentinel")
    }
  })

  it("keeps an exact actual acknowledgement and rejects coherent counterfeit acknowledgement operation or task", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const context = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const snapshot = await Effect.runPromise(lookupHistory(context, "unused", true))
    const checked = await Effect.runPromise(
      validateHermeticQualificationHistory(manifest, configuration, snapshot, runId)
    )
    expect(checked.snapshot).toBe(snapshot)
    for (const field of ["operationId", "taskId"] as const) {
      const unsafe = coherentCompletionMutation(snapshot, (event) =>
        event._tag === "CompletionTaskAcknowledged"
          ? {
              ...event,
              acknowledgement:
                field === "operationId"
                  ? { ...event.acknowledgement, operationId: OperationId.make("private-acknowledgement-sentinel") }
                  : { ...event.acknowledgement, taskId: TaskId.make("private-acknowledgement-sentinel") }
            }
          : event
      )
      expect(Schema.is(TraceAtCursor)(unsafe)).toBe(true)
      const rejected = await Effect.runPromise(
        validateHermeticQualificationHistory(manifest, configuration, unsafe, runId).pipe(Effect.flip)
      )
      expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
      expect(rejected).not.toHaveProperty("registration")
      expect(JSON.stringify(rejected)).not.toContain("private-acknowledgement-sentinel")
    }
  })
})
