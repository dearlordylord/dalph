import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect"
import { NodeCrypto } from "@effect/platform-node"
import { expect, it } from "vitest"
import { AttemptId, GitCommitSha, GitRepositoryLocator } from "@dalph/contracts"
import { TaskWorkCapacity } from "@dalph/orchestrator"
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
      const pauseAwait = yield* makeStoryCursor([findStoryItem("OperatorAwaitsPauseProgress")])
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

it("keeps authored Git, control, and executor outcomes correlated at the cursor boundary", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const candidateFailure = findStoryItemOf("IntegrationCandidateGitValidationFailed")
      const candidateFailureCursor = yield* makeStoryCursor([candidateFailure])
      const candidateError = yield* candidateFailureCursor
        .consumeIntegrationCandidateGitValidation(candidateFailure.repository, candidateFailure.candidateCommit)
        .pipe(Effect.flip)
      expect(candidateError._tag).toBe("AuthoredIntegrationCandidateGitValidationFailure")

      const candidateReturned = findStoryItemOf("IntegrationCandidateGitValidationReturned")
      const candidateReturnedCursor = yield* makeStoryCursor([candidateReturned])
      expect(
        (yield* candidateReturnedCursor.consumeIntegrationCandidateGitValidation(
          candidateReturned.repository,
          candidateReturned.candidateCommit
        ))._tag
      ).toBe("IntegrationCandidateGitValidationReturned")

      const candidateAgent = findStoryItemOf("IntegrationCandidateAgentReported")
      const candidateAgentCursor = yield* makeStoryCursor([candidateAgent])
      expect(
        Option.isSome(yield* candidateAgentCursor.consumeIntegrationCandidateAgentReport(candidateAgent.attemptId))
      ).toBe(true)

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

      const verification = yield* makeStoryCursor([findStoryItem("TargetVerificationReturned")])
      expect((yield* verification.consumeTargetVerificationReturned)._tag).toBe("TargetVerificationReturned")
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
      const publicationHold = yield* makeStoryCursor([
        findStoryItem("DalphHoldsExecutorRequestThroughNextDeliveryPublication")
      ])
      expect(Option.isSome(yield* publicationHold.consumeExecutorRequestPublicationHold)).toBe(true)
    })
  )
})

