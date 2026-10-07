import { TraceCursor } from "@dalph/orchestrator"
import { readRecordedBaseRetryReceipt } from "./running-host-base-retry-receipt.js"
import { readRunningHostCapacity } from "./running-host-capacity.js"
import { integrationActivationReadFailure } from "./running-host-activation-failure.js"
/* eslint-disable import/no-nodejs-modules -- This scoped adapter owns the local HTTP listener and exact sockets. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { NodeCrypto, NodeHttpServer, NodeHttpServerRequest } from "@effect/platform-node"
import { Crypto, Effect, Option, Schema, Scope } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { type ProductionRunningHostObservation } from "./production-host.js"
import {
  decodeRunningHostRequest,
  encodeRunningHostEnvelope,
  HostInstanceId,
  type LocalHostAddress,
  RunningHostDescriptor,
  RunningHostError,
  runningHostLimits,
  runningHostFailureEnvelope,
  runningHostSuccessEnvelope
} from "./running-host-contract.js"
import { projectRunningHostRunControl, projectRunningHostSnapshot } from "./running-host-projection.js"
import { readRunningHostPageAsset } from "./running-host-page-assets.js"

import { makeRunningHostCommandOwnership } from "./running-host-command-ownership.js"
import { makeRunningHostHttpWatch, type RunningHostWatchWriter } from "./running-host-http-watch.js"

const browserReadOperations: ReadonlySet<string> = new Set([
  "ReadSnapshot",
  "ReadRunControl",
  "ReadResultRecoveryDirection",
  "ReadInspectionSnapshot",
  "RefreshInspection",
  "WatchSnapshots",
  "WatchInspection"
])

const defaultHttpPort = 80
const httpStatus = { success: 200, badRequest: 400, conflict: 409, tooLarge: 413, unavailable: 503 } as const

const invalid = (code: string): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "", code })
const body = Effect.fn("RunningHostHttp.readBody")((request: IncomingMessage) =>
  Effect.tryPromise({
    try: async (signal) => {
      const parts: Array<Uint8Array> = []
      let size = 0
      const abort = () => request.destroy()
      signal.addEventListener("abort", abort, { once: true })
      try {
        const chunks: AsyncIterable<unknown> = request.iterator({ destroyOnReturn: false })
        for await (const chunk of chunks) {
          if (!(chunk instanceof Uint8Array)) return Promise.reject(invalid("RequestBodyEncoding"))
          size += chunk.byteLength
          if (size > runningHostLimits.requestBytes)
            return Promise.reject(
              RunningHostError.cases.FrameTooLarge.make({
                direction: "Incoming",
                maximumBytes: runningHostLimits.requestBytes,
                measuredBytes: size
              })
            )
          parts.push(chunk)
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))
      } finally {
        signal.removeEventListener("abort", abort)
      }
    },
    catch: (error): RunningHostError => {
      const decoded = Schema.decodeUnknownOption(RunningHostError)(error)
      return Option.isSome(decoded) ? decoded.value : invalid("RequestBodyUnreadable")
    }
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.catchTag("TimeoutError", () => Effect.fail(invalid("RequestBodyTimedOut")))
  )
)

/** One listener dispatches passive requests against the already acquired host. */
export interface RunningHostHttpServer {
  readonly descriptor: RunningHostDescriptor
  readonly address: LocalHostAddress
  readonly server: Server
}

