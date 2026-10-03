import { RunId } from "@dalph/contracts"
import { FixtureTarget } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  decodeRunningHostRequest,
  encodeRunningHostEnvelope,
  HostInstanceId,
  LocalHostAddress,
  RequestId,
  RunningHostDescriptor,
  RunningHostEnvelope,
  runningHostFailureEnvelope,
  runningHostLimits,
  runningHostSuccessEnvelope
} from "./running-host-contract.js"

const descriptor = RunningHostDescriptor.make({
  protocolVersion: 1,
  hostInstanceId: HostInstanceId.make("host"),
  selectedRun: { runId: RunId.make("R"), target: FixtureTarget.make("fixture") },
  limits: runningHostLimits
})
const request = {
  protocolVersion: 1,
  hostInstanceId: "host",
  requestId: "req",
  runId: "R",
  operation: { _tag: "ReadSnapshot" }
}

it.effect("decodes only passive selected-Run requests before dispatch", () =>
  Effect.gen(function* () {
    expect(yield* decodeRunningHostRequest(request, descriptor)).toEqual(request)
    for (const input of [
      { ...request, root: "other" },
      { ...request, operation: { _tag: "ReadSnapshot", root: "other" } },
      { ...request, operation: { _tag: "Unpause" } },
      { ...request, runId: "" },
      { ...request, protocolVersion: NaN }
    ])
      expect(yield* decodeRunningHostRequest(input, descriptor).pipe(Effect.flip)).toMatchObject({
        _tag: "InvalidRequest"
      })
    expect(yield* decodeRunningHostRequest({ ...request, protocolVersion: 2 }, descriptor).pipe(Effect.flip)).toEqual({
      _tag: "ProtocolVersionUnsupported",
      requestedVersion: 2,
      supportedVersions: [1]
    })
    expect(yield* decodeRunningHostRequest({ ...request, runId: "X" }, descriptor).pipe(Effect.flip)).toEqual({
      _tag: "RunMismatch",
      requestedRunId: "X",
      selectedRunId: "R"
    })
    expect(
      yield* decodeRunningHostRequest({ ...request, hostInstanceId: "stale" }, descriptor).pipe(Effect.flip)
    ).toEqual({ _tag: "HostInstanceMismatch", requestedHostInstanceId: "stale", actualHostInstanceId: "host" })
  })
)

it("rejects nonlocal origins without normalization or discovery", () => {
  const decode = Schema.decodeUnknownSync(LocalHostAddress)
  expect(decode("http://127.0.0.1:43127")).toBe("http://127.0.0.1:43127")
  for (const address of [
    "http://localhost:43127",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:12/",
    "https://127.0.0.1:12",
    "http://user@127.0.0.1:12"
  ]) {
    expect(() => decode(address)).toThrow()
  }
})

it("retains only independently valid malformed-request correlation", () => {
  const error = { _tag: "InvalidRequest", fieldPath: "", code: "MalformedJson" } as const
  const decode = Schema.decodeUnknownSync(RunningHostEnvelope)
  expect(decode(runningHostFailureEnvelope(null, error))).toMatchObject({ runId: null, requestId: null })
  expect(decode(runningHostFailureEnvelope({ runId: "R", requestId: 19 }, error))).toMatchObject({
    runId: "R",
    requestId: null
  })
  expect(decode(runningHostFailureEnvelope({ runId: {}, requestId: "req" }, error))).toMatchObject({
    runId: null,
    requestId: "req"
  })
})

it.effect("enforces the shared encoded byte ceiling before either adapter wraps the result", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeRunningHostRequest(request, descriptor)
    const envelope = runningHostSuccessEnvelope(decoded, { _tag: "NotReady", runId: RunId.make("R") })
    expect(JSON.parse(yield* encodeRunningHostEnvelope(envelope))).toEqual(envelope)
    const oversized = { ...envelope, requestId: RequestId.make("é".repeat(runningHostLimits.resultBytes)) }
    const failure = yield* encodeRunningHostEnvelope(oversized).pipe(Effect.flip)
    expect(failure).toMatchObject({
      _tag: "FrameTooLarge",
      direction: "Outgoing",
      maximumBytes: runningHostLimits.resultBytes
    })
    if (failure._tag === "FrameTooLarge") expect(failure.measuredBytes).toBeGreaterThan(runningHostLimits.resultBytes)
  })
)

it.effect("accepts the exact shared result limit and rejects its next encoded byte", () =>
  Effect.gen(function* () {
    const make = (detail: string) =>
      runningHostFailureEnvelope(request, { _tag: "ReadFailed", causeTag: "ControlledFailure", detail })
    const fixed = new TextEncoder().encode(JSON.stringify(make("x"))).length - 1
    const exact = make("x".repeat(runningHostLimits.resultBytes - fixed))
    expect(new TextEncoder().encode(yield* encodeRunningHostEnvelope(exact)).length).toBe(runningHostLimits.resultBytes)
    expect(
      yield* encodeRunningHostEnvelope(make("x".repeat(runningHostLimits.resultBytes - fixed + 1))).pipe(Effect.flip)
    ).toMatchObject({ _tag: "FrameTooLarge", measuredBytes: runningHostLimits.resultBytes + 1 })
  })
)

it("rejects a response that crosses Run identity or safe-position boundaries", () => {
  const decode = Schema.decodeUnknownSync(RunningHostEnvelope)
  expect(() =>
    decode({
      protocolVersion: 1,
      requestId: "req",
      runId: "R",
      result: { _tag: "Success", value: { _tag: "NotReady", runId: "other" } }
    })
  ).toThrow()
  expect(() =>
    decode({
      protocolVersion: 1,
      requestId: "req",
      runId: "R",
      result: {
        _tag: "Success",
        value: {
          _tag: "RunTerminated",
          terminationEvidence: {
            _tag: "Accepted",
            disposition: "Completed",
            terminatedAt: { runId: "R", position: Number.MAX_SAFE_INTEGER + 1 }
          }
        }
      }
    })
  ).toThrow()
})
