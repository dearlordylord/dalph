import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect"
import { expect } from "vitest"
import { AttemptId, GitCommitSha, GitRepositoryLocator, TaskId } from "@dalph/contracts"
import {
  CompletionTaskBoundary,
  CompletionTaskRequest,
  controlledTrackerMutationLayerFrom,
  describeJournalEvent,
  FixtureTarget,
  IntegrationCandidateCorrelation,
  JournalPosition,
  makeTaskClaimObservationOperation,
  OperationId,
  TrackerGraphReader,
  type IntegratorCandidateText,
  TrackerMutation,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import {
  AuthoredCassetteStoryItem,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"
import {
  renderAuthoredStoryItemLandmark,
  renderAuthoredStoryItemLyric
} from "../../src/cassettes/authored-presentation.js"
import { assertAuthoredExpectedBehavior } from "../../src/cassettes/authored-outcomes.js"
import { controlledTrackerAuthorityLayer } from "../../src/cassettes/authored-tracker-authority.js"
import { controlledTrackerGraphReaderLayer, controlledTrace } from "../../src/cassettes/authored-adapters.js"
import { makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
import {
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationPlanId,
  targetVerificationCorrelationFor
} from "../../../orchestrator/src/workflow/protocols/target-verification/events.js"
import { IntegrationCandidateConstructedEvent } from "../../../orchestrator/src/workflow/protocols/integration-candidate-construction/events.js"

const decodeStoryItem = (input: unknown): AuthoredCassetteStoryItem =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(input)

const decodeDalphSelection = (input: unknown): typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.DalphSelects)(input)

const decodeExpectedBehavior = (input: unknown): typeof AuthoredCassetteStoryItem.cases.ExpectedBehavior.Type =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.ExpectedBehavior)(input)

const completionRequest = Schema.decodeUnknownSync(CompletionTaskRequest)({
  claim: {
    _tag: "CompletionTaskClaim",
    originalClaim: {
      _tag: "ActiveTaskClaim",
      operationId: "coverage-active-operation",
      owner: "coverage-owner",
      taskId: "A",
      token: "coverage-active-token"
    },
    plannedAttempt: {
      attemptId: "coverage-attempt",
      baseSha: "1".repeat(40),
      branch: "refs/heads/coverage",
      executor: "executor:coverage",
      runId: "coverage-run",
      taskId: "A",
      taskRevision: "coverage-revision",
      worktree: "/coverage/worktree"
    },
    promotionCorrelation: {
      qualifiedCandidate: {
        candidateCommit: "3".repeat(40),
        candidateText: "refs/heads/coverage-candidate",
        directParents: ["1".repeat(40), "2".repeat(40)],
        qualifiedAt: 10,
        run: {
          ordinal: 1,
          session: {
            acceptedResult: { commit: "2".repeat(40), evidenceManifest: { byteLength: 17, digest: "b".repeat(64) } },
            candidateResource: "/coverage/candidate",
            expectedTargetHead: "1".repeat(40),
            integrationTarget: { ref: "refs/heads/master", repository: "/coverage/authored.git" },
            plannedAttempt: {
              attemptId: "coverage-attempt",
              baseSha: "1".repeat(40),
              branch: "refs/heads/coverage",
              executor: "executor:coverage",
              runId: "coverage-run",
              taskId: "A",
              taskRevision: "coverage-revision",
              worktree: "/coverage/worktree"
            },
            queuedAt: 5,
            sessionId: "coverage-session",
            startedAt: 8,
            targetLineageObservedAt: 9
          }
        }
      },
      requestId: "target-promotion:coverage-session:1:3333333333333333333333333333333333333333"
    }
  },
  operationId: "completion-task:target-promotion:coverage-session:1:3333333333333333333333333333333333333333",
  taskId: "A",
  taskRevision: "coverage-revision"
})

it("renders authored candidate, verification, graph, and operator variants at the public presentation boundary", () => {
  const graphEmpty = { revision: "empty", tasks: [] }
  const graphWithTask = {
    revision: "with-task",
    tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  }
  const expected = decodeExpectedBehavior({
    _tag: "ExpectedBehavior",
    orchestration: [
      {
        _tag: "IntegrationCandidateConstructed",
        acceptedResultCommit: "a".repeat(40),
        attemptId: "attempt:A:0",
        candidateCommit: "c".repeat(40),
        expectedTargetHead: "1".repeat(40),
        taskId: "A"
      },
      { _tag: "TargetVerificationPassed", candidateCommit: "c".repeat(40), planId: "coverage-plan", taskId: "A" },
      {
        _tag: "TargetVerificationStopped",
        candidateCommit: "c".repeat(40),
        outcome: "TimedOut",
        planId: "coverage-plan",
        taskId: "A"
      },
      { _tag: "PlannedAttemptExecutorWorkResponsibilityBegan", attemptId: "attempt:A:0", taskId: "A" },
      { _tag: "PlannedAttemptExecutorWorkReported", attemptId: "attempt:A:0", report: "TerminalAccepted" },
      { _tag: "PlannedAttemptExecutorCommandProjectionObserved", attemptId: "attempt:A:0", report: "Running" }
    ],
    protocol: [
      { _tag: "PlannedAttemptReplaced", priorAttemptId: "attempt:A:0", successorAttemptId: "attempt:A:1", taskId: "A" }
    ],
    taskWork: { absences: [], results: [] }
  })
  const unpause = Object.values(maintainedAuthoredCassetteCatalog)
    .flatMap(({ story }) => story)
    .find((item) => item._tag === "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting")
  expect(unpause).toBeDefined()
  if (unpause === undefined) return
  const rendered = [
    expected,
    decodeStoryItem({ _tag: "TrackerGraphReadReturned", graph: graphEmpty }),
    decodeStoryItem({ _tag: "TrackerGraphReadReturned", graph: graphWithTask }),
    decodeStoryItem({
      _tag: "IntegrationCandidateAgentReported",
      attemptId: "attempt:A:0",
      report: { _tag: "Working" }
    }),
    decodeStoryItem({
      _tag: "IntegrationCandidateGitValidationFailed",
      candidateCommit: "c".repeat(40),
      detail: "coverage read failed",
      repository: "/coverage/authored.git"
    }),
    decodeStoryItem({
      _tag: "IntegrationCandidateGitValidationReturned",
      candidateCommit: "c".repeat(40),
      observation: { _tag: "Missing", candidateText: "refs/heads/candidate" },
      repository: "/coverage/authored.git"
    }),
    decodeStoryItem({
      _tag: "TargetVerificationReturned",
      result: { _tag: "Passed", artifacts: [{ content: "ok", name: "report.txt" }] }
    }),
    decodeStoryItem({ _tag: "OperatorSubscribesToPauseObservation", subject: { _tag: "Run" } }),
    decodeStoryItem({
      _tag: "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission",
      direction: "Pause",
      subject: { _tag: "Run" }
    }),
    unpause
  ]
  const lyrics = rendered.map(renderAuthoredStoryItemLyric)
  expect(lyrics[0]).toContain("public verification plan coverage-plan to pass")
  expect(lyrics[0]).toContain("candidate cccccccccccccccccccccccccccccccccccccccc to have target")
  expect(lyrics[1]).toContain("0 task graph facts")
  expect(lyrics[2]).toContain("with-task")
  expect(lyrics[4]).toContain("coverage read failed")
  expect(lyrics[5]).toContain("Missing")
  expect(lyrics[6]).toContain("returns Passed")
  expect(lyrics[7]).toContain("the Run")
  expect(lyrics[8]).toContain("before delivery-action admission")
  expect(lyrics[9]).toContain("Alice unpauses task A")
  const graphWithTaskItem = rendered[2]
  expect(graphWithTaskItem).toBeDefined()
  if (graphWithTaskItem === undefined) return
  expect(renderAuthoredStoryItemLandmark(graphWithTaskItem)).toContain("with-task")
  expect(rendered.map(renderAuthoredStoryItemLandmark).filter((landmark) => landmark !== null).length).toBeGreaterThan(
    0
  )
})

it.effect("uses default authored tracker hooks and exposes every completion lookup outcome", () =>
  Effect.gen(function* () {
    const tracker = yield* TrackerMutation.pipe(Effect.provide(controlledTrackerMutationLayerFrom([])))
    for (const outcome of ["Applied", "NotApplied", "Unreadable"] as const) {
      const cursor = yield* makeStoryCursor([
        { _tag: "CompletionTaskRequestLookupReturned", outcome, taskId: TaskId.make("A") }
      ])
      const lookup = yield* Effect.gen(function* () {
        return yield* (yield* CompletionTaskBoundary).readCompletionRequest(completionRequest)
      }).pipe(Effect.provide(controlledTrackerAuthorityLayer(cursor, tracker)))
      expect(lookup._tag).toBe(
        outcome === "Applied" ? "Applied" : outcome === "NotApplied" ? "NotApplied" : "Unreadable"
      )
    }
    const configuredCursor = yield* makeStoryCursor([
      { _tag: "CompletionTaskRequestLookupReturned", outcome: "Applied", taskId: TaskId.make("A") }
    ])
    const configuredBoundary = Effect.gen(function* () {
      return yield* CompletionTaskBoundary
    }).pipe(
      Effect.provide(
        controlledTrackerAuthorityLayer(configuredCursor, tracker, {
          reportInteractionMismatch: () => Effect.void,
          lookupAcquisitionOperationTask: () => Effect.succeed(Option.none())
        })
      )
    )
    expect((yield* configuredBoundary).readCompletionRequest).toBeTypeOf("function")
  })
)

it.effect("runs the authored candidate and promotion outcomes through their production adapters", () =>
  Effect.gen(function* () {
    const names = [
      "candidateConflictRecovery",
      "candidateCorrectionAfterUnreadableGit",
      "candidateCorrectionExhaustion",
      "candidateCorrelationContradiction",
      "candidateVerificationPassed",
      "changedAttemptContinues",
      "changedAttemptRestartsCleanly",
      "changedAttemptRestartAfterSupersessionCrash",
      "changedAttemptStopsAndReleases",
      "changedAttemptChoiceRace",
      "changedAttemptReacquisitionForeignConflict",
      "taskPauseExecutorAndPromotionBoundaries",
      "taskPauseFinishesHeldIntegration",
      "runPauseSafelySuspends",
      "runPauseObservationDisconnects",
      "runUnpauseAfterSafeSuspension",
      "runUnpauseDuringSuspensionRestarts",
      "taskUnpauseAfterSafeSuspension",
      "taskUnpauseDuringSuspensionRestarts",
      "targetPromotionAmbiguityExhaustion",
      "targetPromotionStaleBeforeCompareAndSet",
      "targetPromotionLostResponseDiscoversCurrentCandidate"
    ] as const
    for (const name of names) {
      const exit = yield* Effect.exit(
        runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog[name]).pipe(Effect.provide(NodeCrypto.layer))
      )
      expect(Exit.isSuccess(exit), Cause.pretty(Exit.isFailure(exit) ? exit.cause : Cause.empty)).toBe(true)
      if (Exit.isSuccess(exit)) {
        expect(exit.value.records.length).toBeGreaterThan(0)
        expect(exit.value.cassette.story.at(-1)?._tag).toBe("ExpectedBehavior")
      }
    }
  })
)

