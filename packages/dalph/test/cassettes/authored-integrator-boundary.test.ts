import { Cause, Effect, Exit, Fiber, Schema } from "effect"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  FixtureTarget,
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorSessionId,
  JournalPosition
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import {
  AuthoredCassetteInteractionMismatch,
  AuthoredIntegratorGitObservationFailure,
  makeStoryCursor
} from "../../src/cassettes/authored-cursor.js"

const sha = (character: string): GitCommitSha => GitCommitSha.make(character.repeat(40))
const repository = GitRepositoryLocator.make("/repositories/authored-integrator.git")
const runId = RunId.make("authored-integrator-run")
const taskId = TaskId.make("authored-integrator-task")
const attemptId = AttemptId.make("authored-integrator-attempt")
const candidateText = IntegratorCandidateText.make("refs/heads/authored-integrator-candidate")
const candidateResource = IntegratorCandidateResourceLocator.make("resource:authored-integrator")
const correlation = IntegratorCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: sha("a"),
    evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("1".repeat(64)) })
  }),
  candidateResource,
  expectedTargetHead: sha("b"),
  integrationTarget: IntegrationTarget.make({ repository, ref: IntegrationTargetRef.make("refs/heads/main") }),
  plannedAttempt: PlannedTaskAttempt.make({
    attemptId,
    baseSha: sha("9"),
    branch: TaskBranchRef.make("refs/heads/authored-integrator-task"),
    executor: TaskExecutorLocator.make("executor:authored-integrator"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("authored-integrator-revision"),
    worktree: WorktreeLocator.make("/worktrees/authored-integrator")
  }),
  queuedAt: JournalPosition.make(1),
  sessionId: IntegratorSessionId.make("session:authored-integrator"),
  startedAt: JournalPosition.make(2),
  targetLineageObservedAt: JournalPosition.make(3)
})

const requestItem = AuthoredCassetteStoryItem.cases.IntegratorRequestReceived.make({ correlation })
const preparedResultItem = AuthoredCassetteStoryItem.cases.IntegratorResultReturned.make({
  result: { _tag: "PreparedCandidate", candidateText }
})
const notPreparedResultItem = AuthoredCassetteStoryItem.cases.IntegratorResultReturned.make({
  result: {
    _tag: "NotPrepared",
    detail: IntegratorNotPreparedDetail.make("outer Integrator could not prepare candidate")
  }
})
const gitObservation = IntegratorGitObservation.cases.Commit.make({
  candidateText,
  commit: sha("d"),
  directParents: [correlation.expectedTargetHead, correlation.acceptedResult.commit]
})

it("decodes the explicit outer Integrator request, result, and Git story items", () => {
  const items = [
    requestItem,
    preparedResultItem,
    notPreparedResultItem,
    AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.make({
      candidateText,
      observation: gitObservation
    }),
    AuthoredCassetteStoryItem.cases.IntegratorGitObservationFailed.make({
      candidateText,
      detail: "repository temporarily unreadable"
    })
  ]

  for (const item of items) {
    expect(Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(item)).toEqual(item)
  }
})

it.effect("asserts the exact request correlation before consuming its public result and Git observation", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([
      requestItem,
      preparedResultItem,
      AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.make({
        candidateText,
        observation: gitObservation
      })
    ])

    expect((yield* cursor.consumeIntegratorRequest(correlation)).correlation).toEqual(correlation)
    expect((yield* cursor.consumeIntegratorResult).result).toEqual({ _tag: "PreparedCandidate", candidateText })
    expect((yield* cursor.consumeIntegratorGitObservation(candidateText)).observation).toEqual(gitObservation)
  })
)

it.effect("waits for an actively owned recovery selection before consuming the outer Integrator Git observation", () =>
  Effect.gen(function* () {
    const selection = AuthoredCassetteStoryItem.cases.DalphSelects.make({
      operation: { _tag: "ReadTrackerGraph", target: FixtureTarget.make("cassette-target") }
    })
    const observation = AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.make({
      candidateText,
      observation: gitObservation
    })
    const cursor = yield* makeStoryCursor([selection, observation])
    const git = yield* cursor.consumeIntegratorGitObservation(candidateText).pipe(Effect.forkChild)
    yield* Effect.yieldNow

    expect(git.pollUnsafe()).toBeUndefined()
    expect(yield* cursor.consumeDalphSelectionFor(selection.operation)).toEqual(selection)
    expect((yield* Fiber.join(git)).observation).toEqual(gitObservation)
  })
)

