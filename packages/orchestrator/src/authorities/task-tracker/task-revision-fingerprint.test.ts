import { expect, it } from "vitest"
import { encodeTaskRevisionFingerprint } from "@dalph/contracts"

it("encodes normalized task objects as opaque revision fingerprints", () => {
  const normalizedTask = '{"id":"task-1"}'
  expect(encodeTaskRevisionFingerprint(normalizedTask)).toMatch(/^tr1\./)
})
