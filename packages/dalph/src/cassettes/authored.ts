import { Effect, Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  RunId,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  type JournalRecord,
  reduceWorkflowJournalHistory,
  TaskWorkCapacity,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  TrackerTarget,
  type TraceItem
} from "@dalph/orchestrator"
import {
  AuthoredCassetteOutcomeAssertionMismatch,
  AuthoredExpectedOutcomeAssertion,
  AuthoredForbiddenOutcomeAssertion,
  AuthoredTrackerGraph,
  expectedOutcomeIsSatisfied,
  forbiddenOutcomeIsViolated,
  lyricForExpectedOutcome,
  lyricForForbiddenOutcome
} from "./authored-outcomes.js"
import { lyricForExpectedDecision, lyricForLifecycleEvent, lyricForOutsideOccurrence } from "./authored-lyrics.js"
import { runAuthoredCassetteActivations } from "./authored-activations.js"

export {
  AuthoredCassetteOutcomeAssertionMismatch,
  AuthoredExpectedOutcomeAssertion,
  AuthoredForbiddenOutcomeAssertion,
  AuthoredTrackerGraph
}

export const AuthoredTaskWorkSpecification = Schema.Struct({
  body: Schema.String,
  taskId: TaskId,
  title: Schema.NonEmptyString
})
export type AuthoredTaskWorkSpecification = typeof AuthoredTaskWorkSpecification.Type

export const AuthoredCassetteCommand = Schema.TaggedUnion({
  RunCoordinator: {
    baseSha: GitCommitSha,
    capacity: TaskWorkCapacity,
    claimOwner: ClaimOwner,
    claimTokenPrefix: Schema.NonEmptyString,
    executor: TaskExecutorLocator,
    runId: RunId,
    target: TrackerTarget,
    worktreeRoot: WorktreeLocator
  }
})
export type AuthoredCassetteCommand = typeof AuthoredCassetteCommand.Type

/**
 * Controlled outside happenings include exact provider returns and happenings
 * Dalph may never observe. Executor entries expose only attempt correlation and
 * coarse attempt-level reports.
 */
export const AuthoredOutsideOccurrence = Schema.TaggedUnion({
  PlannedAttemptExecutorWorkReported: {
    report: PlannedAttemptExecutorReport,
    request: Schema.Literals(["StartOrContinue", "Suspend"])
  },
  TaskWorkSpecificationEditedWithoutDalphObservation: {
    body: Schema.String,
    taskId: TaskId,
    title: Schema.NonEmptyString
  },
  TaskWorkSpecificationReadReturned: { body: Schema.String, taskId: TaskId, title: Schema.NonEmptyString },
  TrackerGraphReadReturned: { graph: AuthoredTrackerGraph }
})
export type AuthoredOutsideOccurrence = typeof AuthoredOutsideOccurrence.Type

export const AuthoredCassetteDecision = Schema.TaggedUnion({
  AcquireTaskClaim: { taskId: TaskId },
  ReadTaskWorkSpecification: { taskId: TaskId },
  ReadTrackerGraph: { target: TrackerTarget },
  ReconcileTaskWorktree: { attemptId: AttemptId, taskId: TaskId },
  RecordTaskAttemptPlan: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredCassetteDecision = typeof AuthoredCassetteDecision.Type

/**
 * Harness-controlled coordinator lifetime changes are authored story facts,
 * never workflow-journal events.
 */
export const AuthoredCassetteLifecycleEvent = Schema.TaggedUnion({ CoordinatorProcessDies: {} })
export type AuthoredCassetteLifecycleEvent = typeof AuthoredCassetteLifecycleEvent.Type

const AuthoredCassetteLifecycleEvents = Schema.Array(AuthoredCassetteLifecycleEvent).check(
  Schema.makeFilter((events) =>
    events.length <= 1 ? undefined : "an authored cassette supports at most one coordinator-death checkpoint"
  )
)

// Provisional while cassettes have no users; remove versioning before the first supported format.
const authoredScenarioCassetteVersion = 1 as const

const AuthoredScenarioCassetteShape = Schema.TaggedStruct("AuthoredScenarioCassette", {
  actorCommands: Schema.Tuple([AuthoredCassetteCommand]),
  expectedDecisions: Schema.Array(AuthoredCassetteDecision),
  expectedOutcomes: Schema.Array(AuthoredExpectedOutcomeAssertion),
  forbiddenOutcomes: Schema.Array(AuthoredForbiddenOutcomeAssertion),
  lifecycleEvents: AuthoredCassetteLifecycleEvents,
  name: Schema.NonEmptyString,
  outsideOccurrences: Schema.Array(AuthoredOutsideOccurrence),
  schemaVersion: Schema.Literal(authoredScenarioCassetteVersion),
  startingFacts: Schema.Struct({
    executorWork: Schema.Literal("NoPriorReport"),
    journal: Schema.Literal("Empty"),
    taskClaims: Schema.Array(ActiveTaskClaim),
    taskWorkSpecifications: Schema.Array(AuthoredTaskWorkSpecification),
    trackerGraph: AuthoredTrackerGraph,
    worktreeObservation: Schema.Union([PlannedBranchReady, PlannedWorktreeAbsent, PlannedWorktreeReady])
  })
})

const startingGraphMatchesFirstReturn = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) => {
  const firstGraph = cassette.outsideOccurrences.find((occurrence) => occurrence._tag === "TrackerGraphReadReturned")
  return firstGraph?._tag === "TrackerGraphReadReturned" &&
    JSON.stringify(firstGraph.graph) === JSON.stringify(cassette.startingFacts.trackerGraph)
    ? undefined
    : "the first controlled tracker return must expose the authored starting graph"
})

