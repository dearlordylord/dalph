/* eslint-disable max-lines -- One closed schema keeps every authored boundary tag and chronology invariant reviewable together. */
import { Effect, Match, Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  TaskExecutorLocator,
  TaskId,
  makeTaskWorkSpecification,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ControlDirection,
  InitialControlPolicy,
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  TaskLifecycle,
  TaskWorkCapacity,
  TaskClaimObservation,
  TaskClaimReacquisitionRequestId,
  TargetLineageObservation,
  TargetPromotionAttemptOrdinal,
  TargetPromotionGitRequest,
  TargetPromotionRequest,
  TargetPromotionTerminalBasis,
  TrackerRevision,
  TrackerTarget,
  JournalPosition,
  OperationId
} from "@dalph/orchestrator"
import {
  AuthoredContinueAttemptResult,
  AuthoredRestartAttemptResult,
  AuthoredStopAttemptResult
} from "./authored-attempt-choice.js"
import { AuthoredProtocolEvidence } from "./authored-protocol-evidence.js"
export { AuthoredProtocolEvidence } from "./authored-protocol-evidence.js"

const AuthoredTrackerTask = Schema.Struct({
  id: TaskId,
  lifecycle: TaskLifecycle,
  parentTaskId: Schema.NullOr(TaskId),
  prerequisiteIds: Schema.Array(TaskId)
})

/** Provider-neutral tracker facts a maintainer can read and author. */
export const AuthoredTrackerGraph = Schema.Struct({
  revision: TrackerRevision,
  /** Exact tracker-selected Run root; absent only when the provider returned no root (for example, an empty graph). */
  rootTaskId: Schema.optionalKey(TaskId),
  tasks: Schema.Array(AuthoredTrackerTask)
})
export type AuthoredTrackerGraph = typeof AuthoredTrackerGraph.Type

/** The one-based position of a bounded Run activation in an authored whole-Run cassette. */
export const AuthoredRunActivationOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("AuthoredRunActivationOrdinal")
)
export type AuthoredRunActivationOrdinal = typeof AuthoredRunActivationOrdinal.Type

/**
 * Stable cassette-only name for one exact operation occurrence. The authored
 * story can therefore constrain generated operation identities without
 * hard-coding a Run-local identifier.
 */
const AuthoredCausalRole = Schema.NonEmptyString.pipe(Schema.brand("AuthoredCausalRole"))

/**
 * Symbolic name for one operation selected at the real trace seam whose own
 * ancestry is outside this causal check. Later batch members may name this
 * exact raw operation identity as an immediate predecessor.
 */
const AuthoredCausalAnchor = Schema.Struct({ occurrenceRole: AuthoredCausalRole })

/** Exact symbolic predecessor contract for one authored operation selection. */
export const AuthoredCausalSelection = Schema.Struct({
  occurrenceRole: AuthoredCausalRole,
  predecessorRoles: Schema.Array(AuthoredCausalRole).check(Schema.isUnique())
})
export type AuthoredCausalSelection = typeof AuthoredCausalSelection.Type

export const AuthoredTaskWorkSpecification = Schema.Struct({
  body: Schema.String,
  taskId: TaskId,
  title: Schema.NonEmptyString
})
export type AuthoredTaskWorkSpecification = typeof AuthoredTaskWorkSpecification.Type

