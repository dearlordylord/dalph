import { it as effectIt } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref, Schema } from "effect"
import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "vitest"
import { AttemptId, GitCommitSha, GitRepositoryLocator, RunId, TaskId } from "@dalph/contracts"
import {
  ApplicationExiting,
  initialRunPolicyRevision,
  InRunJournalRunMismatch,
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalHistoryInvalid,
  type JournaledRunBootstrap,
  JournaledRunIdentityMismatch,
  JournaledRunNotActive,
  JournalPartitionContradiction,
  JournalPosition,
  JournalPositionGap,
  JournalRecordKey,
  JournalRecordMismatch,
  JournalSchemaIncompatible,
  JournalSchemaVersion,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalStoreContradiction,
  RunControlPolicy,
  RunPolicyRevision,
  SetTaskWorkCapacityRequest,
  TaskWorkCapacityPolicyRevisionConflict,
  TaskWorkCapacity,
  WorkflowRunAlreadyTerminated,
  WorkflowRunNotBegan
} from "@dalph/orchestrator"
import {
  AuthoredCassetteStoryItem,
  CassetteIdentityRenaming,
  compareRecordedCassetteCheckpoints,
  foldRecordedCassette,
  maintainedAuthoredCassetteCatalog,
  projectRecordedCassette,
  RecordedCassette,
  renderAuthoredCassetteLyrics,
  renderRecordedCassetteLyrics,
  renameRecordedCassette,
  runAuthoredScenarioCassette,
  singletonTaskCompletesAuthoredCassette,
  type RecordedCassette as RecordedCassetteType,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"
import { makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
import { driveAuthoredTaskWorkCapacityChange } from "../../src/cassettes/authored-runner.js"
import {
  renderAuthoredStoryItemLandmark,
  renderAuthoredStoryItemLyric
} from "../../src/cassettes/authored-presentation.js"

const maintainedStoryItems = Object.values(maintainedAuthoredCassetteCatalog).flatMap(({ story }) => story)

const findStoryItemOf = <Tag extends AuthoredCassetteStoryItem["_tag"]>(tag: Tag) =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases[tag])(
    maintainedStoryItems.find((candidate) => candidate._tag === tag)
  )

const findStoryItem = findStoryItemOf

effectIt.effect("keeps authored process death unavailable before the production capacity result", () =>
  Effect.gen(function* () {
    const capacity = findStoryItem("SetTaskExecutionCapacity")
    const death = findStoryItem("CoordinatorProcessDies")
    const cursor = yield* makeStoryCursor([capacity, death])
    const productionStarted = yield* Deferred.make<void>()
    const productionResult = yield* Deferred.make<void>()
    const application = yield* Effect.gen(function* () {
      const reserved = yield* cursor.consumeCapacityChange
      expect(Option.isSome(reserved)).toBe(true)
      yield* Deferred.succeed(productionStarted, undefined)
      yield* Deferred.await(productionResult)
    }).pipe(Effect.forkChild)

    yield* Deferred.await(productionStarted)

    expect(yield* cursor.storyPosition).toBe(0)
    expect((yield* cursor.currentStoryItem)?._tag).toBe("SetTaskExecutionCapacity")
    yield* Fiber.interrupt(application)
  })
)

effectIt.effect("settles one production capacity revision before delayed interruption and process death", () =>
  Effect.gen(function* () {
    const publicationEntered = yield* Deferred.make<void>()
    const releasePublication = yield* Deferred.make<void>()
    const occurrenceCount = yield* Ref.make(0)
    const capacity = findStoryItem("SetTaskExecutionCapacity")
    const death = findStoryItem("CoordinatorProcessDies")
    const cursor = yield* makeStoryCursor([capacity, death], {
      onOccurrence: ({ item }) =>
        item._tag === "SetTaskExecutionCapacity"
          ? Ref.update(occurrenceCount, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(publicationEntered, undefined)),
              Effect.andThen(Deferred.await(releasePublication))
            )
          : Effect.void
    })
    const reserved = yield* cursor.consumeCapacityChange
    if (Option.isNone(reserved)) return yield* Effect.die("the exact capacity item was not reserved")

    const settlement = yield* cursor
      .settleCapacityChange(reserved.value)
      .pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(publicationEntered)
    const interruptionRequested = yield* Deferred.make<void>()
    const interruptionFinished = yield* Deferred.make<void>()
    const interrupted = yield* Deferred.succeed(interruptionRequested, undefined).pipe(
      Effect.andThen(Fiber.interrupt(settlement)),
      Effect.tap(() => Deferred.succeed(interruptionFinished, undefined)),
      Effect.forkScoped({ startImmediately: true })
    )
    yield* Deferred.await(interruptionRequested)
    const processDeathAttempted = yield* Deferred.make<void>()
    const processDeathFinished = yield* Deferred.make<void>()
    const processDeath = yield* Deferred.succeed(processDeathAttempted, undefined).pipe(
      Effect.andThen(cursor.pauseAtCoordinatorProcessDeath),
      Effect.exit,
      Effect.tap(() => Deferred.succeed(processDeathFinished, undefined)),
      Effect.forkScoped({ startImmediately: true })
    )
    yield* Deferred.await(processDeathAttempted)
    expect(yield* Deferred.isDone(interruptionFinished)).toBe(false)
    expect(yield* Deferred.isDone(processDeathFinished)).toBe(false)

    yield* Deferred.succeed(releasePublication, undefined)
    yield* Fiber.join(interrupted)
    expect(Exit.isFailure(yield* Fiber.await(settlement))).toBe(true)
    const deathExit = yield* Fiber.join(processDeath)
    expect(Exit.isFailure(deathExit)).toBe(true)
    if (Exit.isFailure(deathExit)) expect(Cause.hasDies(deathExit.cause)).toBe(true)
    expect(yield* Ref.get(occurrenceCount)).toBe(1)
    expect(yield* cursor.storyPosition).toBe(2)

    const duplicate = yield* cursor.settleCapacityChange(reserved.value).pipe(Effect.exit)
    expect(Exit.isFailure(duplicate)).toBe(true)
  })
)

