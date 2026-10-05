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

it.effect("decodes revision-checked capacity requests and rejects malformed values before dispatch", () =>
  Effect.gen(function* () {
    for (const operation of [{ _tag: "ReadCapacity" }, { _tag: "SetCapacity", capacity: 2, expectedRevision: 1 }]) {
      const input = { ...request, operation }
      expect(yield* decodeRunningHostRequest(input, descriptor)).toEqual(input)
    }
    for (const field of ["capacity", "expectedRevision"]) {
      for (const value of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
        const operation = { _tag: "SetCapacity", capacity: 2, expectedRevision: 1, [field]: value }
        expect(yield* decodeRunningHostRequest({ ...request, operation }, descriptor).pipe(Effect.flip)).toMatchObject({
          _tag: "InvalidRequest"
        })
      }
    }
  })
)

it.effect("decodes selected-Run reads and explicit wake and Unpause before dispatch", () =>
  Effect.gen(function* () {
    expect(yield* decodeRunningHostRequest(request, descriptor)).toEqual(request)
    for (const tag of ["StartWork", "Unpause"]) {
      const command = { ...request, operation: { _tag: tag } }
      expect(yield* decodeRunningHostRequest(command, descriptor)).toEqual(command)
    }
    for (const input of [
      { ...request, root: "other" },
      { ...request, operation: { _tag: "ReadSnapshot", root: "other" } },
      { ...request, operation: { _tag: "Unpause", direction: "Pause" } },
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

it("accepts explicit IPv4 origins without normalization or discovery", () => {
  const decode = Schema.decodeUnknownSync(LocalHostAddress)
  for (const address of ["http://127.0.0.1:43127", "http://192.168.215.3:43127", "http://172.17.0.2:80"])
    expect(decode(address)).toBe(address)
  for (const address of [
    "http://localhost:43127",
    "http://0.0.0.0:43127",
    "http://255.255.255.255:43127",
    "http://256.168.1.1:43127",
    "http://192.168.01.1:43127",
    "http://192.168.1:43127",
    "http://192.168.1.1:43127?query",
    "http://192.168.1.1:43127#fragment",
    "http://[::1]:43127",
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

it("rejects command evidence with foreign Run, unsafe ordinal or wrong request correlation", () => {
  const decode = Schema.decodeUnknownSync(RunningHostEnvelope)
  const partial = {
    _tag: "UnpausePartiallyApplied",
    ordinal: 2,
    acceptedAt: { runId: "R", position: 3 },
    causeTag: "Controlled",
    detail: "controlled"
  }
  const envelope = (error: unknown) => ({
    protocolVersion: 1,
    requestId: "req",
    runId: "R",
    result: { _tag: "Failure", error }
  })
  expect(decode(envelope(partial))).toMatchObject({ result: { error: partial } })
  for (const error of [
    { ...partial, ordinal: Number.MAX_SAFE_INTEGER + 1 },
    { ...partial, acceptedAt: { runId: "other", position: 3 } },
    { ...partial, acceptedAt: { runId: "R", position: Number.MAX_SAFE_INTEGER + 1 } },
    {
      _tag: "CommandOutcomeUnknown",
      operation: "Unpause",
      requestId: "other",
      phase: "AdmissionUnconfirmed",
      acceptedAt: null
    }
  ])
    expect(() => decode(envelope(error))).toThrow()
})

it.effect("refresh decodes only whole graph or distinct advisory IDs without client graph or root facts", () =>
  Effect.gen(function* () {
    for (const interest of [{ _tag: "WholeGraph" }, { _tag: "AdvisoryTasks", taskIds: ["C", "E"] }]) {
      const refresh = { ...request, operation: { _tag: "Refresh", interest } }
      expect(yield* decodeRunningHostRequest(refresh, descriptor)).toEqual(refresh)
    }
    for (const interest of [
      { _tag: "Unknown" },
      { _tag: "AdvisoryTasks", taskIds: [] },
      { _tag: "AdvisoryTasks", taskIds: [""] },
      { _tag: "AdvisoryTasks", taskIds: [1] },
      { _tag: "AdvisoryTasks", taskIds: ["C", "C"] },
      { _tag: "WholeGraph", taskIds: ["C"] },
      { _tag: "WholeGraph", root: "E" },
      { _tag: "WholeGraph", graph: {} }
    ])
      expect(
        yield* decodeRunningHostRequest({ ...request, operation: { _tag: "Refresh", interest } }, descriptor).pipe(
          Effect.flip
        )
      ).toMatchObject({ _tag: "InvalidRequest" })
    for (const extra of [{ root: "E" }, { graph: {} }, { taskIds: ["C"] }])
      expect(
        yield* decodeRunningHostRequest(
          { ...request, operation: { _tag: "Refresh", interest: { _tag: "WholeGraph" }, ...extra } },
          descriptor
        ).pipe(Effect.flip)
      ).toMatchObject({ _tag: "InvalidRequest" })
  })
)
