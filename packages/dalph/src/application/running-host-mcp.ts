import { ApplyResultRecoveryRequest, ResultRecoveryRequestId } from "@dalph/orchestrator"
/* eslint-disable import/no-nodejs-modules -- The MCP stdio adapter owns only its process-local byte streams. */
import { RunId } from "@dalph/contracts"
import { Effect, FiberMap, Schema, Stream } from "effect"
import {
  type LocalHostAddress,
  RequestId,
  RefreshInterest,
  SubscriptionId,
  type RunningHostEnvelope,
  type RunningHostDescriptor,
  type RunningHostError,
  type RunningHostWatchFrame,
  type RunningHostRequest,
  runningHostFailureEnvelope,
  runningHostLimits
} from "./running-host-contract.js"
import { callRunningHost, readRunningHostDescriptor } from "./running-host-client.js"
import { runningHostMcpStdioPorts as stdioPorts } from "./running-host-mcp-stdio.js"
import { makeRunningHostMcpOperation } from "./running-host-mcp-command.js"
import {
  CapacityToolArguments,
  ExecutorGuidanceToolArguments,
  runningHostMcpTools as tools
} from "./running-host-mcp-tools.js"
import { makeRunningHostMcpWatches } from "./running-host-mcp-watch.js"

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
  readonly watch?: (address: LocalHostAddress, runId: RunId) => Stream.Stream<RunningHostWatchFrame, RunningHostError>
  readonly descriptor: (address: LocalHostAddress) => Effect.Effect<RunningHostDescriptor, RunningHostError>
  readonly call: (
    address: LocalHostAddress,
    runId: RunId,
    operation: RunningHostRequest["operation"]
  ) => Effect.Effect<RunningHostEnvelope>
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
const ToolCall = Schema.Struct({ name: Schema.String, arguments: Schema.Unknown })
const ResourceRead = Schema.Struct({ uri: Schema.String })
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
    const watches = yield* makeRunningHostMcpWatches(
      address,
      runId,
      (uri) => write({ jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri } }),
      client.watch
    )
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
            capabilities: { tools: {}, resources: { subscribe: true } },
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
          const args = yield* Schema.decodeUnknownEffect(
            call.success.name === "dalph_guide_executor"
              ? ExecutorGuidanceToolArguments
              : call.success.name === "dalph_set_capacity"
                ? CapacityToolArguments
                : call.success.name === "dalph_close_watch"
                  ? Schema.Struct({ runId: RunId, subscriptionId: SubscriptionId })
                  : call.success.name === "dalph_apply_result_recovery"
                    ? Schema.Struct({ runId: RunId, recovery: ApplyResultRecoveryRequest })
                    : call.success.name === "dalph_read_result_recovery"
                      ? Schema.Struct({ runId: RunId, recoveryRequestId: ResultRecoveryRequestId })
                      : call.success.name === "dalph_refresh"
                        ? Schema.Struct({ runId: RunId, interest: RefreshInterest })
                        : ToolArguments
          )(call.success.arguments, { onExcessProperty: "error" }).pipe(Effect.result)
          if (args._tag === "Failure")
            return yield* reject(
              rpcInvalidParams,
              "Invalid tool arguments",
              runningHostFailureEnvelope(null, {
                _tag: "InvalidRequest",
                fieldPath: "/arguments",
                code: "ToolArgumentsInvalid"
              })
            )
          if (call.success.name === "dalph_watch_snapshots" || call.success.name === "dalph_close_watch") {
            sequence += 1
            const correlation = { runId: args.success.runId, requestId: RequestId.make(`mcp-${sequence}`) }
            const result: Effect.Effect<
              | { _tag: "WatchOpened"; subscriptionId: SubscriptionId; uri: string }
              | { _tag: "WatchClosed"; subscriptionId: SubscriptionId },
              RunningHostError
            > = Effect.gen(function* () {
              if (args.success.runId !== runId)
                return yield* Effect.fail<RunningHostError>({
                  _tag: "RunMismatch",
                  requestedRunId: args.success.runId,
                  selectedRunId: runId
                })
              if (call.success.name === "dalph_watch_snapshots") return yield* watches.open()
              if (!("subscriptionId" in args.success))
                return yield* Effect.fail<RunningHostError>({
                  _tag: "InvalidRequest",
                  fieldPath: "/subscriptionId",
                  code: "SubscriptionRequired"
                })
              const id = yield* Schema.decodeUnknownEffect(SubscriptionId)(args.success.subscriptionId).pipe(
                Effect.mapError(
                  (): RunningHostError => ({
                    _tag: "InvalidRequest",
                    fieldPath: "/subscriptionId",
                    code: "SubscriptionInvalid"
                  })
                )
              )
              return yield* watches.close(id)
            })
            const value = yield* result.pipe(Effect.result)
            const envelope =
              value._tag === "Failure"
                ? runningHostFailureEnvelope(correlation, value.failure)
                : { protocolVersion: 1, ...correlation, result: { _tag: "Success", value: value.success } }
            return yield* reply({
              structuredContent: envelope,
              content: [{ type: "text", text: JSON.stringify(envelope) }],
              isError: value._tag === "Failure"
            })
          }
          const prepared = yield* makeRunningHostMcpOperation(call.success.name, args.success).pipe(Effect.result)
          if (prepared._tag === "Failure") return yield* reject(rpcInvalidParams, "Invalid command arguments")
          const operation = prepared.success
          if (operation === null) return yield* reject(rpcInvalidParams, "Unknown tool")
          sequence += 1
          const execute = Effect.gen(function* () {
            const envelope =
              args.success.runId === runId
                ? yield* client.call(address, runId, operation)
                : runningHostFailureEnvelope(
                    { runId: args.success.runId, requestId: RequestId.make(`mcp-${sequence}`) },
                    { _tag: "RunMismatch", requestedRunId: args.success.runId, selectedRunId: runId }
                  )
            return yield* reply({
              structuredContent: envelope,
              content: [{ type: "text", text: JSON.stringify(envelope) }],
              isError: envelope.result._tag === "Failure"
            })
          })
          if (
            operation._tag === "SetCapacity" ||
            operation._tag === "StartWork" ||
            operation._tag === "Unpause" ||
            operation._tag === "Refresh" ||
            operation._tag === "ApplyResultRecoveryDirection" ||
            operation._tag === "SendExecutorGuidance"
          ) {
            if (yield* FiberMap.has(commands, id))
              return yield* reject(rpcInvalidRequest, "Request ID is already pending")
            yield* FiberMap.run(commands, id, execute, { startImmediately: true })
            return
          }
          return yield* execute
        }
        if (message.method === "resources/subscribe" || message.method === "resources/unsubscribe") {
          const resource = yield* Schema.decodeUnknownEffect(ResourceRead)(message.params, {
            onExcessProperty: "error"
          }).pipe(Effect.result)
          if (resource._tag === "Failure") return yield* reject(rpcInvalidParams, "A watch URI is required")
          const result = yield* (
            message.method === "resources/subscribe"
              ? watches.subscribe(resource.success.uri)
              : watches.unsubscribe(resource.success.uri)
          ).pipe(Effect.result)
          return yield* result._tag === "Failure"
            ? reject(rpcResourceNotFound, "Watch not found", runningHostFailureEnvelope(null, result.failure))
            : reply({})
        }
        if (message.method === "resources/read") {
          const read = yield* Schema.decodeUnknownEffect(ResourceRead)(message.params, {
            onExcessProperty: "error"
          }).pipe(Effect.result)
          if (read._tag === "Failure") return yield* reject(rpcInvalidParams, "A resource URI is required.")
          const uri = read.success.uri
          if (/^dalph:\/\/runs\/[^/]+\/watches\//.test(uri)) {
            const frame = yield* watches.read(uri).pipe(Effect.result)
            return yield* frame._tag === "Failure"
              ? reject(rpcResourceNotFound, "Watch not found", runningHostFailureEnvelope(null, frame.failure))
              : reply({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(frame.success) }] })
          }
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
      Effect.raceFirst(FiberMap.join(commands)),
      Effect.raceFirst(watches.failure)
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
