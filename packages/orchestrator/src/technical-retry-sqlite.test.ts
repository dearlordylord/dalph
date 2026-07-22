import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
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
  TechnicalRetryPolicy,
  TechnicalRetryPolicyCapturedEvent,
  technicalRetryPolicyRecordKey,
  TechnicalRetryScheduledEvent,
  technicalRetryScheduledRecordKey,
  TechnicalRetryScope
} from "./technical-retry.js"

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
    const policyEvent = TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 2 })
    const scheduledEvent = TechnicalRetryScheduledEvent.make({
      delayMillis: TechnicalRetryDelayMillis.make(100),
      notBefore: TechnicalRetryNotBefore.make(1_100),
      retryOrdinal,
      scope,
      version: 2
    })

    yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(runId, technicalRetryPolicyRecordKey(scope), policyEvent)
      yield* journal.append(runId, technicalRetryScheduledRecordKey(scope, retryOrdinal), scheduledEvent)
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

    const reopened = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      return yield* journal.read(runId)
    }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

    expect(reopened.map(({ event }) => event)).toEqual([policyEvent, scheduledEvent])
  }).pipe(Effect.provide(NodeServices.layer)))
