import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref, Schema } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelationKey,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  AttemptWorktreeLost,
  ActiveTaskContinuationRead,
  controlledTrackerMutationLayerFrom,
  ClaimOwner,
  ClaimToken,
  CompetingWorktreeRegistrations,
  ConflictingWorktreeRegistration,
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent,
  ContradictoryWorktreeState,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskClaim,
  CompletionTaskBoundary,
  FocusedTaskCompletionReadRequest,
  completionClaimReplacementOperationIdFor,
  decodeFreshWorkflowRunIdForDiagnostics,
  deriveIntegrationFrontier,
  deriveIntegrationAdmission,
  evaluateDeliveryRelationAndRuntimeInputBundle,
  evaluateDeliveryRelationInputBundle,
  evaluateDeliveryRuntimeInputBundle,
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionId,
  firstFullRerunSuccessorGeneration,
  deriveRunnableFrontier,
  describeJournalEvent,
  EvidenceDigest,
  EvidenceReference,
  ForeignWorktreeRegistration,
  FixtureTarget,
  GitWorktreeReadFailure,
  JournalPosition,
  InRunJournal,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskClaimFactsUnreadable,
  makeCompleteTaskTrackerFactsObserved,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorktreeObservationOperation,
  OperationId,
  originatingActionForTargetLineageObservation,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptContinuationAuthorizedEvent,
  PlannedAttemptContinuationWitness,
  PlannedWorktreeReady,
  plannedAttemptProtocolControllerLayer,
  authorizePlannedAttemptContinuation,
  projectWorkflowOccurrences,
  projectTrackerSnapshot,
  reduceWorkflowJournalHistory,
  readPostPromotionBlockerCandidateAncestry,
  RunPolicyRevision,
  TrackerRevision,
  TrackerMutation,
  TaskWorkCapacity,
  TaskClaimReadFailure,
  TaskClaimReacquisitionRequestId,
  TaskClaimReacquisitionDirectedEvent,
  TaskClaimReleaseAuthority,
  TaskLifecycle,
  TaskTrackerFactsObservedEvent,
  TaskTrackerFactsReadFailed,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  taskTrackerReadIntent,
  taskRevisionFor,
  UntrackedWorktreePath,
  UnclaimedTask,
  WorktreeBaseMismatch,
  type JournalRecord,
  type TaskTrackerFactsObservation,
  type WorkflowJournalEvent,
  type WorkflowOperation,
  workflowJournalEventVersion
} from "@dalph/orchestrator"

import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  acceptedResultRestartsIntoIntegrationAuthoredCassette,
  ambiguousCompletionResponseAuthoredCassette,
  AuthoredCassetteStoryItem,
  AuthoredScenarioCassette,
  CassetteIdentityRenaming,
  changedAgainAttemptRequiresNewChoiceAuthoredCassette,
  changedAttemptChoiceRaceAuthoredCassette,
  changedAttemptContinuesAuthoredCassette,
  changedAttemptRestartAfterSupersessionCrashAuthoredCassette,
  changedAttemptRestartClaimUnavailableAuthoredCassette,
  changedAttemptRestartFactsChangedAuthoredCassette,
  changedAttemptRestartCancelsHeldResumeBeforeChangedFactsAuthoredCassette,
  changedAttemptRestartPastIntegrationRejectedAuthoredCassette,
  changedAttemptRestartCancelsHeldResumeAuthoredCassette,
  changedAttemptRestartsCleanlyAuthoredCassette,
  changedAttemptRestartWorktreeNotReadyAuthoredCassette,
  changedAttemptStopCancelsHeldResumeAuthoredCassette,
  changedAttemptStopCancelsHeldResumeWithForeignClaimAuthoredCassette,
  changedAttemptStopsAndReleasesAuthoredCassette,
  changedAttemptStopReleaseResponseLostAuthoredCassette,
  changedAttemptStopsWithAbsentClaimAuthoredCassette,
  changedAttemptStopsWithForeignClaimAuthoredCassette,
  changedAttemptReacquisitionForeignConflictAuthoredCassette,
  compareRecordedCassetteCheckpoints,
  completionGraphRefreshRecoveryAuthoredCassette,
  completionTaskConflictAuthoredCassette,
  blockersAroundPromotionAuthoredCassette,
  compatibleTargetAdvanceContinuesAuthoredCassette,
  coordinatorProcessDeathContinuesAuthoredCassette,
  contractedCapacityRetainsTwoAttemptsAuthoredCassette,
  currentCompletionGraphAuthorityAuthoredCassette,
  dependentTasksCompleteInOneRunAuthoredCassette,
  deliveryFinalitySpineAuthoredCassette,
  foldRecordedCassette,
  invertCassetteIdentityRenaming,
  incompatibleTargetRewriteSafelySuspendsAuthoredCassette,
  idleRunCancellationAuthoredCassette,
  integrationRunCancellationAuthoredCassette,
  maintainedIntegrationFinalityProtocolCassetteCatalog,
  IntegrationFinalityProtocolCassette,
  lostPlannedWorktreeSafelySuspendsAuthoredCassette,
  maintainedAuthoredCassetteCatalog,
  measureTrackerObservationEncoding,
  projectRecordedCassette,
  postIntegrationAttemptChoiceRejectedAuthoredCassette,
  prePromotionBlockerAuthoredCassette,
  prerequisiteReopensDuringCompletionAuthoredCassette,
  ProtocolStoryItem,
  RecordedCassette,
  recordedCassetteVersion,
  type RecordedCassetteEntry,
  renameRecordedCassette,
  renderAuthoredCassetteLyrics,
  renderRecordedCassetteLyrics,
  runTargetPromotionProtocolCassette,
  runIntegrationFinalityProtocolCassette,
  runIntegrationFinalityProtocolCassetteFromPromotedRecords,
  runPauseRestartsPassivelyAuthoredCassette,
  runPauseObservationDisconnectsAuthoredCassette,
  runPauseSafelySuspendsAuthoredCassette,
  runningAttemptRunCancellationAuthoredCassette,
  runningAttemptRunCancellationForeignClaimAuthoredCassette,
  runUnpauseAfterSafeSuspensionAuthoredCassette,
  runUnpauseDuringSuspensionRestartsAuthoredCassette,
  taskPauseCoversGroupingChildAuthoredCassette,
  taskPauseFinishesHeldIntegrationAuthoredCassette,
  taskPauseGroupingFactsAddedAuthoredCassette,
  taskPauseObservationUnpausedAuthoredCassette,
  taskPauseLetsIndependentTaskContinueAuthoredCassette,
  taskUnpauseAfterSafeSuspensionAuthoredCassette,
  taskUnpauseDuringSuspensionRestartsAuthoredCassette,
  runAuthoredScenarioCassette as runAuthoredScenarioCassetteWithCrypto,
  singletonTaskCompletesAuthoredCassette,
  staleTaskPauseRejectedAuthoredCassette,
  targetPromotionConcurrentTargetsProtocolCassette,
  TargetPromotionProtocolCassette,
  targetPromotionUnreadableProtocolCassette,
  unreadableTaskUnpauseRejectedAuthoredCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"
import {
  evaluateAuthoredDeliveryPublication,
  type AuthoredDeliveryPublication
} from "../../src/cassettes/authored-runner.js"
import { controlledExecutorLayer } from "../../src/cassettes/authored-adapters.js"
import { controlledTrackerAuthorityLayer } from "../../src/cassettes/authored-tracker-authority.js"
import { AuthoredCassetteInteractionMismatch, makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
import { assertAuthoredExpectedBehavior } from "../../src/cassettes/authored-outcomes.js"

const evidenceDigestHexLength = 64

const expectCompleteCurrentGraphReadsBeforeFirstClaim = (
  records: ReadonlyArray<JournalRecord>,
  exactTaskSubjects: ReadonlyArray<TaskId>
): void => {
  const firstClaimAt = records.findIndex(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
  expect(firstClaimAt).toBeGreaterThan(0)
  const reads = records
    .slice(0, firstClaimAt)
    .flatMap(({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.cause._tag === "WorkflowEstablishment"
        ? [event.operation]
        : []
    )
  expect(reads.map(({ readShape }) => readShape.explicitlyCoveredTaskIds)).toEqual([
    [],
    ...exactTaskSubjects.map((taskId) => [taskId])
  ])
  expect(
    reads.every(({ operationId }) => {
      const event = records
        .slice(0, firstClaimAt)
        .find(({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operationId)?.event
      return (
        event?._tag === "TaskTrackerFactsObserved" &&
        (event.observation._tag === "CompleteTaskTrackerFacts" ||
          event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
      )
    })
  ).toBe(true)
}

const expectFocusedCompletionReadCorrelation = (
  records: ReadonlyArray<JournalRecord>,
  observationPosition: number
): void => {
  const observed = records[observationPosition]?.event
  if (observed?._tag !== "TaskTrackerFactsObserved" || observed.observation._tag !== "FocusedTaskCompletionFacts") {
    return expect.fail("expected a canonical focused completion observation")
  }
  const intent = records.findLast(
    ({ event }, index) =>
      index < observationPosition &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadCompletionTaskFacts" &&
      event.operation.operationId === observed.operationId
  )?.event
  if (intent?._tag !== "TaskTrackerReadIntentRecorded" || intent.operation._tag !== "ReadCompletionTaskFacts") {
    return expect.fail("expected the exact canonical focused completion read intent")
  }
  expect(observed.operationId).toBe(observed.observation.operationId)
  expect(intent.operation).toMatchObject({
    operationId: observed.operationId,
    purpose: observed.observation.purpose,
    request: observed.observation.request,
    target: observed.observation.target
  })
}

it("renders every maintained authored cassette from its structured story", () => {
  for (const cassette of Object.values(maintainedAuthoredCassetteCatalog)) {
    expect(renderAuthoredCassetteLyrics(cassette)).toContain(`Scenario: ${cassette.name}.`)
  }
})

const exactClaimAuthorities = (...attemptIds: ReadonlyArray<AttemptId>) =>
  new Map(attemptIds.map((attemptId) => [attemptId, { _tag: "Exact" as const }]))

const singleton = singletonTaskCompletesAuthoredCassette
const runAuthoredScenarioCassette = (
  input: unknown,
  options: Parameters<typeof runAuthoredScenarioCassetteWithCrypto>[1] = {}
) => runAuthoredScenarioCassetteWithCrypto(input, options).pipe(Effect.provide(NodeCrypto.layer))

const cachedDependentTasksRun = Effect.runSync(
  Effect.cached(runAuthoredScenarioCassette(dependentTasksCompleteInOneRunAuthoredCassette))
)

const expectRecordedRoundTrip = (records: ReadonlyArray<JournalRecord>, recorded: RecordedCassette) =>
  expect(
    verifyRecordedCassetteRoundTrip(records, recorded).every(
      (checkpoint) =>
        checkpoint.workflowHistoryEquivalent &&
        checkpoint.operationalStateEquivalent &&
        checkpoint.pureSelectionEquivalent
    )
  ).toBe(true)

it.effect("projects and alpha-renames every Run cancellation cassette occurrence", () =>
  Effect.gen(function* () {
    const [idleRun, runningRun, foreignRun, integrationRun] = yield* Effect.all([
      runAuthoredScenarioCassette(idleRunCancellationAuthoredCassette),
      runAuthoredScenarioCassette(runningAttemptRunCancellationAuthoredCassette),
      runAuthoredScenarioCassette(runningAttemptRunCancellationForeignClaimAuthoredCassette),
      runAuthoredScenarioCassette(integrationRunCancellationAuthoredCassette)
    ])
    const [idleRecorded, runningRecorded, foreignRecorded, integrationRecorded] = yield* Effect.all([
      projectRecordedCassette(idleRun.records),
      projectRecordedCassette(runningRun.records),
      projectRecordedCassette(foreignRun.records),
      projectRecordedCassette(integrationRun.records)
    ])
    const sourceAndRecorded = [
      { recorded: idleRecorded, run: idleRun },
      { recorded: runningRecorded, run: runningRun },
      { recorded: foreignRecorded, run: foreignRun },
      { recorded: integrationRecorded, run: integrationRun }
    ] as const
    for (const { recorded: cassette, run } of sourceAndRecorded) {
      expectRecordedRoundTrip(run.records, cassette)
    }
    const tags = new Set(
      sourceAndRecorded.flatMap(({ recorded: cassette }) => cassette.entries.map(({ _tag }) => _tag))
    )
    for (const tag of [
      "RunCancellationApplied",
      "CancelledAttemptImplementationResponsibilityRelinquished",
      "CancelledAttemptClaimNoReleaseObserved"
    ]) {
      expect(tags).toContain(tag)
    }
    const relinquished = runningRecorded.entries.find(
      (entry) => entry._tag === "CancelledAttemptImplementationResponsibilityRelinquished"
    )
    const noRelease = foreignRecorded.entries.find((entry) => entry._tag === "CancelledAttemptClaimNoReleaseObserved")
    if (relinquished?._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
      return yield* Effect.die("running cancellation cassette must record implementation relinquishment")
    }
    if (noRelease?._tag !== "CancelledAttemptClaimNoReleaseObserved") {
      return yield* Effect.die("foreign cancellation cassette must record claim preservation")
    }
    const cancellationClaimTokenRenamings = [
      { from: relinquished.authorizedClaim.token, to: "renamed-cancelled-claim" },
      { from: noRelease.expectedClaim.token, to: "renamed-cancelled-expected-claim" }
    ].filter((renaming, index, all) => all.findIndex(({ from }) => from === renaming.from) === index)
    const cancellationOperationRenamings = [
      { from: relinquished.authorizedClaim.operationId, to: "renamed-cancelled-claim-operation" },
      { from: noRelease.expectedClaim.operationId, to: "renamed-cancelled-expected-claim-operation" },
      { from: noRelease.observationOperationId, to: "renamed-cancelled-observation-operation" }
    ].filter((renaming, index, all) => all.findIndex(({ from }) => from === renaming.from) === index)
    const cancellationRenaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      attemptIds: [{ from: relinquished.plannedAttempt.attemptId, to: "renamed-cancelled-attempt" }],
      claimTokens: cancellationClaimTokenRenamings,
      integratorCandidateResourceLocators: [],
      integratorSessionIds: [],
      operationIds: cancellationOperationRenamings,
      runIds: [{ from: runningRecorded.runId, to: "renamed-cancelled-run" }],
      taskBranchRefs: [{ from: relinquished.plannedAttempt.branch, to: "refs/heads/dalph/renamed-cancelled-attempt" }],
      worktreeLocators: [{ from: relinquished.plannedAttempt.worktree, to: "/dalph/renamed-cancelled-attempt" }]
    })
    const [renamedIdle, renamedRunning, renamedForeign, renamedIntegration] = yield* Effect.all([
      renameRecordedCassette(idleRecorded, cancellationRenaming),
      renameRecordedCassette(runningRecorded, cancellationRenaming),
      renameRecordedCassette(foreignRecorded, cancellationRenaming),
      renameRecordedCassette(integrationRecorded, cancellationRenaming)
    ])
    const renamedNoRelease = renamedForeign.entries.find(
      (entry) => entry._tag === "CancelledAttemptClaimNoReleaseObserved"
    )
    if (renamedNoRelease?._tag !== "CancelledAttemptClaimNoReleaseObserved") {
      return yield* Effect.die("renamed cancellation cassette must retain claim preservation")
    }
    expect(renamedRunning.runId).toBe("renamed-cancelled-run")
    expect(renamedNoRelease.expectedClaim.operationId).toBe(
      cancellationOperationRenamings.find(({ from }) => from === noRelease.expectedClaim.operationId)?.to
    )
    expect(renamedNoRelease.observationOperationId).toBe("renamed-cancelled-observation-operation")
    const inverse = invertCassetteIdentityRenaming(cancellationRenaming)
    expect(
      (yield* verifyRecordedCassetteRoundTripWithRenaming(foreignRun.records, renamedForeign, inverse)).every(
        (checkpoint) => checkpoint.workflowHistoryEquivalent
      )
    ).toBe(true)
    const lyrics = [renamedIdle, renamedRunning, renamedForeign, renamedIntegration]
      .map(renderRecordedCassetteLyrics)
      .join("\n")
    expect(lyrics).toContain("Operator applied Run cancellation.")
    expect(lyrics).toContain("relinquished implementation responsibility for cancelled attempt")
    expect(lyrics).toContain("cancelling attempt")
  }).pipe(Effect.provide(NodeCrypto.layer))
)

const foldRecordedCassetteOutcome = (cassette: RecordedCassette) =>
  Effect.exit(Effect.sync(() => foldRecordedCassette(cassette))).pipe(
    Effect.map((exit) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : exit.value._tag))
  )

const exactExecutorReportTags = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> =>
  records.flatMap(({ event }) => {
    if (event._tag === "PlannedAttemptExecutorWorkReported") return [event.report._tag]
    if (
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
      event.observation._tag === "ExactExecutorReport"
    ) {
      return [event.observation.report._tag]
    }
    return []
  })

it.effect("preserves exact, conflicting, and unclaimed authored acquisition observations", () =>
  Effect.gen(function* () {
    const exactAcquisition = {
      operationId: OperationId.make("coverage-authored-exact-operation"),
      owner: ClaimOwner.make("coverage-authored-owner"),
      taskId: TaskId.make("coverage-authored-exact-task"),
      token: ClaimToken.make("coverage-authored-exact-token")
    }
    const conflictingObservation = {
      _tag: "ActiveTaskClaim" as const,
      operationId: OperationId.make("coverage-authored-foreign-operation"),
      owner: ClaimOwner.make("coverage-authored-foreign-owner"),
      taskId: TaskId.make("coverage-authored-conflicting-task"),
      token: ClaimToken.make("coverage-authored-foreign-token")
    }
    const conflictingAcquisition = {
      operationId: OperationId.make("coverage-authored-conflicting-operation"),
      owner: ClaimOwner.make("coverage-authored-owner"),
      taskId: conflictingObservation.taskId,
      token: ClaimToken.make("coverage-authored-conflicting-token")
    }
    const unclaimedTaskId = TaskId.make("coverage-authored-unclaimed-task")
    const cursor = yield* makeStoryCursor([
      { _tag: "TaskClaimReadReturned", observation: { _tag: "ActiveTaskClaim", ...exactAcquisition } },
      { _tag: "TaskClaimReadReturned", observation: conflictingObservation },
      { _tag: "TaskClaimReadReturned", observation: UnclaimedTask.make({ taskId: unclaimedTaskId }) }
    ])

    yield* Effect.gen(function* () {
      const base = yield* TrackerMutation
      yield* Effect.gen(function* () {
        const tracker = yield* TrackerMutation
        yield* tracker.readTaskClaim(exactAcquisition.taskId)
        expect(yield* tracker.acquireTaskClaim(exactAcquisition)).toEqual({
          _tag: "ActiveTaskClaim",
          ...exactAcquisition
        })

        yield* tracker.readTaskClaim(conflictingObservation.taskId)
        expect(yield* tracker.acquireTaskClaim(conflictingAcquisition).pipe(Effect.flip)).toMatchObject({
          _tag: "TrackerMutation.TaskClaimConflict",
          attempted: conflictingAcquisition,
          observed: conflictingObservation
        })

        yield* tracker.readTaskClaim(unclaimedTaskId)
        expect(
          yield* tracker.acquireTaskClaim({
            operationId: OperationId.make("coverage-authored-unclaimed-operation"),
            owner: ClaimOwner.make("coverage-authored-owner"),
            taskId: unclaimedTaskId,
            token: ClaimToken.make("coverage-authored-unclaimed-token")
          })
        ).toMatchObject({ _tag: "ActiveTaskClaim", taskId: unclaimedTaskId })
      }).pipe(Effect.provide(controlledTrackerAuthorityLayer(cursor, base)))
    }).pipe(Effect.provide(controlledTrackerMutationLayerFrom([])))
  })
)

it.effect("does not fabricate an exact current-claim return before controlled authority success", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("truthful-current-claim")
    const currentReturn = { _tag: "TaskClaimCurrentReadReturned" as const, taskId }
    const authorityEntered = yield* Deferred.make<void>()
    const authorityRelease = yield* Deferred.make<void>()
    const cursor = yield* makeStoryCursor([currentReturn])
    const base = yield* TrackerMutation.pipe(Effect.provide(controlledTrackerMutationLayerFrom([])))
    const blocked = TrackerMutation.of({
      ...base,
      readTaskClaim: (requestedTaskId) =>
        Deferred.succeed(authorityEntered, undefined).pipe(
          Effect.andThen(Deferred.await(authorityRelease)),
          Effect.andThen(base.readTaskClaim(requestedTaskId))
        )
    })
    const read = yield* Effect.gen(function* () {
      return yield* (yield* TrackerMutation).readTaskClaim(taskId)
    }).pipe(Effect.provide(controlledTrackerAuthorityLayer(cursor, blocked)), Effect.forkScoped)

    yield* Deferred.await(authorityEntered)
    expect(yield* cursor.storyPosition).toBe(0)
    yield* Deferred.succeed(authorityRelease, undefined)
    expect(yield* Fiber.join(read)).toEqual(UnclaimedTask.make({ taskId }))
    expect(yield* cursor.storyPosition).toBe(1)

    const failedCursor = yield* makeStoryCursor([currentReturn])
    const failedAuthority = TrackerMutation.of({
      ...base,
      readTaskClaim: (requestedTaskId) =>
        Effect.fail(new TaskClaimReadFailure({ detail: "controlled authority unreadable", taskId: requestedTaskId }))
    })
    const failed = yield* Effect.gen(function* () {
      return yield* (yield* TrackerMutation).readTaskClaim(taskId)
    }).pipe(Effect.provide(controlledTrackerAuthorityLayer(failedCursor, failedAuthority)), Effect.exit)
    expect(Exit.isFailure(failed)).toBe(true)
    expect(yield* failedCursor.storyPosition).toBe(0)

    const interruptedCursor = yield* makeStoryCursor([currentReturn])
    const interruptedEntered = yield* Deferred.make<void>()
    const interruptedAuthority = TrackerMutation.of({
      ...base,
      readTaskClaim: () => Deferred.succeed(interruptedEntered, undefined).pipe(Effect.andThen(Effect.never))
    })
    const interruptedRead = yield* Effect.gen(function* () {
      return yield* (yield* TrackerMutation).readTaskClaim(taskId)
    }).pipe(Effect.provide(controlledTrackerAuthorityLayer(interruptedCursor, interruptedAuthority)), Effect.forkScoped)
    yield* Deferred.await(interruptedEntered)
    yield* Fiber.interrupt(interruptedRead)
    expect(yield* interruptedCursor.storyPosition).toBe(0)
  })
)

it.effect("preserves exact-task explicit and unreadable strict claim-read cassette semantics", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("strict-claim-semantics")
    const foreignTaskId = TaskId.make("strict-claim-foreign")
    const explicit = {
      _tag: "TaskClaimReadReturned" as const,
      observation: {
        _tag: "ActiveTaskClaim" as const,
        operationId: OperationId.make("strict-claim-operation"),
        owner: ClaimOwner.make("strict-claim-owner"),
        taskId,
        token: ClaimToken.make("strict-claim-token")
      }
    }
    const unreadable = { _tag: "TaskClaimReadFailed" as const, reason: "Unreadable" as const, taskId }
    const baseReads = yield* Ref.make(0)
    const base = yield* TrackerMutation.pipe(Effect.provide(controlledTrackerMutationLayerFrom([])))
    const observingBase = TrackerMutation.of({
      ...base,
      readTaskClaim: (requestedTaskId) =>
        Ref.update(baseReads, (count) => count + 1).pipe(Effect.andThen(base.readTaskClaim(requestedTaskId)))
    })
    const cursor = yield* makeStoryCursor([explicit, unreadable])

    yield* Effect.gen(function* () {
      const tracker = yield* TrackerMutation
      expect(yield* tracker.readTaskClaim(taskId)).toEqual(explicit.observation)
      expect(yield* tracker.readTaskClaim(taskId).pipe(Effect.flip)).toMatchObject({
        _tag: "TrackerMutation.TaskClaimReadFailure",
        detail: unreadable.reason,
        taskId
      })
    }).pipe(Effect.provide(controlledTrackerAuthorityLayer(cursor, observingBase)))
    expect(yield* Ref.get(baseReads)).toBe(0)

    const foreign = yield* makeStoryCursor([
      { _tag: "TaskClaimReadReturned", observation: UnclaimedTask.make({ taskId: foreignTaskId }) }
    ])
    const foreignExit = yield* Effect.gen(function* () {
      return yield* (yield* TrackerMutation).readTaskClaim(taskId)
    }).pipe(Effect.provide(controlledTrackerAuthorityLayer(foreign, observingBase)), Effect.exit)
    expect(Exit.isFailure(foreignExit)).toBe(true)
    expect(yield* foreign.storyPosition).toBe(0)
    expect(yield* Ref.get(baseReads)).toBe(0)
  })
)

it.effect("lets A reach claim while an independent grouped specification result remains in flight", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("grouped-spec-A")
    const taskD = TaskId.make("grouped-spec-D")
    const specificationA = {
      _tag: "TaskWorkSpecificationReadReturned" as const,
      body: "A body",
      taskId: taskA,
      title: "A title"
    }
    const specificationD = {
      _tag: "TaskWorkSpecificationReadReturned" as const,
      body: "D body",
      taskId: taskD,
      title: "D title"
    }
    const readSpecificationA = { _tag: "ReadTaskWorkSpecification" as const, taskId: taskA }
    const readSpecificationD = { _tag: "ReadTaskWorkSpecification" as const, taskId: taskD }
    const readClaimA = { _tag: "ReadTaskClaim" as const, taskId: taskA }
    const readClaimD = { _tag: "ReadTaskClaim" as const, taskId: taskD }
    const group = yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)({
      _tag: "ConcurrentInteractionGroup",
      members: [
        { interaction: { _tag: "DalphSelects", operation: readSpecificationA }, predecessorRoles: [], role: "S_A" },
        { interaction: specificationA, predecessorRoles: ["S_A"], role: "T_A" },
        { interaction: { _tag: "DalphSelects", operation: readClaimA }, predecessorRoles: ["T_A"], role: "Q_A" },
        { interaction: { _tag: "DalphSelects", operation: readSpecificationD }, predecessorRoles: [], role: "S_D" },
        { interaction: specificationD, predecessorRoles: ["S_D"], role: "T_D" },
        { interaction: { _tag: "DalphSelects", operation: readClaimD }, predecessorRoles: ["T_D"], role: "Q_D" }
      ]
    })
    const cursor = yield* makeStoryCursor([group])
    const releaseD = yield* Deferred.make<void>()

    yield* cursor.consumeDalphSelectionFor(readSpecificationA)
    yield* cursor.consumeDalphSelectionFor(readSpecificationD)
    const resultD = yield* Deferred.await(releaseD).pipe(
      Effect.andThen(cursor.consumeTaskWorkSpecificationFor(taskD)),
      Effect.forkScoped
    )
    expect(yield* cursor.consumeTaskWorkSpecificationFor(taskA)).toMatchObject(specificationA)
    expect(yield* cursor.consumeDalphSelectionFor(readClaimA)).toMatchObject({ operation: readClaimA })
    expect(resultD.pollUnsafe()).toBeUndefined()
    expect(yield* cursor.storyPosition).toBe(0)

    yield* Deferred.succeed(releaseD, undefined)
    expect(yield* Fiber.join(resultD)).toMatchObject(specificationD)
    expect(yield* cursor.consumeDalphSelectionFor(readClaimD)).toMatchObject({ operation: readClaimD })
    expect(yield* cursor.storyPosition).toBe(1)
  })
)

it.effect("correlates both completion orders of in-flight current-claim results with their exact group roles", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("grouped-claim-A")
    const taskC = TaskId.make("grouped-claim-C")
    const taskD = TaskId.make("grouped-claim-D")
    const readClaimA = { _tag: "ReadTaskClaim" as const, taskId: taskA }
    const readClaimC = { _tag: "ReadTaskClaim" as const, taskId: taskC }
    const independentSelection = { _tag: "ReadTaskWorkSpecification" as const, taskId: taskD }
    const group = yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup)({
      _tag: "ConcurrentInteractionGroup",
      members: [
        { interaction: { _tag: "DalphSelects", operation: readClaimA }, predecessorRoles: [], role: "Q_A" },
        {
          interaction: { _tag: "TaskClaimCurrentReadReturned", taskId: taskA },
          predecessorRoles: ["Q_A"],
          role: "R_A"
        },
        { interaction: { _tag: "DalphSelects", operation: readClaimC }, predecessorRoles: [], role: "Q_C" },
        {
          interaction: { _tag: "TaskClaimCurrentReadReturned", taskId: taskC },
          predecessorRoles: ["Q_C"],
          role: "R_C"
        },
        { interaction: { _tag: "DalphSelects", operation: independentSelection }, predecessorRoles: [], role: "S_D" }
      ]
    })
    const base = yield* TrackerMutation.pipe(Effect.provide(controlledTrackerMutationLayerFrom([])))

    for (const first of [taskA, taskC]) {
      const occurrences = yield* Ref.make(0)
      const cursor = yield* makeStoryCursor([group], {
        onOccurrence: ({ item }) =>
          item._tag === "ConcurrentInteractionGroup" ? Ref.update(occurrences, (count) => count + 1) : Effect.void
      })
      yield* cursor.consumeDalphSelectionFor(readClaimA)
      yield* cursor.consumeDalphSelectionFor(readClaimC)
      const enteredA = yield* Deferred.make<void>()
      const enteredC = yield* Deferred.make<void>()
      const releaseA = yield* Deferred.make<void>()
      const releaseC = yield* Deferred.make<void>()
      const authority = TrackerMutation.of({
        ...base,
        readTaskClaim: (taskId) => {
          const entered = taskId === taskA ? enteredA : enteredC
          const release = taskId === taskA ? releaseA : releaseC
          return Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(base.readTaskClaim(taskId))
          )
        }
      })
      yield* Effect.gen(function* () {
        const tracker = yield* TrackerMutation
        const resultA = yield* tracker.readTaskClaim(taskA).pipe(Effect.forkScoped)
        const resultC = yield* tracker.readTaskClaim(taskC).pipe(Effect.forkScoped)
        yield* Deferred.await(enteredA)
        yield* Deferred.await(enteredC)

        yield* cursor.consumeDalphSelectionFor(independentSelection)
        const firstRelease = first === taskA ? releaseA : releaseC
        const secondRelease = first === taskA ? releaseC : releaseA
        const firstFiber = first === taskA ? resultA : resultC
        const secondFiber = first === taskA ? resultC : resultA
        yield* Deferred.succeed(firstRelease, undefined)
        expect(yield* Fiber.join(firstFiber)).toEqual(UnclaimedTask.make({ taskId: first }))
        expect(yield* cursor.storyPosition).toBe(0)
        yield* Deferred.succeed(secondRelease, undefined)
        const secondTask = first === taskA ? taskC : taskA
        expect(yield* Fiber.join(secondFiber)).toEqual(UnclaimedTask.make({ taskId: secondTask }))
      }).pipe(Effect.provide(controlledTrackerAuthorityLayer(cursor, authority)))
      expect(yield* cursor.storyPosition).toBe(1)
      expect(yield* Ref.get(occurrences)).toBe(1)
    }
  })
)

it.effect("delays interruption after exact validation until the masked current-claim handoff publishes once", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("masked-current-claim")
    const publicationEntered = yield* Deferred.make<void>()
    const publicationRelease = yield* Deferred.make<void>()
    const occurrences = yield* Ref.make(0)
    const cursor = yield* makeStoryCursor([{ _tag: "TaskClaimCurrentReadReturned", taskId }], {
      onOccurrence: ({ item }) =>
        item._tag === "TaskClaimCurrentReadReturned"
          ? Ref.update(occurrences, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(publicationEntered, undefined)),
              Effect.andThen(Deferred.await(publicationRelease))
            )
          : Effect.void
    })
    const base = yield* TrackerMutation.pipe(Effect.provide(controlledTrackerMutationLayerFrom([])))
    const layer = controlledTrackerAuthorityLayer(cursor, base)
    const read = yield* Effect.gen(function* () {
      return yield* (yield* TrackerMutation).readTaskClaim(taskId)
    }).pipe(Effect.provide(layer), Effect.forkScoped)

    yield* Deferred.await(publicationEntered)
    const interruption = yield* Fiber.interrupt(read).pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    expect(interruption.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(publicationRelease, undefined)
    yield* Fiber.join(interruption)
    expect(Exit.isFailure(yield* Fiber.await(read))).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)
    expect(yield* Ref.get(occurrences)).toBe(1)

    const retry = yield* Effect.gen(function* () {
      return yield* (yield* TrackerMutation).readTaskClaim(taskId)
    }).pipe(Effect.provide(layer), Effect.exit)
    expect(Exit.isFailure(retry)).toBe(true)
    if (Exit.isFailure(retry)) {
      const defect = retry.cause.reasons.find(Cause.isDieReason)?.defect
      expect(defect).toBeInstanceOf(AuthoredCassetteInteractionMismatch)
      expect(defect).toMatchObject({ actual: `duplicate TaskClaimCurrentReadReturned(${taskId})` })
    }
    expect(yield* cursor.storyPosition).toBe(1)
    expect(yield* Ref.get(occurrences)).toBe(1)
  })
)

it.effect("fails closed at cursor and executor-projection boundaries", () =>
  Effect.gen(function* () {
    const requestId = TaskClaimReacquisitionRequestId.make("coverage-reacquisition")
    const cursor = yield* makeStoryCursor([
      { _tag: "OperatorDirectsTaskClaimReacquisition", requestId, taskId: TaskId.make("A") }
    ])
    expect(Option.isNone(yield* cursor.consumeAttemptChoiceRace)).toBe(true)
    expect(yield* cursor.consumeClaimReacquisitionDirection).toEqual(
      Option.some({ _tag: "OperatorDirectsTaskClaimReacquisition", requestId, taskId: TaskId.make("A") })
    )
    const emptyCursor = yield* makeStoryCursor([])
    expect(yield* emptyCursor.consumeExecutorReport.pipe(Effect.flip)).toMatchObject({ expected: "EndOfStory" })

    const runId = RunId.make("coverage-executor-projection-run")
    const correlation = { attemptId: AttemptId.make("coverage-executor-projection-attempt"), runId }
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
    const unresolved = yield* Ref.make<ReadonlySet<string>>(
      new Set([plannedAttemptExecutorCorrelationKey(correlation)])
    )
    const missingProjectionExit = yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      return yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })
    }).pipe(
      Effect.provide(controlledExecutorLayer(emptyCursor, runId, () => Effect.void, reports, unresolved)),
      Effect.exit
    )
    expect(Exit.isFailure(missingProjectionExit)).toBe(true)
    if (Exit.isFailure(missingProjectionExit)) {
      expect(Cause.pretty(missingProjectionExit.cause)).toContain("requires an explicit return")
    }

    const contradictoryCursor = yield* makeStoryCursor([
      {
        _tag: "PlannedAttemptExecutorProjectionReturned",
        report: { _tag: "ExecutorWorkExecuting", attemptId: AttemptId.make("another-projected-attempt") }
      }
    ])
    const foreignAttemptProjection = yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      return yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })
    }).pipe(
      Effect.provide(
        controlledExecutorLayer(
          contradictoryCursor,
          runId,
          () => Effect.void,
          yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map()),
          yield* Ref.make<ReadonlySet<string>>(new Set())
        )
      )
    )
    expect(foreignAttemptProjection).toMatchObject({ _tag: "NoReport", correlation })
    expect(yield* contradictoryCursor.storyPosition).toBe(0)

    const foreignRunId = RunId.make("coverage-executor-projection-foreign-run")
    const foreignRunCursor = yield* makeStoryCursor([
      {
        _tag: "PlannedAttemptExecutorProjectionReturned",
        report: { _tag: "ExecutorWorkExecuting", attemptId: correlation.attemptId }
      }
    ])
    const foreignRunProjection = yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      return yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })
    }).pipe(
      Effect.provide(
        controlledExecutorLayer(
          foreignRunCursor,
          foreignRunId,
          () => Effect.void,
          yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map()),
          yield* Ref.make<ReadonlySet<string>>(new Set())
        )
      )
    )
    expect(foreignRunProjection).toMatchObject({
      _tag: "CorrelationContradiction",
      expected: correlation,
      observed: { correlation: { attemptId: correlation.attemptId, runId: foreignRunId } }
    })
  })
)

it.effect("matches the strict A C D restart projection chain by exact AttemptId without command calls", () =>
  Effect.gen(function* () {
    const attemptA = AttemptId.make("attempt:A:0")
    const attemptC = AttemptId.make("attempt:C:2")
    const attemptD = AttemptId.make("attempt:D:3")
    const cursor = yield* makeStoryCursor(
      [attemptA, attemptC, attemptD].map((attemptId) => ({
        _tag: "PlannedAttemptExecutorProjectionReturned" as const,
        report: { _tag: "ExecutorWorkExecuting" as const, attemptId }
      }))
    )

    const foreign = yield* cursor.consumeExecutorProjectionFor(AttemptId.make("attempt:foreign:9"))
    expect(Option.isNone(foreign)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(0)

    expect(yield* cursor.consumeExecutorProjectionFor(attemptA)).toMatchObject({
      _tag: "Some",
      value: { report: { attemptId: attemptA } }
    })
    const duplicateA = yield* cursor.consumeExecutorProjectionFor(attemptA)
    expect(Option.isNone(duplicateA)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)

    expect(yield* cursor.consumeExecutorProjectionFor(attemptC)).toMatchObject({
      _tag: "Some",
      value: { report: { attemptId: attemptC } }
    })
    expect(yield* cursor.consumeExecutorProjectionFor(attemptD)).toMatchObject({
      _tag: "Some",
      value: { report: { attemptId: attemptD } }
    })
    expect(yield* cursor.storyPosition).toBe(3)
  })
)

it.effect("holds a delivery claim until the earlier operator control boundary completes", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("coverage-control-before-admission")
    const direction = {
      _tag: "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission" as const,
      direction: "Pause" as const,
      subject: { _tag: "Task" as const, taskId }
    }
    const claimRead = { _tag: "TaskClaimCurrentReadReturned" as const, taskId }
    const cursor = yield* makeStoryCursor([direction, claimRead])

    expect(yield* cursor.consumeControlDirection(direction)).toEqual(Option.some(direction))
    const claimant = yield* cursor.consumeTaskClaimReadFor(taskId).pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    expect(claimant.pollUnsafe()).toBeUndefined()

    yield* cursor.completeControlDirectionBeforeDeliveryActionAdmission
    expect(yield* Fiber.join(claimant)).toEqual(Option.some(claimRead))
  })
)