it.effect("fails closed for an unrelated selection before the outer Integrator Git observation", () =>
  Effect.gen(function* () {
    const unrelatedSelection = AuthoredCassetteStoryItem.cases.DalphSelects.make({
      operation: { _tag: "ReconcileTaskWorktree", attemptId, taskId }
    })
    const observation = AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.make({
      candidateText,
      observation: gitObservation
    })
    const cursor = yield* makeStoryCursor([unrelatedSelection, observation])
    const exit = yield* cursor.consumeIntegratorGitObservation(candidateText).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("AuthoredCassetteInteractionMismatch")
  })
)

it.effect("fails closed when an Integrator recovery read has no exact owner", () =>
  Effect.gen(function* () {
    const recoverySelection = AuthoredCassetteStoryItem.cases.DalphSelects.make({
      operation: { _tag: "ReadTaskClaim", taskId }
    })
    const observation = AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.make({
      candidateText,
      observation: gitObservation
    })
    const cursor = yield* makeStoryCursor([recoverySelection, observation])
    const exit = yield* cursor.consumeIntegratorGitObservation(candidateText).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("AuthoredCassetteInteractionMismatch")
  })
)

it.effect("rejects a foreign request correlation and a Git observation for another candidate", () =>
  Effect.gen(function* () {
    const foreignCorrelation = IntegratorCorrelation.make({ ...correlation, expectedTargetHead: sha("c") })
    const requestCursor = yield* makeStoryCursor([requestItem])
    const requestResult = yield* requestCursor.consumeIntegratorRequest(foreignCorrelation).pipe(Effect.exit)
    expect(Exit.isFailure(requestResult)).toBe(true)
    if (Exit.isFailure(requestResult)) {
      const reason = requestResult.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined) {
        expect(Cause.isFailReason(reason)).toBe(true)
        if (Cause.isFailReason(reason)) expect(reason.error).toBeInstanceOf(AuthoredCassetteInteractionMismatch)
      }
    }

    const foreignText = IntegratorCandidateText.make("refs/heads/foreign-candidate")
    const foreignObservation = IntegratorGitObservation.cases.Missing.make({ candidateText: foreignText })
    const observationCursor = yield* makeStoryCursor([
      AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.make({
        candidateText,
        observation: foreignObservation
      })
    ])
    const observationResult = yield* observationCursor.consumeIntegratorGitObservation(candidateText).pipe(Effect.exit)
    expect(Exit.isFailure(observationResult)).toBe(true)
    if (Exit.isFailure(observationResult)) {
      const reason = observationResult.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined) {
        expect(Cause.isFailReason(reason)).toBe(true)
        if (Cause.isFailReason(reason)) expect(reason.error).toBeInstanceOf(AuthoredCassetteInteractionMismatch)
      }
    }
  })
)

it.effect("returns a typed Git failure for the exact reported candidate", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([
      AuthoredCassetteStoryItem.cases.IntegratorGitObservationFailed.make({
        candidateText,
        detail: "candidate object read failed"
      })
    ])
    const result = yield* cursor.consumeIntegratorGitObservation(candidateText).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const reason = result.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined) {
        expect(Cause.isFailReason(reason)).toBe(true)
        if (Cause.isFailReason(reason)) {
          expect(reason.error).toBeInstanceOf(AuthoredIntegratorGitObservationFailure)
          if (reason.error instanceof AuthoredIntegratorGitObservationFailure) {
            expect(reason.error.detail).toBe("candidate object read failed")
          }
        }
      }
    }
  })
)

it.effect("does not treat a legacy candidate-agent report as an outer Integrator result", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([
      AuthoredCassetteStoryItem.cases.IntegrationCandidateAgentReported.make({
        attemptId,
        report: { _tag: "Submitted", candidateCommit: sha("d") }
      })
    ])
    const result = yield* cursor.consumeIntegratorRequest(correlation).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      const reason = result.cause.reasons[0]
      expect(reason).toBeDefined()
      if (reason !== undefined) {
        expect(Cause.isFailReason(reason)).toBe(true)
        if (Cause.isFailReason(reason)) expect(reason.error).toBeInstanceOf(AuthoredCassetteInteractionMismatch)
      }
    }
  })
)
