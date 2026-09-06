import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect"
import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "vitest"
import { AttemptId, GitCommitSha, GitRepositoryLocator, TaskId } from "@dalph/contracts"
import {
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  OperationId,
  TaskClaimAcquisition,
  TaskClaimAcquisitionAuthority,
  TaskClaimReacquisitionRequestId,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import {
  AuthoredCassetteStoryItem,
  AuthoredScenarioCassette,
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
import { controlledTrace } from "../../src/cassettes/authored-adapters.js"
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

const freshTaskClaimOperation = (
  taskId: TaskId,
  authority: typeof TaskClaimAcquisitionAuthority.Type = TaskClaimAcquisitionAuthority.cases.TaskSelectionAuthority.make(
    {}
  ),
  label = String(taskId)
) =>
  makeTaskClaimAcquisitionOperation({
    acquisition: TaskClaimAcquisition.make({
      operationId: OperationId.make(`fresh-selection-${label}-${taskId}`),
      owner: ClaimOwner.make(`dalph:test:${taskId}`),
      taskId,
      token: ClaimToken.make(`fresh-selection-token-${taskId}`)
    }),
    authority,
    predecessorOperationIds: []
  })

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
      expect(Option.isNone(yield* empty.consumeExecutorProjection)).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseObservationStart)).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseProgressAwait)).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseProgressObserved)).toBe(true)
      expect(Option.isNone(yield* empty.consumePauseProgressObservedCancelledAndReconnected)).toBe(true)
      expect(Option.isNone(yield* empty.consumeControlDirectionFailure)).toBe(true)
      expect(Option.isNone(yield* empty.consumeClaimReacquisitionDirection)).toBe(true)
      expect(Option.isNone(yield* empty.consumeTaskClaimRead)).toBe(true)
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
      const projection = yield* makeStoryCursor([findStoryItem("PlannedAttemptExecutorProjectionReturned")])
      expect(Option.isSome(yield* projection.consumeExecutorProjection)).toBe(true)
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
      const taskClaimRead = yield* makeStoryCursor([findStoryItem("TaskClaimReadFailed")])
      expect(Option.isSome(yield* taskClaimRead.consumeTaskClaimRead)).toBe(true)
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

it("rejects empty, duplicate, and late fresh-claim holds at decode and cursor closure boundaries", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const markerTag = "CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions" as const
      expect(Schema.is(AuthoredCassetteStoryItem)({ _tag: markerTag, taskIds: [] })).toBe(false)
      expect(
        Schema.is(AuthoredCassetteStoryItem)({ _tag: markerTag, taskIds: [TaskId.make("B"), TaskId.make("B")] })
      ).toBe(false)

      const marker = AuthoredCassetteStoryItem.cases.CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions.make({
        taskIds: [TaskId.make("B"), TaskId.make("C")]
      })
      const duplicateCursor = yield* Effect.exit(makeStoryCursor([marker, marker]))
      expect(Exit.isFailure(duplicateCursor)).toBe(true)
      if (Exit.isFailure(duplicateCursor)) expect(Cause.pretty(duplicateCursor.cause)).toContain("at most one")

      const duplicateCassette = {
        ...singletonTaskCompletesAuthoredCassette,
        story: [
          ...singletonTaskCompletesAuthoredCassette.story.slice(0, 2),
          marker,
          marker,
          ...singletonTaskCompletesAuthoredCassette.story.slice(2)
        ]
      }
      expect(Schema.is(AuthoredScenarioCassette)(duplicateCassette)).toBe(false)

      const firstClaimIndex = singletonTaskCompletesAuthoredCassette.story.findIndex(
        (item) => item._tag === "DalphSelects" && item.operation._tag === "AcquireTaskClaim"
      )
      if (firstClaimIndex < 0) return yield* Effect.die("singleton cassette has no fresh claim selection")
      const firstClaim = singletonTaskCompletesAuthoredCassette.story[firstClaimIndex]
      if (firstClaim?._tag !== "DalphSelects" || firstClaim.operation._tag !== "AcquireTaskClaim") {
        return yield* Effect.die("singleton fresh claim selection changed shape")
      }
      const lateMarker =
        AuthoredCassetteStoryItem.cases.CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions.make({
          taskIds: [firstClaim.operation.taskId]
        })
      const lateMarkerStory = [
        ...singletonTaskCompletesAuthoredCassette.story.slice(0, firstClaimIndex + 1),
        lateMarker,
        ...singletonTaskCompletesAuthoredCassette.story.slice(firstClaimIndex + 1)
      ]
      expect(
        Schema.is(AuthoredScenarioCassette)({ ...singletonTaskCompletesAuthoredCassette, story: lateMarkerStory })
      ).toBe(false)
      const lateCursor = yield* Effect.exit(makeStoryCursor(lateMarkerStory))
      expect(Exit.isFailure(lateCursor)).toBe(true)
      if (Exit.isFailure(lateCursor)) expect(Cause.pretty(lateCursor.cause)).toContain("must precede")
    })
  )
})