const capacityTwo = AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.make({
  capacity: TaskWorkCapacity.make(2)
})
const processDeath = findStoryItem("CoordinatorProcessDies")
const initialCapacityPolicy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(3)
})
const revisedCapacityPolicy = RunControlPolicy.make({
  revision: RunPolicyRevision.make(2),
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})

effectIt.effect(
  "distinguishes pre-commit interruption from a committed lost capacity response using only the reduced policy",
  () =>
    Effect.gen(function* () {
      const runId = RunId.make("authored-capacity-settlement")

      const precommitCursor = yield* makeStoryCursor([capacityTwo, processDeath])
      const precommitApplyStarted = yield* Deferred.make<void>()
      const precommitReads = yield* Ref.make(0)
      const precommitApplies = yield* Ref.make(0)
      const precommit = yield* driveAuthoredTaskWorkCapacityChange({
        cursor: precommitCursor,
        operatorControl: {
          readTaskWorkCapacity: () =>
            Ref.update(precommitReads, (count) => count + 1).pipe(Effect.as(initialCapacityPolicy)),
          setTaskWorkCapacity: () =>
            Ref.update(precommitApplies, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(precommitApplyStarted, undefined)),
              Effect.andThen(Effect.never)
            )
        },
        runId
      }).pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Deferred.await(precommitApplyStarted)
      yield* Fiber.interrupt(precommit)

      expect(yield* precommitCursor.storyPosition).toBe(0)
      expect((yield* precommitCursor.currentStoryItem)?._tag).toBe("SetTaskExecutionCapacity")
      expect(yield* Ref.get(precommitReads)).toBe(1)
      expect(yield* Ref.get(precommitApplies)).toBe(1)

      const committedCursor = yield* makeStoryCursor([capacityTwo, processDeath])
      const committedPolicy = yield* Ref.make(initialCapacityPolicy)
      const committedReads = yield* Ref.make(0)
      const committedApplies = yield* Ref.make(0)
      const lostResponse = new JournalStorageUnavailable({
        detail: "capacity revision two committed before its response was lost",
        operation: "JournalStore.append"
      })
      const operatorControl = {
        readTaskWorkCapacity: () =>
          Ref.update(committedReads, (count) => count + 1).pipe(Effect.andThen(Ref.get(committedPolicy))),
        setTaskWorkCapacity: () =>
          Ref.update(committedApplies, (count) => count + 1).pipe(
            Effect.andThen(Ref.set(committedPolicy, revisedCapacityPolicy)),
            Effect.andThen(Effect.fail(lostResponse))
          )
      }

      expect(
        yield* driveAuthoredTaskWorkCapacityChange({ cursor: committedCursor, operatorControl, runId }).pipe(
          Effect.flip
        )
      ).toBe(lostResponse)
      expect(yield* committedCursor.storyPosition).toBe(0)
      expect(yield* Ref.get(committedPolicy)).toEqual(revisedCapacityPolicy)

      const reconciledCursor = yield* makeStoryCursor([capacityTwo, processDeath])
      yield* driveAuthoredTaskWorkCapacityChange({ cursor: reconciledCursor, operatorControl, runId })
      expect(yield* reconciledCursor.storyPosition).toBe(1)
      expect(yield* Ref.get(committedReads)).toBe(2)
      expect(yield* Ref.get(committedApplies)).toBe(1)
      expect(yield* Ref.get(committedPolicy)).toEqual(revisedCapacityPolicy)

      const deathExit = yield* reconciledCursor.pauseAtCoordinatorProcessDeath.pipe(Effect.exit)
      expect(Exit.isFailure(deathExit)).toBe(true)
      expect(yield* reconciledCursor.storyPosition).toBe(2)
    })
)

type CapacityOperatorControl = JournaledRunBootstrap["Service"]["operatorControl"]
type CapacityReadFailure =
  | Effect.Error<ReturnType<CapacityOperatorControl["readTaskWorkCapacity"]>>
  | JournaledRunIdentityMismatch
type CapacityApplyFailure =
  | Effect.Error<ReturnType<CapacityOperatorControl["setTaskWorkCapacity"]>>
  | JournaledRunIdentityMismatch
type FailureFixtures<Failure extends { readonly _tag: string }> = {
  readonly [Tag in Failure["_tag"]]: Extract<Failure, { readonly _tag: Tag }>
}

const capacityReadFailureFixtures = (runId: RunId): FailureFixtures<CapacityReadFailure> => {
  const foreignRunId = RunId.make("foreign-authored-capacity-failure-surface")
  const position = JournalPosition.make(1)
  const operation = "JournalStore.read" as const
  return {
    ApplicationExiting: new ApplicationExiting(),
    InRunJournalRunMismatch: new InRunJournalRunMismatch({ expectedRunId: runId, requestedRunId: foreignRunId }),
    InvalidWorkflowJournalHistory: { _tag: "InvalidWorkflowJournalHistory", issues: [], records: [], runId },
    JournalDataCorruption: new JournalDataCorruption({ detail: "invalid journal bytes", operation }),
    JournalHistoryCorruption: new JournalHistoryCorruption({
      detail: "invalid Run history",
      operation,
      partition: "Hot",
      runId
    }),
    JournalHistoryInvalid: new JournalHistoryInvalid({ detail: "invalid appended prefix", position, runId }),
    JournalPartitionContradiction: new JournalPartitionContradiction({ runId }),
    JournalPositionGap: new JournalPositionGap({ expectedPosition: position, position, runId }),
    JournalRecordMismatch: new JournalRecordMismatch({
      key: JournalRecordKey.make("capacity-fixture"),
      position,
      runId
    }),
    JournalSchemaIncompatible: new JournalSchemaIncompatible({
      found: JournalSchemaVersion.make(2),
      supported: JournalSchemaVersion.make(1)
    }),
    JournalStorageAccessDenied: new JournalStorageAccessDenied({ detail: "read denied", operation }),
    JournalStorageCapacityExhausted: new JournalStorageCapacityExhausted({
      detail: "read capacity exhausted",
      operation
    }),
    JournalStorageLocked: new JournalStorageLocked({ detail: "read locked", operation }),
    JournalStorageUnavailable: new JournalStorageUnavailable({ detail: "read unavailable", operation }),
    JournaledRunIdentityMismatch: new JournaledRunIdentityMismatch({
      expectedRunId: runId,
      requestedRunId: foreignRunId
    }),
    JournaledRunNotActive: new JournaledRunNotActive(),
    WorkflowRunNotBegan: new WorkflowRunNotBegan({ runId })
  }
}