it.effect("correlates authored candidate, Git, and verification cursor boundaries", () =>
  Effect.gen(function* () {
    const attemptId = AttemptId.make("attempt:coverage-agent")
    const candidateText = "refs/heads/coverage-agent" as IntegratorCandidateText
    const repository = GitRepositoryLocator.make("/coverage/candidate.git")
    const candidateCommit = GitCommitSha.make("c".repeat(40))
    const agent = decodeStoryItem({ _tag: "IntegrationCandidateAgentReported", attemptId, report: { _tag: "Working" } })
    const targetLineageSelection = decodeDalphSelection({
      _tag: "DalphSelects",
      operation: { _tag: "ReadTargetLineage", attemptId, taskId: "A" }
    })
    const agentCursor = yield* makeStoryCursor([agent])
    const directAgent = yield* agentCursor.consumeIntegrationCandidateAgentReport(attemptId)
    expect(Option.isSome(directAgent)).toBe(true)

    const selectionCursor = yield* makeStoryCursor([targetLineageSelection, agent])
    const waitingAgent = yield* selectionCursor.consumeIntegrationCandidateAgentReport(attemptId).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(yield* selectionCursor.consumeDalphSelectionFor(targetLineageSelection.operation)).toEqual(
      targetLineageSelection
    )
    expect(Option.isSome(yield* Fiber.join(waitingAgent))).toBe(true)

    const missingAgentCursor = yield* makeStoryCursor([
      decodeStoryItem({
        _tag: "ExpectedBehavior",
        orchestration: null,
        protocol: null,
        taskWork: { absences: [], results: [] }
      })
    ])
    expect(Option.isNone(yield* missingAgentCursor.consumeIntegrationCandidateAgentReport(attemptId))).toBe(true)

    const wrongAgentCursor = yield* makeStoryCursor([
      decodeStoryItem({
        _tag: "IntegrationCandidateAgentReported",
        attemptId: "attempt:other",
        report: { _tag: "Working" }
      })
    ])
    expect(yield* wrongAgentCursor.consumeIntegrationCandidateAgentReport(attemptId).pipe(Effect.flip)).toMatchObject({
      _tag: "AuthoredCassetteInteractionMismatch"
    })

    const failedGit = decodeStoryItem({
      _tag: "IntegrationCandidateGitValidationFailed",
      candidateCommit,
      detail: "candidate repository unreadable",
      repository
    })
    const failedGitCursor = yield* makeStoryCursor([failedGit])
    expect(
      yield* failedGitCursor.consumeIntegrationCandidateGitValidation(repository, candidateCommit).pipe(Effect.flip)
    ).toMatchObject({ _tag: "AuthoredIntegrationCandidateGitValidationFailure" })

    const returnedGit = decodeStoryItem({
      _tag: "IntegrationCandidateGitValidationReturned",
      candidateCommit,
      observation: { _tag: "Missing", candidateText },
      repository
    })
    const returnedGitCursor = yield* makeStoryCursor([returnedGit])
    expect(yield* returnedGitCursor.consumeIntegrationCandidateGitValidation(repository, candidateCommit)).toEqual(
      returnedGit
    )

    const terminalGitCursor = yield* makeStoryCursor([
      decodeStoryItem({
        _tag: "ExpectedBehavior",
        orchestration: null,
        protocol: null,
        taskWork: { absences: [], results: [] }
      })
    ])
    expect(
      yield* terminalGitCursor.consumeIntegrationCandidateGitValidation(repository, candidateCommit).pipe(Effect.flip)
    ).toMatchObject({ _tag: "AuthoredCassetteInteractionMismatch", expected: "ExpectedBehavior" })

    const expectedGit = decodeStoryItem({
      _tag: "IntegrationCandidateGitValidationReturned",
      candidateCommit,
      observation: { _tag: "Missing", candidateText },
      repository
    })
    const mismatchedGitCursor = yield* makeStoryCursor([expectedGit])
    expect(
      yield* mismatchedGitCursor
        .consumeIntegrationCandidateGitValidation(
          GitRepositoryLocator.make("/coverage/other.git"),
          GitCommitSha.make("d".repeat(40))
        )
        .pipe(Effect.flip)
    ).toMatchObject({ _tag: "AuthoredCassetteInteractionMismatch", storyPosition: 0 })

    const verification = decodeStoryItem({
      _tag: "TargetVerificationReturned",
      result: { _tag: "Passed", artifacts: [{ content: "coverage", name: "report.txt" }] }
    })
    const verificationCursor = yield* makeStoryCursor([verification])
    expect(yield* verificationCursor.consumeTargetVerificationReturned).toEqual(verification)

    const selection = decodeDalphSelection({ _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } })
    const git = decodeStoryItem({
      _tag: "IntegratorGitObservationReturned",
      candidateText,
      observation: { _tag: "Missing", candidateText }
    })
    const releaseGit = yield* Deferred.make<void>()
    const ownershipCursor = yield* makeStoryCursor([git, selection], {
      onOccurrence: ({ item }) =>
        item._tag === "IntegratorGitObservationReturned" ? Deferred.await(releaseGit) : Effect.void
    })
    const waitingSelection = yield* ownershipCursor.consumeDalphSelectionFor(selection.operation).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    const gitFiber = yield* ownershipCursor.consumeIntegratorGitObservation(candidateText).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(yield* Fiber.join(waitingSelection)).toEqual(selection)
    yield* Deferred.succeed(releaseGit, undefined)
    expect(yield* Fiber.join(gitFiber)).toEqual(git)

    const reverseRelease = yield* Deferred.make<void>()
    const reverseCursor = yield* makeStoryCursor([git, selection], {
      onOccurrence: ({ item }) =>
        item._tag === "IntegratorGitObservationReturned" ? Deferred.await(reverseRelease) : Effect.void
    })
    const reverseGitFiber = yield* reverseCursor.consumeIntegratorGitObservation(candidateText).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    const reverseSelectionFiber = yield* reverseCursor
      .consumeDalphSelectionFor(selection.operation)
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    expect(yield* Fiber.join(reverseSelectionFiber)).toEqual(selection)
    yield* Deferred.succeed(reverseRelease, undefined)
    expect(yield* Fiber.join(reverseGitFiber)).toEqual(git)
  })
)