export const AuthoredCassetteDecision = Schema.TaggedUnion({
  AcquireTaskClaim: { taskId: TaskId },
  ReadTaskClaim: { taskId: TaskId },
  ReadTargetLineage: { attemptId: AttemptId, taskId: TaskId },
  ReadTaskWorktree: { attemptId: AttemptId, taskId: TaskId },
  ReadTaskWorkSpecification: { taskId: TaskId },
  ReadTrackerGraph: { target: TrackerTarget },
  ReleaseTaskClaim: { taskId: TaskId },
  ReconcileTaskWorktree: { attemptId: AttemptId, taskId: TaskId },
  RecordTaskAttemptPlan: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredCassetteDecision = typeof AuthoredCassetteDecision.Type

/**
 * Result owned by one cassette-only concurrent tracker read. These are the
 * two tracker boundaries used by the active-work G1/F2 chronology; Git and
 * claim reads keep their ordinary ordered story items.
 */
export const AuthoredConcurrentTrackerReadResult = Schema.TaggedUnion({
  TaskWorkSpecificationReadReturned: AuthoredTaskWorkSpecification.fields,
  TrackerGraphReadFailed: { reason: Schema.Literal("IncompleteSnapshot") },
  TrackerGraphReadReturned: { graph: AuthoredTrackerGraph }
})
export type AuthoredConcurrentTrackerReadResult = typeof AuthoredConcurrentTrackerReadResult.Type

const AuthoredConcurrentTrackerRead = Schema.Union([
  Schema.Struct({
    causal: AuthoredCausalSelection,
    operation: AuthoredCassetteDecision.cases.ReadTaskWorkSpecification,
    result: AuthoredConcurrentTrackerReadResult.cases.TaskWorkSpecificationReadReturned
  }),
  Schema.Struct({
    causal: AuthoredCausalSelection,
    operation: AuthoredCassetteDecision.cases.ReadTrackerGraph,
    result: Schema.Union([
      AuthoredConcurrentTrackerReadResult.cases.TrackerGraphReadFailed,
      AuthoredConcurrentTrackerReadResult.cases.TrackerGraphReadReturned
    ])
  })
]).check(
  Schema.makeFilter((member) =>
    member.operation._tag === "ReadTaskWorkSpecification" && member.result._tag === "TaskWorkSpecificationReadReturned"
      ? member.operation.taskId === member.result.taskId
        ? undefined
        : "a concurrent task-work specification result must name the selected task"
      : undefined
  )
)
export type AuthoredConcurrentTrackerRead = typeof AuthoredConcurrentTrackerRead.Type

/**
 * Executor reports in authored input name the attempt but never a RunId.
 * Dalph adds the RunId it created when the ordinary executor boundary is used.
 */
export const AuthoredPlannedAttemptExecutorReport = Schema.TaggedUnion({
  ExecutorWorkExecuting: { attemptId: AttemptId },
  ExecutorWorkSafelySuspended: { attemptId: AttemptId },
  ExecutorWorkTerminal: {
    attemptId: AttemptId,
    result: Schema.TaggedUnion({
      Accepted: { acceptedResult: Schema.Struct({ commit: GitCommitSha }) },
      Completed: {},
      Failed: {}
    })
  }
})
export type AuthoredPlannedAttemptExecutorReport = typeof AuthoredPlannedAttemptExecutorReport.Type

/** Specialist-facing results of one task's planned work; attempt identity is deliberately absent. */
export const AuthoredTaskWorkResult = Schema.TaggedUnion({
  PlannedWorkForTaskAccepted: { commit: GitCommitSha, taskId: TaskId },
  PlannedWorkForTaskCompleted: { taskId: TaskId },
  PlannedWorkForTaskFailed: { taskId: TaskId }
})
export type AuthoredTaskWorkResult = typeof AuthoredTaskWorkResult.Type

/** A terminal assertion that Dalph assumed no executor-work responsibility for the task. */
export const AuthoredTaskWorkAbsence = Schema.TaggedStruct("NoPlannedWorkUndertakenForTask", { taskId: TaskId })
export type AuthoredTaskWorkAbsence = typeof AuthoredTaskWorkAbsence.Type

/** The authored public result returned by one exact outer Integrator request. */
export const AuthoredOuterIntegratorResult = Schema.TaggedUnion({
  NotPrepared: { detail: IntegratorNotPreparedDetail },
  PreparedCandidate: { candidateText: IntegratorCandidateText }
})
export type AuthoredOuterIntegratorResult = typeof AuthoredOuterIntegratorResult.Type

/** Optional exact-attempt evidence about how Dalph coordinated executor work. */
export const AuthoredOrchestrationEvidence = Schema.TaggedUnion({
  AcceptedResultIntegrationResponsibilityBegan: {
    attemptId: AttemptId,
    commit: GitCommitSha,
    integrationTarget: IntegrationTarget,
    taskId: TaskId
  },
  AcceptedResultIntegrationStarted: {
    attemptId: AttemptId,
    commit: GitCommitSha,
    integrationTarget: IntegrationTarget,
    taskId: TaskId
  },
  TargetPromotionSucceeded: {
    basis: TargetPromotionTerminalBasis,
    candidateCommit: GitCommitSha,
    expectedTargetHead: GitCommitSha,
    observedTargetHead: GitCommitSha,
    observation: Schema.Literals(["CompareAndSetApplied", "ReconciledCandidateAncestor", "ReconciledCandidateCurrent"]),
    taskId: TaskId
  },
  TargetPromotionNonConvergent: {
    attemptOrdinal: TargetPromotionAttemptOrdinal,
    candidateCommit: GitCommitSha,
    lastObservation: Schema.Literals(["ExpectedHeadStillObserved", "TargetReadFailed"]),
    taskId: TaskId
  },
  TargetPromotionStale: {
    basis: TargetPromotionTerminalBasis,
    candidateCommit: GitCommitSha,
    expectedTargetHead: GitCommitSha,
    observedTargetHead: GitCommitSha,
    observation: Schema.Literals(["CompareAndSetRejected", "ReconciledCandidateNotInAncestry"]),
    taskId: TaskId
  },
  PlannedAttemptExecutorWorkReported: {
    attemptId: AttemptId,
    report: Schema.Literals([
      "ExecutorWorkExecuting",
      "ExecutorWorkSafelySuspended",
      "ExecutorWorkTerminalAccepted",
      "ExecutorWorkTerminalCompleted",
      "ExecutorWorkTerminalFailed"
    ])
  },
  PlannedAttemptExecutorCommandProjectionObserved: {
    attemptId: AttemptId,
    report: Schema.Literals([
      "ExecutorWorkExecuting",
      "ExecutorWorkSafelySuspended",
      "ExecutorWorkTerminalAccepted",
      "ExecutorWorkTerminalCompleted",
      "ExecutorWorkTerminalFailed"
    ])
  },
  PlannedAttemptExecutorWorkResponsibilityBegan: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredOrchestrationEvidence = typeof AuthoredOrchestrationEvidence.Type

const AuthoredExpectedBehaviorShape = Schema.Struct({
  orchestration: Schema.NullOr(Schema.Array(AuthoredOrchestrationEvidence)),
  protocol: Schema.NullOr(Schema.Array(AuthoredProtocolEvidence)),
  taskWork: Schema.Struct({
    absences: Schema.Array(AuthoredTaskWorkAbsence),
    results: Schema.Array(AuthoredTaskWorkResult)
  })
})

const expectedBehaviorIssue = (assertions: typeof AuthoredExpectedBehaviorShape.Type): string | undefined => {
  const absentTasks = assertions.taskWork.absences.map(({ taskId }) => taskId)
  if (new Set(absentTasks).size !== absentTasks.length) {
    return "each no-planned-work-undertaken assertion must name a task once"
  }
  if (assertions.taskWork.results.some(({ taskId }) => absentTasks.includes(taskId))) {
    return "one task cannot have a planned-work result and no planned work undertaken"
  }
  const resultTasks = assertions.taskWork.results.map(({ taskId }) => taskId)
  return assertions.orchestration === null && new Set(resultTasks).size !== resultTasks.length
    ? "multiple planned-work results for one task require orchestration evidence"
    : undefined
}

export const AuthoredExpectedBehavior = AuthoredExpectedBehaviorShape
export type AuthoredExpectedBehavior = typeof AuthoredExpectedBehavior.Type

export const AuthoredObservedBehavior = Schema.Struct({
  orchestrationEvidence: Schema.NullOr(Schema.Array(AuthoredOrchestrationEvidence)),
  plannedWorkUndertakenFor: Schema.Array(TaskId),
  protocolEvidence: Schema.NullOr(Schema.Array(AuthoredProtocolEvidence)),
  taskWorkResults: Schema.Array(AuthoredTaskWorkResult)
})
export type AuthoredObservedBehavior = typeof AuthoredObservedBehavior.Type

const RunCoordinatorFields = {
  baseSha: GitCommitSha,
  claimOwner: ClaimOwner,
  claimTokenPrefix: Schema.NonEmptyString,
  executor: TaskExecutorLocator,
  integrationTarget: IntegrationTarget,
  targetPromotionConfigured: Schema.optionalKey(Schema.Boolean),
  target: TrackerTarget,
  worktreeRoot: WorktreeLocator
}

const AuthoredPauseCoverage = Schema.TaggedUnion({
  ExactTaskPauseCoverage: {},
  GroupingDescendantPauseCoverage: { groupingObservedAt: JournalPosition, pausedTaskId: TaskId },
  RunPauseCoverage: {}
})

/** Stable cassette-local identity of one exact proposal, independent of the generated RunId. */
export const AuthoredDeliveryProposalId = Schema.NonEmptyString.pipe(Schema.brand("AuthoredDeliveryProposalId"))
export type AuthoredDeliveryProposalId = typeof AuthoredDeliveryProposalId.Type

const AuthoredTaskOrAttemptCorrelation = Schema.TaggedUnion({ Attempt: { attemptId: AttemptId }, Task: {} })

/** Exact promotion request retained in authored output without expanding its nested evidence schema at every story tag. */
export type AuthoredTargetPromotionRequest = TargetPromotionRequest
export const AuthoredTargetPromotionRequest: Schema.Codec<AuthoredTargetPromotionRequest, unknown, never, never> =
  TargetPromotionRequest

/** Every task-bearing production proposal route; the taskless graph-read route is structurally excluded. */
const AuthoredPauseProposal = Schema.TaggedUnion({
  AcceptedWorkflowRoute: { operationId: OperationId, proposalId: AuthoredDeliveryProposalId, taskId: TaskId },
  FreshExecutorWorkflowRoute: { attemptId: AttemptId, proposalId: AuthoredDeliveryProposalId, taskId: TaskId },
  FreshWorkflowRoute: {
    correlation: AuthoredTaskOrAttemptCorrelation,
    proposalId: AuthoredDeliveryProposalId,
    taskId: TaskId
  },
  IdentityFreeWorkflowRoute: {
    correlation: Schema.TaggedUnion({
      Integration: { attemptId: AttemptId, queuedAt: JournalPosition },
      PlannedAttempt: { attemptId: AttemptId },
      TargetPromotion: { attemptId: AttemptId, queuedAt: JournalPosition, request: AuthoredTargetPromotionRequest },
      Task: {}
    }),
    proposalId: AuthoredDeliveryProposalId,
    taskId: TaskId
  },
  RecoveredNewActionRoute: {
    correlation: AuthoredTaskOrAttemptCorrelation,
    proposalId: AuthoredDeliveryProposalId,
    taskId: TaskId
  }
})

const AuthoredPauseLiveOwner = Schema.TaggedUnion({
  AdmittedDeliveryAction: { proposal: AuthoredPauseProposal },
  MaterializedDeliveryAction: {
    intent: Schema.Literals(["IntentNotRecorded", "IntentRecorded"]),
    operationId: OperationId,
    proposal: AuthoredPauseProposal
  },
  SettledBeforeMaterialization: { proposal: AuthoredPauseProposal },
  SettledMaterializedDeliveryAction: {
    intent: Schema.Literals(["IntentNotRecorded", "IntentRecorded"]),
    operationId: OperationId,
    proposal: AuthoredPauseProposal
  }
})

const AuthoredPauseResponsibility = Schema.TaggedUnion({
  AcceptedAwaitingIntegration: {
    terminalAt: JournalPosition,
    attemptId: AttemptId,
    coverage: AuthoredPauseCoverage,
    taskId: TaskId
  },
  DeliveryAction: { proposal: AuthoredPauseProposal, coverage: AuthoredPauseCoverage, taskId: TaskId },
  PlannedAttemptExecutorWork: {
    attemptId: AttemptId,
    beganAt: JournalPosition,
    coverage: AuthoredPauseCoverage,
    taskId: TaskId
  },
  QueuedIntegration: {
    attemptId: AttemptId,
    coverage: AuthoredPauseCoverage,
    queuedAt: JournalPosition,
    taskId: TaskId
  },
  StartedIntegration: {
    attemptId: AttemptId,
    coverage: AuthoredPauseCoverage,
    queuedAt: JournalPosition,
    startedAt: JournalPosition,
    taskId: TaskId
  },
  WorkflowOperation: {
    beganAt: JournalPosition,
    coverage: AuthoredPauseCoverage,
    operationId: OperationId,
    responsibilityTag: Schema.Literals([
      "TaskClaimResponsibility",
      "TaskClaimReleaseResponsibility",
      "TaskWorktreeResponsibility"
    ]),
    taskId: TaskId
  }
})

const AuthoredPauseBlocker = Schema.TaggedUnion({
  AcceptedOutcomePublicationPending: { proposal: AuthoredPauseProposal },
  ActiveIntegrationTarget: { queuedAt: JournalPosition },
  ExecutorSafeSuspensionRequired: { attemptId: AttemptId },
  HeldIntegrationTarget: { queuedAt: JournalPosition },
  LiveDeliveryAction: { owner: AuthoredPauseLiveOwner },
  ProposedDeliveryAction: { proposal: AuthoredPauseProposal },
  TargetPromotionResultRequired: { request: AuthoredTargetPromotionRequest }
})

const AuthoredPauseResponsibilityAtBoundary = Schema.Union([
  AuthoredPauseResponsibility.cases.AcceptedAwaitingIntegration,
  AuthoredPauseResponsibility.cases.PlannedAttemptExecutorWork,
  AuthoredPauseResponsibility.cases.QueuedIntegration,
  AuthoredPauseResponsibility.cases.StartedIntegration,
  AuthoredPauseResponsibility.cases.WorkflowOperation
])

const AuthoredPauseDeliveryActionBlocker = Schema.Union([
  AuthoredPauseBlocker.cases.AcceptedOutcomePublicationPending,
  AuthoredPauseBlocker.cases.LiveDeliveryAction,
  AuthoredPauseBlocker.cases.ProposedDeliveryAction
])
const AuthoredPauseExecutorBlocker = Schema.Union([
  AuthoredPauseBlocker.cases.ExecutorSafeSuspensionRequired,
  AuthoredPauseDeliveryActionBlocker
])
const AuthoredPauseIntegrationResourceBlocker = Schema.Union([
  AuthoredPauseBlocker.cases.ActiveIntegrationTarget,
  AuthoredPauseBlocker.cases.HeldIntegrationTarget
])
const AuthoredPauseStartedIntegrationBlocker = Schema.Union([
  AuthoredPauseBlocker.cases.TargetPromotionResultRequired,
  AuthoredPauseIntegrationResourceBlocker,
  AuthoredPauseDeliveryActionBlocker
])

const AuthoredPauseResponsibilityPreventingBoundary = Schema.Union([
  Schema.Struct({
    blockers: Schema.NonEmptyArray(AuthoredPauseExecutorBlocker),
    responsibility: AuthoredPauseResponsibility.cases.PlannedAttemptExecutorWork
  }),
  Schema.Struct({
    blockers: Schema.NonEmptyArray(AuthoredPauseDeliveryActionBlocker),
    responsibility: Schema.Union([
      AuthoredPauseResponsibility.cases.DeliveryAction,
      AuthoredPauseResponsibility.cases.WorkflowOperation
    ])
  }),
  Schema.Struct({
    blockers: Schema.NonEmptyArray(
      Schema.Union([AuthoredPauseIntegrationResourceBlocker, AuthoredPauseDeliveryActionBlocker])
    ),
    responsibility: AuthoredPauseResponsibility.cases.QueuedIntegration
  }),
  Schema.Struct({
    blockers: Schema.NonEmptyArray(AuthoredPauseStartedIntegrationBlocker),
    responsibility: AuthoredPauseResponsibility.cases.StartedIntegration
  })
])

type AuthoredPauseResponsibilityAtBoundary = typeof AuthoredPauseResponsibilityAtBoundary.Type
type AuthoredPauseResponsibilityPreventingBoundary = typeof AuthoredPauseResponsibilityPreventingBoundary.Type

export interface AuthoredPauseConfirmed {
  readonly _tag: "PauseConfirmed"
  readonly atBoundary: ReadonlyArray<AuthoredPauseResponsibilityAtBoundary>
}
export const AuthoredPauseConfirmed: Schema.Codec<AuthoredPauseConfirmed, unknown, never, never> = Schema.TaggedStruct(
  "PauseConfirmed",
  { atBoundary: Schema.Array(AuthoredPauseResponsibilityAtBoundary) }
)
export interface AuthoredPauseNoLongerApplied {
  readonly _tag: "PauseNoLongerApplied"
}
export const AuthoredPauseNoLongerApplied: Schema.Codec<AuthoredPauseNoLongerApplied, unknown, never, never> =
  Schema.TaggedStruct("PauseNoLongerApplied", {})
export interface AuthoredPauseNotApplied {
  readonly _tag: "PauseNotApplied"
}
export const AuthoredPauseNotApplied: Schema.Codec<AuthoredPauseNotApplied, unknown, never, never> =
  Schema.TaggedStruct("PauseNotApplied", {})
export interface AuthoredPauseWaiting {
  readonly _tag: "PauseWaiting"
  readonly atBoundary: ReadonlyArray<AuthoredPauseResponsibilityAtBoundary>
  readonly preventing: readonly [
    AuthoredPauseResponsibilityPreventingBoundary,
    ...Array<AuthoredPauseResponsibilityPreventingBoundary>
  ]
}
export const AuthoredPauseWaiting: Schema.Codec<AuthoredPauseWaiting, unknown, never, never> = Schema.TaggedStruct(
  "PauseWaiting",
  {
    atBoundary: Schema.Array(AuthoredPauseResponsibilityAtBoundary),
    preventing: Schema.NonEmptyArray(AuthoredPauseResponsibilityPreventingBoundary)
  }
)

const AuthoredPauseProgressResultShape = Schema.Union([
  AuthoredPauseConfirmed,
  AuthoredPauseNoLongerApplied,
  AuthoredPauseNotApplied,
  AuthoredPauseWaiting
])

type AuthoredPauseProgressResultShape = typeof AuthoredPauseProgressResultShape.Type
type AuthoredPauseResponsibilityShape =
  | Extract<AuthoredPauseProgressResultShape, { readonly _tag: "PauseConfirmed" }>["atBoundary"][number]
  | Extract<AuthoredPauseProgressResultShape, { readonly _tag: "PauseWaiting" }>["preventing"][number]["responsibility"]

const pauseResponsibilityKey = (responsibility: AuthoredPauseResponsibilityShape): string => {
  return Match.valueTags(responsibility, {
    AcceptedAwaitingIntegration: ({ attemptId, taskId, terminalAt }) =>
      `AcceptedAwaitingIntegration:${taskId}:${attemptId}:${terminalAt}`,
    DeliveryAction: ({ proposal }) => `DeliveryAction:${proposal.proposalId}`,
    PlannedAttemptExecutorWork: ({ attemptId, beganAt, taskId }) =>
      `PlannedAttemptExecutorWork:${taskId}:${attemptId}:${beganAt}`,
    QueuedIntegration: ({ attemptId, queuedAt, taskId }) => `QueuedIntegration:${taskId}:${attemptId}:${queuedAt}`,
    StartedIntegration: ({ attemptId, queuedAt, startedAt, taskId }) =>
      `StartedIntegration:${taskId}:${attemptId}:${queuedAt}:${startedAt}`,
    WorkflowOperation: ({ beganAt, operationId, responsibilityTag, taskId }) =>
      `WorkflowOperation:${responsibilityTag}:${taskId}:${operationId}:${beganAt}`
  })
}

type AuthoredPausePreventing = Extract<
  AuthoredPauseProgressResultShape,
  { readonly _tag: "PauseWaiting" }
>["preventing"][number]
type AuthoredPauseBlockerShape = AuthoredPausePreventing["blockers"][number]
type AuthoredPauseProposalShape = Extract<
  AuthoredPauseBlockerShape,
  { readonly _tag: "ProposedDeliveryAction" }
>["proposal"]

const authoredBlockerProposal = (blocker: AuthoredPauseBlockerShape): AuthoredPauseProposalShape | undefined =>
  Match.valueTags(blocker, {
    AcceptedOutcomePublicationPending: ({ proposal }) => proposal,
    ActiveIntegrationTarget: () => undefined,
    ExecutorSafeSuspensionRequired: () => undefined,
    HeldIntegrationTarget: () => undefined,
    LiveDeliveryAction: ({ owner }) => owner.proposal,
    ProposedDeliveryAction: ({ proposal }) => proposal,
    TargetPromotionResultRequired: () => undefined
  })

const proposalIdentityIssue = (
  proposals: ReadonlyArray<AuthoredPauseProposalShape>,
  detail: string
): string | undefined =>
  proposals.some((proposal) =>
    proposals.some(
      (candidate) =>
        candidate.proposalId === proposal.proposalId && JSON.stringify(candidate) !== JSON.stringify(proposal)
    )
  )
    ? detail
    : undefined

const responsibilityIdentityIssue = (responsibility: AuthoredPauseResponsibilityShape): string | undefined => {
  const coverage = responsibility.coverage
  if (coverage._tag === "GroupingDescendantPauseCoverage" && coverage.pausedTaskId === responsibility.taskId) {
    return "grouping descendant coverage cannot identify the paused task as its own descendant"
  }
  return responsibility._tag === "DeliveryAction" && responsibility.proposal.taskId !== responsibility.taskId
    ? "a delivery responsibility must carry the same exact proposal task identity"
    : undefined
}

const integrationActionIssue = (
  proposal: AuthoredPauseProposalShape,
  responsibility: Extract<
    AuthoredPauseResponsibilityShape,
    { readonly _tag: "QueuedIntegration" | "StartedIntegration" }
  >
): string | undefined =>
  proposal._tag !== "IdentityFreeWorkflowRoute" ||
  (proposal.correlation._tag !== "Integration" && proposal.correlation._tag !== "TargetPromotion") ||
  proposal.correlation.attemptId !== responsibility.attemptId ||
  proposal.correlation.queuedAt !== responsibility.queuedAt ||
  proposal.taskId !== responsibility.taskId
    ? "promotion action blocker identity must equal its integration responsibility"
    : undefined

const executorActionMatches = (proposal: AuthoredPauseProposalShape, attemptId: string, taskId: string): boolean =>
  proposal.taskId === taskId &&
  Match.valueTags(proposal, {
    AcceptedWorkflowRoute: () => false,
    FreshExecutorWorkflowRoute: ({ attemptId: candidate }) => candidate === attemptId,
    FreshWorkflowRoute: ({ correlation }) => correlation._tag === "Attempt" && correlation.attemptId === attemptId,
    IdentityFreeWorkflowRoute: ({ correlation }) =>
      correlation._tag === "PlannedAttempt" && correlation.attemptId === attemptId,
    RecoveredNewActionRoute: ({ correlation }) => correlation._tag === "Attempt" && correlation.attemptId === attemptId
  })

const actionBlockerIssue = (
  proposal: AuthoredPauseProposalShape,
  responsibility: AuthoredPauseResponsibilityShape
): string | undefined =>
  Match.valueTags(responsibility, {
    AcceptedAwaitingIntegration: () => "accepted integration cannot carry an action blocker",
    DeliveryAction: ({ proposal: expected }) =>
      JSON.stringify(proposal) === JSON.stringify(expected)
        ? undefined
        : "delivery-action blocker identity must equal its delivery responsibility",
    PlannedAttemptExecutorWork: ({ attemptId, taskId }) =>
      executorActionMatches(proposal, attemptId, taskId)
        ? undefined
        : "executor action blocker identity must equal its planned executor responsibility",
    QueuedIntegration: (integration) => integrationActionIssue(proposal, integration),
    StartedIntegration: (integration) => integrationActionIssue(proposal, integration),
    WorkflowOperation: ({ operationId, taskId }) =>
      proposal._tag === "AcceptedWorkflowRoute" && proposal.operationId === operationId && proposal.taskId === taskId
        ? undefined
        : "workflow action blocker identity must equal its exact workflow responsibility"
  })

const promotionResultIssue = (
  request: AuthoredTargetPromotionRequest,
  blockers: ReadonlyArray<AuthoredPauseBlockerShape>,
  responsibility: AuthoredPauseResponsibilityShape
): string | undefined => {
  const exactPromotionActionExists = blockers.some((candidate) => {
    const proposal = authoredBlockerProposal(candidate)
    return (
      proposal?._tag === "IdentityFreeWorkflowRoute" &&
      proposal.correlation._tag === "TargetPromotion" &&
      JSON.stringify(proposal.correlation.request) === JSON.stringify(request)
    )
  })
  return (responsibility._tag !== "QueuedIntegration" && responsibility._tag !== "StartedIntegration") ||
    request.qualifiedCandidate.run.session.plannedAttempt.attemptId !== responsibility.attemptId ||
    !exactPromotionActionExists
    ? "promotion-result blocker must equal its exact integration responsibility and promotion action"
    : undefined
}

const blockerCorrelationIssue = (
  blocker: AuthoredPauseBlockerShape,
  blockers: ReadonlyArray<AuthoredPauseBlockerShape>,
  responsibility: AuthoredPauseResponsibilityShape
): string | undefined =>
  Match.valueTags(blocker, {
    AcceptedOutcomePublicationPending: ({ proposal }) => actionBlockerIssue(proposal, responsibility),
    ActiveIntegrationTarget: ({ queuedAt }) =>
      (responsibility._tag === "QueuedIntegration" || responsibility._tag === "StartedIntegration") &&
      queuedAt === responsibility.queuedAt
        ? undefined
        : "integration-target blocker position must equal its integration responsibility",
    ExecutorSafeSuspensionRequired: ({ attemptId }) =>
      responsibility._tag === "PlannedAttemptExecutorWork" && attemptId === responsibility.attemptId
        ? undefined
        : "safe-suspension blocker identity must equal its planned executor responsibility",
    HeldIntegrationTarget: ({ queuedAt }) =>
      (responsibility._tag === "QueuedIntegration" || responsibility._tag === "StartedIntegration") &&
      queuedAt === responsibility.queuedAt
        ? undefined
        : "integration-target blocker position must equal its integration responsibility",
    LiveDeliveryAction: ({ owner }) => actionBlockerIssue(owner.proposal, responsibility),
    ProposedDeliveryAction: ({ proposal }) => actionBlockerIssue(proposal, responsibility),
    TargetPromotionResultRequired: ({ request }) => promotionResultIssue(request, blockers, responsibility)
  })

const preventingIdentityIssue = ({ blockers, responsibility }: AuthoredPausePreventing): string | undefined => {
  if (new Set(blockers.map((blocker) => JSON.stringify(blocker))).size !== blockers.length) {
    return "one exact Pause blocker cannot be duplicated for a responsibility"
  }
  return blockers.map((blocker) => blockerCorrelationIssue(blocker, blockers, responsibility)).find(Boolean)
}

const pauseProgressIsExactlyCorrelated = Schema.makeFilter((result: AuthoredPauseProgressResultShape) => {
  if (result._tag === "PauseNoLongerApplied" || result._tag === "PauseNotApplied") return undefined
  const responsibilities = [
    ...result.atBoundary,
    ...(result._tag === "PauseWaiting" ? result.preventing.map(({ responsibility }) => responsibility) : [])
  ]
  if (new Set(responsibilities.map(pauseResponsibilityKey)).size !== responsibilities.length) {
    return "one exact Pause responsibility cannot be duplicated or listed at and before the boundary"
  }
  const responsibilityIssue = responsibilities.map(responsibilityIdentityIssue).find(Boolean)
  if (responsibilityIssue !== undefined) return responsibilityIssue
  const responsibilityProposals = responsibilities.flatMap((responsibility) =>
    responsibility._tag === "DeliveryAction" ? [responsibility.proposal] : []
  )
  if (result._tag !== "PauseWaiting") {
    return proposalIdentityIssue(
      responsibilityProposals,
      "one authored proposal identity cannot describe different exact proposal routes"
    )
  }
  const blockerProposals = result.preventing.flatMap(({ blockers }) =>
    blockers.flatMap((blocker) => {
      const proposal = authoredBlockerProposal(blocker)
      return proposal === undefined ? [] : [proposal]
    })
  )
  return (
    proposalIdentityIssue(
      [...responsibilityProposals, ...blockerProposals],
      "one authored proposal identity cannot describe different responsibility or blocker routes"
    ) ?? result.preventing.map(preventingIdentityIssue).find(Boolean)
  )
})

const AuthoredPauseProgressResult = Schema.suspend(
  (): Schema.Codec<AuthoredPauseProgressResultShape, unknown, never, never> =>
    AuthoredPauseProgressResultShape.check(pauseProgressIsExactlyCorrelated)
)
export type AuthoredPauseProgressResult = typeof AuthoredPauseProgressResult.Type
export const decodeAuthoredPauseProgressResult: (input: unknown) => AuthoredPauseProgressResult =
  Schema.decodeUnknownSync(AuthoredPauseProgressResult)
const AuthoredPauseSubject = Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })

const AuthoredPauseObservationFields = { result: AuthoredPauseProgressResult, subject: AuthoredPauseSubject }
const AuthoredPauseObservationStartFields = { subject: AuthoredPauseSubject }
const AuthoredPauseObservationReconnectFields = {
  reconnectResult: AuthoredPauseProgressResult,
  reconnectSubject: AuthoredPauseSubject,
  result: AuthoredPauseProgressResult,
  subject: AuthoredPauseSubject
}

/**
 * One chronological authored story. Schema version 1 is provisional until the
 * project owner explicitly removes this comment; adding tags does not imply a
 * released compatibility promise.
 */
const AuthoredCassetteStoryItemSchema = Schema.TaggedUnion({
  /** Harness lifecycle: one bounded coordinator activation returns this exact public finality decision. */
  CoordinatorActivationReturned: {
    decision: Schema.TaggedUnion({
      RunMayTerminate: {},
      RunMustRemainActive: {
        reason: Schema.Literals(["RunnableTransition", "TrackerTargetUnsettled", "UnsettledResponsibility"])
      },
      /**
       * The activation must remain active, while this scenario deliberately
       * leaves the production diagnostic reason outside its acceptance claim.
       */
      RunMustRemainActiveReasonUnasserted: {}
    })
  },
  /** Harness lifecycle: dispose one coordinator and its same-process executor session without journaling an occurrence. */
  CoordinatorProcessDies: {},
  /** The tracker applied deletion of the exact promotion-correlated completion claim. */
  CompletionClaimDeletionApplied: { taskId: TaskId },
  /** The tracker reports one exact active-record or completion-marker state for finality reconciliation. */
  CompletionClaimReadReturned: {
    claim: Schema.Literals(["Active", "CompletionMarker", "CompletionMarkerAbsent", "Unclaimed"]),
    taskId: TaskId
  },
  /** Another tracker client reopened the prerequisite before exact request Q was acknowledged. */
  CompletionTaskPrerequisiteReopened: { graph: AuthoredTrackerGraph },
  /** The tracker applied replacement of the active claim with the exact completion claim. */
  CompletionClaimReplacementApplied: { taskId: TaskId },
  /** One all-or-nothing task-local lifecycle, prerequisite, membership, revision, and claim read. */
  CompletionTaskFocusedReadReturned: {
    lifecycle: Schema.Literals(["Open", "CompletedSuccessfully", "TerminalWithoutSuccess"]),
    taskId: TaskId,
    unfinishedPrerequisiteTaskIds: Schema.Array(TaskId)
  },
  /** The tracker returned or lost the direct response to exact request Q. */
  CompletionTaskRequestReturned: {
    outcome: Schema.Literals(["Acknowledged", "DefinitelyRejected", "ResponseLost"]),
    taskId: TaskId
  },
  /** The tracker classified exact request Q after an ambiguous response. */
  CompletionTaskRequestLookupReturned: {
    outcome: Schema.Literals(["Applied", "NotApplied", "Unreadable"]),
    taskId: TaskId
  },
  /** Harness synchronization: hold this exact admitted continuation before its durable executor command intent. */
  DalphHoldsAdmittedContinuationBeforeExecutorIntent: { attemptId: AttemptId, taskId: TaskId },
  /** Harness synchronization: hold this exact already-running continuation before calling the executor boundary. */
  CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary: { attemptId: AttemptId, taskId: TaskId },
  /** Harness synchronization: release the exact already-running continuation named by its paired hold. */
  CassetteReleasesHeldPlannedAttemptContinuation: { attemptId: AttemptId, taskId: TaskId },
  /** Harness synchronization: hold this exact admitted Suspend before calling the execution substrate. */
  CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary: { attemptId: AttemptId, taskId: TaskId },
  /** Harness synchronization: release the exact admitted Suspend named by its paired hold. */
  CassetteReleasesHeldPlannedAttemptSuspension: { attemptId: AttemptId, taskId: TaskId },
  /** Harness synchronization: hold the exact post-loss Git reconciliation read before it consumes an observation. */
  CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary: { request: TargetPromotionRequest },
  /** Harness lifecycle: kill the coordinator when this exact post-loss Git reconciliation request reaches its read boundary. */
  CassetteKillsCoordinatorAtTargetPromotionReconciliationRead: { request: TargetPromotionRequest },
  /** Harness synchronization: release the exact post-loss Git reconciliation read named by its paired hold. */
  CassetteReleasesHeldTargetPromotionReconciliationRead: { request: TargetPromotionRequest },
  /** Harness synchronization: hold this task's exact specification read while another real preparation path advances. */
  CassetteHoldsTaskWorkSpecificationReadBeforeBoundary: { taskId: TaskId },
  /** Harness synchronization: release the exact task specification read named by its paired hold. */
  CassetteReleasesHeldTaskWorkSpecificationRead: { taskId: TaskId },
  /**
   * Harness synchronization: pre-arm one exact planned-attempt worktree
   * reconciliation selection before its real boundary is selected. The
   * exact promotion request identifies the later successful target-promotion
   * compare-and-set that releases this hold.
   */
  CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion: {
    attemptId: AttemptId,
    promotionRequest: TargetPromotionGitRequest,
    taskId: TaskId
  },
  /** Harness synchronization: release the exact worktree-selection hold after its Applied promotion CAS. */
  CassetteReleasesHeldTaskWorktreeSelection: {
    attemptId: AttemptId,
    promotionRequest: TargetPromotionGitRequest,
    taskId: TaskId
  },
  /**
   * Harness synchronization: park the promoted task's first completion-claim
   * read until another exact attempt has crossed its Begin response.
   */
  CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins: {
    promotedAttemptId: AttemptId,
    promotedTaskId: TaskId,
    releasedByAttemptId: AttemptId,
    releasedByTaskId: TaskId
  },
  /** Harness synchronization: release the paired completion-claim read after the exact Begin response. */
  CassetteReleasesHeldPromotedTaskCompletionClaimRead: {
    promotedAttemptId: AttemptId,
    promotedTaskId: TaskId,
    releasedByAttemptId: AttemptId,
    releasedByTaskId: TaskId
  },
  /**
   * Harness synchronization: arm one exact set of fresh task claims and keep
   * matching TaskSelectionAuthority operations parked until terminal
   * assertions interrupt the controlled activation.
   */
  CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions: {
    taskIds: Schema.NonEmptyArray(TaskId).check(Schema.isUnique())
  },
  /** Harness input: offer these non-authoritative hints to the real Run reactivation owner. */
  CassetteOffersRunReactivationHints: {
    hints: Schema.NonEmptyArray(Schema.Literals(["TrackerNotification", "Timer"]))
  },
  /** Harness input: publish one current tracker notification while the real Run reactivation owner attaches. */
  CassettePublishesCurrentTrackerNotification: {},
  /** Harness synchronization: keep this exact executor request in flight while the next ordinary delivery fact publishes. */
  DalphHoldsExecutorRequestThroughNextDeliveryPublication: {
    attemptId: AttemptId,
    request: Schema.Literals(["Begin", "Resume", "Suspend"]),
    taskId: TaskId
  },
  /** One bounded tracker-read phase whose causally named members may complete in either order. */
  ConcurrentTrackerReadBatch: { members: Schema.NonEmptyArray(AuthoredConcurrentTrackerRead) },
  DalphSelects: {
    causal: Schema.optionalKey(AuthoredCausalSelection),
    causalAnchor: Schema.optionalKey(AuthoredCausalAnchor),
    operation: AuthoredCassetteDecision
  },
  /** Task-work assertions with optional complete lower-level evidence projections. */
  ExpectedBehavior: AuthoredExpectedBehavior.fields,
  GitWorktreeObservationChanged: {
    observation: Schema.Union([PlannedBranchReady, PlannedWorktreeAbsent, PlannedWorktreeReady])
  },
  /** Git applies the planned-worktree create, but Dalph loses the response before the ordinary reread. */
  GitPlannedWorktreeCreateResponseLost: { detail: Schema.String },
  /** The fake outer Integrator receives this exact session/responsibility correlation. */
  IntegratorRequestReceived: { correlation: IntegratorSessionCorrelation },
  /** The fake outer Integrator returns only its public prepared/not-prepared result. */
  IntegratorResultReturned: { result: AuthoredOuterIntegratorResult },
  /** Git returns object-kind and ordered-parent facts for the explicitly reported candidate text. */
  IntegratorGitObservationReturned: { candidateText: IntegratorCandidateText, observation: IntegratorGitObservation },
  /** Git cannot read the explicitly reported candidate text. */
  IntegratorGitObservationFailed: { candidateText: IntegratorCandidateText, detail: Schema.String },
  /** Git's exact H -> M compare-and-set result, or its lost response. */
  TargetPromotionCompareAndSetReturned: {
    request: TargetPromotionGitRequest,
    result: Schema.TaggedUnion({ Applied: {}, RejectedExpectedHead: { observedHeadSha: GitCommitSha } })
  },
  TargetPromotionCompareAndSetResponseLost: { detail: Schema.String, request: TargetPromotionGitRequest },
  /** Git's complete candidate-ancestry reconciliation result, or an unreadable read. */
  TargetPromotionGitReadReturned: {
    candidateCommit: GitCommitSha,
    observation: Schema.TaggedUnion({
      CandidateAncestor: { currentHeadSha: GitCommitSha },
      CandidateCurrent: { currentHeadSha: GitCommitSha },
      CandidateNotInAncestry: { currentHeadSha: GitCommitSha }
    }),
    repository: GitRepositoryLocator
  },
  TargetPromotionGitReadFailed: {
    candidateCommit: GitCommitSha,
    detail: Schema.String,
    repository: GitRepositoryLocator
  },
  InitialControlPolicy: { policy: InitialControlPolicy },
  PlannedAttemptExecutorWorkReported: {
    report: AuthoredPlannedAttemptExecutorReport,
    request: Schema.Literals(["Begin", "Resume", "Suspend"])
  },
  /** A read-only executor projection returns this exact current authority state. */
  PlannedAttemptExecutorProjectionReturned: { report: AuthoredPlannedAttemptExecutorReport },
  /**
   * An already-attached passive owner observes this exact attempt change.
   * Unlike a requested projection, only the matching lifecycle subscription may consume it.
   */
  PlannedAttemptExecutorPassiveLifecycleChanged: {
    report: Schema.Union([
      AuthoredPlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended,
      AuthoredPlannedAttemptExecutorReport.cases.ExecutorWorkTerminal
    ])
  },
  /** Executor applied the request and changed its authority state, but Dalph lost the response before journaling it. */
  PlannedAttemptExecutorResponseLost: {
    detail: Schema.String,
    report: AuthoredPlannedAttemptExecutorReport,
    request: Schema.Literals(["Begin", "Resume", "Suspend"])
  },
  OperatorAppliesControlDirection: {
    direction: ControlDirection,
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
  },
  /** Harness synchronization: apply this direction before any currently-runnable delivery action is admitted. */
  OperatorAppliesControlDirectionBeforeDeliveryActionAdmission: {
    direction: ControlDirection,
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
  },
  /** Alice starts one process-local subscription; this is not a workflow occurrence or journal event. */
  OperatorStartsPauseObservation: AuthoredPauseObservationStartFields,
  /** Alice subscribes now without awaiting a value so an exact held boundary may publish afterward. */
  OperatorSubscribesToPauseObservation: { subject: AuthoredPauseSubject },
  /** Alice arms the existing subscription before the following ordinary boundary publishes its result. */
  OperatorAwaitsPauseProgress: AuthoredPauseObservationFields,
  /** The public observation stream produces this visible result without persisting a projection. */
  PauseProgressObserved: AuthoredPauseObservationFields,
  /** Alice receives this result and ends only the same process-local subscription atomically in the story. */
  /** Alice cancels this subscription, then starts a new one only after the next ordinary delivery publication. */
  PauseProgressObservedCancelledAndReconnected: AuthoredPauseObservationReconnectFields,
  /** Harness timing: the Operator applies this direction after the executor request crossed its boundary. */
  OperatorAppliesControlDirectionWhileExecutorRequestInFlight: {
    direction: ControlDirection,
    duringAttemptId: AttemptId,
    outcome: Schema.TaggedUnion({
      Applied: {},
      AppliedAndPauseObservationEnds: { result: AuthoredPauseProgressResult },
      Rejected: { reason: Schema.Literals(["IncompleteSnapshot", "OutsideCurrentTargetClosure"]) }
    }),
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
  },
  /** Harness timing: Alice applies whole-Run cancellation after the exact executor command intent crossed its boundary. */
  OperatorAppliesRunCancellationWhileExecutorRequestInFlight: { duringAttemptId: AttemptId },
  /** Alice withdraws Pause during this exact request after observing one already-queued Waiting view. */
  OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting: {
    duringAttemptId: AttemptId,
    queued: Schema.NonEmptyArray(AuthoredPauseWaiting),
    subject: AuthoredPauseSubject
  },
  /** The visible non-durable result returned after an authored Operator control request fails. */
  OperatorControlDirectionFailed: {
    direction: ControlDirection,
    reason: Schema.Literals(["IncompleteSnapshot", "OutsideCurrentTargetClosure"]),
    subject: Schema.TaggedUnion({ Task: { taskId: TaskId } })
  },
  /** Alice applies Continue for one immutable attempt and observes the typed public result. */
  OperatorContinuesAttempt: {
    attemptId: AttemptId,
    expected: AuthoredContinueAttemptResult,
    observedTaskRevision: TaskRevision,
    requestNonce: Schema.NonEmptyString,
    taskId: TaskId
  },
  OperatorDirectsTaskClaimReacquisition: { requestId: TaskClaimReacquisitionRequestId, taskId: TaskId },
  /** Alice submits both valid directions concurrently; exactly one journaled application wins. */
  OperatorRacesContinueAndStop: {
    attemptId: AttemptId,
    continueRequestNonce: Schema.NonEmptyString,
    observedTaskRevision: TaskRevision,
    stopRequestNonce: Schema.NonEmptyString,
    taskId: TaskId
  },
  /** Alice applies Restart for one immutable changed attempt and observes the typed public result. */
  OperatorRestartsAttempt: {
    attemptId: AttemptId,
    expected: AuthoredRestartAttemptResult,
    observedTaskRevision: TaskRevision,
    requestNonce: Schema.NonEmptyString,
    taskId: TaskId
  },
  /** Alice applies whole-Run cancellation through the durable Run control boundary. */
  OperatorAppliesRunCancellation: {},
  /** Alice applies Stop for one immutable attempt and observes its current durable phase. */
  OperatorStopsAttempt: {
    attemptId: AttemptId,
    expected: AuthoredStopAttemptResult,
    observedTaskRevision: TaskRevision,
    requestNonce: Schema.NonEmptyString,
    taskId: TaskId
  },
  RunCoordinator: RunCoordinatorFields,
  /** The task tracker returns this activation's one post-quiescence complete target-closure read. */
  RunActivationFinalTrackerGraphReadReturned: { graph: AuthoredTrackerGraph },
  SetTaskExecutionCapacity: { capacity: TaskWorkCapacity },
  TaskWorkSpecificationReadReturned: AuthoredTaskWorkSpecification.fields,
  /** The controlled tracker rejects this exact fresh acquisition with a current foreign claim. */
  TaskClaimAcquisitionConflictReturned: { observed: ActiveTaskClaim, operationId: OperationId },
  /** The journaled acquisition boundary exposes the tracker conflict as its terminal outcome. */
  TaskClaimAcquisitionRejected: { observed: ActiveTaskClaim, operationId: OperationId },
  TaskClaimReadFailed: { reason: Schema.Literal("Unreadable"), taskId: TaskId },
  TaskClaimCurrentReadReturned: { taskId: TaskId },
  TaskClaimReadReturned: { observation: TaskClaimObservation },
  /** Tracker applied the exact release, but Dalph lost the mutation response before journaling its outcome. */
  TaskClaimReleaseResponseLost: { detail: Schema.String, taskId: TaskId },
  TrackerGraphReadFailed: { reason: Schema.Literal("IncompleteSnapshot") },
  TrackerGraphReadReturned: { graph: AuthoredTrackerGraph }
})
export const AuthoredCassetteStoryItem: typeof AuthoredCassetteStoryItemSchema = AuthoredCassetteStoryItemSchema
export type AuthoredCassetteStoryItem = typeof AuthoredCassetteStoryItem.Type

export const AuthoredTrackerGraphReadResult = Schema.Union([
  AuthoredCassetteStoryItem.cases.TrackerGraphReadFailed,
  AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned,
  AuthoredCassetteStoryItem.cases.RunActivationFinalTrackerGraphReadReturned
])
export type AuthoredTrackerGraphReadResult = typeof AuthoredTrackerGraphReadResult.Type

const defineStoryItemOwners = <
  const Registrations extends Readonly<Record<string, ReadonlyArray<AuthoredCassetteStoryItem["_tag"]>>>
>(
  registrations: AuthoredCassetteStoryItem["_tag"] extends Registrations[keyof Registrations][number]
    ? Registrations
    : never
): Registrations => registrations

export const authoredCassetteStoryItemOwners = defineStoryItemOwners({
  CassetteControl: [
    "CassetteOffersRunReactivationHints",
    "CassettePublishesCurrentTrackerNotification",
    "InitialControlPolicy",
    "OperatorAppliesControlDirection",
    "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission",
    "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
    "OperatorAppliesRunCancellationWhileExecutorRequestInFlight",
    "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting",
    "OperatorStartsPauseObservation",
    "OperatorSubscribesToPauseObservation",
    "OperatorAwaitsPauseProgress",
    "OperatorControlDirectionFailed",
    "OperatorContinuesAttempt",
    "OperatorDirectsTaskClaimReacquisition",
    "OperatorRacesContinueAndStop",
    "OperatorRestartsAttempt",
    "OperatorAppliesRunCancellation",
    "OperatorStopsAttempt",
    "RunCoordinator",
    "SetTaskExecutionCapacity"
  ],
  CassetteLifecycle: ["CoordinatorActivationReturned", "CoordinatorProcessDies"],
  CassetteObservation: ["PauseProgressObserved", "PauseProgressObservedCancelledAndReconnected"],
  DeliverySynchronization: [
    "DalphHoldsAdmittedContinuationBeforeExecutorIntent",
    "CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary",
    "CassetteReleasesHeldPlannedAttemptContinuation",
    "DalphHoldsExecutorRequestThroughNextDeliveryPublication",
    "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary",
    "CassetteReleasesHeldPlannedAttemptSuspension",
    "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary",
    "CassetteKillsCoordinatorAtTargetPromotionReconciliationRead",
    "CassetteReleasesHeldTargetPromotionReconciliationRead",
    "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary",
    "CassetteReleasesHeldTaskWorkSpecificationRead",
    "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion",
    "CassetteReleasesHeldTaskWorktreeSelection",
    "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins",
    "CassetteReleasesHeldPromotedTaskCompletionClaimRead",
    "CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions"
  ],
  DalphOperationTrace: ["DalphSelects", "ConcurrentTrackerReadBatch"],
  Git: ["GitPlannedWorktreeCreateResponseLost", "GitWorktreeObservationChanged"],
  OuterIntegrator: [
    "IntegratorRequestReceived",
    "IntegratorResultReturned",
    "IntegratorGitObservationReturned",
    "IntegratorGitObservationFailed"
  ],
  TargetPromotion: [
    "TargetPromotionCompareAndSetReturned",
    "TargetPromotionCompareAndSetResponseLost",
    "TargetPromotionGitReadReturned",
    "TargetPromotionGitReadFailed"
  ],
  PlannedAttemptExecutor: [
    "PlannedAttemptExecutorPassiveLifecycleChanged",
    "PlannedAttemptExecutorProjectionReturned",
    "PlannedAttemptExecutorResponseLost",
    "PlannedAttemptExecutorWorkReported"
  ],
  TaskTracker: [
    "CompletionClaimDeletionApplied",
    "CompletionClaimReadReturned",
    "CompletionClaimReplacementApplied",
    "CompletionTaskPrerequisiteReopened",
    "CompletionTaskFocusedReadReturned",
    "CompletionTaskRequestLookupReturned",
    "CompletionTaskRequestReturned",
    "TaskClaimReadFailed",
    "TaskClaimCurrentReadReturned",
    "TaskClaimReadReturned",
    "TaskClaimAcquisitionConflictReturned",
    "TaskClaimAcquisitionRejected",
    "TaskClaimReleaseResponseLost",
    "TaskWorkSpecificationReadReturned",
    "TrackerGraphReadFailed",
    "TrackerGraphReadReturned",
    "RunActivationFinalTrackerGraphReadReturned"
  ],
  TerminalAssertion: ["ExpectedBehavior"]
})

export class AuthoredCassetteStoryItemOwnerContradiction extends Schema.TaggedError<AuthoredCassetteStoryItemOwnerContradiction>()(
  "AuthoredCassetteStoryItemOwnerContradiction",
  { registrations: Schema.Array(Schema.String), tag: Schema.String }
) {}

const registrationsFor = (
  tag: string,
  registrations: Readonly<Record<string, ReadonlyArray<string>>>
): ReadonlyArray<string> =>
  Object.entries(registrations).flatMap(([owner, tags]) => (tags.includes(tag) ? [owner] : []))

/** Fails before execution unless one and only one surface owns the decoded tag. */
export const assertExactlyOneAuthoredCassetteStoryItemOwner = Effect.fn(
  "AuthoredCassette.assertExactlyOneStoryItemOwner"
)(function* (
  tag: string,
  registrations: Readonly<Record<string, ReadonlyArray<string>>> = authoredCassetteStoryItemOwners
) {
  const owners = registrationsFor(tag, registrations)
  if (owners.length !== 1) {
    return yield* new AuthoredCassetteStoryItemOwnerContradiction({ registrations: owners, tag })
  }
  return owners[0]
})

const authoredScenarioCassetteVersion = 1 as const
const AuthoredScenarioCassetteShape = Schema.TaggedStruct("AuthoredScenarioCassette", {
  name: Schema.NonEmptyString,
  schemaVersion: Schema.Literal(authoredScenarioCassetteVersion),
  startingFacts: Schema.Struct({
    executorWork: Schema.Literal("NoPriorReport"),
    journal: Schema.Literal("Empty"),
    taskClaims: Schema.Array(ActiveTaskClaim),
    taskWorkSpecifications: Schema.Array(AuthoredTaskWorkSpecification),
    targetLineageObservation: Schema.optionalKey(TargetLineageObservation),
    /** Ordered Git target-lineage facts returned by successive production reads. */
    targetLineageObservations: Schema.optionalKey(Schema.Array(TargetLineageObservation)),
    trackerGraph: AuthoredTrackerGraph,
    worktreeObservation: Schema.Union([PlannedBranchReady, PlannedWorktreeAbsent, PlannedWorktreeReady])
  }),
  story: Schema.Array(AuthoredCassetteStoryItem)
})

const exactlyOneAt = (
  tag: AuthoredCassetteStoryItem["_tag"],
  expectedIndex: (length: number) => number,
  detail: string
) =>
  Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) => {
    const indexes = cassette.story.flatMap((item, index) => (item._tag === tag ? [index] : []))
    return indexes.length === 1 && indexes[0] === expectedIndex(cassette.story.length) ? undefined : detail
  })