const capacityApplyFailureFixtures = (
  runId: RunId,
  schemaError: Schema.SchemaError
): FailureFixtures<CapacityApplyFailure> => ({
  ...capacityReadFailureFixtures(runId),
  JournalStoreContradiction: new JournalStoreContradiction({
    existingPosition: JournalPosition.make(1),
    key: JournalRecordKey.make("capacity-fixture"),
    runId
  }),
  SchemaError: schemaError,
  TaskWorkCapacityPolicyRevisionConflict: new TaskWorkCapacityPolicyRevisionConflict({
    current: revisedCapacityPolicy,
    expectedRevision: initialRunPolicyRevision,
    runId
  }),
  WorkflowRunAlreadyTerminated: new WorkflowRunAlreadyTerminated({ runId, terminatedAt: JournalPosition.make(2) })
})

effectIt.effect("preserves every public capacity failure without advancing or retrying", () =>
  Effect.gen(function* () {
    const runId = RunId.make("authored-capacity-failure-surface")
    const schemaError = yield* Schema.decodeUnknownEffect(SetTaskWorkCapacityRequest)({}).pipe(Effect.flip)
    for (const [boundary, failures] of [
      ["read", Object.values(capacityReadFailureFixtures(runId))],
      ["apply", Object.values(capacityApplyFailureFixtures(runId, schemaError))]
    ] as const) {
      for (const failure of failures) {
        const cursor = yield* makeStoryCursor([capacityTwo, processDeath])
        const reads = yield* Ref.make(0)
        const applies = yield* Ref.make(0)
        const operatorControl = {
          readTaskWorkCapacity: () =>
            Ref.update(reads, (count) => count + 1).pipe(
              Effect.andThen(
                boundary === "read" ? Effect.fail(failure as never) : Effect.succeed(initialCapacityPolicy)
              )
            ),
          setTaskWorkCapacity: () =>
            Ref.update(applies, (count) => count + 1).pipe(Effect.andThen(Effect.fail(failure as never)))
        }

        expect(yield* driveAuthoredTaskWorkCapacityChange({ cursor, operatorControl, runId }).pipe(Effect.flip)).toBe(
          failure
        )
        expect(yield* cursor.storyPosition).toBe(0)
        expect((yield* cursor.currentStoryItem)?._tag).toBe("SetTaskExecutionCapacity")
        expect(yield* Ref.get(reads)).toBe(1)
        expect(yield* Ref.get(applies)).toBe(boundary === "read" ? 0 : 1)
      }
    }
  })
)

type WorkAuthorizationChronologyItem =
  | { readonly _tag: "CoordinatorProcessDies" }
  | { readonly _tag: "TaskWorkSpecificationReadSelected"; readonly taskId: TaskId }
  | {
      readonly _tag: "ExecutorReport"
      readonly attemptId: AttemptId
      readonly report: "ExecutorWorkExecuting" | "ExecutorWorkSafelySuspended" | "ExecutorWorkTerminal"
      readonly request: "Begin" | "Resume" | "Suspend"
    }

const projectWorkAuthorizationChronology = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): ReadonlyArray<WorkAuthorizationChronologyItem> =>
  story.flatMap((item): ReadonlyArray<WorkAuthorizationChronologyItem> => {
    if (item._tag === "CoordinatorProcessDies") return [{ _tag: item._tag }] as const
    if (item._tag === "DalphSelects" && item.operation._tag === "ReadTaskWorkSpecification") {
      return [{ _tag: "TaskWorkSpecificationReadSelected" as const, taskId: item.operation.taskId }]
    }
    if (item._tag === "PlannedAttemptExecutorWorkReported") {
      return [
        {
          _tag: "ExecutorReport" as const,
          attemptId: item.report.attemptId,
          report: item.report._tag,
          request: item.request
        }
      ]
    }
    return []
  })

it("authors distinct instruction-read chronology for fresh, safely suspended, and already-executing work", () => {
  expect(projectWorkAuthorizationChronology(maintainedAuthoredCassetteCatalog.singletonTaskCompletes.story)).toEqual([
    { _tag: "TaskWorkSpecificationReadSelected", taskId: "A" },
    { _tag: "ExecutorReport", attemptId: "attempt:A:0", report: "ExecutorWorkExecuting", request: "Begin" }
  ])

  expect(
    projectWorkAuthorizationChronology(maintainedAuthoredCassetteCatalog.runUnpauseAfterSafeSuspension.story)
  ).toEqual([
    { _tag: "TaskWorkSpecificationReadSelected", taskId: "A" },
    { _tag: "ExecutorReport", attemptId: "attempt:A:0", report: "ExecutorWorkExecuting", request: "Begin" },
    { _tag: "ExecutorReport", attemptId: "attempt:A:0", report: "ExecutorWorkSafelySuspended", request: "Suspend" },
    { _tag: "TaskWorkSpecificationReadSelected", taskId: "A" },
    { _tag: "ExecutorReport", attemptId: "attempt:A:0", report: "ExecutorWorkTerminal", request: "Resume" }
  ])

  expect(
    projectWorkAuthorizationChronology(maintainedAuthoredCassetteCatalog.compatibleTargetAdvanceContinues.story)
  ).toEqual([
    { _tag: "TaskWorkSpecificationReadSelected", taskId: "A" },
    { _tag: "ExecutorReport", attemptId: "attempt:A:0", report: "ExecutorWorkExecuting", request: "Begin" },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "ExecutorReport", attemptId: "attempt:A:0", report: "ExecutorWorkSafelySuspended", request: "Suspend" },
    { _tag: "TaskWorkSpecificationReadSelected", taskId: "A" },
    { _tag: "ExecutorReport", attemptId: "attempt:A:0", report: "ExecutorWorkTerminal", request: "Resume" }
  ])
})