it("parks every marked fresh claim before selection while A, Operator reacquisition, and reads bypass it", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const marker = AuthoredCassetteStoryItem.cases.CassetteHoldsFreshTaskClaimSelectionsUntilTerminalAssertions.make({
        taskIds: [TaskId.make("B"), TaskId.make("C")]
      })
      const expected = findStoryItem("ExpectedBehavior")
      const aSelection = AuthoredCassetteStoryItem.cases.DalphSelects.make({
        operation: { _tag: "AcquireTaskClaim", taskId: TaskId.make("A") }
      })
      const operatorSelection = AuthoredCassetteStoryItem.cases.DalphSelects.make({
        operation: { _tag: "AcquireTaskClaim", taskId: TaskId.make("A") }
      })
      const readSelection = AuthoredCassetteStoryItem.cases.DalphSelects.make({
        operation: { _tag: "ReadTaskClaim", taskId: TaskId.make("A") }
      })
      const cursor = yield* makeStoryCursor([marker, aSelection, operatorSelection, readSelection, expected])
      const trace = controlledTrace(cursor)
      expect(Option.isSome(yield* cursor.consumeFreshTaskClaimSelectionHold)).toBe(true)
      expect(yield* cursor.storyPosition).toBe(1)
      expect(Option.isNone(yield* cursor.consumeFreshTaskClaimSelectionHold)).toBe(true)
      expect(yield* cursor.storyPosition).toBe(1)

      const bOperation = freshTaskClaimOperation(TaskId.make("B"))
      const cOperation = freshTaskClaimOperation(TaskId.make("C"))
      const aOperation = freshTaskClaimOperation(TaskId.make("A"))
      const operatorOperation = freshTaskClaimOperation(
        TaskId.make("A"),
        TaskClaimAcquisitionAuthority.cases.ExplicitTaskClaimReacquisitionAuthority.make({
          requestId: TaskClaimReacquisitionRequestId.make("operator-reacquire-A")
        }),
        "operator-A"
      )
      const readOperation = makeTaskClaimObservationOperation(
        OperationId.make("read-claim-A"),
        FixtureTarget.make("fresh-claim-hold"),
        TaskId.make("A")
      )
      const bFiber = yield* trace.emit({ _tag: "OperationSelected", operation: bOperation }).pipe(Effect.forkChild)
      const cFiber = yield* trace.emit({ _tag: "OperationSelected", operation: cOperation }).pipe(Effect.forkChild)
      for (let turn = 0; turn < 16; turn += 1) yield* Effect.yieldNow
      expect(bFiber.pollUnsafe()).toBeUndefined()
      expect(cFiber.pollUnsafe()).toBeUndefined()
      expect(yield* cursor.storyPosition).toBe(1)

      yield* trace.emit({ _tag: "OperationSelected", operation: aOperation })
      expect(yield* cursor.storyPosition).toBe(2)
      expect(bFiber.pollUnsafe()).toBeUndefined()
      expect(cFiber.pollUnsafe()).toBeUndefined()

      yield* trace.emit({ _tag: "OperationSelected", operation: operatorOperation })
      yield* trace.emit({ _tag: "OperationSelected", operation: readOperation })
      expect(yield* cursor.storyPosition).toBe(4)
      expect(bFiber.pollUnsafe()).toBeUndefined()
      expect(cFiber.pollUnsafe()).toBeUndefined()

      expect((yield* cursor.consumeTerminalAssertions)._tag).toBe("ExpectedBehavior")
      yield* Fiber.interrupt(bFiber)
      yield* Fiber.interrupt(cFiber)
      expect(yield* cursor.storyPosition).toBe(5)
      expect(bFiber.pollUnsafe()).not.toBeUndefined()
      expect(cFiber.pollUnsafe()).not.toBeUndefined()
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
      const compareAndSetError = yield* compareAndSetLostCursor
        .consumeTargetPromotionCompareAndSet(compareAndSetLost.request)
        .pipe(Effect.flip)
      expect(compareAndSetError._tag).toBe("AuthoredTargetPromotionCompareAndSetFailure")
      const compareAndSetReturned = findStoryItemOf("TargetPromotionCompareAndSetReturned")
      const compareAndSetCursor = yield* makeStoryCursor([compareAndSetReturned])
      expect((yield* compareAndSetCursor.consumeTargetPromotionCompareAndSet(compareAndSetReturned.request))._tag).toBe(
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
      // This synchronization item remains part of the cursor contract, but is
      // no longer present in the maintained authored catalog. Keep this
      // residual focused on the cursor operation with a local schema-valid
      // fixture instead of coupling it to a scenario's chronology.
      const publicationHoldItem =
        AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.make({
          attemptId: AttemptId.make("attempt:residual-publication-hold"),
          request: "Begin",
          taskId: TaskId.make("A")
        })
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

it("lets fresh claim selections wait for an actively owned lineage selection and its hold marker", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const story = maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries.story
      const holdIndex = story.findIndex(
        (item) => item._tag === "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary"
      )
      const lineage = story[holdIndex - 1]
      const a = story[holdIndex + 1]
      const c = story[holdIndex + 2]
      if (
        lineage?._tag !== "DalphSelects" ||
        lineage.operation._tag !== "ReadTargetLineage" ||
        a?._tag !== "DalphSelects" ||
        a.operation._tag !== "AcquireTaskClaim" ||
        c?._tag !== "DalphSelects" ||
        c.operation._tag !== "AcquireTaskClaim"
      ) {
        return yield* Effect.die("missing lineage-hold and fresh-claim chronology")
      }
      const hold = story[holdIndex]
      if (hold?._tag !== "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary") {
        return yield* Effect.die("missing target-promotion lineage hold")
      }
      const cursor = yield* makeStoryCursor([lineage, hold, a, c])
      const aSelection = yield* cursor.consumeDalphSelectionFor(a.operation).pipe(Effect.forkChild)
      const cSelection = yield* cursor.consumeDalphSelectionFor(c.operation).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(yield* cursor.consumeDalphSelectionFor(lineage.operation)).toEqual(lineage)
      expect(Option.isSome(yield* cursor.consumeTargetPromotionReconciliationReadBoundaryHold)).toBe(true)
      expect(yield* Fiber.join(aSelection)).toEqual(a)
      expect(yield* Fiber.join(cSelection)).toEqual(c)
    })
  )
})

