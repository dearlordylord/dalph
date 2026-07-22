import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Fiber, FileSystem, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  JournalDatabaseLocator,
  OperationId,
  ReviewerSessionId,
  RunId,
  SemanticReviewRound,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit,
  TechnicalRetryNotBefore,
  TechnicalRetryOrdinal
} from "./domain.js"
import { JournalStore } from "./journal-store.js"
import { sqliteJournalStoreLayer } from "./sqlite-journal-store.js"
import {
  retryTechnicalInvocation,
  TechnicalRetryDeferralSupersededEvent,
  technicalRetryDeferralSupersededRecordKey,
  TechnicalRetryPolicy,
  TechnicalRetryPolicyCapturedEvent,
  technicalRetryPolicyRecordKey,
  TechnicalRetryScheduledEvent,
  technicalRetryScheduledRecordKey,
  TechnicalRetryScope
} from "./technical-retry.js"

const makeFixture = Effect.fn("TechnicalRetrySqliteTest.makeFixture")(function*(identity: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-technical-retry-" })
  const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
  const runId = RunId.make(`sqlite-technical-retry-${identity}`)
  const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId: OperationId.make(`sqlite-review-${identity}`),
    reviewerSessionId: ReviewerSessionId.make(`sqlite-reviewer-${identity}`),
    semanticRound: SemanticReviewRound.make(2)
  })
  const policy = TechnicalRetryPolicy.make({
    initialDelayMillis: TechnicalRetryDelayMillis.make(100),
    limit: TechnicalRetryLimit.make(3),
    maximumDelayMillis: TechnicalRetryDelayMillis.make(500)
  })
  const retryOrdinal = TechnicalRetryOrdinal.make(1)
  return { filename, policy, retryOrdinal, runId, scope }
})

const persistPendingDeferral = Effect.fn("TechnicalRetrySqliteTest.persistPendingDeferral")(
  function*(fixture: Effect.Success<ReturnType<typeof makeFixture>>, notBefore: number) {
    const policyEvent = TechnicalRetryPolicyCapturedEvent.make({
      policy: fixture.policy,
      scope: fixture.scope,
      version: 3
    })
    const scheduledEvent = TechnicalRetryScheduledEvent.make({
      delayMillis: TechnicalRetryDelayMillis.make(100),
      notBefore: TechnicalRetryNotBefore.make(notBefore),
      retryOrdinal: fixture.retryOrdinal,
      scope: fixture.scope,
      version: 3
    })
    yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(fixture.runId, technicalRetryPolicyRecordKey(fixture.scope), policyEvent)
      yield* journal.append(
        fixture.runId,
        technicalRetryScheduledRecordKey(fixture.scope, fixture.retryOrdinal),
        scheduledEvent
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename: fixture.filename })))
    return { policyEvent, scheduledEvent }
  }
)

it.effect("reopens durable technical policy and notBefore facts from SQLite", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-technical-retry-" })
    const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
    const runId = RunId.make("sqlite-technical-retry")
    const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
      operationId: OperationId.make("sqlite-review"),
      reviewerSessionId: ReviewerSessionId.make("sqlite-reviewer-session"),
      semanticRound: SemanticReviewRound.make(2)
    })
    const policy = TechnicalRetryPolicy.make({
      initialDelayMillis: TechnicalRetryDelayMillis.make(100),
      limit: TechnicalRetryLimit.make(3),
      maximumDelayMillis: TechnicalRetryDelayMillis.make(500)
    })
    const retryOrdinal = TechnicalRetryOrdinal.make(1)
    const policyEvent = TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 3 })
    const scheduledEvent = TechnicalRetryScheduledEvent.make({
      delayMillis: TechnicalRetryDelayMillis.make(100),
      notBefore: TechnicalRetryNotBefore.make(1_100),
      retryOrdinal,
      scope,
      version: 3
    })
    const supersededEvent = TechnicalRetryDeferralSupersededEvent.make({ retryOrdinal, scope, version: 3 })

    yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(runId, technicalRetryPolicyRecordKey(scope), policyEvent)
      yield* journal.append(runId, technicalRetryScheduledRecordKey(scope, retryOrdinal), scheduledEvent)
      yield* journal.append(
        runId,
        technicalRetryDeferralSupersededRecordKey(scope, retryOrdinal),
        supersededEvent
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

    const reopened = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      return yield* journal.read(runId)
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

    expect(reopened.map(({ event }) => event)).toEqual([policyEvent, scheduledEvent, supersededEvent])
  }).pipe(Effect.provide(NodeServices.layer)))

it.effect("waits only the remaining duration after closing and reopening SQLite", () =>
  Effect.gen(function*() {
    const fixture = yield* makeFixture("remaining")
    const persisted = yield* persistPendingDeferral(fixture, 100)
    yield* TestClock.setTime(40)
    const invocations = yield* Ref.make(0)
    const recovered = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      return yield* retryTechnicalInvocation(
        Effect.gen(function*() {
          expect((yield* journal.read(fixture.runId).pipe(Effect.orDie)).at(-1)?.event._tag)
            .toBe("TechnicalRetryDeferralSuperseded")
          yield* Ref.update(invocations, (count) => count + 1)
          return "accepted" as const
        }),
        {
          isRetryable: (failure): failure is "retry" => failure === "retry",
          journal,
          policy: fixture.policy,
          runId: fixture.runId,
          scope: fixture.scope
        }
      )
    }).pipe(
      Effect.provide(sqliteJournalStoreLayer({ filename: fixture.filename })),
      Effect.forkScoped
    )

    yield* TestClock.adjust("59 millis")
    expect(yield* Ref.get(invocations)).toBe(0)
    yield* TestClock.adjust("1 millis")
    expect(yield* Fiber.join(recovered)).toBe("accepted")

    const reopened = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      expect(
        (yield* journal.append(
          fixture.runId,
          technicalRetryPolicyRecordKey(fixture.scope),
          persisted.policyEvent
        )).position
      ).toBe(1)
      expect(
        (yield* journal.append(
          fixture.runId,
          technicalRetryScheduledRecordKey(fixture.scope, fixture.retryOrdinal),
          persisted.scheduledEvent
        )).position
      ).toBe(2)
      return yield* journal.read(fixture.runId)
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename: fixture.filename })))
    expect(reopened.filter(({ event }) => event._tag === "TechnicalRetryScheduled")).toHaveLength(1)
    expect(reopened.filter(({ event }) => event._tag === "TechnicalRetryDeferralSuperseded")).toHaveLength(1)
  }).pipe(Effect.provide(NodeServices.layer)))

it.effect("makes an overdue SQLite deferral immediately eligible after reopen", () =>
  Effect.gen(function*() {
    const fixture = yield* makeFixture("overdue")
    yield* persistPendingDeferral(fixture, 100)
    yield* TestClock.setTime(101)
    const result = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      return yield* retryTechnicalInvocation(
        Effect.gen(function*() {
          expect((yield* journal.read(fixture.runId).pipe(Effect.orDie)).at(-1)?.event._tag)
            .toBe("TechnicalRetryDeferralSuperseded")
          return "accepted" as const
        }),
        {
          isRetryable: (failure): failure is "retry" => failure === "retry",
          journal,
          policy: fixture.policy,
          runId: fixture.runId,
          scope: fixture.scope
        }
      )
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename: fixture.filename })))
    expect(result).toBe("accepted")
  }).pipe(Effect.provide(NodeServices.layer)))