it.effect("projects candidate construction and both target-verification terminals into authored evidence", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(
      maintainedAuthoredCassetteCatalog.acceptedResultRestartsIntoIntegration
    )
    const plannedRecord = run.records.find(({ event }) => event._tag === "TaskAttemptPlanned")
    const acceptedRecord = run.records.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report._tag === "Terminal" &&
        event.report.result._tag === "Accepted"
    )
    if (
      plannedRecord?.event._tag !== "TaskAttemptPlanned" ||
      acceptedRecord?.event._tag !== "PlannedAttemptExecutorWorkReported" ||
      acceptedRecord.event.report._tag !== "Terminal" ||
      acceptedRecord.event.report.result._tag !== "Accepted"
    ) {
      return yield* Effect.die("planned accepted work is required for authored outcome projection")
    }
    const candidateCorrelation = Schema.decodeUnknownSync(IntegrationCandidateCorrelation)({
      acceptanceManifest: acceptedRecord.event.report.result.acceptedResult.evidenceManifest,
      acceptedResultCommit: acceptedRecord.event.report.result.acceptedResult.commit,
      attemptId: plannedRecord.event.operation.plannedAttempt.attemptId,
      candidateId: "coverage-outcome-candidate",
      candidateResource: "/coverage/outcome-candidate",
      expectedTargetHead: plannedRecord.event.operation.plannedAttempt.baseSha,
      integrationSessionId: "coverage-outcome-session",
      integrationTarget: { repository: "/coverage/outcome.git", ref: "refs/heads/master" },
      runId: run.runId
    })
    const constructedEvent = IntegrationCandidateConstructedEvent.make({
      candidateCommit: GitCommitSha.make("c".repeat(40)),
      correlation: candidateCorrelation,
      gitObservationAt: JournalPosition.make(run.records.length + 1),
      reviewManifest: acceptedRecord.event.report.result.acceptedResult.evidenceManifest,
      version: workflowJournalEventVersion
    })
    const correlation = targetVerificationCorrelationFor(
      {
        candidateCommit: constructedEvent.candidateCommit,
        constructedAt: JournalPosition.make(run.records.length + 1),
        correlation: constructedEvent.correlation,
        reviewManifest: constructedEvent.reviewManifest
      },
      TargetVerificationPlanId.make("coverage-verification-passed")
    )
    const stoppedCorrelation = targetVerificationCorrelationFor(
      {
        candidateCommit: constructedEvent.candidateCommit,
        constructedAt: JournalPosition.make(run.records.length + 1),
        correlation: constructedEvent.correlation,
        reviewManifest: constructedEvent.reviewManifest
      },
      TargetVerificationPlanId.make("coverage-verification-stopped")
    )
    const passed = TargetVerificationEvidenceSealedEvent.make({
      correlation,
      manifest: constructedEvent.reviewManifest,
      terminal: "Passed",
      version: workflowJournalEventVersion
    })
    const stopped = TargetVerificationEvidenceSealedEvent.make({
      correlation: stoppedCorrelation,
      manifest: constructedEvent.reviewManifest,
      terminal: "TimedOut",
      version: workflowJournalEventVersion
    })
    const recordFor = (event: typeof passed, position: number) => ({
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(position),
      runId: run.runId
    })
    const expected = decodeExpectedBehavior({
      _tag: "ExpectedBehavior",
      orchestration: [
        {
          _tag: "IntegrationCandidateConstructed",
          acceptedResultCommit: constructedEvent.correlation.acceptedResultCommit,
          attemptId: constructedEvent.correlation.attemptId,
          candidateCommit: constructedEvent.candidateCommit,
          expectedTargetHead: constructedEvent.correlation.expectedTargetHead,
          taskId: plannedRecord.event.operation.plannedAttempt.taskId
        },
        {
          _tag: "TargetVerificationPassed",
          candidateCommit: constructedEvent.candidateCommit,
          planId: correlation.planId,
          taskId: plannedRecord.event.operation.plannedAttempt.taskId
        },
        {
          _tag: "TargetVerificationStopped",
          candidateCommit: constructedEvent.candidateCommit,
          outcome: "TimedOut",
          planId: stoppedCorrelation.planId,
          taskId: plannedRecord.event.operation.plannedAttempt.taskId
        }
      ],
      protocol: null,
      taskWork: { absences: [], results: [] }
    })
    const actual = yield* assertAuthoredExpectedBehavior(
      [
        plannedRecord,
        { ...plannedRecord, event: constructedEvent },
        recordFor(passed, run.records.length + 2),
        recordFor(stopped, run.records.length + 3)
      ],
      expected
    )
    expect(actual.orchestrationEvidence).toEqual(expected.orchestration)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("covers authored cursor terminal and cleanup outcomes", () =>
  Effect.gen(function* () {
    const attemptId = AttemptId.make("attempt:cursor-terminals")
    const repository = GitRepositoryLocator.make("/coverage/cursor.git")
    const candidateCommit = GitCommitSha.make("e".repeat(40))
    const candidateText = "refs/heads/cursor" as IntegratorCandidateText

    const emptyGit = yield* makeStoryCursor([])
    const emptyGitExit = yield* Effect.exit(
      emptyGit.consumeIntegrationCandidateGitValidation(repository, candidateCommit)
    )
    expect(Exit.isFailure(emptyGitExit)).toBe(true)

    const emptyExecutor = yield* makeStoryCursor([])
    const emptyExecutorExit = yield* Effect.exit(emptyExecutor.consumeExecutorReportFor("StartOrContinue", attemptId))
    expect(Exit.isFailure(emptyExecutorExit)).toBe(true)

    const ordinaryExecutor = yield* makeStoryCursor([
      decodeDalphSelection({ _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } })
    ])
    const ordinaryExecutorExit = yield* Effect.exit(
      ordinaryExecutor.consumeExecutorReportFor("StartOrContinue", attemptId)
    )
    expect(Exit.isFailure(ordinaryExecutorExit)).toBe(true)

    const emptyIntegratorRequest = yield* makeStoryCursor([])
    const integratorRequest = Object.values(maintainedAuthoredCassetteCatalog)
      .flatMap(({ story }) => story)
      .find(
        (item): item is typeof AuthoredCassetteStoryItem.cases.IntegratorRequestReceived.Type =>
          item._tag === "IntegratorRequestReceived"
      )
    if (integratorRequest === undefined) return yield* Effect.die("missing maintained Integrator request")
    const emptyIntegratorRequestExit = yield* Effect.exit(
      emptyIntegratorRequest.consumeIntegratorRequest(integratorRequest.correlation)
    )
    expect(Exit.isFailure(emptyIntegratorRequestExit)).toBe(true)

    const emptyIntegratorGit = yield* makeStoryCursor([])
    const emptyIntegratorGitExit = yield* Effect.exit(emptyIntegratorGit.consumeIntegratorGitObservation(candidateText))
    expect(Exit.isFailure(emptyIntegratorGitExit)).toBe(true)

    const mismatchedSelection = yield* makeStoryCursor([
      decodeDalphSelection({ _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } })
    ])
    const mismatchedSelectionExit = yield* Effect.exit(
      mismatchedSelection.consumeDalphSelectionFor({ _tag: "ReadTaskClaim", taskId: TaskId.make("B") })
    )
    expect(Exit.isFailure(mismatchedSelectionExit)).toBe(true)

    yield* emptyExecutor.endExecutorReportRequest("StartOrContinue", attemptId)

    const emptyPromotionGit = yield* makeStoryCursor([])
    const emptyPromotionGitExit = yield* Effect.exit(
      emptyPromotionGit.consumeTargetPromotionGitRead(repository, candidateCommit)
    )
    expect(Exit.isFailure(emptyPromotionGitExit)).toBe(true)
  })
)

