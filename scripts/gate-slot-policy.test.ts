import { describe, expect, it } from "vitest"
import { defaultGateSlotCount, gateSlots, resolveGateSlotCount } from "./gate-slot-policy.mjs"

describe("gate slot policy", () => {
  it("admits two heavy gates at once by default", () => {
    expect(resolveGateSlotCount({ configured: undefined })).toBe(defaultGateSlotCount)
    expect(resolveGateSlotCount({ configured: "" })).toBe(defaultGateSlotCount)
    expect(resolveGateSlotCount({ configured: "4" })).toBe(4)
  })

  it("rejects a slot count that is not a positive integer", () => {
    expect(() => resolveGateSlotCount({ configured: "0" })).toThrow(/positive integer/)
    expect(() => resolveGateSlotCount({ configured: "two" })).toThrow(/positive integer/)
    expect(() => resolveGateSlotCount({ configured: "2.5" })).toThrow(/positive integer/)
  })

  it("names one lock and one durable fence record per slot inside the shared lock directory", () => {
    expect(gateSlots({ lockDirectory: "/repository/.git", slotCount: 2 })).toEqual([
      {
        fence: "/repository/.git/dalph-gate-slot-1.fence.json",
        lock: "/repository/.git/dalph-gate-slot-1.lock",
        ordinal: 1
      },
      {
        fence: "/repository/.git/dalph-gate-slot-2.fence.json",
        lock: "/repository/.git/dalph-gate-slot-2.lock",
        ordinal: 2
      }
    ])
  })
})