it("proves task Pause through Suspend and Safe without requiring a redundant pre-Suspend projection", () => {
  const story = maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries.story
  const observationStartedAt = story.findIndex((item) => item._tag === "OperatorStartsPauseObservation")
  const suspensionReturnedAt = story.findIndex(
    (item) =>
      item._tag === "PlannedAttemptExecutorWorkReported" &&
      item.request === "Suspend" &&
      item.report.attemptId === "attempt:A:0"
  )
  expect(observationStartedAt).toBeGreaterThan(-1)
  expect(suspensionReturnedAt).toBeGreaterThan(observationStartedAt)
  expect(
    story
      .slice(observationStartedAt + 1, suspensionReturnedAt)
      .some(
        (item) => item._tag === "PlannedAttemptExecutorProjectionReturned" && item.report.attemptId === "attempt:A:0"
      )
  ).toBe(false)
  expect(story[suspensionReturnedAt]).toMatchObject({
    _tag: "PlannedAttemptExecutorWorkReported",
    report: { _tag: "ExecutorWorkSafelySuspended", attemptId: "attempt:A:0" },
    request: "Suspend"
  })
  expect(
    story.some(
      (item) =>
        item._tag === "PauseProgressObserved" &&
        item.result._tag === "PauseConfirmed" &&
        item.result.atBoundary.some(
          (responsibility) =>
            responsibility._tag === "PlannedAttemptExecutorWork" && responsibility.attemptId === "attempt:A:0"
        )
    )
  ).toBe(true)
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

it("keeps held-Resume Restart authority before the separate final tracker reconfirmation", () => {
  for (const cassette of [
    maintainedAuthoredCassetteCatalog.changedAttemptRestartCancelsHeldResume,
    maintainedAuthoredCassetteCatalog.changedAttemptRestartCancelsHeldResumeBeforeChangedFacts
  ]) {
    const choiceAt = cassette.story.findIndex(
      (item) => item._tag === "OperatorRestartsAttempt" && item.requestNonce === "restart-held-continuation-A"
    )
    const authorityGraphAt = cassette.story.findIndex(
      (item, index) => index > choiceAt && item._tag === "TrackerGraphReadReturned"
    )
    const specificationAt = cassette.story.findIndex(
      (item, index) => index > authorityGraphAt && item._tag === "TaskWorkSpecificationReadReturned"
    )
    const finalSelectionAt = cassette.story.findIndex(
      (item, index) =>
        index > specificationAt && item._tag === "DalphSelects" && item.operation._tag === "ReadTrackerGraph"
    )
    const finalGraphAt = cassette.story.findIndex(
      (item, index) => index > finalSelectionAt && item._tag === "TrackerGraphReadReturned"
    )

    expect(choiceAt).toBeGreaterThan(-1)
    expect(authorityGraphAt).toBe(choiceAt + 1)
    expect(specificationAt).toBeGreaterThan(authorityGraphAt)
    expect(finalSelectionAt).toBeGreaterThan(specificationAt)
    expect(finalGraphAt).toBeGreaterThan(finalSelectionAt)
  }
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