type RestartAddedTaskChronologyItem =
  | { readonly _tag: "CoordinatorProcessDies" }
  | { readonly _tag: "ExistingAttemptAccepted"; readonly attemptId: AttemptId }
  | { readonly _tag: "RestartAddedAttemptRunning"; readonly attemptId: AttemptId }
  | { readonly _tag: "RestartAddedTaskClaimSelected"; readonly taskId: TaskId }
  | { readonly _tag: "RestartAddedTaskSpecificationSelected"; readonly taskId: TaskId }
  | { readonly _tag: "RestartAddedTaskPlanSelected"; readonly attemptId: AttemptId }
  | { readonly _tag: "RestartAddedTaskWorktreeSelected"; readonly attemptId: AttemptId }

const projectRestartAddedTaskChronology = (
  story: ReadonlyArray<AuthoredCassetteStoryItem>
): ReadonlyArray<RestartAddedTaskChronologyItem> =>
  story.flatMap((item): ReadonlyArray<RestartAddedTaskChronologyItem> => {
    if (item._tag === "CoordinatorProcessDies") return [{ _tag: item._tag }] as const
    if (
      item._tag === "PlannedAttemptExecutorProjectionReturned" &&
      item.report._tag === "ExecutorWorkTerminal" &&
      item.report.result._tag === "Accepted" &&
      (item.report.attemptId === "attempt:B:0" || item.report.attemptId === "attempt:C:1")
    ) {
      return [{ _tag: "ExistingAttemptAccepted" as const, attemptId: item.report.attemptId }]
    }
    if (
      item._tag === "PlannedAttemptExecutorWorkReported" &&
      item.report._tag === "ExecutorWorkTerminal" &&
      item.report.result._tag === "Accepted" &&
      (item.report.attemptId === "attempt:B:0" || item.report.attemptId === "attempt:C:1")
    ) {
      return [{ _tag: "ExistingAttemptAccepted" as const, attemptId: item.report.attemptId }]
    }
    if (
      item._tag === "PlannedAttemptExecutorWorkReported" &&
      item.report._tag === "ExecutorWorkExecuting" &&
      item.report.attemptId === "attempt:X:0"
    ) {
      return [{ _tag: "RestartAddedAttemptRunning" as const, attemptId: item.report.attemptId }]
    }
    if (item._tag !== "DalphSelects") return []
    const operation = item.operation
    if (operation._tag === "AcquireTaskClaim" && operation.taskId === "X") {
      return [{ _tag: "RestartAddedTaskClaimSelected" as const, taskId: operation.taskId }]
    }
    if (operation._tag === "ReadTaskWorkSpecification" && operation.taskId === "X") {
      return [{ _tag: "RestartAddedTaskSpecificationSelected" as const, taskId: operation.taskId }]
    }
    if (operation._tag === "RecordTaskAttemptPlan" && operation.taskId === "X") {
      return [{ _tag: "RestartAddedTaskPlanSelected" as const, attemptId: operation.attemptId }]
    }
    if (operation._tag === "ReconcileTaskWorktree" && operation.taskId === "X") {
      return [{ _tag: "RestartAddedTaskWorktreeSelected" as const, attemptId: operation.attemptId }]
    }
    return []
  })

it("authors restart-added X only after recovered capacity and its own focused specification", () => {
  expect(projectRestartAddedTaskChronology(maintainedAuthoredCassetteCatalog.deliveryInvariantStory.story)).toEqual([
    { _tag: "CoordinatorProcessDies" },
    { _tag: "ExistingAttemptAccepted", attemptId: "attempt:B:0" },
    { _tag: "ExistingAttemptAccepted", attemptId: "attempt:C:1" },
    { _tag: "RestartAddedTaskClaimSelected", taskId: "X" },
    { _tag: "RestartAddedTaskSpecificationSelected", taskId: "X" },
    { _tag: "RestartAddedTaskPlanSelected", attemptId: "attempt:X:0" },
    { _tag: "RestartAddedTaskWorktreeSelected", attemptId: "attempt:X:0" },
    { _tag: "RestartAddedAttemptRunning", attemptId: "attempt:X:0" }
  ])
})

it("renders every maintained authored story item through both public presentation seams", () => {
  const items = Object.values(maintainedAuthoredCassetteCatalog).flatMap(({ story }) => story)

  expect(items).not.toHaveLength(0)
  const lyrics = items.map(renderAuthoredStoryItemLyric)
  expect(lyrics.every((lyric) => typeof lyric === "string")).toBe(true)
  expect(items.map(renderAuthoredStoryItemLandmark).some((landmark) => landmark !== null)).toBe(true)
  for (const cassette of Object.values(maintainedAuthoredCassetteCatalog)) {
    expect(renderAuthoredCassetteLyrics(cassette)).toContain(`Scenario: ${cassette.name}.`)
  }
})

