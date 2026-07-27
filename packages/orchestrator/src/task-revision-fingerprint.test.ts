import { expect, it } from "vitest"
import { encodeTaskRevisionFingerprint, upcastLegacyTaskRevisionFingerprint } from "./task-revision-fingerprint.js"

it("leaves malformed legacy JSON unchanged", () => {
  expect(upcastLegacyTaskRevisionFingerprint("{malformed")).toBe("{malformed")
})

it("leaves non-string legacy values unchanged", () => {
  expect(upcastLegacyTaskRevisionFingerprint(1)).toBe(1)
})

it("upcasts legacy normalized task objects", () => {
  const normalizedTask = "{\"id\":\"task-1\"}"
  expect(upcastLegacyTaskRevisionFingerprint(normalizedTask)).toBe(
    encodeTaskRevisionFingerprint(normalizedTask)
  )
})
