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
  Refresh: ["RefreshSubmitted"],
  Unpause: ["UnpauseApplied"],
  WatchSnapshots: []
}
const compatibleFailures: Readonly<
  Record<RunningHostError["_tag"], ReadonlyArray<RunningHostRequest["operation"]["_tag"]>>
> = {
  SubscriptionLimitExceeded: ["WatchSnapshots"],
  UnpausePartiallyApplied: ["Unpause"],
  RunClosed: ["StartWork", "Unpause", "Refresh"],
  ReadFailed: ["ReadSnapshot", "ReadRunControl"],
  ProjectionFailed: ["ReadSnapshot", "ReadRunControl"],
  CommandFailed: ["StartWork", "Unpause", "Refresh"],
  CommandOutcomeUnknown: ["StartWork", "Unpause", "Refresh"],
  FrameTooLarge: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  HostClosing: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  HostInstanceMismatch: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  HostUnavailable: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  InvalidRequest: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  ProtocolVersionUnsupported: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  RunMismatch: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  TransportFailed: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"],
  WriteTimedOut: ["ReadSnapshot", "ReadRunControl", "StartWork", "Unpause", "Refresh"]
}
const compatibleFailure = (request: RunningHostRequest, error: RunningHostError): boolean =>
  (!("operation" in error) || error.operation === request.operation._tag) &&
  compatibleFailures[error._tag].includes(request.operation._tag)

const transportError = (error: unknown, phase: "Handshake" | "Response"): RunningHostError => {
  const known = Schema.decodeUnknownOption(RunningHostError)(error)
  return known._tag === "Some" ? known.value : { _tag: "TransportFailed", phase, reason: "ResponseUnavailable" }
}

/** Shared bounded JSON decoding for unary replies and watch rejection envelopes. */
export const decodeRunningHostResponseJson = Effect.fn("RunningHostClient.decodeResponse")(function* (
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
    return yield* decodeRunningHostResponseJson(response)
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

const decodeReply = Effect.fn("RunningHostClient.decodeReply")(function* (request: RunningHostRequest, input: unknown) {
  const envelope = yield* Schema.decodeUnknownEffect(RunningHostEnvelope)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(
      (): RunningHostError => ({ _tag: "TransportFailed", phase: "Response", reason: "ResponseSchemaInvalid" })
    )
  )
  if (envelope.requestId !== request.requestId || envelope.runId !== request.runId)
    return yield* Effect.fail<RunningHostError>({
      _tag: "TransportFailed",
      phase: "Response",
      reason: "ResponseCorrelationMismatch"
    })
  const compatible =
    envelope.result._tag === "Success"
      ? successTags[request.operation._tag].includes(envelope.result.value._tag)
      : compatibleFailure(request, envelope.result.error)
  if (!compatible)
    return yield* Effect.fail<RunningHostError>({
      _tag: "TransportFailed",
      phase: "Response",
      reason: "ResponseOperationMismatch"
    })
  yield* encodeRunningHostEnvelope(envelope)
  return envelope
})

const failureAfterSubmission = (
  correlation: Pick<RunningHostRequest, "requestId" | "runId">,
  operation: RunningHostRequest["operation"],
  submitted: boolean,
  error: RunningHostError
) =>
  runningHostFailureEnvelope(
    correlation,
    submitted && (operation._tag === "StartWork" || operation._tag === "Unpause" || operation._tag === "Refresh")
      ? {
          _tag: "CommandOutcomeUnknown",
          operation: operation._tag,
          requestId: correlation.requestId,
          phase: "AdmissionUnconfirmed",
          acceptedAt: null
        }
      : error
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
      return yield* decodeReply(request, input)
    }).pipe(Effect.catch((error) => Effect.succeed(failureAfterSubmission(correlation, operation, submitted, error))))
  },
  (effect) =>
    Effect.scoped(
      effect.pipe(
        Effect.catch((error) => Effect.succeed(runningHostFailureEnvelope(null, error))),
        Effect.provide([NodeHttpClient.layerUndici, NodeCrypto.layer])
      )
    )
)
