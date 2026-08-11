/* eslint-disable max-lines -- One closed schema keeps every authored boundary tag and chronology invariant reviewable together. */
import { Effect, Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  PlannedAttemptExecutorResult,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ControlDirection,
  InitialControlPolicy,
  IntegrationCandidateGitObservation,
  makeTaskWorkSpecification,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  TaskLifecycle,
  TaskWorkCapacity,
  TaskClaimObservation,
  TaskClaimReacquisitionRequestId,
  TargetLineageObservation,
  TargetVerificationArtifactName,
  TargetVerificationPlanId,
  TargetPromotionAttemptOrdinal,
  TargetPromotionTerminalBasis,
  TrackerRevision,
  TrackerTarget
} from "@dalph/orchestrator"
import { AuthoredContinueAttemptResult, AuthoredStopAttemptResult } from "./authored-attempt-choice.js"
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
  tasks: Schema.Array(AuthoredTrackerTask)
})
export type AuthoredTrackerGraph = typeof AuthoredTrackerGraph.Type

/** The one-based position of a bounded Run activation in an authored whole-Run cassette. */
export const AuthoredRunActivationOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("AuthoredRunActivationOrdinal")
)
export type AuthoredRunActivationOrdinal = typeof AuthoredRunActivationOrdinal.Type

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
 * Executor reports in authored input name the attempt but never a RunId.
 * Dalph adds the RunId it created when the ordinary executor boundary is used.
 */