const startingSpecificationTaskIdsAreUnique = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) =>
    new Set(cassette.startingFacts.taskWorkSpecifications.map(({ taskId }) => taskId)).size ===
    cassette.startingFacts.taskWorkSpecifications.length
      ? undefined
      : "authored starting task-work specifications must name each task at most once"
)

const startingClaimTaskIdsAreUnique = Schema.makeFilter((cassette: typeof AuthoredScenarioCassetteShape.Type) =>
  new Set(cassette.startingFacts.taskClaims.map(({ taskId }) => taskId)).size ===
  cassette.startingFacts.taskClaims.length
    ? undefined
    : "authored starting task claims must name each task at most once"
)

const isTaskWorkSpecificationReturn = (
  occurrence: AuthoredOutsideOccurrence
): occurrence is Extract<AuthoredOutsideOccurrence, { readonly _tag: "TaskWorkSpecificationReadReturned" }> =>
  occurrence._tag === "TaskWorkSpecificationReadReturned"

const firstReturnedSpecificationsMatchStartingFacts = Schema.makeFilter(
  (cassette: typeof AuthoredScenarioCassetteShape.Type) => {
    const specificationReturns = cassette.outsideOccurrences.filter(isTaskWorkSpecificationReturn)
    const firstReturns = specificationReturns.filter(
      (occurrence, index, occurrences) =>
        occurrences.findIndex((candidate) => candidate.taskId === occurrence.taskId) === index
    )
    const mismatch = firstReturns.find((occurrence) => {
      const startingSpecification = cassette.startingFacts.taskWorkSpecifications.find(
        ({ taskId }) => taskId === occurrence.taskId
      )
      return (
        startingSpecification === undefined ||
        JSON.stringify(startingSpecification) !==
          JSON.stringify({ body: occurrence.body, taskId: occurrence.taskId, title: occurrence.title })
      )
    })
    return mismatch?._tag === "TaskWorkSpecificationReadReturned"
      ? `the first task-work specification return for ${mismatch.taskId} must expose its authored starting facts`
      : undefined
  }
)

export const AuthoredScenarioCassette = AuthoredScenarioCassetteShape.check(startingGraphMatchesFirstReturn)
  .check(startingSpecificationTaskIdsAreUnique)
  .check(startingClaimTaskIdsAreUnique)
  .check(firstReturnedSpecificationsMatchStartingFacts)
export type AuthoredScenarioCassette = typeof AuthoredScenarioCassette.Type

export class AuthoredCassetteDecisionMismatch extends Schema.TaggedErrorClass<AuthoredCassetteDecisionMismatch>()(
  "AuthoredCassetteDecisionMismatch",
  { actual: Schema.Array(AuthoredCassetteDecision), expected: Schema.Array(AuthoredCassetteDecision) }
) {}

const decisionFromTraceItem = (item: TraceItem): ReadonlyArray<AuthoredCassetteDecision> => {
  if (item._tag !== "OperationSelected") return []
  const operation = item.operation
  switch (operation._tag) {
    case "AcquireTaskClaim":
      return [AuthoredCassetteDecision.cases.AcquireTaskClaim.make({ taskId: operation.acquisition.taskId })]
    case "ReadTaskWorkSpecification":
      return [AuthoredCassetteDecision.cases.ReadTaskWorkSpecification.make({ taskId: operation.taskId })]
    case "ReadTrackerGraph":
      return [AuthoredCassetteDecision.cases.ReadTrackerGraph.make({ target: operation.target })]
    case "ReconcileTaskWorktree":
      return [
        AuthoredCassetteDecision.cases.ReconcileTaskWorktree.make({
          attemptId: operation.plannedAttempt.attemptId,
          taskId: operation.plannedAttempt.taskId
        })
      ]
    case "RecordTaskAttemptPlan":
      return [
        AuthoredCassetteDecision.cases.RecordTaskAttemptPlan.make({
          attemptId: operation.plannedAttempt.attemptId,
          taskId: operation.plannedAttempt.taskId
        })
      ]
  }
}

