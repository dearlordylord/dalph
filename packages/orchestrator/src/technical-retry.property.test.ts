import { Effect, Result, Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { OperationId, ReviewerSessionId, SemanticReviewRound, TechnicalRetryDelayMillis } from "./domain.js"
import { calculateTechnicalRetryNotBefore, TechnicalRetryPolicy, TechnicalRetryScope } from "./technical-retry.js"

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