it("consumes the authored cursor's optional and terminal public probes", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const empty = yield* makeStoryCursor([])
      expect(Option.isNone(yield* empty.consumeCapacityChange)).toBe(true)
      expect(Option.isNone(yield* empty.consumeAttemptChoice)).toBe(true)
      expect(Option.isNone(yield* empty.consumeAttemptChoiceRace)).toBe(true)
      expect(Option.isNone(yield* empty.consumeExecutorProjectionFor(AttemptId.make("empty-projection")))).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseObservationStart)).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseProgressAwait)).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseProgressObserved)).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseProgressObservedCancelledAndReconnected)).toBe(true)
      expect(Option.isNone(yield* empty.consumeControlDirectionFailure)).toBe(true)
      expect(Option.isNone(yield* empty.consumeClaimReacquisitionDirection)).toBe(true)
      expect(Option.isNone(yield* empty.consumeTaskClaimReadFor(TaskId.make("empty-claim-read")))).toBe(true)
      expect(Option.isNone(yield* empty.consumeTaskClaimAcquisitionConflictReturned)).toBe(true)
      expect(Option.isNone(yield* empty.consumeTaskClaimReleaseResponseLost)).toBe(true)
      expect(Option.isNone(yield* empty.consumeGitWorktreeObservationChange)).toBe(true)
      expect(Option.isNone(yield* empty.consumeGitPlannedWorktreeCreateResponseLost)).toBe(true)
      expect(yield* empty.atTerminalAssertions).toBe(false)

      const expected = findStoryItem("ExpectedBehavior")
      const terminal = yield* makeStoryCursor([expected])
      expect(yield* terminal.atTerminalAssertions).toBe(true)
      expect((yield* terminal.consumeTerminalAssertions)._tag).toBe("ExpectedBehavior")

      const attemptChoice = yield* makeStoryCursor([findStoryItem("OperatorContinuesAttempt")])
      expect(Option.isSome(yield* attemptChoice.consumeAttemptChoice)).toBe(true)
      const race = yield* makeStoryCursor([findStoryItem("OperatorRacesContinueAndStop")])
      expect(Option.isSome(yield* race.consumeAttemptChoiceRace)).toBe(true)
      const projectionItem = findStoryItem("PlannedAttemptExecutorProjectionReturned")
      const projection = yield* makeStoryCursor([projectionItem])
      expect(Option.isSome(yield* projection.consumeExecutorProjectionFor(projectionItem.report.attemptId))).toBe(true)
      const pauseStart = yield* makeStoryCursor([findStoryItem("OperatorStartsPauseObservation")])
      expect(Option.isSome(yield* pauseStart.consumePauseObservationStart)).toBe(true)
      const maintainedPauseProgress = findStoryItem("PauseProgressObserved")
      const pauseAwait = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.OperatorAwaitsPauseProgress.make({
          result: maintainedPauseProgress.result,
          subject: maintainedPauseProgress.subject
        })
      ])
      expect(Option.isSome(yield* pauseAwait.consumePauseProgressAwait)).toBe(true)
      const pauseObserved = yield* makeStoryCursor([findStoryItem("PauseProgressObserved")])
      expect(Option.isSome(yield* pauseObserved.consumePauseProgressObserved)).toBe(true)
      const pauseReconnect = yield* makeStoryCursor([findStoryItem("PauseProgressObservedCancelledAndReconnected")])
      expect(Option.isSome(yield* pauseReconnect.consumePauseProgressObservedCancelledAndReconnected)).toBe(true)
      const controlFailure = yield* makeStoryCursor([findStoryItem("OperatorControlDirectionFailed")])
      expect(Option.isSome(yield* controlFailure.consumeControlDirectionFailure)).toBe(true)
      const reacquisition = yield* makeStoryCursor([findStoryItem("OperatorDirectsTaskClaimReacquisition")])
      expect(Option.isSome(yield* reacquisition.consumeClaimReacquisitionDirection)).toBe(true)
      const taskClaimReadItem = findStoryItem("TaskClaimReadFailed")
      const taskClaimRead = yield* makeStoryCursor([taskClaimReadItem])
      expect(Option.isSome(yield* taskClaimRead.consumeTaskClaimReadOverrideFor(taskClaimReadItem.taskId))).toBe(true)
      const conflict = yield* makeStoryCursor([findStoryItem("TaskClaimAcquisitionConflictReturned")])
      expect(Option.isSome(yield* conflict.consumeTaskClaimAcquisitionConflictReturned)).toBe(true)
      const releaseLost = yield* makeStoryCursor([findStoryItem("TaskClaimReleaseResponseLost")])
      expect(Option.isSome(yield* releaseLost.consumeTaskClaimReleaseResponseLost)).toBe(true)
      const worktree = yield* makeStoryCursor([findStoryItem("GitWorktreeObservationChanged")])
      expect(Option.isSome(yield* worktree.consumeGitWorktreeObservationChange)).toBe(true)
      const worktreeLost = yield* makeStoryCursor([findStoryItem("GitPlannedWorktreeCreateResponseLost")])
      expect(Option.isSome(yield* worktreeLost.consumeGitPlannedWorktreeCreateResponseLost)).toBe(true)

      const mismatch = yield* makeStoryCursor([expected])
      const mismatchExit = yield* Effect.exit(mismatch.consumeDalphSelection)
      expect(Exit.isFailure(mismatchExit)).toBe(true)
      const executorMismatch = yield* makeStoryCursor([expected])
      const executorMismatchExit = yield* Effect.exit(executorMismatch.consumeExecutorReport)
      expect(Exit.isFailure(executorMismatchExit)).toBe(true)

      const death = yield* makeStoryCursor([findStoryItem("CoordinatorProcessDies")])
      const deathExit = yield* Effect.exit(death.pauseAtCoordinatorProcessDeath)
      expect(Exit.isFailure(deathExit)).toBe(true)
      if (Exit.isFailure(deathExit)) {
        expect(Cause.hasDies(deathExit.cause)).toBe(true)
      }
    })
  )
})