const startingFactsAreConsistent = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) => {
  const graphReturn = cassette.story.find((item) => item._tag === "TrackerGraphReadReturned")
  const specificationReturns = cassette.story.filter(
    (item): item is Extract<AuthoredCassetteStoryItem, { readonly _tag: "TaskWorkSpecificationReadReturned" }> =>
      item._tag === "TaskWorkSpecificationReadReturned"
  )
  const uniqueStartingSpecifications =
    new Set(cassette.startingFacts.taskWorkSpecifications.map(({ taskId }) => taskId)).size ===
    cassette.startingFacts.taskWorkSpecifications.length
  const uniqueClaims =
    new Set(cassette.startingFacts.taskClaims.map(({ taskId }) => taskId)).size ===
    cassette.startingFacts.taskClaims.length
  const specificationsMatch = specificationReturns
    .filter((item, index, items) => items.findIndex((candidate) => candidate.taskId === item.taskId) === index)
    .every((item) =>
      cassette.startingFacts.taskWorkSpecifications.some(
        (starting) =>
          JSON.stringify(starting) === JSON.stringify({ body: item.body, taskId: item.taskId, title: item.title })
      )
    )
  return graphReturn?._tag === "TrackerGraphReadReturned" &&
    JSON.stringify(graphReturn.graph) === JSON.stringify(cassette.startingFacts.trackerGraph) &&
    uniqueStartingSpecifications &&
    uniqueClaims &&
    specificationsMatch
    ? undefined
    : "authored starting facts must agree with their first boundary returns and name claims/specifications once"
})