export const AuthoredPlannedAttemptExecutorReport = Schema.TaggedUnion({
  Running: { attemptId: AttemptId },
  SafelySuspended: { attemptId: AttemptId },
  Terminal: { attemptId: AttemptId, result: PlannedAttemptExecutorResult }
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
  IntegrationCandidateConstructed: {
    acceptedResultCommit: GitCommitSha,
    attemptId: AttemptId,
    candidateCommit: GitCommitSha,
    expectedTargetHead: GitCommitSha,
    taskId: TaskId
  },
  TargetVerificationPassed: { candidateCommit: GitCommitSha, planId: TargetVerificationPlanId, taskId: TaskId },
  TargetVerificationStopped: {
    candidateCommit: GitCommitSha,
    outcome: Schema.Literals(["Failed", "Killed", "Partial", "TimedOut"]),
    planId: TargetVerificationPlanId,
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
    report: Schema.Literals(["Running", "SafelySuspended", "TerminalAccepted", "TerminalCompleted", "TerminalFailed"])
  },
  PlannedAttemptExecutorCommandProjectionObserved: {
    attemptId: AttemptId,
    report: Schema.Literals(["Running", "SafelySuspended", "TerminalAccepted", "TerminalCompleted", "TerminalFailed"])
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
  target: TrackerTarget,
  verificationPlanId: Schema.NullOr(TargetVerificationPlanId),
  worktreeRoot: WorktreeLocator
}

/** One byte object returned by the authored public verification wrapper. */
const AuthoredTargetVerificationArtifact = Schema.Struct({
  content: Schema.String,
  name: TargetVerificationArtifactName
})

/** A terminal public-wrapper result; correlation is supplied by Dalph's request. */
const AuthoredTargetVerificationResult = Schema.TaggedUnion({
  CorrelationContradiction: {},
  Failed: { artifacts: Schema.Array(AuthoredTargetVerificationArtifact) },
  Killed: { artifacts: Schema.Array(AuthoredTargetVerificationArtifact) },
  Partial: { artifacts: Schema.Array(AuthoredTargetVerificationArtifact) },
  Passed: { artifacts: Schema.NonEmptyArray(AuthoredTargetVerificationArtifact) },
  TimedOut: { artifacts: Schema.Array(AuthoredTargetVerificationArtifact) }
})

/**
 * One chronological authored story. Schema version 1 is provisional until the
 * project owner explicitly removes this comment; adding tags does not imply a
 * released compatibility promise.
 */
export const AuthoredCassetteStoryItem = Schema.TaggedUnion({
  /** Harness lifecycle: one bounded coordinator activation returns this exact public finality decision. */
  CoordinatorActivationReturned: {
    decision: Schema.TaggedUnion({
      RunMayTerminate: {},
      RunMustRemainActive: {
        reason: Schema.Literals(["RunnableTransition", "TrackerTargetUnsettled", "UnsettledResponsibility"])
      }
    })
  },
  /** Harness lifecycle: dispose one coordinator and its same-process executor session without journaling an occurrence. */
  CoordinatorProcessDies: {},
  /** The tracker applied deletion of the exact promotion-correlated completion claim. */
  CompletionClaimDeletionApplied: { taskId: TaskId },
  /** The tracker reports which exact claim kind is current for finality reconciliation. */
  CompletionClaimReadReturned: { claim: Schema.Literals(["Active", "Completion"]), taskId: TaskId },
  /** The tracker applied replacement of the active claim with the exact completion claim. */
  CompletionClaimReplacementApplied: { taskId: TaskId },
  /** Harness synchronization: hold this exact admitted continuation before its durable executor command intent. */
  DalphHoldsAdmittedContinuationBeforeExecutorIntent: { attemptId: AttemptId, taskId: TaskId },
  DalphSelects: { operation: AuthoredCassetteDecision },
  /** Task-work assertions with optional complete lower-level evidence projections. */
  ExpectedBehavior: AuthoredExpectedBehavior.fields,
  GitWorktreeObservationChanged: {
    observation: Schema.Union([PlannedBranchReady, PlannedWorktreeAbsent, PlannedWorktreeReady])
  },
  IntegrationCandidateAgentReported: {
    report: Schema.TaggedUnion({
      Conflict: {},
      CorrelationContradiction: {},
      ExitedWithoutCandidate: {},
      Submitted: { candidateCommit: GitCommitSha },
      Working: {}
    })
  },
  IntegrationCandidateGitValidationFailed: { detail: Schema.String },
  IntegrationCandidateGitValidationReturned: { observation: IntegrationCandidateGitObservation },
  /** The repository's public wrapper returns one terminal result for the selected plan. */
  TargetVerificationReturned: { result: AuthoredTargetVerificationResult },
  /** Git's exact H -> M compare-and-set result, or its lost response. */
  TargetPromotionCompareAndSetReturned: {
    result: Schema.TaggedUnion({ Applied: {}, RejectedExpectedHead: { observedHeadSha: GitCommitSha } })
  },
  TargetPromotionCompareAndSetResponseLost: { detail: Schema.String },
  /** Git's complete candidate-ancestry reconciliation result, or an unreadable read. */
  TargetPromotionGitReadReturned: {
    observation: Schema.TaggedUnion({
      CandidateAncestor: { currentHeadSha: GitCommitSha },
      CandidateCurrent: { currentHeadSha: GitCommitSha },
      CandidateNotInAncestry: { currentHeadSha: GitCommitSha }
    })
  },
  TargetPromotionGitReadFailed: { detail: Schema.String },
  InitialControlPolicy: { policy: InitialControlPolicy },
  PlannedAttemptExecutorWorkReported: {
    report: AuthoredPlannedAttemptExecutorReport,
    request: Schema.Literals(["StartOrContinue", "Suspend"])
  },
  /** A read-only executor projection returns this exact current authority state. */
  PlannedAttemptExecutorProjectionReturned: { report: AuthoredPlannedAttemptExecutorReport },
  /** Executor applied the request and changed its authority state, but Dalph lost the response before journaling it. */
  PlannedAttemptExecutorResponseLost: {
    detail: Schema.String,
    report: AuthoredPlannedAttemptExecutorReport,
    request: Schema.Literals(["StartOrContinue", "Suspend"])
  },
  OperatorAppliesControlDirection: {
    direction: ControlDirection,
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
  },
  /** Harness timing: the Operator applies this direction after the executor request crossed its boundary. */
  OperatorAppliesControlDirectionWhileExecutorRequestInFlight: {
    direction: ControlDirection,
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
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
  TaskClaimReadFailed: { reason: Schema.Literal("Unreadable"), taskId: TaskId },
  TaskClaimCurrentReadReturned: { taskId: TaskId },
  TaskClaimReadReturned: { observation: TaskClaimObservation },
  /** Tracker applied the exact release, but Dalph lost the mutation response before journaling its outcome. */
  TaskClaimReleaseResponseLost: { detail: Schema.String, taskId: TaskId },
  TrackerGraphReadFailed: { reason: Schema.Literal("IncompleteSnapshot") },
  TrackerGraphReadReturned: { graph: AuthoredTrackerGraph }
})
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
    "InitialControlPolicy",
    "OperatorAppliesControlDirection",
    "OperatorAppliesControlDirectionWhileExecutorRequestInFlight",
    "OperatorControlDirectionFailed",
    "OperatorContinuesAttempt",
    "OperatorDirectsTaskClaimReacquisition",
    "OperatorRacesContinueAndStop",
    "OperatorStopsAttempt",
    "RunCoordinator",
    "SetTaskExecutionCapacity"
  ],
  CassetteLifecycle: ["CoordinatorActivationReturned", "CoordinatorProcessDies"],
  DeliverySynchronization: ["DalphHoldsAdmittedContinuationBeforeExecutorIntent"],
  DalphOperationTrace: ["DalphSelects"],
  Git: ["GitWorktreeObservationChanged"],
  IntegrationCandidateConstruction: [
    "IntegrationCandidateAgentReported",
    "IntegrationCandidateGitValidationFailed",
    "IntegrationCandidateGitValidationReturned"
  ],
  TargetVerification: ["TargetVerificationReturned"],
  TargetPromotion: [
    "TargetPromotionCompareAndSetReturned",
    "TargetPromotionCompareAndSetResponseLost",
    "TargetPromotionGitReadReturned",
    "TargetPromotionGitReadFailed"
  ],
  PlannedAttemptExecutor: [
    "PlannedAttemptExecutorProjectionReturned",
    "PlannedAttemptExecutorResponseLost",
    "PlannedAttemptExecutorWorkReported"
  ],
  TaskTracker: [
    "CompletionClaimDeletionApplied",
    "CompletionClaimReadReturned",
    "CompletionClaimReplacementApplied",
    "TaskClaimReadFailed",
    "TaskClaimCurrentReadReturned",
    "TaskClaimReadReturned",
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

/**
 * States what the authored chronology is allowed to claim about delivery.
 * A focused slice may demonstrate scheduling, recovery, or one protocol seam
 * without claiming that Dalph integrated every tracker-successful task. A
 * complete graph delivery must carry the accepted-result and finality evidence
 * that distinguishes Dalph delivery from an outside tracker completion.
 */
export const AuthoredCassetteDeliveryScope = Schema.TaggedUnion({ FocusedWorkflowSlice: {}, CompleteGraphDelivery: {} })
export type AuthoredCassetteDeliveryScope = typeof AuthoredCassetteDeliveryScope.Type

const AuthoredScenarioCassetteShape = Schema.TaggedStruct("AuthoredScenarioCassette", {
  deliveryScope: AuthoredCassetteDeliveryScope,
  name: Schema.NonEmptyString,
  schemaVersion: Schema.Literal(authoredScenarioCassetteVersion),
  startingFacts: Schema.Struct({
    executorWork: Schema.Literal("NoPriorReport"),
    journal: Schema.Literal("Empty"),
    taskClaims: Schema.Array(ActiveTaskClaim),
    taskWorkSpecifications: Schema.Array(AuthoredTaskWorkSpecification),
    targetLineageObservation: Schema.optionalKey(TargetLineageObservation),
    trackerGraph: AuthoredTrackerGraph,
    worktreeObservation: Schema.Union([PlannedBranchReady, PlannedWorktreeAbsent, PlannedWorktreeReady])
  }),
  story: Schema.Array(AuthoredCassetteStoryItem)
})

const terminalStoryItemOffset = -1

const graphTasksObservedIn = (cassette: typeof AuthoredScenarioCassetteShape.Type) => [
  ...cassette.startingFacts.trackerGraph.tasks,
  ...cassette.story.flatMap((item) =>
    item._tag === "TrackerGraphReadReturned" || item._tag === "RunActivationFinalTrackerGraphReadReturned"
      ? item.graph.tasks
      : []
  )
]

const integrationTargetsAreEqual = (left: IntegrationTarget, right: IntegrationTarget) =>
  left.repository === right.repository && left.ref === right.ref

const missingEvidenceIndex = -1

type ExpectedAuthoredBehavior = typeof AuthoredExpectedBehaviorShape.Type
type ExpectedOrchestrationEvidence = NonNullable<ExpectedAuthoredBehavior["orchestration"]>[number]
type AcceptedTaskWorkResult = Extract<AuthoredTaskWorkResult, { readonly _tag: "PlannedWorkForTaskAccepted" }>

const exactTaskStages = [
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  "AcceptedResultIntegrationResponsibilityBegan",
  "AcceptedResultIntegrationStarted",
  "IntegrationCandidateConstructed",
  "TargetVerificationPassed",
  "TargetPromotionSucceeded"
] as const

const taskStagesAreUnambiguous = (evidence: ReadonlyArray<ExpectedOrchestrationEvidence>, taskId: TaskId) =>
  exactTaskStages.every((tag) => evidence.filter((item) => item._tag === tag && item.taskId === taskId).length === 1)

const integrationResponsibilityFor = (
  evidence: ReadonlyArray<ExpectedOrchestrationEvidence>,
  taskId: TaskId,
  acceptedCommit: GitCommitSha,
  integrationTarget: IntegrationTarget
) => {
  const index = evidence.findIndex(
    (item) =>
      item._tag === "AcceptedResultIntegrationResponsibilityBegan" &&
      item.taskId === taskId &&
      item.commit === acceptedCommit &&
      integrationTargetsAreEqual(item.integrationTarget, integrationTarget)
  )
  const item = evidence[index]
  return item?._tag === "AcceptedResultIntegrationResponsibilityBegan" ? { index, item } : undefined
}

const executorAcceptancePrecedesIntegration = (
  evidence: ReadonlyArray<ExpectedOrchestrationEvidence>,
  taskId: TaskId,
  attemptId: AttemptId,
  integrationResponsibilityIndex: number
) => {
  const responsibilityIndex = evidence.findIndex(
    (item) =>
      item._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      item.taskId === taskId &&
      item.attemptId === attemptId
  )
  const acceptedIndexes = evidence.flatMap((item, index) =>
    item._tag === "PlannedAttemptExecutorWorkReported" &&
    item.attemptId === attemptId &&
    item.report === "TerminalAccepted"
      ? [index]
      : []
  )
  const acceptedIndex = acceptedIndexes[0] ?? missingEvidenceIndex
  return [
    responsibilityIndex >= 0,
    acceptedIndexes.length === 1,
    responsibilityIndex < acceptedIndex,
    acceptedIndex < integrationResponsibilityIndex
  ].every(Boolean)
}

const integrationStartedIndexFor = (
  evidence: ReadonlyArray<ExpectedOrchestrationEvidence>,
  after: number,
  taskId: TaskId,
  attemptId: AttemptId,
  acceptedCommit: GitCommitSha,
  integrationTarget: IntegrationTarget
) =>
  evidence.findIndex(
    (item, index) =>
      index > after &&
      item._tag === "AcceptedResultIntegrationStarted" &&
      item.taskId === taskId &&
      item.attemptId === attemptId &&
      item.commit === acceptedCommit &&
      integrationTargetsAreEqual(item.integrationTarget, integrationTarget)
  )

const candidateAfter = (
  evidence: ReadonlyArray<ExpectedOrchestrationEvidence>,
  after: number,
  taskId: TaskId,
  attemptId: AttemptId,
  acceptedCommit: GitCommitSha
) => {
  const index = evidence.findIndex(
    (item, itemIndex) =>
      itemIndex > after &&
      item._tag === "IntegrationCandidateConstructed" &&
      item.taskId === taskId &&
      item.attemptId === attemptId &&
      item.acceptedResultCommit === acceptedCommit
  )
  const item = evidence[index]
  return item?._tag === "IntegrationCandidateConstructed" ? { index, item } : undefined
}

const candidateVerificationAndPromotionAreCorrelated = (
  evidence: ReadonlyArray<ExpectedOrchestrationEvidence>,
  taskId: TaskId,
  candidate: Extract<ExpectedOrchestrationEvidence, { readonly _tag: "IntegrationCandidateConstructed" }>,
  candidateIndex: number
) => {
  const verificationIndex = evidence.findIndex(
    (item, index) =>
      index > candidateIndex &&
      item._tag === "TargetVerificationPassed" &&
      item.taskId === taskId &&
      item.candidateCommit === candidate.candidateCommit
  )
  const promotionIndex = evidence.findIndex(
    (item, index) =>
      index > verificationIndex &&
      item._tag === "TargetPromotionSucceeded" &&
      item.taskId === taskId &&
      item.candidateCommit === candidate.candidateCommit &&
      item.expectedTargetHead === candidate.expectedTargetHead
  )
  return verificationIndex >= 0 && promotionIndex >= 0
}

const exactDeliveryEvidenceIssue = (
  taskId: TaskId,
  acceptedCommit: GitCommitSha,
  evidence: ReadonlyArray<ExpectedOrchestrationEvidence>,
  integrationTarget: IntegrationTarget
): string | undefined => {
  if (!taskStagesAreUnambiguous(evidence, taskId)) {
    return `complete graph delivery requires exactly one unambiguous delivery stage for task ${taskId}`
  }
  const responsibility = integrationResponsibilityFor(evidence, taskId, acceptedCommit, integrationTarget)
  if (responsibility === undefined) {
    return `complete graph delivery requires an exact accepted-result integration responsibility for task ${taskId}`
  }
  if (!executorAcceptancePrecedesIntegration(evidence, taskId, responsibility.item.attemptId, responsibility.index)) {
    return `complete graph delivery requires one exact accepted commit, attempt, and integration lineage for task ${taskId}`
  }
  const startedIndex = integrationStartedIndexFor(
    evidence,
    responsibility.index,
    taskId,
    responsibility.item.attemptId,
    acceptedCommit,
    integrationTarget
  )
  const candidate = candidateAfter(evidence, startedIndex, taskId, responsibility.item.attemptId, acceptedCommit)
  if (startedIndex < 0 || candidate === undefined) {
    return `complete graph delivery requires one exact accepted commit, attempt, and integration lineage for task ${taskId}`
  }
  return candidateVerificationAndPromotionAreCorrelated(evidence, taskId, candidate.item, candidate.index)
    ? undefined
    : `complete graph delivery requires exact candidate verification and promotion lineage for task ${taskId}`
}

const completionFinalityIssue = (
  cassette: typeof AuthoredScenarioCassetteShape.Type,
  taskId: TaskId
): string | undefined => {
  const replacementIndex = cassette.story.findIndex(
    (item) => item._tag === "CompletionClaimReplacementApplied" && item.taskId === taskId
  )
  const successfulGraphIndex = cassette.story.findIndex(
    (item, index) =>
      index > replacementIndex &&
      (item._tag === "TrackerGraphReadReturned" || item._tag === "RunActivationFinalTrackerGraphReadReturned") &&
      item.graph.tasks.some((task) => task.id === taskId && task.lifecycle._tag === "CompletedSuccessfully")
  )
  const deletionIndex = cassette.story.findIndex(
    (item, index) =>
      index > successfulGraphIndex && item._tag === "CompletionClaimDeletionApplied" && item.taskId === taskId
  )
  return replacementIndex >= 0 && successfulGraphIndex >= 0 && deletionIndex >= 0
    ? undefined
    : `complete graph delivery requires promotion-bound completion finality for task ${taskId}`
}

type CompleteGraphTaskScope =
  | { readonly _tag: "Invalid"; readonly issue: string }
  | { readonly _tag: "Valid"; readonly taskIds: ReadonlyArray<TaskId> }

const completeGraphTaskScopeOf = (cassette: typeof AuthoredScenarioCassetteShape.Type): CompleteGraphTaskScope => {
  const observedGraphTasks = graphTasksObservedIn(cassette)
  const taskIds = [...new Set(observedGraphTasks.map(({ id }) => id))]
  if (taskIds.length === 0) {
    return { _tag: "Invalid", issue: "complete graph delivery requires at least one observed tracker task" }
  }
  const taskWithoutTrackerSuccess = taskIds.find(
    (taskId) =>
      !observedGraphTasks.some((task) => task.id === taskId && task.lifecycle._tag === "CompletedSuccessfully")
  )
  return taskWithoutTrackerSuccess === undefined
    ? { _tag: "Valid", taskIds }
    : {
        _tag: "Invalid",
        issue: `complete graph delivery requires tracker success for every observed task; task ${taskWithoutTrackerSuccess} never reached success`
      }
}

type CompleteGraphAcceptedResults =
  | { readonly _tag: "Invalid"; readonly issue: string }
  | { readonly _tag: "Valid"; readonly results: ReadonlyArray<AcceptedTaskWorkResult> }

const completeGraphAcceptedResultsOf = (
  expected: ExpectedAuthoredBehavior,
  graphTaskIds: ReadonlyArray<TaskId>
): CompleteGraphAcceptedResults => {
  const results = expected.taskWork.results.filter(
    (result): result is AcceptedTaskWorkResult => result._tag === "PlannedWorkForTaskAccepted"
  )
  const resultTasks = results.map(({ taskId }) => taskId)
  const exactlyOnePerGraphTask = [
    results.length === expected.taskWork.results.length,
    results.length === graphTaskIds.length,
    new Set(resultTasks).size === resultTasks.length,
    resultTasks.every((taskId) => graphTaskIds.includes(taskId))
  ].every(Boolean)
  return exactlyOnePerGraphTask
    ? { _tag: "Valid", results }
    : { _tag: "Invalid", issue: "complete graph delivery requires one accepted commit for every observed tracker task" }
}

const plannedAttemptsHaveOneTask = (evidence: ReadonlyArray<ExpectedOrchestrationEvidence>) => {
  const responsibilities = evidence.filter(
    (
      item
    ): item is Extract<
      ExpectedOrchestrationEvidence,
      { readonly _tag: "PlannedAttemptExecutorWorkResponsibilityBegan" }
    > => item._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
  )
  return new Set(responsibilities.map(({ attemptId }) => attemptId)).size === responsibilities.length
}

const completeDeliveryEvidenceIssue = (
  cassette: typeof AuthoredScenarioCassetteShape.Type,
  evidence: ReadonlyArray<ExpectedOrchestrationEvidence>,
  results: ReadonlyArray<AcceptedTaskWorkResult>,
  integrationTarget: IntegrationTarget
) =>
  results
    .flatMap((result) => [
      exactDeliveryEvidenceIssue(result.taskId, result.commit, evidence, integrationTarget),
      completionFinalityIssue(cassette, result.taskId)
    ])
    .find((issue) => issue !== undefined)

const completeGraphDeliveryHasExactEvidence = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) => {
    if (cassette.deliveryScope._tag !== "CompleteGraphDelivery") return undefined
    const expected = Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ExpectedBehavior)(
      cassette.story.at(terminalStoryItemOffset)
    )
    if (expected.orchestration === null) {
      return "complete graph delivery requires exact orchestration evidence"
    }
    const graphScope = completeGraphTaskScopeOf(cassette)
    if (graphScope._tag === "Invalid") return graphScope.issue
    const acceptedResults = completeGraphAcceptedResultsOf(expected, graphScope.taskIds)
    if (acceptedResults._tag === "Invalid") return acceptedResults.issue
    if (!plannedAttemptsHaveOneTask(expected.orchestration)) {
      return "complete graph delivery requires one distinct planned attempt for every graph task"
    }
    const runCoordinator = Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.RunCoordinator)(cassette.story[1])
    return completeDeliveryEvidenceIssue(
      cassette,
      expected.orchestration,
      acceptedResults.results,
      runCoordinator.integrationTarget
    )
  }
)

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