it.effect("projects reacquisition and non-exact executor evidence through the authored assertion boundary", () =>
  Effect.gen(function* () {
    const runId = RunId.make("coverage-authored-outcome-run")
    const taskId = TaskId.make("coverage-authored-outcome-task")
    const requestId = TaskClaimReacquisitionRequestId.make("coverage-authored-outcome-request")
    const direction = TaskClaimReacquisitionDirectedEvent.make({
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId,
      subject: { runId, taskId },
      version: workflowJournalEventVersion
    })
    const directionAssertions = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
      orchestration: null,
      protocol: [{ _tag: "TaskClaimReacquisitionDirected", requestId, taskId }],
      taskWork: { absences: [], results: [] }
    })
    expect(
      (yield* assertAuthoredExpectedBehavior(
        [
          {
            event: direction,
            key: describeJournalEvent(direction).expectedKey,
            position: JournalPosition.make(1),
            runId
          }
        ],
        directionAssertions
      )).protocolEvidence
    ).toEqual([{ _tag: "TaskClaimReacquisitionDirected", requestId, taskId }])

    const run = yield* runAuthoredScenarioCassette(runUnpauseDuringSuspensionRestartsAuthoredCassette)
    const projection = run.records.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
    if (projection?.event._tag !== "PlannedAttemptExecutorCommandProjectionObserved") {
      return yield* Effect.die("missing command projection")
    }
    const unavailable = PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal: projection.event.commandOrdinal,
      observation: { _tag: "ExecutorStateNoCurrentReport" },
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: projection.event.plannedAttempt,
      projectionOrdinal: projection.event.projectionOrdinal,
      version: workflowJournalEventVersion
    })
    const noEvidenceAssertions = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
      orchestration: [],
      protocol: null,
      taskWork: { absences: [], results: [] }
    })
    expect(
      (yield* assertAuthoredExpectedBehavior([{ ...projection, event: unavailable }], noEvidenceAssertions))
        .orchestrationEvidence
    ).toEqual([])
  })
)

it.effect("records both task fingerprints when Alice continues the exact attempt", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptContinuesAuthoredCassette)
    const planned = run.records.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
    const applied = run.records.find(({ event }) => event._tag === "AttemptChoiceApplied")?.event
    if (planned?._tag !== "TaskAttemptPlanned" || applied?._tag !== "AttemptChoiceApplied") {
      return yield* Effect.die("missing planned attempt or applied Continue")
    }

    expect(applied.subject.plannedAttempt.taskRevision).toBe(planned.operation.plannedAttempt.taskRevision)
    expect(applied.subject.observedTaskRevision).not.toBe(applied.subject.plannedAttempt.taskRevision)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("records one atomic P1 to P2 replacement before ordinary clean successor work", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptRestartsCleanlyAuthoredCassette)
    const replacement = run.records.find(({ event }) => event._tag === "PlannedAttemptReplaced")?.event
    const restart = run.records.find(
      ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
    )?.event
    if (replacement?._tag !== "PlannedAttemptReplaced") return yield* Effect.die("missing planned-attempt replacement")
    if (restart?._tag !== "AttemptChoiceApplied") return yield* Effect.die("missing applied Restart")

    expect(replacement.subject.plannedAttempt.attemptId).toBe("attempt:A:0")
    expect(replacement.successorPlan.plannedAttempt).toMatchObject({
      attemptId: "attempt:A:1",
      baseSha: "2222222222222222222222222222222222222222",
      branch: "refs/heads/dalph/attempt-A-1",
      taskRevision: restart.subject.observedTaskRevision,
      worktree: "/dalph/cassettes/attempt-A-1"
    })
    expect(run.records.filter(({ event }) => event._tag === "PlannedAttemptReplaced")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
    const missingRestartProjection = yield* projectWorkflowOccurrences(
      run.records.filter(
        ({ event }) => event._tag !== "AttemptChoiceApplied" || event.choice !== "RestartTaskImplementation"
      )
    ).pipe(Effect.flip)
    expect(missingRestartProjection._tag).toBe("SchemaError")
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("reconstructs P2 after replacement and never allocates P3", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptRestartAfterSupersessionCrashAuthoredCassette)
    const replacements = run.records.flatMap(({ event }) => (event._tag === "PlannedAttemptReplaced" ? [event] : []))

    expect(run.activationOrdinals).toEqual([1, 2, 3])
    expect(replacements).toHaveLength(1)
    expect(replacements[0]?.successorPlan.plannedAttempt.attemptId).toBe("attempt:A:1")
    expect(run.records.some(({ event }) => JSON.stringify(event).includes("attempt:A:2"))).toBe(false)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("records no P2 when fresh restart authority is changed, unreadable, or non-ready", () =>
  Effect.gen(function* () {
    for (const cassette of [
      changedAttemptRestartFactsChangedAuthoredCassette,
      changedAttemptRestartClaimUnavailableAuthoredCassette,
      changedAttemptRestartWorktreeNotReadyAuthoredCassette
    ]) {
      const run = yield* runAuthoredScenarioCassette(cassette)
      expect(run.records.filter(({ event }) => event._tag === "PlannedAttemptReplaced")).toHaveLength(0)
      expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(0)
      expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
    }
  })
)

it.effect("cancels an admitted but unissued Resume when Restart wins, then starts only P2", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptRestartCancelsHeldResumeAuthoredCassette)
    const restartAt = run.records.findIndex(
      ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
    )
    const laterCommands = run.records
      .slice(restartAt + 1)
      .flatMap(({ event }) => (event._tag === "PlannedAttemptExecutorCommandIntended" ? [event.command] : []))

    expect(restartAt).toBeGreaterThan(0)
    expect(laterCommands).toEqual(["Begin"])
    expect(run.records.filter(({ event }) => event._tag === "PlannedAttemptReplaced")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleaseIntended")).toBe(false)
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
  })
)

it.effect("cancels held Resume but records no P2 when the fresh Restart specification changed again", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      changedAttemptRestartCancelsHeldResumeBeforeChangedFactsAuthoredCassette
    )
    const restartAt = run.records.findIndex(
      ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
    )
    expect(restartAt).toBeGreaterThan(0)
    expect(run.records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
    expect(
      run.records.some(
        ({ event }, index) =>
          index > restartAt && event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
      )
    ).toBe(false)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.attemptId === "attempt:A:0"
      )
    ).toBe(false)
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
  })
)

it.effect("rejects Restart after integration without appending a choice or crossing another boundary", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptRestartPastIntegrationRejectedAuthoredCassette)

    expect(run.records.some(({ event }) => event._tag === "IntegrationStarted")).toBe(true)
    expect(
      run.records.some(
        ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
      )
    ).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "PlannedAttemptReplaced")).toBe(false)
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
  })
)

it.effect("never claims the executor incorporated changed instructions", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptContinuesAuthoredCassette)
    const plans = run.records.flatMap(({ event }) => (event._tag === "TaskAttemptPlanned" ? [event] : []))
    const choice = run.records.find(({ event }) => event._tag === "AttemptChoiceApplied")?.event
    if (choice?._tag !== "AttemptChoiceApplied") return yield* Effect.die("missing applied Continue")

    expect(plans).toHaveLength(1)
    expect(choice.subject.plannedAttempt).toEqual(plans[0]?.operation.plannedAttempt)
    expect(choice.subject.observedTaskRevision).not.toBe(plans[0]?.operation.plannedAttempt.taskRevision)
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === choice.subject.plannedAttempt.attemptId
      )
    ).not.toHaveLength(0)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("coalesces exact Continue redelivery and rejects request identity reuse", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptContinuesAuthoredCassette)

    expect(run.records.filter(({ event }) => event._tag === "AttemptChoiceApplied")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "AttemptImplementationAbandoned")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("requires a new choice when instructions change again before continuation", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAgainAttemptRequiresNewChoiceAuthoredCassette)
    const choices = run.records.flatMap(({ event }) => (event._tag === "AttemptChoiceApplied" ? [event] : []))

    expect(choices).toHaveLength(2)
    expect(choices.map(({ choice }) => choice)).toEqual(["ContinueExistingAttempt", "StopTaskImplementation"])
    expect(choices[0]?.subject.plannedAttempt).toEqual(choices[1]?.subject.plannedAttempt)
    expect(choices[0]?.subject.observedTaskRevision).not.toBe(choices[1]?.subject.observedTaskRevision)
    expect(choices[1]?.subject.plannedAttempt.taskRevision).not.toBe(choices[1]?.subject.observedTaskRevision)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("lets the first journaled valid choice win a concurrent Continue and Stop race", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptChoiceRaceAuthoredCassette)
    const choices = run.records.flatMap(({ event }) => (event._tag === "AttemptChoiceApplied" ? [event] : []))

    expect(choices).toHaveLength(1)
    expect(["ContinueExistingAttempt", "StopTaskImplementation"]).toContain(choices[0]?.choice)
    expect(choices[0]?.subject.observedTaskRevision).not.toBe(choices[0]?.subject.plannedAttempt.taskRevision)
    expect(run.records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("reopens Continue and performs fresh reads before admitting the same attempt", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptContinuesAuthoredCassette)
    const choiceAt = run.records.findIndex(({ event }) => event._tag === "AttemptChoiceApplied")
    const continuedAt = run.records.findIndex(
      ({ event }, index) => index > choiceAt && event._tag === "PlannedAttemptExecutorCommandIntended"
    )
    const between = run.records.slice(choiceAt + 1, continuedAt).map(({ event }) => event._tag)
    const planned = run.records.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
    const choice = run.records[choiceAt]?.event

    expect(choiceAt).toBeGreaterThan(0)
    expect(run.activationOrdinals).toEqual([1, 2, 3])
    const firstLaterActivationFrame = run.deliveryFrames.findIndex(({ activationOrdinal }) => activationOrdinal === 2)
    expect(firstLaterActivationFrame).toBeGreaterThan(0)
    expect(
      run.deliveryFrames.slice(firstLaterActivationFrame).every(({ activationOrdinal }) => activationOrdinal >= 2)
    ).toBe(true)
    expect(continuedAt).toBeGreaterThan(choiceAt)
    expect(between).toEqual([
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "GitReadIntentRecorded",
      "PlannedAttemptWorktreeObserved",
      "GitReadIntentRecorded",
      "TargetLineageObserved",
      "PlannedAttemptContinuationAuthorized"
    ])
    expect(planned).toMatchObject({
      _tag: "TaskAttemptPlanned",
      operation: { plannedAttempt: { attemptId: "attempt:A:0" } }
    })
    if (planned?._tag !== "TaskAttemptPlanned" || choice?._tag !== "AttemptChoiceApplied") {
      return yield* Effect.die("missing planned attempt or Continue application")
    }
    expect(choice.subject.plannedAttempt).toEqual(planned.operation.plannedAttempt)
    expect(choice.subject.observedTaskRevision).not.toBe(planned.operation.plannedAttempt.taskRevision)
    expect(run.records.filter(({ event }) => event._tag === "AttemptChoiceApplied")).toHaveLength(1)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("releases only the freshly confirmed exact claim after Stop", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopsAndReleasesAuthoredCassette)
    const choiceAt = run.records.findIndex(({ event }) => event._tag === "AttemptChoiceApplied")
    const abandonedAt = run.records.findIndex(({ event }) => event._tag === "AttemptImplementationAbandoned")
    const readAt = run.records.findIndex(
      ({ event }, index) =>
        index > abandonedAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFacts"
    )
    const releaseIntentAt = run.records.findIndex(({ event }) => event._tag === "TaskClaimReleaseIntended")
    const releasedAt = run.records.findIndex(({ event }) => event._tag === "TaskClaimReleased")

    expect(choiceAt).toBeGreaterThan(0)
    expect(abandonedAt).toBeGreaterThan(choiceAt)
    expect(readAt).toBeGreaterThan(abandonedAt)
    expect(releaseIntentAt).toBeGreaterThan(readAt)
    expect(releasedAt).toBeGreaterThan(releaseIntentAt)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("proves the exact executor stopped before abandoning implementation responsibility", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopsAndReleasesAuthoredCassette)
    const safe = run.records.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkSafelySuspended"
    )?.event
    const abandoned = run.records.find(({ event }) => event._tag === "AttemptImplementationAbandoned")?.event
    if (safe?._tag !== "PlannedAttemptExecutorWorkReported" || abandoned?._tag !== "AttemptImplementationAbandoned") {
      return yield* Effect.die("missing exact safe report or abandonment")
    }

    expect(safe.report.correlation.attemptId).toBe(abandoned.subject.plannedAttempt.attemptId)
    expect(safe.report.correlation.runId).toBe(abandoned.subject.plannedAttempt.runId)
    expect(abandoned.proof).toEqual({ _tag: "AcceptedReport", reportOrdinal: safe.ordinal })
    expect(
      run.records.some(
        ({ event }, index) =>
          index > run.records.findIndex(({ event: candidate }) => candidate === safe) &&
          index < run.records.findIndex(({ event: candidate }) => candidate === abandoned) &&
          event._tag === "PlannedAttemptExecutorCommandIntended"
      )
    ).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("coalesces exact Stop redelivery and rejects request identity reuse", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopsAndReleasesAuthoredCassette)

    expect(run.records.filter(({ event }) => event._tag === "AttemptChoiceApplied")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(1)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("stops implementation without mutating an absent or foreign claim", () =>
  Effect.gen(function* () {
    for (const cassette of [
      changedAttemptStopsWithAbsentClaimAuthoredCassette,
      changedAttemptStopsWithForeignClaimAuthoredCassette
    ]) {
      const run = yield* runAuthoredScenarioCassette(cassette)
      expect(run.records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
      expect(run.records.some(({ event }) => event._tag === "TaskClaimReleaseIntended")).toBe(false)
      expect(run.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
      expect(run.records.filter(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")).toHaveLength(1)
      const recorded = yield* projectRecordedCassette(run.records)
      expectRecordedRoundTrip(run.records, recorded)
    }
  })
)

it.effect("preserves worktree WIP session history and evidence after Stop", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopsAndReleasesAuthoredCassette)
    const tags = run.records.map(({ event }) => event._tag)
    const stopAt = run.records.findIndex(({ event }) => event._tag === "AttemptChoiceApplied")
    const plan = run.records.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
    const worktree = run.records.find(({ event }) => event._tag === "TaskWorktreeReady")?.event
    const executor = run.records.find(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )?.event
    const safe = run.records.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkSafelySuspended"
    )?.event
    const abandoned = run.records.find(({ event }) => event._tag === "AttemptImplementationAbandoned")?.event
    if (
      plan?._tag !== "TaskAttemptPlanned" ||
      worktree?._tag !== "TaskWorktreeReady" ||
      executor?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan" ||
      safe?._tag !== "PlannedAttemptExecutorWorkReported" ||
      abandoned?._tag !== "AttemptImplementationAbandoned"
    ) {
      return yield* Effect.die("settled Stop lost exact planned-attempt resource history")
    }

    expect(stopAt).toBeGreaterThan(0)
    expect(run.records.slice(0, stopAt)).toContainEqual(expect.objectContaining({ event: plan }))
    expect(run.records.slice(0, stopAt)).toContainEqual(expect.objectContaining({ event: worktree }))
    expect(run.records.slice(0, stopAt)).toContainEqual(expect.objectContaining({ event: executor }))
    expect(run.records.slice(0, stopAt)).toContainEqual(expect.objectContaining({ event: safe }))
    expect(worktree.proof).toMatchObject({
      baseSha: plan.operation.plannedAttempt.baseSha,
      branch: plan.operation.plannedAttempt.branch,
      worktree: plan.operation.plannedAttempt.worktree
    })
    expect(executor.plannedAttempt).toEqual(plan.operation.plannedAttempt)
    expect(abandoned.subject.plannedAttempt).toEqual(plan.operation.plannedAttempt)
    expect(abandoned.proof).toEqual({ _tag: "AcceptedReport", reportOrdinal: safe.ordinal })
    expect(tags).not.toContain("WorkflowRunTerminated")
    expect(tags).not.toContain("IntegrationResponsibilityBegan")
    expect(tags).not.toContain("IntegrationStarted")
    expect(tags.some((tag) => tag.includes("Cleanup") || tag.includes("DeleteWorktree"))).toBe(false)
    const authoredStopAt = changedAttemptStopsAndReleasesAuthoredCassette.story.findIndex(
      (item) => item._tag === "OperatorStopsAttempt"
    )
    expect(
      changedAttemptStopsAndReleasesAuthoredCassette.story
        .slice(authoredStopAt + 1)
        .flatMap((item) => (item._tag === "DalphSelects" ? [item.operation._tag] : []))
    ).toEqual(["ReadTrackerGraph", "ReadTaskClaim", "ReleaseTaskClaim"])
    expect(reduceWorkflowJournalHistory(run.runId, run.records)._tag).toBe("ValidWorkflowJournalHistory")
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("reconciles ambiguous suspension and claim release across later activations without duplicates", () =>
  Effect.gen(function* () {
    const [stoppage, run] = yield* Effect.all([
      runAuthoredScenarioCassette(runUnpauseDuringSuspensionRestartsAuthoredCassette),
      runAuthoredScenarioCassette(changedAttemptStopReleaseResponseLostAuthoredCassette)
    ])

    expect(run.activationOrdinals).toEqual([1, 2, 3, 4, 5])
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(0)
    expect(run.records.filter(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")).toHaveLength(1)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
    const stoppageRecorded = yield* projectRecordedCassette(stoppage.records)
    expectRecordedRoundTrip(stoppage.records, stoppageRecorded)
  })
)

it.effect("cancels held Resume before Stop and preserves a foreign claim", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopCancelsHeldResumeWithForeignClaimAuthoredCassette)
    const choiceAt = run.records.findIndex(({ event }) => event._tag === "AttemptChoiceApplied")
    const postStopExecutorIntents = run.records.flatMap(({ event }, index) =>
      index > choiceAt && event._tag === "PlannedAttemptExecutorCommandIntended" ? [{ event, index }] : []
    )

    expect(choiceAt).toBeGreaterThan(0)
    expect(postStopExecutorIntents).toEqual([])
    expect(run.records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleaseIntended")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
    expect(run.records.filter(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")).toHaveLength(1)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("preserves every exact attempt artifact after Stop cancels held Resume", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopCancelsHeldResumeWithForeignClaimAuthoredCassette)
    const plan = run.records.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
    const worktree = run.records.find(({ event }) => event._tag === "TaskWorktreeReady")?.event
    const responsibility = run.records.find(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )?.event
    if (
      plan?._tag !== "TaskAttemptPlanned" ||
      worktree?._tag !== "TaskWorktreeReady" ||
      responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan"
    ) {
      return yield* Effect.die("Stop lost its planned attempt resources")
    }

    expect(worktree.proof).toMatchObject({
      baseSha: plan.operation.plannedAttempt.baseSha,
      branch: plan.operation.plannedAttempt.branch,
      worktree: plan.operation.plannedAttempt.worktree
    })
    expect(responsibility.plannedAttempt).toEqual(plan.operation.plannedAttempt)
    expect(reduceWorkflowJournalHistory(run.runId, run.records)._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.filter(({ event }) => event._tag === "AttemptImplementationAbandoned")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleaseIntended")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "IntegrationStarted")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("uses the injected projection when the public Run entry reconstructs an ambiguous Suspend", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runUnpauseDuringSuspensionRestartsAuthoredCassette)
    const authoredProjections = runUnpauseDuringSuspensionRestartsAuthoredCassette.story.filter(
      (item) => item._tag === "PlannedAttemptExecutorProjectionReturned"
    )
    const suspendIntents = run.records.flatMap(({ event }, index) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend" ? [{ event, index }] : []
    )
    const suspend = suspendIntents[0]
    if (suspend === undefined) return yield* Effect.die("missing admitted Suspend command")
    const projectionAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
        event.commandOrdinal === suspend.event.ordinal &&
        event.observation._tag === "ExactExecutorReport" &&
        event.observation.report._tag === "ExecutorWorkSafelySuspended"
    )
    const recordedProjections = run.records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
        event._tag === "PlannedAttemptExecutorStateObserved"
    )

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(suspendIntents).toHaveLength(1)
    expect(projectionAt).toBeGreaterThan(suspend.index)
    expect(recordedProjections).toHaveLength(authoredProjections.length)
    expect(
      recordedProjections.every(
        ({ event }) =>
          (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
            event._tag === "PlannedAttemptExecutorStateObserved") &&
          event.plannedAttempt.runId === suspend.event.plannedAttempt.runId &&
          event.plannedAttempt.attemptId === suspend.event.plannedAttempt.attemptId
      )
    ).toBe(true)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("rejects Continue and Stop after the exact integration cutoff", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(postIntegrationAttemptChoiceRejectedAuthoredCassette)
    const planned = run.records.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
    const authoredRevisions = postIntegrationAttemptChoiceRejectedAuthoredCassette.story.flatMap((item) =>
      item._tag === "OperatorContinuesAttempt" || item._tag === "OperatorStopsAttempt"
        ? [item.observedTaskRevision]
        : []
    )

    expect(run.records.filter(({ event }) => event._tag === "AttemptChoiceApplied")).toHaveLength(0)
    expect(planned?._tag).toBe("TaskAttemptPlanned")
    if (planned?._tag !== "TaskAttemptPlanned") return yield* Effect.die("missing accepted planned attempt")
    expect(new Set(authoredRevisions).size).toBe(1)
    expect(authoredRevisions[0]).not.toBe(planned.operation.plannedAttempt.taskRevision)
    expect(run.records.filter(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "IntegrationStarted")).toHaveLength(1)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("does not cross cleanup or integration boundaries for a stale direction", () =>
  Effect.gen(function* () {
    const [baseline, stale] = yield* Effect.all([
      runAuthoredScenarioCassette(acceptedResultRestartsIntoIntegrationAuthoredCassette),
      runAuthoredScenarioCassette(postIntegrationAttemptChoiceRejectedAuthoredCassette)
    ])
    const boundaryTags = new Set([
      "IntegrationResponsibilityBegan",
      "IntegrationStarted",
      "PlannedAttemptExecutorCommandIntended",
      "TaskClaimReleaseIntended",
      "TaskClaimReleased"
    ])
    const boundaries = (records: ReadonlyArray<JournalRecord>) =>
      records.flatMap(({ event }) => (boundaryTags.has(event._tag) ? [event._tag] : []))

    expect(stale.records.map(({ event }) => event._tag)).toEqual(baseline.records.map(({ event }) => event._tag))
    expect(boundaries(stale.records)).toEqual(boundaries(baseline.records))
    expect(stale.records.some(({ event }) => event._tag.includes("Cleanup"))).toBe(false)
    expect(stale.records.filter(({ event }) => event._tag === "AttemptChoiceApplied")).toHaveLength(0)
    for (const run of [baseline, stale]) {
      const recorded = yield* projectRecordedCassette(run.records)
      expectRecordedRoundTrip(run.records, recorded)
    }
  })
)

it.effect("durably reconciles an unresolved claim release through bounded later activations", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopReleaseResponseLostAuthoredCassette)
    const intentAt = run.records.findIndex(({ event }) => event._tag === "TaskClaimReleaseIntended")
    const observations = run.records.filter(
      ({ event }, index) =>
        index > intentAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFacts"
    )
    const unreadableAt = run.records.findIndex(
      ({ event }, index) =>
        index > intentAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFactsUnreadable"
    )
    const observationAt = run.records.findIndex(
      ({ event }, index) =>
        index > unreadableAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFacts"
    )
    const settledAt = run.records.findIndex(({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved")

    expect(intentAt).toBeGreaterThan(0)
    expect(unreadableAt).toBeGreaterThan(intentAt)
    expect(observationAt).toBeGreaterThan(intentAt)
    expect(settledAt).toBeGreaterThan(observationAt)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(
      run.records.filter(
        ({ event }, index) =>
          index > intentAt && event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskClaim"
      )
    ).toHaveLength(2)
    expect(observations).toHaveLength(1)
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("does not create a Pause view after Alice's stale task request is rejected", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(staleTaskPauseRejectedAuthoredCassette)
    const tags = run.records.map(({ event }) => event._tag)
    const observationStory = staleTaskPauseRejectedAuthoredCassette.story.filter(
      ({ _tag }) => _tag === "OperatorStartsPauseObservation" || _tag === "PauseProgressObserved"
    )

    expect(tags).toContain("TaskTrackerReadIntentRecorded")
    expect(tags).toContain("TaskTrackerFactsObserved")
    expect(tags).not.toContain("ControlDirectionApplied")
    expect(tags).not.toContain("TaskClaimAcquisitionIntended")
    expect(tags).not.toContain("PlannedAttemptExecutorWorkResponsibilityBegan")
    expect(renderAuthoredCassetteLyrics(staleTaskPauseRejectedAuthoredCassette)).toContain(
      "Dalph rejects Operator Pause for task A: OutsideCurrentTargetClosure."
    )
    expect(observationStory).toEqual([
      { _tag: "OperatorStartsPauseObservation", subject: { _tag: "Task", taskId: "A" } },
      { _tag: "PauseProgressObserved", result: { _tag: "PauseNotApplied" }, subject: { _tag: "Task", taskId: "A" } }
    ])
    expect(renderAuthoredCassetteLyrics(staleTaskPauseRejectedAuthoredCassette)).toContain(
      "Alice asks to observe Pause progress for task A."
    )
    expect(renderAuthoredCassetteLyrics(staleTaskPauseRejectedAuthoredCassette)).toContain(
      "Alice receives PauseNotApplied from the process-local Pause observation."
    )

    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries.some(({ _tag }) => _tag === "ControlDirectionApplied")).toBe(false)
    expect(recorded.entries.some(({ _tag }) => _tag === "TaskTrackerFactsObserved")).toBe(true)
    expect(recorded.entries).toHaveLength(run.records.length)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("shows an incomplete control read without recording a direction", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(unreadableTaskUnpauseRejectedAuthoredCassette)
    const tags = run.records.map(({ event }) => event._tag)

    expect(tags.filter((tag) => tag === "TaskTrackerReadIntentRecorded")).toHaveLength(3)
    expect(tags.filter((tag) => tag === "TaskTrackerFactsObserved")).toHaveLength(3)
    expect(tags).not.toContain("ControlDirectionApplied")
    expect(renderAuthoredCassetteLyrics(unreadableTaskUnpauseRejectedAuthoredCassette)).toContain(
      "Dalph rejects Operator Unpause for task A: IncompleteSnapshot."
    )
  })
)

it.effect("pauses A and its grouping child while recording only A's direction", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseCoversGroupingChildAuthoredCassette)
    const waiting = taskPauseCoversGroupingChildAuthoredCassette.story.find(
      (item) => item._tag === "PauseProgressObserved"
    )

    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "ControlDirectionApplied" ? [{ direction: event.direction, subject: event.subject }] : []
      )
    ).toEqual([{ direction: "Pause", subject: { _tag: "Task", runId: run.runId, taskId: "A" } }])
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A"])
    expectCompleteCurrentGraphReadsBeforeFirstClaim(run.records, [TaskId.make("A"), TaskId.make("B")])
    expect(waiting).toEqual({
      _tag: "PauseProgressObserved",
      result: {
        _tag: "PauseWaiting",
        atBoundary: [],
        preventing: [
          {
            blockers: [
              { _tag: "ExecutorSafeSuspensionRequired", attemptId: "attempt:A:0" },
              {
                _tag: "ProposedDeliveryAction",
                proposal: {
                  _tag: "IdentityFreeWorkflowRoute",
                  correlation: { _tag: "PlannedAttempt", attemptId: "attempt:A:0" },
                  proposalId:
                    '["IdentityFreeWorkflowRoute","SuspendPlannedAttemptExecutorWork","attempt:A:0",null,"A"]',
                  taskId: "A"
                }
              }
            ],
            responsibility: {
              _tag: "PlannedAttemptExecutorWork",
              attemptId: "attempt:A:0",
              beganAt: 26,
              coverage: { _tag: "ExactTaskPauseCoverage" },
              taskId: "A"
            }
          }
        ]
      },
      subject: { _tag: "Task", taskId: "A" }
    })
    expect(renderAuthoredCassetteLyrics(taskPauseCoversGroupingChildAuthoredCassette)).toContain(
      "Alice receives PauseWaiting from the process-local Pause observation."
    )
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId: "attempt:A:0",
      report: "ExecutorWorkSafelySuspended"
    })
    const recorded = yield* projectRecordedCassette(run.records)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("lets independent B use capacity only after paused A confirms suspension", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseLetsIndependentTaskContinueAuthoredCassette)
    const aSuspendedAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:A:0" &&
        event.report._tag === "ExecutorWorkSafelySuspended"
    )
    const bResponsibilityAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.attemptId === "attempt:B:1"
    )

    expect(aSuspendedAt).toBeGreaterThan(0)
    expect(bResponsibilityAt).toBeGreaterThan(aSuspendedAt)
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A", "B"])
  })
)

it.effect("finishes an already-held integration boundary after task Pause without later cleanup", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseFinishesHeldIntegrationAuthoredCassette)
    const tags = run.records.map(({ event }) => event._tag)
    const pauseAt = tags.indexOf("ControlDirectionApplied")
    const intentAt = tags.indexOf("IntegratorRunCandidateGitReadIntended")
    const qualifiedAt = tags.indexOf("IntegratorRunCandidateGitObserved")

    expect(pauseAt).toBeGreaterThan(0)
    expect(pauseAt).toBeGreaterThan(intentAt)
    expect(qualifiedAt).toBeGreaterThan(0)
    expect(tags.slice(pauseAt + 1)).not.toContain("TaskClaimReleaseIntended")
    if (run.history._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("held-integration pause cassette must retain valid journal history")
    }
    const integrationBeganAt = run.records.find(
      ({ event }) => event._tag === "IntegrationResponsibilityBegan"
    )?.position
    if (integrationBeganAt === undefined) return yield* Effect.die("expected held integration responsibility")
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set([integrationBeganAt]),
        integrationTarget: Option.none(),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).transitions
    ).toContainEqual(
      expect.objectContaining({
        _tag: "ReleaseStartedIntegrationTarget",
        responsibility: expect.objectContaining({ queuedAt: integrationBeganAt })
      })
    )
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.none(),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).transitions
    ).toEqual([])
  })
)

it.effect("freshly rereads preserved task authorities before resuming after task Unpause", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskUnpauseAfterSafeSuspensionAuthoredCassette)
    const unpauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" &&
        event.direction === "Unpause" &&
        event.subject._tag === "Task" &&
        event.subject.taskId === "A"
    )
    const afterUnpause = run.records.slice(unpauseAt + 1)
    const suspendedAt = afterUnpause.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkSafelySuspended"
    )
    const resumedAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
    )

    expect(unpauseAt).toBeGreaterThan(0)
    expect(suspendedAt).toBeGreaterThanOrEqual(0)
    expect(resumedAt).toBeGreaterThan(suspendedAt)
    expect(afterUnpause.slice(suspendedAt + 1, resumedAt).map(({ event }) => event._tag)).toEqual([
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "GitReadIntentRecorded",
      "PlannedAttemptWorktreeObserved",
      "GitReadIntentRecorded",
      "TargetLineageObserved",
      "PlannedAttemptContinuationAuthorized",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved"
    ])
  })
)

it.effect("reopens after task Unpause and finishes suspension before executor work", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskUnpauseDuringSuspensionRestartsAuthoredCassette)

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(exactExecutorReportTags(run.records)).toEqual([
      "ExecutorWorkExecuting",
      "ExecutorWorkSafelySuspended",
      "ExecutorWorkSafelySuspended",
      "ExecutorWorkTerminal"
    ])
  })
)

it.effect("stops before the next forward operation after Alice pauses the Run", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runPauseSafelySuspendsAuthoredCassette)
    const pauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
    )
    const afterPause = run.records.slice(pauseAt + 1)

    expect(pauseAt).toBeGreaterThan(0)
    expectCompleteCurrentGraphReadsBeforeFirstClaim(run.records, [TaskId.make("A"), TaskId.make("B")])
    expect(
      run.records.some(
        ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.taskId === TaskId.make("B")
      )
    ).toBe(true)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          event.plannedAttempt.taskId === TaskId.make("B")
      )
    ).toBe(false)
    expect(
      afterPause.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
      )
    ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
    expect(afterPause.some(({ event }) => event._tag === "TaskTrackerFactsObserved")).toBe(false)
    expect(afterPause.some(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toBe(false)
    expect(run.history).toMatchObject({
      _tag: "ValidWorkflowJournalHistory",
      runState: { pause: { run: { _tag: "RunPaused" }, tasks: { _tag: "NoTaskPauses" } } }
    })
    const recorded = yield* projectRecordedCassette(run.records)
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
  })
)

it.effect("cancelling Alice's Pause observation does not cancel delivery or authorize cleanup", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runPauseObservationDisconnectsAuthoredCassette)
    const views = runPauseObservationDisconnectsAuthoredCassette.story.flatMap((item) =>
      item._tag === "PauseProgressObserved" || item._tag === "PauseProgressObservedCancelledAndReconnected"
        ? [item.result._tag]
        : []
    )

    expect(views).toEqual(["PauseWaiting"])
    expect(
      runPauseObservationDisconnectsAuthoredCassette.story.some(
        ({ _tag }) => _tag === "PauseProgressObservedCancelledAndReconnected"
      )
    ).toBe(true)
    expect(
      runPauseObservationDisconnectsAuthoredCassette.story.find(
        ({ _tag }) => _tag === "PauseProgressObservedCancelledAndReconnected"
      )
    ).toMatchObject({ reconnectResult: { _tag: "PauseConfirmed" }, reconnectSubject: { _tag: "Run" } })
    expect(run.records.filter(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskWorktreeReady")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")).toBe(false)
    expect(
      runPauseObservationDisconnectsAuthoredCassette.story.some(
        ({ _tag }) => _tag === "GitPlannedWorktreeCreateResponseLost"
      )
    ).toBe(true)
    expect(
      run.records.filter(({ event }) => event._tag === "ControlDirectionApplied" && event.direction === "Unpause")
    ).toHaveLength(0)
    expect(run.records.some(({ event }) => event._tag.includes("Cleanup"))).toBe(false)
    expect(run.records.some(({ event }) => event._tag.includes("PauseProgress"))).toBe(false)
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
  })
)

it.effect("Alice unpauses task A before its Pause observation confirms", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseObservationUnpausedAuthoredCassette)
    expect(taskPauseObservationUnpausedAuthoredCassette.name).toBe(
      "Alice unpauses task A before its Pause observation confirms"
    )
    expectCompleteCurrentGraphReadsBeforeFirstClaim(run.records, [TaskId.make("A"), TaskId.make("B")])
    expect(
      run.records
        .filter(({ event }) => event._tag === "ControlDirectionApplied")
        .map(({ event }) => (event._tag === "ControlDirectionApplied" ? event.direction : null))
    ).toEqual(["Pause", "Unpause"])
    expect(taskPauseObservationUnpausedAuthoredCassette.story).toContainEqual(
      expect.objectContaining({
        _tag: "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting",
        duringAttemptId: "attempt:A:0",
        subject: { _tag: "Task", taskId: "A" }
      })
    )
    expect(run.records.some(({ event }) => event._tag.includes("PauseProgress"))).toBe(false)
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
  })
)

it.effect("Alice sees current grouping facts add D to task A's Pause", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskPauseGroupingFactsAddedAuthoredCassette)
    const dSafe = run.records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:D:1" &&
        event.report._tag === "ExecutorWorkSafelySuspended"
    )
    expect(taskPauseGroupingFactsAddedAuthoredCassette.name).toBe(
      "Alice sees current grouping facts add D to task A's Pause"
    )
    expect(dSafe).toHaveLength(2)
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
  })
)

it.effect("Alice sees task A and grouping child D reach their exact Pause boundaries", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.taskPauseExecutorAndPromotionBoundaries
    )
    const recorded = yield* projectRecordedCassette(run.records)

    expect(run.records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "ControlDirectionApplied" &&
          event.direction === "Pause" &&
          event.subject._tag === "Task" &&
          event.subject.taskId === "A"
      )
    ).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "AttemptImplementationAbandoned")).toBe(false)
    expect(run.records.some(({ event }) => event._tag.includes("Cleanup"))).toBe(false)
    expect(run.records.some(({ event }) => event._tag.includes("PauseProgress"))).toBe(false)
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("restarts a confirmed paused Run without selecting new forward progress", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runPauseRestartsPassivelyAuthoredCassette)
    const pauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
    )
    const afterPause = run.records.slice(pauseAt + 1)

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(pauseAt).toBeGreaterThan(0)
    expectCompleteCurrentGraphReadsBeforeFirstClaim(run.records, [TaskId.make("A"), TaskId.make("B")])
    expect(afterPause.some(({ event }) => event._tag === "TaskTrackerFactsObserved")).toBe(false)
    expect(
      afterPause.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report._tag] : []
      )
    ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
    expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
  })
)

it.effect("accepts successful recovered completion at the terminal assertion boundary", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runPauseRestartsPassivelyAuthoredCassette)

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(run.cassette.story.at(-1)?._tag).toBe("ExpectedBehavior")
    expect(run.observedBehavior).toBeDefined()
  })
)

it.effect("Dalph confirms A before a later graph read releases B", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(deliveryFinalitySpineAuthoredCassette)
    const focusedSuccessAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    )
    const laterGraphAt = run.records.findIndex(
      ({ event }, index) =>
        index > focusedSuccessAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies[0].contentIdentity === TrackerRevision.make("delivery-story-G6")
    )
    const dependantClaimAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("B")
    )
    expect(focusedSuccessAt).toBeGreaterThanOrEqual(0)
    expectFocusedCompletionReadCorrelation(run.records, focusedSuccessAt)
    expect(laterGraphAt).toBeGreaterThan(focusedSuccessAt)
    expect(dependantClaimAt).toBeGreaterThan(laterGraphAt)
    expect(
      run.deliveryFrames.some(({ frontier }) =>
        frontier.some(
          ({ reasons, standing, taskId }) =>
            taskId === "B" && standing === "Excluded" && reasons.some(({ kind }) => kind === "PrerequisitesIncomplete")
        )
      )
    ).toBe(true)
    expect(
      run.deliveryFrames.some(
        ({ actionPlanning, frontier, graph }) =>
          graph._tag === "Established" &&
          graph.revision === TrackerRevision.make("delivery-story-G6") &&
          frontier.some(({ standing, taskId }) => taskId === "B" && standing === "Eligible") &&
          actionPlanning._tag === "DeliveryProposalsAvailable" &&
          actionPlanning.proposals.some(({ taskId }) => taskId === "B")
      )
    ).toBe(true)
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toHaveLength(1)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("Dalph checks A after losing the tracker completion response", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(ambiguousCompletionResponseAuthoredCassette)
    const responseLostAt = run.records.findIndex(({ event }) => event._tag === "CompletionTaskResponseLost")
    const focusedSuccessAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    )
    const laterGraphAt = run.records.findIndex(
      ({ event }, index) =>
        index > focusedSuccessAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies[0].contentIdentity === TrackerRevision.make("delivery-story-G6")
    )
    const dependantClaimAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("B")
    )
    expect(responseLostAt).toBeGreaterThanOrEqual(0)
    expect(focusedSuccessAt).toBeGreaterThan(responseLostAt)
    expectFocusedCompletionReadCorrelation(run.records, focusedSuccessAt)
    expect(laterGraphAt).toBeGreaterThan(focusedSuccessAt)
    expect(dependantClaimAt).toBeGreaterThan(laterGraphAt)
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "CompletionTaskRequestLookupIntended")).toBe(false)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("Restart keeps B blocked between A's success confirmation and the later graph", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(completionGraphRefreshRecoveryAuthoredCassette)
    const focusedSuccessAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    )
    const laterGraphAt = run.records.findIndex(
      ({ event }, index) =>
        index > focusedSuccessAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies[0].contentIdentity === TrackerRevision.make("delivery-story-G6")
    )
    const dependantClaimAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("B")
    )
    expect(run.activationOrdinals.length).toBeGreaterThan(2)
    expect(focusedSuccessAt).toBeGreaterThanOrEqual(0)
    expectFocusedCompletionReadCorrelation(run.records, focusedSuccessAt)
    expect(laterGraphAt).toBeGreaterThan(focusedSuccessAt)
    expect(dependantClaimAt).toBeGreaterThan(laterGraphAt)
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toHaveLength(1)
    expect(run.records.some(({ event }) => /Crash|Death|Recovery/.test(event._tag))).toBe(false)
    expect(
      run.deliveryFrames.some(
        ({ activationOrdinal, frontier, graph }) =>
          Number(activationOrdinal) < run.activationOrdinals.length &&
          graph._tag === "Established" &&
          graph.revision !== TrackerRevision.make("delivery-story-G6") &&
          frontier.some(
            ({ reasons, standing, taskId }) =>
              taskId === "B" &&
              standing === "Excluded" &&
              reasons.some(({ kind }) => kind === "PrerequisitesIncomplete")
          )
      )
    ).toBe(true)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("the fresh complete graph blocks before a later edit can release B", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(currentCompletionGraphAuthorityAuthoredCassette)
    const firstCurrentGraphAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies[0].contentIdentity === TrackerRevision.make("delivery-story-G7")
    )
    const releasingGraphAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies[0].contentIdentity === TrackerRevision.make("delivery-story-G8")
    )
    const dependantClaimAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("B")
    )
    expect(firstCurrentGraphAt).toBeGreaterThanOrEqual(0)
    expect(releasingGraphAt).toBe(-1)
    expect(dependantClaimAt).toBe(-1)
    expect(
      run.deliveryFrames.some(
        ({ frontier, graph }) =>
          graph._tag === "Established" &&
          graph.revision === TrackerRevision.make("delivery-story-G7") &&
          frontier.some(
            ({ reasons, standing, taskId }) =>
              taskId === "B" &&
              standing === "Excluded" &&
              reasons.some(({ kind }) => kind === "PrerequisitesIncomplete")
          )
      )
    ).toBe(true)
    expect(
      run.deliveryFrames.some(({ graph }) => graph._tag === "Established" && graph.revision === "delivery-story-G8")
    ).toBe(false)
    expect(run.records.some(({ event }) => /DependantRelease/.test(event._tag))).toBe(false)
    expect(run.records.some(({ event }) => /DependantRelease/.test(event._tag))).toBe(false)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Blocked" })
  })
)