const behaviorAssertionsAreConsistent = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  cassette.story
    .flatMap((item) => (item._tag === "ExpectedBehavior" ? [expectedBehaviorIssue(item)] : []))
    .find((issue) => issue !== undefined)
)

const causalAnchorsAndChecksAreDistinct = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  cassette.story.every(
    (item) => item._tag !== "DalphSelects" || item.causal === undefined || item.causalAnchor === undefined
  )
    ? undefined
    : "one authored selection cannot be both an accepted causal anchor and an exact causal check"
)

const minimumItemsAfterCoordinatorDeath = 2
const coordinatorLifecycleBoundariesHaveFollowingActivationWork = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) =>
    cassette.story.every(
      (item, index) =>
        item._tag !== "CoordinatorProcessDies" || index < cassette.story.length - minimumItemsAfterCoordinatorDeath
    )
      ? undefined
      : "each authored coordinator process death must leave a later activation interaction before terminal assertions"
)

const finalTrackerReadClosesCurrentActivation = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) =>
    cassette.story.every((item, index) => {
      if (item._tag !== "RunActivationFinalTrackerGraphReadReturned") return true
      const selection = cassette.story[index - 1]
      return (
        selection?._tag === "DalphSelects" &&
        selection.operation._tag === "ReadTrackerGraph" &&
        cassette.story[index + 1]?._tag === "CoordinatorActivationReturned"
      )
    })
      ? undefined
      : "each authored activation-final tracker result must close a selected graph read and be followed by that activation's public return"
)

