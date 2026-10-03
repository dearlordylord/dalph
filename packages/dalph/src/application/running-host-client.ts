/* eslint-disable import/no-nodejs-modules -- This client allocates process-local request correlation only. */
import { NodeCrypto, NodeHttpClient } from "@effect/platform-node"
import { type RunId } from "@dalph/contracts"
import { Crypto, Effect, Schema, Stream } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import {
  type LocalHostAddress,
  RequestId,
  RunningHostDescriptor,
  RunningHostEnvelope,
  RunningHostError,
  type RunningHostRequest,
  encodeRunningHostEnvelope,
  runningHostFailureEnvelope,
  runningHostLimits
} from "./running-host-contract.js"

const redirectStatusMinimum = 300
const redirectStatusMaximum = 400
const successTags: Readonly<Record<RunningHostRequest["operation"]["_tag"], ReadonlyArray<string>>> = {
  ReadSnapshot: ["NotReady", "Ready", "Closed"],
  ReadRunControl: ["RunPaused", "RunUnpaused", "RunTerminated"],
  StartWork: ["WakeSubmitted"],
  Unpause: ["UnpauseApplied"]
}
const compatibleFailure = (request: RunningHostRequest, error: RunningHostError): boolean => {
  if ("operation" in error && error.operation !== request.operation._tag) return false
  const command = request.operation._tag === "StartWork" || request.operation._tag === "Unpause"
  switch (error._tag) {
    case "UnpausePartiallyApplied":
      return request.operation._tag === "Unpause"
    case "RunClosed":
      return command
    case "ReadFailed":
    case "ProjectionFailed":
      return !command
    case "CommandFailed":
    case "CommandOutcomeUnknown":
    case "FrameTooLarge":
    case "HostClosing":
    case "HostInstanceMismatch":
    case "HostUnavailable":
    case "InvalidRequest":
    case "ProtocolVersionUnsupported":
    case "RunMismatch":
    case "TransportFailed":
    case "WriteTimedOut":
      return true
  }
}

const transportError = (error: unknown, phase: "Handshake" | "Response"): RunningHostError => {
  const known = Schema.decodeUnknownOption(RunningHostError)(error)
  return known._tag === "Some" ? known.value : { _tag: "TransportFailed", phase, reason: "ResponseUnavailable" }
}

const responseJson = Effect.fn("RunningHostClient.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse
) {
  const collected = yield* response.stream.pipe(
    Stream.runFoldEffect(
      (): { chunks: ReadonlyArray<Uint8Array>; bytes: number } => ({ chunks: [], bytes: 0 }),
      (prior, chunk) => {
        const bytes = prior.bytes + chunk.byteLength
        return bytes > runningHostLimits.frameBytes
          ? Effect.fail<RunningHostError>({
              _tag: "FrameTooLarge",
              direction: "Outgoing",
              maximumBytes: runningHostLimits.frameBytes,
              measuredBytes: bytes
            })
          : Effect.succeed({ chunks: [...prior.chunks, chunk], bytes })
      }
    )
  )
  const bytes = new Uint8Array(collected.bytes)
  let offset = 0
  for (const chunk of collected.chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    catch: (): RunningHostError => ({ _tag: "TransportFailed", phase: "Response", reason: "ResponseEncodingInvalid" })
  })
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text)
})

const jsonRequest = Effect.fn("RunningHostClient.request")(
  function* (address: LocalHostAddress, path: string, body?: RunningHostRequest) {
    const request =
      body === undefined
        ? HttpClientRequest.get(`${address}${path}`)
        : yield* HttpClientRequest.bodyJson(HttpClientRequest.post(`${address}${path}`), body)
    const response = yield* HttpClient.execute(request)
    if (response.status >= redirectStatusMinimum && response.status < redirectStatusMaximum) {
      return yield* Effect.fail<RunningHostError>({
        _tag: "TransportFailed",
        phase: "Handshake",
        reason: "RedirectForbidden"
      })
    }
    return yield* responseJson(response)
  },
  (effect, _address, _path, body) =>
    effect.pipe(
      Effect.timeout(
        body === undefined ? runningHostLimits.connectDeadlineMillis : runningHostLimits.responseDeadlineMillis
      )
    )
)