it.effect("A tracker client changes A while Dalph's completion request is pending", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(completionTaskConflictAuthoredCassette)
    const rejection = run.records.find(({ event }) => event._tag === "CompletionTaskRejected")
    const terminalRead = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.purpose._tag === "Confirmation" &&
        event.observation.facts.lifecycle === "TerminalWithoutSuccess"
    )
    expectCompleteCurrentGraphReadsBeforeFirstClaim(run.records, [TaskId.make("A"), TaskId.make("C")])
    expect(rejection).toBeDefined()
    expect(terminalRead).toBeDefined()
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "CompletionClaimDeletionIntended")).toBe(false)
    const issue61ConflictFrames = run.deliveryFrames.filter(
      ({ graph }) => graph._tag === "Established" && String(graph.revision).startsWith("delivery-story-S3-")
    )
    expect(issue61ConflictFrames.length).toBeGreaterThan(0)
    expect(
      issue61ConflictFrames.every(
        ({ graph }) =>
          graph._tag === "Established" &&
          graph.tasks.some(({ id, prerequisiteIds }) => id === TaskId.make("C") && prerequisiteIds.length === 0) &&
          graph.tasks.some(
            ({ id, prerequisiteIds }) => id === TaskId.make("B") && prerequisiteIds.includes(TaskId.make("A"))
          )
      )
    ).toBe(true)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("B")
      )
    ).toBe(false)
    expect(
      run.deliveryFrames.some(
        ({ frontier, graph }) =>
          graph._tag === "Established" &&
          String(graph.revision).startsWith("delivery-story-S3-") &&
          graph.tasks.some(
            ({ id, prerequisiteIds }) => id === TaskId.make("B") && prerequisiteIds.includes(TaskId.make("A"))
          ) &&
          graph.tasks.some(({ id, prerequisiteIds }) => id === TaskId.make("C") && prerequisiteIds.length === 0) &&
          frontier.some(
            ({ reasons, standing, taskId }) =>
              taskId === "B" &&
              standing === "Excluded" &&
              reasons.some((reason) => reason.kind === "PrerequisitesIncomplete")
          ) &&
          frontier.some(({ standing, taskId }) => taskId === "C" && standing === "Eligible")
      )
    ).toBe(true)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("C")
      )
    ).toBe(true)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          event.plannedAttempt.taskId === TaskId.make("C")
      )
    ).toBe(true)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === AttemptId.make("attempt:C:1") &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Completed"
      )
    ).toBe(true)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("finishes the exact safe suspension before fresh reads after Unpause", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runUnpauseAfterSafeSuspensionAuthoredCassette)
    const unpauseAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" && event.direction === "Unpause" && event.subject._tag === "Run"
    )
    const afterUnpause = run.records.slice(unpauseAt + 1)
    const tags = afterUnpause.map(({ event }) => event._tag)
    const safelySuspendedAt = afterUnpause.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkSafelySuspended"
    )
    const graphAt = tags.indexOf("TaskTrackerFactsObserved")
    const specificationAt = afterUnpause.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
    )
    const claimAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
    )
    const worktreeAt = tags.indexOf("PlannedAttemptWorktreeObserved")
    const targetLineageAt = tags.indexOf("TargetLineageObserved")
    const terminalAt = afterUnpause.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
    )

    expect(unpauseAt).toBeGreaterThan(0)
    expect(tags[0]).toBe("PlannedAttemptExecutorCommandResponseObserved")
    expect(safelySuspendedAt).toBe(1)
    expect(graphAt).toBeGreaterThan(safelySuspendedAt)
    expect(specificationAt).toBeGreaterThan(graphAt)
    expect(claimAt).toBeGreaterThan(specificationAt)
    expect(worktreeAt).toBeGreaterThan(claimAt)
    expect(targetLineageAt).toBeGreaterThan(worktreeAt)
    expect(terminalAt).toBeGreaterThan(targetLineageAt)
    expect(run.history).toMatchObject({
      _tag: "ValidWorkflowJournalHistory",
      runState: { pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } } }
    })
    const recorded = yield* projectRecordedCassette(run.records)
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
  })
)

it.effect("reprojects the exact suspension on the second ordinary Run activation without a duplicate command", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runUnpauseDuringSuspensionRestartsAuthoredCassette)
    expect(run.activationOrdinals).toEqual([1, 2])
    expect(exactExecutorReportTags(run.records)).toEqual([
      "ExecutorWorkExecuting",
      "ExecutorWorkSafelySuspended",
      "ExecutorWorkSafelySuspended",
      "ExecutorWorkTerminal"
    ])
    const commandIntents = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" ? [event] : []
    )
    expect(commandIntents.map(({ command }) => command)).toEqual(["Begin", "Suspend", "Resume"])
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
          event.observation._tag === "ExactExecutorReport" &&
          event.observation.report._tag === "ExecutorWorkSafelySuspended"
      )
    ).toHaveLength(1)
  })
)

it.effect("applies an authored operator direction through the production control boundary", () =>
  Effect.gen(function* () {
    const firstRunning = singleton.story.findIndex(
      (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "ExecutorWorkExecuting"
    )
    const cassetteWith = (subject: { readonly _tag: "Run" } | { readonly _tag: "Task"; readonly taskId: TaskId }) => ({
      ...singleton,
      name: `the operator applies a ${subject._tag.toLowerCase()} unpause direction`,
      story: singleton.story.flatMap((item, index) => {
        const withExpectedProtocol =
          item._tag === "ExpectedBehavior"
            ? {
                ...item,
                protocol: [
                  { _tag: "TaskClaimAcquired" as const, taskId: TaskId.make("A") },
                  {
                    _tag: "TaskAttemptPlanned" as const,
                    attemptId: AttemptId.make("attempt:A:0"),
                    taskId: TaskId.make("A")
                  },
                  {
                    _tag: "TaskWorktreeReady" as const,
                    attemptId: AttemptId.make("attempt:A:0"),
                    taskId: TaskId.make("A")
                  },
                  { _tag: "ControlDirectionApplied" as const, direction: "Unpause" as const, subject }
                ]
              }
            : item
        return [
          withExpectedProtocol,
          ...(index === firstRunning
            ? [
                { _tag: "OperatorAppliesControlDirection" as const, direction: "Unpause" as const, subject },
                ...(subject._tag === "Task"
                  ? [
                      {
                        _tag: "DalphSelects" as const,
                        operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" }
                      },
                      { _tag: "TrackerGraphReadReturned" as const, graph: singleton.startingFacts.trackerGraph }
                    ]
                  : [])
              ]
            : [])
        ]
      })
    })
    const run = yield* runAuthoredScenarioCassette(cassetteWith({ _tag: "Run" }))
    expect(run.records).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          _tag: "ControlDirectionApplied",
          direction: "Unpause",
          initiatedBy: { _tag: "Operator" },
          subject: { _tag: "Run", runId: run.runId }
        })
      })
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain("Operator applies Unpause to the Run.")

    const taskRun = yield* runAuthoredScenarioCassette(cassetteWith({ _tag: "Task", taskId: TaskId.make("A") }))
    expect(taskRun.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "ControlDirectionApplied",
      direction: "Unpause",
      subject: { _tag: "Task", taskId: "A" }
    })
    expect(renderAuthoredCassetteLyrics(taskRun.cassette)).toContain("Operator applies Unpause to task A.")
  })
)

it.effect("continues an accepted result after process death and crosses its integration cutoff once", () =>
  Effect.gen(function* () {
    const lyrics = renderAuthoredCassetteLyrics(acceptedResultRestartsIntoIntegrationAuthoredCassette)
    expect(lyrics).toContain(
      "The story expects task A to produce accepted commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa."
    )
    expect(lyrics).toContain(
      "The story expects Dalph to queue accepted commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa from attempt attempt:A:0."
    )
    expect(lyrics).toContain(
      "The story expects Dalph to start integrating accepted commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa from attempt attempt:A:0."
    )
    const run = yield* runAuthoredScenarioCassette(acceptedResultRestartsIntoIntegrationAuthoredCassette)
    const integrationRecords = run.records.filter(
      ({ event }) => event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted"
    )

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(integrationRecords.map(({ event }) => event._tag)).toEqual([
      "IntegrationResponsibilityBegan",
      "IntegrationStarted"
    ])
    expect(integrationRecords[0]?.position).toBeLessThan(integrationRecords[1]?.position ?? 0)
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Accepted"
      )
    ).toHaveLength(1)
    expect(JSON.stringify(run.records)).not.toContain("queueOrdinal")
    if (run.history._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("accepted-result cassette must retain valid journal history")
    }
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.none(),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).explanations
    ).toContainEqual(
      expect.objectContaining({
        _tag: "IntegrationDependencyWait",
        prerequisiteTaskIds: ["C"],
        wakeCondition: "TaskTrackerFactsObserved"
      })
    )
    const integrationBeganAt = integrationRecords.find(
      ({ event }) => event._tag === "IntegrationResponsibilityBegan"
    )?.position
    if (integrationBeganAt === undefined) return yield* Effect.die("expected integration responsibility")
    expect(
      deriveIntegrationFrontier(run.history.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A")]),
        heldResponsibilityPositions: new Set([integrationBeganAt]),
        integrationTarget: Option.some(
          IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/dalph/cassettes/integration.git"),
            ref: IntegrationTargetRef.make("refs/heads/master")
          })
        ),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(AttemptId.make("attempt:A:0"))
      }).transitions
    ).toContainEqual(
      expect.objectContaining({
        _tag: "ReleaseStartedIntegrationTarget",
        responsibility: expect.objectContaining({ queuedAt: integrationBeganAt })
      })
    )
    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskAccepted", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", taskId: "A" }
    ])

    const withoutAcceptedTerminal = run.records.filter(
      ({ event }) =>
        !(
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Accepted"
        )
    )
    expect((yield* projectRecordedCassette(withoutAcceptedTerminal).pipe(Effect.flip))._tag).toBe(
      "InvalidWorkflowJournalHistory"
    )

    const recorded = yield* projectRecordedCassette(run.records)
    const withoutIntegrationOrigin = RecordedCassette.make({
      ...recorded,
      entries: recorded.entries.filter(({ _tag }) => _tag !== "IntegrationResponsibilityBegan")
    })
    expect(yield* foldRecordedCassetteOutcome(withoutIntegrationOrigin)).toContain("RecordedCausalPositionMissing")
  })
)

it.effect("projects exact integration order from typed delivery obligations", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(acceptedResultRestartsIntoIntegrationAuthoredCassette)
    const frames = run.deliveryFrames
    const awaiting = frames.find(({ integrationOrder }) => integrationOrder.awaitingResponsibility.length > 0)
    const queued = frames.find(({ integrationOrder }) =>
      integrationOrder.responsibilities.some(({ state }) => state === "QueuedBeforeCutoff")
    )
    const started = frames.find(({ integrationOrder }) =>
      integrationOrder.responsibilities.some(({ state }) => state === "StartedPastCutoff")
    )

    expect(awaiting?.integrationOrder.awaitingResponsibility).toContainEqual({
      acceptedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      attemptId: "attempt:A:0",
      runId: run.runId,
      taskId: "A",
      terminalAt: expect.any(Number)
    })
    expect(queued?.integrationOrder.responsibilities).toContainEqual({
      acceptedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      attemptId: "attempt:A:0",
      integrationTarget: { repository: "/dalph/cassettes/integration.git", ref: "refs/heads/master" },
      queuedAt: expect.any(Number),
      runId: run.runId,
      state: "QueuedBeforeCutoff",
      taskId: "A"
    })
    expect(started?.integrationOrder.responsibilities).toContainEqual({
      acceptedCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      attemptId: "attempt:A:0",
      integrationTarget: { repository: "/dalph/cassettes/integration.git", ref: "refs/heads/master" },
      queuedAt: expect.any(Number),
      runId: run.runId,
      startedAt: expect.any(Number),
      state: "StartedPastCutoff",
      taskId: "A"
    })
  })
)

it.effect("promotes Git-qualified M by exact compare-and-set and records exact ancestry", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const attempts = run.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
    const success = run.records.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")

    expect(attempts).toHaveLength(1)
    expect(success?.event).toMatchObject({
      _tag: "TargetPromotionObservedSuccess",
      basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
      correlation: {
        qualifiedCandidate: {
          candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
          run: { ordinal: 1, session: { expectedTargetHead: "1111111111111111111111111111111111111111" } }
        }
      },
      observation: {
        _tag: "CompareAndSetApplied",
        candidateAncestry: "Current",
        targetHeadSha: "cccccccccccccccccccccccccccccccccccccccc"
      }
    })
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionStale")).toBe(false)
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual(
      expect.objectContaining({
        _tag: "TargetPromotionSucceeded",
        basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
        taskId: "A"
      })
    )

    const outer = run.records.filter(({ event }) => event._tag.startsWith("Integrator"))
    expect(outer.map(({ event }) => event._tag)).toEqual(
      expect.arrayContaining([
        "IntegratorSessionFixed",
        "IntegratorRunResultRecorded",
        "IntegratorRunCandidateGitReadIntended",
        "IntegratorRunCandidateGitObserved"
      ])
    )
  })
)

it.effect(
  "preserves the Git-qualified candidate and releases integration when a blocker appears before promotion",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(prePromotionBlockerAuthoredCassette)

      expect(run.records.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(false)
      expect(run.records.some(({ event }) => event._tag === "IntegratorRunResultRecorded")).toBe(true)
      expect(run.records.some(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")).toBe(true)
    })
)

it.effect(
  "preserves the Integrator session and releases target ownership when a blocker appears before promotion",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.prePromotionBlocker)
      const blockerFrame = run.deliveryFrames.find(
        (frame) => frame.graph._tag === "Established" && frame.graph.revision === "issue-138-pre-promotion-blocker"
      )
      const started =
        run.history._tag === "ValidWorkflowJournalHistory"
          ? deriveIntegrationAdmission(run.history.runState.workflowHistory.records).responsibilities.find(
              (responsibility) => responsibility._tag === "StartedIntegrationResponsibility"
            )
          : undefined

      expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
      expect(started?._tag).toBe("StartedIntegrationResponsibility")
      expect(blockerFrame?.heldPositions).toEqual([])
      expect(blockerFrame?.integrationOrder.responsibilities).toContainEqual(
        expect.objectContaining({ taskId: "A", queuedAt: started?.queuedAt })
      )
      expect(blockerFrame?.frontier).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ taskId: "A", standing: "Excluded" }),
          expect.objectContaining({ taskId: "B", standing: "Eligible" }),
          expect.objectContaining({ taskId: "C", standing: "Eligible" })
        ])
      )
      expect(run.records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
      expect(run.records.filter(({ event }) => event._tag === "IntegratorRunResultRecorded")).toHaveLength(1)
      expect(run.records.filter(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")).toHaveLength(1)
      expect(run.records.filter(({ event }) => event._tag === "TaskClaimAcquired")).toHaveLength(1)
      expect(run.records.filter(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toHaveLength(1)
      expect(run.records.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(false)
      expect(run.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(false)
    })
)

it.effect("keeps an unfinished Integrator session dormant when a blocker appears after process loss", () =>
  Effect.gen(function* () {
    const [prepared, blocked] = yield* Effect.all([
      runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess),
      runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.prePromotionBlocker)
    ])
    const runStartedAt = prepared.records.findIndex(({ event }) => event._tag === "IntegratorRunStarted")
    if (runStartedAt < 0) return yield* Effect.die("missing unfinished Integrator run start")
    const blockerOutcome = blocked.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies.some(
          ({ contentIdentity }) => contentIdentity === "issue-138-pre-promotion-blocker"
        )
    )
    if (blockerOutcome?.event._tag !== "TaskTrackerFactsObserved") {
      return yield* Effect.die("missing blocker observation")
    }
    const blockerOperationId = blockerOutcome.event.operationId
    const blockerIntent = blocked.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === blockerOperationId
    )
    if (blockerIntent?.event._tag !== "TaskTrackerReadIntentRecorded") {
      return yield* Effect.die("missing blocker read intent")
    }
    const unfinished = [blockerIntent.event, blockerOutcome.event].reduce<ReadonlyArray<JournalRecord>>(
      (records, event) => [
        ...records,
        {
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId: prepared.runId
        }
      ],
      prepared.records.slice(0, runStartedAt + 1)
    )
    const history = reduceWorkflowJournalHistory(prepared.runId, unfinished)
    if (history._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(history)
    const attempt = unfinished.find(({ event }) => event._tag === "IntegratorSessionFixed")?.event
    if (attempt?._tag !== "IntegratorSessionFixed") return yield* Effect.die("missing fixed Integrator session")
    const facts = {
      currentTrackerTaskIds: new Set([TaskId.make("A"), TaskId.make("B"), TaskId.make("C")]),
      heldResponsibilityPositions: new Set<JournalPosition>(),
      integrationTarget: Option.none(),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.correlation.plannedAttempt.attemptId)
    }
    expect(deriveIntegrationFrontier(history.runState, facts).transitions).toEqual([])
    expect(unfinished.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
    expect(unfinished.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
    expect(unfinished.some(({ event }) => event._tag === "IntegratorRunResultRecorded")).toBe(false)
    expect(unfinished.some(({ event }) => event._tag.startsWith("TargetPromotion"))).toBe(false)
  })
)

it.effect("delegates changed H after a cleared blocker without reusing M or creating S2", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.prePromotionBlockerClearAndSupersession
    )
    const dependencyWaitFrame = run.deliveryFrames.find((frame) =>
      frame.deliveries.some((delivery) =>
        delivery.evidence.some(
          (evidence) => evidence.kind === "IntegrationWait" && evidence.exact.includes("IntegrationDependencyWait")
        )
      )
    )
    expect(dependencyWaitFrame).toBeDefined()
    const blockerFrame = run.deliveryFrames.find(
      (frame) => frame.graph._tag === "Established" && frame.graph.revision === "issue-138-pre-promotion-blocker"
    )
    expect(blockerFrame?.frontier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "A", standing: "Excluded" }),
        expect.objectContaining({ taskId: "B", standing: "Eligible" }),
        expect.objectContaining({ taskId: "C", standing: "Eligible" })
      ])
    )
    const clearedFrame = run.deliveryFrames.find(
      (frame) => frame.graph._tag === "Established" && frame.graph.revision === "issue-138-pre-promotion-edge-removed"
    )
    expect(clearedFrame?.frontier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "A", standing: "Eligible" }),
        expect.objectContaining({ taskId: "B", standing: "Excluded" }),
        expect.objectContaining({ taskId: "C", standing: "Excluded" })
      ])
    )
    const blockerRecordIndex = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies[0].contentIdentity === "issue-138-pre-promotion-blocker"
    )
    expect(blockerRecordIndex).toBeGreaterThan(0)
    const blockedHistory = reduceWorkflowJournalHistory(run.runId, run.records.slice(0, blockerRecordIndex + 1))
    if (blockedHistory._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("pre-promotion blocker prefix must remain valid journal history")
    }
    const started = deriveIntegrationAdmission(blockedHistory.runState.workflowHistory.records).responsibilities.find(
      (responsibility) => responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started?._tag !== "StartedIntegrationResponsibility") {
      return yield* Effect.die("pre-promotion blocker prefix must retain its started integration responsibility")
    }
    expect(
      deriveIntegrationFrontier(blockedHistory.runState, {
        currentTrackerTaskIds: new Set([TaskId.make("A"), TaskId.make("B"), TaskId.make("C")]),
        heldResponsibilityPositions: new Set([started.queuedAt]),
        integrationTarget: Option.some(
          IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/dalph/cassettes/integration.git"),
            ref: IntegrationTargetRef.make("refs/heads/master")
          })
        ),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(started.plannedAttempt.attemptId)
      }).transitions
    ).toContainEqual(
      expect.objectContaining({
        _tag: "ReleaseStartedIntegrationTarget",
        responsibility: expect.objectContaining({ queuedAt: started.queuedAt })
      })
    )
    const lineageObservations = run.records.flatMap(({ event }) =>
      event._tag === "TargetLineageObserved" ? [event.observation.targetHeadSha] : []
    )
    expect(lineageObservations).toEqual([
      "1111111111111111111111111111111111111111",
      "2222222222222222222222222222222222222222"
    ])
    const candidateQualifications = run.records.flatMap(({ event }) =>
      event._tag === "IntegratorRunCandidateGitObserved" && event.observation._tag === "Commit"
        ? [event.observation.directParents]
        : []
    )
    expect(candidateQualifications).toEqual([
      ["1111111111111111111111111111111111111111", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
    ])
    expect(run.records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "IntegratorRunResultRecorded")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(false)
    expect(run.records.some(({ event }) => event._tag.startsWith("TargetPromotion"))).toBe(false)
    expect(run.records.some(({ event }) => event._tag.startsWith("Completion"))).toBe(false)
  })
)

it.effect("promotes the preserved candidate after a blocker clears at unchanged H", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.prePromotionBlockerClearAtCurrentHead
    )
    expect(run.records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "IntegratorRunResultRecorded")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("restarts after a durable blocker read with the candidate and queue history intact", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.prePromotionBlockerRecovery)
    expect(run.activationOrdinals.length).toBeGreaterThan(1)
    expect(run.records.some(({ event }) => event._tag === "TaskTrackerFactsObserved")).toBe(true)
    expect(run.records.some(({ event }) => event._tag === "IntegratorRunResultRecorded")).toBe(true)
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(false)
    expect(run.records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
  })
)

it.effect("durably waits after an unreadable blocker restart read and resumes only on later complete facts", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.prePromotionBlockerUnreadableReadRecovery
    )
    const unreadable = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "TaskTrackerFactsReadFailed"
    )
    expect(run.activationOrdinals).toEqual([1, 2, 3, 4, 5])
    expect(
      unreadable?.event._tag === "TaskTrackerFactsObserved" ? unreadable.event.observation : undefined
    ).toMatchObject({
      _tag: "TaskTrackerFactsReadFailed",
      completeness: "Unreadable",
      failure: { _tag: "TrackerAdapterReadError", reason: { _tag: "IncompleteSnapshot" } }
    })
    expect(run.records.some(({ event }) => event._tag === "IntegratorRunResultRecorded")).toBe(true)
    expect(run.records.some(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")).toBe(true)
    expect(run.records.some(({ event }) => event._tag.startsWith("TargetPromotion"))).toBe(false)
    expect(run.records.some(({ event }) => event._tag.startsWith("Completion"))).toBe(false)
    const resumed = run.deliveryFrames.find(
      (frame) =>
        frame.graph._tag === "Established" && frame.graph.revision === "issue-138-pre-promotion-blocker-recovery"
    )
    expect(resumed?.frontier).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "A", standing: "Excluded" })])
    )
    const postFailureFrame = run.deliveryFrames.find(
      ({ activationOrdinal, graph, heldPositions, integrationOrder }) =>
        activationOrdinal === 3 &&
        graph._tag === "NotEstablished" &&
        heldPositions.length === 0 &&
        integrationOrder.responsibilities.some(({ taskId }) => taskId === "A")
    )
    expect(postFailureFrame).toBeDefined()
    if (postFailureFrame === undefined) return yield* Effect.die("missing post-failure delivery frame")
    expect(postFailureFrame.heldPositions).toEqual([])
    expect(postFailureFrame.integrationOrder.responsibilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "A", queuedAt: expect.any(Number) })])
    )
    if (run.history._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die("unreadable blocker recovery must retain valid journal history")
    }
    const started = deriveIntegrationAdmission(run.history.runState.workflowHistory.records).responsibilities.find(
      (responsibility) => responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started?._tag !== "StartedIntegrationResponsibility") {
      return yield* Effect.die("unreadable blocker recovery must retain its queued integration position")
    }
    expect(started.queuedAt).toBeGreaterThan(0)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("preserves promotion proof and releases target ownership before tracker completion on a new blocker", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(blockersAroundPromotionAuthoredCassette)
    const promotion = run.records.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")
    const blockerFrame = run.deliveryFrames.find(
      (frame) => frame.graph._tag === "Established" && frame.graph.revision === "issue-138-post-promotion-blocker"
    )

    expect(promotion?.event._tag).toBe("TargetPromotionObservedSuccess")
    expect(blockerFrame?.heldPositions).toEqual([])
    expect(blockerFrame?.frontier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "A", standing: "Excluded" }),
        expect.objectContaining({ taskId: "B", standing: "Eligible" }),
        expect.objectContaining({ taskId: "C", standing: "Eligible" })
      ])
    )
    expect(run.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(false)
    expect(run.records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "IntegratorRunResultRecorded")).toHaveLength(1)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("reconstructs a post-promotion blocker without repeating Git promotion", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.postPromotionBlockerRecovery)
    expect(run.activationOrdinals.length).toBeGreaterThan(1)
    expect(run.records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "CompletionClaimReplaced")).toBe(false)
    const recovered = run.deliveryFrames.findLast(
      ({ graph }) => graph._tag === "Established" && graph.revision === "issue-138-post-promotion-blocker"
    )
    expect(recovered?.heldPositions).toEqual([])
    expect(recovered?.frontier).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "A", standing: "Excluded" })])
    )
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("preserves accepted tracker completion when a prerequisite concurrently reopens", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(prerequisiteReopensDuringCompletionAuthoredCassette)
    const acknowledgement = run.records.find(({ event }) => event._tag === "CompletionTaskAcknowledged")
    const acknowledgementIndex = run.records.findIndex(({ event }) => event._tag === "CompletionTaskAcknowledged")
    const success = run.records.findLast(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    )
    const laterGraph = run.records.findLast(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
    )

    expect(acknowledgement?.event._tag).toBe("CompletionTaskAcknowledged")
    const reopenedStoryIndex = run.cassette.story.findIndex(
      (item) => item._tag === "CompletionTaskPrerequisiteReopened"
    )
    const requestStoryIndex = run.cassette.story.findIndex(
      (item) => item._tag === "CompletionTaskRequestReturned" && item.outcome === "Acknowledged"
    )
    expect(reopenedStoryIndex).toBeGreaterThanOrEqual(0)
    expect(requestStoryIndex).toBeGreaterThan(reopenedStoryIndex)
    expect(acknowledgementIndex).toBeGreaterThan(0)
    expect(success?.event._tag).toBe("TaskTrackerFactsObserved")
    expect(laterGraph?.event._tag).toBe("TaskTrackerFactsObserved")
    const graphAt = (revision: string) =>
      run.records.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            ({ contentIdentity }) => contentIdentity === TrackerRevision.make(revision)
          )
      )
    const completeBeforeAuthorization = Option.getOrThrow(
      Option.fromUndefinedOr(graphAt("delivery-story-prerequisite-complete"))
    )
    const laterACompleteBUnfinished = Option.getOrThrow(Option.fromUndefinedOr(graphAt("delivery-story-G6")))
    const bCompletedAfterItsWork = Option.getOrThrow(
      Option.fromUndefinedOr(graphAt("delivery-story-prerequisite-completed"))
    )
    const deliveryFrameAt = (revision: string) =>
      run.deliveryFrames.find(({ graph }) => graph._tag === "Established" && graph.revision === revision)
    const bFrontierAt = (revision: string) => deliveryFrameAt(revision)?.frontier.find(({ taskId }) => taskId === "B")
    const aFrontierAt = (revision: string) => deliveryFrameAt(revision)?.frontier.find(({ taskId }) => taskId === "A")
    const warnedA = aFrontierAt("delivery-story-G6")
    const completedB = bFrontierAt("delivery-story-prerequisite-completed")
    expect(warnedA?.standing).toBe("Excluded")
    expect(warnedA?.reasons).toContainEqual(expect.objectContaining({ kind: "PrerequisitesIncomplete" }))
    expect(completedB?.standing).toBe("Excluded")
    expect(completedB?.reasons).not.toContainEqual(expect.objectContaining({ kind: "PrerequisitesIncomplete" }))
    const graphPositions = [completeBeforeAuthorization, laterACompleteBUnfinished, bCompletedAfterItsWork].map(
      (record) => record.position
    )
    expect(graphPositions).toEqual(graphPositions.toSorted((left, right) => left - right))
    expect(
      laterACompleteBUnfinished.event._tag === "TaskTrackerFactsObserved" &&
        laterACompleteBUnfinished.event.observation._tag === "CompleteTaskTrackerFacts" &&
        laterACompleteBUnfinished.event.observation.factFamilies[1].lifecycles.some(
          ({ lifecycle, taskId }) => taskId === TaskId.make("A") && lifecycle._tag === "CompletedSuccessfully"
        ) &&
        laterACompleteBUnfinished.event.observation.factFamilies[1].lifecycles.some(
          ({ lifecycle, taskId }) => taskId === TaskId.make("B") && lifecycle._tag === "Open"
        )
    ).toBe(true)
    expect(
      bCompletedAfterItsWork.event._tag === "TaskTrackerFactsObserved" &&
        bCompletedAfterItsWork.event.observation._tag === "CompleteTaskTrackerFacts" &&
        bCompletedAfterItsWork.event.observation.factFamilies[1].lifecycles.some(
          ({ lifecycle, taskId }) => taskId === TaskId.make("B") && lifecycle._tag === "CompletedSuccessfully"
        )
    ).toBe(true)
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskAcknowledged")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "CompletionTaskRejected")).toBe(false)
    expect(
      run.deliveryFrames.some(({ frontier }) =>
        frontier.some(
          ({ reasons, standing, taskId }) =>
            taskId === "A" && standing === "Excluded" && reasons.some(({ kind }) => kind === "PrerequisitesIncomplete")
        )
      )
    ).toBe(true)
    expect(
      run.deliveryFrames.some(({ frontier }) =>
        frontier.some(({ standing, taskId }) => taskId === "B" && standing === "Eligible")
      )
    ).toBe(true)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("records completion finality after Git-qualified promotion history", () =>
  Effect.gen(function* () {
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const finalized = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,
      promoted.records
    )
    const finalityRecords = finalized.records.slice(promoted.records.length)
    const focusedSuccessAt = finalityRecords.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskCompletionFacts" &&
        event.observation.facts.lifecycle === "CompletedSuccessfully"
    )
    expect(focusedSuccessAt).toBeGreaterThanOrEqual(0)
    expectFocusedCompletionReadCorrelation(finalityRecords, focusedSuccessAt)
    expect(finalized.records.map(({ event }) => event._tag)).toContain("IntegrationFinalitySettled")
    expect(finalized.records.some(({ event }) => event._tag === "IntegratorRunResultRecorded")).toBe(true)
    expect(finalized.records.some(({ event }) => event._tag === "IntegratorRunCandidateGitObserved")).toBe(true)
  })
)