const ambiguousBoundaryLossesImmediatelyCrash = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) =>
    cassette.story.every(
      (item, index) =>
        (item._tag !== "PlannedAttemptExecutorResponseLost" && item._tag !== "TaskClaimReleaseResponseLost") ||
        cassette.story[index + 1]?._tag === "CoordinatorProcessDies"
    )
      ? undefined
      : "an authored executor or claim-release response loss must be followed immediately by coordinator process death"
)

const beginResponsesAreExecuting = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  cassette.story.every(
    (item) =>
      (item._tag !== "PlannedAttemptExecutorResponseLost" && item._tag !== "PlannedAttemptExecutorWorkReported") ||
      item.request !== "Begin" ||
      item.report._tag === "ExecutorWorkExecuting"
  )
    ? undefined
    : "an authored Begin response must report ExecutorWorkExecuting"
)

const afterProcessDeathOffset = 2

const lostExecutorResponsesRequireExplicitProjection = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) =>
    cassette.story.every((item, index) => {
      if (item._tag !== "PlannedAttemptExecutorResponseLost") return true
      const projection = cassette.story
        .slice(index + afterProcessDeathOffset)
        .find(
          (candidate) =>
            candidate._tag === "PlannedAttemptExecutorProjectionReturned" ||
            candidate._tag === "PlannedAttemptExecutorResponseLost" ||
            candidate._tag === "PlannedAttemptExecutorWorkReported"
        )
      return (
        projection?._tag === "PlannedAttemptExecutorProjectionReturned" &&
        projection.report.attemptId === item.report.attemptId
      )
    })
      ? undefined
      : "an authored lost executor response must be followed after process death by an explicit exact-attempt projection"
)

