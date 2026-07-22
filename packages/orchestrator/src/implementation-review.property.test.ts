import * as fc from "fast-check"
import { expect, it } from "vitest"
import { ReviewFindingId } from "./domain.js"
import { extendReviewFindingHistory, ImplementationReviewDisposition, ReviewFinding } from "./implementation-review.js"

const findingArbitrary = fc.record({
  findingId: fc.string({ minLength: 1, maxLength: 32 }).map(ReviewFindingId.make),
  text: fc.string({ minLength: 1, maxLength: 256 })
}).map(ReviewFinding.make)

it("retains the exact unresolved history while appending each findings round", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(findingArbitrary, { maxLength: 20, selector: ({ findingId }) => findingId }),
      fc.uniqueArray(findingArbitrary, {
        minLength: 1,
        maxLength: 20,
        selector: ({ findingId }) => findingId
      }),
      (history, current) => {
        const extended = extendReviewFindingHistory(
          history,
          ImplementationReviewDisposition.cases.Findings.make({ findings: current })
        )
        expect(extended.slice(0, history.length)).toEqual(history)
        expect(extended.slice(history.length)).toEqual(current)
        expect(extended).toHaveLength(history.length + current.length)
      }
    ),
    { numRuns: 100 }
  )
})

it("acceptance preserves finding history without sharing its mutable array", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(findingArbitrary, { maxLength: 20, selector: ({ findingId }) => findingId }),
      (history) => {
        const retained = extendReviewFindingHistory(
          history,
          ImplementationReviewDisposition.cases.Accepted.make({})
        )
        expect(retained).toEqual(history)
        expect(retained).not.toBe(history)
      }
    ),
    { numRuns: 100 }
  )
})