const completeSingletonDeliveryCassette = (() => {
  const promoted = maintainedAuthoredCassetteCatalog.targetPromotionSuccess
  const completedGraph = {
    revision: "authored-finality-success",
    rootTaskId: "A",
    tasks: [{ id: "A", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  } as const
  const settledGraph = { ...completedGraph, revision: "authored-finality-settled" } as const
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...promoted,
    startingFacts: {
      ...promoted.startingFacts,
      trackerGraph: { ...promoted.startingFacts.trackerGraph, rootTaskId: "A" }
    },
    story: promoted.story.flatMap(
      (item): ReadonlyArray<unknown> =>
        item._tag !== "ExpectedBehavior"
          ? [item._tag === "TrackerGraphReadReturned" ? { ...item, graph: { ...item.graph, rootTaskId: "A" } } : item]
          : [
              { _tag: "CompletionClaimReadReturned", claim: "Active", taskId: "A" },
              { _tag: "CompletionClaimReplacementApplied", taskId: "A" },
              {
                _tag: "CompletionTaskFocusedReadReturned",
                lifecycle: "Open",
                taskId: "A",
                unfinishedPrerequisiteTaskIds: []
              },
              {
                _tag: "TargetPromotionGitReadReturned",
                candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
                observation: { _tag: "CandidateCurrent", currentHeadSha: "cccccccccccccccccccccccccccccccccccccccc" },
                repository: "/dalph/cassettes/integration.git"
              },
              { _tag: "CompletionTaskRequestReturned", outcome: "Acknowledged", taskId: "A" },
              {
                _tag: "CompletionTaskFocusedReadReturned",
                lifecycle: "CompletedSuccessfully",
                taskId: "A",
                unfinishedPrerequisiteTaskIds: []
              },
              { _tag: "CompletionClaimReadReturned", claim: "CompletionMarker", taskId: "A" },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              { _tag: "DalphSelects", operation: { _tag: "ReleaseTaskClaim", taskId: "A" } },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              { _tag: "CompletionClaimReadReturned", claim: "CompletionMarker", taskId: "A" },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              { _tag: "CompletionClaimDeletionApplied", taskId: "A" },
              { _tag: "CompletionClaimReadReturned", claim: "CompletionMarkerAbsent", taskId: "A" },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              {
                _tag: "CoordinatorActivationReturned",
                decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
              },
              { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
              { _tag: "TrackerGraphReadReturned", graph: completedGraph },
              { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
              { _tag: "TrackerGraphReadReturned", graph: settledGraph },
              { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
              item
            ]
    )
  })
})()

it.effect("settles a promoted authored task through the real completion-claim boundary", () =>
  Effect.gen(function* () {
    const finalityStory = completeSingletonDeliveryCassette.story
    const run = yield* runAuthoredScenarioCassette(completeSingletonDeliveryCassette)
    const withFirstMismatchedTask = (tag: string) => {
      let changed = false
      return finalityStory.map((item) => {
        if (!changed && item._tag === tag) {
          changed = true
          return { ...item, taskId: "B" }
        }
        return item
      })
    }
    for (const [tag, expected] of [
      ["CompletionTaskFocusedReadReturned", "authored focused completion read returned B for A"],
      ["CompletionTaskRequestReturned", "authored completion response returned B for A"]
    ] as const) {
      const hostile = yield* Effect.exit(
        runAuthoredScenarioCassette({ ...completeSingletonDeliveryCassette, story: withFirstMismatchedTask(tag) })
      )
      expect(Exit.isFailure(hostile)).toBe(true)
      if (Exit.isFailure(hostile)) expect(Cause.pretty(hostile.cause)).toContain(expected)
    }
    const completionIntent = run.records.find(({ event }) => event._tag === "CompletionTaskIntended")?.event
    if (completionIntent?._tag !== "CompletionTaskIntended") {
      return yield* Effect.die("authored finality run did not record the completion request")
    }
    const request = completionIntent.request
    const tracker = yield* TrackerMutation.pipe(Effect.provide(controlledTrackerMutationLayerFrom([])))
    const hostileBoundaryCases = [
      {
        expected: "authored focused completion read found UnclaimedTask for A",
        invoke: (boundary: CompletionTaskBoundary["Service"]) =>
          boundary.readFocusedTaskCompletion(
            FocusedTaskCompletionReadRequest.make({
              expectedClaim: request.claim,
              operationId: OperationId.make("hostile-authored-focused-read"),
              target: FixtureTarget.make("cassette-target"),
              taskId: request.taskId
            })
          ),
        item: {
          _tag: "CompletionTaskFocusedReadReturned",
          lifecycle: "Open",
          taskId: TaskId.make("A"),
          unfinishedPrerequisiteTaskIds: []
        } as const
      },
      {
        expected: "authored completion request lacked exact completion claim A",
        invoke: (boundary: CompletionTaskBoundary["Service"]) => boundary.completeTask(request),
        item: { _tag: "CompletionTaskRequestReturned", outcome: "Acknowledged", taskId: TaskId.make("A") } as const
      },
      {
        expected: "authored completion lookup returned B for A",
        invoke: (boundary: CompletionTaskBoundary["Service"]) => boundary.readCompletionRequest(request),
        item: { _tag: "CompletionTaskRequestLookupReturned", outcome: "NotApplied", taskId: TaskId.make("B") } as const
      }
    ]
    for (const hostileCase of hostileBoundaryCases) {
      const cursor = yield* makeStoryCursor([hostileCase.item])
      const hostile = yield* Effect.gen(function* () {
        return yield* hostileCase.invoke(yield* CompletionTaskBoundary)
      }).pipe(Effect.provide(controlledTrackerAuthorityLayer(cursor, tracker)), Effect.exit)
      expect(Exit.isFailure(hostile)).toBe(true)
      if (Exit.isFailure(hostile)) expect(Cause.pretty(hostile.cause)).toContain(hostileCase.expected)
    }
    const ordered = [
      {
        name: "TargetPromotionObservedSuccess",
        matches: (event: WorkflowJournalEvent) => event._tag === "TargetPromotionObservedSuccess"
      },
      {
        name: "CompletionClaimReplacementIntended",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionClaimReplacementIntended"
      },
      {
        name: "CompletionClaimReplacementAttemptIntended",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionClaimReplacementAttemptIntended"
      },
      {
        name: "CompletionClaimReplaced",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionClaimReplaced"
      },
      {
        name: "authorization focused read intent",
        matches: (event: WorkflowJournalEvent) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadCompletionTaskFacts" &&
          event.operation.purpose._tag === "Authorization"
      },
      {
        name: "authorization focused facts observation",
        matches: (event: WorkflowJournalEvent) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.purpose._tag === "Authorization"
      },
      {
        name: "CompletionTaskCandidateAncestryReadIntended",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionTaskCandidateAncestryReadIntended"
      },
      {
        name: "CompletionTaskCandidateAncestryObserved",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionTaskCandidateAncestryObserved"
      },
      {
        name: "CompletionTaskIntended",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionTaskIntended"
      },
      {
        name: "CompletionTaskAttemptIntended",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionTaskAttemptIntended"
      },
      {
        name: "CompletionTaskAcknowledged",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionTaskAcknowledged"
      },
      {
        name: "confirmation focused read intent",
        matches: (event: WorkflowJournalEvent) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadCompletionTaskFacts" &&
          event.operation.purpose._tag === "Confirmation"
      },
      {
        name: "confirmation focused facts observation",
        matches: (event: WorkflowJournalEvent) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.purpose._tag === "Confirmation"
      },
      {
        name: "CompletionClaimDeletionIntended",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionClaimDeletionIntended"
      },
      {
        name: "CompletionClaimDeletionAttemptIntended",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionClaimDeletionAttemptIntended"
      },
      {
        name: "CompletionClaimDeleted",
        matches: (event: WorkflowJournalEvent) => event._tag === "CompletionClaimDeleted"
      },
      {
        name: "IntegrationFinalitySettled",
        matches: (event: WorkflowJournalEvent) => event._tag === "IntegrationFinalitySettled"
      }
    ] as const
    let previousPosition = -1
    const positions = ordered.map(({ matches }) => {
      previousPosition = run.records.findIndex(({ event }, index) => index > previousPosition && matches(event))
      return previousPosition
    })

    expect(ordered.filter((_, index) => positions[index] === -1).map(({ name }) => name)).toEqual([])
    expect(positions).toEqual(positions.toSorted((left, right) => left - right))
    const authorizationReadPosition = positions[4]
    const confirmationReadPosition = positions[11]
    if (authorizationReadPosition === undefined || confirmationReadPosition === undefined) {
      return yield* Effect.die("completion chronology positions must be present")
    }
    expectFocusedCompletionReadCorrelation(run.records, positions[5] ?? -1)
    expectFocusedCompletionReadCorrelation(run.records, positions[12] ?? -1)
    expect(run.records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
    expect(run.deliveryFrames.some(({ settlements }) => settlements.some(({ taskId }) => taskId === "A"))).toBe(true)
    expect(run.deliveryFrames.some(({ trackerReflection }) => trackerReflection.settlementCount > 0)).toBe(true)
  })
)

it.effect(
  "runs the five-task controlled-provider diamond through exact accepted-result finality",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.productionShapedFiveTaskDiamond)
      const positions = (tag: "IntegrationFinalitySettled" | "PlannedAttemptExecutorWorkResponsibilityBegan") =>
        run.records.flatMap(({ event }, position) => {
          if (tag === "IntegrationFinalitySettled" && event._tag === tag) {
            return [[event.claim.plannedAttempt.taskId, position] as const]
          }
          return tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event._tag === tag
            ? [[event.plannedAttempt.taskId, position] as const]
            : []
        })
      const settledAt = new Map(positions("IntegrationFinalitySettled"))
      const beganAt = new Map(positions("PlannedAttemptExecutorWorkResponsibilityBegan"))
      const aSettledAt = settledAt.get(TaskId.make("A")) ?? -1
      const bClaimAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("B")
      )
      const currentGraphSubjectsBeforeB = run.records
        .slice(aSettledAt + 1, bClaimAt)
        .flatMap(({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "WorkflowEstablishment"
            ? [event.operation.readShape.explicitlyCoveredTaskIds]
            : []
        )

      expect([...settledAt.keys()]).toEqual(["A", "B", "C", "E", "D"])
      expect(currentGraphSubjectsBeforeB).toEqual([[], ["B"], ["C"], ["E"]])
      expect(beganAt.get(TaskId.make("D"))).toBeGreaterThan(settledAt.get(TaskId.make("B")) ?? Number.POSITIVE_INFINITY)
      expect(beganAt.get(TaskId.make("D"))).toBeGreaterThan(settledAt.get(TaskId.make("C")) ?? Number.POSITIVE_INFINITY)
      expect(beganAt.get(TaskId.make("D"))).toBeGreaterThan(settledAt.get(TaskId.make("E")) ?? Number.POSITIVE_INFINITY)
      expect(run.records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
      expect(
        run.deliveryFrames.every(({ capacity, heldPositions }) => capacity === 2 && heldPositions.length <= 2)
      ).toBe(true)
    }),
  600_000
)

it.effect("proves promoted ancestry after the blocker clears and completes without reintegration", () =>
  Effect.gen(function* () {
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const promotion = promoted.records.findLast(({ event }) => event._tag === "TargetPromotionObservedSuccess")?.event
    const graph = promoted.records.findLast(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
    )?.event
    if (
      promotion?._tag !== "TargetPromotionObservedSuccess" ||
      graph?._tag !== "TaskTrackerFactsObserved" ||
      graph.observation._tag !== "CompleteTaskTrackerFacts"
    ) {
      return yield* Effect.die("promotion blocker cassette requires exact promotion and tracker history")
    }
    const plannedAttempt = promoted.records.findLast(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        event.operation.plannedAttempt.attemptId ===
          promotion.correlation.qualifiedCandidate.run.session.plannedAttempt.attemptId
    )?.event
    if (plannedAttempt?._tag !== "TaskAttemptPlanned") return yield* Effect.die("missing promoted attempt")
    const activeClaim = promoted.records.findLast(
      ({ event }) =>
        event._tag === "TaskClaimAcquired" && event.claim.taskId === plannedAttempt.operation.plannedAttempt.taskId
    )?.event
    if (activeClaim?._tag !== "TaskClaimAcquired") return yield* Effect.die("missing promoted task claim")
    const taskId = plannedAttempt.operation.plannedAttempt.taskId
    const blockerId = TaskId.make("post-promotion-blocker")
    const unrelatedTaskId = TaskId.make("post-promotion-unrelated-B")
    const appendGraph = (
      records: ReadonlyArray<JournalRecord>,
      revision: string,
      blockerLifecycle: "Open" | "CompletedSuccessfully"
    ) => {
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(`post-promotion-blocker:${revision}`),
        graph.observation.target,
        [],
        [taskId, blockerId, unrelatedTaskId]
      )
      const projected = projectTrackerSnapshot({
        revision: TrackerRevision.make(revision),
        tasks: [
          {
            id: taskId,
            lifecycle: TaskLifecycle.cases.Open.make({}),
            parentTaskId: null,
            prerequisiteIds: [blockerId]
          },
          {
            id: blockerId,
            lifecycle:
              blockerLifecycle === "Open"
                ? TaskLifecycle.cases.Open.make({})
                : TaskLifecycle.cases.CompletedSuccessfully.make({}),
            parentTaskId: null,
            prerequisiteIds: []
          },
          { id: unrelatedTaskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
        ]
      })
      if (projected._tag !== "Valid") throw new Error("post-promotion blocker graph must be valid")
      const intent = taskTrackerReadIntent(operation)
      const outcome = TaskTrackerFactsObservedEvent.make({
        observation: makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot),
        operationId: operation.operationId,
        version: workflowJournalEventVersion
      })
      return [intent, outcome].reduce<ReadonlyArray<JournalRecord>>(
        (current, event) => [
          ...current,
          {
            event,
            key: describeJournalEvent(event).expectedKey,
            position: JournalPosition.make(current.length + 1),
            runId: plannedAttempt.operation.plannedAttempt.runId
          }
        ],
        records
      )
    }
    const blockedRecords = appendGraph(promoted.records, "post-promotion-blocked", "Open")
    const blockedHistory = reduceWorkflowJournalHistory(plannedAttempt.operation.plannedAttempt.runId, blockedRecords)
    if (blockedHistory._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(blockedHistory)
    const facts = {
      activeClaimByAttemptId: new Map([[plannedAttempt.operation.plannedAttempt.attemptId, activeClaim.claim]]),
      currentTrackerTaskIds: new Set([taskId, blockerId, unrelatedTaskId]),
      heldResponsibilityPositions: new Set<JournalPosition>(),
      integrationFinalityConfigured: true,
      integrationTarget: Option.none(),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(plannedAttempt.operation.plannedAttempt.attemptId)
    }
    expect(deriveIntegrationFrontier(blockedHistory.runState, facts).transitions).toEqual([])
    expect(
      deriveRunnableFrontier({
        freshEligibleTasks: [
          { taskId: unrelatedTaskId, taskRevision: TaskRevision.make("post-promotion-unrelated-revision") }
        ],
        responsibility: { entries: [] },
        responsibilityFacts: []
      }).transitions
    ).toContainEqual(expect.objectContaining({ _tag: "CommitFreshTaskClaimIntent", taskId: unrelatedTaskId }))

    const clearRecords = appendGraph(blockedRecords, "post-promotion-clear", "CompletedSuccessfully")
    const clearHistory = reduceWorkflowJournalHistory(plannedAttempt.operation.plannedAttempt.runId, clearRecords)
    if (clearHistory._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(clearHistory)
    const postBlockerClearTransitions = deriveIntegrationFrontier(clearHistory.runState, facts).transitions
    expect(postBlockerClearTransitions).toContainEqual(
      expect.objectContaining({
        _tag: "ObservePromotedCandidateAncestryAfterBlockerClear",
        authorization: expect.objectContaining({
          blockerClearedAt: expect.any(Number),
          blockerObservedAt: expect.any(Number),
          claim: expect.objectContaining({ promotionCorrelation: promotion.correlation })
        })
      })
    )
    expect(postBlockerClearTransitions).not.toContainEqual(
      expect.objectContaining({ _tag: "ReplacePromotedTaskClaim" })
    )
    expect(clearRecords.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(clearRecords.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)

    const claim = CompletionTaskClaim.make({
      originalClaim: activeClaim.claim,
      plannedAttempt: plannedAttempt.operation.plannedAttempt,
      promotionCorrelation: promotion.correlation
    })
    const replacementOperationId = completionClaimReplacementOperationIdFor(claim)
    const withReplacement = [
      CompletionClaimReplacementIntendedEvent.make({
        claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      }),
      CompletionClaimReplacedEvent.make({
        claim,
        operationId: replacementOperationId,
        version: workflowJournalEventVersion
      })
    ].reduce<ReadonlyArray<JournalRecord>>(
      (records, event) => [
        ...records,
        {
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId: plannedAttempt.operation.plannedAttempt.runId
        }
      ],
      clearRecords
    )
    const blockedWithCompletionClaim = appendGraph(
      withReplacement,
      "post-promotion-blocked-with-completion-claim",
      "Open"
    )
    const completionClaimBlockedHistory = reduceWorkflowJournalHistory(
      plannedAttempt.operation.plannedAttempt.runId,
      blockedWithCompletionClaim
    )
    if (completionClaimBlockedHistory._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die(completionClaimBlockedHistory)
    }
    expect(deriveIntegrationFrontier(completionClaimBlockedHistory.runState, facts).transitions).toEqual([])
    expect(
      completionClaimBlockedHistory.records.filter(({ event }) => event._tag === "CompletionClaimReplaced")
    ).toHaveLength(1)

    const ancestryTransition = postBlockerClearTransitions.find(
      (transition) => transition._tag === "ObservePromotedCandidateAncestryAfterBlockerClear"
    )
    if (ancestryTransition?._tag !== "ObservePromotedCandidateAncestryAfterBlockerClear") {
      return yield* Effect.die("missing post-promotion blocker-clear ancestry transition")
    }
    const readAncestryWith = (disposition: "Current" | "NotInAncestry" | "Unreadable") =>
      Effect.gen(function* () {
        const recordsRef = yield* Ref.make(clearRecords)
        const journal = InRunJournal.of({
          append: (runId, key, event) =>
            Effect.gen(function* () {
              const records = yield* Ref.get(recordsRef)
              const existing = records.find((record) => record.runId === runId && record.key === key)
              if (existing !== undefined) return existing
              const record = { event, key, position: JournalPosition.make(records.length + 1), runId }
              yield* Ref.set(recordsRef, [...records, record])
              return record
            }),
          read: (runId) =>
            Ref.get(recordsRef).pipe(Effect.map((records) => records.filter((record) => record.runId === runId)))
        })
        const observation = yield* readPostPromotionBlockerCandidateAncestry(ancestryTransition.authorization).pipe(
          Effect.provideService(InRunJournal, journal),
          Effect.provideService(
            TargetPromotionGit,
            TargetPromotionGit.of({
              compareAndSet: () => Effect.die("post-promotion ancestry check must not mutate Git"),
              read: (request) =>
                disposition === "Unreadable"
                  ? Effect.fail(
                      new TargetPromotionGitReadFailure({
                        candidateCommit: request.candidateCommit,
                        detail: "Git ancestry unavailable",
                        target: request.integrationTarget
                      })
                    )
                  : Effect.succeed(
                      disposition === "Current"
                        ? TargetPromotionGitReadObservation.cases.CandidateCurrent.make({
                            currentHeadSha: request.candidateCommit
                          })
                        : TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                            currentHeadSha: promotion.correlation.qualifiedCandidate.run.session.expectedTargetHead
                          })
                    )
            })
          )
        )
        return { observation, records: yield* Ref.get(recordsRef) }
      })

    for (const disposition of ["NotInAncestry", "Unreadable"] as const) {
      const negative = yield* readAncestryWith(disposition)
      const history = reduceWorkflowJournalHistory(plannedAttempt.operation.plannedAttempt.runId, negative.records)
      if (history._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die(history)
      expect(negative.observation._tag).toBe(disposition === "Unreadable" ? "Unreadable" : "Observed")
      expect(deriveIntegrationFrontier(history.runState, facts).transitions).not.toContainEqual(
        expect.objectContaining({ _tag: "ReplacePromotedTaskClaim" })
      )
    }

    const ancestryRecordsRef = yield* Ref.make(clearRecords)
    const ancestryJournal = InRunJournal.of({
      append: (runId, key, event) =>
        Effect.gen(function* () {
          const records = yield* Ref.get(ancestryRecordsRef)
          const existing = records.find((record) => record.runId === runId && record.key === key)
          if (existing !== undefined) return existing
          const record = { event, key, position: JournalPosition.make(records.length + 1), runId }
          yield* Ref.set(ancestryRecordsRef, [...records, record])
          return record
        }),
      read: (runId) =>
        Ref.get(ancestryRecordsRef).pipe(Effect.map((records) => records.filter((record) => record.runId === runId)))
    })
    const ancestry = yield* readPostPromotionBlockerCandidateAncestry(ancestryTransition.authorization).pipe(
      Effect.provideService(InRunJournal, ancestryJournal),
      Effect.provideService(
        TargetPromotionGit,
        TargetPromotionGit.of({
          compareAndSet: () => Effect.die("post-promotion ancestry cassette must not mutate Git"),
          read: (request) =>
            Effect.succeed(
              TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: request.candidateCommit })
            )
        })
      )
    )
    expect(ancestry).toMatchObject({ _tag: "Observed", observation: { _tag: "CandidateCurrent" } })
    const clearAndAncestryRecords = yield* Ref.get(ancestryRecordsRef)
    const clearAndAncestryHistory = reduceWorkflowJournalHistory(
      plannedAttempt.operation.plannedAttempt.runId,
      clearAndAncestryRecords
    )
    if (clearAndAncestryHistory._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die(clearAndAncestryHistory)
    }
    expect(deriveIntegrationFrontier(clearAndAncestryHistory.runState, facts).transitions).toContainEqual(
      expect.objectContaining({ _tag: "ReplacePromotedTaskClaim" })
    )
    const resumed = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,
      clearAndAncestryRecords
    )
    const resumedRecords = resumed.records.slice(clearAndAncestryRecords.length)
    const ancestryAt = clearAndAncestryRecords.findIndex(
      ({ event }) => event._tag === "PostPromotionBlockerCandidateAncestryObserved"
    )
    const completionAt = resumedRecords.findIndex(({ event }) => event._tag === "IntegrationFinalitySettled")
    expect(ancestryAt).toBeGreaterThanOrEqual(0)
    expect(completionAt + clearAndAncestryRecords.length).toBeGreaterThan(ancestryAt)
    expect(resumed.records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(resumed.records.filter(({ event }) => event._tag === "IntegratorSessionFixed")).toHaveLength(1)
    expect(resumed.records.some(({ event }) => event._tag === "IntegrationFinalitySettled")).toBe(true)
  })
)

it.effect("reconciles a lost promotion response and never sends a fourth request", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionAmbiguityExhaustion)
    const attempts = run.records.flatMap(({ event }) =>
      event._tag === "TargetPromotionAttemptIntended" ? [event.attemptOrdinal] : []
    )
    const terminal = run.records.find(({ event }) => event._tag === "TargetPromotionNonConvergence")

    expect(attempts).toEqual([1, 2, 3])
    expect(terminal?.event).toMatchObject({
      _tag: "TargetPromotionNonConvergence",
      attemptLimit: 3,
      attemptOrdinal: 3,
      correlation: { qualifiedCandidate: { candidateCommit: "cccccccccccccccccccccccccccccccccccccccc" } },
      lastObservation: {
        _tag: "ExpectedHeadStillObserved",
        observedHeadSha: "1111111111111111111111111111111111111111"
      }
    })
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionStale")).toBe(false)
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual(
      expect.objectContaining({ _tag: "TargetPromotionNonConvergent", attemptOrdinal: 3, taskId: "A" })
    )

    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain("stop after attempt 3 with ExpectedHeadStillObserved")
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("records stale H2 and never overwrites it", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.targetPromotionStaleBeforeCompareAndSet
    )
    expect(run.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(0)
    expect(run.records.find(({ event }) => event._tag === "TargetPromotionStale")?.event).toMatchObject({
      _tag: "TargetPromotionStale",
      basis: { _tag: "BeforeFirstAttempt" },
      correlation: {
        qualifiedCandidate: {
          candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
          run: { ordinal: 1, session: { expectedTargetHead: "1111111111111111111111111111111111111111" } }
        }
      },
      observation: {
        _tag: "ReconciledCandidateNotInAncestry",
        observedHeadSha: "2222222222222222222222222222222222222222"
      }
    })
    expect(run.observedBehavior.orchestrationEvidence).toContainEqual(
      expect.objectContaining({
        _tag: "TargetPromotionStale",
        basis: { _tag: "BeforeFirstAttempt" },
        observedTargetHead: "2222222222222222222222222222222222222222"
      })
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "preserve head 2222222222222222222222222222222222222222"
    )
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("records a rejected target compare-and-set as stale exact authority", () =>
  Effect.gen(function* () {
    const observedHeadSha = GitCommitSha.make("2222222222222222222222222222222222222222")
    const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...maintainedAuthoredCassetteCatalog.targetPromotionSuccess,
      name: "Git rejects target promotion after another exact target-head change",
      story: maintainedAuthoredCassetteCatalog.targetPromotionSuccess.story.map((item) => {
        if (item._tag === "TargetPromotionCompareAndSetReturned") {
          return { ...item, result: { _tag: "RejectedExpectedHead", observedHeadSha } }
        }
        if (item._tag !== "ExpectedBehavior" || item.orchestration === null) return item
        return {
          ...item,
          orchestration: item.orchestration.map((evidence) =>
            evidence._tag === "TargetPromotionSucceeded"
              ? {
                  _tag: "TargetPromotionStale",
                  basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
                  candidateCommit: evidence.candidateCommit,
                  expectedTargetHead: evidence.expectedTargetHead,
                  observation: "CompareAndSetRejected",
                  observedTargetHead: observedHeadSha,
                  taskId: evidence.taskId
                }
              : evidence
          )
        }
      })
    })
    const run = yield* runAuthoredScenarioCassette(cassette)
    expect(run.records.find(({ event }) => event._tag === "TargetPromotionStale")?.event).toMatchObject({
      basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
      observation: { _tag: "CompareAndSetRejected", observedHeadSha }
    })
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("discovers M in current target ancestry after losing the promotion response", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.targetPromotionLostResponseDiscoversCurrentCandidate
    )
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "TargetPromotionAttemptIntended" ? [event.attemptOrdinal] : []
      )
    ).toEqual([1])
    expect(run.records.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")?.event).toMatchObject({
      _tag: "TargetPromotionObservedSuccess",
      basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
      observation: {
        _tag: "ReconciledCandidateCurrent",
        candidateAncestry: "Current",
        targetHeadSha: "cccccccccccccccccccccccccccccccccccccccc"
      }
    })
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionStale")).toBe(false)
    expect(run.records.some(({ event }) => event._tag === "TargetPromotionNonConvergence")).toBe(false)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("keeps another target usable while M promotion waits and releases only M when it settles", () =>
  Effect.gen(function* () {
    const run = yield* runTargetPromotionProtocolCassette(targetPromotionConcurrentTargetsProtocolCassette)
    const replay = yield* runTargetPromotionProtocolCassette(targetPromotionConcurrentTargetsProtocolCassette)
    const tags = run.records.map(({ event }) => event._tag)

    expect(run).toEqual(replay)
    expect(run.boundaryCalls).toEqual(["T1.read", "T1.compareAndSet", "T2.read", "T2.compareAndSet"])
    expect(run.compareAndSetCount).toBe(2)
    expect(tags.filter((tag) => tag === "TargetPromotionIntended")).toHaveLength(2)
    expect(tags.filter((tag) => tag === "TargetPromotionAttemptIntended")).toHaveLength(2)
    expect(tags.filter((tag) => tag === "TargetPromotionObservedSuccess")).toHaveLength(2)
    expect(run.leaseObservations).toEqual([
      { active: [8], held: [8], moment: "T1WaitingBeforeT2" },
      { active: [8], held: [8, 28], moment: "T2AcquiredWhileT1Waiting" },
      { active: [8], held: [8], moment: "T2Settled" },
      { active: [], held: [], moment: "AllSettled" }
    ])
  })
)

it.effect("waits without another request when Git cannot be read", () =>
  Effect.gen(function* () {
    const run = yield* runTargetPromotionProtocolCassette(targetPromotionUnreadableProtocolCassette)
    const replay = yield* runTargetPromotionProtocolCassette(targetPromotionUnreadableProtocolCassette)

    expect(run).toEqual(replay)
    expect(run.boundaryCalls).toEqual(["T1.read"])
    expect(run.compareAndSetCount).toBe(0)
    expect(run.failureTag).toBe("TargetPromotionGitReadFailure")
    expect(run.records.map(({ event }) => event._tag)).toEqual(["TargetPromotionIntended"])
    expect(run.leaseObservations).toEqual([{ active: [], held: [], moment: "AllSettled" }])
  })
)

it("rejects protocol cassettes with duplicate, missing, or unsettled participants", () => {
  const participant = targetPromotionUnreadableProtocolCassette.participants[0]
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      name: "empty promotion protocol cassette",
      participants: [],
      story: []
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionUnreadableProtocolCassette,
      participants: [participant, participant]
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionConcurrentTargetsProtocolCassette,
      participants: [targetPromotionConcurrentTargetsProtocolCassette.participants[0]]
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionUnreadableProtocolCassette,
      story: targetPromotionUnreadableProtocolCassette.story.filter((item) => item._tag !== "StartPromotion")
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionConcurrentTargetsProtocolCassette,
      story: targetPromotionConcurrentTargetsProtocolCassette.story.filter(
        (item) => item._tag !== "ReleaseBlockedBoundary"
      )
    })
  ).toBe(false)
  expect(
    Schema.is(TargetPromotionProtocolCassette)({
      ...targetPromotionUnreadableProtocolCassette,
      story: [
        ...targetPromotionUnreadableProtocolCassette.story,
        ProtocolStoryItem.cases.AwaitBlockedBoundary.make({ owner: "T1" })
      ]
    })
  ).toBe(false)
})

it.effect("starts a queued accepted result in the same live coordinator process", () =>
  Effect.gen(function* () {
    const source = acceptedResultRestartsIntoIntegrationAuthoredCassette.story
    const deathAt = source.findIndex(({ _tag }) => _tag === "CoordinatorProcessDies")
    const blockedGraphAt = source.findIndex(
      (item) => item._tag === "TrackerGraphReadReturned" && item.graph.revision === "accepted-result-new-blocker"
    )
    const terminal = source.at(-1)
    if (terminal?._tag !== "ExpectedBehavior") return yield* Effect.die("expected terminal assertion")
    const uninterrupted = AuthoredScenarioCassette.make({
      ...acceptedResultRestartsIntoIntegrationAuthoredCassette,
      name: "accepted result starts without coordinator restart",
      story: [...source.slice(0, deathAt), ...source.slice(blockedGraphAt - 1, blockedGraphAt + 1), terminal]
    })

    const run = yield* runAuthoredScenarioCassette(uninterrupted)

    expect(run.activationOrdinals).toEqual([1])
    expect(run.records.filter(({ event }) => event._tag === "IntegrationStarted")).toHaveLength(1)
  })
)

it.effect("releases B only after A's accepted-result finality in one Run", () =>
  Effect.gen(function* () {
    const run = yield* cachedDependentTasksRun
    const executorResponsibilities = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ? [event.plannedAttempt.taskId] : []
    )

    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskAccepted", commit: "a".repeat(40), taskId: "A" },
      { _tag: "PlannedWorkForTaskAccepted", commit: "b".repeat(40), taskId: "B" }
    ])
    expect(executorResponsibilities).toEqual(["A", "B"])
    const settlements = run.records.flatMap(({ event }, position) =>
      event._tag === "IntegrationFinalitySettled" ? [{ position, taskId: event.claim.plannedAttempt.taskId }] : []
    )
    const bBeganAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === "B"
    )
    expect(settlements.map(({ taskId }) => taskId)).toEqual(["A", "B"])
    expect(bBeganAt).toBeGreaterThan(settlements[0]?.position ?? Number.POSITIVE_INFINITY)
    expect(run.records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Completed"
      )
    ).toBe(false)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies[1].lifecycles.some(
            ({ lifecycle, taskId }) => taskId === TaskId.make("A") && lifecycle._tag === "CompletedSuccessfully"
          )
      )
    ).toBe(true)
  })
)

it.effect(
  "captures every authored delivery frame from production and keeps desired tickets separate from held work",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedDependentTasksRun
      const established = run.deliveryFrames.filter(({ graph }) => graph._tag === "Established")

      expect(run.deliveryFrames[0]?.graph).toEqual({ _tag: "NotEstablished" })
      expect(established.length).toBeGreaterThan(1)
      const firstEstablished = established[0]
      if (firstEstablished === undefined || firstEstablished.graph._tag !== "Established") {
        return expect.fail("expected an established production delivery frame")
      }
      const establishedGraph = firstEstablished.graph
      const graphRecord = run.records.find(({ position }) => position === establishedGraph.observation.recordedAt)
      expect(graphRecord?.event._tag).toBe("TaskTrackerFactsObserved")
      if (graphRecord?.event._tag !== "TaskTrackerFactsObserved") {
        return expect.fail("expected the frame's exact graph observation record")
      }
      expect(establishedGraph.observation).toEqual({
        operationId: graphRecord.event.operationId,
        contentIdentity: establishedGraph.revision,
        recordedAt: graphRecord.position
      })
      expect(graphRecord.event.observation.operationId).toBe(establishedGraph.observation.operationId)
      const startingProjection = projectTrackerSnapshot(run.cassette.startingFacts.trackerGraph)
      if (startingProjection._tag !== "Valid") return expect.fail("expected the declared starting graph to project")
      const startingA = startingProjection.snapshot.eligibleTasks().find(({ id }) => id === TaskId.make("A"))
      if (startingA === undefined) return expect.fail("expected eligible task A in the starting graph")
      const eligibleA = firstEstablished.frontier.find(
        (standing) => standing.standing === "Eligible" && standing.taskId === TaskId.make("A")
      )
      expect(eligibleA?.taskRevision).toBe(taskRevisionFor(startingA))
      expect(established.some(({ frontier }) => frontier.some(({ taskId }) => taskId === "B"))).toBe(true)
      expect(
        established.some(
          ({ frontier, heldPositions }) =>
            !heldPositions.some(({ taskId }) => taskId === "A") &&
            frontier.some(
              ({ reasons, standing, taskId }) =>
                taskId === "B" &&
                standing === "Excluded" &&
                reasons.some(({ kind }) => kind === "PrerequisitesIncomplete")
            )
        )
      ).toBe(true)
      expect(
        established.some(({ frontier }) =>
          frontier.some(({ standing, taskId }) => taskId === "B" && standing === "Eligible")
        )
      ).toBe(true)
      expect(
        established.some(
          ({ heldPositions, tickets }) =>
            tickets.some(({ placement, taskId }) => taskId === "A" && placement.kind === "Selected") &&
            !heldPositions.some(({ taskId }) => taskId === "A")
        )
      ).toBe(true)
      const trackerRead = run.deliveryFrames
        .flatMap(({ actionPlanning }) =>
          actionPlanning._tag === "DeliveryProposalsAvailable" ? actionPlanning.proposals : []
        )
        .find(({ exact }) => exact.includes('"_tag": "TrackerGraphReadRoute"'))
      expect(trackerRead).toMatchObject({
        attemptId: null,
        summary:
          "Read the tracker graph to establish the current graph · needs no executor/Continue-or-Stop serialization · needs no task-work position · needs no integration-target resource · planned by the tracker graph layer",
        taskId: null
      })
      expect(() => JSON.stringify(run.deliveryFrames)).not.toThrow()
    })
)

it.effect("notifies the read-only delivery observer before returning the terminal authored result", () =>
  Effect.gen(function* () {
    const publications: Array<{ readonly activationOrdinal: number; readonly storyPosition: number }> = []
    const run = yield* runAuthoredScenarioCassette(dependentTasksCompleteInOneRunAuthoredCassette, {
      onDeliveryPublication: ({ activationOrdinal, storyPosition }) => {
        publications.push({ activationOrdinal, storyPosition })
      }
    })

    expect(publications.length).toBe(run.deliveryFrames.length)
    expect(publications.length).toBeGreaterThan(1)
    expect(publications[0]).toEqual({
      activationOrdinal: run.deliveryFrames[0]?.activationOrdinal,
      storyPosition: run.deliveryFrames[0]?.storyPosition
    })
    expect(publications.at(-1)?.storyPosition).toBe(run.deliveryFrames.at(-1)?.storyPosition)
  })
)

it.effect("reuses one delivery relation evaluation for the authored publication frame", () =>
  Effect.gen(function* () {
    let captured: AuthoredDeliveryPublication | undefined
    yield* runAuthoredScenarioCassette(dependentTasksCompleteInOneRunAuthoredCassette, {
      onDeliveryPublication: (publication) => {
        captured ??= publication
      }
    })
    if (captured === undefined) return expect.fail("expected a delivery publication")

    const separate = yield* Effect.all({
      consequences: evaluateDeliveryRelationInputBundle(captured.bundle),
      runtime: evaluateDeliveryRuntimeInputBundle(captured.bundle)
    })
    const combined = yield* evaluateDeliveryRelationAndRuntimeInputBundle(captured.bundle)

    expect(combined.runtime).toEqual(separate.runtime)
    expect(combined.consequences).toEqual(separate.consequences)
  })
)

it.effect("retains every conflicting production proposal owner in the delivery frame", () =>
  Effect.gen(function* () {
    let captured: AuthoredDeliveryPublication | undefined
    yield* runAuthoredScenarioCassette(dependentTasksCompleteInOneRunAuthoredCassette, {
      onDeliveryPublication: (publication) => {
        captured ??= publication
      }
    })
    if (captured === undefined) return expect.fail("expected a delivery publication")
    const trackerProposal = captured.bundle.actionInputs.trackerGraphProposals[0]
    if (trackerProposal === undefined) return expect.fail("expected the initial tracker graph proposal")

    const frame = yield* evaluateAuthoredDeliveryPublication({
      ...captured,
      bundle: {
        ...captured.bundle,
        actionInputs: {
          ...captured.bundle.actionInputs,
          proposalContributions: {
            ...captured.bundle.actionInputs.proposalContributions,
            ticketDelivery: [{ ...trackerProposal, owner: "TicketDelivery" }]
          }
        }
      }
    })

    expect(frame.actionPlanning._tag).toBe("DeliveryProposalOwnershipConflict")
    if (frame.actionPlanning._tag !== "DeliveryProposalOwnershipConflict") {
      return expect.fail("expected the production proposal ownership conflict")
    }
    expect(frame.actionPlanning.conflicts).toHaveLength(1)
    expect(frame.actionPlanning.conflicts[0]?.summary).toBe(
      `Proposal ownership conflict for ${trackerProposal.id}: TrackerGraph and TicketDelivery · planning fails closed`
    )
    expect(JSON.parse(frame.actionPlanning.conflicts[0]?.exact ?? "null")).toMatchObject({
      owners: ["TrackerGraph", "TicketDelivery"]
    })
  })
)

it.effect("projects every isolated action-planning issue through its typed maintainer meaning", () =>
  Effect.gen(function* () {
    let captured: AuthoredDeliveryPublication | undefined
    yield* runAuthoredScenarioCassette(dependentTasksCompleteInOneRunAuthoredCassette, {
      onDeliveryPublication: (publication) => {
        captured ??= publication
      }
    })
    if (captured === undefined) return expect.fail("expected a delivery publication")
    const frame = yield* evaluateAuthoredDeliveryPublication({
      ...captured,
      bundle: {
        ...captured.bundle,
        actionInputs: {
          ...captured.bundle.actionInputs,
          proposalContributions: {
            ...captured.bundle.actionInputs.proposalContributions,
            issues: [
              {
                _tag: "AcceptedOperationEvidenceMissing",
                operationId: OperationId.make("lab-isolated-accepted-evidence"),
                taskId: TaskId.make("A"),
                transition: "ReconcileTaskClaim"
              },
              {
                _tag: "FreshRouteProvenanceMissing",
                taskId: TaskId.make("A"),
                transition: "ContinueFreshWorkflowOperation"
              },
              { _tag: "TypedRoutePolicyContradiction", taskId: TaskId.make("A"), transition: "StartQueuedIntegration" }
            ]
          }
        }
      }
    })

    expect(frame.actionPlanning._tag).toBe("DeliveryProposalsAvailable")
    if (frame.actionPlanning._tag !== "DeliveryProposalsAvailable") {
      return expect.fail("expected isolated action-planning issues")
    }
    expect(frame.actionPlanning.isolatedIssues.map(({ summary }) => summary)).toEqual([
      "Dalph cannot check the tracker after an ambiguous task-claim request because accepted journal evidence is missing · task A",
      "Dalph cannot send the already-journaled request to its recorded owning system because fresh route provenance is missing · task A",
      "Dalph cannot start the exact queued integration responsibility because the typed route policy contradicts this transition · task A"
    ])
  })
)

it.effect("separates delivery frames across authored coordinator activations", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runUnpauseDuringSuspensionRestartsAuthoredCassette)
    const initial = run.deliveryFrames.filter(({ activationOrdinal }) => activationOrdinal === 1)
    const later = run.deliveryFrames.filter(({ activationOrdinal }) => activationOrdinal === 2)

    expect(initial.length).toBeGreaterThan(0)
    expect(later.length).toBeGreaterThan(0)
    expect(run.deliveryFrames.findIndex(({ activationOrdinal }) => activationOrdinal === 2)).toBe(initial.length)
    const lastInitialStoryPosition = initial.at(-1)?.storyPosition
    if (lastInitialStoryPosition === undefined) return expect.fail("expected an initial-activation delivery frame")
    expect(later.every(({ storyPosition }) => storyPosition >= lastInitialStoryPosition)).toBe(true)
    const initialHeld = initial.flatMap(({ heldPositions }) => heldPositions)
    const laterHeld = later.flatMap(({ heldPositions }) => heldPositions)
    expect(initialHeld.some(({ attemptId }) => attemptId === "attempt:A:0")).toBe(true)
    expect(laterHeld.some(({ attemptId }) => attemptId === "attempt:A:0")).toBe(true)
  })
)

it.effect("separates every coordinator activation while a lost claim-release response is reconciled", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopReleaseResponseLostAuthoredCassette)
    const activationOrdinals = [...new Set(run.deliveryFrames.map(({ activationOrdinal }) => activationOrdinal))]

    expect(run.activationOrdinals).toEqual([1, 2, 3, 4, 5])
    expect(activationOrdinals).toEqual([1, 2, 3, 4, 5])
    for (const ordinal of activationOrdinals) {
      const frames = run.deliveryFrames.filter(({ activationOrdinal }) => activationOrdinal === ordinal)
      expect(frames.length).toBeGreaterThan(0)
    }
    expect(
      run.deliveryFrames
        .filter(({ activationOrdinal }) => activationOrdinal > 1)
        .some(({ heldPositions }) => heldPositions.some(({ attemptId }) => attemptId === "attempt:A:0"))
    ).toBe(true)
  })
)

it.effect("retains the exact paused quiescence disposition in production delivery frames", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runPauseSafelySuspendsAuthoredCassette)
    const pauseRecord = run.records.find(
      ({ event }) =>
        event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
    )
    if (pauseRecord === undefined) return expect.fail("expected the accepted Run Pause record")

    const beforePause = run.deliveryFrames.filter(
      ({ acceptedAt }) => acceptedAt !== null && acceptedAt < pauseRecord.position
    )
    const afterPause = run.deliveryFrames.filter(
      ({ acceptedAt }) => acceptedAt !== null && acceptedAt >= pauseRecord.position
    )
    expect(beforePause.some(({ quiescence }) => quiescence._tag === "TrackerReconfirmationAllowed")).toBe(true)
    expect(afterPause.length).toBeGreaterThan(0)
    expect(afterPause.every(({ quiescence }) => quiescence._tag === "QuiescencePassive")).toBe(true)
    expect(afterPause[0]?.quiescence).toEqual({ _tag: "QuiescencePassive", reason: "RunPaused" })
  })
)

