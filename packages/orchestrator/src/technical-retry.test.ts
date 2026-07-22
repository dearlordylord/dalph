import { it } from "@effect/vitest"
import { Effect, Fiber, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  OperationId,
  ReviewerSessionId,
  RunId,
  SemanticReviewRound,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit
} from "./domain.js"
import { JournalStore, memoryJournalStoreLayer } from "./journal-store.js"
import {
  retryTechnicalInvocation,
  TechnicalRetryPolicy,
  TechnicalRetryScheduleOverflow,
  TechnicalRetryScope
} from "./technical-retry.js"

const runId = RunId.make("technical-retry-run")
const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
  operationId: OperationId.make("review-operation"),
  reviewerSessionId: ReviewerSessionId.make("reviewer-session"),
  semanticRound: SemanticReviewRound.make(7)
})
const policy = TechnicalRetryPolicy.make({
  initialDelayMillis: TechnicalRetryDelayMillis.make(100),
  limit: TechnicalRetryLimit.make(4),
  maximumDelayMillis: TechnicalRetryDelayMillis.make(250)
})

it.effect("durably schedules capped exponential retries without advancing the semantic round", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const attempts = yield* Ref.make(0)
    const invocation = Ref.updateAndGet(attempts, (current) => current + 1).pipe(
      Effect.flatMap((attempt) => attempt < 5 ? Effect.fail("retry" as const) : Effect.succeed("accepted" as const))
    )
    const fiber = yield* retryTechnicalInvocation(invocation, {
      isRetryable: (failure): failure is "retry" => failure === "retry",
      journal,
      policy,
      runId,
      scope
    }).pipe(Effect.forkScoped)

    yield* TestClock.adjust("100 millis")
    yield* TestClock.adjust("200 millis")
    yield* TestClock.adjust("250 millis")
    yield* TestClock.adjust("250 millis")

    expect(yield* Fiber.join(fiber)).toBe("accepted")
    expect(yield* Ref.get(attempts)).toBe(5)
    const events = (yield* journal.read(runId)).map(({ event }) => event)
    const captured = events.filter(({ _tag }) => _tag === "TechnicalRetryPolicyCaptured")
    const scheduled = events.filter(({ _tag }) => _tag === "TechnicalRetryScheduled")
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ policy, scope })
    expect(scheduled.map((event) => event._tag === "TechnicalRetryScheduled" && event.delayMillis)).toEqual([
      100,
      200,
      250,
      250
    ])
    expect(scheduled.map((event) => event._tag === "TechnicalRetryScheduled" && event.notBefore)).toEqual([
      100,
      300,
      550,
      800
    ])
    expect(scheduled.every((event) =>
      event._tag === "TechnicalRetryScheduled"
      && event.scope.semanticRound === SemanticReviewRound.make(7)
    )).toBe(true)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("stops after the captured positive retry limit", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const attempts = yield* Ref.make(0)
    const limited = TechnicalRetryPolicy.make({
      initialDelayMillis: TechnicalRetryDelayMillis.make(10),
      limit: TechnicalRetryLimit.make(2),
      maximumDelayMillis: TechnicalRetryDelayMillis.make(20)
    })
    const fiber = yield* retryTechnicalInvocation(
      Ref.update(attempts, (current) => current + 1).pipe(Effect.andThen(Effect.fail("retry" as const))),
      {
        isRetryable: (failure): failure is "retry" => failure === "retry",
        journal,
        policy: limited,
        runId,
        scope
      }
    ).pipe(Effect.flip, Effect.forkScoped)

    yield* TestClock.adjust("30 millis")

    expect(yield* Fiber.join(fiber)).toBe("retry")
    expect(yield* Ref.get(attempts)).toBe(3)
    expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "TechnicalRetryScheduled"))
      .toHaveLength(2)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("does not retry a failure outside the active technical scope", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const failure = yield* retryTechnicalInvocation(Effect.fail("ownership-lost" as const), {
      isRetryable: (candidate): candidate is "retry" => candidate === "retry",
      journal,
      policy,
      runId,
      scope
    }).pipe(Effect.flip)

    expect(failure).toBe("ownership-lost")
    expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "TechnicalRetryScheduled"))
      .toHaveLength(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("fails typed before journaling or invoking a retry when notBefore exceeds the safe integer range", () =>
  Effect.gen(function*() {
    yield* TestClock.setTime(1)
    const journal = yield* JournalStore
    const attempts = yield* Ref.make(0)
    const maximumDelay = TechnicalRetryPolicy.make({
      initialDelayMillis: TechnicalRetryDelayMillis.make(Number.MAX_SAFE_INTEGER),
      limit: TechnicalRetryLimit.make(1),
      maximumDelayMillis: TechnicalRetryDelayMillis.make(Number.MAX_SAFE_INTEGER)
    })
    const failure = yield* retryTechnicalInvocation(
      Ref.update(attempts, (current) => current + 1).pipe(Effect.andThen(Effect.fail("retry" as const))),
      {
        isRetryable: (candidate): candidate is "retry" => candidate === "retry",
        journal,
        policy: maximumDelay,
        runId,
        scope
      }
    ).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TechnicalRetryScheduleOverflow)
    expect(failure).toMatchObject({ clockTime: "1", delayMillis: Number.MAX_SAFE_INTEGER, scope })
    expect(yield* Ref.get(attempts)).toBe(1)
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "TechnicalRetryPolicyCaptured"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("journals the largest safe notBefore before waiting without invoking the retry", () =>
  Effect.gen(function*() {
    yield* TestClock.setTime(1)
    const journal = yield* JournalStore
    const attempts = yield* Ref.make(0)
    const largestSafeDelay = TechnicalRetryDelayMillis.make(Number.MAX_SAFE_INTEGER - 1)
    const boundaryPolicy = TechnicalRetryPolicy.make({
      initialDelayMillis: largestSafeDelay,
      limit: TechnicalRetryLimit.make(1),
      maximumDelayMillis: largestSafeDelay
    })
    const fiber = yield* retryTechnicalInvocation(
      Ref.update(attempts, (current) => current + 1).pipe(Effect.andThen(Effect.fail("retry" as const))),
      {
        isRetryable: (candidate): candidate is "retry" => candidate === "retry",
        journal,
        policy: boundaryPolicy,
        runId,
        scope
      }
    ).pipe(Effect.forkScoped)

    yield* TestClock.adjust(0)

    const scheduled = (yield* journal.read(runId)).find(({ event }) => event._tag === "TechnicalRetryScheduled")
    expect(scheduled?.event).toMatchObject({
      delayMillis: Number.MAX_SAFE_INTEGER - 1,
      notBefore: Number.MAX_SAFE_INTEGER
    })
    expect(yield* Ref.get(attempts)).toBe(1)
    yield* Fiber.interrupt(fiber)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it("rejects non-positive and contradictory policy values", () => {
  expect(
    Schema.decodeUnknownResult(TechnicalRetryPolicy)({
      initialDelayMillis: 100,
      limit: 0,
      maximumDelayMillis: 200
    })._tag
  ).toBe("Failure")
  expect(
    Schema.decodeUnknownResult(TechnicalRetryPolicy)({
      initialDelayMillis: 200,
      limit: 1,
      maximumDelayMillis: 100
    })._tag
  ).toBe("Failure")
})
