import { Duration, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  ApplicationExitDrainDuration,
  applicationExitDrainDuration,
  CoordinatorOwnershipObservationInterval,
  coordinatorOwnershipObservationInterval
} from "./control-plane-budgets.js"

describe("local control-plane timing values", () => {
  it("keeps the ownership observation interval and Exit drain finite and positive", () => {
    expect(Duration.toMillis(coordinatorOwnershipObservationInterval)).toBe(1_000)
    expect(Duration.toMillis(applicationExitDrainDuration)).toBe(5_000)
    expect(Duration.isFinite(coordinatorOwnershipObservationInterval)).toBe(true)
    expect(Duration.isFinite(applicationExitDrainDuration)).toBe(true)
    expect(Duration.isPositive(coordinatorOwnershipObservationInterval)).toBe(true)
    expect(Duration.isPositive(applicationExitDrainDuration)).toBe(true)
  })

  it("decodes only finite positive durations at the local timing boundary", () => {
    expect(Duration.toMillis(Schema.decodeUnknownSync(CoordinatorOwnershipObservationInterval)("1 second"))).toBe(1_000)
    expect(Duration.toMillis(Schema.decodeUnknownSync(ApplicationExitDrainDuration)("5 seconds"))).toBe(5_000)
    expect(() => Schema.decodeUnknownSync(CoordinatorOwnershipObservationInterval)("0 seconds")).toThrow()
    expect(() => Schema.decodeUnknownSync(ApplicationExitDrainDuration)("Infinity")).toThrow()
  })
})