it.effect("fails authored tracker and trace adapters closed at their declared boundaries", () =>
  Effect.gen(function* () {
    const failedGraphCursor = yield* makeStoryCursor([
      decodeStoryItem({ _tag: "TrackerGraphReadFailed", reason: "IncompleteSnapshot" })
    ])
    const failedGraph = yield* Effect.gen(function* () {
      return yield* (yield* TrackerGraphReader).read(FixtureTarget.make("coverage-target"))
    }).pipe(Effect.provide(controlledTrackerGraphReaderLayer(failedGraphCursor)), Effect.flip)
    expect(failedGraph._tag).toBe("TrackerGraphReader.AdapterReadError")

    const invalidGraphCursor = yield* makeStoryCursor([
      decodeStoryItem({
        _tag: "TrackerGraphReadReturned",
        graph: {
          revision: "invalid-duplicate",
          tasks: [
            { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
            { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
          ]
        }
      })
    ])
    const invalidGraph = yield* Effect.gen(function* () {
      return yield* (yield* TrackerGraphReader).read(FixtureTarget.make("coverage-target"))
    }).pipe(Effect.provide(controlledTrackerGraphReaderLayer(invalidGraphCursor)), Effect.flip)
    expect(invalidGraph._tag).toBe("TrackerGraphReader.AdapterReadError")

    const wrongSpecificationCursor = yield* makeStoryCursor([
      decodeStoryItem({ _tag: "TaskWorkSpecificationReadReturned", body: "body", taskId: "B", title: "Task B" })
    ])
    const wrongSpecification = yield* Effect.gen(function* () {
      return yield* (yield* TrackerGraphReader).readTaskWorkSpecification(
        FixtureTarget.make("coverage-target"),
        TaskId.make("A")
      )
    }).pipe(Effect.provide(controlledTrackerGraphReaderLayer(wrongSpecificationCursor)), Effect.flip)
    expect(wrongSpecification._tag).toBe("TrackerGraphReader.AdapterReadError")

    const expectedSelection = decodeStoryItem({
      _tag: "DalphSelects",
      operation: { _tag: "ReadTaskClaim", taskId: "A" }
    })
    const trace = controlledTrace(yield* makeStoryCursor([expectedSelection]))
    const wrongTrace = yield* Effect.gen(function* () {
      return yield* trace.emit({
        _tag: "OperationSelected",
        operation: makeTaskClaimObservationOperation(
          OperationId.make("coverage-wrong-trace"),
          FixtureTarget.make("coverage-target"),
          TaskId.make("B")
        )
      })
    }).pipe(Effect.exit)
    expect(Exit.isFailure(wrongTrace)).toBe(true)
  })
)
