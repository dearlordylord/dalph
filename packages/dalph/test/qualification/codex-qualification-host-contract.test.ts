import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { CodexQualificationHostEvent } from "../../bin/codex-qualification-host-contract.js"

const decode = Schema.decodeUnknownSync(CodexQualificationHostEvent)
const journal = { event: "begin-journal", beginIntents: 1, beginOrdinal: 1, beginResponses: 1 }

describe("qualification host journal evidence boundary", () => {
  it("decodes complete journal evidence, including zero observed counts", () => {
    expect(decode(journal)).toEqual(journal)
    const emptyCounts = { ...journal, beginIntents: 0, beginResponses: 0 }
    expect(decode(emptyCounts)).toEqual(emptyCounts)
    expect(decode({ event: "closed" })).toEqual({ event: "closed" })
  })

  it.each(["beginIntents", "beginOrdinal", "beginResponses"])("rejects missing %s", (field) => {
    expect(() => decode(Object.fromEntries(Object.entries(journal).filter(([key]) => key !== field)))).toThrow()
  })

  it.each([
    { beginIntents: -1 },
    { beginIntents: 0.5 },
    { beginResponses: -1 },
    { beginResponses: 0.5 },
    { beginOrdinal: 0 },
    { beginOrdinal: -1 },
    { beginOrdinal: 1.5 },
    { beginOrdinal: "1" }
  ])("rejects invalid journal evidence %j", (invalid) => {
    expect(() => decode({ ...journal, ...invalid })).toThrow()
  })

  it.each(["beginIntents", "beginOrdinal", "beginResponses"])("rejects %s on unrelated events", (field) => {
    expect(() => decode({ event: "closed", [field]: 1 })).toThrow()
    expect(() => decode({ event: "ready", pid: 123, [field]: 1 })).toThrow()
  })
})
