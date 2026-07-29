/* eslint-disable max-lines -- The authored Schema, its single story cursor, controlled boundaries, and runner form one protocol owner. */
import { Effect, Layer, Option, Ref, Schema } from "effect"
import {
  AttemptId,
  ControlledFakeExecutorMismatch,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedTaskAttempt,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  AuthoritativeTaskWorktreeReady,
  ClaimOwner,
  controlledTrackerMutationLayerFrom,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  freshWorkflowRunId,
  GitWorktree,
  gitWorktreeTestLayer,
  InitialControlPolicy,
  type JournalRecord,
  JournalStore,
  journaledFreshRunRecoveryActivationLayer,
  journaledWorkflowInterpreterLayer,
  makeLiveWorkflowInterpreterLayer,
  makeTaskWorkSpecification,
  memoryJournalStoreLayer,
  PlannedBranchReady,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  runGitWorktreeReconciliation,
  runWorkflow,
  TaskLifecycle,
  TaskWorkCapacity,
  TraceOutputError,
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

/** Cassette-only domain outcomes; these values are neither journal events nor provider inputs. */
export const AuthoredTerminalOutcome = Schema.TaggedUnion({
  ExecutorReported: {
    attemptId: AttemptId,
    report: Schema.Literals(["Running", "SafelySuspended", "TerminalCompleted", "TerminalFailed"])
  },
  TaskAttemptPrepared: { attemptId: AttemptId, taskId: TaskId },
  TaskClaimed: { taskId: TaskId },
  TaskWorktreeReady: { attemptId: AttemptId, taskId: TaskId }
})
export type AuthoredTerminalOutcome = typeof AuthoredTerminalOutcome.Type

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
  DalphSelects: { action: AuthoredCassetteDecision },
  ExpectedTerminalOutcomes: {
    expected: Schema.Array(AuthoredTerminalOutcome),
    forbidden: Schema.Array(AuthoredTerminalOutcome)
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

export const authoredCassetteStoryItemOwners = {
  CassetteControl: ["InitialControlPolicy", "RunCoordinator", "SetTaskExecutionCapacity"],
  DalphActionTrace: ["DalphSelects"],
  PlannedAttemptExecutor: ["PlannedAttemptExecutorWorkReported"],
  TaskTracker: ["TaskWorkSpecificationReadReturned", "TrackerGraphReadReturned"],
  TerminalAssertion: ["ExpectedTerminalOutcomes"]
} as const

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

export const AuthoredScenarioCassette = AuthoredScenarioCassetteShape.check(
  exactlyOneAt("InitialControlPolicy", () => 0, "one InitialControlPolicy must be the first story item")
)
  .check(exactlyOneAt("RunCoordinator", () => 1, "one RunCoordinator must follow InitialControlPolicy"))
  .check(
    exactlyOneAt(
      "ExpectedTerminalOutcomes",
      (length) => length - 1,
      "one expected-and-forbidden outcome group must be the terminal story item"
    )
  )
  .check(startingFactsAreConsistent)
export type AuthoredScenarioCassette = typeof AuthoredScenarioCassette.Type

export class AuthoredCassetteInteractionMismatch extends Schema.TaggedErrorClass<AuthoredCassetteInteractionMismatch>()(
  "AuthoredCassetteInteractionMismatch",
  { actual: Schema.String, expected: Schema.String, storyPosition: Schema.Int }
) {}

export class UnsupportedAuthoredCapacityChange extends Schema.TaggedErrorClass<UnsupportedAuthoredCapacityChange>()(
  "UnsupportedAuthoredCapacityChange",
  { storyPosition: Schema.Int }
) {}

export class AuthoredCassetteOutcomeMismatch extends Schema.TaggedErrorClass<AuthoredCassetteOutcomeMismatch>()(
  "AuthoredCassetteOutcomeMismatch",
  { actual: Schema.Array(AuthoredTerminalOutcome), expected: Schema.Array(AuthoredTerminalOutcome) }
) {}

interface StoryCursor {
  readonly consumeDalphSelection: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type,
    AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange
  >
  readonly consumeExecutorReport: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.Type,
    AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange
  >
  readonly consumeInitialPolicy: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.InitialControlPolicy.Type,
    AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange
  >
  readonly consumeRunCoordinator: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.RunCoordinator.Type,
    AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange
  >
  readonly consumeTaskWorkSpecification: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type,
    AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange
  >
  readonly consumeTerminalAssertions: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.ExpectedTerminalOutcomes.Type,
    AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange
  >
  readonly consumeTrackerGraph: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned.Type,
    AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange
  >
  readonly position: Effect.Effect<number>
}

const makeStoryCursor = Effect.fn("AuthoredCassette.makeStoryCursor")(function* (
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): Effect.fn.Return<StoryCursor> {
  const position = yield* Ref.make(0)
  const consume = (tag: AuthoredCassetteStoryItem["_tag"]) =>
    Effect.gen(function* () {
      const index = yield* Ref.get(position)
      const item = story[index]
      if (item?._tag === "SetTaskExecutionCapacity") {
        return yield* new UnsupportedAuthoredCapacityChange({ storyPosition: index })
      }
      if (item?._tag !== tag) {
        return yield* new AuthoredCassetteInteractionMismatch({
          actual: tag,
          /* v8 ignore next -- The terminal assertion item keeps a decoded story non-empty until execution ends. */
          expected: item?._tag ?? "EndOfStory",
          storyPosition: index
        })
      }
      yield* Ref.set(position, index + 1)
      return item
    })
  const consumeDalphSelection = consume("DalphSelects").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.DalphSelects)(item).pipe(Effect.orDie)
    )
  )
  const consumeExecutorReport = consume("PlannedAttemptExecutorWorkReported").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeInitialPolicy = consume("InitialControlPolicy").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.InitialControlPolicy)(item).pipe(Effect.orDie)
    )
  )
  const consumeRunCoordinator = consume("RunCoordinator").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.RunCoordinator)(item).pipe(Effect.orDie)
    )
  )
  const consumeTaskWorkSpecification = consume("TaskWorkSpecificationReadReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeTerminalAssertions = consume("ExpectedTerminalOutcomes").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.ExpectedTerminalOutcomes)(item).pipe(Effect.orDie)
    )
  )
  const consumeTrackerGraph = consume("TrackerGraphReadReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned)(item).pipe(Effect.orDie)
    )
  )
  return {
    consumeDalphSelection,
    consumeExecutorReport,
    consumeInitialPolicy,
    consumeRunCoordinator,
    consumeTaskWorkSpecification,
    consumeTerminalAssertions,
    consumeTrackerGraph,
    position: Ref.get(position)
  }
})