it("keeps authored promotion Git, control, and executor outcomes correlated at the cursor boundary", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const promotionFailure = AuthoredCassetteStoryItem.cases.TargetPromotionGitReadFailed.make({
        candidateCommit: GitCommitSha.make("c".repeat(40)),
        detail: "Git became unreadable",
        repository: GitRepositoryLocator.make("fixture/promotion.git")
      })
      const promotionFailureCursor = yield* makeStoryCursor([promotionFailure])
      const promotionError = yield* promotionFailureCursor
        .consumeTargetPromotionGitRead(promotionFailure.repository, promotionFailure.candidateCommit)
        .pipe(Effect.flip)
      expect(promotionError._tag).toBe("AuthoredTargetPromotionGitReadFailure")

      const promotionReturned = findStoryItemOf("TargetPromotionGitReadReturned")
      const promotionReturnedCursor = yield* makeStoryCursor([promotionReturned])
      expect(
        (yield* promotionReturnedCursor.consumeTargetPromotionGitRead(
          promotionReturned.repository,
          promotionReturned.candidateCommit
        ))._tag
      ).toBe("TargetPromotionGitReadReturned")

      const compareAndSetLost = findStoryItemOf("TargetPromotionCompareAndSetResponseLost")
      const compareAndSetLostCursor = yield* makeStoryCursor([compareAndSetLost])
      const compareAndSetError = yield* compareAndSetLostCursor.consumeTargetPromotionCompareAndSet.pipe(Effect.flip)
      expect(compareAndSetError._tag).toBe("AuthoredTargetPromotionCompareAndSetFailure")
      const compareAndSetReturned = findStoryItemOf("TargetPromotionCompareAndSetReturned")
      const compareAndSetCursor = yield* makeStoryCursor([compareAndSetReturned])
      expect((yield* compareAndSetCursor.consumeTargetPromotionCompareAndSet)._tag).toBe(
        "TargetPromotionCompareAndSetReturned"
      )

      const initialPolicy = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.InitialControlPolicy.make({
          policy: { taskExecutionCapacity: TaskWorkCapacity.make(1) }
        })
      ])
      expect((yield* initialPolicy.consumeInitialPolicy)._tag).toBe("InitialControlPolicy")
      const coordinator = yield* makeStoryCursor([findStoryItem("RunCoordinator")])
      expect((yield* coordinator.consumeRunCoordinator)._tag).toBe("RunCoordinator")
      const activation = yield* makeStoryCursor([findStoryItem("CoordinatorActivationReturned")])
      expect((yield* activation.consumeCoordinatorActivationReturned)._tag).toBe("CoordinatorActivationReturned")
      const taskSpecification = yield* makeStoryCursor([findStoryItem("TaskWorkSpecificationReadReturned")])
      expect((yield* taskSpecification.consumeTaskWorkSpecification)._tag).toBe("TaskWorkSpecificationReadReturned")
      const rejected = yield* makeStoryCursor([findStoryItem("TaskClaimAcquisitionRejected")])
      expect((yield* rejected.consumeTaskClaimAcquisitionRejected)._tag).toBe("TaskClaimAcquisitionRejected")
      const selection = yield* makeStoryCursor([findStoryItem("DalphSelects")])
      expect((yield* selection.consumeDalphSelection)._tag).toBe("DalphSelects")
      const executor = yield* makeStoryCursor([findStoryItem("PlannedAttemptExecutorWorkReported")])
      expect((yield* executor.consumeExecutorReport)._tag).toBe("PlannedAttemptExecutorWorkReported")
      const tracker = yield* makeStoryCursor([findStoryItem("TrackerGraphReadReturned")])
      expect((yield* tracker.consumeTrackerGraph)._tag).toBe("TrackerGraphReadReturned")

      const ordinaryDirection = findStoryItemOf("OperatorAppliesControlDirection")
      const directionCursor = yield* makeStoryCursor([ordinaryDirection])
      expect(Option.isSome(yield* directionCursor.consumeControlDirection(ordinaryDirection))).toBe(true)
      const beforeAdmission = findStoryItemOf("OperatorAppliesControlDirectionBeforeDeliveryActionAdmission")
      const beforeAdmissionCursor = yield* makeStoryCursor([beforeAdmission])
      expect(Option.isSome(yield* beforeAdmissionCursor.consumeControlDirection(beforeAdmission))).toBe(true)
      yield* beforeAdmissionCursor.completeControlDirectionBeforeDeliveryActionAdmission
      const noMatchCursor = yield* makeStoryCursor([findStoryItem("ExpectedBehavior")])
      expect(Option.isNone(yield* noMatchCursor.consumeControlDirection(ordinaryDirection))).toBe(true)
      const inFlight = findStoryItemOf("OperatorAppliesControlDirectionWhileExecutorRequestInFlight")
      const inFlightCursor = yield* makeStoryCursor([inFlight])
      expect(Option.isSome(yield* inFlightCursor.consumeInFlightExecutorControlDirection())).toBe(true)
      const capacity = yield* makeStoryCursor([findStoryItem("SetTaskExecutionCapacity")])
      expect(Option.isSome(yield* capacity.consumeCapacityChange)).toBe(true)
      const publicationHoldItem = findStoryItem("DalphHoldsExecutorRequestThroughNextDeliveryPublication")
      const publicationHold = yield* makeStoryCursor([publicationHoldItem])
      expect(
        Option.isSome(
          yield* publicationHold.consumeExecutorRequestPublicationHold(
            publicationHoldItem.taskId,
            publicationHoldItem.attemptId,
            publicationHoldItem.request
          )
        )
      ).toBe(true)
    })
  )
})

it("correlates concurrent operation selections before advancing the authored story", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const concurrentSelections =
        maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries.story.filter(
          (item) =>
            item._tag === "DalphSelects" &&
            item.operation._tag === "ReadTaskWorkSpecification" &&
            (item.operation.taskId === "A" || item.operation.taskId === "C")
        )
      const cSelection = concurrentSelections.find(
        (item) =>
          item._tag === "DalphSelects" &&
          item.operation._tag === "ReadTaskWorkSpecification" &&
          item.operation.taskId === "C"
      )
      const aSelection = concurrentSelections.find(
        (item) =>
          item._tag === "DalphSelects" &&
          item.operation._tag === "ReadTaskWorkSpecification" &&
          item.operation.taskId === "A"
      )
      if (cSelection?._tag !== "DalphSelects" || aSelection?._tag !== "DalphSelects") {
        return yield* Effect.die("missing concurrent task-work specification selections")
      }
      const cursor = yield* makeStoryCursor([cSelection, aSelection])
      const arrivedFirst = yield* cursor.consumeDalphSelectionFor(aSelection.operation).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(yield* cursor.consumeDalphSelectionFor(cSelection.operation)).toEqual(cSelection)
      expect(yield* Fiber.join(arrivedFirst)).toEqual(aSelection)
    })
  )
})