export const serveRunningHost = Effect.fn("RunningHostHttp.serve")(function* <E>(
  address: LocalHostAddress,
  observation: ProductionRunningHostObservation<E>,
  watchWriter?: RunningHostWatchWriter
): Effect.fn.Return<RunningHostHttpServer, RunningHostError, Crypto.Crypto | Scope.Scope> {
  const descriptor = RunningHostDescriptor.make({
    _tag: "HostDescriptor",
    protocolVersion: 1,
    hostInstanceId: HostInstanceId.make(
      yield* (yield* Crypto.Crypto).randomUUIDv4.pipe(
        Effect.mapError(
          (): RunningHostError => ({ _tag: "HostUnavailable", address, reason: "HostIdentityUnavailable" })
        )
      )
    ),
    selectedRun: { runId: observation.selection.runId, target: observation.target },
    limits: runningHostLimits
  })
  const command = yield* makeRunningHostCommandOwnership(
    descriptor.hostInstanceId,
    observation.commandAdmission,
    observation.awaitExitResult,
    observation.executeAttachedCommand
  )
  const hostScope = yield* Scope.Scope
  const inspection =
    observation.inspection === undefined
      ? undefined
      : yield* Effect.cached(
          observation.inspection.pipe(
            Effect.tap((owner) => observation.registerObservationDrain({ closeProcessLocalResources: owner.stop })),
            Effect.provideService(Scope.Scope, hostScope),
            Effect.uninterruptible
          )
        )
  const watch = yield* makeRunningHostHttpWatch(observation, watchWriter, inspection)
  const dispatch = Effect.fn("RunningHostHttp.dispatch")(function* (input: unknown, response: ServerResponse) {
    const request = yield* decodeRunningHostRequest(input, descriptor)
    if (yield* observation.closing)
      return yield* Effect.fail<RunningHostError>({
        _tag: "HostClosing",
        hostInstanceId: descriptor.hostInstanceId,
        cutoff: "AdmissionClosed"
      })
    if (request.operation._tag === "ReadInspectionSnapshot" || request.operation._tag === "RefreshInspection") {
      if (inspection === undefined)
        return yield* Effect.fail<RunningHostError>({
          _tag: "ReadFailed",
          causeTag: "InspectionUnavailable",
          detail: "The host inspection reader is unavailable."
        })
      const owner = yield* inspection
      if (request.operation._tag === "RefreshInspection") yield* owner.refresh
      const run = yield* observation.current.get.pipe(
        Effect.flatMap((state) => projectRunningHostSnapshot(request.runId, state))
      )
      return runningHostSuccessEnvelope(request, { _tag: "InspectionSnapshot", run, inspection: yield* owner.current })
    }
    if (
      request.operation._tag === "SetCapacity" ||
      request.operation._tag === "StartWork" ||
      request.operation._tag === "Unpause" ||
      request.operation._tag === "Refresh" ||
      request.operation._tag === "ApplyResultRecoveryDirection" ||
      request.operation._tag === "RetryTaskAttemptBase" ||
      request.operation._tag === "SendExecutorGuidance"
    ) {
      const commandOperation = request.operation._tag
      const control = yield* observation.readRunControl.pipe(
        Effect.mapError(
          (): RunningHostError => ({
            _tag: "CommandFailed",
            operation: commandOperation,
            stage: "PreAdmission",
            causeTag: "RunControlUnavailable",
            detail: "Accepted Run control is unavailable."
          })
        )
      )
      if (control.termination !== null) {
        const receipt = yield* readRecordedBaseRetryReceipt(observation.taskAttemptBaseRetryControl, request)
        if (Option.isSome(receipt)) return runningHostSuccessEnvelope(request, receipt.value)
        return yield* Effect.fail<RunningHostError>({ _tag: "RunClosed", runId: request.runId, ...control.termination })
      }
      if (Option.isSome(yield* observation.activationFailure))
        return yield* Effect.fail<RunningHostError>({
          _tag: "CommandFailed",
          operation: request.operation._tag,
          stage: "PreAdmission",
          causeTag: "ActivationFailed",
          detail: "The host retains an activation failure."
        })
      if (response.destroyed)
        return yield* Effect.fail<RunningHostError>({
          _tag: "CommandFailed",
          operation: request.operation._tag,
          stage: "PreAdmission",
          causeTag: "ClientDisconnected",
          detail: "The connection closed before command admission."
        })
      return runningHostSuccessEnvelope(request, yield* command({ ...request, operation: request.operation }))
    }
    if (request.operation._tag === "ReadCapacity")
      return runningHostSuccessEnvelope(request, yield* readRunningHostCapacity(observation))
    if (request.operation._tag === "ReadResultRecoveryDirection") {
      const recoveryRequestId = request.operation.recoveryRequestId
      if (observation.resultRecoveryControl === undefined)
        return yield* Effect.fail<RunningHostError>({
          _tag: "ReadFailed",
          causeTag: "RunOwnerUnavailable",
          detail: "The result recovery reader is unavailable."
        })
      const outcome = yield* observation.resultRecoveryControl
        .readResultRecoveryDirection(recoveryRequestId)
        .pipe(Effect.result)
      if (outcome._tag === "Failure") {
        if (outcome.failure._tag === "ResultRecoveryDirectionNotFound")
          return runningHostSuccessEnvelope(request, { _tag: "ResultRecoveryDirectionNotRecorded", recoveryRequestId })
        return yield* Effect.fail<RunningHostError>({
          _tag: "ReadFailed",
          causeTag: outcome.failure._tag,
          detail: "The exact result recovery direction could not be read."
        })
      }
      const recorded = outcome.success
      return runningHostSuccessEnvelope(request, {
        _tag: "ResultRecoveryDirectionRecorded",
        recovery: {
          direction: recorded.event.direction,
          requestId: recorded.event.requestId,
          subject: recorded.event.subject
        },
        acceptedAt: TraceCursor.make({ runId: recorded.runId, position: recorded.position })
      })
    }
    if (request.operation._tag === "ReadSnapshot") {
      const failure = yield* observation.activationFailure
      if (Option.isSome(failure)) {
        const readFailure = integrationActivationReadFailure(failure.value)
        if (Option.isSome(readFailure)) return yield* Effect.fail(readFailure.value)
      }
    }
    const value =
      request.operation._tag === "ReadSnapshot"
        ? yield* observation.current.get.pipe(
            Effect.flatMap((state) => projectRunningHostSnapshot(request.runId, state))
          )
        : yield* Effect.gen(function* () {
            const control = yield* observation.readRunControl.pipe(
              Effect.mapError(
                (): RunningHostError => ({
                  _tag: "ReadFailed",
                  causeTag: "ProductionPassiveControlUnavailable",
                  detail: "Accepted Run control is unavailable."
                })
              )
            )
            const failure = yield* observation.activationFailure
            const typed = Option.isSome(failure)
              ? Schema.decodeUnknownOption(
                  Schema.Struct({
                    _tag: Schema.Literal("WorkflowRunTerminationEvidenceInvalid"),
                    runId: Schema.NonEmptyString
                  })
                )(failure.value)
              : Option.none()
            const finality =
              Option.isSome(typed) && typed.value.runId === request.runId
                ? {
                    _tag: "WorkflowRunTerminationEvidenceInvalid" as const,
                    runId: request.runId,
                    detail: "Run termination evidence is causally invalid."
                  }
                : null
            return yield* projectRunningHostRunControl(control, finality)
          })
    return runningHostSuccessEnvelope(request, value)
  })
  const handle = Effect.fn("RunningHostHttp.handle")(function* (request: IncomingMessage, response: ServerResponse) {
    let input: unknown = null
    const outcome = yield* Effect.gen(function* () {
      if (
        (request.headers.origin !== undefined && request.headers.origin !== new URL(address).origin) ||
        request.headers.host !== new URL(address).host
      ) {
        return yield* Effect.fail(invalid("LocalOriginRequired"))
      }
      if (yield* observation.closing)
        return yield* Effect.fail<RunningHostError>({
          _tag: "HostClosing",
          hostInstanceId: descriptor.hostInstanceId,
          cutoff: "AdmissionClosed"
        })
      if (request.method === "GET" && request.url === "/dalph/v1/descriptor") {
        return { _tag: "Descriptor" as const, text: JSON.stringify(descriptor) }
      }
      if (request.method === "GET") {
        const asset = yield* readRunningHostPageAsset(request.url ?? "")
        if (asset !== null) return { _tag: "Page" as const, ...asset }
      }
      if (request.method !== "POST" || (request.url !== "/dalph/v1/request" && request.url !== "/dalph/v1/watch"))
        return yield* Effect.fail(invalid("RouteUnsupported"))
      if (request.headers["content-type"] !== "application/json")
        return yield* Effect.fail(invalid("ContentTypeUnsupported"))
      input = yield* body(request).pipe(
        Effect.flatMap((text) => Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text)),
        Effect.mapError(
          (error): RunningHostError =>
            RunningHostError.guards.FrameTooLarge(error) ? error : invalid("RequestJsonInvalid")
        )
      )
      const decoded = yield* decodeRunningHostRequest(input, descriptor)
      if (request.headers.origin !== undefined && !browserReadOperations.has(decoded.operation._tag))
        return yield* Effect.fail(invalid("BrowserControlForbidden"))
      if (request.url === "/dalph/v1/watch") {
        if (decoded.operation._tag !== "WatchSnapshots" && decoded.operation._tag !== "WatchInspection")
          return yield* Effect.fail(invalid("WatchOperationRequired"))
        if (decoded.operation._tag === "WatchInspection" && inspection === undefined)
          return yield* Effect.fail<RunningHostError>({
            _tag: "ReadFailed",
            causeTag: "InspectionUnavailable",
            detail: "The host inspection reader is unavailable."
          })
        yield* Effect.scoped(watch(decoded, response))
        return { _tag: "Watch" as const }
      }
      if (decoded.operation._tag === "WatchSnapshots" || decoded.operation._tag === "WatchInspection")
        return yield* Effect.fail(invalid("WatchRouteRequired"))
      const envelope = yield* dispatch(input, response)
      return { _tag: "Envelope" as const, envelope, text: yield* encodeRunningHostEnvelope(envelope) }
    }).pipe(
      Effect.catch((error) => {
        const envelope = runningHostFailureEnvelope(input, error)
        return encodeRunningHostEnvelope(envelope).pipe(
          Effect.map((text) => ({ _tag: "Envelope" as const, envelope, text }))
        )
      })
    )
    if (outcome._tag === "Watch") return HttpServerResponse.empty()
    // Keep the deadline alive through the platform's response flush. Closing
    // the request scope cancels it after successful completion.
    yield* Effect.sleep(runningHostLimits.writeDeadlineMillis).pipe(
      Effect.andThen(Effect.sync(() => response.destroy())),
      Effect.forkScoped
    )
    const headers = {
      "content-type": outcome._tag === "Page" ? outcome.contentType : "application/json",
      connection: "close",
      "x-content-type-options": "nosniff"
    }
    if (outcome._tag === "Page") return HttpServerResponse.raw(outcome.bytes, { headers })
    const error =
      outcome._tag === "Envelope" && outcome.envelope.result._tag === "Failure" ? outcome.envelope.result.error : null
    const status =
      error?._tag === "InvalidRequest"
        ? httpStatus.badRequest
        : error?._tag === "FrameTooLarge" && error.direction === "Incoming"
          ? httpStatus.tooLarge
          : error?._tag === "HostInstanceMismatch"
            ? httpStatus.conflict
            : error?._tag === "HostClosing"
              ? httpStatus.unavailable
              : httpStatus.success
    return HttpServerResponse.raw(outcome.text, { status, headers })
  })
  // Effect owns request fibers and disconnect interruption. Commands admitted by
  // dispatch still run in the independent host scope above.
  const handler = yield* NodeHttpServer.makeHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const response = NodeHttpServerRequest.toServerResponse(request)
      return yield* handle(NodeHttpServerRequest.toIncomingMessage(request), response).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            response.destroy()
            return HttpServerResponse.empty()
          })
        )
      )
    }),
    { scope: hostScope, middleware: (app) => Effect.interruptible(app) }
  )
  const server = createServer(handler)
  const origin = new URL(address)
  yield* NodeHttpServer.make(() => server, {
    host: origin.hostname,
    port: Number(origin.port || defaultHttpPort),
    disablePreemptiveShutdown: true
  }).pipe(Effect.mapError((): RunningHostError => ({ _tag: "HostUnavailable", address, reason: "ListenerBindFailed" })))
  // Registered after the platform finalizer: terminate exact sockets before
  // its close wait. The host's existing observation/command drain owns Exit.
  yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()))
  return { descriptor, address, server }
}, Effect.provide(NodeCrypto.layer))