const trackerReadFailure = (detail: string) =>
  new TrackerAdapterReadError({
    context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
    detail,
    reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
  })

const controlledTrackerGraphReaderLayer = (cursor: StoryCursor) =>
  Layer.succeed(
    TrackerGraphReader,
    TrackerGraphReader.of({
      read: Effect.fn("AuthoredCassette.TrackerGraphReader.read")(function* () {
        const item = yield* cursor.consumeTrackerGraph.pipe(
          Effect.mapError((failure) => trackerReadFailure(`${failure._tag} at story position ${failure.storyPosition}`))
        )
        const projection = projectTrackerSnapshot(item.graph)
        return projection._tag === "Valid"
          ? projection.snapshot
          : yield* trackerReadFailure(
              `authored cassette tracker graph is invalid: ${projection.issues.map(({ _tag }) => _tag).join(", ")}`
            )
      }),
      readTaskWorkSpecification: Effect.fn("AuthoredCassette.TrackerGraphReader.readTaskWorkSpecification")(
        function* (_target, taskId) {
          const item = yield* cursor.consumeTaskWorkSpecification.pipe(
            Effect.mapError((failure) =>
              trackerReadFailure(`${failure._tag} at story position ${failure.storyPosition}`)
            )
          )
          if (item.taskId !== taskId) {
            return yield* trackerReadFailure(
              `authored cassette returned task-work specification ${item.taskId} for ${taskId}`
            )
          }
          return makeTaskWorkSpecification(item)
        }
      )
    })
  )

