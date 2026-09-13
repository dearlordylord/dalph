import {
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  IntegrationTarget,
  RunId,
  TaskId,
  makeTaskWorkSpecification,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { NodeServices } from "@effect/platform-node"
import {
  ActiveTaskClaim,
  boundedParallelTicketsOf,
  ClaimToken,
  CompletionClaimReplacedEvent,
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
  IntegratorCandidateText,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  integratorCorrelationFor,
  JournalPosition,
  makeCompletionTaskFactsObservationOperation,
  makeDeliveryReflection,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeTaskWorkSpecificationObservationOperation,
  makeTraceReader,
  makeWorkflowRunBeganRecord,
  OperationId,
  PlannedAttemptExecutorReportOrdinal,
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
  TraceCursor,
  TrackerGraphState,
  TrackerSnapshot,
  TrackerTask,
  trackerGraphReadProposalOf,
  trackerRevisionFor,
  UnqueuedAcceptedResult,
  WorkflowJournalEvent,
  WorkflowOperation,
  type DeliveryActionProposal,
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
  qualificationPlannedAttemptFor,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import { validateProposal } from "./production-hermetic-qualification-proposal-source.js"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { decodeProductionRepositoryHostConfiguration } from "./production-configuration.js"
import { HermeticFixtureManifest } from "./production-hermetic-contract.js"
import { currentDeliveryStatusRecord, ProductionCliDeliveryError } from "./production-cli.js"
import { hermeticCanonicalRecordDigest } from "./production-hermetic-provider-bridge.js"
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
    codexStateDirectory: "/fixture/codex",
    integratorCandidateWorktreeRoot: "/fixture/candidates",
    integratorPrivateStore: "/fixture/private.json",
    activationInterval: "1 minute",
    failureCooldown: "5 seconds",
    codexExecutable: "/bin/codex",
    codexClientName: "dalph",
    codexClientVersion: "0.0.0",
    codexProvider: "openai",
    githubToken: "private-credential",
    codexProviderCredential: "private-provider-credential"
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
    codexStateDirectory: configuration.codexStateDirectory,
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
  positions = { queued: 10, started: 11, lineage: 12, qualified: 13 }
) => {
  const plannedAttempt = qualificationPlannedAttemptFor(context)
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
    taskId: context.taskId,
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
    trackerRevision: trackerRevisionFor([{ ...task, lifecycle: { _tag: "CompletedSuccessfully" } }])
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
      transition: { _tag: "RunTargetPromotion", responsibility: fixture.responsibility, candidate: fixture.candidate }
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
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    ),
    record(2, event),
    record(3, observed)
  ]
  return makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
    TraceCursor.make({ runId: context.runId, position: JournalPosition.make(3) })
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
    trackerRevision: trackerRevisionFor([
      TrackerTask.make({ id: context.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] })
    ]),
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
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
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

describe("qualification original source boundary", () => {
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
    expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
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

  it("checks all six measured route families and twenty-five direct roots without accepting added opaque source fields", async () => {
    const { configuration, manifest, runId } = await Effect.runPromise(fixture)
    const originalContext = await Effect.runPromise(contextFor(manifest, configuration, runId))
    const { context, routes } = routeFixtures(originalContext)
    expect(routes).toHaveLength(25)
    expect(new Set(routes.map((route) => route._tag)).size).toBe(6)
    for (const route of routes) {
      const proposal = proposalForRoute(route, context)
      await Effect.runPromise(validateProposal(proposal, context))
      const counterfeitRoute = { ...route, privateSource: "private-thread-sentinel" }
      const rejected = await Effect.runPromise(
        validateProposal(proposalForRoute(counterfeitRoute, context), context).pipe(Effect.flip)
      )
      expect(rejected._tag).toBe("HermeticQualificationSourceRejected")
      expect(JSON.stringify(rejected)).not.toContain("private-thread-sentinel")
    }
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