const decisionsMatch = (
  expected: ReadonlyArray<AuthoredCassetteDecision>,
  actual: ReadonlyArray<AuthoredCassetteDecision>
): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(Schema.Array(AuthoredCassetteDecision))(expected)) ===
  JSON.stringify(Schema.encodeUnknownSync(Schema.Array(AuthoredCassetteDecision))(actual))

export interface AuthoredScenarioCassetteRun {
  readonly cassette: AuthoredScenarioCassette
  readonly decisions: ReadonlyArray<AuthoredCassetteDecision>
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly records: ReadonlyArray<JournalRecord>
  readonly activationKinds: ReadonlyArray<"Fresh" | "StartupRecovery">
  readonly completedLifecycleEvents: ReadonlyArray<AuthoredCassetteLifecycleEvent>
  readonly recoveryAuthorityVerifiedAttemptIds: ReadonlyArray<AttemptId>
  readonly verifiedExpectedOutcomes: ReadonlyArray<AuthoredExpectedOutcomeAssertion>
  readonly verifiedForbiddenOutcomes: ReadonlyArray<AuthoredForbiddenOutcomeAssertion>
}

/** Decodes and drives one authored cassette through the production workflow loop. */
export const runAuthoredScenarioCassette = Effect.fn("ScenarioCassette.runAuthored")(function* (input: unknown) {
  const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette, { onExcessProperty: "error" })(input)
  const command = cassette.actorCommands[0]
  const activationRun = yield* runAuthoredCassetteActivations(cassette)
  const records = activationRun.records
  const observedTraceItems = activationRun.traceItems
  const decisions = observedTraceItems.flatMap(decisionFromTraceItem)
  if (!decisionsMatch(cassette.expectedDecisions, decisions)) {
    return yield* new AuthoredCassetteDecisionMismatch({ actual: decisions, expected: cassette.expectedDecisions })
  }
  const history = reduceWorkflowJournalHistory(command.runId, records)
  const evidence = {
    historyIsValid: history._tag === "ValidWorkflowJournalHistory",
    records,
    traceItems: observedTraceItems
  }
  const unsatisfiedExpectedOutcomes = cassette.expectedOutcomes.filter(
    (assertion) => !expectedOutcomeIsSatisfied(assertion, evidence)
  )
  const violatedForbiddenOutcomes = cassette.forbiddenOutcomes.filter((assertion) =>
    forbiddenOutcomeIsViolated(assertion, evidence)
  )
  if (unsatisfiedExpectedOutcomes.length > 0 || violatedForbiddenOutcomes.length > 0) {
    return yield* new AuthoredCassetteOutcomeAssertionMismatch({
      unsatisfiedExpectedOutcomes,
      violatedForbiddenOutcomes
    })
  }
  return {
    cassette,
    activationKinds: activationRun.activationKinds,
    completedLifecycleEvents: activationRun.completedLifecycleEvents,
    decisions,
    history,
    records,
    recoveryAuthorityVerifiedAttemptIds: activationRun.recoveryAuthorityVerifiedAttemptIds,
    verifiedExpectedOutcomes: cassette.expectedOutcomes,
    verifiedForbiddenOutcomes: cassette.forbiddenOutcomes
  } satisfies AuthoredScenarioCassetteRun
})

/** Readable authored scenario prose rendered from the decoded machine contract. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [
    `Scenario: ${cassette.name}.`,
    `The maintainer starts run ${cassette.actorCommands[0].runId}.`,
    `The task tracker starts with ${cassette.startingFacts.taskClaims.length} active claims.`,
    `Git starts with ${cassette.startingFacts.worktreeObservation._tag}.`,
    `Executor work starts with ${cassette.startingFacts.executorWork}, and the journal starts ${cassette.startingFacts.journal}.`,
    ...cassette.expectedDecisions.map(lyricForExpectedDecision),
    ...cassette.expectedOutcomes.map(lyricForExpectedOutcome),
    ...cassette.forbiddenOutcomes.map(lyricForForbiddenOutcome),
    ...cassette.lifecycleEvents.map(lyricForLifecycleEvent),
    ...cassette.outsideOccurrences.map(lyricForOutsideOccurrence)
  ].join("\n")
