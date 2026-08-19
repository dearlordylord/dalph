import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Effect, Exit, Option, Schema } from "effect"
import { expect } from "vitest"
import { AttemptId, GitCommitSha, GitRepositoryLocator, TaskId } from "@dalph/contracts"
import {
  CompletionTaskBoundary,
  CompletionTaskRequest,
  controlledTrackerMutationLayerFrom,
  FixtureTarget,
  makeTaskClaimObservationOperation,
  OperationId,
  TrackerGraphReader,
  type IntegratorCandidateText,
  TrackerMutation
} from "@dalph/orchestrator"
import {
  AuthoredCassetteStoryItem,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"
import { controlledTrackerAuthorityLayer } from "../../src/cassettes/authored-tracker-authority.js"
import { controlledTrackerGraphReaderLayer, controlledTrace } from "../../src/cassettes/authored-adapters.js"
import { makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
const decodeStoryItem = (input: unknown): AuthoredCassetteStoryItem =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(input)

const decodeDalphSelection = (input: unknown): typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.DalphSelects)(input)

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

it.effect("covers authored cursor terminal and cleanup outcomes", () =>
  Effect.gen(function* () {
    const attemptId = AttemptId.make("attempt:cursor-terminals")
    const repository = GitRepositoryLocator.make("/coverage/cursor.git")
    const candidateCommit = GitCommitSha.make("e".repeat(40))
    const candidateText = "refs/heads/cursor" as IntegratorCandidateText

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