it("waits for delayed candidate reports and correlates concurrent Git validation requests", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const authoredLineage = maintainedStoryItems.find(
        (item) => item._tag === "DalphSelects" && item.operation._tag === "ReadTargetLineage"
      )
      const authoredReport = findStoryItemOf("IntegrationCandidateAgentReported")
      if (authoredLineage?._tag !== "DalphSelects") return yield* Effect.die("missing target-lineage selection")

      const requestedAttemptId = AttemptId.make("cursor-requested-attempt")
      const foreignAttemptId = AttemptId.make("cursor-foreign-attempt")
      const requestedReport = { ...authoredReport, attemptId: requestedAttemptId }
      const foreignReport = { ...authoredReport, attemptId: foreignAttemptId }
      const delayedCursor = yield* makeStoryCursor([authoredLineage, requestedReport])
      const delayed = yield* delayedCursor
        .consumeIntegrationCandidateAgentReport(requestedAttemptId)
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* delayedCursor.consumeDalphSelection).toEqual(authoredLineage)
      expect(yield* Fiber.join(delayed)).toEqual(Option.some(requestedReport))

      const concurrentCursor = yield* makeStoryCursor([authoredLineage, foreignReport, requestedReport])
      const requested = yield* concurrentCursor
        .consumeIntegrationCandidateAgentReport(requestedAttemptId)
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const foreign = yield* concurrentCursor
        .consumeIntegrationCandidateAgentReport(foreignAttemptId)
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* concurrentCursor.consumeDalphSelection).toEqual(authoredLineage)
      expect(yield* Fiber.join(requested)).toEqual(Option.some(requestedReport))
      expect(yield* Fiber.join(foreign)).toEqual(Option.some(foreignReport))

      const controlDirection = findStoryItemOf("OperatorAppliesControlDirectionBeforeDeliveryActionAdmission")
      const requestedRepository = GitRepositoryLocator.make("/cursor/requested.git")
      const requestedCommit = GitCommitSha.make("1".repeat(40))
      const foreignRepository = GitRepositoryLocator.make("/cursor/foreign.git")
      const foreignCommit = GitCommitSha.make("2".repeat(40))
      const authoredGit = findStoryItemOf("IntegrationCandidateGitValidationReturned")
      const requestedGit = { ...authoredGit, candidateCommit: requestedCommit, repository: requestedRepository }
      const foreignGit = { ...authoredGit, candidateCommit: foreignCommit, repository: foreignRepository }
      const mismatchedGitCursor = yield* makeStoryCursor([requestedGit])
      const mismatchedGit = yield* mismatchedGitCursor
        .consumeIntegrationCandidateGitValidation(foreignRepository, foreignCommit)
        .pipe(Effect.flip)
      expect(mismatchedGit).toMatchObject({ _tag: "AuthoredCassetteInteractionMismatch", storyPosition: 0 })
      const gitCursor = yield* makeStoryCursor([controlDirection, foreignGit, requestedGit])
      expect(yield* gitCursor.consumeControlDirection(controlDirection)).toEqual(Option.some(controlDirection))
      const requestedGitFiber = yield* gitCursor
        .consumeIntegrationCandidateGitValidation(requestedRepository, requestedCommit)
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const foreignGitFiber = yield* gitCursor
        .consumeIntegrationCandidateGitValidation(foreignRepository, foreignCommit)
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* gitCursor.completeControlDirectionBeforeDeliveryActionAdmission
      expect(yield* Fiber.join(requestedGitFiber)).toEqual(requestedGit)
      expect(yield* Fiber.join(foreignGitFiber)).toEqual(foreignGit)

      const emptyGitCursor = yield* makeStoryCursor([])
      const emptyGit = yield* emptyGitCursor
        .consumeIntegrationCandidateGitValidation(requestedRepository, requestedCommit)
        .pipe(Effect.flip)
      expect(emptyGit).toMatchObject({ _tag: "AuthoredCassetteInteractionMismatch", expected: "EndOfStory" })
      const terminalGitCursor = yield* makeStoryCursor([findStoryItem("ExpectedBehavior")])
      const terminalGit = yield* terminalGitCursor
        .consumeIntegrationCandidateGitValidation(requestedRepository, requestedCommit)
        .pipe(Effect.flip)
      expect(terminalGit).toMatchObject({ _tag: "AuthoredCassetteInteractionMismatch", expected: "ExpectedBehavior" })
      const terminalPromotionCursor = yield* makeStoryCursor([findStoryItem("ExpectedBehavior")])
      const terminalPromotion = yield* terminalPromotionCursor
        .consumeTargetPromotionGitRead(requestedRepository, requestedCommit)
        .pipe(Effect.flip)
      expect(terminalPromotion).toMatchObject({
        _tag: "AuthoredCassetteInteractionMismatch",
        expected: "ExpectedBehavior"
      })
    })
  )
})

it("round-trips restart, release, worktree, Git, lost-response, and supersession histories", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const cassettes = [
        maintainedAuthoredCassetteCatalog.changedAttemptRestartsCleanly,
        maintainedAuthoredCassetteCatalog.changedAttemptStopReleaseResponseLost,
        maintainedAuthoredCassetteCatalog.lostPlannedWorktreeSafelySuspends,
        maintainedAuthoredCassetteCatalog.candidateCorrectionAfterUnreadableGit,
        maintainedAuthoredCassetteCatalog.changedAttemptRestartRemainsUnproved,
        maintainedAuthoredCassetteCatalog.prePromotionBlockerClearAndSupersession,
        maintainedAuthoredCassetteCatalog.targetPromotionLostResponseDiscoversCurrentCandidate
      ]

      let supersessionRecorded: RecordedCassetteType | undefined
      for (const cassette of cassettes) {
        const run = yield* runAuthoredScenarioCassette(cassette)
        const recorded = yield* projectRecordedCassette(run.records)
        if (cassette === maintainedAuthoredCassetteCatalog.prePromotionBlockerClearAndSupersession) {
          supersessionRecorded = recorded
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

      if (supersessionRecorded === undefined) return yield* Effect.die("supersession cassette was not recorded")
      const withoutIntegrationOrigin = RecordedCassette.make({
        ...supersessionRecorded,
        entries: supersessionRecorded.entries.filter(({ _tag }) => _tag !== "IntegrationResponsibilityBegan")
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
        integrationCandidateIds: [],
        integrationCandidateResourceLocators: [],
        integrationSessionIds: [],
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
