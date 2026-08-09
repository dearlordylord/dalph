/* eslint-disable max-lines -- One chronological adapter owns fresh, pause, crash, recovery, candidate, and terminal story boundaries. */
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, type Result, Schema, Stream } from "effect"
import {
  type AttemptId,
  GitCommitSha,
  type PlannedAttemptExecutorReport,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId,
  type TaskRevision
} from "@dalph/contracts"
import {
  AuthoritativeTaskWorktreeReady,
  type AttemptChoiceApplicationResult,
  attemptChoiceControlLayer,
  AttemptChoiceRequestId,
  controlDirectionApplicationLayer,
  taskClaimReacquisitionControlLayer,
  TaskControlSubjectOutsideRun,
  CoordinatorOwnership,
  controlledTrackerMutationLayerFrom,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  CandidateCorrectionLimit,
  CandidateContinuationLimit,
  CompletionClaimBoundary,
  type BoundedTicketRank,
  DeliveryRelationPublicationObserver,
  evaluateDeliveryRelationInputBundle,
  evaluateDeliveryRuntimeInputBundle,
  type DeliveryConsequences,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  type JournaledTrackerGraphObservation,
  freshWorkflowRunId,
  GitTargetLineage,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateResourceLocator,
  IntegrationCandidateGit,
  IntegrationCandidateGitReadFailure,
  GitWorktree,
  gitTargetLineageTestLayer,
  gitWorktreeTestLayer,
  type JournalRecord,
  type JournalPosition,
  JournalStore,
  journalStoreCapabilities,
  JournaledRunBootstrap,
  journaledRunBootstrapLayer,
  type JournaledRuntimeLayerInput,
  journaledWorkflowInterpreterLayer,
  workflowInterpreterLayer,
  makeLiveDeliveryActionExecutor,
  memoryJournalStoreLayer,
  observePlannedAttemptWorktreeThrough,
  observeTargetLineageThrough,
  reduceWorkflowJournalHistory,
  runGitWorktreeReconciliation,
  runRecoveredWorkflowWithControlledDeliveryActionExecutor,
  runWorkflowWithControlledDeliveryActionExecutor,
  validatedStartupRecoveryLayer,
  taskWorkCapacityControlLayer,
  type TaskWorkCapacity,
  TargetLineageObservation,
  TargetVerificationArtifact,
  TargetVerificationBoundary,
  TargetVerificationBoundaryFailure,
  TargetVerificationCorrelation,
  TargetVerificationPlan,
  TargetVerificationRequestId,
  TargetVerificationTerminal,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionCompareAndSetResult,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  type TargetPromotionGitService,
  memoryEvidenceStoreLayer,
  EvidenceStore,
  TestGitWorktree,
  TrackerMutation,
  type TrackerRevision,
  type TrackerTask,
  TrackerAdapterReadError,
  type DeliveryActionExecutorService,
  WorkflowInterpreter,
  WorkflowTrace
} from "@dalph/orchestrator"
import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  AuthoredScenarioCassette,
  type AuthoredCassetteStoryItem,
  type AuthoredObservedBehavior,
  type AuthoredScenarioCassette as ScenarioCassette
} from "./authored-domain.js"
import { controlledExecutorLayer, controlledTrace, controlledTrackerGraphReaderLayer } from "./authored-adapters.js"
import { makeStoryCursor, type StoryCursor } from "./authored-cursor.js"
import type { AuthoredAttemptChoiceItem } from "./authored-cursor-items.js"
import { assertAuthoredExpectedBehavior } from "./authored-outcomes.js"
import { controlledTrackerAuthorityLayer } from "./authored-tracker-authority.js"

export interface AuthoredScenarioCassetteRun {
  readonly cassette: ScenarioCassette
  readonly coordinatorActivations: ReadonlyArray<"Fresh" | "Recovered">
  readonly deliveryFrames: ReadonlyArray<AuthoredDeliveryFrame>
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly observedBehavior: AuthoredObservedBehavior
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

interface AuthoredTaggedDiagnostic {
  readonly kind: string
  readonly exact: string
}

interface AuthoredActionPlanningFact extends AuthoredTaggedDiagnostic {
  readonly attemptId: AttemptId | null
  /** Human-facing meaning derived while the production proposal or issue remains typed. */
  readonly summary: string
  /** Exact task correlation when the production value carries one. */
  readonly taskId: TaskId | null
}

interface AuthoredObligationDiagnostic extends AuthoredTaggedDiagnostic {
  readonly attemptId: AttemptId | null
  readonly summary: string
}

/** Zero-based count of authored interactions consumed when a production delivery publication was captured. */
const AuthoredStoryPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("AuthoredStoryPosition")
)
type AuthoredStoryPosition = typeof AuthoredStoryPosition.Type

/** Zero-based identity of one coordinator process activation within an authored cassette run. */
const AuthoredActivationOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("AuthoredActivationOrdinal")
)
type AuthoredActivationOrdinal = typeof AuthoredActivationOrdinal.Type

export interface AuthoredDeliveryFrame {
  readonly activation: "Fresh" | "Recovered"
  readonly activationOrdinal: AuthoredActivationOrdinal
  readonly storyPosition: AuthoredStoryPosition
  readonly acceptedAt: JournalPosition | null
  readonly graph:
    | { readonly _tag: "NotEstablished" }
    | {
        readonly _tag: "Established"
        readonly revision: TrackerRevision
        /** Exact journal-backed logical read that established this graph publication. */
        readonly observation: {
          readonly operationId: JournaledTrackerGraphObservation["operationId"]
          readonly contentIdentity: JournaledTrackerGraphObservation["contentIdentity"]
          readonly recordedAt: JournaledTrackerGraphObservation["recordedAt"]
        }
        readonly tasks: ReadonlyArray<{
          readonly id: TaskId
          readonly lifecycle: TrackerTask["lifecycle"]["_tag"]
          readonly parentTaskId: TaskId | null
          readonly prerequisiteIds: ReadonlyArray<TaskId>
        }>
      }
  readonly capacity: TaskWorkCapacity
  /** Whether this exact runtime publication permits a finality read or must remain passive. */
  readonly quiescence: DeliveryRelationInputBundle["legacy"]["runtimeFacts"]["quiescence"]
  readonly heldPositions: ReadonlyArray<{
    readonly taskId: TaskId
    readonly runId: RunId
    readonly attemptId: AttemptId
  }>
  readonly frontier: ReadonlyArray<
    | {
        readonly taskId: TaskId
        readonly standing: "Eligible"
        readonly taskRevision: TaskRevision
        readonly reasons: readonly []
      }
    | {
        readonly taskId: TaskId
        readonly standing: "Excluded"
        readonly taskRevision: null
        readonly reasons: ReadonlyArray<AuthoredTaggedDiagnostic>
      }
  >
  readonly tickets: ReadonlyArray<{
    readonly taskId: TaskId
    readonly placement: AuthoredTaggedDiagnostic
    readonly rank: BoundedTicketRank | null
    readonly reasons: ReadonlyArray<AuthoredTaggedDiagnostic>
  }>
  readonly deliveries: ReadonlyArray<{
    readonly taskId: TaskId
    readonly placement: AuthoredTaggedDiagnostic
    readonly evidence: ReadonlyArray<AuthoredTaggedDiagnostic>
    readonly standings: ReadonlyArray<AuthoredTaggedDiagnostic>
    readonly obligations: ReadonlyArray<AuthoredObligationDiagnostic>
  }>
  readonly settlements: ReadonlyArray<{ readonly taskId: TaskId; readonly attemptId: AttemptId }>
  readonly trackerReflection: { readonly _tag: "DeliveryReflection"; readonly settlementCount: number }
  /** Downstream action-planning result; observing it performs no action. */
  readonly actionPlanning:
    | {
        readonly _tag: "DeliveryProposalsAvailable"
        readonly proposals: ReadonlyArray<AuthoredActionPlanningFact>
        readonly isolatedIssues: ReadonlyArray<AuthoredActionPlanningFact>
      }
    | {
        readonly _tag: "DeliveryProposalOwnershipConflict"
        readonly conflicts: ReadonlyArray<AuthoredActionPlanningFact>
      }
}

/** One exact production delivery publication correlated to the authored story cursor. */
export interface AuthoredDeliveryPublication {
  readonly activation: "Fresh" | "Recovered"
  readonly activationOrdinal: AuthoredActivationOrdinal
  readonly storyPosition: AuthoredStoryPosition
  readonly bundle: DeliveryRelationInputBundle
}