it.effect("performs one final tracker read before the current bounded activation returns or terminates", () =>
  Effect.gen(function* () {
    const finalGraphReturnAt = singleton.story.findLastIndex((item) => item._tag === "TrackerGraphReadReturned")
    const cassette = {
      ...singleton,
      name: "one final tracker read precedes the bounded activation return",
      story: singleton.story.flatMap((item, index) => {
        if (index !== finalGraphReturnAt || item._tag !== "TrackerGraphReadReturned") return [item]
        return [
          { _tag: "RunActivationFinalTrackerGraphReadReturned" as const, graph: item.graph },
          {
            _tag: "CoordinatorActivationReturned" as const,
            decision: { _tag: "RunMustRemainActive" as const, reason: "TrackerTargetUnsettled" as const }
          }
        ]
      })
    }
    const command = singleton.story[1]
    if (command?._tag !== "RunCoordinator") return yield* Effect.die("singleton has no coordinator command")
    const terminalGraph = {
      revision: TrackerRevision.make("activation-final-completed-target"),
      rootTaskId: "A" as const,
      tasks: [
        { id: "A", lifecycle: { _tag: "CompletedSuccessfully" as const }, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const terminatingCassette = {
      ...singleton,
      name: "one final tracker read precedes Run termination",
      startingFacts: { ...singleton.startingFacts, taskWorkSpecifications: [], trackerGraph: terminalGraph },
      story: [
        singleton.story[0],
        command,
        { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: command.target } },
        { _tag: "TrackerGraphReadReturned" as const, graph: terminalGraph },
        { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: command.target } },
        { _tag: "RunActivationFinalTrackerGraphReadReturned" as const, graph: terminalGraph },
        { _tag: "CoordinatorActivationReturned" as const, decision: { _tag: "RunMayTerminate" as const } },
        {
          _tag: "ExpectedBehavior" as const,
          orchestration: null,
          protocol: null,
          taskWork: { absences: [], results: [] }
        }
      ]
    }
    const [run, terminated] = yield* Effect.all([
      runAuthoredScenarioCassette(cassette),
      runAuthoredScenarioCassette(terminatingCassette)
    ])
    const graphObservations = run.records.flatMap(({ event }) =>
      event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []
    )

    expect(run.activationOrdinals).toEqual([1])
    expect(cassette.story.filter(({ _tag }) => _tag === "RunActivationFinalTrackerGraphReadReturned")).toHaveLength(1)
    expect(graphObservations.at(-1)?._tag).toBe("UnchangedTaskTrackerFactsReconfirmed")
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain("final complete target-closure read")
    expect(run.records.at(-1)?.event._tag).toBe("TaskTrackerFactsObserved")
    expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A"])
    expect(terminated.records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
    expect(terminated.activationOrdinals).toEqual([1])
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
    expectRecordedRoundTrip(terminated.records, yield* projectRecordedCassette(terminated.records))
    const encoded = yield* Schema.encodeUnknownEffect(AuthoredScenarioCassette)(run.cassette)
    expect(yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(encoded)).toEqual(run.cassette)
  })
)

it.effect("re-enters the same Run and activates it after quiescent incomplete return", () =>
  Effect.gen(function* () {
    const finalGraphReturnAt = singleton.story.findLastIndex((item) => item._tag === "TrackerGraphReadReturned")
    const finalAssertions = singleton.story.at(-1)
    if (finalAssertions?._tag !== "ExpectedBehavior") return yield* Effect.die("singleton has no assertions")
    const storyBeforeFinalRead = singleton.story.slice(0, finalGraphReturnAt)
    const finalGraph = singleton.startingFacts.trackerGraph
    const finalReturn = {
      _tag: "CoordinatorActivationReturned" as const,
      decision: { _tag: "RunMustRemainActive" as const, reason: "TrackerTargetUnsettled" as const }
    }
    const cassette = {
      ...singleton,
      name: "the same Run enters another activation after an incomplete return",
      story: [
        ...storyBeforeFinalRead,
        { _tag: "RunActivationFinalTrackerGraphReadReturned" as const, graph: finalGraph },
        finalReturn,
        { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned" as const, graph: finalGraph },
        { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" } },
        { _tag: "RunActivationFinalTrackerGraphReadReturned" as const, graph: finalGraph },
        finalReturn,
        finalAssertions
      ]
    }
    const run = yield* runAuthoredScenarioCassette(cassette)

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(run.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(new Set(run.records.map(({ runId }) => runId))).toEqual(new Set([run.runId]))
    expect(cassette.story.filter(({ _tag }) => _tag === "RunActivationFinalTrackerGraphReadReturned")).toHaveLength(2)
    expectRecordedRoundTrip(run.records, yield* projectRecordedCassette(run.records))
  })
)

it.effect("gives newly begun and reconstructed Runs the same one-shot finality path", () =>
  Effect.gen(function* () {
    const firstGraphResult = singleton.story.findIndex((item) => item._tag === "TrackerGraphReadReturned")
    const cassette = {
      ...singleton,
      name: "restart before the first claim intent recomputes current delivery",
      story: singleton.story.flatMap((item, index) =>
        index === firstGraphResult
          ? [
              item,
              { _tag: "CoordinatorProcessDies" as const },
              {
                _tag: "DalphSelects" as const,
                operation: { _tag: "ReadTrackerGraph" as const, target: "cassette-target" }
              },
              { _tag: "TrackerGraphReadReturned" as const, graph: singleton.startingFacts.trackerGraph }
            ]
          : [item]
      )
    }
    const [uninterrupted, run] = yield* Effect.all([
      runAuthoredScenarioCassette(singleton),
      runAuthoredScenarioCassette(cassette)
    ])

    expect(uninterrupted.activationOrdinals).toEqual([1])
    expect(run.activationOrdinals).toEqual([1, 2])
    expect(run.observedBehavior).toEqual(uninterrupted.observedBehavior)
    expect(
      [uninterrupted, run].map(({ records }) => records.filter(({ event }) => event._tag === "WorkflowRunBegan").length)
    ).toEqual([1, 1])
    expect(
      [uninterrupted, run].map(({ records }) => records.some(({ event }) => event._tag === "WorkflowRunTerminated"))
    ).toEqual([false, false])
    expect([uninterrupted, run].map(({ records }) => records.at(-1)?.event._tag)).toEqual([
      "TaskTrackerFactsObserved",
      "TaskTrackerFactsObserved"
    ])
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimAcquired")).toHaveLength(1)
    expect(run.records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
  })
)

it.effect("an invalid quiescent refresh authorizes no new work", () =>
  Effect.gen(function* () {
    const lastGraphReturn = singleton.story.findLastIndex((item) => item._tag === "TrackerGraphReadReturned")
    const invalidRefresh = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === lastGraphReturn && item._tag === "TrackerGraphReadReturned"
          ? {
              ...item,
              graph: {
                revision: "contradictory-quiescent-refresh",
                tasks: [
                  { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
                  { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
                ]
              }
            }
          : item
      )
    }

    expect((yield* runAuthoredScenarioCassette(invalidRefresh).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )
  })
)

it.effect("an incomplete quiescent refresh authorizes no new work", () =>
  Effect.gen(function* () {
    const lastGraphReturn = singleton.story.findLastIndex((item) => item._tag === "TrackerGraphReadReturned")
    const incompleteRefresh = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === lastGraphReturn ? { _tag: "TrackerGraphReadFailed", reason: "IncompleteSnapshot" } : item
      )
    }

    const failure = yield* runAuthoredScenarioCassette(incompleteRefresh).pipe(Effect.flip)
    expect(failure._tag).toBe("TrackerGraphReader.AdapterReadError")
    expect("detail" in failure ? failure.detail : "").toContain("IncompleteSnapshot")
    expect(
      renderAuthoredCassetteLyrics(yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)(incompleteRefresh))
    ).toContain("The task tracker fails the logical graph read because IncompleteSnapshot.")
  })
)

it.effect("later complete reads add newly selected D and keep removed unstarted C from responsibility", () =>
  Effect.gen(function* () {
    const target = "changed-membership-cassette-target"
    const initialGraph = {
      revision: "changed-membership-before",
      tasks: [
        { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const changedGraph = {
      revision: "changed-membership-after",
      tasks: [
        { id: "A", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const membershipChangedGraph = {
      revision: "changed-membership-before-A-completes",
      tasks: [
        { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const read = (graph: typeof initialGraph) => [
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
      { _tag: "TrackerGraphReadReturned", graph }
    ]
    const changedMembership = {
      _tag: "AuthoredScenarioCassette",
      name: "a later tracker-success refresh removes unstarted C and adds D",
      schemaVersion: 1,
      startingFacts: {
        executorWork: "NoPriorReport",
        journal: "Empty",
        taskClaims: [],
        taskWorkSpecifications: [
          { body: "Complete A.", taskId: "A", title: "Complete A" },
          { body: "Complete D.", taskId: "D", title: "Complete D" }
        ],
        trackerGraph: initialGraph,
        worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
      },
      story: [
        { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
        {
          _tag: "RunCoordinator",
          baseSha: "3333333333333333333333333333333333333333",
          claimOwner: "changed-membership-owner",
          claimTokenPrefix: "changed-membership-claim",
          executor: "executor:controlled-fake",
          integrationTarget: { repository: "/dalph/cassettes/changed-membership.git", ref: "refs/heads/master" },
          target,
          worktreeRoot: "/dalph/cassettes/changed-membership"
        },
        ...read(initialGraph),
        ...read(initialGraph),
        ...read(membershipChangedGraph),
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
        ...read(membershipChangedGraph),
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
        { _tag: "TaskWorkSpecificationReadReturned", body: "Complete A.", taskId: "A", title: "Complete A" },
        { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:A:0", taskId: "A" } },
        { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:A:0" },
          request: "Begin"
        },
        {
          _tag: "PlannedAttemptExecutorProjectionReturned",
          report: { _tag: "ExecutorWorkTerminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } }
        },
        ...read(changedGraph),
        ...read(changedGraph),
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "D" } },
        ...read(changedGraph),
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "D" } },
        { _tag: "TaskWorkSpecificationReadReturned", body: "Complete D.", taskId: "D", title: "Complete D" },
        { _tag: "DalphSelects", operation: { _tag: "RecordTaskAttemptPlan", attemptId: "attempt:D:1", taskId: "D" } },
        { _tag: "DalphSelects", operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:D:1", taskId: "D" } },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:D:1" },
          request: "Begin"
        },
        {
          _tag: "PlannedAttemptExecutorProjectionReturned",
          report: { _tag: "ExecutorWorkTerminal", attemptId: "attempt:D:1", result: { _tag: "Completed" } }
        },
        {
          _tag: "ExpectedBehavior",
          orchestration: null,
          protocol: null,
          taskWork: {
            absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "C" }],
            results: [
              { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
              { _tag: "PlannedWorkForTaskCompleted", taskId: "D" }
            ]
          }
        }
      ]
    }

    const run = yield* runAuthoredScenarioCassette(changedMembership)
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A", "D"])
  })
)

const insertBeforeRunTermination = (
  records: ReadonlyArray<JournalRecord>,
  event: WorkflowJournalEvent
): ReadonlyArray<JournalRecord> => {
  const terminationIndex = records.findIndex(({ event: recorded }) => recorded._tag === "WorkflowRunTerminated")
  const insertionIndex = terminationIndex < 0 ? records.length : terminationIndex
  const runId = records[0]?.runId
  if (runId === undefined) return records
  return [
    ...records.slice(0, insertionIndex),
    { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(insertionIndex + 1), runId },
    ...records.slice(insertionIndex)
  ].map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
}

it.effect("runs the maintained singleton through production activation and describes only its task-work result", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singleton)
    const expected = singleton.story.at(-1)

    expect(run.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }])
    expect(run.observedBehavior.plannedWorkUndertakenFor).toEqual(["A"])
    expect(run.observedBehavior.orchestrationEvidence).toBeNull()
    expect(run.observedBehavior.protocolEvidence).toBeNull()
    expect(expected?._tag === "ExpectedBehavior" ? expected.orchestration : undefined).toBeNull()
    expect(expected?._tag === "ExpectedBehavior" ? expected.protocol : undefined).toBeNull()
    expect(JSON.stringify(expected)).not.toContain("attempt:A:0")
    expect(run.records.map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved",
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "TaskWorktreeReady",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended",
      "PlannedAttemptExecutorCommandResponseObserved",
      "PlannedAttemptExecutorWorkReported",
      "PlannedAttemptExecutorStateObserved",
      "PlannedAttemptExecutorWorkReported",
      "TaskTrackerReadIntentRecorded",
      "TaskTrackerFactsObserved"
    ])
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported"
          ? [{ attemptId: event.report.correlation.attemptId, report: event.report._tag }]
          : []
      )
    ).toEqual([
      { attemptId: "attempt:A:0", report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:A:0", report: "ExecutorWorkTerminal" }
    ])
  })
)

it.effect("keeps the maintained singleton Run active while its tracker task remains open", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.singletonTaskCompletes)
    const encoded = yield* Schema.encodeUnknownEffect(AuthoredScenarioCassette)(run.cassette)
    const terminalAssertions = run.cassette.story.at(-1)
    const terminalExecutorReport = run.records.findLast(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"
    )?.event

    expect(JSON.stringify(encoded)).not.toContain("runId")
    expect(run.runId).not.toContain("cassette-target")
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.observedBehavior.taskWorkResults).toEqual(
      terminalAssertions?._tag === "ExpectedBehavior" ? terminalAssertions.taskWork.results : []
    )
    expect(run.records.at(-1)?.event._tag).toBe("TaskTrackerFactsObserved")
    expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    expect(
      terminalExecutorReport?._tag === "PlannedAttemptExecutorWorkReported"
        ? terminalExecutorReport.report._tag
        : undefined
    ).toBe("ExecutorWorkTerminal")
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects the planned work for task A to complete."
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects Dalph not to assume executor-work responsibility for any planned attempt belonging to task B."
    )
  })
)

it.effect("assigns a fresh exact run identity each time the same tracker target starts", () =>
  Effect.gen(function* () {
    const first = yield* runAuthoredScenarioCassette(singleton)
    const second = yield* runAuthoredScenarioCassette(singleton)
    const command = singleton.story.find((item) => item._tag === "RunCoordinator")
    if (command?._tag !== "RunCoordinator") return yield* Effect.die("maintained story has no coordinator command")

    expect(first.runId).not.toBe(second.runId)
    expect(first.runId).not.toContain("cassette-target")
    expect(second.runId).not.toContain("cassette-target")
    expect((yield* decodeFreshWorkflowRunIdForDiagnostics(first.runId)).target).toEqual(command.target)
    expect((yield* decodeFreshWorkflowRunIdForDiagnostics(second.runId)).target).toEqual(command.target)

    const correlatedRunIds = first.records.flatMap(({ event, runId }) => {
      if (event._tag === "TaskAttemptPlanned" || event._tag === "TaskWorktreeReconciliationIntended") {
        return [runId, event.operation.plannedAttempt.runId]
      }
      if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
        return [runId, event.plannedAttempt.runId]
      }
      if (event._tag === "PlannedAttemptExecutorWorkReported") {
        return [runId, event.report.correlation.runId]
      }
      return [runId]
    })
    expect(new Set(correlatedRunIds)).toEqual(new Set([first.runId]))
  })
)

it.effect("runs another story with a different initial task-execution capacity", () =>
  Effect.gen(function* () {
    const capacityTwo = {
      ...singleton,
      name: "the singleton starts with two task-work positions",
      story: singleton.story.map((item) =>
        item._tag === "InitialControlPolicy" ? { ...item, policy: { taskExecutionCapacity: 2 } } : item
      )
    }
    const run = yield* runAuthoredScenarioCassette(capacityTwo)

    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.cassette.story[0]).toEqual({ _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 2 } })
  })
)

it.effect("requires one terminal assertion group and one owner for every decoded story item", () =>
  Effect.gen(function* () {
    const withoutAssertions = {
      ...singleton,
      story: singleton.story.filter((item) => item._tag !== "ExpectedBehavior")
    }
    expect((yield* runAuthoredScenarioCassette(withoutAssertions).pipe(Effect.flip))._tag).toBe("SchemaError")

    const duplicateAssertions = { ...singleton, story: [...singleton.story, singleton.story.at(-1)] }
    expect((yield* runAuthoredScenarioCassette(duplicateAssertions).pipe(Effect.flip))._tag).toBe("SchemaError")

    const nonTerminalAssertions = {
      ...singleton,
      story: [...singleton.story.slice(0, -2), singleton.story.at(-1), singleton.story.at(-2)]
    }
    expect((yield* runAuthoredScenarioCassette(nonTerminalAssertions).pipe(Effect.flip))._tag).toBe("SchemaError")

    const duplicateCoordinatorDeath = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        { _tag: "CoordinatorProcessDies" },
        { _tag: "CoordinatorProcessDies" },
        singleton.story.at(-1)
      ]
    }
    expect((yield* runAuthoredScenarioCassette(duplicateCoordinatorDeath).pipe(Effect.flip))._tag).toBe("SchemaError")

    const laterActivationGraphRead = [
      { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
      { _tag: "TrackerGraphReadReturned", graph: singleton.startingFacts.trackerGraph }
    ] as const
    const repeatedDeathsWithLaterActivations = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        { _tag: "CoordinatorProcessDies" as const },
        ...laterActivationGraphRead,
        { _tag: "CoordinatorProcessDies" as const },
        ...laterActivationGraphRead,
        singleton.story.at(-1)
      ]
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(repeatedDeathsWithLaterActivations)).not.toThrow()

    const finalGraphAt = singleton.story.findLastIndex((item) => item._tag === "TrackerGraphReadReturned")
    const finalReadWithActivationReturn = {
      ...singleton,
      story: singleton.story.flatMap((item, index) =>
        index === finalGraphAt && item._tag === "TrackerGraphReadReturned"
          ? [
              { _tag: "RunActivationFinalTrackerGraphReadReturned" as const, graph: item.graph },
              {
                _tag: "CoordinatorActivationReturned" as const,
                decision: { _tag: "RunMustRemainActive" as const, reason: "TrackerTargetUnsettled" as const }
              }
            ]
          : [item]
      )
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(finalReadWithActivationReturn)).not.toThrow()
    const finalReadWithoutSelection = {
      ...finalReadWithActivationReturn,
      story: finalReadWithActivationReturn.story.filter((_item, index) => index !== finalGraphAt - 1)
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(finalReadWithoutSelection)).toThrow()
    const finalReadWithoutActivationReturn = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === finalGraphAt && item._tag === "TrackerGraphReadReturned"
          ? { _tag: "RunActivationFinalTrackerGraphReadReturned" as const, graph: item.graph }
          : item
      )
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(finalReadWithoutActivationReturn)).toThrow()

    const executorLossWithoutDeath = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        {
          _tag: "PlannedAttemptExecutorResponseLost",
          detail: "the coordinator kept running after losing the response",
          report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:A:0" },
          request: "Suspend"
        },
        singleton.story.at(-1)
      ]
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(executorLossWithoutDeath)).toThrow()

    const executorLossWithoutProjection = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        {
          _tag: "PlannedAttemptExecutorResponseLost",
          detail: "the response is lost and the next activation never projects executor authority",
          report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:A:0" },
          request: "Suspend"
        },
        { _tag: "CoordinatorProcessDies" },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: singleton.startingFacts.trackerGraph },
        singleton.story.at(-1)
      ]
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(executorLossWithoutProjection)).toThrow()

    const claimLossWithoutDeath = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        {
          _tag: "TaskClaimReleaseResponseLost",
          detail: "the coordinator kept running after losing the response",
          taskId: "A"
        },
        singleton.story.at(-1)
      ]
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(claimLossWithoutDeath)).toThrow()

    const holdWithoutMatchingStop = {
      ...changedAttemptStopCancelsHeldResumeAuthoredCassette,
      story: changedAttemptStopCancelsHeldResumeAuthoredCassette.story.map((item) =>
        item._tag === "OperatorStopsAttempt" &&
        item.expected._tag === "Applied" &&
        item.expected.status === "AwaitingQuiescence"
          ? { ...item, attemptId: "attempt:wrong:0" }
          : item
      )
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(holdWithoutMatchingStop)).toThrow()

    const duplicateContinuationHold = {
      ...changedAttemptStopCancelsHeldResumeAuthoredCassette,
      story: changedAttemptStopCancelsHeldResumeAuthoredCassette.story.flatMap(
        (item): ReadonlyArray<AuthoredCassetteStoryItem> =>
          item._tag === "DalphHoldsAdmittedContinuationBeforeExecutorIntent" ? [item, item] : [item]
      )
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(duplicateContinuationHold)).toThrow()

    const holdWithoutExactUnpause = {
      ...changedAttemptStopCancelsHeldResumeAuthoredCassette,
      story: changedAttemptStopCancelsHeldResumeAuthoredCassette.story.map((item) =>
        item._tag === "OperatorAppliesControlDirection" && item.direction === "Unpause" && item.subject._tag === "Task"
          ? { ...item, direction: "Pause" }
          : item
      )
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(holdWithoutExactUnpause)).toThrow()

    const heldStory = changedAttemptStopCancelsHeldResumeAuthoredCassette.story
    const holdIndex = heldStory.findIndex(({ _tag }) => _tag === "DalphHoldsAdmittedContinuationBeforeExecutorIntent")
    const stopIndex = heldStory.findIndex((item, index) => index > holdIndex && item._tag === "OperatorStopsAttempt")
    const heldSpecificationIndex = heldStory.findIndex(
      (item, index) => index > holdIndex && index < stopIndex && item._tag === "TaskWorkSpecificationReadReturned"
    )
    const holdWithoutExactSpecification = {
      ...changedAttemptStopCancelsHeldResumeAuthoredCassette,
      story: heldStory.map((item, index) =>
        index === heldSpecificationIndex && item._tag === "TaskWorkSpecificationReadReturned"
          ? { _tag: "TaskClaimCurrentReadReturned", taskId: "A" }
          : item
      )
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(holdWithoutExactSpecification)).toThrow()

    const terminalChoiceReleasesHeldResume = {
      ...changedAttemptStopCancelsHeldResumeAuthoredCassette,
      story: heldStory.flatMap((item, index) =>
        index === stopIndex
          ? [
              item,
              {
                _tag: "PlannedAttemptExecutorWorkReported" as const,
                report: { _tag: "ExecutorWorkExecuting" as const, attemptId: "attempt:A:0" },
                request: "Resume" as const
              }
            ]
          : [item]
      )
    }
    expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(terminalChoiceReleasesHeldResume)).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(AuthoredScenarioCassette)(changedAttemptStopCancelsHeldResumeAuthoredCassette)
    ).not.toThrow()

    const assertions = singleton.story.at(-1)
    if (assertions?._tag !== "ExpectedBehavior") return yield* Effect.die("missing singleton assertions")
    const duplicateAbsence = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        {
          ...assertions,
          taskWork: {
            ...assertions.taskWork,
            absences: [...assertions.taskWork.absences, assertions.taskWork.absences[0]]
          }
        }
      ]
    }
    expect((yield* runAuthoredScenarioCassette(duplicateAbsence).pipe(Effect.flip))._tag).toBe("SchemaError")
    const contradictory = {
      ...singleton,
      story: [
        ...singleton.story.slice(0, -1),
        {
          ...assertions,
          taskWork: { ...assertions.taskWork, absences: [{ _tag: "NoPlannedWorkUndertakenForTask", taskId: "A" }] }
        }
      ]
    }
    expect((yield* runAuthoredScenarioCassette(contradictory).pipe(Effect.flip))._tag).toBe("SchemaError")

    const noOwner = yield* assertExactlyOneAuthoredCassetteStoryItemOwner("UnknownTag").pipe(Effect.flip)
    expect(noOwner).toMatchObject({ _tag: "AuthoredCassetteStoryItemOwnerContradiction", registrations: [] })
    const duplicateOwner = yield* assertExactlyOneAuthoredCassetteStoryItemOwner("DalphSelects", {
      First: ["DalphSelects"],
      Second: ["DalphSelects"]
    }).pipe(Effect.flip)
    expect(duplicateOwner).toMatchObject({
      _tag: "AuthoredCassetteStoryItemOwnerContradiction",
      registrations: ["First", "Second"],
      tag: "DalphSelects"
    })
  })
)

it.effect("lowers capacity while A holds a position and admits B only after A releases it", () =>
  Effect.gen(function* () {
    const firstRunning = dependentTasksCompleteInOneRunAuthoredCassette.story.findIndex(
      (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "ExecutorWorkExecuting"
    )
    const withAppliedChange = {
      ...dependentTasksCompleteInOneRunAuthoredCassette,
      story: dependentTasksCompleteInOneRunAuthoredCassette.story.flatMap((item, index) => [
        ...(index === 0 && item._tag === "InitialControlPolicy"
          ? [{ ...item, policy: { taskExecutionCapacity: 2 } }]
          : [item]),
        ...(index === firstRunning ? [{ _tag: "SetTaskExecutionCapacity", capacity: 1 } as const] : [])
      ])
    }
    const withShiftedIntegratorPositions = {
      ...withAppliedChange,
      story: withAppliedChange.story.map((item) => {
        if (item._tag !== "IntegratorRequestReceived") return item
        const correlation = item.correlation
        const startedAt = correlation.startedAt + 1
        const targetLineageObservedAt = correlation.targetLineageObservedAt + 1
        const oldPositions = `:${correlation.startedAt}:${correlation.targetLineageObservedAt}:`
        const newPositions = `:${startedAt}:${targetLineageObservedAt}:`
        return {
          ...item,
          correlation: {
            ...correlation,
            candidateResource: correlation.candidateResource.replace(oldPositions, newPositions),
            queuedAt: correlation.queuedAt + 1,
            sessionId: correlation.sessionId.replace(oldPositions, newPositions),
            startedAt,
            targetLineageObservedAt
          }
        }
      })
    }
    const run = yield* runAuthoredScenarioCassette(withShiftedIntegratorPositions)
    const recordedLyrics = renderAuthoredCassetteLyrics(run.cassette)
    const changedAt = run.records.findIndex(({ event }) => event._tag === "TaskWorkCapacityChanged")
    const aTerminalAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "ExecutorWorkTerminal" &&
        event.report.correlation.attemptId === "attempt:A:0"
    )
    const bResponsibilityAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.taskId === TaskId.make("B")
    )

    expect(changedAt).toBeGreaterThan(0)
    expect(aTerminalAt).toBeGreaterThan(changedAt)
    expect(bResponsibilityAt).toBeGreaterThan(aTerminalAt)
    expect(recordedLyrics).toContain("Operator applies task-execution capacity 1 to the Run.")
    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskAccepted", commit: "a".repeat(40), taskId: "A" },
      { _tag: "PlannedWorkForTaskAccepted", commit: "b".repeat(40), taskId: "B" }
    ])
  })
)

it.effect("retains both executing holders until terminal observations release contracted capacity", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(contractedCapacityRetainsTwoAttemptsAuthoredCassette)
    const recorded = yield* projectRecordedCassette(run.records)
    const reopened = foldRecordedCassette(recorded)
    const changedAt = run.records.findIndex(({ event }) => event._tag === "TaskWorkCapacityChanged")
    const responsibilityAt = (taskId: TaskId) =>
      run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === taskId
      )
    const cResponsibilityAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.taskId === TaskId.make("C")
    )
    const cClaimAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === TaskId.make("C")
    )
    const terminalAt = (attemptId: AttemptId) =>
      run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === attemptId &&
          event.report._tag === "ExecutorWorkTerminal"
      )
    const aTerminalAt = terminalAt(AttemptId.make("attempt:A:0"))
    const bTerminalAt = terminalAt(AttemptId.make("attempt:B:1"))
    const aResponsibilityAt = responsibilityAt(TaskId.make("A"))
    const bResponsibilityAt = responsibilityAt(TaskId.make("B"))
    const cStartIntents = run.records.flatMap(({ event }, index) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.attemptId === AttemptId.make("attempt:C:0") &&
      event.command === "Begin"
        ? [{ event, index }]
        : []
    )

    expect(changedAt).toBeGreaterThan(0)
    expect(aResponsibilityAt).toBeGreaterThan(0)
    expect(bResponsibilityAt).toBeGreaterThan(0)
    expect(aResponsibilityAt).toBeLessThan(changedAt)
    expect(bResponsibilityAt).toBeLessThan(changedAt)
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          (event.plannedAttempt.taskId === TaskId.make("A") || event.plannedAttempt.taskId === TaskId.make("B"))
      )
    ).toHaveLength(2)
    expect(aTerminalAt).toBeGreaterThan(changedAt)
    expect(bTerminalAt).toBeGreaterThan(changedAt)
    expect(cClaimAt).toBeGreaterThan(aTerminalAt)
    expect(cClaimAt).toBeGreaterThan(bTerminalAt)
    expect(cResponsibilityAt).toBeGreaterThan(aTerminalAt)
    expect(cResponsibilityAt).toBeGreaterThan(bTerminalAt)
    expect(cStartIntents).toHaveLength(1)
    expect(cStartIntents[0]?.index).toBeGreaterThan(aTerminalAt)
    expect(cStartIntents[0]?.index).toBeGreaterThan(bTerminalAt)
    expect(run.activationOrdinals).toEqual([1, 2])
    expect(run.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(new Set(run.records.map(({ runId }) => runId))).toEqual(new Set([run.runId]))
    expect(reopened._tag).toBe("ValidWorkflowJournalHistory")
    if (reopened._tag === "ValidWorkflowJournalHistory") {
      expect(Option.getOrThrow(reopened.runState.controlPolicy)).toEqual({
        revision: RunPolicyRevision.make(2),
        taskExecutionCapacity: TaskWorkCapacity.make(1)
      })
    }
    expect(run.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskCompleted", taskId: "A" },
      { _tag: "PlannedWorkForTaskCompleted", taskId: "B" },
      { _tag: "PlannedWorkForTaskCompleted", taskId: "C" }
    ])
    expectRecordedRoundTrip(run.records, recorded)
  })
)

it.effect("safely suspends A after membership removal while independent B continues, including external success", () =>
  Effect.gen(function* () {
    const target = "localized-constraint-target"
    const aAttemptId = AttemptId.make("attempt:A:0")
    const bAttemptId = AttemptId.make("attempt:B:0")
    const initialGraph = {
      revision: TrackerRevision.make("localized-constraint-initial"),
      tasks: [
        { id: TaskId.make("A"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] },
        {
          id: TaskId.make("B"),
          lifecycle: { _tag: "Open" } as const,
          parentTaskId: null,
          prerequisiteIds: [TaskId.make("A")]
        }
      ]
    }
    const localizedGraph = {
      revision: TrackerRevision.make("pipeline-A-left-target"),
      tasks: [{ id: TaskId.make("B"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] }]
    }
    const localizedCassette = {
      _tag: "AuthoredScenarioCassette",
      name: "A leaves the target while independent B continues",
      schemaVersion: 1,
      startingFacts: {
        executorWork: "NoPriorReport",
        journal: "Empty",
        taskClaims: [],
        taskWorkSpecifications: [
          { body: "Complete task A.", taskId: TaskId.make("A"), title: "Complete A" },
          { body: "Complete independent task B.", taskId: TaskId.make("B"), title: "Complete B" }
        ],
        trackerGraph: initialGraph,
        worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
      },
      story: [
        { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: TaskWorkCapacity.make(2) } },
        {
          _tag: "RunCoordinator",
          baseSha: "3333333333333333333333333333333333333333",
          claimOwner: "localized-constraint-owner",
          claimTokenPrefix: "localized-constraint-claim",
          executor: "executor:controlled-fake",
          integrationTarget: { repository: "/dalph/cassettes/localized-constraint.git", ref: "refs/heads/master" },
          target,
          worktreeRoot: "/dalph/cassettes/localized-constraint"
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
        { _tag: "TrackerGraphReadReturned", graph: initialGraph },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
        { _tag: "TrackerGraphReadReturned", graph: initialGraph },
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: TaskId.make("A") } },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
        { _tag: "TrackerGraphReadReturned", graph: initialGraph },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: TaskId.make("A") } },
        {
          _tag: "TaskWorkSpecificationReadReturned",
          body: "Complete task A.",
          taskId: TaskId.make("A"),
          title: "Complete A"
        },
        {
          _tag: "DalphSelects",
          operation: { _tag: "RecordTaskAttemptPlan", attemptId: aAttemptId, taskId: TaskId.make("A") }
        },
        {
          _tag: "DalphSelects",
          operation: { _tag: "ReconcileTaskWorktree", attemptId: aAttemptId, taskId: TaskId.make("A") }
        },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkExecuting", attemptId: aAttemptId },
          request: "Begin"
        },
        { _tag: "CoordinatorProcessDies" },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
        { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
        {
          _tag: "DalphHoldsExecutorRequestThroughNextDeliveryPublication",
          attemptId: aAttemptId,
          request: "Suspend",
          taskId: TaskId.make("A")
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkSafelySuspended", attemptId: aAttemptId },
          request: "Suspend"
        },
        { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: TaskId.make("B") } },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
        { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: TaskId.make("B") } },
        {
          _tag: "TaskWorkSpecificationReadReturned",
          body: "Complete independent task B.",
          taskId: TaskId.make("B"),
          title: "Complete B"
        },
        {
          _tag: "DalphSelects",
          operation: { _tag: "RecordTaskAttemptPlan", attemptId: bAttemptId, taskId: TaskId.make("B") }
        },
        {
          _tag: "DalphSelects",
          operation: { _tag: "ReconcileTaskWorktree", attemptId: bAttemptId, taskId: TaskId.make("B") }
        },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkExecuting", attemptId: bAttemptId },
          request: "Begin"
        },
        {
          _tag: "PlannedAttemptExecutorProjectionReturned",
          report: { _tag: "ExecutorWorkTerminal", attemptId: bAttemptId, result: { _tag: "Completed" } }
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target } },
        { _tag: "TrackerGraphReadReturned", graph: localizedGraph },
        {
          _tag: "ExpectedBehavior",
          orchestration: [
            { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: aAttemptId, taskId: TaskId.make("A") },
            { _tag: "PlannedAttemptExecutorWorkReported", attemptId: aAttemptId, report: "ExecutorWorkExecuting" },
            {
              _tag: "PlannedAttemptExecutorWorkReported",
              attemptId: aAttemptId,
              report: "ExecutorWorkSafelySuspended"
            },
            { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: bAttemptId, taskId: TaskId.make("B") },
            { _tag: "PlannedAttemptExecutorWorkReported", attemptId: bAttemptId, report: "ExecutorWorkExecuting" },
            {
              _tag: "PlannedAttemptExecutorWorkReported",
              attemptId: bAttemptId,
              report: "ExecutorWorkTerminalCompleted"
            }
          ] as const,
          protocol: null,
          taskWork: { absences: [], results: [{ _tag: "PlannedWorkForTaskCompleted", taskId: TaskId.make("B") }] }
        }
      ]
    }

    const run = yield* runAuthoredScenarioCassette(localizedCassette)
    const recorded = yield* projectRecordedCassette(run.records)
    const membershipObservedAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "CompleteTaskTrackerFacts" &&
        event.observation.factFamilies.some(
          (family) =>
            family._tag === "TaskTargetMembership" &&
            family.memberTaskIds.length === 1 &&
            family.memberTaskIds[0] === TaskId.make("B")
        )
    )
    const bResponsibilityAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.taskId === TaskId.make("B")
    )

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === aAttemptId
          ? [event.report._tag]
          : []
      )
    ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
    expect(membershipObservedAt).toBeGreaterThan(0)
    expect(bResponsibilityAt).toBeGreaterThan(membershipObservedAt)
    expect(run.records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    expect(
      recorded.entries.some(
        (entry) =>
          entry._tag === "PlannedAttemptExecutorWorkReported" &&
          entry.report.correlation.attemptId === aAttemptId &&
          entry.report._tag === "ExecutorWorkTerminal"
      )
    ).toBe(false)
    expect(renderRecordedCassetteLyrics(recorded)).toContain(
      `The executor returned ExecutorWorkTerminal for attempt ${bAttemptId}.`
    )
    expect(run.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskCompleted", taskId: "B" }])

    const trackerSuccessfulGraph = {
      revision: TrackerRevision.make("pipeline-A-completed-externally"),
      tasks: [
        {
          id: TaskId.make("A"),
          lifecycle: { _tag: "CompletedSuccessfully" } as const,
          parentTaskId: null,
          prerequisiteIds: []
        },
        {
          id: TaskId.make("B"),
          lifecycle: { _tag: "Open" } as const,
          parentTaskId: null,
          prerequisiteIds: [TaskId.make("A")]
        }
      ]
    }
    const trackerSuccessStory = localizedCassette.story.map((item) =>
      item._tag === "TrackerGraphReadReturned" && item.graph === localizedGraph
        ? { ...item, graph: trackerSuccessfulGraph }
        : item
    )
    const trackerSuccessSuspensionAt = trackerSuccessStory.findIndex(
      (item) =>
        item._tag === "PlannedAttemptExecutorWorkReported" &&
        "report" in item &&
        item.report._tag === "ExecutorWorkSafelySuspended" &&
        item.report.attemptId === aAttemptId
    )
    const trackerSuccessCassette = {
      ...localizedCassette,
      name: "the tracker reports A complete while its exact claim and WIP remain",
      story: [
        ...trackerSuccessStory.slice(0, trackerSuccessSuspensionAt + 2),
        { _tag: "DalphSelects" as const, operation: { _tag: "ReleaseTaskClaim" as const, taskId: TaskId.make("A") } },
        ...trackerSuccessStory.slice(trackerSuccessSuspensionAt + 2)
      ]
    }
    const trackerSuccessRun = yield* runAuthoredScenarioCassette(trackerSuccessCassette)
    const claimReleaseEvents = trackerSuccessRun.records.filter(
      ({ event }) => event._tag === "TaskClaimReleaseIntended" || event._tag === "TaskClaimReleased"
    )
    expect(claimReleaseEvents.map(({ event }) => event._tag)).toEqual(["TaskClaimReleaseIntended", "TaskClaimReleased"])
    expect(
      trackerSuccessRun.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === aAttemptId &&
          event.report._tag === "ExecutorWorkTerminal"
      )
    ).toBe(false)
    const changedInstructionsGraph = {
      revision: TrackerRevision.make("pipeline-A-instructions-changed"),
      tasks: [
        { id: TaskId.make("A"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] },
        { id: TaskId.make("B"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const changedGraphStory = localizedCassette.story.map((item) =>
      item._tag === "TrackerGraphReadReturned" && item.graph === localizedGraph
        ? { ...item, graph: changedInstructionsGraph }
        : item
    )
    const changedInstructionsStory = changedGraphStory
      .filter((item) => {
        if (item._tag === "DalphHoldsExecutorRequestThroughNextDeliveryPublication") return false
        return !(
          item._tag === "PlannedAttemptExecutorWorkReported" &&
          "report" in item &&
          item.report._tag === "ExecutorWorkSafelySuspended" &&
          item.report.attemptId === aAttemptId
        )
      })
      .map((item) => {
        if (item._tag !== "ExpectedBehavior" || item.orchestration === undefined) {
          return item
        }
        return {
          ...item,
          orchestration: item.orchestration.filter(
            (evidence) =>
              !(
                evidence._tag === "PlannedAttemptExecutorWorkReported" &&
                evidence.attemptId === aAttemptId &&
                evidence.report === "ExecutorWorkSafelySuspended"
              )
          )
        }
      })
    const changedInstructionsCassette = {
      ...localizedCassette,
      name: "A instructions change while independent B continues",
      story: changedInstructionsStory
    }
    const changedInstructionsRun = yield* runAuthoredScenarioCassette(changedInstructionsCassette)
    expect(
      changedInstructionsRun.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === aAttemptId
          ? [event.report._tag]
          : []
      )
    ).toEqual(["ExecutorWorkExecuting"])
    expect(
      changedInstructionsRun.records.some(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
      )
    ).toBe(false)
    expect(
      changedInstructionsRun.records.some(
        ({ event }) => event._tag === "TaskClaimReleaseIntended" || event._tag === "TaskClaimReleased"
      )
    ).toBe(false)
    expect(changedInstructionsRun.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
    ])

    const terminalWithoutSuccessGraph = {
      revision: TrackerRevision.make("pipeline-A-terminal-without-success"),
      tasks: [
        {
          id: TaskId.make("A"),
          lifecycle: { _tag: "TerminalWithoutSuccess" } as const,
          parentTaskId: null,
          prerequisiteIds: []
        },
        { id: TaskId.make("B"), lifecycle: { _tag: "Open" } as const, parentTaskId: null, prerequisiteIds: [] }
      ]
    }
    const lifecycleCassette = {
      ...localizedCassette,
      name: "A closes without success while independent B continues",
      story: localizedCassette.story.map((item) =>
        item._tag === "TrackerGraphReadReturned" && item.graph === localizedGraph
          ? { ...item, graph: terminalWithoutSuccessGraph }
          : item
      )
    }
    const lifecycleRun = yield* runAuthoredScenarioCassette(lifecycleCassette)
    expect(
      lifecycleRun.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === aAttemptId
          ? [event.report._tag]
          : []
      )
    ).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
    expect(
      lifecycleRun.records.some(
        ({ event }) => event._tag === "TaskClaimReleaseIntended" || event._tag === "TaskClaimReleased"
      )
    ).toBe(false)
    expect(lifecycleRun.observedBehavior.taskWorkResults).toEqual([
      { _tag: "PlannedWorkForTaskCompleted", taskId: "B" }
    ])
  })
)

