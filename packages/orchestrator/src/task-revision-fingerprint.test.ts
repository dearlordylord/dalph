import { expect, it } from "vitest"
import { upcastLegacyTaskRevisionFingerprint } from "./task-revision-fingerprint.js"

it("leaves malformed legacy JSON unchanged", () => {
  expect(upcastLegacyTaskRevisionFingerprint("{malformed")).toBe("{malformed")
})
