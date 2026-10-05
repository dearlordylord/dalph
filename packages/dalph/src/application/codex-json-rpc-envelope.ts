type JsonObject = Record<string, unknown>
const isJsonObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null

type JsonRpcEnvelope =
  | { readonly _tag: "ServerRequest"; readonly method: string }
  | { readonly _tag: "Notification"; readonly method: string }
  | { readonly _tag: "SuccessResponse"; readonly id: number; readonly result: unknown }
  | { readonly _tag: "ErrorResponse"; readonly id: number; readonly error: JsonObject }
  | { readonly _tag: "Malformed"; readonly detail: string }

const hasJsonRpcField = (message: JsonObject, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(message, field)

const isJsonRpcId = (value: unknown): boolean =>
  value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))

/**
 * Routes a decoded JSON-RPC object by its wire shape before touching pending
 * outbound requests. An ID-bearing method is provider work for the client,
 * not a response to one of Dalph's requests.
 */
export const classifyJsonRpcEnvelope = (message: JsonObject): JsonRpcEnvelope => {
  // Codex app-server emits JSON-RPC-shaped messages without the optional
  // version member; reject an explicit contradictory version but accept the
  // provider's versionless response/notification envelopes.
  if (hasJsonRpcField(message, "jsonrpc") && message["jsonrpc"] !== "2.0") {
    return { _tag: "Malformed", detail: "JSON-RPC envelope version is invalid" }
  }
  const hasMethod = hasJsonRpcField(message, "method")
  const hasId = hasJsonRpcField(message, "id")
  const hasResult = hasJsonRpcField(message, "result")
  const hasError = hasJsonRpcField(message, "error")
  if (hasMethod) {
    const method = message["method"]
    if (typeof method !== "string") {
      return { _tag: "Malformed", detail: "JSON-RPC envelope method is invalid" }
    }
    if (hasResult || hasError) {
      return {
        _tag: "Malformed",
        detail: hasId
          ? "JSON-RPC server request cannot contain result or error"
          : "JSON-RPC notification cannot contain result or error"
      }
    }
    if (hasId && !isJsonRpcId(message["id"])) {
      return { _tag: "Malformed", detail: "JSON-RPC server request id is invalid" }
    }
    return hasId ? { _tag: "ServerRequest", method } : { _tag: "Notification", method }
  }
  if (!hasId) {
    return { _tag: "Malformed", detail: "JSON-RPC envelope must contain method or id" }
  }
  const id = message["id"]
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
    return { _tag: "Malformed", detail: "JSON-RPC response id is invalid" }
  }
  if (hasResult === hasError) {
    return { _tag: "Malformed", detail: "JSON-RPC response must contain exactly one result or error" }
  }
  const error = message["error"]
  if (hasError && !isJsonObject(error)) {
    return { _tag: "Malformed", detail: "JSON-RPC response error is invalid" }
  }
  return hasResult
    ? { _tag: "SuccessResponse", id, result: message["result"] }
    : isJsonObject(error)
      ? { _tag: "ErrorResponse", id, error }
      : { _tag: "Malformed", detail: "JSON-RPC response error is invalid" }
}
