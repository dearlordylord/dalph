/* eslint-disable import/no-nodejs-modules -- The MCP stdio adapter owns only its process-local byte streams. */
import process from "node:process"
import { RunId } from "@dalph/contracts"
import { Effect, FiberMap, Schema, Stream } from "effect"
import {
  type LocalHostAddress,
  RequestId,
  RunningHostEnvelope,
  type RunningHostDescriptor,
  type RunningHostError,
  type RunningHostRequest,
  runningHostFailureEnvelope,
  runningHostLimits
} from "./running-host-contract.js"
import { callRunningHost, readRunningHostDescriptor } from "./running-host-client.js"
import { runningHostNodeOutput } from "./running-host-output.js"

const rpcParseError = -32700
const rpcInvalidRequest = -32600
const rpcMethodNotFound = -32601
const rpcInvalidParams = -32602
const rpcInternalError = -32603
const rpcResourceNotFound = -32002
const lineFeedByte = 10

/** Injected byte transport is owned by the client process, never by the delivery host. */
export interface RunningHostMcpPorts {
  readonly input: Stream.Stream<Uint8Array, RunningHostError>
  readonly write: (line: string) => Effect.Effect<void, RunningHostError>
}
export interface RunningHostMcpClient {
  readonly descriptor: (address: LocalHostAddress) => Effect.Effect<RunningHostDescriptor, RunningHostError>
  readonly call: (
    address: LocalHostAddress,
    runId: RunId,
    operation: RunningHostRequest["operation"]
  ) => Effect.Effect<RunningHostEnvelope>
}
const transportFailure = (reason: string): RunningHostError => ({ _tag: "TransportFailed", phase: "Write", reason })
const stdioPorts: RunningHostMcpPorts = {
  input: Stream.fromAsyncIterable(process.stdin, () => ({
    _tag: "TransportFailed",
    phase: "Response",
    reason: "MCP input stream failed."
  })),
  write: (line) =>
    Effect.try({
      try: () => runningHostNodeOutput("stdout"),
      catch: () => transportFailure("MCP output descriptor is unavailable.")
    }).pipe(
      Effect.flatMap((destination) =>
        Effect.callback<void, RunningHostError>((resume) => {
          let settled = false
          const onError = () => {
            settled = true
            destination.destroy()
            resume(Effect.fail(transportFailure("MCP output stream failed.")))
          }
          destination.once("error", onError)
          destination.write(line, (error) => {
            settled = true
            destination.removeListener("error", onError)
            if (error) destination.destroy()
            resume(error ? Effect.fail(transportFailure("MCP output stream failed.")) : Effect.void)
          })
          return Effect.sync(() => {
            // A timed-out Effect must also cancel its queued Node write. Otherwise
            // pipe backpressure retains the client process after the deadline.
            if (!settled) destination.destroy()
            destination.removeListener("error", onError)
          })
        })
      )
    )
}
const Message = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite, Schema.Null])),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown)
})
const Initialize = Schema.Struct({
  protocolVersion: Schema.String,
  capabilities: Schema.Unknown,
  clientInfo: Schema.Struct({ name: Schema.String, version: Schema.String, title: Schema.optionalKey(Schema.String) })
})
const ToolArguments = Schema.Struct({ runId: RunId })
const ToolCall = Schema.Struct({ name: Schema.String, arguments: ToolArguments })
const ResourceRead = Schema.Struct({ uri: Schema.String })
const document = Schema.toJsonSchemaDocument(RunningHostEnvelope, { additionalProperties: false })
const outputSchema = { ...document.schema, type: "object", $defs: document.definitions }
const inputSchema = {
  type: "object",
  properties: { runId: { type: "string", minLength: 1 } },
  required: ["runId"],
  additionalProperties: false
}
const tools = [
  {
    name: "dalph_read_snapshot",
    description: "Read one coherent passive publication from the selected Run.",
    inputSchema,
    outputSchema
  },
  {
    name: "dalph_read_run_control",
    description: "Read accepted Run control and separately labelled termination evidence.",
    inputSchema,
    outputSchema
  },
  {
    name: "dalph_start_work",
    description: "Submit an ordinary owner hint; preserves Pause and proves no activation.",
    inputSchema,
    outputSchema
  },
  {
    name: "dalph_unpause",
    description: "Explicitly apply Run Unpause and await its owner callback; never automatically replay.",
    inputSchema,
    outputSchema
  }
]