it.effect("rejects cassette-local contradictions and leaves an authority mismatch to its ordinary boundary", () =>
  Effect.gen(function* () {
    const inconsistentGraph = {
      ...singleton,
      startingFacts: {
        ...singleton.startingFacts,
        trackerGraph: { ...singleton.startingFacts.trackerGraph, revision: "not-the-first-return" }
      }
    }
    expect((yield* runAuthoredScenarioCassette(inconsistentGraph).pipe(Effect.flip))._tag).toBe("SchemaError")

    const authorityMismatch = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "TaskWorkSpecificationReadReturned" ? { ...item, taskId: "B" } : item
      ),
      startingFacts: {
        ...singleton.startingFacts,
        taskWorkSpecifications: [{ ...singleton.startingFacts.taskWorkSpecifications[0], taskId: "B" }]
      }
    }
    expect((yield* runAuthoredScenarioCassette(authorityMismatch).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )
  })
)

it.effect("reports mismatches through the surface that owns the current story item", () =>
  Effect.gen(function* () {
    const existingClaim = {
      _tag: "ActiveTaskClaim",
      operationId: "existing-claim-operation",
      owner: "another-owner",
      taskId: "A",
      token: "existing-claim-token"
    }
    const duplicateClaims = {
      ...singleton,
      startingFacts: { ...singleton.startingFacts, taskClaims: [existingClaim, existingClaim] }
    }
    expect((yield* runAuthoredScenarioCassette(duplicateClaims).pipe(Effect.flip))._tag).toBe("SchemaError")

    const wrongExpectedAction = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === 2 && item._tag === "DalphSelects"
          ? { ...item, operation: { _tag: "ReadTrackerGraph", target: "wrong-target" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongExpectedAction).pipe(Effect.flip))._tag).toBe(
      "TraceOutput.TraceOutputError"
    )

    const wrongTrackerItem = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === 3
          ? { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongTrackerItem).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )

    const wrongSpecificationItem = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "TaskWorkSpecificationReadReturned"
          ? { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongSpecificationItem).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )

    const invalidGraph = {
      revision: "invalid-duplicate-task",
      tasks: [singleton.startingFacts.trackerGraph.tasks[0], singleton.startingFacts.trackerGraph.tasks[0]]
    }
    const invalidGraphStory = {
      ...singleton,
      startingFacts: { ...singleton.startingFacts, trackerGraph: invalidGraph },
      story: singleton.story.map((item) =>
        item._tag === "TrackerGraphReadReturned" ? { ...item, graph: invalidGraph } : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(invalidGraphStory).pipe(Effect.flip))._tag).toBe(
      "TrackerGraphReader.AdapterReadError"
    )

    const wrongExecutorItem = {
      ...singleton,
      story: singleton.story.map((item, index) =>
        index === 13 ? { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } } : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongExecutorItem).pipe(Effect.flip))._tag).toBe(
      "PlannedAttemptExecutorCommandFailure"
    )

    const wrongAttempt = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "PlannedAttemptExecutorWorkReported"
          ? { ...item, report: { ...item.report, attemptId: "another-attempt" } }
          : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongAttempt).pipe(Effect.flip))._tag).toBe(
      "PlannedAttemptExecutorCommandFailure"
    )

    const lifecycleFailure = {
      ...wrongExecutorItem,
      story: [
        ...wrongExecutorItem.story.slice(0, -1),
        { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
        wrongExecutorItem.story.at(-1)
      ]
    }
    expect(Exit.isFailure(yield* runAuthoredScenarioCassette(lifecycleFailure).pipe(Effect.exit))).toBe(true)

    const missingPlannedAttempt = {
      ...changedAttemptContinuesAuthoredCassette,
      story: changedAttemptContinuesAuthoredCassette.story.map((item) =>
        item._tag === "OperatorContinuesAttempt" ? { ...item, attemptId: "missing-attempt" } : item
      )
    }
    expect(Exit.isFailure(yield* runAuthoredScenarioCassette(missingPlannedAttempt).pipe(Effect.exit))).toBe(true)

    const unavailableAppliedChoice = {
      ...changedAttemptContinuesAuthoredCassette,
      story: changedAttemptContinuesAuthoredCassette.story.map((item) =>
        item._tag === "OperatorContinuesAttempt"
          ? { ...item, observedTaskRevision: "unavailable-authored-revision" }
          : item
      )
    }
    expect(Exit.isFailure(yield* runAuthoredScenarioCassette(unavailableAppliedChoice).pipe(Effect.exit))).toBe(true)

    const mismatchedRejection = {
      ...postIntegrationAttemptChoiceRejectedAuthoredCassette,
      story: postIntegrationAttemptChoiceRejectedAuthoredCassette.story.map((item) =>
        item._tag === "OperatorContinuesAttempt" && item.expected._tag === "Rejected"
          ? { ...item, expected: { _tag: "Rejected", reason: "NotAvailable" } }
          : item
      )
    }
    expect(Exit.isFailure(yield* runAuthoredScenarioCassette(mismatchedRejection).pipe(Effect.exit))).toBe(true)

    const mismatchedForeignRejection = {
      ...changedAttemptReacquisitionForeignConflictAuthoredCassette,
      story: changedAttemptReacquisitionForeignConflictAuthoredCassette.story.map((item) =>
        item._tag === "TaskClaimAcquisitionRejected"
          ? { ...item, observed: { ...item.observed, token: "unexpected-foreign-token" } }
          : item
      )
    }
    expect(yield* runAuthoredScenarioCassette(mismatchedForeignRejection).pipe(Effect.flip)).toMatchObject({
      _tag: "AuthoredCassetteInteractionMismatch"
    })

    const mismatchedForeignConflict = {
      ...changedAttemptReacquisitionForeignConflictAuthoredCassette,
      story: changedAttemptReacquisitionForeignConflictAuthoredCassette.story.map((item) =>
        item._tag === "TaskClaimAcquisitionConflictReturned"
          ? { ...item, operationId: "unexpected-acquisition-operation" }
          : item
      )
    }
    expect(yield* runAuthoredScenarioCassette(mismatchedForeignConflict).pipe(Effect.flip)).toMatchObject({
      _tag: "AuthoredCassetteInteractionMismatch"
    })

    const exactClaimConflict = {
      ...changedAttemptReacquisitionForeignConflictAuthoredCassette,
      story: changedAttemptReacquisitionForeignConflictAuthoredCassette.story.map((item) =>
        item._tag === "TaskClaimAcquisitionConflictReturned"
          ? {
              ...item,
              observed: {
                ...item.observed,
                operationId: item.operationId,
                owner: "cassette-owner",
                token: `cassette-claim:A:${item.operationId}`
              }
            }
          : item
      )
    }
    expect(yield* runAuthoredScenarioCassette(exactClaimConflict).pipe(Effect.flip)).toMatchObject({
      _tag: "AuthoredCassetteInteractionMismatch"
    })

    const unknownForeignRejection = {
      ...changedAttemptReacquisitionForeignConflictAuthoredCassette,
      story: changedAttemptReacquisitionForeignConflictAuthoredCassette.story.map((item) =>
        item._tag === "TaskClaimAcquisitionRejected" ? { ...item, operationId: "unknown-acquisition-operation" } : item
      )
    }
    expect(yield* runAuthoredScenarioCassette(unknownForeignRejection).pipe(Effect.flip)).toMatchObject({
      _tag: "AuthoredCassetteInteractionMismatch"
    })
  })
)

it.effect("rejects a contradictory coordinator activation return decision", () =>
  Effect.gen(function* () {
    const mismatched = {
      ...changedAttemptStopReleaseResponseLostAuthoredCassette,
      story: changedAttemptStopReleaseResponseLostAuthoredCassette.story.map((item) =>
        item._tag === "CoordinatorActivationReturned" ? { ...item, decision: { _tag: "RunMayTerminate" } } : item
      )
    }
    expect(Exit.isFailure(yield* runAuthoredScenarioCassette(mismatched).pipe(Effect.exit))).toBe(true)
  })
)

it.effect("derives failed task-work results and safely suspended orchestration evidence from recorded handling", () =>
  Effect.gen(function* () {
    const failed = {
      ...singleton,
      story: singleton.story.map((item) => {
        if (item._tag === "PlannedAttemptExecutorProjectionReturned" && item.report._tag === "ExecutorWorkTerminal") {
          return { ...item, report: { ...item.report, result: { _tag: "Failed" } } }
        }
        if (item._tag === "ExpectedBehavior") {
          return {
            ...item,
            taskWork: { ...item.taskWork, results: [{ _tag: "PlannedWorkForTaskFailed", taskId: "A" }] }
          }
        }
        return item
      })
    }
    const failedRun = yield* runAuthoredScenarioCassette(failed)
    expect(failedRun.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskFailed", taskId: "A" }])
    expect(renderAuthoredCassetteLyrics(failedRun.cassette)).toContain(
      "The story expects the planned work for task A to fail."
    )

    const suspendedRun = yield* runAuthoredScenarioCassette(runPauseSafelySuspendsAuthoredCassette)
    expect(suspendedRun.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId: "attempt:A:0",
      report: "ExecutorWorkSafelySuspended"
    })
  })
)

it.effect("records a foreign claim after process death and safely suspends only its exact attempt", () =>
  Effect.gen(function* () {
    const foreignClaim = {
      _tag: "ActiveTaskClaim",
      operationId: OperationId.make("replacement-claim-A"),
      owner: ClaimOwner.make("another-owner"),
      taskId: TaskId.make("A"),
      token: ClaimToken.make("replacement-token-A")
    } as const
    const run = yield* runAuthoredScenarioCassette(changedAttemptStopsWithForeignClaimAuthoredCassette)
    expect(run.records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)

    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries).toContainEqual(
      expect.objectContaining({
        _tag: "TaskTrackerFactsObserved",
        evidence: expect.objectContaining({ _tag: "FocusedTaskClaimFacts", observation: foreignClaim })
      })
    )
    expectRecordedRoundTrip(run.records, recorded)

    const unreadableRun = yield* runAuthoredScenarioCassette(changedAttemptStopReleaseResponseLostAuthoredCassette)
    const unreadableRecorded = yield* projectRecordedCassette(unreadableRun.records)
    expect(unreadableRecorded.entries).toContainEqual(
      expect.objectContaining({
        _tag: "TaskTrackerFactsObserved",
        evidence: expect.objectContaining({ _tag: "FocusedTaskClaimFactsUnreadable" })
      })
    )
    expectRecordedRoundTrip(unreadableRun.records, unreadableRecorded)
    expect(renderAuthoredCassetteLyrics(unreadableRun.cassette)).toContain(
      "The task tracker cannot read the claim for task A."
    )
  })
)

it.effect("drives a public operator claim-reacquisition request through a later activation", () =>
  Effect.gen(function* () {
    const expected = singleton.story.at(-1)
    if (expected?._tag !== "ExpectedBehavior") return yield* Effect.die("singleton has no terminal assertions")
    const safeReportAt = lostPlannedWorktreeSafelySuspendsAuthoredCassette.story.findIndex(
      (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "ExecutorWorkSafelySuspended"
    )
    if (safeReportAt < 0) return yield* Effect.die("causally suspended story has no Safe executor report")
    const postSafeGraphReadItemCount = 2
    const storyBeforeAssertions = lostPlannedWorktreeSafelySuspendsAuthoredCassette.story.slice(
      0,
      safeReportAt + 1 + postSafeGraphReadItemCount
    )
    const requestId = TaskClaimReacquisitionRequestId.make("coverage-reacquire-missing-A")
    const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...singleton,
      name: "an operator replaces a missing claim with a fresh claim identity",
      story: [
        ...storyBeforeAssertions,
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" } },
        {
          _tag: "TaskWorkSpecificationReadReturned",
          body: "Implement the accepted singleton behavior.",
          taskId: "A",
          title: "Implement singleton"
        },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
        { _tag: "TaskClaimReadReturned", observation: UnclaimedTask.make({ taskId: TaskId.make("A") }) },
        { _tag: "OperatorDirectsTaskClaimReacquisition", requestId, taskId: "A" },
        { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
        { _tag: "TrackerGraphReadReturned", graph: singleton.startingFacts.trackerGraph },
        { _tag: "DalphSelects", operation: { _tag: "AcquireTaskClaim", taskId: "A" } },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
        { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
        { _tag: "DalphSelects", operation: { _tag: "ReadTaskWorktree", attemptId: "attempt:A:0", taskId: "A" } },
        { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:0", taskId: "A" } },
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkTerminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
          request: "Resume"
        },
        {
          _tag: "CoordinatorActivationReturned",
          decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
        },
        { ...expected, orchestration: null, protocol: null }
      ]
    })

    const run = yield* runAuthoredScenarioCassette(cassette)
    const acquisitionIntents = run.records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation] : []
    )
    expect(acquisitionIntents).toHaveLength(2)
    expect(acquisitionIntents[1]).toMatchObject({
      authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId }
    })
    expect(
      run.records.some(({ event }) => event._tag === "TaskClaimReacquisitionDirected" && event.requestId === requestId)
    ).toBe(true)
  })
)

it.effect("records a foreign reacquisition rejection and never retries it after the next activation", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptReacquisitionForeignConflictAuthoredCassette)
    expect(run.activationOrdinals).toEqual([1, 2, 3])

    const acquisitionIntents = run.records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation] : []
    )
    expect(acquisitionIntents).toHaveLength(2)
    const reacquisition = acquisitionIntents[1]
    if (reacquisition === undefined) return yield* Effect.die("missing reacquisition intent")
    expect(reacquisition.authority).toMatchObject({
      _tag: "ExplicitTaskClaimReacquisitionAuthority",
      requestId: "coverage-reacquire-foreign-A"
    })

    const rejection = run.records.find(({ event }) => event._tag === "TaskClaimAcquisitionRejected")?.event
    if (rejection?._tag !== "TaskClaimAcquisitionRejected") {
      return yield* Effect.die("missing terminal foreign acquisition rejection")
    }
    expect(rejection).toMatchObject({
      operationId: reacquisition.acquisition.operationId,
      reason: "ForeignClaim",
      observed: {
        _tag: "ActiveTaskClaim",
        operationId: "foreign-reacquisition-operation-A",
        owner: "foreign-reacquisition-owner",
        taskId: "A",
        token: "foreign-reacquisition-token-A"
      }
    })
    expect(
      run.records.filter(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionIntended" &&
          event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority"
      )
    ).toHaveLength(1)
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskClaimAcquired" && event.claim.operationId === reacquisition.acquisition.operationId
      )
    ).toBe(false)

    const rejectionPosition = run.records.find(({ event }) => event._tag === "TaskClaimAcquisitionRejected")?.position
    if (rejectionPosition === undefined) return yield* Effect.die("missing rejection position")
    const laterForeignObservation = run.records.find(
      ({ event, position }) =>
        position > rejectionPosition &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskClaimFacts"
    )?.event
    if (
      laterForeignObservation?._tag !== "TaskTrackerFactsObserved" ||
      laterForeignObservation.observation._tag !== "FocusedTaskClaimFacts"
    ) {
      return yield* Effect.die("missing post-restart foreign claim observation")
    }
    expect(laterForeignObservation.observation.observation).toEqual(rejection.observed)
    expect(
      run.records.filter(
        ({ event, position }) =>
          position > rejectionPosition &&
          (event._tag === "TaskClaimAcquisitionIntended" ||
            event._tag === "TaskClaimAcquired" ||
            event._tag === "TaskClaimReleaseIntended" ||
            event._tag === "TaskClaimReleased")
      )
    ).toHaveLength(0)

    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries).toContainEqual(
      expect.objectContaining({
        _tag: "TaskClaimAcquisitionRejected",
        observed: rejection.observed,
        operationId: rejection.operationId,
        reason: "ForeignClaim"
      })
    )
    expectRecordedRoundTrip(run.records, recorded)
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "Dalph records the terminal foreign-claim rejection for task A"
    )
  })
)

it.effect("records a lost planned worktree in the authored and recorded post-death cassette", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(lostPlannedWorktreeSafelySuspendsAuthoredCassette)

    expect(run.activationOrdinals).toEqual([1, 2])
    expect(run.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "AttemptWorktreeLost",
      attemptId: "attempt:A:0",
      taskId: "A"
    })
    expect(run.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries).toContainEqual(
      expect.objectContaining({
        _tag: "PlannedAttemptWorktreeObserved",
        observation: expect.objectContaining({ _tag: "AttemptWorktreeLost" })
      })
    )
    expect(
      verifyRecordedCassetteRoundTrip(run.records, recorded).every(
        (checkpoint) =>
          checkpoint.workflowHistoryEquivalent &&
          checkpoint.operationalStateEquivalent &&
          checkpoint.pureSelectionEquivalent
      )
    ).toBe(true)
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "Git changes the planned worktree observation to PlannedWorktreeAbsent."
    )
    expect(renderRecordedCassetteLyrics(recorded)).toContain("Git no longer registered planned worktree")
  })
)

it.effect("records compatible target advancement and isolates a proven target rewrite in maintained cassettes", () =>
  Effect.gen(function* () {
    const compatible = yield* runAuthoredScenarioCassette(compatibleTargetAdvanceContinuesAuthoredCassette)
    const rewritten = yield* runAuthoredScenarioCassette(incompatibleTargetRewriteSafelySuspendsAuthoredCassette)

    expect(compatible.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "CompatibleTargetAdvance",
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "2222222222222222222222222222222222222222",
      taskId: "A"
    })
    expect(compatible.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }])
    expect(rewritten.observedBehavior.protocolEvidence).toContainEqual({
      _tag: "IncompatibleTargetRewrite",
      plannedBaseSha: "1111111111111111111111111111111111111111",
      targetHeadSha: "3333333333333333333333333333333333333333",
      taskId: "A"
    })
    expect(rewritten.observedBehavior.orchestrationEvidence).toContainEqual({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId: "attempt:A:0",
      report: "ExecutorWorkSafelySuspended"
    })
    expect(rewritten.observedBehavior.taskWorkResults).toContainEqual({
      _tag: "PlannedWorkForTaskCompleted",
      taskId: "C"
    })
    expect(rewritten.records.some(({ event }) => event._tag === "TaskClaimReleased")).toBe(false)
    expect(renderAuthoredCassetteLyrics(compatible.cassette)).toContain("descends from Base")
    expect(renderAuthoredCassetteLyrics(rewritten.cassette)).toContain("is outside Base")

    const compatibleRecorded = yield* projectRecordedCassette(compatible.records)
    const rewrittenRecorded = yield* projectRecordedCassette(rewritten.records)
    const rewrittenOccurrences = yield* projectWorkflowOccurrences(rewritten.records)
    const targetLineageOccurrence = rewrittenOccurrences.occurrences.find(
      (occurrence) => occurrence._tag === "TargetLineageObserved"
    )
    if (targetLineageOccurrence?._tag !== "TargetLineageObserved") {
      return yield* Effect.die("missing projected target-lineage occurrence")
    }
    expect(
      Option.isSome(originatingActionForTargetLineageObservation(rewrittenOccurrences, targetLineageOccurrence))
    ).toBe(true)
    expect(renderRecordedCassetteLyrics(compatibleRecorded)).toContain("descended from Base")
    expect(renderRecordedCassetteLyrics(rewrittenRecorded)).toContain("outside Base")
    expect(
      [...compatible.records, ...rewritten.records].some(({ event }) => event._tag === "TargetLineageObserved")
    ).toBe(true)
    expect(
      verifyRecordedCassetteRoundTrip(compatible.records, compatibleRecorded).every(
        (checkpoint) => checkpoint.workflowHistoryEquivalent && checkpoint.operationalStateEquivalent
      )
    ).toBe(true)
    expect(
      verifyRecordedCassetteRoundTrip(rewritten.records, rewrittenRecorded).every(
        (checkpoint) => checkpoint.workflowHistoryEquivalent && checkpoint.operationalStateEquivalent
      )
    ).toBe(true)
  })
)

it.effect("reconciles the same Run and attempt after typed cassette death without another Begin", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(coordinatorProcessDeathContinuesAuthoredCassette)
    expect(run.activationOrdinals).toEqual([1, 2])
    expect(run.observedBehavior.taskWorkResults).toEqual([{ _tag: "PlannedWorkForTaskCompleted", taskId: "A" }])
    const responsibility = run.records.find(
      ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    )
    const commands = run.records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
    const projection = run.records.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandProjectionObserved")
    expect(responsibility).toBeDefined()
    expect(commands).toHaveLength(1)
    expect(commands[0]?.event).toMatchObject({ _tag: "PlannedAttemptExecutorCommandIntended", command: "Begin" })
    expect(projection).toBeDefined()
    expect(commands[0]?.position).toBeLessThan(projection?.position ?? 0)
    expect(run.records.filter(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized")).toHaveLength(0)
    const productionEventTags: ReadonlyArray<string> = run.records.map(({ event }) => event._tag)
    expect(productionEventTags).not.toContain("CoordinatorProcessDies")
    const occurrences = yield* projectWorkflowOccurrences(run.records)
    expect(occurrences.occurrences.map(({ _tag }) => _tag)).not.toContain("PlannedAttemptContinuationAuthorized")
    const recorded = yield* projectRecordedCassette(run.records)
    expect(recorded.entries.map(({ _tag }) => _tag)).not.toContain("PlannedAttemptContinuationAuthorized")
    expectRecordedRoundTrip(run.records, recorded)
    const reports = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report.correlation] : []
    )
    expect(new Set(reports.map(({ runId }) => runId)).size).toBe(1)
    expect(new Set(reports.map(({ attemptId }) => attemptId))).toEqual(new Set(["attempt:A:0"]))
  })
)

it.effect("rejects missing, stale, later, and wrong-attempt continuation witnesses before executor contact", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskUnpauseAfterSafeSuspensionAuthoredCassette)
    const plan = run.records.find(({ event }) => event._tag === "TaskAttemptPlanned")
    const authorization = run.records.find(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized")
    if (
      plan?.event._tag !== "TaskAttemptPlanned" ||
      authorization?.event._tag !== "PlannedAttemptContinuationAuthorized"
    ) {
      return yield* Effect.die("continuation cassette did not produce its plan and authorization")
    }
    const plannedAttempt = plan.event.operation.plannedAttempt
    const witness = authorization.event.witness
    const resumeCommandIndex = run.records.findIndex(
      ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
    )
    const preCommandRecords = run.records.slice(0, resumeCommandIndex)
    type TaskFactsRecord = JournalRecord & {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
    }
    type WorktreeRecord = JournalRecord & {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptWorktreeObserved" }>
    }
    const journalFor = (records: ReadonlyArray<JournalRecord>) =>
      InRunJournal.of({
        append: () => Effect.die("continuation authorization rejection test must not append"),
        read: () => Effect.succeed(records)
      })
    const rejectWith = (records: ReadonlyArray<JournalRecord>, candidate: typeof witness) =>
      authorizePlannedAttemptContinuation(plannedAttempt, candidate).pipe(
        Effect.provideService(InRunJournal, journalFor(records)),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.flip
      )
    const replaceObservation = (
      records: ReadonlyArray<JournalRecord>,
      operationId: OperationId,
      observation: TaskTrackerFactsObservation
    ) =>
      records.map((record) =>
        record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId === operationId
          ? { ...record, event: TaskTrackerFactsObservedEvent.make({ ...record.event, observation }) }
          : record
      )
    const replacePosition = (
      records: ReadonlyArray<JournalRecord>,
      operationId: OperationId,
      position: JournalPosition
    ) =>
      records.map((record) =>
        record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId === operationId
          ? { ...record, position }
          : record
      )
    const replaceReadIntentPosition = (
      records: ReadonlyArray<JournalRecord>,
      operationId: OperationId,
      position: JournalPosition
    ) =>
      records.map((record) =>
        (record.event._tag === "TaskTrackerReadIntentRecorded" || record.event._tag === "GitReadIntentRecorded") &&
        record.event.operation.operationId === operationId
          ? { ...record, position }
          : record
      )
    const replaceTrackerReadTarget = (records: ReadonlyArray<JournalRecord>, operationId: OperationId) =>
      records.map((record) =>
        record.event._tag === "TaskTrackerReadIntentRecorded" && record.event.operation.operationId === operationId
          ? {
              ...record,
              event: {
                ...record.event,
                operation: { ...record.event.operation, target: FixtureTarget.make("foreign-continuation-target") }
              }
            }
          : record
      )
    const claimOutcome = preCommandRecords.find(
      (record): record is TaskFactsRecord =>
        record.event._tag === "TaskTrackerFactsObserved" &&
        record.event.operationId === witness.activeTaskContinuationRead.taskClaimObservationOperationId
    )
    if (claimOutcome === undefined) {
      return yield* Effect.die("continuation cassette did not produce claim outcome")
    }
    const claimObservation = claimOutcome.event.observation
    if (claimObservation._tag !== "FocusedTaskClaimFacts") {
      return yield* Effect.die("continuation cassette did not produce focused claim facts")
    }
    const claimObservationFor = (operationId: OperationId) => ({
      ...claimObservation,
      freshness: { ...claimObservation.freshness, operationId },
      operationId
    })
    const graphOutcome = preCommandRecords.find(
      (record): record is TaskFactsRecord =>
        record.event._tag === "TaskTrackerFactsObserved" &&
        record.event.operationId === witness.activeTaskContinuationRead.graphObservationOperationId
    )
    if (graphOutcome === undefined) {
      return yield* Effect.die("continuation cassette did not produce graph outcome")
    }
    const idempotent = yield* authorizePlannedAttemptContinuation(plannedAttempt, witness).pipe(
      Effect.provideService(InRunJournal, journalFor(preCommandRecords)),
      Effect.provide(plannedAttemptProtocolControllerLayer)
    )
    expect(idempotent.key).toBe(authorization.key)

    const missingResponsibility = yield* rejectWith(
      preCommandRecords.filter(({ event }) => event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan"),
      witness
    )
    expect(missingResponsibility).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "MissingWitness",
      witness: "ActiveTaskContinuationGraph"
    })

    expect(
      Exit.isFailure(
        yield* Schema.decodeUnknownEffect(ActiveTaskContinuationRead)({
          graphObservationOperationId: OperationId.make("duplicate-continuation-observation"),
          taskClaimObservationOperationId: OperationId.make("duplicate-continuation-observation"),
          taskWorkSpecificationObservationOperationId: OperationId.make("distinct-continuation-observation")
        }).pipe(Effect.exit)
      )
    ).toBe(true)
    expect(
      Exit.isFailure(
        yield* Schema.decodeUnknownEffect(PlannedAttemptContinuationWitness)({
          activeTaskContinuationRead: {
            graphObservationOperationId: OperationId.make("duplicate-witness-observation"),
            taskClaimObservationOperationId: OperationId.make("distinct-witness-claim"),
            taskWorkSpecificationObservationOperationId: OperationId.make("distinct-witness-specification")
          },
          targetLineageObservationOperationId: OperationId.make("distinct-witness-target-lineage"),
          worktreeObservationOperationId: OperationId.make("duplicate-witness-observation")
        }).pipe(Effect.exit)
      )
    ).toBe(true)

    const missing = yield* rejectWith(preCommandRecords, {
      ...witness,
      activeTaskContinuationRead: {
        ...witness.activeTaskContinuationRead,
        graphObservationOperationId: OperationId.make("missing-continuation-graph")
      }
    })
    expect(missing).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "MissingWitness",
      witness: "ActiveTaskContinuationGraph"
    })

    const missingSpecification = yield* rejectWith(preCommandRecords, {
      ...witness,
      activeTaskContinuationRead: {
        ...witness.activeTaskContinuationRead,
        taskWorkSpecificationObservationOperationId: OperationId.make("missing-continuation-specification")
      }
    })
    expect(missingSpecification).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "MissingWitness",
      witness: "ActiveTaskContinuationSpecification"
    })

    const specificationOutcome = preCommandRecords.find(
      (record): record is TaskFactsRecord =>
        record.event._tag === "TaskTrackerFactsObserved" &&
        record.event.operationId === witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId
    )
    if (specificationOutcome === undefined) {
      return yield* Effect.die("continuation cassette did not produce specification outcome")
    }
    const staleSpecification = yield* rejectWith(
      replacePosition(preCommandRecords, specificationOutcome.event.operationId, graphOutcome.position),
      witness
    )
    expect(staleSpecification).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "StaleWitness",
      witness: "ActiveTaskContinuationSpecification"
    })
    const laterSpecification = yield* rejectWith(
      replaceReadIntentPosition(
        preCommandRecords,
        specificationOutcome.event.operationId,
        JournalPosition.make((specificationOutcome.position as number) + 1)
      ),
      witness
    )
    expect(laterSpecification).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "LaterWitness",
      witness: "ActiveTaskContinuationSpecification"
    })
    const wrongSpecification = yield* rejectWith(
      replaceObservation(
        preCommandRecords,
        specificationOutcome.event.operationId,
        claimObservationFor(specificationOutcome.event.operationId)
      ),
      witness
    )
    expect(wrongSpecification).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationSpecification"
    })
    const wrongSpecificationTarget = yield* rejectWith(
      replaceTrackerReadTarget(
        preCommandRecords,
        witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId
      ),
      witness
    )
    expect(wrongSpecificationTarget).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationSpecification"
    })

    const missingClaim = yield* rejectWith(preCommandRecords, {
      ...witness,
      activeTaskContinuationRead: {
        ...witness.activeTaskContinuationRead,
        taskClaimObservationOperationId: OperationId.make("missing-continuation-claim")
      }
    })
    expect(missingClaim).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "MissingWitness",
      witness: "ActiveTaskContinuationClaim"
    })
    const staleClaim = yield* rejectWith(
      replacePosition(preCommandRecords, claimOutcome.event.operationId, specificationOutcome.position),
      witness
    )
    expect(staleClaim).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "StaleWitness",
      witness: "ActiveTaskContinuationClaim"
    })
    const laterClaim = yield* rejectWith(
      replaceReadIntentPosition(
        preCommandRecords,
        claimOutcome.event.operationId,
        JournalPosition.make((claimOutcome.position as number) + 1)
      ),
      witness
    )
    expect(laterClaim).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "LaterWitness",
      witness: "ActiveTaskContinuationClaim"
    })
    const wrongClaim = yield* rejectWith(
      replaceObservation(preCommandRecords, claimOutcome.event.operationId, {
        ...claimObservation,
        observation: UnclaimedTask.make({ taskId: plannedAttempt.taskId })
      }),
      witness
    )
    expect(wrongClaim).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationClaim"
    })
    const wrongClaimTarget = yield* rejectWith(
      replaceTrackerReadTarget(preCommandRecords, witness.activeTaskContinuationRead.taskClaimObservationOperationId),
      witness
    )
    expect(wrongClaimTarget).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationClaim"
    })

    const missingWorktree = yield* rejectWith(preCommandRecords, {
      ...witness,
      worktreeObservationOperationId: OperationId.make("missing-continuation-worktree")
    })
    expect(missingWorktree).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "MissingWitness",
      witness: "PlannedAttemptWorktree"
    })
    const worktreeOutcome = preCommandRecords.find(
      (record): record is WorktreeRecord => record.event._tag === "PlannedAttemptWorktreeObserved"
    )
    if (worktreeOutcome === undefined) {
      return yield* Effect.die("continuation cassette did not produce worktree outcome")
    }
    const staleWorktree = yield* rejectWith(
      preCommandRecords.map((record) =>
        record.event._tag === "PlannedAttemptWorktreeObserved" &&
        record.event.operationId === worktreeOutcome.event.operationId
          ? { ...record, position: claimOutcome.position }
          : record
      ),
      witness
    )
    expect(staleWorktree).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "StaleWitness",
      witness: "PlannedAttemptWorktree"
    })
    const laterWorktree = yield* rejectWith(
      replaceReadIntentPosition(
        preCommandRecords,
        worktreeOutcome.event.operationId,
        JournalPosition.make((worktreeOutcome.position as number) + 1)
      ),
      witness
    )
    expect(laterWorktree).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "LaterWitness",
      witness: "PlannedAttemptWorktree"
    })

    const missingTargetLineage = yield* rejectWith(preCommandRecords, {
      ...witness,
      targetLineageObservationOperationId: OperationId.make("missing-continuation-target-lineage")
    })
    expect(missingTargetLineage).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "MissingWitness",
      witness: "PlannedAttemptTargetLineage"
    })
    const incompatibleTargetLineage = yield* rejectWith(
      preCommandRecords.map((record) =>
        record.event._tag === "TargetLineageObserved" &&
        record.event.operationId === witness.targetLineageObservationOperationId
          ? {
              ...record,
              event: {
                ...record.event,
                observation: { ...record.event.observation, plannedBaseIsAncestorOfTargetHead: false }
              }
            }
          : record
      ),
      witness
    )
    expect(incompatibleTargetLineage).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "PlannedAttemptTargetLineage"
    })

    const wrongGraph = yield* rejectWith(
      replaceObservation(
        preCommandRecords,
        graphOutcome.event.operationId,
        claimObservationFor(graphOutcome.event.operationId)
      ),
      witness
    )
    expect(wrongGraph).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "ActiveTaskContinuationGraph"
    })

    const safeReport = preCommandRecords.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkSafelySuspended"
    )
    if (safeReport === undefined)
      return yield* Effect.die("continuation cassette did not produce an accepted safe report")
    const stale = yield* rejectWith(
      replacePosition(preCommandRecords, graphOutcome.event.operationId, safeReport.position),
      witness
    )
    expect(stale).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "StaleWitness",
      witness: "ActiveTaskContinuationGraph"
    })

    const consumed = yield* rejectWith(run.records, witness)
    expect(consumed).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "AcceptedSafeExecutorReport"
    })

    const laterRecords = replaceReadIntentPosition(
      preCommandRecords,
      witness.activeTaskContinuationRead.graphObservationOperationId,
      JournalPosition.make((graphOutcome.position as number) + 1)
    )
    const later = yield* rejectWith(laterRecords, witness)
    expect(later).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "LaterWitness",
      witness: "ActiveTaskContinuationGraph"
    })

    const wrongAttempt = { ...plannedAttempt, attemptId: AttemptId.make("attempt:wrong:0") }
    const wrongAttemptRecords = preCommandRecords.map((record) =>
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation._tag === "ReadTaskWorktree" &&
      record.event.operation.operationId === witness.worktreeObservationOperationId
        ? {
            ...record,
            event: { ...record.event, operation: { ...record.event.operation, plannedAttempt: wrongAttempt } }
          }
        : record
    )
    const wrong = yield* rejectWith(wrongAttemptRecords, witness)
    expect(wrong).toMatchObject({
      _tag: "PlannedAttemptContinuationAuthorizationRejected",
      reason: "WrongAttemptWitness",
      witness: "PlannedAttemptWorktree"
    })
  })
)

it.effect("rejects forged continuation authorization during journal reconstruction", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(taskUnpauseAfterSafeSuspensionAuthoredCassette)
    const authorization = run.records.find(({ event }) => event._tag === "PlannedAttemptContinuationAuthorized")
    if (authorization?.event._tag !== "PlannedAttemptContinuationAuthorized") {
      return yield* Effect.die("continuation cassette did not produce authorization")
    }
    const authorizationEvent = authorization.event
    type AuthorizationEvent = Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptContinuationAuthorized" }>
    const rewriteAuthorization = (
      records: ReadonlyArray<JournalRecord>,
      rewrite: (event: AuthorizationEvent) => AuthorizationEvent
    ) =>
      records.map((record) =>
        record.event._tag === "PlannedAttemptContinuationAuthorized"
          ? { ...record, event: PlannedAttemptContinuationAuthorizedEvent.make(rewrite(record.event)) }
          : record
      )
    const replaceTrackerObservation = (
      records: ReadonlyArray<JournalRecord>,
      operationId: OperationId,
      observation: TaskTrackerFactsObservation
    ) =>
      records.map((record) =>
        record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId === operationId
          ? { ...record, event: TaskTrackerFactsObservedEvent.make({ ...record.event, observation }) }
          : record
      )
    const claimRecord = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.operationId === authorizationEvent.witness.activeTaskContinuationRead.taskClaimObservationOperationId
    )
    const graphRecord = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.operationId === authorizationEvent.witness.activeTaskContinuationRead.graphObservationOperationId
    )
    const specificationRecord = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.operationId ===
          authorizationEvent.witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId
    )
    const worktreeRecord = run.records.find(({ event }) => event._tag === "PlannedAttemptWorktreeObserved")
    if (
      claimRecord?.event._tag !== "TaskTrackerFactsObserved" ||
      claimRecord.event.observation._tag !== "FocusedTaskClaimFacts" ||
      graphRecord?.event._tag !== "TaskTrackerFactsObserved" ||
      specificationRecord?.event._tag !== "TaskTrackerFactsObserved" ||
      worktreeRecord?.event._tag !== "PlannedAttemptWorktreeObserved"
    ) {
      return yield* Effect.die("continuation cassette did not produce all authorization witnesses")
    }
    const claimObservation = claimRecord.event.observation
    const claimObservationFor = (operationId: OperationId) => ({
      ...claimObservation,
      freshness: { ...claimObservation.freshness, operationId },
      operationId
    })
    const historyOf = (records: ReadonlyArray<JournalRecord>) => reduceWorkflowJournalHistory(run.runId, records)
    const expectInvalid = (records: ReadonlyArray<JournalRecord>) =>
      expect(historyOf(records)._tag).toBe("InvalidWorkflowJournalHistory")

    expectInvalid(
      rewriteAuthorization(run.records, (event) => ({
        ...event,
        witness: {
          activeTaskContinuationRead: {
            graphObservationOperationId: OperationId.make("missing-history-graph"),
            taskClaimObservationOperationId: OperationId.make("missing-history-claim"),
            taskWorkSpecificationObservationOperationId: OperationId.make("missing-history-specification")
          },
          targetLineageObservationOperationId: OperationId.make("missing-history-target-lineage"),
          worktreeObservationOperationId: OperationId.make("missing-history-worktree")
        }
      }))
    )
    expectInvalid(
      rewriteAuthorization(run.records, (event) => ({
        ...event,
        plannedAttempt: { ...event.plannedAttempt, runId: RunId.make("foreign-history-run") }
      }))
    )
    expectInvalid(
      run.records.map((record) =>
        record.event._tag === "PlannedAttemptContinuationAuthorized"
          ? { ...record, position: JournalPosition.make(run.records.length + 1) }
          : record
      )
    )
    expectInvalid(
      run.records.map((record) =>
        record.event._tag === "TaskTrackerReadIntentRecorded" &&
        record.event.operation._tag === "ReadTrackerGraph" &&
        record.event.operation.operationId ===
          authorizationEvent.witness.activeTaskContinuationRead.graphObservationOperationId
          ? { ...record, position: JournalPosition.make((graphRecord.position as number) + 1) }
          : record
      )
    )
    expectInvalid(
      replaceTrackerObservation(
        run.records,
        graphRecord.event.operationId,
        claimObservationFor(graphRecord.event.operationId)
      )
    )
    expectInvalid(
      replaceTrackerObservation(
        run.records,
        specificationRecord.event.operationId,
        claimObservationFor(specificationRecord.event.operationId)
      )
    )
    expectInvalid(
      replaceTrackerObservation(run.records, claimRecord.event.operationId, {
        ...claimRecord.event.observation,
        observation: UnclaimedTask.make({ taskId: claimRecord.event.observation.coverage.taskId })
      })
    )
    expectInvalid(
      run.records.map((record) =>
        record.event._tag === "PlannedAttemptWorktreeObserved"
          ? {
              ...record,
              event: {
                ...record.event,
                observation: AttemptWorktreeLost.make({ plannedAttempt: authorizationEvent.plannedAttempt })
              }
            }
          : record
      )
    )
  })
)