it("correlates concurrent executor reports when the later request arrives first", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const reports = maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries.story.filter(
        (item) => item._tag === "PlannedAttemptExecutorWorkReported"
      )
      const first = reports[0]
      const second = reports.find((item) => first !== undefined && item.report.attemptId !== first.report.attemptId)
      if (first === undefined || second === undefined) {
        return yield* Effect.die("missing independently correlated executor reports")
      }
      const cursor = yield* makeStoryCursor([first, second])
      const laterRequest = yield* cursor
        .consumeExecutorReportFor(second.request, second.report.attemptId)
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(yield* cursor.consumeExecutorReportFor(first.request, first.report.attemptId)).toEqual(first)
      expect(yield* Fiber.join(laterRequest)).toEqual(second)
    })
  )
})

it("registers exact executor ownership after a sibling selection is already waiting", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const report = maintainedStoryItems.find((item) => item._tag === "PlannedAttemptExecutorWorkReported")
      const selection = maintainedStoryItems.find(
        (item) => item._tag === "DalphSelects" && item.operation._tag === "ReconcileTaskWorktree"
      )
      if (report?._tag !== "PlannedAttemptExecutorWorkReported" || selection?._tag !== "DalphSelects") {
        return yield* Effect.die("missing executor outcome and later worktree selection")
      }
      const cursor = yield* makeStoryCursor([report, selection])
      const waitingSelection = yield* cursor.consumeDalphSelectionFor(selection.operation).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      yield* cursor.beginExecutorReportRequest(report.request, report.report.attemptId)
      yield* Effect.yieldNow
      expect(waitingSelection.pollUnsafe()).toBeUndefined()

      expect(yield* cursor.consumeExecutorReportFor(report.request, report.report.attemptId)).toEqual(report)
      expect(yield* Fiber.join(waitingSelection)).toEqual(selection)
      yield* cursor.endExecutorReportRequest(report.request, report.report.attemptId)
    })
  )
})

it("retains a pre-registered executor owner after the registration window closes", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const reports = maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries.story.filter(
        (item) => item._tag === "PlannedAttemptExecutorWorkReported"
      )
      const first = reports[0]
      const second = reports.find((item) => first !== undefined && item.report.attemptId !== first.report.attemptId)
      if (first === undefined || second === undefined) {
        return yield* Effect.die("missing independently correlated executor reports")
      }
      const cursor = yield* makeStoryCursor([first, second])
      yield* cursor.beginExecutorReportRequest(first.request, first.report.attemptId)
      const waitingLaterReport = yield* cursor
        .consumeExecutorReportFor(second.request, second.report.attemptId)
        .pipe(Effect.forkChild)

      for (let turn = 0; turn < 16; turn += 1) yield* Effect.yieldNow
      expect(waitingLaterReport.pollUnsafe()).toBeUndefined()

      expect(yield* cursor.consumeExecutorReportFor(first.request, first.report.attemptId)).toEqual(first)
      expect(yield* Fiber.join(waitingLaterReport)).toEqual(second)
      yield* cursor.endExecutorReportRequest(first.request, first.report.attemptId)
    })
  )
})

it("fails closed when an exact selection has no permitted immediate predecessor owner", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const selections = maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries.story.filter(
        (item) =>
          item._tag === "DalphSelects" &&
          item.operation._tag === "ReadTaskWorkSpecification" &&
          (item.operation.taskId === "A" || item.operation.taskId === "C")
      )
      const first = selections.find(
        (item) =>
          item._tag === "DalphSelects" &&
          item.operation._tag === "ReadTaskWorkSpecification" &&
          item.operation.taskId === "C"
      )
      const second = selections.find(
        (item) =>
          item._tag === "DalphSelects" &&
          item.operation._tag === "ReadTaskWorkSpecification" &&
          item.operation.taskId === "A"
      )
      if (first?._tag !== "DalphSelects" || second?._tag !== "DalphSelects") {
        return yield* Effect.die("missing malformed selection fixtures")
      }
      const cursor = yield* makeStoryCursor([first, second])
      const exit = yield* Effect.exit(cursor.consumeDalphSelectionFor(second.operation))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("AuthoredCassetteInteractionMismatch")
    })
  )
})

it("fails closed when an executor publication hold has no matching request owner", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const cursor = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.make({
          attemptId: AttemptId.make("attempt:malformed-hold"),
          request: "Suspend",
          taskId: TaskId.make("A")
        })
      ])
      const wrongRequest = { request: "Begin" as const, attemptId: AttemptId.make("attempt:malformed-hold") }
      const exit = yield* Effect.acquireUseRelease(
        cursor.beginExecutorReportRequest(wrongRequest.request, wrongRequest.attemptId),
        () => Effect.exit(cursor.consumeDalphSelectionFor({ _tag: "ReadTaskClaim", taskId: TaskId.make("A") })),
        () => cursor.endExecutorReportRequest(wrongRequest.request, wrongRequest.attemptId)
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("AuthoredCassetteInteractionMismatch")
    })
  )
})

