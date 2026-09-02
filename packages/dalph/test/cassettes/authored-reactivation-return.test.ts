import { it } from "@effect/vitest"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorCommandFailure,
  RunId
} from "@dalph/contracts"
import {
  ApplicationExiting,
  DeliveryRelationReconciliationError,
  GitTargetLineageReadFailure,
  IntegrationFinalityRuntimeUnavailable,
  JournaledRunIdentityMismatch,
  JournalStorageUnavailable,
  TrackerReadError
} from "@dalph/orchestrator"
import { makeStoryCursor } from "../../src/cassettes/authored-cursor.js"
import { settleCoordinatorActivationReturn } from "../../src/cassettes/authored-runner.js"

const unsettledResponsibility = { _tag: "RunMustRemainActive" as const, reason: "UnsettledResponsibility" as const }

it.effect("keeps restart hints unavailable before the production finality result", () =>
  Effect.gen(function* () {
    const projection = {
      _tag: "PlannedAttemptExecutorProjectionReturned" as const,
      report: { _tag: "ExecutorWorkExecuting" as const, attemptId: AttemptId.make("attempt:A:0") }
    }
    const returned = { _tag: "CoordinatorActivationReturned" as const, decision: unsettledResponsibility }
    const hints = {
      _tag: "CassetteOffersRunReactivationHints" as const,
      hints: ["TrackerNotification", "Timer"] as const
    }
    const cursor = yield* makeStoryCursor([projection, returned, hints])

    expect(Option.isNone(yield* cursor.consumeRunReactivationHints)).toBe(true)
    const early = yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility)).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(early)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(0)

    expect(Option.isSome(yield* cursor.consumeExecutorProjectionFor(projection.report.attemptId))).toBe(true)
    const wrong = yield* settleCoordinatorActivationReturn(
      cursor,
      Exit.succeed({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
    ).pipe(Effect.exit)
    expect(Exit.isFailure(wrong)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)

    const failed = yield* settleCoordinatorActivationReturn(cursor, Exit.fail("production finality failed")).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(failed)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(1)

    yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility))
    expect(yield* cursor.storyPosition).toBe(2)
    const duplicate = yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility)).pipe(
      Effect.exit
    )
    expect(Exit.isFailure(duplicate)).toBe(true)
    expect(yield* cursor.storyPosition).toBe(2)
    expect(Option.isSome(yield* cursor.consumeRunReactivationHints)).toBe(true)
  })
)

it.effect("settles the reconstructed restart return once before delayed interruption and later hints", () =>
  Effect.gen(function* () {
    const publicationEntered = yield* Deferred.make<void>()
    const releasePublication = yield* Deferred.make<void>()
    const occurrenceCount = yield* Ref.make(0)
    const returned = { _tag: "CoordinatorActivationReturned" as const, decision: unsettledResponsibility }
    const hints = { _tag: "CassetteOffersRunReactivationHints" as const, hints: ["TrackerNotification"] as const }
    const cursor = yield* makeStoryCursor([returned, hints], {
      onOccurrence: ({ item }) =>
        item._tag === "CoordinatorActivationReturned"
          ? Ref.update(occurrenceCount, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(publicationEntered, undefined)),
              Effect.andThen(Deferred.await(releasePublication))
            )
          : Effect.void
    })

    const settlement = yield* settleCoordinatorActivationReturn(cursor, Exit.succeed(unsettledResponsibility)).pipe(
      Effect.forkScoped
    )
    yield* Deferred.await(publicationEntered)
    const interrupted = yield* Fiber.interrupt(settlement).pipe(Effect.forkScoped)
    const hinted = yield* cursor.consumeRunReactivationHints.pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    expect(interrupted.pollUnsafe()).toBeUndefined()
    expect(hinted.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(releasePublication, undefined)
    yield* Fiber.join(interrupted)
    expect(Exit.isFailure(yield* Fiber.await(settlement))).toBe(true)
    expect(Option.isSome(yield* Fiber.join(hinted))).toBe(true)
    expect(yield* Ref.get(occurrenceCount)).toBe(1)
    expect(yield* cursor.storyPosition).toBe(2)
  })
)

it.effect("transparently preserves representative restart activation failures without advancing or retrying", () =>
  Effect.gen(function* () {
    const runId = RunId.make("authored-reconstructed-activation-failures")
    const correlation = { attemptId: AttemptId.make("attempt:A:reconstructed-failure"), runId }
    const baseSha = GitCommitSha.make("a".repeat(40))
    const target = IntegrationTarget.make({
      ref: IntegrationTargetRef.make("refs/heads/main"),
      repository: GitRepositoryLocator.make("/dalph/cassettes/reconstructed-failure.git")
    })
    const cases = [
      { callsProgram: false, failure: new ApplicationExiting() },
      {
        callsProgram: false,
        failure: new JournaledRunIdentityMismatch({
          expectedRunId: runId,
          requestedRunId: RunId.make("authored-reconstructed-foreign-run")
        })
      },
      {
        callsProgram: true,
        failure: new TrackerReadError({
          detail: "the reconstructed startup graph could not be decoded",
          operation: "TrackerGraphReader.decode"
        })
      },
      {
        callsProgram: true,
        failure: new GitTargetLineageReadFailure({
          detail: "the reconstructed target lineage was unavailable",
          plannedBaseSha: baseSha,
          target
        })
      },
      {
        callsProgram: true,
        failure: new PlannedAttemptExecutorCommandFailure({
          command: "Suspend",
          correlation,
          detail: "the reconstructed executor boundary failed"
        })
      },
      {
        callsProgram: true,
        failure: new JournalStorageUnavailable({
          detail: "the reconstructed Journal could not be read",
          operation: "JournalStore.read"
        })
      },
      {
        callsProgram: true,
        failure: new DeliveryRelationReconciliationError({
          cause: Cause.fail("the reconstructed delivery relation was incoherent")
        })
      },
      { callsProgram: true, failure: new IntegrationFinalityRuntimeUnavailable() }
    ] as const

    for (const testCase of cases) {
      const returned = { _tag: "CoordinatorActivationReturned" as const, decision: unsettledResponsibility }
      const hints = { _tag: "CassetteOffersRunReactivationHints" as const, hints: ["TrackerNotification"] as const }
      const cursor = yield* makeStoryCursor([returned, hints])
      const activationCalls = yield* Ref.make(0)
      const activationExit = yield* (
        testCase.callsProgram ? Ref.update(activationCalls, (count) => count + 1) : Effect.void
      ).pipe(Effect.andThen(Effect.fail(testCase.failure)), Effect.exit)
      const observed = yield* settleCoordinatorActivationReturn(cursor, activationExit).pipe(Effect.flip)

      expect(observed, testCase.failure._tag).toBe(testCase.failure)
      expect(yield* Ref.get(activationCalls), testCase.failure._tag).toBe(testCase.callsProgram ? 1 : 0)
      expect(yield* cursor.storyPosition, testCase.failure._tag).toBe(0)
      expect(Option.isNone(yield* cursor.consumeRunReactivationHints), testCase.failure._tag).toBe(true)
    }
  })
)
