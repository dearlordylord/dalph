import { Effect, Result, Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  OperationId,
  ReviewerSessionId,
  SemanticReviewRound,
  TechnicalRetryDelayMillis,
  TechnicalRetryLimit,
  TechnicalRetryNotBefore,
  TechnicalRetryOrdinal
} from "./domain.js"
import { technicalRetryEventKinds } from "./technical-retry-event-kind.js"
import {
  analyzeTechnicalRetryFacts,
  calculateTechnicalRetryNotBefore,
  TechnicalRetryDeferralSupersededEvent,
  TechnicalRetryPolicy,
  TechnicalRetryPolicyCapturedEvent,
  TechnicalRetryScheduledEvent,
  TechnicalRetryScope
} from "./technical-retry.js"

const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
  operationId: OperationId.make("property-review"),
  reviewerSessionId: ReviewerSessionId.make("property-reviewer"),
  semanticRound: SemanticReviewRound.make(1)
})

it("roundtrips every valid positive bounded retry policy through its persisted boundary", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 60_000 }),
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 0, max: 60_000 }),
      (initialDelayMillis, limit, extraDelayMillis) => {
        const encoded = {
          initialDelayMillis,
          limit,
          maximumDelayMillis: initialDelayMillis + extraDelayMillis
        }
        const decoded = Schema.decodeUnknownSync(TechnicalRetryPolicy)(encoded)
        expect(Schema.encodeUnknownSync(TechnicalRetryPolicy)(decoded)).toEqual(encoded)
      }
    ),
    { numRuns: 100 }
  )
})

it("rejects every generated maximum delay below its initial delay", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 60_000 }),
      fc.integer({ min: 1, max: 100 }),
      (initialDelayMillis, limit) => {
        expect(
          Schema.decodeUnknownResult(TechnicalRetryPolicy)({
            initialDelayMillis,
            limit,
            maximumDelayMillis: initialDelayMillis - 1
          })._tag
        ).toBe("Failure")
      }
    ),
    { numRuns: 100 }
  )
})

it("returns notBefore exactly when arbitrary clock-plus-delay arithmetic remains safe", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      (clockTime, delay) => {
        const result = Effect.runSync(Effect.result(
          calculateTechnicalRetryNotBefore(
            clockTime,
            TechnicalRetryDelayMillis.make(delay),
            scope
          )
        ))
        const expected = clockTime + delay
        if (Number.isSafeInteger(expected)) {
          expect(Result.isSuccess(result)).toBe(true)
          if (Result.isSuccess(result)) expect(result.success).toBe(expected)
        } else {
          expect(Result.isFailure(result)).toBe(true)
        }
      }
    ),
    { numRuns: 200 }
  )
})

it("roundtrips every generated deferral supersession without changing its semantic review scope", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 100 }),
      fc.integer({ min: 1, max: 100 }),
      (retryOrdinal, semanticRound) => {
        const event = TechnicalRetryDeferralSupersededEvent.make({
          retryOrdinal: TechnicalRetryOrdinal.make(retryOrdinal),
          scope: TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
            operationId: OperationId.make(`property-review-${semanticRound}`),
            reviewerSessionId: ReviewerSessionId.make(`property-reviewer-${semanticRound}`),
            semanticRound: SemanticReviewRound.make(semanticRound)
          }),
          version: 3
        })
        const encoded = Schema.encodeUnknownSync(TechnicalRetryDeferralSupersededEvent)(event)
        expect(Schema.decodeUnknownSync(TechnicalRetryDeferralSupersededEvent)(encoded)).toEqual(event)
      }
    ),
    { numRuns: 100 }
  )
})

it("accumulates independent scope, policy, ordinal, delay, and supersession contradictions", () => {
  const policy = TechnicalRetryPolicy.make({
    initialDelayMillis: TechnicalRetryDelayMillis.make(100),
    limit: TechnicalRetryLimit.make(2),
    maximumDelayMillis: TechnicalRetryDelayMillis.make(200)
  })
  const contradictoryPolicy = TechnicalRetryPolicy.make({
    initialDelayMillis: TechnicalRetryDelayMillis.make(50),
    limit: TechnicalRetryLimit.make(1),
    maximumDelayMillis: TechnicalRetryDelayMillis.make(50)
  })
  const foreignScope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId: scope.operationId,
    reviewerSessionId: ReviewerSessionId.make("foreign-property-reviewer"),
    semanticRound: scope.semanticRound
  })
  const facts = [
    TechnicalRetryDeferralSupersededEvent.make({
      retryOrdinal: TechnicalRetryOrdinal.make(2),
      scope,
      version: 3
    }),
    TechnicalRetryScheduledEvent.make({
      delayMillis: TechnicalRetryDelayMillis.make(100),
      notBefore: TechnicalRetryNotBefore.make(100),
      retryOrdinal: TechnicalRetryOrdinal.make(1),
      scope,
      version: 3
    }),
    TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 3 }),
    TechnicalRetryPolicyCapturedEvent.make({ policy, scope, version: 3 }),
    TechnicalRetryPolicyCapturedEvent.make({ policy: contradictoryPolicy, scope, version: 3 }),
    TechnicalRetryScheduledEvent.make({
      delayMillis: TechnicalRetryDelayMillis.make(1),
      notBefore: TechnicalRetryNotBefore.make(1),
      retryOrdinal: TechnicalRetryOrdinal.make(4),
      scope: foreignScope,
      version: 3
    }),
    TechnicalRetryDeferralSupersededEvent.make({
      retryOrdinal: TechnicalRetryOrdinal.make(3),
      scope: foreignScope,
      version: 3
    })
  ]

  const analysis = analyzeTechnicalRetryFacts(facts, scope)
  expect(new Set(facts.map(({ _tag }) => _tag))).toEqual(new Set(technicalRetryEventKinds))
  expect(analysis.issues.map(({ detail }) => detail)).toEqual(expect.arrayContaining([
    "technical retry supersession precedes its captured policy",
    "technical retry supersession has no exact pending deferral",
    "technical retry deferral precedes its captured policy",
    "duplicate technical retry policy",
    "contradictory technical retry policies",
    "technical retry facts bind a different active scope",
    "technical retry facts cross active scopes",
    "technical retry ordinal exceeds the captured limit",
    "technical retry schedule contradicts the captured delay policy",
    "a later deferral precedes supersession of the active deferral",
    "technical retry ordinals are not contiguous"
  ]))
})