const executorLossProjectionOffset = 2
const lostExecutorResponsesRequireExplicitProjection = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) =>
    cassette.story.every((item, index) => {
      if (item._tag !== "PlannedAttemptExecutorResponseLost") return true
      const projection = cassette.story[index + executorLossProjectionOffset]
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
  const expectedSteps = ["Read:Active", "Replace", "Read:Completion", "Delete"]
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
    return JSON.stringify(actualSteps) !== JSON.stringify(expectedSteps)
  })?.[0]
  return incompleteTaskId === undefined
    ? undefined
    : `authored completion finality for ${incompleteTaskId} must read Active, replace, read Completion, and delete exactly once in order`
})

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
const heldStopOffset = 11
const heldExecutorOutcomeOffset = 12

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

const exactHeldStopAt = (
  story: AuthoredStory,
  holdIndex: number,
  hold: AdmittedContinuationHold,
  specification: typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type
): boolean => {
  const stop = story[holdIndex + heldStopOffset]
  return (
    stop?._tag === "OperatorStopsAttempt" &&
    stop.attemptId === hold.attemptId &&
    stop.taskId === hold.taskId &&
    stop.expected._tag === "Applied" &&
    stop.expected.status === "AwaitingQuiescence" &&
    stop.observedTaskRevision === makeTaskWorkSpecification(specification).fingerprint
  )
}

