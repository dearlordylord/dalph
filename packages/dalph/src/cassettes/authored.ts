import { Effect, Layer, Ref, Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  RunId,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { ControlledFakeExecutorStep, makeControlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  ClaimOwner,
  ActiveTaskClaim,
  controlledTrackerMutationLayerFrom,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  type JournalRecord,
  JournalStore,
  journaledFreshRunRecoveryActivationLayer,
  journaledWorkflowInterpreterLayer,
  makeLiveWorkflowInterpreterLayer,
  makeTaskWorkSpecification,
  memoryJournalStoreLayer,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  runWorkflow,
  TaskLifecycle,
  TaskWorkCapacity,
  AuthoritativeTaskWorktreeReady,
  GitWorktree,
  gitWorktreeTestLayer,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  runGitWorktreeReconciliation,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  TrackerRevision,
  TrackerTarget,
  type TraceItem,
  WorkflowInterpreter,
  WorkflowTrace
} from "@dalph/orchestrator"

const AuthoredTrackerTask = Schema.Struct({
  id: TaskId,
  lifecycle: TaskLifecycle,
  parentTaskId: Schema.NullOr(TaskId),
  prerequisiteIds: Schema.Array(TaskId)
})

/** Provider-neutral tracker facts a domain specialist can read and author. */
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

const AuthoredJournalOccurrenceTag = Schema.Literals([
  "ControlCommandRecorded",
  "PlannedAttemptExecutorWorkReported",
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  "TaskAttemptPlanned",
  "TaskClaimAcquired",
  "TaskClaimAcquisitionIntended",
  "TaskTrackerFactsObserved",
  "TaskTrackerReadIntentRecorded",
  "TaskWorktreeReady",
  "TaskWorktreeReconciliationIntended"
])

/** Visible production outcomes and explicitly forbidden journal results. */
export const AuthoredVisibleBehaviorExpectation = Schema.Struct({
  forbiddenJournalOccurrenceTags: Schema.Array(AuthoredJournalOccurrenceTag),
  journalHistory: Schema.Literal("ValidWorkflowJournalHistory"),
  plannedAttemptExecutorReports: Schema.Array(PlannedAttemptExecutorReport)
})
export type AuthoredVisibleBehaviorExpectation = typeof AuthoredVisibleBehaviorExpectation.Type

export const AuthoredVisibleBehavior = Schema.Struct({
  journalHistory: Schema.Literals(["InvalidWorkflowJournalHistory", "ValidWorkflowJournalHistory"]),
  journalOccurrenceTags: Schema.Array(AuthoredJournalOccurrenceTag),
  plannedAttemptExecutorReports: Schema.Array(PlannedAttemptExecutorReport)
})
export type AuthoredVisibleBehavior = typeof AuthoredVisibleBehavior.Type

const authoredScenarioCassetteVersion = 1 as const

const AuthoredScenarioCassetteShape = Schema.TaggedStruct("AuthoredScenarioCassette", {
  actorCommands: Schema.Tuple([AuthoredCassetteCommand]),
  expectedDecisions: Schema.Array(AuthoredCassetteDecision),
  expectedVisibleBehavior: AuthoredVisibleBehaviorExpectation,
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

export class AuthoredCassetteVisibleBehaviorMismatch extends Schema.TaggedErrorClass<AuthoredCassetteVisibleBehaviorMismatch>()(
  "AuthoredCassetteVisibleBehaviorMismatch",
  { actual: AuthoredVisibleBehavior, expected: AuthoredVisibleBehaviorExpectation }
) {}

const trackerReadFailure = (detail: string) =>
  new TrackerAdapterReadError({
    context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
    detail,
    reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
  })

const controlledTrackerGraphReaderLayer = (outsideOccurrences: ReadonlyArray<AuthoredOutsideOccurrence>) =>
  Layer.effect(
    TrackerGraphReader,
    Effect.gen(function* () {
      const graphReturns = yield* Ref.make(
        outsideOccurrences.flatMap((occurrence) =>
          occurrence._tag === "TrackerGraphReadReturned" ? [occurrence.graph] : []
        )
      )
      const specificationReturns = yield* Ref.make(
        outsideOccurrences.flatMap((occurrence) =>
          occurrence._tag === "TaskWorkSpecificationReadReturned" ? [occurrence] : []
        )
      )
      return TrackerGraphReader.of({
        read: Effect.fn("ScenarioCassette.TrackerGraphReader.read")(function* () {
          const graph = yield* Ref.modify(graphReturns, (remaining) => [remaining[0], remaining.slice(1)] as const)
          if (graph === undefined) {
            return yield* trackerReadFailure("authored cassette has no tracker graph return for this logical read")
          }
          const projection = projectTrackerSnapshot(graph)
          return projection._tag === "Valid"
            ? projection.snapshot
            : yield* trackerReadFailure(
                `authored cassette tracker graph is invalid: ${projection.issues.map(({ _tag }) => _tag).join(", ")}`
              )
        }),
        readTaskWorkSpecification: Effect.fn("ScenarioCassette.TrackerGraphReader.readTaskWorkSpecification")(
          function* (_target, taskId) {
            const specification = yield* Ref.modify(
              specificationReturns,
              (remaining) => [remaining[0], remaining.slice(1)] as const
            )
            if (specification === undefined) {
              return yield* trackerReadFailure(`authored cassette has no task-work specification return for ${taskId}`)
            }
            if (specification.taskId !== taskId) {
              return yield* trackerReadFailure(
                `authored cassette returned task-work specification ${specification.taskId} for ${taskId}`
              )
            }
            return makeTaskWorkSpecification(specification)
          }
        )
      })
    })
  )

const executorSteps = (
  outsideOccurrences: ReadonlyArray<AuthoredOutsideOccurrence>
): ReadonlyArray<ControlledFakeExecutorStep> =>
  outsideOccurrences.flatMap((occurrence) => {
    if (occurrence._tag !== "PlannedAttemptExecutorWorkReported") return []
    const fields = { correlation: occurrence.report.correlation, report: occurrence.report }
    const step: ControlledFakeExecutorStep =
      occurrence.request === "StartOrContinue"
        ? ControlledFakeExecutorStep.cases.StartOrContinue.make(fields)
        : ControlledFakeExecutorStep.cases.Suspend.make(fields)
    return [step]
  })

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

const visibleBehaviorMatches = (
  expected: AuthoredVisibleBehaviorExpectation,
  actual: AuthoredVisibleBehavior
): boolean =>
  expected.journalHistory === actual.journalHistory &&
  JSON.stringify(
    Schema.encodeUnknownSync(Schema.Array(PlannedAttemptExecutorReport))(expected.plannedAttemptExecutorReports)
  ) ===
    JSON.stringify(
      Schema.encodeUnknownSync(Schema.Array(PlannedAttemptExecutorReport))(actual.plannedAttemptExecutorReports)
    ) &&
  expected.forbiddenJournalOccurrenceTags.every((tag) => !actual.journalOccurrenceTags.includes(tag))

export interface AuthoredScenarioCassetteRun {
  readonly cassette: AuthoredScenarioCassette
  readonly decisions: ReadonlyArray<AuthoredCassetteDecision>
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly records: ReadonlyArray<JournalRecord>
  readonly visibleBehavior: AuthoredVisibleBehavior
}

/** Decodes and drives one authored cassette through the production workflow loop. */
export const runAuthoredScenarioCassette = Effect.fn("ScenarioCassette.runAuthored")(function* (input: unknown) {
  const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette, { onExcessProperty: "error" })(input)
  const command = cassette.actorCommands[0]

  const traceItems = yield* Ref.make<ReadonlyArray<TraceItem>>([])
  const trace = WorkflowTrace.of({
    emit: Effect.fn("ScenarioCassette.WorkflowTrace.emit")(function* (item) {
      yield* Ref.update(traceItems, (current) => [...current, item])
    })
  })
  const journalLayer = memoryJournalStoreLayer
  const trackerLayer = controlledTrackerGraphReaderLayer(cassette.outsideOccurrences)
  const liveInterpreterLayer = makeLiveWorkflowInterpreterLayer("DeterministicTest").pipe(
    Layer.provide(Layer.merge(trackerLayer, controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims)))
  )
  const gitWorktreeLayer = gitWorktreeTestLayer(cassette.startingFacts.worktreeObservation)
  const authoritativeInterpreterLayer = Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const gitWorktree = yield* GitWorktree
      return WorkflowInterpreter.of({
        ...interpreter,
        reconcileTaskWorktree: (operation) =>
          runGitWorktreeReconciliation(gitWorktree, operation.plannedAttempt).pipe(
            Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
          )
      })
    })
  ).pipe(Layer.provide(liveInterpreterLayer), Layer.provide(gitWorktreeLayer))
  const interpreterLayer = journaledWorkflowInterpreterLayer(command.runId, authoritativeInterpreterLayer)
  const executorLayer = makeControlledFakePlannedAttemptExecutorLayer(executorSteps(cassette.outsideOccurrences))
  const recoveryLayer = journaledFreshRunRecoveryActivationLayer.pipe(Layer.provide(executorLayer))
  const workflowLayer = Layer.mergeAll(
    interpreterLayer,
    recoveryLayer,
    deterministicOperationIdAllocatorLayer(`cassette:${command.runId}:operation`),
    deterministicTaskClaimAcquisitionPlannerLayer({ owner: command.claimOwner, tokenPrefix: command.claimTokenPrefix }),
    deterministicPlannedTaskAttemptLayer({
      baseSha: command.baseSha,
      executor: command.executor,
      runId: command.runId,
      worktreeRoot: command.worktreeRoot
    })
  ).pipe(Layer.provideMerge(journalLayer))

  const records = yield* Effect.gen(function* () {
    yield* runWorkflow(command.target, command.capacity).pipe(Effect.provideService(WorkflowTrace, trace))
    return yield* (yield* JournalStore).read(command.runId)
  }).pipe(Effect.provide(workflowLayer))
  const decisions = (yield* Ref.get(traceItems)).flatMap(decisionFromTraceItem)
  if (!decisionsMatch(cassette.expectedDecisions, decisions)) {
    return yield* new AuthoredCassetteDecisionMismatch({ actual: decisions, expected: cassette.expectedDecisions })
  }
  const history = reduceWorkflowJournalHistory(command.runId, records)
  const visibleBehavior = AuthoredVisibleBehavior.make({
    journalHistory: history._tag,
    journalOccurrenceTags: records.map(({ event }) => event._tag),
    plannedAttemptExecutorReports: records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report] : []
    )
  })
  if (!visibleBehaviorMatches(cassette.expectedVisibleBehavior, visibleBehavior)) {
    return yield* new AuthoredCassetteVisibleBehaviorMismatch({
      actual: visibleBehavior,
      expected: cassette.expectedVisibleBehavior
    })
  }
  return { cassette, decisions, history, records, visibleBehavior } satisfies AuthoredScenarioCassetteRun
})

