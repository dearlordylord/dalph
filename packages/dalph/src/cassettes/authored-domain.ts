import { Effect, Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  IntegrationTarget,
  PlannedAttemptExecutorResult,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ControlDirection,
  InitialControlPolicy,
  IntegrationCandidateGitObservation,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  TaskLifecycle,
  TaskWorkCapacity,
  TaskClaimObservation,
  TaskClaimReacquisitionRequestId,
  TargetLineageObservation,
  TrackerRevision,
  TrackerTarget
} from "@dalph/orchestrator"

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
  PlannedAttemptExecutorWorkReported: {
    attemptId: AttemptId,
    report: Schema.Literals(["Running", "SafelySuspended", "TerminalAccepted", "TerminalCompleted", "TerminalFailed"])
  },
  PlannedAttemptExecutorWorkResponsibilityBegan: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredOrchestrationEvidence = typeof AuthoredOrchestrationEvidence.Type

/** Optional evidence from the claim, attempt-planning, and worktree protocol. */
export const AuthoredProtocolEvidence = Schema.TaggedUnion({
  AttemptWorktreeLost: { attemptId: AttemptId, taskId: TaskId },
  CompatibleTargetAdvance: { plannedBaseSha: GitCommitSha, targetHeadSha: GitCommitSha, taskId: TaskId },
  ControlDirectionApplied: {
    direction: ControlDirection,
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
  },
  IncompatibleTargetRewrite: { plannedBaseSha: GitCommitSha, targetHeadSha: GitCommitSha, taskId: TaskId },
  TaskAttemptPlanned: { attemptId: AttemptId, taskId: TaskId },
  TaskClaimAcquired: { taskId: TaskId },
  TaskClaimReleased: { taskId: TaskId },
  TaskClaimObserved: { claimState: Schema.Literals(["Exact", "Foreign", "Missing"]), taskId: TaskId },
  TaskClaimReadExhausted: { taskId: TaskId },
  TaskClaimReacquisitionDirected: { requestId: TaskClaimReacquisitionRequestId, taskId: TaskId },
  TaskWorktreeReady: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredProtocolEvidence = typeof AuthoredProtocolEvidence.Type

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
  worktreeRoot: WorktreeLocator
}

/**
 * One chronological authored story. Schema version 1 is provisional until the
 * project owner explicitly removes this comment; adding tags does not imply a
 * released compatibility promise.
 */
export const AuthoredCassetteStoryItem = Schema.TaggedUnion({
  /** Harness lifecycle: dispose one coordinator and its same-process fake without journaling an occurrence. */
  CoordinatorProcessDies: {},
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
  InitialControlPolicy: { policy: InitialControlPolicy },
  PlannedAttemptExecutorWorkReported: {
    report: AuthoredPlannedAttemptExecutorReport,
    request: Schema.Literals(["StartOrContinue", "Suspend"])
  },
  OperatorAppliesControlDirection: {
    direction: ControlDirection,
    subject: Schema.TaggedUnion({ Run: {}, Task: { taskId: TaskId } })
  },
  OperatorDirectsTaskClaimReacquisition: { requestId: TaskClaimReacquisitionRequestId, taskId: TaskId },
  RunCoordinator: RunCoordinatorFields,
  SetTaskExecutionCapacity: { capacity: TaskWorkCapacity },
  TaskWorkSpecificationReadReturned: AuthoredTaskWorkSpecification.fields,
  TaskClaimReadFailed: { reason: Schema.Literal("Unreadable"), taskId: TaskId },
  TaskClaimCurrentReadReturned: { taskId: TaskId },
  TaskClaimReadReturned: { observation: TaskClaimObservation },
  TrackerGraphReadFailed: { reason: Schema.Literal("IncompleteSnapshot") },
  TrackerGraphReadReturned: { graph: AuthoredTrackerGraph }
})
export type AuthoredCassetteStoryItem = typeof AuthoredCassetteStoryItem.Type

export const AuthoredTrackerGraphReadResult = Schema.Union([
  AuthoredCassetteStoryItem.cases.TrackerGraphReadFailed,
  AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned
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
    "OperatorDirectsTaskClaimReacquisition",
    "RunCoordinator",
    "SetTaskExecutionCapacity"
  ],
  CassetteLifecycle: ["CoordinatorProcessDies"],
  DalphOperationTrace: ["DalphSelects"],
  Git: ["GitWorktreeObservationChanged"],
  IntegrationCandidateConstruction: [
    "IntegrationCandidateAgentReported",
    "IntegrationCandidateGitValidationFailed",
    "IntegrationCandidateGitValidationReturned"
  ],
  PlannedAttemptExecutor: ["PlannedAttemptExecutorWorkReported"],
  TaskTracker: [
    "TaskClaimReadFailed",
    "TaskClaimCurrentReadReturned",
    "TaskClaimReadReturned",
    "TaskWorkSpecificationReadReturned",
    "TrackerGraphReadFailed",
    "TrackerGraphReadReturned"
  ],
  TerminalAssertion: ["ExpectedBehavior"]
})

export class AuthoredCassetteStoryItemOwnerContradiction extends Schema.TaggedErrorClass<AuthoredCassetteStoryItemOwnerContradiction>()(
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
    : "authored starting facts must agree with their first controlled returns and name claims/specifications once"
})

const behaviorAssertionsAreConsistent = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  cassette.story
    .flatMap((item) => (item._tag === "ExpectedBehavior" ? [expectedBehaviorIssue(item)] : []))
    .find((issue) => issue !== undefined)
)

const coordinatorDiesAtMostOnce = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  cassette.story.filter((item) => item._tag === "CoordinatorProcessDies").length <= 1
    ? undefined
    : "one authored cassette may dispose its coordinator process at most once"
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
  .check(coordinatorDiesAtMostOnce)
export type AuthoredScenarioCassette = typeof AuthoredScenarioCassette.Type