const exactHeldExecutorOutcomeAt = (story: AuthoredStory, holdIndex: number, attemptId: AttemptId): boolean => {
  const outcome = story[holdIndex + heldExecutorOutcomeOffset]
  return (
    (outcome?._tag === "PlannedAttemptExecutorResponseLost" ||
      outcome?._tag === "PlannedAttemptExecutorWorkReported") &&
    outcome.request === "StartOrContinue" &&
    outcome.report.attemptId === attemptId
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
  if (!exactHeldStopAt(story, holdIndex, hold, specification)) {
    return "the admitted continuation hold must be followed by the matching applied Stop request"
  }
  if (!exactHeldExecutorOutcomeAt(story, holdIndex, hold.attemptId)) {
    return "the admitted continuation hold must close with the exact StartOrContinue boundary outcome"
  }
  return undefined
}

const admittedContinuationHoldHasExactStopClosure = Schema.makeFilter(
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

export const AuthoredScenarioCassette = AuthoredScenarioCassetteShape.check(
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
  .check(completeGraphDeliveryHasExactEvidence)
  .check(coordinatorLifecycleBoundariesHaveFollowingActivationWork)
  .check(finalTrackerReadClosesCurrentActivation)
  .check(ambiguousBoundaryLossesImmediatelyCrash)
  .check(lostExecutorResponsesRequireExplicitProjection)
  .check(completionFinalityStoryIsComplete)
  .check(admittedContinuationHoldHasExactStopClosure)
export type AuthoredScenarioCassette = typeof AuthoredScenarioCassette.Type