const actualDecision = (item: TraceItem): AuthoredCassetteDecision | undefined => {
  if (item._tag !== "OperationSelected") return undefined
  switch (item.operation._tag) {
    case "AcquireTaskClaim":
      return AuthoredCassetteDecision.cases.AcquireTaskClaim.make({ taskId: item.operation.acquisition.taskId })
    case "ReadTaskWorkSpecification":
      return AuthoredCassetteDecision.cases.ReadTaskWorkSpecification.make({ taskId: item.operation.taskId })
    case "ReadTrackerGraph":
      return AuthoredCassetteDecision.cases.ReadTrackerGraph.make({ target: item.operation.target })
    case "ReconcileTaskWorktree":
      return AuthoredCassetteDecision.cases.ReconcileTaskWorktree.make({
        attemptId: item.operation.plannedAttempt.attemptId,
        taskId: item.operation.plannedAttempt.taskId
      })
    case "RecordTaskAttemptPlan":
      return AuthoredCassetteDecision.cases.RecordTaskAttemptPlan.make({
        attemptId: item.operation.plannedAttempt.attemptId,
        taskId: item.operation.plannedAttempt.taskId
      })
  }
}

const encodedDecision = (decision: AuthoredCassetteDecision): string =>
  JSON.stringify(Schema.encodeUnknownSync(AuthoredCassetteDecision)(decision))

const controlledTrace = (cursor: StoryCursor) =>
  WorkflowTrace.of({
    emit: Effect.fn("AuthoredCassette.WorkflowTrace.emit")(function* (item) {
      const actual = actualDecision(item)
      if (actual === undefined) return
      const expected = yield* cursor.consumeDalphSelection.pipe(
        Effect.mapError(
          (failure) => new TraceOutputError({ detail: `${failure._tag} at story position ${failure.storyPosition}` })
        )
      )
      if (encodedDecision(actual) !== encodedDecision(expected.action)) {
        return yield* new TraceOutputError({
          detail: `expected ${encodedDecision(expected.action)}, received ${encodedDecision(actual)}`
        })
      }
    })
  })

const executorReport = (
  item: Extract<AuthoredCassetteStoryItem, { readonly _tag: "PlannedAttemptExecutorWorkReported" }>,
  runId: ReturnType<typeof freshWorkflowRunId>
): PlannedAttemptExecutorReport => {
  const correlation = { attemptId: item.report.attemptId, runId }
  switch (item.report._tag) {
    case "Running":
      return PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    case "SafelySuspended":
      return PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    case "Terminal":
      return PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: item.report.result })
  }
}

const controlledExecutorLayer = (cursor: StoryCursor, runId: ReturnType<typeof freshWorkflowRunId>) =>
  Layer.effect(
    PlannedAttemptExecutor,
    Effect.gen(function* () {
      const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
      const consume = Effect.fn("AuthoredCassette.PlannedAttemptExecutor.consume")(function* (
        request: "StartOrContinue" | "Suspend",
        plannedAttempt: PlannedTaskAttempt
      ) {
        const item = yield* cursor.consumeExecutorReport.pipe(
          Effect.mapError(
            (failure) =>
              new ControlledFakeExecutorMismatch({
                detail: `${failure._tag} at story position ${failure.storyPosition}`
              })
          )
        )
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        if (item.request !== request || item.report.attemptId !== correlation.attemptId) {
          return yield* new ControlledFakeExecutorMismatch({
            detail: `authored executor expected ${item.request} for ${item.report.attemptId}, received ${request} for ${correlation.attemptId}`
          })
        }
        const report = executorReport(item, runId)
        yield* Ref.update(
          reports,
          (current) => new Map([...current, [plannedAttemptExecutorCorrelationKey(correlation), report]])
        )
        return report
      })
      return PlannedAttemptExecutor.of({
        /* v8 ignore next -- The maintained singleton does not reconstruct an independently surviving executor report. */
        project: (correlation) =>
          Ref.get(reports).pipe(
            Effect.map((current) =>
              Option.fromUndefinedOr(current.get(plannedAttemptExecutorCorrelationKey(correlation)))
            )
          ),
        /* v8 ignore next -- Live Pause/Suspend production behavior is outside issue 170's maintained singleton. */
        requestSuspension: (plannedAttempt) => consume("Suspend", plannedAttempt),
        startOrContinue: (plannedAttempt) => consume("StartOrContinue", plannedAttempt)
      })
    })
  )

