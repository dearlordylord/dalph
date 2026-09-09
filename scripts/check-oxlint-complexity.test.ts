import { describe, expect, it } from "vitest"
import { prunedSuppressionRegistry, suppressionPolicyViolations } from "./check-oxlint-complexity.mjs"

const entry = (count: number, justification?: string) => ({
  complexity: { count, ...(justification === undefined ? {} : { justification }) }
})

describe("complexity suppression policy", () => {
  it("rejects a new or increased count without a non-blank justification", () => {
    const baseline = { "increased.ts": entry(1) }
    expect(
      suppressionPolicyViolations({ baseline, current: { "increased.ts": entry(2), "new.ts": entry(1, "  ") } })
    ).toEqual([
      "increased.ts: new or increased complexity count requires a non-blank justification",
      "new.ts: new or increased complexity count requires a non-blank justification"
    ])
  })

  it("allows unchanged legacy counts and justified increases", () => {
    expect(
      suppressionPolicyViolations({
        baseline: { "legacy.ts": entry(2), "raised.ts": entry(1) },
        current: { "legacy.ts": entry(2), "raised.ts": entry(2, "One cohesive chronological proof.") }
      })
    ).toEqual([])
  })

  it("preserves reviewed justifications while pruning retained entries", () => {
    const current = {
      "removed.ts": entry(1, "No longer relevant."),
      "retained.ts": entry(3, "One cohesive chronological proof.")
    }
    expect(prunedSuppressionRegistry({ counts: new Map([["retained.ts", 2]]), current })).toEqual({
      "retained.ts": entry(2, "One cohesive chronological proof.")
    })
  })
})