export interface AuthoredScenarioCassetteRunOptions {
  /** Synchronous read-only notification; callers must move expensive projection outside the runtime turn. */
  readonly onDeliveryPublication?: (publication: AuthoredDeliveryPublication) => void
}

const diagnosticJsonIndent = 2
const authoredTaggedDiagnosticOf = (value: { readonly _tag: string }): AuthoredTaggedDiagnostic => ({
  kind: value._tag,
  exact: JSON.stringify(value, null, diagnosticJsonIndent)
})

type DeliveryObligation = DeliveryConsequences["ticketDeliveries"]["deliveries"][number]["obligations"][number]
type WorkflowResponsibility = Extract<DeliveryObligation, { readonly _tag: "WorkflowResponsibility" }>["responsibility"]

const authoredWorkflowResponsibilityCorrelation = (
  responsibility: WorkflowResponsibility
): Pick<AuthoredObligationDiagnostic, "attemptId" | "summary"> => {
  switch (responsibility._tag) {
    case "TaskClaimResponsibility":
      return { attemptId: null, summary: "task-claim acquisition responsibility" }
    case "TaskClaimReleaseResponsibility":
      return { attemptId: null, summary: "task-claim release responsibility" }
    case "TaskWorktreeResponsibility":
      return { attemptId: null, summary: "Git worktree responsibility" }
    case "PlannedAttemptExecutorWorkResponsibility":
      return {
        attemptId: responsibility.plannedAttempt.attemptId,
        summary: `planned-attempt executor responsibility · attempt ID ${responsibility.plannedAttempt.attemptId}`
      }
  }
}

const authoredObligationDiagnosticOf = (obligation: DeliveryObligation): AuthoredObligationDiagnostic => {
  const correlation = (() => {
    switch (obligation._tag) {
      case "WorkflowResponsibility":
        return authoredWorkflowResponsibilityCorrelation(obligation.responsibility)
      case "AcceptedAwaitingIntegration":
        return {
          attemptId: obligation.accepted.plannedAttempt.attemptId,
          summary: `accepted result awaiting integration · attempt ID ${obligation.accepted.plannedAttempt.attemptId}`
        }
      case "QueuedIntegration":
        return {
          attemptId: obligation.responsibility.plannedAttempt.attemptId,
          summary: `queued integration responsibility · attempt ID ${obligation.responsibility.plannedAttempt.attemptId}`
        }
      case "StartedIntegration":
        return {
          attemptId: obligation.responsibility.plannedAttempt.attemptId,
          summary: `started integration responsibility · attempt ID ${obligation.responsibility.plannedAttempt.attemptId}`
        }
    }
  })()
  return { ...correlation, kind: obligation._tag, exact: JSON.stringify(obligation, null, diagnosticJsonIndent) }
}

type DeliveryProposal = Extract<
  DeliveryRuntimeEvaluation["proposedActions"],
  { readonly _tag: "DeliveryProposalsAvailable" }
>["proposals"][number]
type DeliveryProposalIssue = Extract<
  DeliveryRuntimeEvaluation["proposedActions"],
  { readonly _tag: "DeliveryProposalsAvailable" }
>["isolatedIssues"][number]
type DeliveryProposalConflict = Extract<
  DeliveryRuntimeEvaluation["proposedActions"],
  { readonly _tag: "DeliveryProposalOwnershipConflict" }
>["conflicts"][number]

type ProposalActionTagForRoute<Route> = Route extends { readonly _tag: "TrackerGraphReadRoute" }
  ? "TrackerGraphReadRoute"
  : Route extends { readonly step: { readonly _tag: infer Tag extends string } }
    ? Tag
    : Route extends { readonly action: { readonly _tag: infer Tag extends string } }
      ? Tag
      : Route extends { readonly transition: { readonly _tag: infer Tag extends string } }
        ? Tag
        : never
type ProposalActionTag = ProposalActionTagForRoute<DeliveryProposal["route"]>
type ActionMeaningTag = ProposalActionTag | DeliveryProposalIssue["transition"]

const proposalActionLabels = {
  AcquireStartedIntegrationTarget: "Acquire the integration-target position for started integration",
  AcquireTaskClaim: "Ask the tracker to create the task claim",
  AdvanceAttemptStoppage: "Advance the exact Stop decision for the planned attempt",
  CheckTaskClaim: "Check the tracker result for the accepted task-claim request",
  CommitFreshTaskClaimIntent: "Record intent to create the task claim",
  CommitTaskClaimReacquisitionIntent: "Record intent to reacquire the task claim",
  ContinueFreshWorkflowOperation: "Send the already-journaled request to its recorded owning system",
  ContinuePlannedAttemptExecutorWork: "Tell the executor to continue the exact planned attempt",
  ContinueStartedIntegrationCandidate: "Ask the candidate agent to continue the exact started integration",
  DeleteCompletedTaskCompletionClaim: "Ask the tracker to delete the exact completion claim",
  ObserveAttemptStoppageExecutor: "Check the executor for safe suspension or a terminal result after Stop",
  ObservePlannedAttemptContinuationClaim: "Check the tracker claim before continuing the planned attempt",
  ObservePlannedAttemptContinuationExecutor: "Check the executor before continuing the planned attempt",
  ObservePlannedAttemptContinuationGraph: "Check the tracker graph before continuing the planned attempt",
  ObservePlannedAttemptContinuationSpecification:
    "Check tracker work instructions before continuing the planned attempt",
  ObservePlannedAttemptContinuationTargetLineage: "Check Git target lineage before continuing the planned attempt",
  ObservePlannedAttemptContinuationWorktree: "Check the Git worktree before continuing the planned attempt",
  ObserveResponsibleTaskClaim: "Check the tracker claim held by the current workflow responsibility",
  ObserveStoppedAttemptClaim: "Check the tracker claim before releasing a stopped attempt",
  QueueAcceptedResultIntegrationResponsibility: "Queue the accepted result for integration",
  ReadCurrentTaskGraph: "Read the tracker graph for the selected task",
  ReadPostClaimGraph: "Read the tracker graph after creating the task claim",
  ReadTargetLineage: "Read current target lineage from Git",
  ReadTaskClaim: "Read the current task claim from the tracker",
  ReadTaskWorkSpecification: "Read the task's work instructions from the tracker",
  ReadTaskWorktree: "Check the exact Git worktree after restart",
  ReadTrackerGraph: "Read the current tracker graph after restart",
  ReconcileTaskClaim: "Check the tracker after an ambiguous task-claim request",
  ReconcileTaskClaimRelease: "Check the tracker after an ambiguous claim-release request",
  ReconcileTaskWorktree: "Check or create the exact Git worktree",
  RecordStoppedAttemptClaimNoRelease: "Record that the stopped attempt has no exact claim to release",
  RecordTaskAttemptPlan: "Record the exact planned task attempt in Dalph's journal",
  ReleaseExternallyCompletedTaskClaim: "Ask the tracker to release the externally completed task's claim",
  ReleaseStartedIntegrationTarget: "Release the held integration-target position",
  ReleaseStoppedAttemptClaim: "Ask the tracker to release the stopped attempt's exact claim",
  ReplacePromotedTaskClaim: "Ask the tracker to replace the promoted task claim with its completion claim",
  RetryStoppedAttemptClaimRelease: "Retry the exact stopped-attempt claim release",
  RunTargetPromotion: "Compare and set the integration target to the verified candidate commit",
  RunTargetVerification: "Run the configured checks for the exact candidate commit",
  StartPlannedAttemptExecutorWork: "Tell the executor to start the exact planned attempt",
  StartQueuedIntegration: "Start the exact queued integration responsibility",
  SuspendPlannedAttemptExecutorWork: "Request safe suspension of the exact planned-attempt executor work",
  TaskClaimReacquisition: "Try to reacquire the exact task claim",
  TrackerGraphReadRoute: "Read the tracker graph to establish the current graph"
} as const satisfies Record<ActionMeaningTag, string>

const proposalOwnerLabels = {
  DeliveryReflection: "delivery reflection",
  DeliverySettlement: "delivery settlement",
  TicketDelivery: "ticket delivery",
  TrackerGraph: "tracker graph"
} as const satisfies Record<DeliveryProposal["owner"], string>

const proposalTaskId = (proposal: DeliveryProposal): TaskId | null =>
  "taskId" in proposal.order ? proposal.order.taskId : null