const reportOutcome = (
  report: PlannedAttemptExecutorReport
): Extract<AuthoredTerminalOutcome, { readonly _tag: "ExecutorReported" }> => ({
  _tag: "ExecutorReported",
  attemptId: report.correlation.attemptId,
  report:
    report._tag === "Terminal"
      ? report.result._tag === "Completed"
        ? "TerminalCompleted"
        : "TerminalFailed"
      : report._tag
})

const worktreeOutcome = (
  event: Extract<JournalRecord["event"], { readonly _tag: "TaskWorktreeReady" }>,
  worktreeAttemptByOperation: ReadonlyMap<string, { readonly attemptId: AttemptId; readonly taskId: TaskId }>
): ReadonlyArray<AuthoredTerminalOutcome> => {
  const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(worktreeAttemptByOperation.get(event.operationId)))
  return [{ _tag: "TaskWorktreeReady", attemptId: plannedAttempt.attemptId, taskId: plannedAttempt.taskId }]
}

const observedOutcomeFor = (
  event: JournalRecord["event"],
  worktreeAttemptByOperation: ReadonlyMap<string, { readonly attemptId: AttemptId; readonly taskId: TaskId }>
): ReadonlyArray<AuthoredTerminalOutcome> => {
  if (event._tag === "TaskClaimAcquired") return [{ _tag: "TaskClaimed", taskId: event.claim.taskId }]
  if (event._tag === "TaskAttemptPlanned") {
    return [
      {
        _tag: "TaskAttemptPrepared",
        attemptId: event.operation.plannedAttempt.attemptId,
        taskId: event.operation.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "TaskWorktreeReady") return worktreeOutcome(event, worktreeAttemptByOperation)
  if (event._tag === "PlannedAttemptExecutorWorkReported") {
    return [reportOutcome(event.report)]
  }
  return []
}

const observedOutcomes = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<AuthoredTerminalOutcome> => {
  const worktreeAttemptByOperation = new Map(
    records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReconciliationIntended"
        ? [[event.operation.operationId, event.operation.plannedAttempt] as const]
        : []
    )
  )
  return records.flatMap(({ event }) => observedOutcomeFor(event, worktreeAttemptByOperation))
}

const encodedOutcomes = (outcomes: ReadonlyArray<AuthoredTerminalOutcome>): string =>
  JSON.stringify(Schema.encodeUnknownSync(Schema.Array(AuthoredTerminalOutcome))(outcomes))

export interface AuthoredScenarioCassetteRun {
  readonly cassette: AuthoredScenarioCassette
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: ReturnType<typeof freshWorkflowRunId>
  readonly terminalOutcomes: ReadonlyArray<AuthoredTerminalOutcome>
}

/** Decodes and drives one story through the production coordinator activation program. */
export const runAuthoredScenarioCassette = Effect.fn("AuthoredCassette.run")(function* (input: unknown) {
  const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette, { onExcessProperty: "error" })(input)
  yield* Effect.forEach(cassette.story, (item) => assertExactlyOneAuthoredCassetteStoryItemOwner(item._tag), {
    discard: true
  })
  const cursor = yield* makeStoryCursor(cassette.story)
  const initial = yield* cursor.consumeInitialPolicy
  const command = yield* cursor.consumeRunCoordinator
  const runId = freshWorkflowRunId(command.target)
  const trace = controlledTrace(cursor)
  const journalLayer = memoryJournalStoreLayer
  const trackerLayer = controlledTrackerGraphReaderLayer(cursor)
  const liveInterpreterLayer = makeLiveWorkflowInterpreterLayer("DeterministicTest").pipe(
    Layer.provide(Layer.merge(trackerLayer, controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims)))
  )
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
  ).pipe(
    Layer.provide(liveInterpreterLayer),
    Layer.provide(gitWorktreeTestLayer(cassette.startingFacts.worktreeObservation))
  )
  const executorLayer = controlledExecutorLayer(cursor, runId)
  const workflowLayer = Layer.mergeAll(
    journaledWorkflowInterpreterLayer(runId, authoritativeInterpreterLayer),
    journaledFreshRunRecoveryActivationLayer.pipe(Layer.provide(executorLayer)),
    deterministicOperationIdAllocatorLayer(`cassette:${runId}:operation`),
    deterministicTaskClaimAcquisitionPlannerLayer({ owner: command.claimOwner, tokenPrefix: command.claimTokenPrefix }),
    deterministicPlannedTaskAttemptLayer({
      baseSha: command.baseSha,
      executor: command.executor,
      runId,
      worktreeRoot: command.worktreeRoot
    })
  ).pipe(Layer.provideMerge(journalLayer))

  const records = yield* Effect.gen(function* () {
    yield* runWorkflow(command.target, initial.policy).pipe(Effect.provideService(WorkflowTrace, trace))
    return yield* (yield* JournalStore).read(runId)
  }).pipe(Effect.provide(workflowLayer))
  const assertions = yield* cursor.consumeTerminalAssertions
  const terminalOutcomes = observedOutcomes(records)
  if (
    encodedOutcomes(assertions.expected) !== encodedOutcomes(terminalOutcomes) ||
    assertions.forbidden.some((forbidden) =>
      terminalOutcomes.some((actual) => encodedOutcomes([actual]) === encodedOutcomes([forbidden]))
    )
  ) {
    return yield* new AuthoredCassetteOutcomeMismatch({ actual: terminalOutcomes, expected: assertions.expected })
  }
  return {
    cassette,
    history: reduceWorkflowJournalHistory(runId, records),
    records,
    runId,
    terminalOutcomes
  } satisfies AuthoredScenarioCassetteRun
})

