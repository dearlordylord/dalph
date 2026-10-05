import { expect, it } from "vitest"
import { classifyJsonRpcEnvelope } from "./codex-json-rpc-envelope.js"

// These wire-shape refusals need no provider process or scheduling budget.
it.each([
  [{ jsonrpc: "2.0" }, "must contain method or id"],
  [{ jsonrpc: "2.0", method: 1 }, "method is invalid"],
  [{ jsonrpc: "2.0", method: "notice", result: {} }, "notification cannot contain result or error"],
  [{ jsonrpc: "2.0", id: 1, method: "request", result: {} }, "server request cannot contain result or error"],
  [{ jsonrpc: "2.0", id: {}, method: "request" }, "server request id is invalid"],
  [{ jsonrpc: "2.0", id: 0, result: {} }, "response id is invalid"],
  [{ jsonrpc: "2.0", id: 1, result: {}, error: {} }, "response must contain exactly one result or error"],
  [{ jsonrpc: "2.0", id: 1 }, "response must contain exactly one result or error"],
  [{ jsonrpc: "2.0", id: 1, error: "invalid" }, "response error is invalid"]
] satisfies ReadonlyArray<readonly [Record<string, unknown>, string]>)(
  "rejects malformed envelope %j",
  (message, detail) => {
    expect(classifyJsonRpcEnvelope(message)).toMatchObject({
      _tag: "Malformed",
      detail: expect.stringContaining(detail)
    })
  }
)

it("keeps server requests distinct from matching outbound response IDs", () => {
  expect(classifyJsonRpcEnvelope({ jsonrpc: "2.0", id: 1, method: "request" })).toEqual({
    _tag: "ServerRequest",
    method: "request"
  })
  expect(classifyJsonRpcEnvelope({ id: 1, result: null })).toEqual({ _tag: "SuccessResponse", id: 1, result: null })
})
