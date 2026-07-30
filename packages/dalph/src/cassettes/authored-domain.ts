import { Effect, Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorResult,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  InitialControlPolicy,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  TaskLifecycle,
  TaskWorkCapacity,
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
  ReadTaskWorkSpecification: { taskId: TaskId },
  ReadTrackerGraph: { target: TrackerTarget },
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

/** Cassette-only observed outcomes; these values are neither journal events nor provider inputs. */
export const AuthoredObservedOutcome = Schema.TaggedUnion({
  ExecutorReported: {
    attemptId: AttemptId,
    report: Schema.Literals(["Running", "SafelySuspended", "TerminalCompleted", "TerminalFailed"])
  },
  TaskAttemptPrepared: { attemptId: AttemptId, taskId: TaskId },
  TaskClaimed: { taskId: TaskId },
  TaskWorktreeReady: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredObservedOutcome = typeof AuthoredObservedOutcome.Type

const RunCoordinatorFields = {
  baseSha: GitCommitSha,
  claimOwner: ClaimOwner,
  claimTokenPrefix: Schema.NonEmptyString,
  executor: TaskExecutorLocator,
  target: TrackerTarget,
  worktreeRoot: WorktreeLocator
}

/**
 * One chronological authored story. Schema version 1 is provisional until the
 * project owner explicitly removes this comment; adding tags does not imply a
 * released compatibility promise.
 */
export const AuthoredCassetteStoryItem = Schema.TaggedUnion({
  DalphSelects: { operation: AuthoredCassetteDecision },
  /** The complete ordered projection of cassette-visible outcomes, plus explicit forbidden outcomes. */
  ExpectedObservedOutcomes: {
    expected: Schema.Array(AuthoredObservedOutcome),
    forbidden: Schema.Array(AuthoredObservedOutcome)
  },
  InitialControlPolicy: { policy: InitialControlPolicy },
  PlannedAttemptExecutorWorkReported: {
    report: AuthoredPlannedAttemptExecutorReport,
    request: Schema.Literals(["StartOrContinue", "Suspend"])
  },
  RunCoordinator: RunCoordinatorFields,
  SetTaskExecutionCapacity: { capacity: TaskWorkCapacity },
  TaskWorkSpecificationReadReturned: AuthoredTaskWorkSpecification.fields,
  TrackerGraphReadReturned: { graph: AuthoredTrackerGraph }
})
export type AuthoredCassetteStoryItem = typeof AuthoredCassetteStoryItem.Type

const defineStoryItemOwners = <
  const Registrations extends Readonly<Record<string, ReadonlyArray<AuthoredCassetteStoryItem["_tag"]>>>
>(
  registrations: AuthoredCassetteStoryItem["_tag"] extends Registrations[keyof Registrations][number]
    ? Registrations
    : never
): Registrations => registrations

export const authoredCassetteStoryItemOwners = defineStoryItemOwners({
  CassetteControl: ["InitialControlPolicy", "RunCoordinator", "SetTaskExecutionCapacity"],
  DalphOperationTrace: ["DalphSelects"],
  PlannedAttemptExecutor: ["PlannedAttemptExecutorWorkReported"],
  TaskTracker: ["TaskWorkSpecificationReadReturned", "TrackerGraphReadReturned"],
  TerminalAssertion: ["ExpectedObservedOutcomes"]
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

const observedOutcomeKey = (outcome: AuthoredObservedOutcome): string =>
  JSON.stringify(Schema.encodeUnknownSync(AuthoredObservedOutcome)(outcome))

const outcomeAssertionsAreConsistent = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) => {
  const assertions = cassette.story.find((item) => item._tag === "ExpectedObservedOutcomes")
  if (assertions?._tag !== "ExpectedObservedOutcomes") return undefined
  const expected = assertions.expected.map(observedOutcomeKey)
  const forbidden = assertions.forbidden.map(observedOutcomeKey)
  return new Set(expected).size !== expected.length
    ? "each expected observed outcome must be asserted once"
    : new Set(forbidden).size !== forbidden.length
      ? "each forbidden observed outcome must be asserted once"
      : expected.some((outcome) => forbidden.includes(outcome))
        ? "one observed outcome cannot be both expected and forbidden"
        : undefined
})

export const AuthoredScenarioCassette = AuthoredScenarioCassetteShape.check(
  exactlyOneAt("InitialControlPolicy", () => 0, "one InitialControlPolicy must be the first story item")
)
  .check(exactlyOneAt("RunCoordinator", () => 1, "one RunCoordinator must follow InitialControlPolicy"))
  .check(
    exactlyOneAt(
      "ExpectedObservedOutcomes",
      (length) => length - 1,
      "one expected-and-forbidden observed-outcome group must be the terminal story item"
    )
  )
  .check(startingFactsAreConsistent)
  .check(outcomeAssertionsAreConsistent)
export type AuthoredScenarioCassette = typeof AuthoredScenarioCassette.Type