const proposalActionTag = (proposal: DeliveryProposal): ProposalActionTag => {
  switch (proposal.route._tag) {
    case "TrackerGraphReadRoute":
      return proposal.route._tag
    case "FreshWorkflowRoute":
    case "FreshExecutorWorkflowRoute":
      return proposal.route.step._tag
    case "RecoveredNewActionRoute":
      return proposal.route.action._tag
    case "AcceptedWorkflowRoute":
    case "IdentityFreeWorkflowRoute":
      return proposal.route.transition._tag
  }
}

const taskWorkAdmissionSummary = (proposal: DeliveryProposal): string => {
  const requirement = proposal.admission.taskWorkPosition
  switch (requirement._tag) {
    case "NoTaskWorkPosition":
      return "needs no task-work position"
    case "TaskWorkPositionRequired":
      switch (requirement.mode) {
        case "Existing":
          return "requires the existing task-work position"
        case "ReserveOrReuse":
          return "must reserve or reuse a task-work position"
      }
  }
}

const integrationTargetAdmissionSummary = (proposal: DeliveryProposal): string => {
  const requirement = proposal.admission.integrationTarget
  switch (requirement._tag) {
    case "NoIntegrationTargetResource":
      return "needs no integration-target resource"
    case "IntegrationTargetResourceRequired":
      switch (requirement.access) {
        case "Acquire":
          return "must acquire the integration-target resource"
        case "Release":
          return "must release the held integration-target resource"
        case "UseHeld":
          return "requires the held integration-target resource"
      }
  }
}

const plannedAttemptProtocolAdmissionSummary = (proposal: DeliveryProposal): string => {
  const requirement = proposal.admission.plannedAttemptProtocol
  switch (requirement._tag) {
    case "NoPlannedAttemptProtocol":
      return "needs no executor/Continue-or-Stop serialization"
    case "PlannedAttemptProtocolRequired":
      return "must serialize this action with executor commands and Continue or Stop"
  }
}

const authoredActionProposalFactOf = (proposal: DeliveryProposal): AuthoredActionPlanningFact => {
  const taskId = proposalTaskId(proposal)
  const attemptId =
    proposal.admission.plannedAttemptProtocol._tag === "PlannedAttemptProtocolRequired"
      ? proposal.admission.plannedAttemptProtocol.correlation.attemptId
      : null
  const action = proposalActionLabels[proposalActionTag(proposal)]
  const recoveredPurpose =
    proposal.order._tag === "RecoveredWorkflowOrder" ? proposalActionLabels[proposal.order.transition] : undefined
  const purpose =
    recoveredPurpose === undefined || recoveredPurpose === action ? undefined : `to ${recoveredPurpose.toLowerCase()}`
  return {
    attemptId,
    kind: proposal._tag,
    taskId,
    summary: [
      action,
      taskId === null ? undefined : `task ${taskId}`,
      attemptId === null ? undefined : `attempt ID ${attemptId}`,
      purpose,
      plannedAttemptProtocolAdmissionSummary(proposal),
      taskWorkAdmissionSummary(proposal),
      integrationTargetAdmissionSummary(proposal),
      proposal.waitsForLiveOperationId === null
        ? undefined
        : `waits for live operation ${proposal.waitsForLiveOperationId}`,
      `planned by the ${proposalOwnerLabels[proposal.owner]} layer`
    ]
      .filter((part): part is string => part !== undefined)
      .join(" · "),
    exact: JSON.stringify(proposal, null, diagnosticJsonIndent)
  }
}

const authoredActionIssueFactOf = (issue: DeliveryProposalIssue): AuthoredActionPlanningFact => {
  const action = proposalActionLabels[issue.transition]
  const summary = (() => {
    switch (issue._tag) {
      case "AcceptedOperationEvidenceMissing":
        return `Dalph cannot ${action.toLowerCase()} because accepted journal evidence is missing`
      case "FreshRouteProvenanceMissing":
        return `Dalph cannot ${action.toLowerCase()} because fresh route provenance is missing`
      case "TypedRoutePolicyContradiction":
        return `Dalph cannot ${action.toLowerCase()} because the typed route policy contradicts this transition`
    }
  })()
  return {
    attemptId: null,
    kind: issue._tag,
    taskId: issue.taskId,
    summary: `${summary} · task ${issue.taskId}`,
    exact: JSON.stringify(issue, null, diagnosticJsonIndent)
  }
}

const authoredActionConflictFactOf = (conflict: DeliveryProposalConflict): AuthoredActionPlanningFact => ({
  attemptId: null,
  kind: "DeliveryProposalOwnershipConflict",
  taskId: null,
  summary: `Proposal ownership conflict for ${conflict.id}: ${conflict.owners.join(" and ")} · planning fails closed`,
  exact: JSON.stringify(conflict, null, diagnosticJsonIndent)
})

const authoredDeliveryFrameOf = (
  captured: AuthoredDeliveryPublication,
  consequences: DeliveryConsequences,
  runtime: DeliveryRuntimeEvaluation
): AuthoredDeliveryFrame => {
  const conflictFacts: Array<AuthoredActionPlanningFact> = []
  if (runtime.proposedActions._tag === "DeliveryProposalOwnershipConflict") {
    for (const conflict of runtime.proposedActions.conflicts) {
      conflictFacts.push(authoredActionConflictFactOf(conflict))
    }
  }
  return {
    activation: captured.activation,
    activationOrdinal: captured.activationOrdinal,
    storyPosition: captured.storyPosition,
    acceptedAt: captured.bundle.legacy.runtimeFacts.acceptedAt,
    graph:
      consequences.graph._tag === "GraphNotEstablished"
        ? { _tag: "NotEstablished" }
        : {
            _tag: "Established",
            revision: consequences.graph.observation.snapshot.revision,
            observation: {
              operationId: consequences.graph.observation.operationId,
              contentIdentity: consequences.graph.observation.contentIdentity,
              recordedAt: consequences.graph.observation.recordedAt
            },
            tasks: consequences.graph.observation.snapshot
              .toWire()
              .tasks.map((task) => ({
                id: task.id,
                lifecycle: task.lifecycle._tag,
                parentTaskId: task.parentTaskId,
                prerequisiteIds: task.prerequisiteIds
              }))
          },
    capacity: captured.bundle.legacy.runtimeFacts.taskWork.capacity,
    quiescence: captured.bundle.legacy.runtimeFacts.quiescence,
    heldPositions: captured.bundle.legacy.runtimeFacts.taskWork.held.map(({ correlation, taskId }) => ({
      taskId,
      runId: correlation.runId,
      attemptId: correlation.attemptId
    })),
    frontier: consequences.frontier.standings.map((standing) =>
      standing._tag === "Eligible"
        ? { taskId: standing.taskId, standing: standing._tag, taskRevision: standing.taskRevision, reasons: [] }
        : {
            taskId: standing.taskId,
            standing: standing._tag,
            taskRevision: null,
            reasons: standing.reasons.map(authoredTaggedDiagnosticOf)
          }
    ),
    tickets: consequences.tickets.placements.map(({ placement, taskId }) => ({
      taskId,
      placement: authoredTaggedDiagnosticOf(placement),
      rank: "rank" in placement ? placement.rank : null,
      reasons: placement._tag === "GraphExcluded" ? placement.reasons.map(authoredTaggedDiagnosticOf) : []
    })),
    deliveries: consequences.ticketDeliveries.deliveries.map((ticket) => ({
      taskId: ticket.taskId,
      placement: authoredTaggedDiagnosticOf(ticket.placement),
      evidence: ticket.evidence.map(authoredTaggedDiagnosticOf),
      standings: ticket.standings.map(authoredTaggedDiagnosticOf),
      obligations: ticket.obligations.map(authoredObligationDiagnosticOf)
    })),
    settlements: consequences.settlements.settlements.map(({ attemptId, taskId }) => ({ attemptId, taskId })),
    trackerReflection: {
      _tag: consequences.trackerConsequences._tag,
      settlementCount: consequences.trackerConsequences.source.settlements.length
    },
    actionPlanning:
      runtime.proposedActions._tag === "DeliveryProposalsAvailable"
        ? {
            _tag: "DeliveryProposalsAvailable",
            proposals: runtime.proposedActions.proposals.map(authoredActionProposalFactOf),
            isolatedIssues: runtime.proposedActions.isolatedIssues.map(authoredActionIssueFactOf)
          }
        : { _tag: "DeliveryProposalOwnershipConflict", conflicts: conflictFacts }
  }
}