const lyricForOutsideOccurrence = (occurrence: AuthoredOutsideOccurrence): string => {
  switch (occurrence._tag) {
    case "PlannedAttemptExecutorWorkReported":
      return `The controlled executor will report ${occurrence.report._tag} for attempt ${occurrence.report.correlation.attemptId}.`
    case "TaskWorkSpecificationEditedWithoutDalphObservation":
      return `Another person edits task ${occurrence.taskId}, but Dalph never observes that edit.`
    case "TaskWorkSpecificationReadReturned":
      return `The task tracker returns "${occurrence.title}" for task ${occurrence.taskId}.`
    case "TrackerGraphReadReturned":
      return `The task tracker returns ${occurrence.graph.tasks.length} task graph facts at ${occurrence.graph.revision}.`
  }
}

/** Readable authored scenario prose rendered from the decoded machine contract. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [
    `Scenario: ${cassette.name}.`,
    `The maintainer starts run ${cassette.actorCommands[0].runId}.`,
    `The task tracker starts with ${cassette.startingFacts.taskClaims.length} active claims.`,
    `Git starts with ${cassette.startingFacts.worktreeObservation._tag}.`,
    `Executor work starts with ${cassette.startingFacts.executorWork}, and the journal starts ${cassette.startingFacts.journal}.`,
    `The expected journal result is ${cassette.expectedVisibleBehavior.journalHistory}.`,
    ...cassette.expectedVisibleBehavior.forbiddenJournalOccurrenceTags.map(
      (tag) => `The journal must not contain ${tag}.`
    ),
    ...cassette.outsideOccurrences.map(lyricForOutsideOccurrence)
  ].join("\n")
