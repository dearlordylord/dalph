import { NodeCrypto, NodeHttpClient } from "@effect/platform-node"
import type { RunId } from "@dalph/contracts"
import { Crypto, Effect, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import {
  decodeRunningHostResponseJson,
  readRunningHostDescriptor,
  validateRunningHostResponseCorrelation
} from "./running-host-client.js"
import {
  encodeRunningHostWatchFrame,
  type LocalHostAddress,
  RequestId,
  RunningHostEnvelope,
  RunningHostWatchFrame,
  RunningHostError,
  type RunningHostRequest,
  runningHostLimits,
  watchFrameEnds
} from "./running-host-contract.js"

const lineFeedByte = 10

const failed = (reason: string): RunningHostError => ({ _tag: "TransportFailed", phase: "Watch", reason })

/** Decode bounded UTF-8 NDJSON before exposing values. Bare EOF is a failure,
 * sequence is process-local and correlation never selects a different Run. */
const decodeFrames = (source: Stream.Stream<Uint8Array, RunningHostError>, request: RunningHostRequest) =>
  Stream.suspend(() => {
    let pending = new Uint8Array(0)
    let sequence = 0
    let subscriptionId: string | null = null
    let ended = false
    const decoded = source.pipe(
      Stream.flatMap((chunk) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const frames: Array<RunningHostWatchFrame> = []
            let start = 0
            for (let index = 0; index <= chunk.length; index += 1) {
              if (index < chunk.length && chunk[index] !== lineFeedByte) continue
              const part = chunk.subarray(start, index)
              const length = pending.byteLength + part.byteLength
              if (length + 1 > runningHostLimits.frameBytes)
                return yield* Effect.fail<RunningHostError>({
                  _tag: "FrameTooLarge",
                  direction: "Outgoing",
                  maximumBytes: runningHostLimits.frameBytes,
                  measuredBytes: length + 1
                })
              const next = new Uint8Array(length)
              next.set(pending)
              next.set(part, pending.length)
              pending = next
              if (index < chunk.length) {
                const json = yield* Effect.try({
                  try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pending)),
                  catch: () => failed("WatchJsonInvalid")
                })
                const value = yield* Schema.decodeUnknownEffect(RunningHostWatchFrame)(json, {
                  onExcessProperty: "error"
                }).pipe(Effect.mapError(() => failed("WatchSchemaInvalid")))
                if (
                  ended ||
                  value.requestId !== request.requestId ||
                  value.runId !== request.runId ||
                  value.sequence !== sequence ||
                  (subscriptionId !== null && value.subscriptionId !== subscriptionId)
                )
                  return yield* Effect.fail(failed("WatchCorrelationInvalid"))
                yield* encodeRunningHostWatchFrame(value)
                subscriptionId = value.subscriptionId
                sequence += 1
                ended = watchFrameEnds(value)
                frames.push(value)
                pending = new Uint8Array(0)
              }
              start = index + 1
            }
            return Stream.fromIterable(frames)
          })
        )
      )
    )
    return Stream.concat(
      decoded,
      Stream.unwrap(
        Effect.suspend(() =>
          ended && pending.byteLength === 0
            ? Effect.succeed(Stream.empty)
            : Effect.fail(failed("WatchEndedBeforeClosed"))
        )
      )
    )
  })

/** Both watch adapters connect to one explicit host; reconnect is a new attachment. */
const watchRunningHostOperation = (
  address: LocalHostAddress,
  runId: RunId,
  operation: "WatchSnapshots" | "WatchInspection"
): Stream.Stream<RunningHostWatchFrame, RunningHostError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const descriptor = yield* readRunningHostDescriptor(address)
      if (descriptor.selectedRun.runId !== runId)
        return yield* Effect.fail<RunningHostError>({
          _tag: "RunMismatch",
          requestedRunId: runId,
          selectedRunId: descriptor.selectedRun.runId
        })
      const request: RunningHostRequest = {
        protocolVersion: 1,
        hostInstanceId: descriptor.hostInstanceId,
        requestId: RequestId.make(yield* (yield* Crypto.Crypto).randomUUIDv4.pipe(Effect.orDie)),
        runId,
        operation: { _tag: operation }
      }
      const http = yield* HttpClientRequest.bodyJson(HttpClientRequest.post(`${address}/dalph/v1/watch`), request).pipe(
        Effect.mapError(() => failed("WatchRequestInvalid"))
      )
      const response = yield* HttpClient.execute(http).pipe(
        Effect.timeout(runningHostLimits.connectDeadlineMillis),
        Effect.mapError(() => failed("WatchConnectionFailed"))
      )
      if (response.headers["content-type"]?.startsWith("application/x-ndjson"))
        return decodeFrames(response.stream.pipe(Stream.mapError(() => failed("WatchConnectionFailed"))), request)
      const input = yield* decodeRunningHostResponseJson(response).pipe(
        Effect.timeout(runningHostLimits.responseDeadlineMillis),
        Effect.mapError((error): RunningHostError => {
          const known = Schema.decodeUnknownOption(RunningHostError)(error)
          return known._tag === "Some" ? known.value : failed("WatchRejectedResponseInvalid")
        })
      )
      const envelope = yield* Schema.decodeUnknownEffect(RunningHostEnvelope)(input, {
        onExcessProperty: "error"
      }).pipe(Effect.mapError(() => failed("WatchRejectedSchemaInvalid")))
      yield* validateRunningHostResponseCorrelation(request, envelope)
      return yield* Effect.fail(
        envelope.result._tag === "Failure" ? envelope.result.error : failed("WatchStreamExpected")
      )
    })
  ).pipe(Stream.provide(NodeHttpClient.layerUndici), Stream.provide(NodeCrypto.layer))

export const watchRunningHost = (address: LocalHostAddress, runId: RunId) =>
  watchRunningHostOperation(address, runId, "WatchSnapshots")

/** Inspection shares the same bounded decoder and starts from current state. */
export const watchRunningHostInspection = (address: LocalHostAddress, runId: RunId) =>
  watchRunningHostOperation(address, runId, "WatchInspection")