/** Reads one explicit local descriptor without acquiring production authorities. */
export const readRunningHostDescriptor = Effect.fn("RunningHostClient.descriptor")(
  function* (address: LocalHostAddress) {
    const input = yield* jsonRequest(address, "/dalph/v1/descriptor", undefined).pipe(
      Effect.mapError(
        (error): RunningHostError =>
          HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError"
            ? { _tag: "HostUnavailable", address, reason: "DescriptorConnectionFailed" }
            : transportError(error, "Handshake")
      )
    )
    const version = Schema.decodeUnknownOption(
      Schema.Struct({
        protocolVersion: Schema.Int.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER })
        )
      })
    )(input)
    if (version._tag === "Some" && version.value.protocolVersion !== 1)
      return yield* Effect.fail<RunningHostError>({
        _tag: "ProtocolVersionUnsupported",
        requestedVersion: version.value.protocolVersion,
        supportedVersions: [1]
      })
    const envelope = yield* Schema.decodeUnknownEffect(Schema.Union([RunningHostDescriptor, RunningHostEnvelope]))(
      input,
      { onExcessProperty: "error" }
    ).pipe(
      Effect.mapError(
        (): RunningHostError => ({ _tag: "TransportFailed", phase: "Handshake", reason: "DescriptorSchemaInvalid" })
      )
    )
    if ("_tag" in envelope) return envelope
    yield* encodeRunningHostEnvelope(envelope)
    if (envelope.result._tag === "Failure") return yield* Effect.fail(envelope.result.error)
    return yield* Effect.fail<RunningHostError>({
      _tag: "TransportFailed",
      phase: "Handshake",
      reason: "DescriptorExpected"
    })
  },
  (effect) => Effect.scoped(effect.pipe(Effect.provide([NodeHttpClient.layerUndici, NodeCrypto.layer])))
)

/** Both attached interfaces call this direct HTTP boundary; no MCP indirection or retry. */
export const callRunningHost = Effect.fn("RunningHostClient.call")(
  function* (address: LocalHostAddress, runId: RunId, operation: RunningHostRequest["operation"]) {
    let submitted = false
    const requestId = RequestId.make(
      yield* (yield* Crypto.Crypto).randomUUIDv4.pipe(
        Effect.mapError(
          (): RunningHostError => ({
            _tag: "TransportFailed",
            phase: "Handshake",
            reason: "RequestIdentityUnavailable"
          })
        )
      )
    )
    const correlation = { requestId, runId }
    return yield* Effect.gen(function* () {
      const descriptor = yield* readRunningHostDescriptor(address)
      if (descriptor.selectedRun.runId !== runId)
        return runningHostFailureEnvelope(correlation, {
          _tag: "RunMismatch",
          selectedRunId: descriptor.selectedRun.runId,
          requestedRunId: runId
        })
      const request: RunningHostRequest = {
        protocolVersion: 1,
        hostInstanceId: descriptor.hostInstanceId,
        requestId,
        runId,
        operation
      }
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > runningHostLimits.requestBytes) {
        return runningHostFailureEnvelope(correlation, {
          _tag: "FrameTooLarge",
          direction: "Incoming",
          maximumBytes: runningHostLimits.requestBytes,
          measuredBytes: new TextEncoder().encode(JSON.stringify(request)).byteLength
        })
      }
      submitted = true
      const input = yield* jsonRequest(address, "/dalph/v1/request", request).pipe(
        Effect.mapError((error): RunningHostError => transportError(error, "Response"))
      )
      const envelope = yield* Schema.decodeUnknownEffect(RunningHostEnvelope)(input, {
        onExcessProperty: "error"
      }).pipe(
        Effect.mapError(
          (): RunningHostError => ({ _tag: "TransportFailed", phase: "Response", reason: "ResponseSchemaInvalid" })
        )
      )
      if (envelope.requestId !== requestId || envelope.runId !== runId)
        return runningHostFailureEnvelope(correlation, {
          _tag: "TransportFailed",
          phase: "Response",
          reason: "ResponseCorrelationMismatch"
        })
      const compatible =
        envelope.result._tag === "Success"
          ? successTags[operation._tag].includes(envelope.result.value._tag)
          : compatibleFailure(request, envelope.result.error)
      if (!compatible)
        return yield* Effect.fail<RunningHostError>({
          _tag: "TransportFailed",
          phase: "Response",
          reason: "ResponseOperationMismatch"
        })
      yield* encodeRunningHostEnvelope(envelope)
      return envelope
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          runningHostFailureEnvelope(
            correlation,
            submitted && (operation._tag === "StartWork" || operation._tag === "Unpause")
              ? {
                  _tag: "CommandOutcomeUnknown",
                  operation: operation._tag,
                  requestId,
                  phase: "AdmissionUnconfirmed",
                  acceptedAt: null
                }
              : error
          )
        )
      )
    )
  },
  (effect) =>
    Effect.scoped(
      effect.pipe(
        Effect.catch((error) => Effect.succeed(runningHostFailureEnvelope(null, error))),
        Effect.provide([NodeHttpClient.layerUndici, NodeCrypto.layer])
      )
    )
)
