import { Cause, Schema } from "effect"
import { expect, it } from "vitest"
import {
  DalphRuntimeDiagnostic,
  encodeRuntimeDiagnostic,
  projectRuntimeCause,
  runtimeDiagnosticByteLimit,
  runtimeDiagnosticCauseDepthLimit,
  runtimeDiagnosticFrameLimit,
  runtimeDiagnosticReasonLimit
} from "./runtime-diagnostic.js"

it("retains exactly the bounded reason capacity and reports omitted reasons", () => {
  const reasons = Array.from({ length: runtimeDiagnosticReasonLimit + 3 }, (_, index) =>
    Cause.makeDieReason({ _tag: `Defect${index}` })
  )
  const diagnostic = projectRuntimeCause(Cause.fromReasons(reasons), [])

  expect(diagnostic.reasons).toHaveLength(runtimeDiagnosticReasonLimit)
  expect(diagnostic.reasons.map(({ error }) => error.errorTag)).toEqual(["Defect0", "Defect1", "Defect2", "Defect3"])
  expect(diagnostic.omitted).toBe(true)
  expect(() => Schema.decodeUnknownSync(DalphRuntimeDiagnostic)(diagnostic)).not.toThrow()
})

it("retains exactly the bounded frame capacity with normalized positions and reports omitted frames", () => {
  const error = new TypeError("private message")
  error.stack = [
    "TypeError: private message",
    ...Array.from(
      { length: runtimeDiagnosticFrameLimit + 2 },
      (_, index) =>
        `    at frame${index} (/private/alice/repository/packages/dalph/src/frame${index}.ts:${index + 1}:2)`
    )
  ].join("\n")
  const diagnostic = projectRuntimeCause(Cause.die(error), [])
  const projected = diagnostic.reasons[0].error

  expect(projected.frames).toHaveLength(runtimeDiagnosticFrameLimit)
  expect(projected.frames?.map(({ line }) => line)).toEqual([1, 2, 3, 4])
  expect(projected.frames?.every(({ module }) => module.startsWith("packages/dalph/src/frame"))).toBe(true)
  expect(diagnostic.omitted).toBe(true)
  expect(JSON.stringify(diagnostic)).not.toContain("/private/alice")
})

it("terminates a cyclic nested cause and reports the omitted cycle", () => {
  const cyclic = { _tag: "CyclicDefect", operation: "Cycle.observe" }
  Object.defineProperty(cyclic, "cause", { enumerable: true, value: cyclic })
  const diagnostic = projectRuntimeCause(Cause.die(cyclic), [])

  expect(diagnostic.omitted).toBe(true)
  expect(diagnostic.reasons[0].error).toMatchObject({
    causes: [{ errorTag: "CyclicDefect", operation: "Cycle.observe" }],
    errorTag: "CyclicDefect",
    operation: "Cycle.observe"
  })
  expect(JSON.stringify(diagnostic)).not.toContain('"causes":[{"causes":[')
})

it("retains exactly the bounded nested-cause depth and reports the omitted tail", () => {
  const nested = Array.from({ length: runtimeDiagnosticCauseDepthLimit + 2 }).reduce<unknown>(
    (cause, _, index) => ({ _tag: `Nested${index}`, cause }),
    { _tag: "Leaf" }
  )
  const diagnostic = projectRuntimeCause(Cause.die(nested), [])
  let retainedDepth = 0
  let current = diagnostic.reasons[0].error.causes?.[0]
  while (current !== undefined) {
    retainedDepth += 1
    current = current.causes?.[0]
  }

  expect(retainedDepth).toBe(runtimeDiagnosticCauseDepthLimit)
  expect(diagnostic.omitted).toBe(true)
})

it("omits a stack frame with a nonfinite source position without losing the diagnostic", () => {
  const error = new TypeError("private message")
  error.stack = `TypeError: private message\n    at hostile (/packages/dalph/x.ts:${"9".repeat(400)}:1)`

  const diagnostic = projectRuntimeCause(Cause.die(error), [])

  expect(diagnostic.reasons[0].error).toMatchObject({ errorTag: "TypeError", safeMessage: "TypeError failed" })
  expect(diagnostic.reasons[0].error.frames).toBeUndefined()
  expect(diagnostic.omitted).toBe(true)
})

