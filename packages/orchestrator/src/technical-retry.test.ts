import { it } from "@effect/vitest"
import { Effect, Fiber, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  JournalPosition,
  OperationId,
  ReviewerSessionId,
  RunId,
  SemanticReviewRound,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit,
  TechnicalRetryNotBefore,
  TechnicalRetryOrdinal
} from "./domain.js"
import { type JournalRecord, JournalStore, type JournalStoreService, memoryJournalStoreLayer } from "./journal-store.js"
import {
  retryTechnicalInvocation,
  TechnicalRetryDeferralSupersededEvent,
  technicalRetryDeferralSupersededRecordKey,
  TechnicalRetryHistoryContradiction,
  type TechnicalRetryJournalEvent,
  TechnicalRetryPolicy,
  TechnicalRetryPolicyCapturedEvent,
  technicalRetryPolicyRecordKey,
  TechnicalRetryRecoveryClockInvalid,
  TechnicalRetryScheduledEvent,
  technicalRetryScheduledRecordKey,
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

const appendPendingDeferral = Effect.fn("TechnicalRetryTest.appendPendingDeferral")(
  function*(notBefore: number = 100) {
    const journal = yield* JournalStore
    const retryOrdinal = TechnicalRetryOrdinal.make(1)
    yield* journal.append(
      runId,
      technicalRetryPolicyRecordKey(scope),
      TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 3 })
    )
    yield* journal.append(
      runId,
      technicalRetryScheduledRecordKey(scope, retryOrdinal),
      TechnicalRetryScheduledEvent.make({
        delayMillis: TechnicalRetryDelayMillis.make(100),
        notBefore: TechnicalRetryNotBefore.make(notBefore),
        retryOrdinal,
        scope,
        version: 3
      })
    )
  }
)

const changingRetryJournal = Effect.fn("TechnicalRetryTest.changingJournal")(
  function*(secondReadEvents: ReadonlyArray<TechnicalRetryJournalEvent>) {
    const reads = yield* Ref.make(0)
    const policyEvent = TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 3 })
    const records = (events: ReadonlyArray<TechnicalRetryJournalEvent>): ReadonlyArray<JournalRecord> =>
      events.map((event, index) => ({
        event,
        key: event._tag === "TechnicalRetryPolicyCaptured"
          ? technicalRetryPolicyRecordKey(event.scope)
          : event._tag === "TechnicalRetryScheduled"
          ? technicalRetryScheduledRecordKey(event.scope, event.retryOrdinal)
          : technicalRetryDeferralSupersededRecordKey(event.scope, event.retryOrdinal),
        position: JournalPosition.make(index + 1),
        runId
      }))
    const service: JournalStoreService = {
      append: () => Effect.die("changing journal must fail before append"),
      read: () =>
        Ref.updateAndGet(reads, (count) => count + 1).pipe(
          Effect.map((read) => records(read === 1 ? [policyEvent] : secondReadEvents))
        ),
      scan: () => Effect.succeed({ issues: [], runs: [] })
    }
    return service
  }
)

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