type CompletionFinalityStoryItem = Extract<
  AuthoredCassetteStoryItem,
  {
    readonly _tag:
      | "CompletionClaimDeletionApplied"
      | "CompletionClaimReadReturned"
      | "CompletionClaimReplacementApplied"
  }
>

const completionFinalityStoryItemTags = new Set<AuthoredCassetteStoryItem["_tag"]>([
  "CompletionClaimDeletionApplied",
  "CompletionClaimReadReturned",
  "CompletionClaimReplacementApplied"
])

const isCompletionFinalityStoryItem = (item: AuthoredCassetteStoryItem): item is CompletionFinalityStoryItem =>
  completionFinalityStoryItemTags.has(item._tag)

const completionFinalityStoryIsComplete = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) => {
  const finalityItems = cassette.story.filter(isCompletionFinalityStoryItem)
  if (finalityItems.length === 0) return undefined
  const taskIds = Array.from(new Set(finalityItems.map(({ taskId }) => taskId)))
  const expectedSteps = [
    "Read:Active",
    "Replace",
    "Read:CompletionMarker",
    "Read:CompletionMarker",
    "Delete",
    "Read:CompletionMarkerAbsent"
  ]
  const incompleteTaskId = taskIds.find((taskId) => {
    const actualSteps = finalityItems
      .filter((item) => item.taskId === taskId)
      .map((item) =>
        item._tag === "CompletionClaimReadReturned"
          ? `Read:${item.claim}`
          : item._tag === "CompletionClaimReplacementApplied"
            ? "Replace"
            : "Delete"
      )
    return actualSteps.some((step, index) => step !== expectedSteps[index]) || actualSteps.length > expectedSteps.length
  })?.[0]
  return incompleteTaskId === undefined
    ? undefined
    : `authored completion finality for ${incompleteTaskId} must be an exact prefix of active-record presence, replacement, two completion-marker presence reads, completion-marker deletion, and completion-marker absence`
})

/** A fresh-claim selection hold is one whole-set harness control, never one control per task. */
const freshTaskClaimSelectionHoldIsUnique = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  cassette.story.filter((item) => item._tag === "CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions")
    .length <= 1
    ? undefined
    : "an authored cassette may arm at most one fresh task-claim selection hold"
)

/** Rejects a globally pre-armed hold that would capture an earlier authored claim selection. */
export const freshTaskClaimSelectionHoldPlacementIssue = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): string | undefined => {
  const holdIndex = story.findIndex(
    (item) => item._tag === "CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions"
  )
  if (holdIndex < 0) return undefined
  const hold = story[holdIndex]
  if (hold?._tag !== "CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions") return undefined
  const earlier = story
    .slice(0, holdIndex)
    .find(
      (
        item
      ): item is Extract<AuthoredCassetteStoryItem, { readonly _tag: "DalphSelects" }> & {
        readonly operation: { readonly _tag: "AcquireTaskClaim" }
      } =>
        item._tag === "DalphSelects" &&
        item.operation._tag === "AcquireTaskClaim" &&
        hold.taskIds.includes(item.operation.taskId)
    )
  return earlier !== undefined
    ? `fresh task-claim selection hold for ${earlier.operation.taskId} must precede its first matching claim selection`
    : undefined
}

const freshTaskClaimSelectionHoldPrecedesMatchingSelections = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) => freshTaskClaimSelectionHoldPlacementIssue(cassette.story)
)

const targetPromotionGitRequestMatches = (left: TargetPromotionGitRequest, right: TargetPromotionGitRequest): boolean =>
  left.candidateCommit === right.candidateCommit &&
  left.expectedTargetHead === right.expectedTargetHead &&
  left.integrationTarget.repository === right.integrationTarget.repository &&
  left.integrationTarget.ref === right.integrationTarget.ref

/** Finds authored Integrator candidates that could have produced an exact Git promotion request. */
const targetPromotionOriginsFor = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  request: TargetPromotionGitRequest,
  beforeIndex: number
) => {
  const origins = story.flatMap((item, integratorIndex) => {
    if (integratorIndex >= beforeIndex || item._tag !== "IntegratorRequestReceived") return []
    if (
      item.correlation.expectedTargetHead !== request.expectedTargetHead ||
      item.correlation.integrationTarget.repository !== request.integrationTarget.repository ||
      item.correlation.integrationTarget.ref !== request.integrationTarget.ref
    ) {
      return []
    }
    const nextIntegratorIndex = story.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > integratorIndex &&
        candidateIndex < beforeIndex &&
        candidate._tag === "IntegratorRequestReceived"
    )
    const candidate = story
      .slice(integratorIndex + 1, nextIntegratorIndex < 0 ? beforeIndex : nextIntegratorIndex)
      .find(
        (candidateItem) =>
          candidateItem._tag === "IntegratorGitObservationReturned" &&
          candidateItem.observation._tag === "Commit" &&
          candidateItem.observation.commit === request.candidateCommit
      )
    return candidate === undefined
      ? []
      : [
          {
            correlation: item.correlation,
            integratorIndex,
            plannedAttempt: item.correlation.plannedAttempt,
            request: TargetPromotionGitRequest.make({
              candidateCommit: request.candidateCommit,
              expectedTargetHead: item.correlation.expectedTargetHead,
              integrationTarget: item.correlation.integrationTarget
            })
          }
        ]
  })
  return origins
}

/** Returns one exact promotion origin; an alias is deliberately not resolved by arrival order. */
const targetPromotionOriginFor = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  request: TargetPromotionGitRequest,
  beforeIndex: number
) => {
  const origins = targetPromotionOriginsFor(story, request, beforeIndex)
  const origin = origins[0]
  return origins.length === 1 && origin !== undefined && targetPromotionGitRequestMatches(origin.request, request)
    ? origin
    : undefined
}

type TargetPromotionCompareAndSetStoryItem =
  | Extract<AuthoredCassetteStoryItem, { readonly _tag: "TargetPromotionCompareAndSetReturned" }>
  | Extract<AuthoredCassetteStoryItem, { readonly _tag: "TargetPromotionCompareAndSetResponseLost" }>

const targetPromotionCompareAndSetItems = (story: ReadonlyArray<AuthoredCassetteStoryItem>) =>
  story.flatMap(
    (item, index): ReadonlyArray<readonly [number, TargetPromotionCompareAndSetStoryItem]> =>
      item._tag === "TargetPromotionCompareAndSetReturned" || item._tag === "TargetPromotionCompareAndSetResponseLost"
        ? [[index, item]]
        : []
  )

const targetPromotionWorkflowKey = (origin: { readonly correlation: IntegratorSessionCorrelation }): string =>
  JSON.stringify([
    String(origin.correlation.sessionId),
    String(origin.correlation.candidateResource),
    String(origin.correlation.plannedAttempt.attemptId),
    String(origin.correlation.plannedAttempt.taskId),
    String(origin.correlation.queuedAt),
    String(origin.correlation.startedAt),
    String(origin.correlation.targetLineageObservedAt)
  ])

/**
 * A request projection is ambiguous when two distinct Integrator workflows
 * could still be the owner of the same CAS response. A returned CAS ends its
 * workflow; a lost response keeps that workflow eligible for reconciliation
 * and a sequential retry. This permits sequential identical requests while
 * rejecting concurrent aliases before a response can be assigned by arrival.
 */
export const targetPromotionGitRequestAliasIssue = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): string | undefined => {
  for (const [index, item] of targetPromotionCompareAndSetItems(story)) {
    const origins = targetPromotionOriginsFor(story, item.request, index).filter((origin) => {
      const prior = targetPromotionCompareAndSetItems(story).filter(
        ([priorIndex, priorItem]) =>
          priorIndex > origin.integratorIndex &&
          priorIndex < index &&
          targetPromotionGitRequestMatches(priorItem.request, item.request)
      )
      const last = prior[prior.length - 1]?.[1]
      return last === undefined || last._tag === "TargetPromotionCompareAndSetResponseLost"
    })
    const distinctWorkflows = new Set(origins.map(targetPromotionWorkflowKey))
    if (distinctWorkflows.size > 1) {
      return `target-promotion request ${JSON.stringify(item.request)} aliases ${distinctWorkflows.size} concurrent Integrator workflows`
    }
  }
  return undefined
}

const targetPromotionGitRequestsAreUnambiguous = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) => targetPromotionGitRequestAliasIssue(cassette.story)
)

/** Collision-free map identity for one exact cassette task-attempt gate. */
export const taskWorktreeSelectionHoldKey = (taskId: TaskId, attemptId: AttemptId): string =>
  JSON.stringify([String(taskId), String(attemptId)])

type StoryClosureTransition<State> =
  | { readonly _tag: "Continue"; readonly state: State }
  | { readonly _tag: "Reject"; readonly issue: string }

const continueStoryClosure = <State>(state: State): StoryClosureTransition<State> => ({ _tag: "Continue", state })
const rejectStoryClosure = <State>(issue: string): StoryClosureTransition<State> => ({ _tag: "Reject", issue })

const foldStoryClosure = <State>(
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  initial: State,
  step: (state: State, item: AuthoredCassetteStoryItem, index: number) => StoryClosureTransition<State>
): StoryClosureTransition<State> => {
  let state = initial
  for (const [index, item] of story.entries()) {
    const transition = step(state, item, index)
    if (transition._tag === "Reject") return transition
    state = transition.state
  }
  return continueStoryClosure(state)
}

const mapWithoutKey = <Key, Value>(source: ReadonlyMap<Key, Value>, key: Key): ReadonlyMap<Key, Value> =>
  new Map([...source].filter(([candidate]) => candidate !== key))

type TaskWorktreeSelectionHold = Extract<
  AuthoredCassetteStoryItem,
  { readonly _tag: "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion" }
>
type TaskWorktreeSelectionRelease = Extract<
  AuthoredCassetteStoryItem,
  { readonly _tag: "CassetteReleasesHeldTaskWorktreeSelection" }