const storyLyric = (item: AuthoredCassetteStoryItem): string =>
  item._tag === "InitialControlPolicy"
    ? `Dalph starts with task-execution capacity ${item.policy.taskExecutionCapacity}.`
    : item._tag === "RunCoordinator"
      ? `The maintainer asks Dalph to coordinate ${JSON.stringify(item.target)}.`
      : item._tag === "DalphSelects"
        ? `Dalph selects ${item.action._tag}.`
        : item._tag === "TrackerGraphReadReturned"
          ? `The task tracker returns ${item.graph.tasks.length} task graph facts at ${item.graph.revision}.`
          : item._tag === "TaskWorkSpecificationReadReturned"
            ? `The task tracker returns "${item.title}" for task ${item.taskId}.`
            : item._tag === "PlannedAttemptExecutorWorkReported"
              ? `The controlled executor reports ${item.report._tag} for attempt ${item.report.attemptId}.`
              : item._tag === "ExpectedTerminalOutcomes"
                ? `The story requires ${item.expected.length} outcomes and forbids ${item.forbidden.length}.`
                : `The unsupported story asks Dalph to change task-execution capacity to ${item.capacity}.`

/** Readable prose is derived from structured story items and is never parsed. */
export const renderAuthoredCassetteLyrics = (cassette: AuthoredScenarioCassette): string =>
  [`Scenario: ${cassette.name}.`, ...cassette.story.map(storyLyric)].join("\n")