/** Implements the pinned read and wake/Unpause MCP surface. */
export const runRunningHostMcp = Effect.fn("RunningHost.runMcp")(
  function* (
    address: LocalHostAddress,
    runId: RunId,
    ports: RunningHostMcpPorts = stdioPorts,
    client: RunningHostMcpClient = { descriptor: readRunningHostDescriptor, call: callRunningHost }
  ) {
    const commands = yield* FiberMap.make<string | number | null, void, RunningHostError>()
    let initialized = false
    let ready = false
    let sequence = 0
    let writeSequence = 0
    const base = `dalph://runs/${encodeURIComponent(runId)}`
    const resources = [
      { uri: "dalph://host/descriptor", name: "Dalph host descriptor", mimeType: "application/json" },
      { uri: `${base}/snapshot`, name: "Dalph current snapshot", mimeType: "application/json" },
      { uri: `${base}/control`, name: "Dalph Run control", mimeType: "application/json" }
    ]
    const write = (message: unknown) =>
      Effect.gen(function* () {
        writeSequence += 1
        const writeRequestId = RequestId.make(`mcp-write-${writeSequence}`)
        const line = `${JSON.stringify(message)}\n`
        const bytes = new TextEncoder().encode(line).byteLength
        if (bytes > runningHostLimits.frameBytes)
          return yield* Effect.fail<RunningHostError>({
            _tag: "FrameTooLarge",
            direction: "Outgoing",
            maximumBytes: runningHostLimits.frameBytes,
            measuredBytes: bytes
          })
        yield* ports
          .write(line)
          .pipe(
            Effect.timeoutOrElse({
              duration: runningHostLimits.writeDeadlineMillis,
              orElse: () =>
                Effect.fail<RunningHostError>({
                  _tag: "WriteTimedOut",
                  subject: { _tag: "Request", requestId: writeRequestId },
                  deadlineMillis: runningHostLimits.writeDeadlineMillis
                })
            })
          )
      })
    const handle = (line: string) =>
      Effect.gen(function* () {
        const parsed = yield* Effect.try({ try: (): unknown => JSON.parse(line), catch: () => "InvalidJson" }).pipe(
          Effect.result
        )
        if (parsed._tag === "Failure")
          return yield* write({ jsonrpc: "2.0", id: null, error: { code: rpcParseError, message: "Invalid JSON" } })
        const decoded = yield* Schema.decodeUnknownEffect(Message)(parsed.success, { onExcessProperty: "error" }).pipe(
          Effect.result
        )
        if (decoded._tag === "Failure")
          return yield* write({
            jsonrpc: "2.0",
            id: null,
            error: { code: rpcInvalidRequest, message: "Invalid request" }
          })
        const message = decoded.success
        if (message.id === undefined) {
          if (initialized && message.method === "notifications/initialized") ready = true
          if (ready && message.method === "notifications/cancelled") {
            const cancellation = Schema.decodeUnknownOption(
              Schema.Struct({
                requestId: Schema.Union([Schema.String, Schema.Finite]),
                reason: Schema.optionalKey(Schema.String)
              })
            )(message.params, { onExcessProperty: "error" })
            if (cancellation._tag === "Some") yield* FiberMap.remove(commands, cancellation.value.requestId)
          }
          return
        }
        const id = message.id
        const reply = (result: unknown) => write({ jsonrpc: "2.0", id, result })
        const reject = (code: number, message: string, data?: unknown) =>
          write({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } })
        if (message.method === "initialize") {
          const init = yield* Schema.decodeUnknownEffect(Initialize)(message.params, {
            onExcessProperty: "error"
          }).pipe(Effect.result)
          if (initialized || init._tag === "Failure" || init.success.protocolVersion !== "2025-11-25")
            return yield* reject(rpcInvalidParams, "Only MCP 2025-11-25 is supported; initialize once.")
          const descriptor = yield* client.descriptor(address).pipe(Effect.result)
          if (descriptor._tag === "Failure")
            return yield* reject(rpcInternalError, "Dalph host handshake failed", descriptor.failure)
          if (descriptor.success.selectedRun.runId !== runId)
            return yield* reject(rpcInvalidParams, "Selected Run mismatch", {
              _tag: "RunMismatch",
              requestedRunId: runId,
              selectedRunId: descriptor.success.selectedRun.runId
            })
          initialized = true
          return yield* reply({
            protocolVersion: "2025-11-25",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "dalph", version: "1" }
          })
        }
        if (!ready) return yield* reject(rpcInvalidRequest, "Complete initialization before calling Dalph.")
        if (message.method === "ping") return yield* reply({})
        if (message.method === "tools/list") return yield* reply({ tools })
        if (message.method === "resources/list") return yield* reply({ resources })
        if (message.method === "resources/templates/list") return yield* reply({ resourceTemplates: [] })
        if (message.method === "tools/call") {
          const call = yield* Schema.decodeUnknownEffect(ToolCall)(message.params, { onExcessProperty: "error" }).pipe(
            Effect.result
          )
          if (call._tag === "Failure")
            return yield* reject(rpcInvalidParams, "Tool arguments must contain only the exact RunId.")
          const operation =
            call.success.name === "dalph_read_snapshot"
              ? { _tag: "ReadSnapshot" as const }
              : call.success.name === "dalph_read_run_control"
                ? { _tag: "ReadRunControl" as const }
                : call.success.name === "dalph_start_work"
                  ? { _tag: "StartWork" as const }
                  : call.success.name === "dalph_unpause"
                    ? { _tag: "Unpause" as const }
                    : null
          if (operation === null) return yield* reject(rpcInvalidParams, "Unknown tool")
          sequence += 1
          const execute = Effect.gen(function* () {
            const envelope =
              call.success.arguments.runId === runId
                ? yield* client.call(address, runId, operation)
                : runningHostFailureEnvelope(
                    { runId: call.success.arguments.runId, requestId: RequestId.make(`mcp-${sequence}`) },
                    { _tag: "RunMismatch", requestedRunId: call.success.arguments.runId, selectedRunId: runId }
                  )
            return yield* reply({
              structuredContent: envelope,
              content: [{ type: "text", text: JSON.stringify(envelope) }],
              isError: envelope.result._tag === "Failure"
            })
          })
          if (operation._tag === "StartWork" || operation._tag === "Unpause") {
            if (yield* FiberMap.has(commands, id))
              return yield* reject(rpcInvalidRequest, "Request ID is already pending")
            yield* FiberMap.run(commands, id, execute, { startImmediately: true })
            return
          }
          return yield* execute
        }
        if (message.method === "resources/read") {
          const read = yield* Schema.decodeUnknownEffect(ResourceRead)(message.params, {
            onExcessProperty: "error"
          }).pipe(Effect.result)
          if (read._tag === "Failure") return yield* reject(rpcInvalidParams, "A resource URI is required.")
          const uri = read.success.uri
          if (uri === "dalph://host/descriptor") {
            const descriptor = yield* client.descriptor(address).pipe(Effect.result)
            if (descriptor._tag === "Failure")
              return yield* reject(rpcInternalError, "Dalph descriptor read failed", descriptor.failure)
            if (descriptor.success.selectedRun.runId !== runId)
              return yield* reject(rpcResourceNotFound, "Selected Run mismatch", {
                _tag: "RunMismatch",
                requestedRunId: runId,
                selectedRunId: descriptor.success.selectedRun.runId
              })
            return yield* reply({
              contents: [{ uri, mimeType: "application/json", text: JSON.stringify(descriptor.success) }]
            })
          }
          const operation =
            uri === `${base}/snapshot`
              ? { _tag: "ReadSnapshot" as const }
              : uri === `${base}/control`
                ? { _tag: "ReadRunControl" as const }
                : null
          if (operation === null) {
            const match = /^dalph:\/\/runs\/([^/]+)\/(snapshot|control)$/.exec(uri)
            if (match !== null) {
              const requested = yield* Effect.try({
                try: () => decodeURIComponent(match[1] ?? ""),
                catch: () => "InvalidUri"
              }).pipe(Effect.result)
              if (requested._tag === "Success" && requested.success.length > 0 && requested.success !== runId) {
                sequence += 1
                const requestedRunId = RunId.make(requested.success)
                return yield* reject(
                  rpcResourceNotFound,
                  "Selected Run mismatch",
                  runningHostFailureEnvelope(
                    { runId: requestedRunId, requestId: RequestId.make(`mcp-${sequence}`) },
                    { _tag: "RunMismatch", requestedRunId, selectedRunId: runId }
                  )
                )
              }
            }
            return yield* reject(rpcResourceNotFound, "Unknown resource")
          }
          const envelope = yield* client.call(address, runId, operation)
          return yield* reply({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(envelope) }] })
        }
        return yield* reject(rpcMethodNotFound, "Unknown method")
      })
    let pending = new Uint8Array(0)
    yield* ports.input.pipe(
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          let start = 0
          for (let index = 0; index <= chunk.length; index += 1) {
            if (index < chunk.length && chunk[index] !== lineFeedByte) continue
            const part = chunk.subarray(start, index)
            const length = pending.byteLength + part.byteLength
            if (length > runningHostLimits.requestBytes)
              return yield* Effect.fail<RunningHostError>({
                _tag: "FrameTooLarge",
                direction: "Incoming",
                maximumBytes: runningHostLimits.requestBytes,
                measuredBytes: length
              })
            const next = new Uint8Array(length)
            next.set(pending)
            next.set(part, pending.length)
            pending = next
            if (index < chunk.length) {
              const text = yield* Effect.try({
                try: () => new TextDecoder("utf-8", { fatal: true }).decode(pending),
                catch: (): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "", code: "InvalidUtf8" })
              })
              yield* handle(text)
              pending = new Uint8Array(0)
            }
            start = index + 1
          }
        })
      ),
      Effect.raceFirst(FiberMap.join(commands))
    )
    if (pending.byteLength > 0)
      return yield* Effect.fail<RunningHostError>({
        _tag: "TransportFailed",
        phase: "Response",
        reason: "MCP input ended in an incomplete frame."
      })
    yield* FiberMap.awaitEmpty(commands)
  },
  (effect) => Effect.scoped(effect)
)