>
type TaskWorktreeSelectionIdentity = { readonly attemptId: AttemptId; readonly taskId: TaskId }
type TaskWorktreeSelectionHoldState = {
  readonly active: ReadonlyMap<string, { readonly hold: TaskWorktreeSelectionHold }>
  readonly seen: ReadonlySet<string>
}

const isExactTaskWorktreeSelection = (
  item: AuthoredCassetteStoryItem,
  identity: TaskWorktreeSelectionIdentity
): boolean =>
  item._tag === "DalphSelects" &&
  item.operation._tag === "ReconcileTaskWorktree" &&
  item.operation.taskId === identity.taskId &&
  item.operation.attemptId === identity.attemptId

const hasExactTaskWorktreeSelection = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  identity: TaskWorktreeSelectionIdentity,
  fromIndex: number,
  untilIndex?: number
): boolean => story.slice(fromIndex, untilIndex).some((item) => isExactTaskWorktreeSelection(item, identity))

const registerTaskWorktreeSelectionHold = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  state: TaskWorktreeSelectionHoldState,
  hold: TaskWorktreeSelectionHold,
  index: number
): StoryClosureTransition<TaskWorktreeSelectionHoldState> => {
  const key = taskWorktreeSelectionHoldKey(hold.taskId, hold.attemptId)
  if (state.active.has(key)) return rejectStoryClosure(`task worktree-selection hold ${key} is duplicated`)
  if (state.seen.has(key)) return rejectStoryClosure(`task worktree-selection hold ${key} is repeated`)
  if (hasExactTaskWorktreeSelection(story, hold, 0, index)) {
    return rejectStoryClosure(
      `task worktree-selection hold ${key} must precede its first exact ReconcileTaskWorktree selection`
    )
  }
  if (!hasExactTaskWorktreeSelection(story, hold, index + 1)) {
    return rejectStoryClosure(
      `task worktree-selection hold ${key} must precede its exact ReconcileTaskWorktree selection`
    )
  }
  return continueStoryClosure({
    active: new Map([...state.active, [key, { hold }]]),
    seen: new Set([...state.seen, key])
  })
}

const guardTaskWorktreeSelection = (
  state: TaskWorktreeSelectionHoldState,
  item: AuthoredCassetteStoryItem
): StoryClosureTransition<TaskWorktreeSelectionHoldState> => {
  if (item._tag !== "DalphSelects" || item.operation._tag !== "ReconcileTaskWorktree") {
    return continueStoryClosure(state)
  }
  const key = taskWorktreeSelectionHoldKey(item.operation.taskId, item.operation.attemptId)
  return state.active.has(key)
    ? rejectStoryClosure(
        `task worktree-selection hold ${key} must be released before its exact ReconcileTaskWorktree selection`
      )
    : continueStoryClosure(state)
}

const isAppliedTargetPromotion = (
  item: AuthoredCassetteStoryItem | undefined
): item is Extract<AuthoredCassetteStoryItem, { readonly _tag: "TargetPromotionCompareAndSetReturned" }> =>
  item?._tag === "TargetPromotionCompareAndSetReturned" && item.result._tag === "Applied"

const taskWorktreeReleaseMatchesPromotion = (
  hold: TaskWorktreeSelectionHold,
  release: TaskWorktreeSelectionRelease,
  promotion: Extract<AuthoredCassetteStoryItem, { readonly _tag: "TargetPromotionCompareAndSetReturned" }>
): boolean =>
  targetPromotionGitRequestMatches(hold.promotionRequest, release.promotionRequest) &&
  targetPromotionGitRequestMatches(hold.promotionRequest, promotion.request)

const releaseTaskWorktreeSelectionHold = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  state: TaskWorktreeSelectionHoldState,
  release: TaskWorktreeSelectionRelease,
  index: number
): StoryClosureTransition<TaskWorktreeSelectionHoldState> => {
  const key = taskWorktreeSelectionHoldKey(release.taskId, release.attemptId)
  const held = state.active.get(key)
  if (held === undefined) return rejectStoryClosure(`task worktree-selection release ${key} has no matching hold`)
  const predecessor = story[index - 1]
  if (!isAppliedTargetPromotion(predecessor)) {
    return rejectStoryClosure(
      `task worktree-selection release ${key} must immediately follow an Applied target-promotion compare-and-set`
    )
  }
  if (!taskWorktreeReleaseMatchesPromotion(held.hold, release, predecessor)) {
    return rejectStoryClosure(
      `task worktree-selection release ${key} must match its hold and predecessor promotion request`
    )
  }
  if (targetPromotionOriginFor(story, predecessor.request, index) === undefined) {
    return rejectStoryClosure(
      `task worktree-selection release ${key} must follow the exact Integrator candidate for its promotion request`
    )
  }
  if (!hasExactTaskWorktreeSelection(story, release, index + 1)) {
    return rejectStoryClosure(
      `task worktree-selection release ${key} must precede its exact ReconcileTaskWorktree selection`
    )
  }
  return continueStoryClosure({ ...state, active: mapWithoutKey(state.active, key) })
}

const taskWorktreeSelectionHoldStep = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  state: TaskWorktreeSelectionHoldState,
  item: AuthoredCassetteStoryItem,
  index: number
): StoryClosureTransition<TaskWorktreeSelectionHoldState> => {
  if (item._tag === "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion") {
    return registerTaskWorktreeSelectionHold(story, state, item, index)
  }
  if (item._tag === "CassetteReleasesHeldTaskWorktreeSelection") {
    return releaseTaskWorktreeSelectionHold(story, state, item, index)
  }
  return guardTaskWorktreeSelection(state, item)
}

/**
 * The authored worktree hold is a harness scheduling seam, not a production
 * position. It must be armed before its exact ReconcileTaskWorktree
 * selection, and its exact release must immediately follow an Applied target
 * promotion CAS carrying the same exact Git request named by both markers;
 * the release marker itself remains exact and fail-closed.
 */
export const taskWorktreeSelectionHoldClosureIssue = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): string | undefined => {
  const result = foldStoryClosure<TaskWorktreeSelectionHoldState>(
    story,
    { active: new Map(), seen: new Set() },
    (state, item, index) => taskWorktreeSelectionHoldStep(story, state, item, index)
  )
  if (result._tag === "Reject") return result.issue
  return result.state.active.size === 0
    ? undefined
    : `task worktree-selection hold ${result.state.active.keys().next().value ?? "unknown"} reaches terminal assertions unreleased`
}

const taskWorktreeSelectionHoldClosure = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  taskWorktreeSelectionHoldClosureIssue(cassette.story)
)

type PromotedCompletionReadHold =
  typeof AuthoredCassetteStoryItem.cases.CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins.Type
type PromotedCompletionReadRelease =
  typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldPromotedTaskCompletionClaimRead.Type
type ActivePromotedCompletionReadHold = {
  readonly hold: PromotedCompletionReadHold
  readonly index: number
  readonly promotionIndex: number
}
type PromotedCompletionReadHoldState = {
  readonly active: ReadonlyMap<string, ActivePromotedCompletionReadHold>
  readonly seenPromotedTaskIds: ReadonlySet<TaskId>
}

/** Collision-free map identity for one exact promoted-task/releasing-task cassette gate. */
export const promotedCompletionReadHoldKey = (item: {
  readonly promotedAttemptId: AttemptId
  readonly promotedTaskId: TaskId
  readonly releasedByAttemptId: AttemptId
  readonly releasedByTaskId: TaskId
}): string =>
  JSON.stringify([
    String(item.promotedTaskId),
    String(item.promotedAttemptId),
    String(item.releasedByTaskId),
    String(item.releasedByAttemptId)
  ])

const promotedCompletionPrearmIssue = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  item: AuthoredCassetteStoryItem,
  index: number
): string | undefined => {
  if (item._tag !== "CompletionClaimReadReturned") return undefined
  const futureHold = story.findIndex(
    (candidate, candidateIndex) =>
      candidateIndex > index &&
      candidate._tag === "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins" &&
      candidate.promotedTaskId === item.taskId
  )
  return futureHold < 0
    ? undefined
    : `promoted completion-claim read for ${item.taskId} precedes its pre-armed hold marker`
}

const exactIntegratorIndexForPromotedHold = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  hold: PromotedCompletionReadHold,
  afterIndex: number
): number =>
  story.findIndex(
    (candidate, candidateIndex) =>
      candidateIndex > afterIndex &&
      candidate._tag === "IntegratorRequestReceived" &&
      candidate.correlation.plannedAttempt.taskId === hold.promotedTaskId &&
      candidate.correlation.plannedAttempt.attemptId === hold.promotedAttemptId
  )

const promotionOriginMatchesPromotedHold = (
  origin: ReturnType<typeof targetPromotionOriginFor>,
  hold: PromotedCompletionReadHold,
  integratorIndex: number
): boolean =>
  origin !== undefined &&
  origin.integratorIndex === integratorIndex &&
  origin.plannedAttempt.taskId === hold.promotedTaskId &&
  origin.plannedAttempt.attemptId === hold.promotedAttemptId

const exactAppliedPromotionIndexForHold = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  hold: PromotedCompletionReadHold,
  integratorIndex: number
): number =>
  story.findIndex((candidate, candidateIndex) => {
    if (candidateIndex <= integratorIndex || !isAppliedTargetPromotion(candidate)) return false
    return promotionOriginMatchesPromotedHold(
      targetPromotionOriginFor(story, candidate.request, candidateIndex),
      hold,
      integratorIndex
    )
  })

const registerPromotedCompletionReadHold = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  state: PromotedCompletionReadHoldState,
  hold: PromotedCompletionReadHold,
  index: number
): StoryClosureTransition<PromotedCompletionReadHoldState> => {
  const key = promotedCompletionReadHoldKey(hold)
  if (state.active.has(key)) return rejectStoryClosure(`promoted completion-claim read hold ${key} is duplicated`)
  if (state.seenPromotedTaskIds.has(hold.promotedTaskId)) {
    return rejectStoryClosure(`promoted completion-claim read hold for ${hold.promotedTaskId} is repeated`)
  }
  const integratorIndex = exactIntegratorIndexForPromotedHold(story, hold, index)
  if (integratorIndex < 0) {
    return rejectStoryClosure(`promoted completion-claim read hold ${key} has no exact integration request`)
  }
  const promotionIndex = exactAppliedPromotionIndexForHold(story, hold, integratorIndex)
  if (promotionIndex < 0) {
    return rejectStoryClosure(
      `promoted completion-claim read hold ${key} has no later Applied promotion for its exact promotion request`
    )
  }
  return continueStoryClosure({
    active: new Map([...state.active, [key, { hold, index, promotionIndex }]]),
    seenPromotedTaskIds: new Set([...state.seenPromotedTaskIds, hold.promotedTaskId])
  })
}

const isExactExecutingBegin = (item: AuthoredCassetteStoryItem | undefined, attemptId: AttemptId): boolean =>
  item?._tag === "PlannedAttemptExecutorWorkReported" &&
  item.request === "Begin" &&
  item.report._tag === "ExecutorWorkExecuting" &&
  item.report.attemptId === attemptId

const releasePrecedesFirstActivePromotedRead = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  held: ActivePromotedCompletionReadHold,
  release: PromotedCompletionReadRelease,
  releaseIndex: number
): boolean => {
  const firstPromotedRead = story.findIndex(
    (candidate, candidateIndex) =>
      candidateIndex > held.index &&
      candidate._tag === "CompletionClaimReadReturned" &&
      candidate.taskId === release.promotedTaskId
  )
  const promotedRead = story[firstPromotedRead]
  return (
    firstPromotedRead >= releaseIndex &&
    promotedRead?._tag === "CompletionClaimReadReturned" &&
    promotedRead.claim === "Active"
  )
}