/** Projects one exact captured publication through the literal production delivery composition. */
export const evaluateAuthoredDeliveryPublication = Effect.fn("AuthoredCassette.evaluateDeliveryPublication")(function* (
  publication: AuthoredDeliveryPublication
) {
  const { consequences, runtime } = yield* Effect.all({
    consequences: evaluateDeliveryRelationInputBundle(publication.bundle),
    runtime: evaluateDeliveryRuntimeInputBundle(publication.bundle)
  })
  return authoredDeliveryFrameOf(publication, consequences, runtime)
})

const minimumCorrectionExhaustionValidationCount = 2
const authoredCandidateContinuationLimit = 2
const gitCommitHexLength = 40
const authoredSettlementYieldTurns = 10

const operatorControlFailureMatches = (
  failure: unknown,
  expectedReason: "IncompleteSnapshot" | "OutsideCurrentTargetClosure"
): boolean => {
  if (expectedReason === "OutsideCurrentTargetClosure") {
    return Schema.is(TaskControlSubjectOutsideRun)(failure)
  }
  /* v8 ignore next -- @preserve The only authored tracker-control failure reason is decoded as IncompleteSnapshot. */
  if (!Schema.is(TrackerAdapterReadError)(failure)) return false
  /* v8 ignore next -- @preserve The authored failure schema cannot name another tracker-read reason. */
  return failure.reason._tag === "IncompleteSnapshot"
}

const attemptChoiceFailureReason = (
  failure: unknown
): "AlreadyApplied" | "IdentityContradiction" | "NotAvailable" | "OutsidePreIntegrationPhase" | undefined => {
  /* v8 ignore start -- @preserve AttemptChoiceControl exposes only its closed tagged error union to these callers. */
  if (typeof failure !== "object" || failure === null || !("_tag" in failure)) return undefined
  /* v8 ignore stop -- @preserve */
  switch (failure._tag) {
    case "AttemptChoiceAlreadyApplied":
      return "AlreadyApplied"
    case "AttemptChoiceRequestIdentityContradiction":
      return "IdentityContradiction"
    case "AttemptChoiceNotAvailable":
      return "NotAvailable"
    case "AttemptChoiceOutsidePreIntegrationPhase":
      return "OutsidePreIntegrationPhase"
    /* v8 ignore start -- @preserve The closed AttemptChoiceControl failure union is exhausted above. */
    default:
      return undefined
    /* v8 ignore stop -- @preserve */
  }
}

type AttemptChoiceControlResult = Result.Result<AttemptChoiceApplicationResult, unknown>

const attemptChoiceDirectionFor = (
  item: AuthoredAttemptChoiceItem
): "ContinueExistingAttempt" | "StopTaskImplementation" =>
  item._tag === "OperatorContinuesAttempt" ? "ContinueExistingAttempt" : "StopTaskImplementation"

const appliedAttemptChoiceMatches = (
  item: AuthoredAttemptChoiceItem,
  result: AttemptChoiceApplicationResult
): boolean => {
  /* v8 ignore start -- @preserve The driver calls this matcher only after selecting an Applied authored result. */
  if (item.expected._tag !== "Applied") return false
  /* v8 ignore stop -- @preserve */
  if (item._tag === "OperatorContinuesAttempt") return result._tag === "ContinueApplied"
  return result._tag === "StopApplied" && result.status._tag === item.expected.status
}

const queriedAttemptChoiceMatches = (
  application: AttemptChoiceApplicationResult,
  queried: AttemptChoiceApplicationResult
): boolean => {
  /* v8 ignore start -- @preserve The immediate journal-derived query must retain the application result's direction tag. */
  if (queried._tag !== application._tag) return false
  /* v8 ignore stop -- @preserve */
  if (queried._tag !== "StopApplied" || application._tag !== "StopApplied") return true
  return queried.status._tag === application.status._tag
}

const attemptChoiceRejectionMatches = (item: AuthoredAttemptChoiceItem, result: AttemptChoiceControlResult): boolean =>
  item.expected._tag === "Rejected" &&
  result._tag === "Failure" &&
  attemptChoiceFailureReason(result.failure) === item.expected.reason

const attemptChoiceRaceHasOneWinner = (results: ReadonlyArray<AttemptChoiceControlResult>): boolean => {
  const successes = results.filter((result) => result._tag === "Success")
  const failures = results.filter((result) => result._tag === "Failure")
  return (
    successes.length === 1 &&
    failures.length === 1 &&
    attemptChoiceFailureReason(failures[0]?.failure) === "AlreadyApplied"
  )
}

type CoordinatorFinalityDecision =
  | { readonly _tag: "RunMayTerminate" }
  | {
      readonly _tag: "RunMustRemainActive"
      readonly reason: "RunnableTransition" | "TrackerTargetUnsettled" | "UnsettledResponsibility"
    }

const coordinatorFinalityMatches = (
  expected: (typeof AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.Type)["decision"],
  actual: CoordinatorFinalityDecision
): boolean => {
  if (expected._tag !== actual._tag) return false
  /* v8 ignore start -- @preserve Authored activation boundaries separate recoveries that must remain active; terminal runs have no following activation boundary. */
  if (expected._tag === "RunMayTerminate") return true
  /* v8 ignore stop -- @preserve */
  return actual._tag === "RunMustRemainActive" && expected.reason === actual.reason
}

const settleCoordinatorActivationReturn = <E>(cursor: StoryCursor, exit: Exit.Exit<CoordinatorFinalityDecision, E>) =>
  Effect.gen(function* () {
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
    const expected = yield* cursor.consumeCoordinatorActivationReturned
    if (!coordinatorFinalityMatches(expected.decision, exit.value)) {
      return yield* Effect.die(
        `authored coordinator activation expected ${JSON.stringify(expected.decision)}, received ${JSON.stringify(exit.value)}`
      )
    }
  })

type TargetVerificationStoryResult = Extract<
  AuthoredCassetteStoryItem,
  { readonly _tag: "TargetVerificationReturned" }
>["result"]

const targetVerificationArtifactsFrom = (
  result: TargetVerificationStoryResult
): ReadonlyArray<TargetVerificationArtifact> =>
  result._tag === "CorrelationContradiction"
    ? []
    : result.artifacts.map(({ content, name }) =>
        TargetVerificationArtifact.make({ bytes: new TextEncoder().encode(content), name })
      )

const foreignTargetVerificationTerminalFrom = (
  correlation: TargetVerificationCorrelation
): TargetVerificationTerminal =>
  TargetVerificationTerminal.cases.Failed.make({
    artifacts: [],
    correlation: TargetVerificationCorrelation.make({
      ...correlation,
      candidateCommit: GitCommitSha.make("f".repeat(gitCommitHexLength)),
      requestId: TargetVerificationRequestId.make(`${correlation.requestId}:foreign`)
    })
  })

const passedTargetVerificationTerminalFrom = (
  artifacts: ReadonlyArray<TargetVerificationArtifact>,
  correlation: TargetVerificationCorrelation
): TargetVerificationTerminal => {
  const [first, ...rest] = artifacts
  /* v8 ignore next -- @preserve Authored Passed verification results require at least one declared artifact; non-passing terminals use their distinct cases. */
  return first === undefined
    ? TargetVerificationTerminal.cases.Failed.make({ artifacts: [], correlation })
    : TargetVerificationTerminal.cases.Passed.make({ artifacts: [first, ...rest], correlation })
}

const targetVerificationTerminalFrom = (
  result: TargetVerificationStoryResult,
  correlation: TargetVerificationCorrelation
): TargetVerificationTerminal => {
  const artifacts = targetVerificationArtifactsFrom(result)
  if (result._tag === "CorrelationContradiction") return foreignTargetVerificationTerminalFrom(correlation)
  switch (result._tag) {
    case "Failed":
      return TargetVerificationTerminal.cases.Failed.make({ artifacts, correlation })
    case "Killed":
      return TargetVerificationTerminal.cases.Killed.make({ artifacts, correlation })
    case "Partial":
      return TargetVerificationTerminal.cases.Partial.make({ artifacts, correlation })
    case "Passed": {
      return passedTargetVerificationTerminalFrom(artifacts, correlation)
    }
    case "TimedOut":
      return TargetVerificationTerminal.cases.TimedOut.make({ artifacts, correlation })
  }
}