it("keeps a TypeError call site and Node system operation without copying their hostile messages", () => {
  const privatePayload = "private-provider-response-body"
  const typeFailure = new TypeError(privatePayload)
  const systemFailure = Object.assign(new Error(privatePayload), {
    cause: typeFailure,
    code: "EAGAIN",
    syscall: "spawn"
  })
  const line = encodeRuntimeDiagnostic(projectRuntimeCause(Cause.die(systemFailure), []))
  const diagnostic = JSON.parse(line)

  expect(diagnostic).toMatchObject({
    reasons: [
      {
        _tag: "Defect",
        error: {
          errorTag: "Error",
          operation: "spawn",
          safeMessage: "spawn failed with EAGAIN",
          code: "EAGAIN",
          syscall: "spawn",
          causes: [{ errorTag: "TypeError", safeMessage: "TypeError failed" }]
        }
      }
    ]
  })
  expect(diagnostic.reasons[0].error.frames[0]).toMatchObject({
    function: expect.any(String),
    line: expect.any(Number),
    module: "packages/dalph/src/application/runtime-diagnostic.test.ts"
  })
  expect(line).not.toContain(privatePayload)
})

it("bounds hostile cause text and depth as one valid secret-safe UTF-8 JSON line", () => {
  const credential = "credential-must-not-survive"
  const providerPayload = "provider-private-payload-must-not-survive"
  const nested = Array.from({ length: 20 }).reduce<unknown>(
    (cause) => ({
      _tag: `Nested${"界".repeat(400)}`,
      cause,
      detail: providerPayload,
      operation: `Runtime.operation.${credential}.${"界".repeat(400)}`,
      safeMessage: `resource unavailable ${credential} ${"界".repeat(400)}`
    }),
    { _tag: "Leaf", message: providerPayload }
  )
  const line = encodeRuntimeDiagnostic(projectRuntimeCause(Cause.die(nested), [credential]))

  expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(runtimeDiagnosticByteLimit)
  expect(line.endsWith("\n")).toBe(true)
  expect(() => JSON.parse(line)).not.toThrow()
  expect(JSON.parse(line)).toMatchObject({ _tag: "DalphRuntimeDiagnostic", omitted: true })
  expect(line).not.toContain(credential)
  expect(line).not.toContain(providerPayload)
  expect(line).not.toContain("�")
})

it("bounds a maximum-capacity schema-valid diagnostic at the encode boundary", () => {
  const text = "\u0001".repeat(256)
  const frame = { column: 1, function: text, line: 1, module: text }
  const child = { errorTag: text, frames: [frame], safeMessage: text }
  const error = { causes: [child, child], errorTag: text, frames: [frame, frame, frame, frame], safeMessage: text }
  const input = {
    _tag: "DalphRuntimeDiagnostic",
    boundary: "NodeMainExit",
    omitted: false,
    outcome: "Failed",
    reasons: Array.from({ length: runtimeDiagnosticReasonLimit }, () => ({ _tag: "Defect", error })),
    version: 1
  }
  const diagnostic = Schema.decodeUnknownSync(DalphRuntimeDiagnostic)(input)

  const line = encodeRuntimeDiagnostic(diagnostic)
  const encoded = JSON.parse(line)

  expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(runtimeDiagnosticByteLimit)
  expect(encoded).toMatchObject({ omitted: true, reasons: [{ error: { errorTag: expect.any(String) } }] })
  expect(encoded.reasons[0].error.errorTag.length).toBeLessThan(text.length)
})

it("enforces the nested-cause depth for a schema-valid direct encoder input", () => {
  const error = Array.from({ length: runtimeDiagnosticCauseDepthLimit + 2 }).reduce<Record<string, unknown>>(
    (cause, _, index) => ({ causes: [cause], errorTag: `Nested${index}`, safeMessage: "nested failure" }),
    { errorTag: "Leaf", safeMessage: "leaf failure" }
  )
  const diagnostic = Schema.decodeUnknownSync(DalphRuntimeDiagnostic)({
    _tag: "DalphRuntimeDiagnostic",
    boundary: "NodeMainExit",
    omitted: false,
    outcome: "Failed",
    reasons: [{ _tag: "Defect", error }],
    version: 1
  })

  const encoded = JSON.parse(encodeRuntimeDiagnostic(diagnostic))
  let retainedDepth = 0
  let current = encoded.reasons[0].error.causes?.[0]
  while (current !== undefined) {
    retainedDepth += 1
    current = current.causes?.[0]
  }

  expect(retainedDepth).toBe(runtimeDiagnosticCauseDepthLimit)
  expect(encoded.omitted).toBe(true)
})