const releasePromotedCompletionReadHold = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  state: PromotedCompletionReadHoldState,
  release: PromotedCompletionReadRelease,
  index: number
): StoryClosureTransition<PromotedCompletionReadHoldState> => {
  const key = promotedCompletionReadHoldKey(release)
  const held = state.active.get(key)
  if (held === undefined)
    return rejectStoryClosure(`promoted completion-claim read release ${key} has no matching hold`)
  if (held.promotionIndex >= index) {
    return rejectStoryClosure(`promoted completion-claim read release ${key} precedes its exact Applied promotion`)
  }
  if (!isExactExecutingBegin(story[index - 1], release.releasedByAttemptId)) {
    return rejectStoryClosure(
      `promoted completion-claim read release ${key} must immediately follow its exact executing Begin response`
    )
  }
  if (
    !hasExactTaskWorktreeSelection(
      story,
      { attemptId: release.releasedByAttemptId, taskId: release.releasedByTaskId },
      held.index + 1,
      index - 1
    )
  ) {
    return rejectStoryClosure(
      `promoted completion-claim read release ${key} has no exact released-attempt worktree selection`
    )
  }
  if (!releasePrecedesFirstActivePromotedRead(story, held, release, index)) {
    return rejectStoryClosure(
      `promoted completion-claim read hold ${key} must release before its first exact Active claim read`
    )
  }
  return continueStoryClosure({ ...state, active: mapWithoutKey(state.active, key) })
}

const promotedCompletionReadHoldStep = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>,
  state: PromotedCompletionReadHoldState,
  item: AuthoredCassetteStoryItem,
  index: number
): StoryClosureTransition<PromotedCompletionReadHoldState> => {
  const prearmIssue = promotedCompletionPrearmIssue(story, item, index)
  if (prearmIssue !== undefined) return rejectStoryClosure(prearmIssue)
  if (item._tag === "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins") {
    return registerPromotedCompletionReadHold(story, state, item, index)
  }
  if (item._tag === "CassetteReleasesHeldPromotedTaskCompletionClaimRead") {
    return releasePromotedCompletionReadHold(story, state, item, index)
  }
  return continueStoryClosure(state)
}

/**
 * A completion-read hold describes one cassette-only causal edge. The exact
 * promoted attempt must reach an Applied promotion, the exact successor must
 * report Begin, and only then may the promoted task's Active claim read be
 * consumed. Production scheduling remains unconstrained by this story edge.
 */
export const promotedCompletionReadHoldClosureIssue = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): string | undefined => {
  const result = foldStoryClosure<PromotedCompletionReadHoldState>(
    story,
    { active: new Map(), seenPromotedTaskIds: new Set() },
    (state, item, index) => promotedCompletionReadHoldStep(story, state, item, index)
  )
  if (result._tag === "Reject") return result.issue
  return result.state.active.size === 0
    ? undefined
    : `promoted completion-claim read hold ${result.state.active.keys().next().value ?? "unknown"} reaches terminal assertions unreleased`
}

const promotedCompletionReadHoldClosure = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  promotedCompletionReadHoldClosureIssue(cassette.story)
)

const heldPauseOffset = 1
const heldPauseGraphSelectionOffset = 2
const heldPauseGraphReturnOffset = 3
const heldUnpauseOffset = 4
const heldUnpauseGraphSelectionOffset = 5
const heldUnpauseGraphReturnOffset = 6
const heldLaterActivationGraphSelectionOffset = 7
const heldLaterActivationGraphReturnOffset = 8
const heldSpecificationSelectionOffset = 9
const heldSpecificationReturnOffset = 10
const heldAttemptChoiceOffset = 11
const heldPostChoiceOffset = 12

type AuthoredStory = (typeof AuthoredScenarioCassetteShape.Type)["story"]
type AdmittedContinuationHold =
  typeof AuthoredCassetteStoryItem.cases.DalphHoldsAdmittedContinuationBeforeExecutorIntent.Type

const exactTaskControlItemAt = (
  story: AuthoredStory,
  holdIndex: number,
  controlOffset: number,
  direction: "Pause" | "Unpause",
  taskId: TaskId
): boolean => {
  const control = story[holdIndex + controlOffset]
  return (
    control?._tag === "OperatorAppliesControlDirection" &&
    control.direction === direction &&
    control.subject._tag === "Task" &&
    control.subject.taskId === taskId
  )
}

const graphReadAt = (
  story: AuthoredStory,
  holdIndex: number,
  selectionOffset: number,
  returnOffset: number
): boolean => {
  const selection = story[holdIndex + selectionOffset]
  const returned = story[holdIndex + returnOffset]
  return (
    selection?._tag === "DalphSelects" &&
    selection.operation._tag === "ReadTrackerGraph" &&
    returned?._tag === "TrackerGraphReadReturned"
  )
}

const exactTaskControlAt = (
  story: AuthoredStory,
  holdIndex: number,
  controlOffset: number,
  graphSelectionOffset: number,
  graphReturnOffset: number,
  direction: "Pause" | "Unpause",
  taskId: TaskId
): boolean =>
  exactTaskControlItemAt(story, holdIndex, controlOffset, direction, taskId) &&
  graphReadAt(story, holdIndex, graphSelectionOffset, graphReturnOffset)

const exactHeldSpecificationAt = (
  story: AuthoredStory,
  holdIndex: number,
  taskId: TaskId
): typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type | undefined => {
  const selection = story[holdIndex + heldSpecificationSelectionOffset]
  const specification = story[holdIndex + heldSpecificationReturnOffset]
  return selection?._tag === "DalphSelects" &&
    selection.operation._tag === "ReadTaskWorkSpecification" &&
    selection.operation.taskId === taskId &&
    specification?._tag === "TaskWorkSpecificationReadReturned" &&
    specification.taskId === taskId
    ? specification
    : undefined
}

type HeldAttemptChoice = Extract<
  AuthoredCassetteStoryItem,
  { readonly _tag: "OperatorRestartsAttempt" | "OperatorStopsAttempt" }
>

const isHeldAttemptChoice = (choice: AuthoredCassetteStoryItem | undefined): choice is HeldAttemptChoice =>
  choice?._tag === "OperatorStopsAttempt" || choice?._tag === "OperatorRestartsAttempt"

const heldAttemptChoiceStatusMatches = (choice: HeldAttemptChoice): boolean => {
  if (choice._tag === "OperatorRestartsAttempt") return true
  return choice.expected._tag === "Applied" && choice.expected.status === "AwaitingQuiescence"
}

const heldAttemptChoiceMatches = (
  choice: HeldAttemptChoice,
  hold: AdmittedContinuationHold,
  specification: typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type
): boolean =>
  [
    choice.attemptId === hold.attemptId,
    choice.taskId === hold.taskId,
    choice.expected._tag === "Applied",
    heldAttemptChoiceStatusMatches(choice),
    choice.observedTaskRevision === makeTaskWorkSpecification(specification).fingerprint
  ].every(Boolean)

const exactHeldAttemptChoiceAt = (
  story: AuthoredStory,
  holdIndex: number,
  hold: AdmittedContinuationHold,
  specification: typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type
): boolean => {
  const choice = story[holdIndex + heldAttemptChoiceOffset]
  return isHeldAttemptChoice(choice) && heldAttemptChoiceMatches(choice, hold, specification)
}

const heldResumeOutcomeFollowsTerminalChoice = (
  story: AuthoredStory,
  holdIndex: number,
  attemptId: AttemptId
): boolean => {
  const next = story[holdIndex + heldPostChoiceOffset]
  return (
    (next?._tag === "PlannedAttemptExecutorResponseLost" || next?._tag === "PlannedAttemptExecutorWorkReported") &&
    next.request === "Resume" &&
    next.report.attemptId === attemptId
  )
}

const admittedContinuationHoldIndexes = (story: AuthoredStory): ReadonlyArray<number> =>
  story.flatMap((item, index) => (item._tag === "DalphHoldsAdmittedContinuationBeforeExecutorIntent" ? [index] : []))

const exactHeldControlReads = (story: AuthoredStory, holdIndex: number, taskId: TaskId): boolean =>
  exactTaskControlAt(
    story,
    holdIndex,
    heldPauseOffset,
    heldPauseGraphSelectionOffset,
    heldPauseGraphReturnOffset,
    "Pause",
    taskId
  ) &&
  exactTaskControlAt(
    story,
    holdIndex,
    heldUnpauseOffset,
    heldUnpauseGraphSelectionOffset,
    heldUnpauseGraphReturnOffset,
    "Unpause",
    taskId
  ) &&
  graphReadAt(story, holdIndex, heldLaterActivationGraphSelectionOffset, heldLaterActivationGraphReturnOffset)

const admittedContinuationClosureIssue = (
  story: AuthoredStory,
  holdIndex: number,
  hold: AdmittedContinuationHold
): string | undefined => {
  if (!exactHeldControlReads(story, holdIndex, hold.taskId)) {
    return "the admitted continuation hold must cross exact Task Pause, Unpause, and later-activation graph reads"
  }
  const specification = exactHeldSpecificationAt(story, holdIndex, hold.taskId)
  if (specification === undefined) {
    return "the admitted continuation hold must be followed by the production-selected exact F2 specification read"
  }
  if (!exactHeldAttemptChoiceAt(story, holdIndex, hold, specification)) {
    return "the admitted continuation hold must be followed by the matching applied Stop or Restart request"
  }
  if (heldResumeOutcomeFollowsTerminalChoice(story, holdIndex, hold.attemptId)) {
    return "the terminal attempt choice must cancel the held Resume before executor contact"
  }
  return undefined
}

const admittedContinuationHoldHasExactAttemptChoiceClosure = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) => {
    const holdIndexes = admittedContinuationHoldIndexes(cassette.story)
    if (holdIndexes.length === 0) return undefined
    if (holdIndexes.length !== 1) return "an authored cassette may hold at most one admitted continuation"
    const holdIndex = holdIndexes[0]
    /* v8 ignore start -- @preserve The exact-length check and tag-derived index make both defensive failures unconstructible. */
    if (holdIndex === undefined) return "the admitted continuation hold index is missing"
    const hold = cassette.story[holdIndex]
    if (hold?._tag !== "DalphHoldsAdmittedContinuationBeforeExecutorIntent") {
      return "the admitted continuation hold must remain at its decoded position"
    }
    /* v8 ignore stop -- @preserve */
    return admittedContinuationClosureIssue(cassette.story, holdIndex, hold)
  }
)

const AuthoredScenarioCassetteSchema = AuthoredScenarioCassetteShape.check(
  exactlyOneAt("InitialControlPolicy", () => 0, "one InitialControlPolicy must be the first story item")
)
  .check(exactlyOneAt("RunCoordinator", () => 1, "one RunCoordinator must follow InitialControlPolicy"))
  .check(
    exactlyOneAt(
      "ExpectedBehavior",
      (length) => length - 1,
      "one expected-behavior group must be the terminal story item"
    )
  )
  .check(startingFactsAreConsistent)
  .check(behaviorAssertionsAreConsistent)
  .check(causalAnchorsAndChecksAreDistinct)
  .check(coordinatorLifecycleBoundariesHaveFollowingActivationWork)
  .check(finalTrackerReadClosesCurrentActivation)
  .check(ambiguousBoundaryLossesImmediatelyCrash)
  .check(beginResponsesAreExecuting)
  .check(lostExecutorResponsesRequireExplicitProjection)
  .check(completionFinalityStoryIsComplete)
  .check(freshTaskClaimSelectionHoldIsUnique)
  .check(freshTaskClaimSelectionHoldPrecedesMatchingSelections)
  .check(targetPromotionGitRequestsAreUnambiguous)
  .check(taskWorktreeSelectionHoldClosure)
  .check(promotedCompletionReadHoldClosure)
  .check(admittedContinuationHoldHasExactAttemptChoiceClosure)
export const AuthoredScenarioCassette: typeof AuthoredScenarioCassetteSchema = AuthoredScenarioCassetteSchema
export type AuthoredScenarioCassette = typeof AuthoredScenarioCassette.Type