it.effect("fails typed expected-behavior assertions and renders the applied capacity item", () =>
  Effect.gen(function* () {
    const wrongOutcomes = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior" ? { ...item, taskWork: { ...item.taskWork, results: [] } } : item
      )
    }
    expect((yield* runAuthoredScenarioCassette(wrongOutcomes).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteBehaviorMismatch"
    )

    const decoded = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...singleton,
      story: [
        ...singleton.story.slice(0, 2),
        { _tag: "SetTaskExecutionCapacity", capacity: 2 },
        ...singleton.story.slice(2)
      ]
    })
    expect(renderAuthoredCassetteLyrics(decoded)).toContain("Operator applies task-execution capacity 2 to the Run.")
  })
)

it.effect("matches optional orchestration and protocol evidence in exact order", () =>
  Effect.gen(function* () {
    const withEvidence = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              orchestration: [
                { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
                {
                  _tag: "PlannedAttemptExecutorWorkReported",
                  attemptId: "attempt:A:0",
                  report: "ExecutorWorkExecuting"
                },
                {
                  _tag: "PlannedAttemptExecutorWorkReported",
                  attemptId: "attempt:A:0",
                  report: "ExecutorWorkTerminalCompleted"
                }
              ],
              protocol: [
                { _tag: "TaskClaimAcquired", taskId: "A" },
                { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" }
              ]
            }
          : item
      )
    }
    const run = yield* runAuthoredScenarioCassette(withEvidence)

    expect(run.observedBehavior.orchestrationEvidence).toHaveLength(3)
    expect(run.observedBehavior.protocolEvidence).toHaveLength(3)
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects Dalph to assume executor-work responsibility for task A, attempt attempt:A:0."
    )
    expect(renderAuthoredCassetteLyrics(run.cassette)).toContain(
      "The story expects Dalph to acquire the claim for task A."
    )
    const allProtocolCassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...run.cassette,
      story: run.cassette.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              protocol: [
                {
                  _tag: "AttemptChoiceApplied",
                  attemptId: "attempt:A:0",
                  choice: "ContinueExistingAttempt",
                  observedTaskRevision: "render-observed-revision",
                  taskId: "A"
                },
                { _tag: "AttemptImplementationAbandoned", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "TaskClaimAcquired", taskId: "A" },
                { _tag: "TaskClaimReleased", taskId: "A" },
                { _tag: "TaskClaimObserved", claimState: "Missing", taskId: "A" },
                { _tag: "TaskClaimReadExhausted", taskId: "A" },
                { _tag: "TaskClaimReacquisitionDirected", requestId: "render-reacquisition", taskId: "A" },
                { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" },
                { _tag: "StoppedAttemptClaimNoReleaseObserved", claimState: "Foreign", taskId: "A" }
              ]
            }
          : item
      )
    })
    const allProtocolLyrics = renderAuthoredCassetteLyrics(allProtocolCassette)
    expect(allProtocolLyrics).toContain("release its exact claim")
    expect(allProtocolLyrics).toContain("record missing claim authority")
    expect(allProtocolLyrics).toContain("exhaust the bounded claim read")
    expect(allProtocolLyrics).toContain(
      "Operator request render-reacquisition to direct Dalph to reacquire the claim for task A"
    )
    expect(allProtocolLyrics).toContain("apply ContinueExistingAttempt")
    expect(allProtocolLyrics).toContain("abandon implementation responsibility")
    expect(allProtocolLyrics).toContain("preserve the foreign claim state")

    const terminalBoundaryCassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette)({
      ...allProtocolCassette,
      story: [
        ...allProtocolCassette.story.slice(0, -1),
        { _tag: "OperatorDirectsTaskClaimReacquisition", requestId: "render-operator-reacquisition", taskId: "A" },
        {
          _tag: "TargetPromotionGitReadFailed",
          candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
          detail: "the current target head is unreadable",
          repository: "/dalph/cassettes/integration.git"
        },
        { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
        allProtocolCassette.story.at(-1)
      ]
    })
    const terminalBoundaryLyrics = renderAuthoredCassetteLyrics(terminalBoundaryCassette)
    expect(terminalBoundaryLyrics).toContain("Operator request render-operator-reacquisition directs Dalph")
    expect(terminalBoundaryLyrics).toContain(
      "Git cannot reconcile candidate cccccccccccccccccccccccccccccccccccccccc in /dalph/cassettes/integration.git"
    )
    expect(terminalBoundaryLyrics).toContain("returns RunMayTerminate")
  })
)

it.effect("requires orchestration evidence when task-work results cannot distinguish attempts", () =>
  Effect.gen(function* () {
    const ambiguousResults = {
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? { ...item, taskWork: { ...item.taskWork, results: [...item.taskWork.results, ...item.taskWork.results] } }
          : item
      )
    }

    expect((yield* runAuthoredScenarioCassette(ambiguousResults).pipe(Effect.flip))._tag).toBe("SchemaError")
  })
)

it.effect("rejects missing, reordered, or additional evidence within either present authored assertion lens", () =>
  Effect.gen(function* () {
    const completeOrchestration = [
      { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
      { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "ExecutorWorkExecuting" },
      { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "ExecutorWorkTerminalCompleted" }
    ]
    const completeProtocol = [
      { _tag: "TaskClaimAcquired", taskId: "A" },
      { _tag: "TaskAttemptPlanned", attemptId: "attempt:A:0", taskId: "A" },
      { _tag: "TaskWorktreeReady", attemptId: "attempt:A:0", taskId: "A" }
    ]
    const withEvidence = (lens: "orchestration" | "protocol", evidence: ReadonlyArray<unknown>) => ({
      ...singleton,
      story: singleton.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              orchestration: lens === "orchestration" ? evidence : null,
              protocol: lens === "protocol" ? evidence : null
            }
          : item
      )
    })

    yield* Effect.forEach(
      [
        withEvidence("orchestration", completeOrchestration.slice(0, -1)),
        withEvidence("orchestration", [...completeOrchestration].reverse()),
        withEvidence("orchestration", [...completeOrchestration, completeOrchestration[0]]),
        withEvidence("protocol", completeProtocol.slice(0, -1)),
        withEvidence("protocol", [...completeProtocol].reverse()),
        withEvidence("protocol", [...completeProtocol, completeProtocol[0]])
      ],
      (input) =>
        runAuthoredScenarioCassette(input).pipe(
          Effect.flip,
          Effect.tap((failure) => Effect.sync(() => expect(failure._tag).toBe("AuthoredCassetteBehaviorMismatch")))
        ),
      { discard: true }
    )
  })
)

it.effect("rejects no-work-undertaken when Dalph assumed executor-work responsibility for that task", () =>
  Effect.gen(function* () {
    const contradictedAbsence = {
      ...runPauseSafelySuspendsAuthoredCassette,
      story: runPauseSafelySuspendsAuthoredCassette.story.map((item) =>
        item._tag === "ExpectedBehavior"
          ? {
              ...item,
              taskWork: {
                ...item.taskWork,
                absences: [
                  ...item.taskWork.absences,
                  { _tag: "NoPlannedWorkUndertakenForTask" as const, taskId: TaskId.make("A") }
                ]
              }
            }
          : item
      )
    }

    expect((yield* runAuthoredScenarioCassette(contradictedAbsence).pipe(Effect.flip))._tag).toBe(
      "AuthoredCassetteBehaviorMismatch"
    )
  })
)

it.effect("keeps explicit story interactions chronological when lower-level evidence is omitted", () =>
  Effect.gen(function* () {
    const firstSelection = singleton.story[2]
    const firstResponse = singleton.story[3]
    const outOfOrder = {
      ...singleton,
      story: [singleton.story[0], singleton.story[1], firstResponse, firstSelection, ...singleton.story.slice(4)]
    }

    expect((yield* runAuthoredScenarioCassette(outOfOrder).pipe(Effect.flip))._tag).toBe("TraceOutput.TraceOutputError")
  })
)

it.effect(
  "projects every occurrence and checks state, history, position, and selection after every non-empty prefix",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singleton)
      const recorded = yield* projectRecordedCassette(run.records)
      const checkpoints = verifyRecordedCassetteRoundTrip(run.records, recorded)
      const encoded = yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded)

      expect(recorded.entries).toHaveLength(run.records.length)
      expect(JSON.stringify(Reflect.get(encoded, "entries"))).not.toMatch(/"key"|"position"|"version"/)
      expect(checkpoints).toHaveLength(run.records.length)
      expect(
        checkpoints.every(
          (checkpoint) =>
            checkpoint.operationalStateEquivalent &&
            checkpoint.workflowHistoryEquivalent &&
            checkpoint.appliedOccurrencePositionEquivalent &&
            checkpoint.pureSelectionEquivalent
        )
      ).toBe(true)
      expect(renderRecordedCassetteLyrics(recorded)).toContain(
        "Dalph coordinator began executor-work responsibility for task A, attempt attempt:A:0."
      )
    })
)

it.effect(
  "alpha-renames every Dalph-generated identity and preserves tracker revisions, task revisions, and Git SHAs",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singleton)
      const directionEvent = ControlDirectionAppliedEvent.make({
        direction: "Pause",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(1),
        subject: { _tag: "Run", runId: run.runId },
        version: workflowJournalEventVersion
      })
      const records = insertBeforeRunTermination(
        run.records.filter(({ event }) => event._tag !== "WorkflowRunTerminated"),
        directionEvent
      )
      const projected = yield* projectRecordedCassette(records)
      const projectedOperationIds = Array.from(
        new Set(
          projected.entries.flatMap((entry) => {
            if (entry._tag === "TaskClaimAcquisitionIntended") {
              return [entry.operation.acquisition.operationId]
            }
            if (
              entry._tag === "GitReadInitiated" ||
              entry._tag === "TaskAttemptPlanned" ||
              entry._tag === "TaskTrackerReadInitiated" ||
              entry._tag === "TaskWorktreeReconciliationIntended"
            ) {
              return [entry.operation.operationId]
            }
            return []
          })
        )
      )
      const executorReportEntry = projected.entries.find((entry) => entry._tag === "PlannedAttemptExecutorWorkReported")
      if (executorReportEntry?._tag !== "PlannedAttemptExecutorWorkReported") {
        return yield* Effect.die("missing executor report entry")
      }
      const executorResponsibilityEntry = projected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )
      if (executorResponsibilityEntry?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") {
        return yield* Effect.die("missing executor responsibility entry")
      }
      const acquiredClaimEntry = projected.entries.find((entry) => entry._tag === "TaskClaimAcquired")
      if (acquiredClaimEntry?._tag !== "TaskClaimAcquired") {
        return yield* Effect.die("missing acquired claim entry")
      }
      const runBeganEntry = projected.entries.find((entry) => entry._tag === "WorkflowRunBegan")
      if (runBeganEntry?._tag !== "WorkflowRunBegan") {
        return yield* Effect.die("missing workflow run entry")
      }
      const acceptedResult = AcceptedResult.make({
        commit: GitCommitSha.make("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        evidenceManifest: EvidenceReference.make({
          byteLength: 1,
          digest: EvidenceDigest.make("f".repeat(evidenceDigestHexLength))
        })
      })
      const integrationTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make("/dalph/cassettes/integration.git"),
        ref: IntegrationTargetRef.make("refs/heads/master")
      })
      const additionalDirections: ReadonlyArray<RecordedCassetteEntry> = [
        {
          _tag: "ControlDirectionApplied",
          direction: "Unpause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(2),
          subject: { _tag: "Run", runId: run.runId }
        },
        {
          _tag: "ControlDirectionApplied",
          direction: "Pause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(3),
          subject: { _tag: "Task", runId: run.runId, taskId: TaskId.make("A") }
        },
        {
          _tag: "ControlDirectionApplied",
          direction: "Unpause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal: ControlDirectionApplicationOrdinal.make(4),
          subject: { _tag: "Task", runId: run.runId, taskId: TaskId.make("A") }
        },
        {
          _tag: "TaskClaimReacquisitionDirected",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: TaskClaimReacquisitionRequestId.make("rename-task-claim-reacquisition-request"),
          taskId: TaskId.make("A")
        }
      ]
      const entriesWithAcceptedResult = projected.entries.flatMap((entry) => {
        if (entry === executorReportEntry) {
          return [
            entry,
            {
              _tag: "PlannedAttemptExecutorCommandIntended" as const,
              command: "Suspend" as const,
              initiatedBy: { _tag: "DalphCoordinator" as const },
              occurrenceClassification: "InitiatedAction" as const,
              ordinal: PlannedAttemptExecutorCommandOrdinal.make(2),
              plannedAttempt: executorResponsibilityEntry.plannedAttempt
            },
            {
              _tag: "PlannedAttemptExecutorCommandResponseObserved" as const,
              commandOrdinal: PlannedAttemptExecutorCommandOrdinal.make(2),
              occurrenceClassification: "NonActionOccurrence" as const,
              plannedAttempt: executorResponsibilityEntry.plannedAttempt,
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
                correlation: executorReportEntry.report.correlation
              })
            },
            {
              _tag: "PlannedAttemptExecutorWorkReported" as const,
              occurrenceClassification: "NonActionOccurrence" as const,
              ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
                correlation: executorReportEntry.report.correlation
              })
            }
          ]
        }
        return [
          entry._tag === "PlannedAttemptExecutorCommandIntended" && entry.ordinal === 2
            ? { ...entry, ordinal: PlannedAttemptExecutorCommandOrdinal.make(3) }
            : entry._tag === "PlannedAttemptExecutorStateObserved" &&
                entry.observation._tag === "ExactExecutorReport" &&
                entry.observation.report._tag === "ExecutorWorkTerminal"
              ? {
                  ...entry,
                  observation: {
                    ...entry.observation,
                    report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                      correlation: entry.observation.report.correlation,
                      result: { _tag: "Accepted", acceptedResult }
                    })
                  }
                }
              : entry._tag === "PlannedAttemptExecutorWorkReported" && entry.report._tag === "ExecutorWorkTerminal"
                ? {
                    ...entry,
                    ordinal: PlannedAttemptExecutorReportOrdinal.make(3),
                    report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                      correlation: entry.report.correlation,
                      result: { _tag: "Accepted", acceptedResult }
                    })
                  }
                : entry
        ]
      })
      const terminationIndex = entriesWithAcceptedResult.findIndex((entry) => entry._tag === "WorkflowRunTerminated")
      const insertionIndex = terminationIndex < 0 ? entriesWithAcceptedResult.length : terminationIndex
      const integrationEntries = [
        {
          _tag: "IntegrationResponsibilityBegan" as const,
          acceptedResult,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          integrationTarget,
          occurrenceClassification: "InitiatedAction" as const,
          plannedAttempt: executorResponsibilityEntry.plannedAttempt
        },
        {
          _tag: "IntegrationStarted" as const,
          acceptedResult,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          integrationTarget,
          occurrenceClassification: "InitiatedAction" as const,
          plannedAttempt: executorResponsibilityEntry.plannedAttempt
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const claimReleaseOperation = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
        predecessorOperationIds: [acquiredClaimEntry.claim.operationId],
        release: { claim: acquiredClaimEntry.claim, operationId: OperationId.make(`cassette-release:${run.runId}`) }
      })
      const claimReleaseEntries = [
        { _tag: "TaskClaimReleaseIntended" as const, operation: claimReleaseOperation },
        { _tag: "TaskClaimReleased" as const, release: claimReleaseOperation.release }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const rejectedClaimOperationId = OperationId.make(`cassette-rejected-claim:${run.runId}`)
      const rejectedClaimToken = ClaimToken.make(`cassette-rejected-token:${run.runId}`)
      const foreignClaimOperationId = OperationId.make(`cassette-foreign-claim:${run.runId}`)
      const foreignClaimToken = ClaimToken.make(`cassette-foreign-token:${run.runId}`)
      const rejectedClaimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: rejectedClaimOperationId,
          owner: ClaimOwner.make("cassette-owner"),
          taskId: TaskId.make("A"),
          token: rejectedClaimToken
        },
        predecessorOperationIds: []
      })
      const rejectedClaimEntries = [
        { _tag: "TaskClaimAcquisitionIntended" as const, operation: rejectedClaimOperation },
        {
          _tag: "TaskClaimAcquisitionRejected" as const,
          observed: {
            _tag: "ActiveTaskClaim" as const,
            operationId: foreignClaimOperationId,
            owner: ClaimOwner.make("foreign-owner"),
            taskId: TaskId.make("A"),
            token: foreignClaimToken
          },
          operationId: rejectedClaimOperation.acquisition.operationId,
          reason: "ForeignClaim" as const
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const claimRead = makeTaskClaimObservationOperation(
        OperationId.make(`cassette-claim-read:${run.runId}`),
        runBeganEntry.target,
        acquiredClaimEntry.claim.taskId,
        [acquiredClaimEntry.claim.operationId]
      )
      const unreadableClaimRead = makeTaskClaimObservationOperation(
        OperationId.make(`cassette-unreadable-claim-read:${run.runId}`),
        runBeganEntry.target,
        acquiredClaimEntry.claim.taskId,
        [claimRead.operationId]
      )
      const unclaimedClaimRead = makeTaskClaimObservationOperation(
        OperationId.make(`cassette-unclaimed-claim-read:${run.runId}`),
        runBeganEntry.target,
        acquiredClaimEntry.claim.taskId,
        [unreadableClaimRead.operationId]
      )
      const claimObservationEntries = [
        {
          _tag: "TaskTrackerReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: claimRead
        },
        {
          _tag: "TaskTrackerFactsObserved" as const,
          evidence: makeFocusedTaskClaimFactsObserved(claimRead, acquiredClaimEntry.claim),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: claimRead.operationId
        },
        {
          _tag: "TaskTrackerReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: unreadableClaimRead
        },
        {
          _tag: "TaskTrackerFactsObserved" as const,
          evidence: makeFocusedTaskClaimFactsUnreadable(unreadableClaimRead),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: unreadableClaimRead.operationId
        },
        {
          _tag: "TaskTrackerReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: unclaimedClaimRead
        },
        {
          _tag: "TaskTrackerFactsObserved" as const,
          evidence: makeFocusedTaskClaimFactsObserved(
            unclaimedClaimRead,
            UnclaimedTask.make({ taskId: acquiredClaimEntry.claim.taskId })
          ),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: unclaimedClaimRead.operationId
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const trackerGraphFailureOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make(`cassette-tracker-failure:${run.runId}`),
        runBeganEntry.target
      )
      const trackerGraphFailureEntries = [
        {
          _tag: "TaskTrackerReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: trackerGraphFailureOperation
        },
        {
          _tag: "TaskTrackerFactsObserved" as const,
          evidence: TaskTrackerFactsReadFailed.make({
            completeness: "Unreadable",
            failure: {
              _tag: "TrackerAdapterReadError" as const,
              detail: "alpha-renaming fixture tracker read is incomplete",
              reason: { _tag: "IncompleteSnapshot" as const }
            },
            operationId: trackerGraphFailureOperation.operationId,
            target: trackerGraphFailureOperation.target
          }),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: trackerGraphFailureOperation.operationId
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const worktreeObservationOperation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make(`cassette-worktree-read:${run.runId}`),
        plannedAttempt: executorResponsibilityEntry.plannedAttempt,
        predecessorOperationIds: []
      })
      const worktreeObservationEntries = [
        {
          _tag: "GitReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: worktreeObservationOperation
        },
        {
          _tag: "PlannedAttemptWorktreeObserved" as const,
          observation: AttemptWorktreeLost.make({ plannedAttempt: executorResponsibilityEntry.plannedAttempt }),
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: worktreeObservationOperation.operationId
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const targetLineageOperation = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make(`cassette-target-lineage-read:${run.runId}`),
        plannedAttempt: executorResponsibilityEntry.plannedAttempt,
        predecessorOperationIds: [worktreeObservationOperation.operationId]
      })
      const targetLineageEntries = [
        {
          _tag: "GitReadInitiated" as const,
          initiatedBy: { _tag: "DalphCoordinator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          operation: targetLineageOperation
        },
        {
          _tag: "TargetLineageObserved" as const,
          observation: {
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: executorResponsibilityEntry.plannedAttempt.baseSha,
            targetHeadSha: executorResponsibilityEntry.plannedAttempt.baseSha
          },
          occurrenceClassification: "NonActionOccurrence" as const,
          originatingActionOperationId: targetLineageOperation.operationId,
          plannedAttempt: executorResponsibilityEntry.plannedAttempt
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      const recorded = RecordedCassette.make({
        ...projected,
        entries: [
          ...entriesWithAcceptedResult.slice(0, insertionIndex),
          ...additionalDirections,
          {
            _tag: "TaskWorkCapacityChanged",
            capacity: TaskWorkCapacity.make(2),
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            previousRevision: RunPolicyRevision.make(1),
            revision: RunPolicyRevision.make(2)
          },
          ...integrationEntries,
          ...claimReleaseEntries,
          ...rejectedClaimEntries,
          ...claimObservationEntries,
          ...trackerGraphFailureEntries,
          ...worktreeObservationEntries,
          ...targetLineageEntries,
          ...entriesWithAcceptedResult.slice(insertionIndex)
        ]
      })
      const encodedBefore = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded))
      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: "attempt:A:0", to: "renamed-attempt-A" }],
        claimTokens: [
          { from: acquiredClaimEntry.claim.token, to: "renamed-claim-token-A" },
          { from: rejectedClaimToken, to: "renamed-rejected-claim-token" }
        ],
        integratorCandidateResourceLocators: [],
        integratorSessionIds: [],
        operationIds: [
          ...projectedOperationIds.map((operationId, ordinal) => ({
            from: operationId,
            to: `renamed-operation:${ordinal}`
          })),
          { from: `cassette-release:${run.runId}`, to: "renamed-operation:claim-release" },
          { from: rejectedClaimOperationId, to: "renamed-rejected-claim-operation" },
          { from: `cassette-worktree-read:${run.runId}`, to: "renamed-operation:worktree-read" },
          { from: `cassette-target-lineage-read:${run.runId}`, to: "renamed-operation:target-lineage-read" },
          { from: `cassette-unclaimed-claim-read:${run.runId}`, to: "renamed-operation:unclaimed-claim-read" },
          { from: `cassette-tracker-failure:${run.runId}`, to: "renamed-operation:tracker-failure" }
        ],
        runIds: [{ from: run.runId, to: "renamed-run" }],
        taskBranchRefs: [{ from: "refs/heads/dalph/attempt-A-0", to: "refs/heads/dalph/renamed-attempt-A" }],
        worktreeLocators: [{ from: "/dalph/cassettes/attempt-A-0", to: "/dalph/cassettes/renamed-attempt-A" }]
      })
      const renamed = yield* renameRecordedCassette(recorded, renaming)
      const renamedRejectedEntry = renamed.entries.find((entry) => entry._tag === "TaskClaimAcquisitionRejected")
      if (renamedRejectedEntry?._tag !== "TaskClaimAcquisitionRejected") {
        return yield* Effect.die("alpha-renaming fixture requires the rejected claim entry")
      }
      expect(encodedBefore).toContain(`"${rejectedClaimOperationId}"`)
      expect(encodedBefore).toContain(`"${rejectedClaimToken}"`)
      expect(renamedRejectedEntry.operationId).toBe("renamed-rejected-claim-operation")
      expect(renamedRejectedEntry.observed.operationId).toBe(foreignClaimOperationId)
      expect(renamedRejectedEntry.observed.token).toBe(foreignClaimToken)
      const recordedHistory = foldRecordedCassette(recorded)
      if (recordedHistory._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die(
          `alpha-renaming fixture must remain valid before renaming: ${recordedHistory.issues
            .map((issue) => JSON.stringify(issue))
            .join("; ")}`
        )
      }
      const checkpoints = yield* verifyRecordedCassetteRoundTripWithRenaming(
        recordedHistory.records,
        renamed,
        invertCassetteIdentityRenaming(renaming)
      )
      const encodedAfter = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(renamed))
      const allRenamings = [
        ...renaming.attemptIds,
        ...renaming.claimTokens,
        ...renaming.integratorSessionIds,
        ...renaming.operationIds,
        ...renaming.runIds,
        ...renaming.taskBranchRefs,
        ...renaming.worktreeLocators
      ]
      const entryVariants = {
        AttemptChoiceApplied: true,
        AttemptImplementationAbandoned: true,
        AttemptRestartAuthorityReadFailed: true,
        AttemptStoppageIntended: true,
        CancelledAttemptClaimNoReleaseObserved: true,
        CancelledAttemptImplementationResponsibilityRelinquished: true,
        ControlDirectionApplied: true,
        GitReadInitiated: true,
        IntegrationResponsibilityBegan: true,
        IntegrationStarted: true,
        PlannedAttemptContinuationAuthorized: true,
        PlannedAttemptReplaced: true,
        TargetPromotionIntended: true,
        TargetPromotionAttemptIntended: true,
        TargetPromotionObservedSuccess: true,
        TargetPromotionStale: true,
        TargetPromotionNonConvergence: true,
        CompletionClaimReplacementIntended: true,
        CompletionClaimReplacementAttemptIntended: true,
        CompletionClaimReplaced: true,
        CompletionClaimDeletionIntended: true,
        CompletionClaimDeletionAttemptIntended: true,
        CompletionClaimDeletionReadObserved: true,
        CompletionClaimDeleted: true,
        IntegrationFinalitySettled: true,
        IntegratorSessionFixed: true,
        IntegratorSuccessorSessionFixed: true,
        IntegratorRunStarted: true,
        IntegratorRunResultRecorded: true,
        IntegratorRunCandidateGitReadIntended: true,
        IntegratorRunCandidateGitObserved: true,
        IntegrationProviderRunActivityAbsent: true,
        IntegrationQuarantineDirectionApplied: true,
        IntegrationQuarantined: true,
        WorktreeCleanupAuthorized: true,
        WorktreeCleanupObservationIntended: true,
        WorktreeCleanupObserved: true,
        WorktreeCleanupAbsenceConfirmed: true,
        WorktreeCleanupMutationIntended: true,
        WorktreeCleanupMutationResultRecorded: true,
        WorktreeCleanupContradicted: true,
        WorktreeCleanupSettled: true,
        BranchCleanupAuthorized: true,
        BranchCleanupObservationIntended: true,
        BranchCleanupObserved: true,
        BranchCleanupAbsenceConfirmed: true,
        BranchCleanupMutationIntended: true,
        BranchCleanupMutationResultRecorded: true,
        BranchCleanupContradicted: true,
        BranchCleanupSettled: true,
        IntegratorCandidateCleanupAuthorized: true,
        IntegratorCandidateCleanupObservationIntended: true,
        IntegratorCandidateCleanupObserved: true,
        IntegratorCandidateCleanupAbsenceConfirmed: true,
        IntegratorCandidateCleanupMutationIntended: true,
        IntegratorCandidateCleanupMutationResultRecorded: true,
        IntegratorCandidateCleanupContradicted: true,
        IntegratorCandidateCleanupSettled: true,
        CompletionTaskIntended: true,
        CompletionTaskAttemptIntended: true,
        CompletionTaskAcknowledged: true,
        CompletionTaskResponseLost: true,
        CompletionTaskRejected: true,
        CompletionTaskCandidateAncestryReadIntended: true,
        CompletionTaskCandidateAncestryObserved: true,
        PostPromotionBlockerCandidateAncestryReadIntended: true,
        PostPromotionBlockerCandidateAncestryObserved: true,
        CompletionTaskRequestLookupIntended: true,
        CompletionTaskRequestLookupObserved: true,
        PlannedAttemptExecutorWorkReported: true,
        PlannedAttemptExecutorCommandIntended: true,
        PlannedAttemptExecutorCommandProjectionObserved: true,
        PlannedAttemptExecutorCommandResponseObserved: true,
        PlannedAttemptExecutorCommandResponseContradicted: true,
        PlannedAttemptExecutorStateObserved: true,
        PlannedAttemptExecutorWorkResponsibilityBegan: true,
        PlannedAttemptWorktreeObserved: true,
        TargetLineageObserved: true,
        TaskAttemptPlanned: true,
        TaskClaimAcquired: true,
        TaskClaimAcquisitionIntended: true,
        TaskClaimAcquisitionRejected: true,
        TaskClaimReleaseIntended: true,
        TaskClaimReleased: true,
        TaskClaimReacquisitionDirected: true,
        StoppedAttemptClaimNoReleaseObserved: true,
        TaskTrackerFactsObserved: true,
        TaskTrackerReadInitiated: true,
        TaskWorktreeReady: true,
        TaskWorktreeReconciliationIntended: true,
        TaskWorkCapacityChanged: true,
        WorkflowRunBegan: true,
        WorkflowRunTerminated: true,
        RunCancellationApplied: true
      } satisfies Record<RecordedCassetteEntry["_tag"], true>
      const operationVariants = {
        AcquireTaskClaim: true,
        ReadCompletionTaskFacts: true,
        ReadTaskClaim: true,
        ReadTargetLineage: true,
        ReadTaskWorktree: true,
        ReleaseTaskClaim: true,
        ReadTaskWorkSpecification: true,
        ReadTrackerGraph: true,
        RecordTaskAttemptPlan: true,
        ReconcileTaskWorktree: true
      } satisfies Record<WorkflowOperation["_tag"], true>
      const observationVariants = {
        CompleteTaskTrackerFacts: true,
        FocusedTaskClaimFacts: true,
        FocusedTaskClaimFactsUnreadable: true,
        FocusedTaskCompletionFacts: true,
        FocusedTaskWorkSpecificationFacts: true,
        TaskTrackerFactsReadFailed: true,
        UnchangedTaskTrackerFactsReconfirmed: true
      } satisfies Record<TaskTrackerFactsObservation["_tag"], true>

      expect(checkpoints.every((checkpoint) => checkpoint.workflowHistoryEquivalent)).toBe(true)
      for (const { from, to } of allRenamings) {
        const encodedRenamedFixtures = encodedAfter
        expect(encodedRenamedFixtures).not.toContain(`"${from}"`)
        expect(encodedRenamedFixtures).toContain(`"${to}"`)
      }
      const [
        stoppageRun,
        noReleaseRun,
        foreignNoReleaseRun,
        idleCancellationRun,
        runningCancellationRun,
        foreignCancellationRun,
        integrationCancellationRun
      ] = yield* Effect.all([
        runAuthoredScenarioCassette(runUnpauseDuringSuspensionRestartsAuthoredCassette),
        runAuthoredScenarioCassette(changedAttemptStopReleaseResponseLostAuthoredCassette),
        runAuthoredScenarioCassette(changedAttemptStopsWithForeignClaimAuthoredCassette),
        runAuthoredScenarioCassette(idleRunCancellationAuthoredCassette),
        runAuthoredScenarioCassette(runningAttemptRunCancellationAuthoredCassette),
        runAuthoredScenarioCassette(runningAttemptRunCancellationForeignClaimAuthoredCassette),
        runAuthoredScenarioCassette(integrationRunCancellationAuthoredCassette)
      ])
      const continuationRun = yield* runAuthoredScenarioCassette(coordinatorProcessDeathContinuesAuthoredCassette)
      const replacementRun = yield* runAuthoredScenarioCassette(changedAttemptRestartsCleanlyAuthoredCassette)
      const [
        stoppageRecorded,
        noReleaseRecorded,
        foreignNoReleaseRecorded,
        idleCancellationRecorded,
        runningCancellationRecorded,
        foreignCancellationRecorded,
        integrationCancellationRecorded,
        continuationRecorded,
        replacementRecorded
      ] = yield* Effect.all([
        projectRecordedCassette(stoppageRun.records),
        projectRecordedCassette(noReleaseRun.records),
        projectRecordedCassette(foreignNoReleaseRun.records),
        projectRecordedCassette(idleCancellationRun.records),
        projectRecordedCassette(runningCancellationRun.records),
        projectRecordedCassette(foreignCancellationRun.records),
        projectRecordedCassette(integrationCancellationRun.records),
        projectRecordedCassette(continuationRun.records),
        projectRecordedCassette(replacementRun.records)
      ])
      expectRecordedRoundTrip(stoppageRun.records, stoppageRecorded)
      expectRecordedRoundTrip(noReleaseRun.records, noReleaseRecorded)
      expectRecordedRoundTrip(foreignNoReleaseRun.records, foreignNoReleaseRecorded)
      expectRecordedRoundTrip(idleCancellationRun.records, idleCancellationRecorded)
      expectRecordedRoundTrip(runningCancellationRun.records, runningCancellationRecorded)
      expectRecordedRoundTrip(foreignCancellationRun.records, foreignCancellationRecorded)
      expectRecordedRoundTrip(integrationCancellationRun.records, integrationCancellationRecorded)
      expectRecordedRoundTrip(continuationRun.records, continuationRecorded)
      expectRecordedRoundTrip(replacementRun.records, replacementRecorded)
      const replacementEntry = replacementRecorded.entries.find((entry) => entry._tag === "PlannedAttemptReplaced")
      if (replacementEntry?._tag !== "PlannedAttemptReplaced") {
        return yield* Effect.die("replacement alpha-renaming fixture requires PlannedAttemptReplaced")
      }
      const replacementWorktreeIntentIndex = replacementRecorded.entries.findIndex(
        (entry) =>
          entry._tag === "GitReadInitiated" &&
          entry.operation._tag === "ReadTaskWorktree" &&
          entry.operation.operationId === replacementEntry.witness.oldWorktreeObservationOperationId
      )
      const replacementWorktreeIntent = replacementRecorded.entries[replacementWorktreeIntentIndex]
      if (
        replacementWorktreeIntentIndex < 0 ||
        replacementWorktreeIntent?._tag !== "GitReadInitiated" ||
        replacementWorktreeIntent.operation._tag !== "ReadTaskWorktree"
      ) {
        return yield* Effect.die("replacement alpha-renaming fixture requires the exact W1 read intent")
      }
      const restartFailureEntry: RecordedCassetteEntry = {
        _tag: "AttemptRestartAuthorityReadFailed",
        failure: new GitWorktreeReadFailure({
          detail: "recorded W1 read failed",
          worktree: replacementEntry.subject.plannedAttempt.worktree
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: replacementWorktreeIntent.operation.operationId,
        requestId: replacementEntry.requestId,
        subject: replacementEntry.subject
      }
      const restartFailureRecorded = RecordedCassette.make({
        ...replacementRecorded,
        entries: [...replacementRecorded.entries.slice(0, replacementWorktreeIntentIndex + 1), restartFailureEntry]
      })
      const restartFailureHistory = foldRecordedCassette(restartFailureRecorded)
      if (restartFailureHistory._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("Restart W1 read failure recording must fold into valid journal history")
      }
      expectRecordedRoundTrip(restartFailureHistory.records, restartFailureRecorded)
      const replacementOperationIds = Array.from(
        new Set([
          replacementEntry.successorPlan.operationId,
          ...replacementEntry.successorPlan.predecessorOperationIds,
          replacementEntry.witness.claimObservationOperationId,
          replacementEntry.witness.expectedClaim.operationId,
          replacementEntry.witness.graphObservationOperationId,
          replacementEntry.witness.oldWorktreeObservationOperationId,
          replacementEntry.witness.specificationObservationOperationId,
          replacementEntry.witness.targetLineageObservationOperationId
        ])
      )
      const replacementRenaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [
          { from: replacementEntry.subject.plannedAttempt.attemptId, to: "renamed-replaced-attempt" },
          { from: replacementEntry.successorPlan.plannedAttempt.attemptId, to: "renamed-successor-attempt" }
        ],
        claimTokens: [{ from: replacementEntry.witness.expectedClaim.token, to: "renamed-replacement-claim" }],
        integratorCandidateResourceLocators: [],
        integratorSessionIds: [],
        operationIds: replacementOperationIds.map((operationId, ordinal) => ({
          from: operationId,
          to: `renamed-replacement-operation:${ordinal}`
        })),
        runIds: [{ from: replacementRun.runId, to: "renamed-replacement-run" }],
        taskBranchRefs: [
          { from: replacementEntry.subject.plannedAttempt.branch, to: "refs/heads/dalph/renamed-replaced-attempt" },
          {
            from: replacementEntry.successorPlan.plannedAttempt.branch,
            to: "refs/heads/dalph/renamed-successor-attempt"
          }
        ],
        worktreeLocators: [
          { from: replacementEntry.subject.plannedAttempt.worktree, to: "/dalph/renamed-replaced-attempt" },
          { from: replacementEntry.successorPlan.plannedAttempt.worktree, to: "/dalph/renamed-successor-attempt" }
        ]
      })
      const renamedReplacement = yield* renameRecordedCassette(replacementRecorded, replacementRenaming)
      const renamedRestartFailure = yield* renameRecordedCassette(restartFailureRecorded, replacementRenaming)
      const encodedReplacement = JSON.stringify(yield* Schema.encodeUnknownEffect(RecordedCassette)(renamedReplacement))
      for (const { from, to } of [
        ...replacementRenaming.attemptIds,
        ...replacementRenaming.claimTokens,
        ...replacementRenaming.operationIds,
        ...replacementRenaming.runIds,
        ...replacementRenaming.taskBranchRefs,
        ...replacementRenaming.worktreeLocators
      ]) {
        expect(encodedReplacement).not.toContain(`"${from}"`)
        expect(encodedReplacement).toContain(`"${to}"`)
      }
      const [
        renamedStoppage,
        renamedNoRelease,
        renamedForeignNoRelease,
        renamedIdleCancellation,
        renamedRunningCancellation,
        renamedForeignCancellation,
        renamedIntegrationCancellation
      ] = yield* Effect.all([
        renameRecordedCassette(stoppageRecorded, renaming),
        renameRecordedCassette(noReleaseRecorded, renaming),
        renameRecordedCassette(foreignNoReleaseRecorded, renaming),
        renameRecordedCassette(idleCancellationRecorded, renaming),
        renameRecordedCassette(runningCancellationRecorded, renaming),
        renameRecordedCassette(foreignCancellationRecorded, renaming),
        renameRecordedCassette(integrationCancellationRecorded, renaming)
      ])
      const stopLyrics = [
        renamedStoppage,
        renamedNoRelease,
        renamedForeignNoRelease,
        renamedIdleCancellation,
        renamedRunningCancellation,
        renamedForeignCancellation,
        renamedIntegrationCancellation
      ]
        .map(renderRecordedCassetteLyrics)
        .join("\n")
      expect(stopLyrics).toContain("chose StopTaskImplementation")
      expect(stopLyrics).toContain("abandoned implementation attempt")
      expect(stopLyrics).toContain("must not release the current claim")
      expect(stopLyrics).toContain("observed ExactExecutorReport while reconciling executor command")
      expect(stopLyrics).toContain("returned ExecutorWorkSafelySuspended")
      expect(stopLyrics).toContain("Operator applied Run cancellation")
      expect(stopLyrics).toContain("relinquished implementation responsibility for cancelled attempt")
      expect(stopLyrics).toContain("cancelling attempt")
      expect(renderRecordedCassetteLyrics(renamedRestartFailure)).toContain("GitWorktreeReadFailure boundary failed")

      const projectionEntry = stoppageRecorded.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorCommandProjectionObserved"
      )
      if (
        projectionEntry?._tag !== "PlannedAttemptExecutorCommandProjectionObserved" ||
        projectionEntry.observation._tag !== "ExactExecutorReport"
      ) {
        return yield* Effect.die("suspension recording must contain the exact command projection")
      }
      const stateEntry = {
        _tag: "PlannedAttemptExecutorStateObserved" as const,
        observation: projectionEntry.observation,
        occurrenceClassification: "NonActionOccurrence" as const,
        ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
        plannedAttempt: projectionEntry.plannedAttempt
      }
      const responseContradictionEntry = {
        _tag: "PlannedAttemptExecutorCommandResponseContradicted" as const,
        commandOrdinal: projectionEntry.commandOrdinal,
        observed: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
          correlation: {
            attemptId: AttemptId.make("foreign-response-attempt"),
            runId: projectionEntry.plannedAttempt.runId
          }
        }),
        occurrenceClassification: "NonActionOccurrence" as const,
        plannedAttempt: projectionEntry.plannedAttempt
      }
      const appliedStopEntry = noReleaseRecorded.entries.find(
        (entry) => entry._tag === "AttemptChoiceApplied" && entry.choice === "StopTaskImplementation"
      )
      if (appliedStopEntry?._tag !== "AttemptChoiceApplied") {
        return yield* Effect.die("historical stoppage-intent decoding requires one applied Stop subject")
      }
      // This token is now unreachable from maintained #264 authoring: an
      // accepted Safe report proves quiescence before Stop is exposed. Keep
      // its version-11 recorded decoder and renaming coverage explicit for
      // previously recorded journals without inventing a current scenario.
      const historicalStoppageIntentEntry = {
        _tag: "AttemptStoppageIntended" as const,
        initiatedBy: { _tag: "DalphCoordinator" as const },
        occurrenceClassification: "InitiatedAction" as const,
        requestId: appliedStopEntry.requestId,
        subject: appliedStopEntry.subject
      }
      const executorObservationVariants = RecordedCassette.make({
        _tag: "RecordedCassette",
        entries: [
          {
            ...projectionEntry,
            observation: { _tag: "ExecutorReportContradiction", observed: projectionEntry.observation.report }
          },
          { ...projectionEntry, observation: { _tag: "ExecutorStateNoCurrentReport" } },
          {
            ...stateEntry,
            observation: { _tag: "ExecutorReportContradiction", observed: stateEntry.observation.report }
          },
          { ...stateEntry, observation: { _tag: "ExecutorStateNoCurrentReport" } },
          historicalStoppageIntentEntry,
          responseContradictionEntry
        ],
        runId: stoppageRecorded.runId,
        schemaVersion: recordedCassetteVersion
      })
      const renamedExecutorObservationVariants = yield* renameRecordedCassette(executorObservationVariants, renaming)
      expect(
        renamedExecutorObservationVariants.entries.map((entry) =>
          entry._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
          entry._tag === "PlannedAttemptExecutorStateObserved"
            ? entry.observation._tag
            : undefined
        )
      ).toEqual([
        "ExecutorReportContradiction",
        "ExecutorStateNoCurrentReport",
        "ExecutorReportContradiction",
        "ExecutorStateNoCurrentReport",
        undefined,
        undefined
      ])
      expect(renamedExecutorObservationVariants.entries.at(-1)?._tag).toBe(
        "PlannedAttemptExecutorCommandResponseContradicted"
      )
      const projectionIndex = stoppageRecorded.entries.indexOf(projectionEntry)
      const contradictoryResponseCassette = RecordedCassette.make({
        ...stoppageRecorded,
        entries: [
          ...stoppageRecorded.entries.slice(0, projectionIndex),
          responseContradictionEntry,
          ...stoppageRecorded.entries.slice(projectionIndex)
        ]
      })
      const contradictoryResponseHistory = foldRecordedCassette(contradictoryResponseCassette)
      if (contradictoryResponseHistory._tag !== "ValidWorkflowJournalHistory") {
        return yield* Effect.die("a contradictory response must remain unsettled for the following exact projection")
      }
      expectRecordedRoundTrip(contradictoryResponseHistory.records, contradictoryResponseCassette)
      const [completionRun, lostCompletionRun, rejectedCompletionRun] = yield* Effect.all([
        runAuthoredScenarioCassette(deliveryFinalitySpineAuthoredCassette),
        runAuthoredScenarioCassette(ambiguousCompletionResponseAuthoredCassette),
        runAuthoredScenarioCassette(completionTaskConflictAuthoredCassette)
      ])
      expect(
        [completionRun, lostCompletionRun, rejectedCompletionRun].every(({ records }) =>
          records.some(({ event }) => event._tag === "IntegratorSessionFixed")
        )
      ).toBe(true)
      expect(completionRun.records.some(({ event }) => event._tag === "CompletionTaskIntended")).toBe(true)
      expect(lostCompletionRun.records.some(({ event }) => event._tag === "CompletionTaskResponseLost")).toBe(true)
      expect(rejectedCompletionRun.records.some(({ event }) => event._tag === "CompletionTaskRejected")).toBe(true)
      expect(renderRecordedCassetteLyrics(executorObservationVariants)).toContain("kept the command unresolved")
      const completionEntries: ReadonlyArray<RecordedCassetteEntry> = (yield* Effect.all(
        [completionRun, lostCompletionRun, rejectedCompletionRun].map(({ records }) => projectRecordedCassette(records))
      )).flatMap(({ entries }) => entries.filter(({ _tag }) => _tag.startsWith("Integrator")))
      const fixedSession = completionEntries.find((entry) => entry._tag === "IntegratorSessionFixed")
      if (fixedSession?._tag !== "IntegratorSessionFixed") {
        return yield* Effect.die("quarantine alpha-renaming fixture requires one fixed Integrator session")
      }
      const absenceDetail = IntegrationQuarantineFailureDetail.make("no provider-owned activity remains")
      const absenceRun = IntegratorRunCorrelation.make({
        ordinal: IntegratorRunOrdinal.make(1),
        session: fixedSession.correlation
      })
      const absenceAt = JournalPosition.make(1)
      const quarantineAt = JournalPosition.make(2)
      const directionAppliedAt = JournalPosition.make(3)
      const successor = IntegratorSessionCorrelation.make({
        ...fixedSession.correlation,
        candidateResource: IntegratorCandidateResourceLocator.make("cassette:alpha-renaming:successor-resource"),
        sessionId: IntegratorSessionId.make("cassette:alpha-renaming:successor-session"),
        targetLineageObservedAt: JournalPosition.make(4)
      })
      const quarantineEntries = [
        {
          _tag: "IntegrationProviderRunActivityAbsent" as const,
          correlation: fixedSession.correlation,
          detail: absenceDetail,
          occurrenceClassification: "NonActionOccurrence" as const,
          run: absenceRun
        },
        {
          _tag: "IntegrationQuarantined" as const,
          basis: IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
            detail: absenceDetail,
            ownedActivityProvenAbsentAt: absenceAt
          }),
          correlation: fixedSession.correlation,
          occurrenceClassification: "NonActionOccurrence" as const
        },
        {
          _tag: "IntegrationQuarantineDirectionApplied" as const,
          fingerprint: IntegrationQuarantineDirectionFingerprint.make({
            direction: "FullRerun",
            quarantineAt,
            sessionId: fixedSession.correlation.sessionId
          }),
          initiatedBy: { _tag: "Operator" as const },
          occurrenceClassification: "InitiatedAction" as const,
          requestId: IntegrationQuarantineDirectionRequestId.make({
            nonce: "alpha-renaming-quarantine-direction",
            runId: completionRun.runId
          })
        },
        {
          _tag: "IntegratorSuccessorSessionFixed" as const,
          direction: "FullRerun" as const,
          directionAppliedAt,
          predecessor: fixedSession.correlation,
          quarantineAt,
          successor,
          successorGeneration: firstFullRerunSuccessorGeneration
        }
      ] satisfies ReadonlyArray<RecordedCassetteEntry>
      expect(
        new Set(
          [
            ...recorded.entries,
            ...stoppageRecorded.entries,
            ...noReleaseRecorded.entries,
            ...foreignNoReleaseRecorded.entries,
            ...idleCancellationRecorded.entries,
            ...runningCancellationRecorded.entries,
            ...foreignCancellationRecorded.entries,
            ...continuationRecorded.entries,
            ...replacementRecorded.entries,
            ...restartFailureRecorded.entries,
            ...executorObservationVariants.entries,
            ...completionEntries,
            ...quarantineEntries
          ]
            .map(({ _tag }) => _tag)
            .concat("WorkflowRunTerminated")
        )
      ).toEqual(
        new Set(
          Object.keys(entryVariants).filter(
            (tag) =>
              !tag.startsWith("TargetPromotion") &&
              !tag.startsWith("CompletionTask") &&
              !tag.startsWith("CompletionClaim") &&
              !tag.startsWith("PostPromotionBlocker") &&
              !tag.startsWith("WorktreeCleanup") &&
              !tag.startsWith("BranchCleanup") &&
              !tag.startsWith("IntegratorCandidateCleanup") &&
              tag !== "IntegrationFinalitySettled"
          )
        )
      )
      expect(
        new Set(
          [...recorded.entries, ...completionEntries].flatMap((entry) =>
            "operation" in entry ? [entry.operation._tag] : []
          )
        )
      ).toEqual(new Set(Object.keys(operationVariants).filter((tag) => tag !== "ReadCompletionTaskFacts")))
      expect(
        new Set(
          [...recorded.entries, ...completionEntries].flatMap((entry) =>
            entry._tag === "TaskTrackerFactsObserved" ? [entry.evidence._tag] : []
          )
        )
      ).toEqual(new Set(Object.keys(observationVariants).filter((tag) => tag !== "FocusedTaskCompletionFacts")))
      expect(encodedAfter).toContain("1111111111111111111111111111111111111111")
      expect(encodedAfter).toContain("singleton-revision")
      expect(encodedBefore).toContain("singleton-revision")
    }),
  120_000
)