it.effect("waits only a future deferral's remaining virtual duration after interruption", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const initialInvocations = yield* Ref.make(0)
    const interrupted = yield* retryTechnicalInvocation(
      Ref.update(initialInvocations, (count) => count + 1).pipe(Effect.andThen(Effect.fail("retry" as const))),
      {
        isRetryable: (failure): failure is "retry" => failure === "retry",
        journal,
        policy,
        runId,
        scope
      }
    ).pipe(Effect.forkScoped)
    yield* TestClock.adjust(0)
    expect(yield* Ref.get(initialInvocations)).toBe(1)
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "TechnicalRetryPolicyCaptured",
      "TechnicalRetryScheduled"
    ])
    yield* Fiber.interrupt(interrupted)

    yield* TestClock.setTime(40)
    const invocations = yield* Ref.make(0)
    const recovered = yield* retryTechnicalInvocation(
      Ref.updateAndGet(invocations, (count) => count + 1).pipe(Effect.as("accepted" as const)),
      {
        isRetryable: (failure): failure is "retry" => failure === "retry",
        journal,
        policy,
        runId,
        scope
      }
    ).pipe(Effect.forkScoped)

    yield* TestClock.adjust("59 millis")
    expect(yield* Ref.get(invocations)).toBe(0)
    yield* TestClock.adjust("1 millis")
    expect(yield* Fiber.join(recovered)).toBe("accepted")
    expect(yield* Ref.get(invocations)).toBe(1)
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "TechnicalRetryPolicyCaptured",
      "TechnicalRetryScheduled",
      "TechnicalRetryDeferralSuperseded"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("makes an overdue deferral immediately eligible", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* appendPendingDeferral(100)
    yield* TestClock.setTime(101)
    const result = yield* retryTechnicalInvocation(Effect.succeed("accepted" as const), {
      isRetryable: (failure): failure is "retry" => failure === "retry",
      journal,
      runId,
      scope
    })

    expect(result).toBe("accepted")
    expect((yield* journal.read(runId)).at(-1)?.event._tag).toBe("TechnicalRetryDeferralSuperseded")
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("resumes a superseded exact retry without consuming another ordinal or semantic round", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* appendPendingDeferral(100)
    const retryOrdinal = TechnicalRetryOrdinal.make(1)
    yield* journal.append(
      runId,
      technicalRetryDeferralSupersededRecordKey(scope, retryOrdinal),
      TechnicalRetryDeferralSupersededEvent.make({ retryOrdinal, scope, version: 3 })
    )
    yield* TestClock.setTime(1_000)
    const result = yield* retryTechnicalInvocation(Effect.succeed("discovered" as const), {
      isRetryable: (failure): failure is "retry" => failure === "retry",
      journal,
      runId,
      scope
    })

    expect(result).toBe("discovered")
    const events = (yield* journal.read(runId)).map(({ event }) => event)
    expect(events.filter(({ _tag }) => _tag === "TechnicalRetryScheduled")).toHaveLength(1)
    expect(events.filter(({ _tag }) => _tag === "TechnicalRetryDeferralSuperseded")).toHaveLength(1)
    expect(events.every((event) =>
      event._tag !== "TechnicalRetryDeferralSuperseded"
      || event.scope.semanticRound === SemanticReviewRound.make(7)
    )).toBe(true)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("does not consume technical budget when the coordinator interrupts an invocation", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const entered = yield* Ref.make(false)
    const interrupted = yield* retryTechnicalInvocation(
      Ref.set(entered, true).pipe(Effect.andThen(Effect.never)),
      {
        isRetryable: (failure): failure is "retry" => failure === "retry",
        journal,
        policy,
        runId,
        scope
      }
    ).pipe(Effect.forkScoped)
    yield* TestClock.adjust(0)
    expect(yield* Ref.get(entered)).toBe(true)
    yield* Fiber.interrupt(interrupted)

    expect(
      yield* retryTechnicalInvocation(Effect.succeed("discovered" as const), {
        isRetryable: (failure): failure is "retry" => failure === "retry",
        journal,
        policy,
        runId,
        scope
      })
    ).toBe("discovered")
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "TechnicalRetryPolicyCaptured"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("fails typed when durable retry facts cross semantic review scopes", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const foreignScope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
      operationId: scope.operationId,
      reviewerSessionId: ReviewerSessionId.make("foreign-reviewer-session"),
      semanticRound: scope.semanticRound
    })
    yield* journal.append(
      runId,
      technicalRetryPolicyRecordKey(foreignScope),
      TechnicalRetryPolicyCapturedEvent.make({ policy, scope: foreignScope, version: 3 })
    )
    const failure = yield* retryTechnicalInvocation(Effect.die("crossed scope reached provider"), {
      isRetryable: (candidate): candidate is "retry" => candidate === "retry",
      journal,
      policy,
      runId,
      scope
    }).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TechnicalRetryHistoryContradiction)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("rejects an unrepresentable recovery clock before superseding a pending deferral", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* appendPendingDeferral(100)
    yield* TestClock.setTime(-1)
    const failure = yield* retryTechnicalInvocation(Effect.die("invalid clock reached provider"), {
      isRetryable: (candidate): candidate is "retry" => candidate === "retry",
      journal,
      policy,
      runId,
      scope
    }).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(TechnicalRetryRecoveryClockInvalid)
    expect((yield* journal.read(runId)).at(-1)?.event._tag).toBe("TechnicalRetryScheduled")
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("resumes the exact final retry without admitting another retry ordinal", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const finalPolicy = TechnicalRetryPolicy.make({
      initialDelayMillis: TechnicalRetryDelayMillis.make(100),
      limit: TechnicalRetryLimit.make(1),
      maximumDelayMillis: TechnicalRetryDelayMillis.make(100)
    })
    const retryOrdinal = TechnicalRetryOrdinal.make(1)
    yield* journal.append(
      runId,
      technicalRetryPolicyRecordKey(scope),
      TechnicalRetryPolicyCapturedEvent.make({ policy: finalPolicy, scope, version: 3 })
    )
    yield* journal.append(
      runId,
      technicalRetryScheduledRecordKey(scope, retryOrdinal),
      TechnicalRetryScheduledEvent.make({
        delayMillis: TechnicalRetryDelayMillis.make(100),
        notBefore: TechnicalRetryNotBefore.make(100),
        retryOrdinal,
        scope,
        version: 3
      })
    )
    yield* journal.append(
      runId,
      technicalRetryDeferralSupersededRecordKey(scope, retryOrdinal),
      TechnicalRetryDeferralSupersededEvent.make({ retryOrdinal, scope, version: 3 })
    )

    expect(
      yield* retryTechnicalInvocation(Effect.succeed("discovered" as const), {
        isRetryable: (candidate): candidate is "retry" => candidate === "retry",
        journal,
        policy: finalPolicy,
        runId,
        scope
      })
    ).toBe("discovered")
    expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "TechnicalRetryScheduled"))
      .toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("fails typed when journal facts change between policy capture and retry-state derivation", () =>
  Effect.gen(function*() {
    const foreignScope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
      ...scope,
      reviewerSessionId: ReviewerSessionId.make("changed-between-reads")
    })
    const crossedScope = TechnicalRetryScheduledEvent.make({
      delayMillis: TechnicalRetryDelayMillis.make(100),
      notBefore: TechnicalRetryNotBefore.make(100),
      retryOrdinal: TechnicalRetryOrdinal.make(1),
      scope: foreignScope,
      version: 3
    })
    const crossedFailure = yield* retryTechnicalInvocation(Effect.die("changed facts reached provider"), {
      isRetryable: (candidate): candidate is "retry" => candidate === "retry",
      journal: yield* changingRetryJournal([
        TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 3 }),
        crossedScope
      ]),
      policy,
      runId,
      scope
    }).pipe(Effect.flip)
    expect(crossedFailure).toBeInstanceOf(TechnicalRetryHistoryContradiction)

    const changedPolicy = TechnicalRetryPolicy.make({
      initialDelayMillis: TechnicalRetryDelayMillis.make(50),
      limit: TechnicalRetryLimit.make(1),
      maximumDelayMillis: TechnicalRetryDelayMillis.make(50)
    })
    const changedFailure = yield* retryTechnicalInvocation(Effect.die("changed policy reached provider"), {
      isRetryable: (candidate): candidate is "retry" => candidate === "retry",
      journal: yield* changingRetryJournal([
        TechnicalRetryPolicyCapturedEvent.make({ policy: changedPolicy, scope, version: 3 })
      ]),
      policy,
      runId,
      scope
    }).pipe(Effect.flip)
    expect(changedFailure).toBeInstanceOf(TechnicalRetryHistoryContradiction)
  }))

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