/** Decodes and drives one story through the ordinary production delivery program. */
const runAuthoredScenarioCassetteWith = (request: {
  readonly input: unknown
  readonly options: AuthoredScenarioCassetteRunOptions
}) => {
  const { input, options } = request
  return Effect.scoped(
    // eslint-disable-next-line complexity -- One chronological adapter owns the fresh, crash, recovery, candidate, and terminal story boundaries.
    Effect.gen(function* () {
      const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette, { onExcessProperty: "error" })(input)
      yield* Effect.forEach(cassette.story, (item) => assertExactlyOneAuthoredCassetteStoryItemOwner(item._tag), {
        discard: true
      })
      const cursor = yield* makeStoryCursor(cassette.story)
      const activeDeliveryActivation = yield* Ref.make<{
        readonly activation: "Fresh" | "Recovered"
        readonly ordinal: AuthoredActivationOrdinal
      }>({ activation: "Fresh", ordinal: AuthoredActivationOrdinal.make(0) })
      const capturedDeliveryPublications = yield* Ref.make<ReadonlyArray<AuthoredDeliveryPublication>>([])
      const publicationObserver = DeliveryRelationPublicationObserver.of({
        observe: (bundle) =>
          Effect.gen(function* () {
            const { activation, ordinal: activationOrdinal } = yield* Ref.get(activeDeliveryActivation)
            const storyPosition = yield* cursor.storyPosition
            const publication = {
              activation,
              activationOrdinal,
              storyPosition: AuthoredStoryPosition.make(storyPosition),
              bundle
            }
            yield* Ref.update(capturedDeliveryPublications, (captured) => [...captured, publication])
            // A read-only diagnostic observer defect never changes production cassette execution.
            yield* Effect.exit(Effect.sync(() => options.onDeliveryPublication?.(publication)))
          })
      })
      const candidateOutcomeRecorded = yield* Deferred.make<void>()
      const admittedContinuationChoiceApplied = yield* Deferred.make<void>()
      const targetVerificationStory = cassette.story.some((item) => item._tag === "TargetVerificationReturned")
      const targetPromotionStory = cassette.story.some((item) => item._tag.startsWith("TargetPromotion"))
      const candidateTerminalEventTag = targetVerificationStory
        ? cassette.story.some(
            (item) => item._tag === "TargetVerificationReturned" && item.result._tag === "CorrelationContradiction"
          )
          ? "TargetVerificationCorrelationContradicted"
          : "TargetVerificationEvidenceSealed"
        : cassette.story.some(
              (item) =>
                item._tag === "IntegrationCandidateAgentReported" && item.report._tag === "CorrelationContradiction"
            )
          ? "IntegrationCandidateAgentReported"
          : cassette.story.some(
                (item) =>
                  item._tag === "ExpectedBehavior" &&
                  item.orchestration?.some((evidence) => evidence._tag === "IntegrationCandidateConstructed")
              )
            ? "IntegrationCandidateConstructed"
            : cassette.story.filter((item) => item._tag === "IntegrationCandidateGitValidationReturned").length >=
                minimumCorrectionExhaustionValidationCount
              ? "IntegrationCandidateCorrectionLimitReached"
              : cassette.story.filter(
                    (item) => item._tag === "IntegrationCandidateAgentReported" && item.report._tag !== "Submitted"
                  ).length >= authoredCandidateContinuationLimit
                ? "IntegrationCandidateContinuationLimitReached"
                : cassette.story.some((item) => item._tag === "IntegrationCandidateAgentReported")
                  ? "IntegrationCandidateAgentReported"
                  : undefined
      const initial = yield* cursor.consumeInitialPolicy
      const command = yield* cursor.consumeRunCoordinator
      const runId = yield* freshWorkflowRunId(command.target)
      const coordinatorLifecycleBoundaryCount = cassette.story.filter(
        (item) => item._tag === "CoordinatorActivationReturned" || item._tag === "CoordinatorProcessDies"
      ).length
      const trace = controlledTrace(cursor)
      const sharedContext = yield* Layer.build(
        Layer.mergeAll(
          memoryJournalStoreLayer,
          controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims),
          gitTargetLineageTestLayer(
            cassette.startingFacts.targetLineageObservation ??
              TargetLineageObservation.make({
                plannedBaseIsAncestorOfTargetHead: true,
                plannedBaseSha: command.baseSha,
                targetHeadSha: command.baseSha
              })
          ),
          gitWorktreeTestLayer(cassette.startingFacts.worktreeObservation)
        )
      )
      const sharedJournal = Context.get(sharedContext, JournalStore)
      const evidenceStoreContext = yield* Layer.build(memoryEvidenceStoreLayer)
      const evidenceStore = Context.get(evidenceStoreContext, EvidenceStore)
      const verificationPlan =
        command.verificationPlanId === null
          ? undefined
          : TargetVerificationPlan.make({ planId: command.verificationPlanId, target: command.integrationTarget })
      const verificationReports = yield* Ref.make<ReadonlyMap<string, TargetVerificationTerminal>>(new Map())
      const targetVerificationBoundary = TargetVerificationBoundary.of({
        runOrResume: (request) =>
          Ref.get(verificationReports).pipe(
            Effect.flatMap((reports) => {
              const existing = reports.get(request.requestId)
              /* v8 ignore start -- @preserve The journaled verification protocol settles its exact request before another delivery can select it; this cache is a fail-safe for an invalid duplicate boundary call. */
              if (existing !== undefined) return Effect.succeed(existing)
              /* v8 ignore stop -- @preserve */
              return cursor.consumeTargetVerificationReturned.pipe(
                Effect.mapError(
                  /* v8 ignore next -- @preserve Maintained verification cassettes supply the declared wrapper return; generic cursor mismatch behavior is tested at the cursor seam. */
                  (failure) =>
                    new TargetVerificationBoundaryFailure({
                      detail: `${failure._tag} at story position ${failure.storyPosition}`,
                      requestId: request.requestId
                    })
                ),
                Effect.map((item) => targetVerificationTerminalFrom(item.result, request)),
                Effect.tap((terminal) =>
                  Ref.update(verificationReports, (current) => new Map(current).set(request.requestId, terminal))
                )
              )
            })
          )
      })
      const targetPromotionGit = {
        compareAndSet: (request: Parameters<TargetPromotionGitService["compareAndSet"]>[0]) =>
          cursor.consumeTargetPromotionCompareAndSet.pipe(
            Effect.map(({ result }) =>
              result._tag === "Applied"
                ? TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: request.candidateCommit })
                : TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({
                    observedHeadSha: result.observedHeadSha
                  })
            ),
            Effect.mapError(
              /* v8 ignore next -- @preserve Maintained promotion cassettes supply the declared compare-and-set occurrence; cursor mismatch behavior is shared. */
              (failure) =>
                new TargetPromotionCompareAndSetFailure({
                  candidateCommit: request.candidateCommit,
                  detail: `${failure._tag}: ${"detail" in failure ? failure.detail : "interaction mismatch"} at story position ${failure.storyPosition}`,
                  expectedHead: request.expectedTargetHead,
                  target: request.integrationTarget
                })
            )
          ),
        read: (request: Parameters<TargetPromotionGitService["read"]>[0]) =>
          cursor.consumeTargetPromotionGitRead.pipe(
            Effect.map(({ observation }) => TargetPromotionGitReadObservation.make(observation)),
            Effect.mapError(
              /* v8 ignore next -- @preserve Authored coordinator runs publish read failure through the runtime relation; the maintained direct protocol cassette owns the typed unreadable chronology. */
              (failure) =>
                new TargetPromotionGitReadFailure({
                  candidateCommit: request.candidateCommit,
                  detail: `${failure._tag}: ${"detail" in failure ? failure.detail : "interaction mismatch"} at story position ${failure.storyPosition}`,
                  target: request.integrationTarget
                })
            )
          )
      }
      const journalLayer = journalStoreCapabilities(
        Layer.succeed(
          JournalStore,
          JournalStore.of({
            ...sharedJournal,
            append: (requestedRunId, key, event) =>
              sharedJournal
                .append(requestedRunId, key, event)
                .pipe(
                  Effect.tap(() =>
                    candidateTerminalEventTag !== undefined && event._tag === candidateTerminalEventTag
                      ? Deferred.succeed(candidateOutcomeRecorded, undefined)
                      : Effect.void
                  )
                )
          })
        )
      )
      const activeOperatorControl = yield* Ref.make<
        JournaledRunBootstrap["Service"]["operatorControl"]["applyControlDirection"]
      >(
        /* v8 ignore next -- @preserve The controlled driver starts only after installing the bootstrap operator control. */
        () => Effect.die("operator control is not installed")
      )
      const applyNextControlDirection = Effect.gen(function* () {
        const direction = yield* cursor.consumeInFlightExecutorControlDirection
        if (Option.isNone(direction)) return
        yield* (yield* Ref.get(activeOperatorControl))({
          direction: direction.value.direction,
          subject:
            direction.value.subject._tag === "Run"
              ? { _tag: "Run", runId }
              : { _tag: "Task", runId, taskId: direction.value.subject.taskId }
        }).pipe(Effect.orDie)
      })
      const trackerAuthority = yield* Layer.build(
        controlledTrackerAuthorityLayer(cursor, Context.get(sharedContext, TrackerMutation))
      )
      const trackerMutationLayer = Layer.succeed(TrackerMutation, Context.get(trackerAuthority, TrackerMutation))
      const completionClaimBoundary = Context.get(trackerAuthority, CompletionClaimBoundary)
      const completionFinalityConfigured = cassette.story.some(
        (item) =>
          item._tag === "CompletionClaimReadReturned" ||
          item._tag === "CompletionClaimReplacementApplied" ||
          item._tag === "CompletionClaimDeletionApplied"
      )
      const gitWorktreeLayer = Layer.succeed(GitWorktree, Context.get(sharedContext, GitWorktree))
      const gitTargetLineage = Context.get(sharedContext, GitTargetLineage)
      const testGitWorktree = Context.get(sharedContext, TestGitWorktree)
      const trackerLayer = controlledTrackerGraphReaderLayer(cursor)
      const ordinaryInterpreterLayer = workflowInterpreterLayer.pipe(
        Layer.provide(Layer.merge(trackerLayer, trackerMutationLayer)),
        Layer.provide(gitWorktreeLayer),
        Layer.provide(Layer.succeed(GitTargetLineage, gitTargetLineage))
      )
      const boundaryAdjustedInterpreterLayer = Layer.effect(
        WorkflowInterpreter,
        Effect.gen(function* () {
          const interpreter = yield* WorkflowInterpreter
          const gitWorktree = yield* GitWorktree
          return WorkflowInterpreter.of({
            ...interpreter,
            readTaskWorktree: (operation) =>
              Effect.gen(function* () {
                const change = yield* cursor.consumeGitWorktreeObservationChange
                if (Option.isSome(change)) {
                  yield* testGitWorktree.setObservation(change.value.observation)
                }
                return yield* observePlannedAttemptWorktreeThrough(gitWorktree, operation)
              }),
            readTargetLineage: (operation) => observeTargetLineageThrough(gitTargetLineage, operation),
            reconcileTaskWorktree: (operation) =>
              runGitWorktreeReconciliation(gitWorktree, operation.plannedAttempt).pipe(
                Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
              )
          })
        })
      ).pipe(Layer.provide(ordinaryInterpreterLayer), Layer.provide(gitWorktreeLayer))
      const baseControlPolicyLayer = taskWorkCapacityControlLayer
      const operatorControlLayer = Layer.mergeAll(
        attemptChoiceControlLayer,
        controlDirectionApplicationLayer,
        taskClaimReacquisitionControlLayer
      )
      const controlPolicyLayer = Layer.merge(baseControlPolicyLayer, operatorControlLayer)
      const interpreterLayer = journaledWorkflowInterpreterLayer(runId, boundaryAdjustedInterpreterLayer)
      const planningLayer = (phase: "fresh" | "recovery", recoveryOrdinal = 1) =>
        Layer.mergeAll(
          deterministicOperationIdAllocatorLayer(
            phase === "fresh"
              ? `cassette:${runId}:operation`
              : recoveryOrdinal === 1
                ? `cassette:${runId}:recovery:operation`
                : `cassette:${runId}:recovery:${recoveryOrdinal}:operation`
          ),
          deterministicTaskClaimAcquisitionPlannerLayer({
            owner: command.claimOwner,
            tokenPrefix: command.claimTokenPrefix
          }),
          deterministicPlannedTaskAttemptLayer({
            baseSha: command.baseSha,
            executor: command.executor,
            runId,
            worktreeRoot: command.worktreeRoot
          })
        )
      const candidateLayer = Layer.merge(
        Layer.succeed(
          IntegrationCandidateAgent,
          IntegrationCandidateAgent.of({
            startOrContinue: (request) =>
              cursor.consumeIntegrationCandidateAgentReport.pipe(
                Effect.flatMap((candidateReport) => {
                  /* v8 ignore next -- @preserve Accepted authored candidate stories declare every report; this diagnostic keeps malformed runtime re-entry total. */
                  if (Option.isNone(candidateReport)) {
                    return Context.get(sharedContext, JournalStore)
                      .read(runId)
                      .pipe(
                        Effect.orDie,
                        Effect.flatMap((candidateRecords) =>
                          Effect.die(
                            `candidate frontier invoked the agent without an authored report: ${candidateRecords
                              .filter(({ event }) => event._tag.startsWith("IntegrationCandidate"))
                              .map(({ event }) => event._tag)
                              .join(",")}`
                          )
                        )
                      )
                  }
                  const authored = candidateReport.value.report
                  return Effect.succeed(
                    authored._tag === "Submitted"
                      ? IntegrationCandidateAgentReport.cases.Submitted.make({
                          candidateCommit: authored.candidateCommit,
                          correlation: request.correlation
                        })
                      : authored._tag === "Conflict"
                        ? IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: request.correlation })
                        : authored._tag === "CorrelationContradiction"
                          ? IntegrationCandidateAgentReport.cases.Working.make({
                              correlation: {
                                ...request.correlation,
                                candidateResource: IntegrationCandidateResourceLocator.make(
                                  "/candidate-resources/authored-foreign"
                                )
                              }
                            })
                          : authored._tag === "ExitedWithoutCandidate"
                            ? IntegrationCandidateAgentReport.cases.ExitedWithoutCandidate.make({
                                correlation: request.correlation
                              })
                            : IntegrationCandidateAgentReport.cases.Working.make({ correlation: request.correlation })
                  )
                })
              )
          })
        ),
        Layer.succeed(
          IntegrationCandidateGit,
          IntegrationCandidateGit.of({
            readSubmittedCommit: (repository, candidateCommit) =>
              cursor.consumeIntegrationCandidateGitValidation.pipe(
                Effect.map(({ observation }) => observation),
                Effect.mapError(
                  (failure) =>
                    new IntegrationCandidateGitReadFailure({
                      candidateCommit,
                      detail: `${failure._tag}: ${
                        /* v8 ignore next -- @preserve The generic interaction-mismatch rendering is exercised at the shared authored cursor boundary. */
                        failure._tag === "AuthoredIntegrationCandidateGitValidationFailure"
                          ? failure.detail
                          : "interaction mismatch"
                      } at story position ${failure.storyPosition}`,
                      repository
                    })
                )
              )
          })
        )
      )
      const coordinatorOwnershipLayer = Layer.succeed(
        CoordinatorOwnership,
        /* v8 ignore next -- startup only requires capability presence; cassette mutations use controlled authorities. */
        CoordinatorOwnership.of({ runMutation: (mutation) => mutation })
      )
      const recoveredRuntimeOrdinal = yield* Ref.make(0)
      const survivingExecutorReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
      const unresolvedLostExecutorResponses = yield* Ref.make<ReadonlySet<string>>(new Set())
      const runtimeLayerFor = ({ startup }: JournaledRuntimeLayerInput, recoveryOrdinal: number) => {
        const planning = planningLayer(startup === "Fresh" ? "fresh" : "recovery", recoveryOrdinal)
        const executorLayer = controlledExecutorLayer(
          cursor,
          runId,
          applyNextControlDirection,
          survivingExecutorReports,
          unresolvedLostExecutorResponses
        ).pipe(Layer.provide(controlPolicyLayer))
        const startupLayer = validatedStartupRecoveryLayer(
          runId,
          command.integrationTarget,
          startup,
          CandidateCorrectionLimit.make(1),
          CandidateContinuationLimit.make(authoredCandidateContinuationLimit),
          verificationPlan === undefined
            ? undefined
            : { boundary: targetVerificationBoundary, evidenceStore, plan: verificationPlan },
          targetPromotionStory ? { git: targetPromotionGit } : undefined,
          completionFinalityConfigured ? completionClaimBoundary : undefined
        ).pipe(
          Layer.provide(candidateLayer),
          Layer.provide(interpreterLayer),
          Layer.provide(controlPolicyLayer),
          Layer.provide(executorLayer),
          Layer.provide(Layer.succeed(WorkflowTrace, trace)),
          Layer.provide(planning)
        )
        return startupLayer
      }
      const runtimeLayer = (input: JournaledRuntimeLayerInput) =>
        input.startup === "Fresh"
          ? runtimeLayerFor(input, 0)
          : Layer.unwrap(
              Ref.updateAndGet(recoveredRuntimeOrdinal, (ordinal) => ordinal + 1).pipe(
                Effect.map((ordinal) => runtimeLayerFor(input, ordinal))
              )
            )
      const application = journaledRunBootstrapLayer(runId, runtimeLayer).pipe(
        Layer.provide(journalLayer),
        Layer.provide(coordinatorOwnershipLayer)
      )

      const withAuthoredOperatorDriver = <A, E, R>(program: Effect.Effect<A, E, R>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const bootstrap = yield* JournaledRunBootstrap
            yield* Ref.set(activeOperatorControl, bootstrap.operatorControl.applyControlDirection)
            const driveCapacityChange = Effect.gen(function* () {
              const change = yield* cursor.consumeCapacityChange
              /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
              if (Option.isNone(change)) return
              /* v8 ignore stop */
              const current = yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)
              yield* bootstrap.operatorControl.setTaskWorkCapacity({
                capacity: change.value.capacity,
                expectedRevision: current.revision,
                runId
              })
            }).pipe(Effect.orDie)
            const requirePlannedAttempt = Effect.fn("AuthoredCassette.requirePlannedAttempt")(function* (item: {
              readonly attemptId: AuthoredAttemptChoiceItem["attemptId"]
              readonly taskId: AuthoredAttemptChoiceItem["taskId"]
            }) {
              const planned = (yield* sharedJournal.read(runId)).findLast(
                ({ event }) =>
                  event._tag === "TaskAttemptPlanned" &&
                  event.operation.plannedAttempt.attemptId === item.attemptId &&
                  event.operation.plannedAttempt.taskId === item.taskId
              )?.event
              if (planned?._tag !== "TaskAttemptPlanned") {
                return yield* Effect.die(
                  new Error(`authored attempt choice cannot find planned attempt ${item.attemptId}`)
                )
              }
              return planned.operation.plannedAttempt
            })
            const applyAttemptChoice = (
              plannedAttempt: PlannedTaskAttempt,
              observedTaskRevision: TaskRevision,
              choice: "ContinueExistingAttempt" | "StopTaskImplementation",
              nonce: string
            ) =>
              Effect.result(
                bootstrap.operatorControl.applyAttemptChoice({
                  choice,
                  requestId: AttemptChoiceRequestId.make({ nonce, runId }),
                  subject: { observedTaskRevision, plannedAttempt }
                })
              )
            const confirmAppliedAttemptChoice = Effect.fn("AuthoredCassette.confirmAppliedAttemptChoice")(function* (
              item: AuthoredAttemptChoiceItem,
              requestId: AttemptChoiceRequestId,
              result: AttemptChoiceControlResult
            ) {
              if (result._tag !== "Success") {
                const reason = attemptChoiceFailureReason(result.failure)
                /* v8 ignore start -- @preserve AttemptChoiceControl's closed tagged failure union is classified exhaustively. */
                if (reason === undefined) {
                  return yield* Effect.die(
                    new Error(`authored attempt choice ${item.requestNonce} failed with unexpected failure`)
                  )
                }
                /* v8 ignore stop -- @preserve */
                return yield* Effect.die(
                  new Error(`authored attempt choice ${item.requestNonce} failed with ${reason}`)
                )
              }
              if (!appliedAttemptChoiceMatches(item, result.success)) {
                return yield* Effect.die(new Error(`authored attempt-choice result mismatch for ${item.requestNonce}`))
              }
              const queried = yield* bootstrap.operatorControl.readAttemptChoice(requestId)
              /* v8 ignore start -- @preserve The query is derived from the exact application record written immediately above. */
              if (!queriedAttemptChoiceMatches(result.success, queried)) {
                return yield* Effect.die(new Error(`authored attempt-choice query mismatch for ${item.requestNonce}`))
              }
              /* v8 ignore stop -- @preserve */
              if (item._tag === "OperatorStopsAttempt") {
                yield* Deferred.succeed(admittedContinuationChoiceApplied, undefined)
              }
            })
            const driveAttemptChoice = Effect.gen(function* () {
              const authored = yield* cursor.consumeAttemptChoice
              if (Option.isNone(authored)) return
              const item = authored.value
              const plannedAttempt = yield* requirePlannedAttempt(item)
              const requestId = AttemptChoiceRequestId.make({ nonce: item.requestNonce, runId })
              const result = yield* applyAttemptChoice(
                plannedAttempt,
                item.observedTaskRevision,
                attemptChoiceDirectionFor(item),
                item.requestNonce
              )
              if (item.expected._tag === "Rejected") {
                if (!attemptChoiceRejectionMatches(item, result)) {
                  return yield* Effect.die(
                    new Error(`authored attempt-choice rejection mismatch for ${item.requestNonce}`)
                  )
                }
                return
              }
              yield* confirmAppliedAttemptChoice(item, requestId, result)
            }).pipe(Effect.orDie)
            const driveAttemptChoiceRace = Effect.gen(function* () {
              const authored = yield* cursor.consumeAttemptChoiceRace
              /* v8 ignore start -- @preserve The tag-selected driver runs only while the race item is current. */
              if (Option.isNone(authored)) return
              /* v8 ignore stop -- @preserve */
              const item = authored.value
              const plannedAttempt = yield* requirePlannedAttempt(item)
              const apply = (choice: "ContinueExistingAttempt" | "StopTaskImplementation", nonce: string) =>
                applyAttemptChoice(plannedAttempt, item.observedTaskRevision, choice, nonce)
              const results = yield* Effect.all(
                [
                  apply("ContinueExistingAttempt", item.continueRequestNonce),
                  apply("StopTaskImplementation", item.stopRequestNonce)
                ],
                { concurrency: "unbounded" }
              )
              /* v8 ignore start -- @preserve Atomic request-key application makes one success and one AlreadyApplied failure exhaustive. */
              if (!attemptChoiceRaceHasOneWinner(results)) {
                return yield* Effect.die(new Error("authored concurrent Continue/Stop race did not produce one winner"))
              }
              /* v8 ignore stop -- @preserve */
            }).pipe(Effect.orDie)
            const driveControlDirection = Effect.gen(function* () {
              const direction = yield* cursor.consumeControlDirection
              /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
              if (Option.isNone(direction)) return
              /* v8 ignore stop */
              const result = bootstrap.operatorControl.applyControlDirection({
                direction: direction.value.direction,
                subject:
                  direction.value.subject._tag === "Run"
                    ? { _tag: "Run", runId }
                    : { _tag: "Task", runId, taskId: direction.value.subject.taskId }
              })
              yield* result.pipe(
                Effect.matchEffect({
                  onSuccess: () => Effect.void,
                  onFailure: (failure) =>
                    Effect.gen(function* () {
                      const expected = yield* cursor.consumeControlDirectionFailure
                      /* v8 ignore next -- @preserve Maintained failed-control stories carry the immediately following visible result. */
                      if (Option.isNone(expected)) return yield* failure
                      const expectedFailure = expected.value
                      /* v8 ignore next -- @preserve Both maintained failure variants exercise the matching path; this guard diagnoses malformed authored stories. */
                      if (
                        !operatorControlFailureMatches(failure, expectedFailure.reason) ||
                        direction.value.direction !== expectedFailure.direction ||
                        direction.value.subject._tag !== "Task" ||
                        direction.value.subject.taskId !== expectedFailure.subject.taskId
                      ) {
                        return yield* Effect.die(
                          new Error(
                            `authored control failure mismatch: expected ${expectedFailure.reason}, received ${failure._tag}`
                          )
                        )
                      }
                    })
                })
              )
            }).pipe(Effect.orDie)
            const driveClaimReacquisition = Effect.gen(function* () {
              const direction = yield* cursor.consumeClaimReacquisitionDirection
              /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
              if (Option.isNone(direction)) return
              /* v8 ignore stop */
              yield* bootstrap.operatorControl.applyTaskClaimReacquisition({
                requestId: direction.value.requestId,
                subject: { runId, taskId: direction.value.taskId }
              })
            }).pipe(Effect.orDie)
            const drivers: Partial<Record<AuthoredCassetteStoryItem["_tag"], Effect.Effect<void>>> = {
              CoordinatorProcessDies: cursor.pauseAtCoordinatorProcessDeath,
              OperatorContinuesAttempt: driveAttemptChoice,
              OperatorAppliesControlDirection: driveControlDirection,
              OperatorDirectsTaskClaimReacquisition: driveClaimReacquisition,
              OperatorRacesContinueAndStop: driveAttemptChoiceRace,
              OperatorStopsAttempt: driveAttemptChoice,
              SetTaskExecutionCapacity: driveCapacityChange
            }
            const driveAuthoredOperatorItem = (item: AuthoredCassetteStoryItem | undefined) => {
              /* v8 ignore start -- scoped execution stops before the cursor can publish its out-of-range sentinel. */
              if (item === undefined) return Effect.void
              /* v8 ignore stop */
              return drivers[item._tag] ?? Effect.void
            }
            yield* cursor.storyItems.pipe(Stream.runForEach(driveAuthoredOperatorItem), Effect.forkScoped)
            return yield* program
          })
        )

      const controlledExecutorFactory = (factoryRunId: RunId, factoryTarget: typeof command.target) =>
        Effect.gen(function* () {
          const live = yield* makeLiveDeliveryActionExecutor(factoryRunId, factoryTarget)
          return {
            ...live,
            execute: (action, lease) =>
              Effect.gen(function* () {
                const hold = yield* cursor.consumeAdmittedContinuationExecutorIntentHold
                if (Option.isSome(hold)) {
                  const expected = hold.value
                  /* v8 ignore start -- @preserve Hold closure validation places this synchronization only before the exact admitted Continue action. */
                  if (
                    action._tag !== "IdentityFreeAction" ||
                    action.proposal.route._tag !== "IdentityFreeWorkflowRoute" ||
                    action.proposal.route.transition._tag !== "ContinuePlannedAttemptExecutorWork"
                  ) {
                    return yield* Effect.die(
                      new Error(
                        `authored continuation hold expected ContinuePlannedAttemptExecutorWork, received ${action.proposal.route._tag}`
                      )
                    )
                  }
                  /* v8 ignore stop -- @preserve */
                  const transition = action.proposal.route.transition
                  /* v8 ignore start -- @preserve Hold closure binds the same exact task and attempt through Stop and the executor outcome. */
                  if (
                    transition.plannedAttempt.attemptId !== expected.attemptId ||
                    transition.plannedAttempt.taskId !== expected.taskId
                  ) {
                    return yield* Effect.die(
                      new Error(
                        `authored continuation hold expected ${expected.taskId}/${expected.attemptId}, received ${transition.plannedAttempt.taskId}/${transition.plannedAttempt.attemptId}`
                      )
                    )
                  }
                  /* v8 ignore stop -- @preserve */
                  yield* Deferred.await(admittedContinuationChoiceApplied)
                }
                return yield* live.execute(action, lease)
              })
          } satisfies DeliveryActionExecutorService
        })

      const freshRun = withAuthoredOperatorDriver(
        runWorkflowWithControlledDeliveryActionExecutor(
          command.target,
          initial.policy,
          runId,
          controlledExecutorFactory
        ).pipe(Effect.provide(planningLayer("fresh")))
      )
      const runAcrossCoordinatorLifecycles = Effect.gen(function* () {
        let coordinator = yield* Effect.forkScoped(freshRun)
        const coordinatorActivations: Array<"Fresh" | "Recovered"> = ["Fresh"]
        let consumedLifecycleBoundaries = 0
        let recoveryOrdinal = 0
        while (consumedLifecycleBoundaries < coordinatorLifecycleBoundaryCount) {
          const boundary = yield* Effect.raceFirst(
            cursor.awaitCoordinatorProcessDeath.pipe(Effect.as({ _tag: "CoordinatorProcessDied" as const })),
            Fiber.await(coordinator).pipe(
              Effect.map((exit) => ({ _tag: "CoordinatorActivationReturned" as const, exit }))
            )
          )
          consumedLifecycleBoundaries += 1
          if (boundary._tag === "CoordinatorActivationReturned") {
            yield* settleCoordinatorActivationReturn(cursor, boundary.exit)
          } else {
            yield* Fiber.interrupt(coordinator)
          }
          if (yield* cursor.atTerminalAssertions) break
          recoveryOrdinal += 1
          yield* Ref.set(activeDeliveryActivation, {
            activation: "Recovered" as const,
            ordinal: AuthoredActivationOrdinal.make(recoveryOrdinal)
          })
          const recoveredRun = withAuthoredOperatorDriver(
            runRecoveredWorkflowWithControlledDeliveryActionExecutor(command.target, controlledExecutorFactory).pipe(
              Effect.provide(planningLayer("recovery", recoveryOrdinal))
            )
          )
          coordinator = yield* recoveredRun.pipe(Effect.forkScoped({ startImmediately: true }))
          coordinatorActivations.push("Recovered")
        }
        yield* Effect.raceFirst(
          cursor.awaitTerminalAssertions,
          Fiber.join(coordinator).pipe(
            Effect.andThen(Effect.die("recovered coordinator stopped before the authored terminal assertions"))
          )
        )
        if (candidateTerminalEventTag !== undefined) {
          yield* Effect.raceFirst(
            Deferred.await(candidateOutcomeRecorded),
            Fiber.join(coordinator).pipe(
              Effect.andThen(Effect.die(`coordinator stopped before recording ${candidateTerminalEventTag}`))
            )
          )
        }
        for (let settleTurn = 0; settleTurn < authoredSettlementYieldTurns; settleTurn += 1) yield* Effect.yieldNow
        const recoveredCoordinatorExit = coordinator.pollUnsafe()
        yield* Fiber.interrupt(coordinator)
        return { coordinatorActivations, records: yield* sharedJournal.read(runId), recoveredCoordinatorExit }
      })
      const runFreshCoordinator = Effect.gen(function* () {
        const coordinatorActivations: ReadonlyArray<"Fresh" | "Recovered"> = ["Fresh"]
        yield* freshRun
        return {
          coordinatorActivations,
          records: yield* sharedJournal.read(runId),
          recoveredCoordinatorExit: undefined
        }
      })
      const coordinatorExecution = Effect.gen(function* () {
        if (coordinatorLifecycleBoundaryCount > 0) return yield* runAcrossCoordinatorLifecycles
        return yield* runFreshCoordinator
      })
      const execution = yield* Effect.scoped(
        coordinatorExecution.pipe(
          Effect.provide(application),
          Effect.provideService(DeliveryRelationPublicationObserver, publicationObserver)
        )
      )
      const { coordinatorActivations, records, recoveredCoordinatorExit } = execution
      /* v8 ignore next -- @preserve Recovered authored runs return success after their declared final read; action failures are asserted by the direct protocol cassette. */
      if (recoveredCoordinatorExit !== undefined && Exit.isFailure(recoveredCoordinatorExit)) {
        return yield* Effect.failCause(recoveredCoordinatorExit.cause)
      }
      const assertions = yield* cursor.consumeTerminalAssertions
      const behaviorExit = yield* Effect.exit(assertAuthoredExpectedBehavior(records, assertions))
      if (Exit.isFailure(behaviorExit)) {
        return yield* Effect.failCause(behaviorExit.cause)
      }
      const observedBehavior = behaviorExit.value
      const deliveryFrames = yield* Effect.forEach(
        yield* Ref.get(capturedDeliveryPublications),
        evaluateAuthoredDeliveryPublication
      )
      return {
        cassette,
        coordinatorActivations,
        deliveryFrames,
        history: reduceWorkflowJournalHistory(runId, records),
        observedBehavior,
        records,
        runId
      } satisfies AuthoredScenarioCassetteRun
    })
  )
}

/** Decodes and drives one story through the production coordinator activation program. */
export const runAuthoredScenarioCassette = (input: unknown, options: AuthoredScenarioCassetteRunOptions = {}) =>
  runAuthoredScenarioCassetteWith({ input, options })