it.effect("renames and renders every contradictory planned-worktree observation distinctly", () =>
  Effect.gen(function* () {
    const plannedBranch = TaskBranchRef.make("refs/heads/dalph/planned")
    const observedBranch = TaskBranchRef.make("refs/heads/dalph/observed")
    const plannedWorktree = WorktreeLocator.make("/worktrees/planned")
    const registeredWorktree = WorktreeLocator.make("/worktrees/registered")
    const sha = GitCommitSha.make("9".repeat(40))
    const operationId = OperationId.make("recorded-worktree-variant-read")
    const observations = [
      new CompetingWorktreeRegistrations({
        observedBranchAtPlannedWorktree: observedBranch,
        observedHeadAtPlannedWorktree: sha,
        plannedBranch,
        plannedBranchRegisteredWorktree: registeredWorktree,
        plannedWorktree
      }),
      new ConflictingWorktreeRegistration({
        observedBranch,
        observedHead: sha,
        plannedBranch,
        worktree: plannedWorktree
      }),
      new ContradictoryWorktreeState({ detail: "inconsistent registration", worktree: plannedWorktree }),
      new ForeignWorktreeRegistration({ branch: plannedBranch, plannedWorktree, registeredWorktree }),
      PlannedWorktreeReady.make({ baseSha: sha, branch: plannedBranch, headSha: sha, worktree: plannedWorktree }),
      new UntrackedWorktreePath({ worktree: plannedWorktree }),
      new WorktreeBaseMismatch({ baseSha: sha, branch: plannedBranch, headSha: sha, worktree: plannedWorktree })
    ] as const
    const cassette = RecordedCassette.make({
      _tag: "RecordedCassette",
      entries: observations.map((observation) => ({
        _tag: "PlannedAttemptWorktreeObserved" as const,
        observation,
        occurrenceClassification: "NonActionOccurrence" as const,
        originatingActionOperationId: operationId
      })),
      runId: RunId.make("recorded-worktree-variant-run"),
      schemaVersion: recordedCassetteVersion
    })
    const renamed = yield* renameRecordedCassette(
      cassette,
      yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [],
        claimTokens: [],
        integratorCandidateResourceLocators: [],
        integratorSessionIds: [],
        operationIds: [],
        runIds: [],
        taskBranchRefs: [
          { from: plannedBranch, to: "refs/heads/dalph/renamed-planned" },
          { from: observedBranch, to: "refs/heads/dalph/renamed-observed" }
        ],
        worktreeLocators: [
          { from: plannedWorktree, to: "/worktrees/renamed-planned" },
          { from: registeredWorktree, to: "/worktrees/renamed-registered" }
        ]
      })
    )
    const lyrics = renderRecordedCassetteLyrics(cassette)
    expect(lyrics).toContain("competing registrations")
    expect(lyrics).toContain("contradictory facts")
    expect(lyrics).toContain("foreign worktree")
    expect(lyrics).toContain("did not register")
    expect(lyrics).toContain("outside Base")
    expect(JSON.stringify(renamed)).toContain("/worktrees/renamed-registered")
    expect(JSON.stringify(renamed)).toContain("refs/heads/dalph/renamed-observed")
  })
)

it.effect("rejects identity renaming that repeats a source or destination", () =>
  Effect.gen(function* () {
    const otherwiseEmptyRenaming = {
      claimTokens: [],
      integratorCandidateResourceLocators: [],
      integratorSessionIds: [],
      operationIds: [],
      runIds: [],
      taskBranchRefs: [],
      worktreeLocators: []
    }
    const repeatedSource = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      ...otherwiseEmptyRenaming,
      attemptIds: [
        { from: "attempt-A", to: "renamed-A" },
        { from: "attempt-A", to: "renamed-B" }
      ]
    }).pipe(Effect.flip)
    const repeatedDestination = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
      ...otherwiseEmptyRenaming,
      attemptIds: [
        { from: "attempt-A", to: "renamed-A" },
        { from: "attempt-B", to: "renamed-A" }
      ]
    }).pipe(Effect.flip)

    expect(String(repeatedSource)).toContain("identity renaming must be one-to-one")
    expect(String(repeatedDestination)).toContain("identity renaming must be one-to-one")
  })
)

it.effect("has no recording for an empty unidentified journal", () =>
  Effect.gen(function* () {
    const empty = yield* projectRecordedCassette([]).pipe(Effect.flip)
    expect(empty._tag).toBe("EmptyJournalCannotBeRecorded")

    const run = yield* runAuthoredScenarioCassette(singleton)
    const recorded = yield* projectRecordedCassette(run.records)
    const malformed = RecordedCassette.make({
      ...recorded,
      entries: recorded.entries.filter((entry) => entry._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan")
    })
    expect(
      verifyRecordedCassetteRoundTrip(run.records, malformed).some(
        (checkpoint) =>
          !checkpoint.operationalStateEquivalent &&
          !checkpoint.workflowHistoryEquivalent &&
          !checkpoint.appliedOccurrencePositionEquivalent
      )
    ).toBe(true)
  })
)

it.effect(
  "detects responsibility and ExecutorWorkExecuting before worktree readiness even when final operational state converges",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(singleton)
      const expected = yield* projectRecordedCassette(run.records)
      const responsibility = expected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )
      const running = expected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorWorkReported" && entry.report._tag === "ExecutorWorkExecuting"
      )
      const runningIntent = expected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorCommandIntended" && entry.ordinal === 1
      )
      const runningResponse = expected.entries.find(
        (entry) => entry._tag === "PlannedAttemptExecutorCommandResponseObserved" && entry.commandOrdinal === 1
      )
      expect(responsibility?._tag).toBe("PlannedAttemptExecutorWorkResponsibilityBegan")
      expect(runningIntent?._tag).toBe("PlannedAttemptExecutorCommandIntended")
      expect(runningResponse?._tag).toBe("PlannedAttemptExecutorCommandResponseObserved")
      expect(running?._tag).toBe("PlannedAttemptExecutorWorkReported")
      if (
        responsibility?._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan" ||
        runningIntent?._tag !== "PlannedAttemptExecutorCommandIntended" ||
        runningResponse?._tag !== "PlannedAttemptExecutorCommandResponseObserved" ||
        running?._tag !== "PlannedAttemptExecutorWorkReported"
      )
        return

      const remaining = expected.entries.filter(
        (entry) => entry !== responsibility && entry !== runningIntent && entry !== runningResponse && entry !== running
      )
      const planIndex = remaining.findIndex((entry) => entry._tag === "TaskAttemptPlanned")
      const actual = RecordedCassette.make({
        ...expected,
        entries: [
          ...remaining.slice(0, planIndex + 1),
          responsibility,
          runningIntent,
          runningResponse,
          running,
          ...remaining.slice(planIndex + 1)
        ]
      })
      const checkpoints = compareRecordedCassetteCheckpoints(expected, actual)

      expect(foldRecordedCassette(expected)._tag).toBe("ValidWorkflowJournalHistory")
      expect(foldRecordedCassette(actual)._tag).toBe("ValidWorkflowJournalHistory")
      expect(checkpoints.at(-1)?.operationalStateEquivalent).toBe(true)
      expect(checkpoints.at(-1)?.workflowHistoryEquivalent).toBe(false)
      expect(checkpoints.some((checkpoint) => !checkpoint.pureSelectionEquivalent)).toBe(true)
    })
)

it.effect("renders a recorded applied operator direction from its structured occurrence", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(singleton)
    const event = ControlDirectionAppliedEvent.make({
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      subject: { _tag: "Run", runId: run.runId },
      version: workflowJournalEventVersion
    })
    const withDirection = yield* projectRecordedCassette(insertBeforeRunTermination(run.records, event))
    expect(renderRecordedCassetteLyrics(withDirection)).toContain("Operator applied Pause to the Run.")
    expect(foldRecordedCassette(withDirection)._tag).toBe("ValidWorkflowJournalHistory")
  })
)

it.effect("labels the 100-task four-read encoding experiment as a baseline", () =>
  Effect.gen(function* () {
    const taskIds = Array.from({ length: 100 }, (_unused, index) => `task-${index.toString().padStart(3, "0")}`)
    const activeTaskId = taskIds[99] ?? "task-099"
    const graph = {
      revision: "size-baseline-revision",
      tasks: taskIds.map((id, index) => ({
        id,
        lifecycle: { _tag: id === activeTaskId ? "Open" : "CompletedSuccessfully" },
        parentTaskId: null,
        prerequisiteIds: index === 0 ? [] : [taskIds[index - 1]]
      }))
    }
    const replaceTask = (value: string) => (value === "A" ? activeTaskId : value)
    const input = {
      ...singleton,
      name: "100-task four-read encoded-size baseline",
      startingFacts: {
        ...singleton.startingFacts,
        taskWorkSpecifications: [
          { body: "Measure the maintained encoding.", taskId: activeTaskId, title: "Measure encoding" }
        ],
        trackerGraph: graph
      },
      story: singleton.story.map((item) => {
        if (item._tag === "TrackerGraphReadReturned") return { ...item, graph }
        if (item._tag === "TaskWorkSpecificationReadReturned") {
          return { ...item, body: "Measure the maintained encoding.", taskId: activeTaskId, title: "Measure encoding" }
        }
        if (item._tag === "DalphSelects" && "taskId" in item.operation) {
          if (item.operation._tag === "AcquireTaskClaim" || item.operation._tag === "ReadTaskWorkSpecification") {
            return { ...item, operation: { ...item.operation, taskId: replaceTask(item.operation.taskId) } }
          }
          return {
            ...item,
            operation: {
              ...item.operation,
              attemptId: `attempt:${activeTaskId}:0`,
              taskId: replaceTask(item.operation.taskId)
            }
          }
        }
        if (item._tag === "PlannedAttemptExecutorWorkReported") {
          return { ...item, report: { ...item.report, attemptId: `attempt:${activeTaskId}:0` } }
        }
        if (item._tag === "PlannedAttemptExecutorProjectionReturned") {
          return { ...item, report: { ...item.report, attemptId: `attempt:${activeTaskId}:0` } }
        }
        if (item._tag === "ExpectedBehavior") {
          return {
            ...item,
            taskWork: {
              absences: [],
              results: item.taskWork.results.map((result) => ({ ...result, taskId: replaceTask(result.taskId) }))
            }
          }
        }
        return item
      })
    }
    const run = yield* runAuthoredScenarioCassette(input)
    const recorded = yield* projectRecordedCassette(run.records)
    const measurement = measureTrackerObservationEncoding(run.records, recorded)

    expect(measurement.changedGraphObservations.occurrenceCount).toBe(1)
    expect(measurement.unchangedGraphReconfirmations.occurrenceCount).toBe(3)
    expect(measurement.changedGraphObservations.journalBytes).toBeGreaterThan(0)
  })
)

const replayIntegrationFinalityCassette = (
  cassette: (typeof maintainedIntegrationFinalityProtocolCassetteCatalog)[keyof typeof maintainedIntegrationFinalityProtocolCassetteCatalog]
) =>
  Effect.gen(function* () {
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const first = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(cassette, promoted.records)
    const second = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(cassette, promoted.records)
    expect(second).toEqual(first)
    return first
  })

const focusedCleanupTags = (journalTags: ReadonlyArray<string>): ReadonlyArray<string> => {
  const completionIntentAt = journalTags.lastIndexOf("CompletionTaskIntended")
  return completionIntentAt < 0 ? [] : journalTags.slice(completionIntentAt)
}

it("rejects unclosed, unbounded, and misordered integration-finality protocol stories", () => {
  const valid =
    maintainedIntegrationFinalityProtocolCassetteCatalog.replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim
  const terminal = valid.story.find(({ _tag }) => _tag === "AwaitSettlement")
  if (terminal?._tag !== "AwaitSettlement") return expect.fail("maintained cassette must declare terminal evidence")
  expect(Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, story: [] })).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, story: [...valid.story, { _tag: "RunReplacement" }] })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...valid,
      boundaryResults: [
        { _tag: "ReplacementUnknown" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReplacementUnknown" }
      ]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, boundaryResults: [{ _tag: "ReadActiveClaim" }] })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,
      boundaryResults: [{ _tag: "ReadCompletionClaim" }, { _tag: "ReadCompletionClaim" }]
    })
  ).toBe(false)
  const deletion =
    maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...deletion,
      story: deletion.story.filter(({ _tag }) => _tag !== "ObserveFocusedTaskCompletionSuccess")
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...deletion,
      boundaryResults: [{ _tag: "ReadCompletionClaim" }, { _tag: "DeletionApplied" }],
      story: [{ _tag: "ObserveFocusedTaskCompletionSuccess" }, { _tag: "RunDeletion" }, terminal]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...deletion,
      story: [
        { _tag: "ObserveFocusedTaskCompletionSuccess" },
        { _tag: "RunReplacement" },
        { _tag: "RunDeletion" },
        terminal
      ]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({ ...valid, boundaryResults: [...valid.boundaryResults].reverse() })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...valid,
      boundaryResults: [...valid.boundaryResults, { _tag: "ReadCompletionClaim" }]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...valid,
      boundaryResults: [{ _tag: "ReadActiveClaim" }, { _tag: "ReplacementUnknown" }]
    })
  ).toBe(false)
  expect(
    Schema.is(IntegrationFinalityProtocolCassette)({
      ...deletion,
      story: [
        { _tag: "RunReplacement" },
        { _tag: "ObserveFocusedTaskCompletionSuccess" },
        { _tag: "ObserveFocusedTaskCompletionSuccess" },
        { _tag: "RunDeletion" },
        terminal
      ]
    })
  ).toBe(false)
})

it.effect("rejects promoted finality replay without each exact causal premise", () =>
  Effect.gen(function* () {
    const cassette =
      maintainedIntegrationFinalityProtocolCassetteCatalog.replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim
    const promoted = yield* runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    for (const omittedTag of [
      "TargetPromotionObservedSuccess",
      "TaskAttemptPlanned",
      "TaskClaimAcquired",
      "TaskTrackerFactsObserved"
    ] as const) {
      const exit = yield* Effect.exit(
        runIntegrationFinalityProtocolCassetteFromPromotedRecords(
          cassette,
          promoted.records.filter(({ event }) => event._tag !== omittedTag)
        )
      )
      expect(exit._tag).toBe("Failure")
    }
  })
)

it.effect("keeps an empty frontier active while claim replacement is non-convergent", () =>
  Effect.gen(function* () {
    const expected = {
      deletionCalls: 0,
      failureTag: "IntegrationFinality.CompletionClaimDidNotConverge",
      journalTags: [
        "CompletionClaimReplacementIntended",
        "CompletionClaimReplacementAttemptIntended",
        "CompletionClaimReplacementAttemptIntended",
        "CompletionClaimReplacementAttemptIntended"
      ],
      readCalls: 4,
      replacementCalls: 3
    }
    const cassette = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" }
      ],
      initialClaim: "Active",
      name: "replacement remains pending at an empty frontier",
      story: [{ _tag: "RunReplacement" }, { _tag: "ObserveEmptyFrontier" }, { _tag: "AwaitSettlement", expected }]
    })
    const run = yield* runIntegrationFinalityProtocolCassette(cassette)
    expect(run.sawEmptyFrontierWhilePending).toBe(true)
  })
)

it.effect("replays definite completion-claim boundary rejections as terminal typed failures", () =>
  Effect.gen(function* () {
    const replacement = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementDefinitelyNotApplied", detail: "tracker rejected replacement" }
      ],
      initialClaim: "Active",
      name: "definite replacement rejection",
      story: [
        { _tag: "RunReplacement" },
        {
          _tag: "AwaitSettlement",
          expected: {
            deletionCalls: 0,
            failureTag: "IntegrationFinality.CompletionClaimReplacementFailure",
            journalTags: ["CompletionClaimReplacementIntended", "CompletionClaimReplacementAttemptIntended"],
            readCalls: 1,
            replacementCalls: 1
          }
        }
      ]
    })
    const deletion = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadCompletionClaim" },
        { _tag: "ReadCompletionClaim" },
        { _tag: "ReadCompletionClaim" },
        { _tag: "DeletionDefinitelyNotApplied", detail: "tracker rejected deletion" }
      ],
      initialClaim: "Completion",
      name: "definite deletion rejection",
      story: [
        { _tag: "RunReplacement" },
        { _tag: "ObserveFocusedTaskCompletionSuccess" },
        { _tag: "RunDeletion" },
        {
          _tag: "AwaitSettlement",
          expected: {
            deletionCalls: 1,
            failureTag: "IntegrationFinality.CompletionClaimDeletionFailure",
            journalTags: [
              "CompletionClaimReplacementIntended",
              "CompletionClaimReplaced",
              "CompletionTaskIntended",
              "TaskTrackerReadIntentRecorded",
              "TaskTrackerFactsObserved",
              "CompletionClaimDeletionIntended",
              "CompletionClaimDeletionReadObserved",
              "TaskClaimReleaseIntended",
              "TaskClaimReleased",
              "CompletionClaimDeletionReadObserved",
              "CompletionClaimDeletionReadObserved",
              "CompletionClaimDeletionAttemptIntended"
            ],
            readCalls: 3,
            replacementCalls: 0
          }
        }
      ]
    })
    const ambiguousReplacement = IntegrationFinalityProtocolCassette.make({
      boundaryResults: [
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" },
        { _tag: "ReplacementUnknown" },
        { _tag: "ReadActiveClaim" }
      ],
      initialClaim: "Active",
      name: "ambiguous replacement exhaustion",
      story: [
        { _tag: "RunReplacement" },
        {
          _tag: "AwaitSettlement",
          expected: {
            deletionCalls: 0,
            failureTag: "IntegrationFinality.CompletionClaimDidNotConverge",
            journalTags: [
              "CompletionClaimReplacementIntended",
              "CompletionClaimReplacementAttemptIntended",
              "CompletionClaimReplacementAttemptIntended",
              "CompletionClaimReplacementAttemptIntended"
            ],
            readCalls: 4,
            replacementCalls: 3
          }
        }
      ]
    })
    expect((yield* runIntegrationFinalityProtocolCassette(replacement)).failureTag).toBe(
      "IntegrationFinality.CompletionClaimReplacementFailure"
    )
    expect((yield* runIntegrationFinalityProtocolCassette(deletion)).failureTag).toBe(
      "IntegrationFinality.CompletionClaimDeletionFailure"
    )
    expect((yield* runIntegrationFinalityProtocolCassette(ambiguousReplacement)).failureTag).toBe(
      "IntegrationFinality.CompletionClaimDidNotConverge"
    )
  })
)

it.effect("replaces the exact active claim with a promotion-bound completion claim", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.replacesTheExactActiveClaimWithAPromotionBoundCompletionClaim
    )
    expect(run.replacementCalls).toBe(1)
    expect(run.deletionCalls).toBe(0)
    expect(run.journalTags.slice(-3)).toEqual([
      "CompletionClaimReplacementIntended",
      "CompletionClaimReplacementAttemptIntended",
      "CompletionClaimReplaced"
    ])
  })
)

it.effect("restart after promotion resumes completion settlement without another integration agent", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.restartAfterPromotionResumesCompletionSettlementWithoutAnotherIntegrationAgent
    )
    expect(run.replacementCalls).toBe(0)
    expect(run.journalTags).toContain("CompletionClaimReplaced")
  })
)

it.effect("reconciles a lost completion-claim replacement without allocating another claim", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.reconcilesALostCompletionClaimReplacementWithoutAllocatingAnotherClaim
    )
    expect(run.replacementCalls).toBe(1)
    expect(run.journalTags.filter((tag) => tag === "CompletionClaimReplacementIntended")).toHaveLength(1)
    expect(run.journalTags.filter((tag) => tag === "CompletionClaimReplaced")).toHaveLength(1)
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
    expect(run.records.some(({ event }) => event._tag === "CompletionClaimReplacementAttemptIntended")).toBe(true)
  })
)

it.effect("does not mutate a foreign claim while settling a promoted task", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.doesNotMutateAForeignClaimWhileSettlingAPromotedTask
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimOwnershipConflict")
    expect(run.replacementCalls).toBe(0)
    expect(run.deletionCalls).toBe(0)
    expect(run.journalTags).not.toContain("CompletionClaimReplacementAttemptIntended")
  })
)

it.effect("deletes only the exact completion claim after focused task success", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess
    )
    const replaced = run.records.find(({ event }) => event._tag === "CompletionClaimReplaced")?.event
    const deleted = run.records.find(({ event }) => event._tag === "CompletionClaimDeleted")?.event
    if (replaced?._tag !== "CompletionClaimReplaced" || deleted?._tag !== "CompletionClaimDeleted") {
      return yield* Effect.die("expected exact replacement and deletion outcomes")
    }
    expect(deleted.claim).toEqual(replaced.claim)
    expect(run.deletionCalls).toBe(1)
    const cleanupTags = focusedCleanupTags(run.journalTags)
    expect(cleanupTags).toContain("TaskTrackerReadIntentRecorded")
    expect(cleanupTags).toContain("TaskTrackerFactsObserved")
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.facts.lifecycle === "CompletedSuccessfully"
      )
    ).toBe(true)
    expect(run.journalTags).toContain("IntegrationFinalitySettled")
    expect(
      run.records.find(
        ({ event }) =>
          event._tag === "CompletionClaimDeletionReadObserved" && event.purpose._tag === "BeforeDeletionAttempt"
      )?.event
    ).toMatchObject({
      observation: replaced.claim,
      purpose: { _tag: "BeforeDeletionAttempt", attemptOrdinal: 1, readOrdinal: 1 }
    })
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("reconciles a lost completion-claim deletion without reopening success", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess
    )
    expect(run.deletionCalls).toBe(1)
    expect(run.journalTags).toContain("CompletionClaimDeleted")
    expect(run.journalTags).toContain("IntegrationFinalitySettled")
    expect(run.journalTags.filter((tag) => tag === "CompletionClaimReplacementIntended")).toHaveLength(1)
  })
)

it.effect("reconstructs and round-trips interrupted and settled completion-cleanup Run prefixes", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess
    )
    const deletionAttemptAt = run.records.findIndex(
      ({ event }) => event._tag === "CompletionClaimDeletionAttemptIntended"
    )
    expect(deletionAttemptAt).toBeGreaterThan(0)
    const interruptedPrefix = run.records.slice(0, deletionAttemptAt + 1)
    const runId = run.records[0]?.runId
    if (runId === undefined) return yield* Effect.die("the completion-cleanup cassette must begin a Run")
    const interruptedHistory = reduceWorkflowJournalHistory(runId, interruptedPrefix)
    if (interruptedHistory._tag !== "ValidWorkflowJournalHistory") {
      return yield* Effect.die(
        `the interrupted completion-cleanup Run prefix must reconstruct: ${interruptedHistory.issues
          .map((issue) => ("detail" in issue ? issue.detail : issue._tag))
          .join("; ")}`
      )
    }
    expect(interruptedPrefix.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    expect(interruptedPrefix.at(-1)?.event).toMatchObject({
      _tag: "CompletionClaimDeletionAttemptIntended",
      attemptOrdinal: 1
    })
    expect(interruptedPrefix.some(({ event }) => event._tag === "CompletionClaimDeletionReadObserved")).toBe(true)

    const interruptedRead = interruptedPrefix.find(
      ({ event }) =>
        event._tag === "CompletionClaimDeletionReadObserved" && event.purpose._tag === "BeforeDeletionAttempt"
    )?.event
    const interruptedAttempt = interruptedPrefix.find(
      ({ event }) => event._tag === "CompletionClaimDeletionAttemptIntended"
    )?.event
    expect(interruptedRead).toMatchObject({
      observation: { _tag: "CompletionTaskClaim" },
      purpose: { _tag: "BeforeDeletionAttempt", attemptOrdinal: 1, readOrdinal: 1 }
    })
    expect(interruptedAttempt).toMatchObject({ attemptOrdinal: 1 })
    if (
      interruptedRead?._tag !== "CompletionClaimDeletionReadObserved" ||
      interruptedAttempt?._tag !== "CompletionClaimDeletionAttemptIntended"
    ) {
      return yield* Effect.die("the interrupted cassette must retain its exact read and deletion intent")
    }
    expect(interruptedAttempt.operationId).toBe(interruptedRead.request.operationId)

    const settledHistory = reduceWorkflowJournalHistory(runId, run.records)
    expect(settledHistory._tag).toBe("ValidWorkflowJournalHistory")
    expect(run.journalTags.slice(deletionAttemptAt + 1)).toEqual([
      "CompletionClaimDeletionReadObserved",
      "CompletionClaimDeletionReadObserved",
      "CompletionClaimDeleted",
      "IntegrationFinalitySettled"
    ])
    expect(run.deletionCalls).toBe(1)
    expect(
      run.records
        .filter(({ event }) => event._tag === "CompletionClaimDeletionReadObserved")
        .slice(-2)
        .map(({ event }) => event)
    ).toMatchObject([
      {
        observation: { _tag: "CompletionClaimMarkerAbsent" },
        purpose: { _tag: "BeforeDeletionAttempt", attemptOrdinal: 2, readOrdinal: 1 }
      },
      {
        observation: { _tag: "UnclaimedTask" },
        purpose: { _tag: "ConfirmNoActiveClaimAfterMarkerAbsent", attemptOrdinal: 2, readOrdinal: 1 }
      }
    ])
    expect(run.records.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)
  })
)

it.effect("waits without replacing when the current completion claim cannot be read", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.waitsWithoutReplacingWhenTheCurrentCompletionClaimCannotBeRead
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimReadFailure")
    expect(run.replacementCalls).toBe(0)
    expect(run.deletionCalls).toBe(0)
    expect(run.boundaryCalls).toEqual(["readTaskClaim"])
  })
)

it.effect("keeps successful work final when the completion claim cannot be read before deletion", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.keepsSuccessfulWorkFinalWhenTheCompletionClaimCannotBeReadBeforeDeletion
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimReadFailure")
    expect(run.replacementCalls).toBe(0)
    expect(run.deletionCalls).toBe(0)
    const cleanupTags = focusedCleanupTags(run.journalTags)
    expect(cleanupTags).toContain("TaskTrackerReadIntentRecorded")
    expect(cleanupTags).toContain("TaskTrackerFactsObserved")
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.facts.lifecycle === "CompletedSuccessfully"
      )
    ).toBe(true)
    expect(run.journalTags).not.toContain("CompletionClaimDeleted")
  })
)

it.effect("keeps successful work final when completion-claim deletion cannot converge", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.keepsSuccessfulWorkFinalWhenCompletionClaimDeletionCannotConverge
    )
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimDidNotConverge")
    expect(run.deletionCalls).toBe(3)
    const cleanupTags = focusedCleanupTags(run.journalTags)
    expect(cleanupTags).toContain("TaskTrackerReadIntentRecorded")
    expect(cleanupTags).toContain("TaskTrackerFactsObserved")
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskCompletionFacts" &&
          event.observation.facts.lifecycle === "CompletedSuccessfully"
      )
    ).toBe(true)
    expect(run.journalTags).not.toContain("CompletionClaimDeleted")
    expect(run.journalTags).not.toContain("IntegrationFinalitySettled")
  })
)

it.effect("does not terminate an empty frontier while completion settlement is pending", () =>
  Effect.gen(function* () {
    const run = yield* replayIntegrationFinalityCassette(
      maintainedIntegrationFinalityProtocolCassetteCatalog.doesNotTerminateAnEmptyFrontierWhileCompletionSettlementIsPending
    )
    expect(run.sawEmptyFrontierWhilePending).toBe(true)
    expect(run.failureTag).toBe("IntegrationFinality.CompletionClaimDidNotConverge")
    expect(run.journalTags).not.toContain("WorkflowRunTerminated")
  })
)
