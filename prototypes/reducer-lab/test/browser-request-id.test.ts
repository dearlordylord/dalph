import { expect, test } from "vitest"
import { browserRequestId } from "../../../packages/dalph/browser/request-id.ts"

test("creates request IDs when an HTTP origin exposes getRandomValues without randomUUID", () => {
  const crypto = { getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
    if (!(array instanceof Uint8Array)) throw new Error("Expected UUID bytes")
    array.fill(255)
    return array
  } }
  expect(browserRequestId(crypto)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
})