it("does not let a competing executor command consume a publication hold", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const taskId = TaskId.make("A")
      const attemptId = AttemptId.make("attempt:publication-hold")
      const request = "Suspend" as const
      const cursor = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.make({
          attemptId,
          request,
          taskId
        })
      ])

      expect(
        Option.isNone(
          yield* cursor.consumeExecutorRequestPublicationHold(
            TaskId.make("B"),
            AttemptId.make("attempt:competing-command"),
            "Begin"
          )
        )
      ).toBe(true)
      expect(yield* cursor.storyPosition).toBe(0)

      expect(Option.isSome(yield* cursor.consumeExecutorRequestPublicationHold(taskId, attemptId, request))).toBe(true)
      expect(yield* cursor.storyPosition).toBe(1)
    })
  )
})

it("fails closed when an exact executor report has no permitted immediate predecessor owner", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const reports = maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries.story.filter(
        (item) => item._tag === "PlannedAttemptExecutorWorkReported"
      )
      const first = reports[0]
      const second = reports.find((item) => first !== undefined && item.report.attemptId !== first.report.attemptId)
      if (first === undefined || second === undefined) return yield* Effect.die("missing malformed executor fixtures")
      const cursor = yield* makeStoryCursor([first, second])
      const exit = yield* Effect.exit(cursor.consumeExecutorReportFor(second.request, second.report.attemptId))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("AuthoredCassetteInteractionMismatch")
    })
  )
})

it("lets an exact operation selection wait for an actively owned sibling executor outcome", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const report = maintainedStoryItems.find((item) => item._tag === "PlannedAttemptExecutorWorkReported")
      const selection = maintainedStoryItems.find(
        (item) => item._tag === "DalphSelects" && item.operation._tag === "ReconcileTaskWorktree"
      )
      if (report?._tag !== "PlannedAttemptExecutorWorkReported" || selection?._tag !== "DalphSelects") {
        return yield* Effect.die("missing executor outcome and later worktree selection")
      }
      const cursor = yield* makeStoryCursor([report, selection])
      yield* Effect.acquireUseRelease(
        cursor.beginExecutorReportRequest(report.request, report.report.attemptId),
        () =>
          Effect.gen(function* () {
            const operation = yield* cursor.consumeDalphSelectionFor(selection.operation).pipe(Effect.forkChild)
            yield* Effect.yieldNow

            // Let the cursor's bounded registration window close while the exact
            // executor request remains registered but has not advanced the story.
            for (let turn = 0; turn < 16; turn += 1) yield* Effect.yieldNow
            expect(operation.pollUnsafe()).toBeUndefined()
            expect(yield* cursor.consumeExecutorReportFor(report.request, report.report.attemptId)).toEqual(report)
            expect(yield* Fiber.join(operation)).toEqual(selection)
          }),
        () => cursor.endExecutorReportRequest(report.request, report.report.attemptId)
      )
    })
  )
})

it("round-trips restart, release, worktree, Git, and lost-response histories", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const cassettes = [
        maintainedAuthoredCassetteCatalog.changedAttemptRestartsCleanly,
        maintainedAuthoredCassetteCatalog.changedAttemptStopReleaseResponseLost,
        maintainedAuthoredCassetteCatalog.lostPlannedWorktreeSafelySuspends,
        maintainedAuthoredCassetteCatalog.changedAttemptRestartCancelsHeldResume,
        maintainedAuthoredCassetteCatalog.acceptedResultRestartsIntoIntegration
      ]

      let integrationRecorded: RecordedCassetteType | undefined
      for (const cassette of cassettes) {
        const run = yield* runAuthoredScenarioCassette(cassette)
        const recorded = yield* projectRecordedCassette(run.records)
        if (cassette === maintainedAuthoredCassetteCatalog.acceptedResultRestartsIntoIntegration) {
          integrationRecorded = recorded
        }
        expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
        expect(
          verifyRecordedCassetteRoundTrip(run.records, recorded).every(
            ({ operationalStateEquivalent, workflowHistoryEquivalent }) =>
              operationalStateEquivalent && workflowHistoryEquivalent
          )
        ).toBe(true)
        expect(renderRecordedCassetteLyrics(recorded)).toContain("Dalph")
      }

      if (integrationRecorded === undefined) return yield* Effect.die("accepted-result cassette was not recorded")
      const withoutIntegrationOrigin = RecordedCassette.make({
        ...integrationRecorded,
        entries: integrationRecorded.entries.filter(({ _tag }) => _tag !== "IntegrationResponsibilityBegan")
      })
      const missingCause = yield* Effect.exit(Effect.sync(() => foldRecordedCassette(withoutIntegrationOrigin)))
      expect(Exit.isFailure(missingCause)).toBe(true)
      if (Exit.isFailure(missingCause)) expect(Cause.hasDies(missingCause.cause)).toBe(true)
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})

it("projects, folds, compares, renders, and alpha-renames a public recorded run", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singletonTaskCompletesAuthoredCassette)
      const recorded = yield* projectRecordedCassette(run.records)
      const emptyRenaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [],
        claimTokens: [],
        integratorCandidateResourceLocators: [],
        integratorSessionIds: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [],
        worktreeLocators: []
      })
      const renamed = yield* renameRecordedCassette(recorded, emptyRenaming)
      const roundTrip = verifyRecordedCassetteRoundTrip(run.records, recorded)
      const renamedRoundTrip = yield* verifyRecordedCassetteRoundTripWithRenaming(run.records, recorded, emptyRenaming)

      expect(recorded.entries.length).toBeGreaterThan(0)
      expect(foldRecordedCassette(recorded)._tag).toBe("ValidWorkflowJournalHistory")
      expect(
        roundTrip.every(
          ({ operationalStateEquivalent, workflowHistoryEquivalent }) =>
            workflowHistoryEquivalent && operationalStateEquivalent
        )
      ).toBe(true)
      expect(renamedRoundTrip).toEqual(roundTrip)
      expect(
        compareRecordedCassetteCheckpoints(recorded, renamed).every(
          ({ workflowHistoryEquivalent }) => workflowHistoryEquivalent
        )
      ).toBe(true)
      expect(renderRecordedCassetteLyrics(recorded)).toContain("Dalph")
    }).pipe(Effect.provide(NodeCrypto.layer))
  )
})
