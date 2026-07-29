import { expect, it } from "vitest"
import { encodeTaskRevisionFingerprint } from "./task-revision-fingerprint.js"

it("encodes normalized task objects as opaque revision fingerprints", () => {
  const normalizedTask = '{"id":"task-1"}'
  expect(encodeTaskRevisionFingerprint(normalizedTask)).toMatch(/^tr1\./)
})
