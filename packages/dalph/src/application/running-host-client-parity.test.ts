/* eslint-disable import/no-nodejs-modules -- The qualification peer exercises both actual public client processes. */
import { execFile, spawn } from "node:child_process"
import { createServer } from "node:http"
import process from "node:process"
import { setTimeout, clearTimeout } from "node:timers"
import { fileURLToPath } from "node:url"
import { RunId } from "@dalph/contracts"
import { FixtureTarget } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Clock, Effect, Schema } from "effect"
import { expect } from "vitest"
import {
  HostInstanceId,
  LocalHostAddress,
  RequestId,
  RunningHostDescriptor,
  RunningHostEnvelope,
  RunningHostRequest,
  runningHostFailureEnvelope,
  runningHostLimits,
  type RunningHostError
} from "./running-host-contract.js"

import { callRunningHost } from "./running-host-client.js"

class ParityFixtureError extends Schema.TaggedError<ParityFixtureError>()("ParityFixtureError", {
  detail: Schema.String
}) {}
const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const runId = RunId.make("parity-run")
const instance = HostInstanceId.make("parity-host")
const descriptor = RunningHostDescriptor.make({
  protocolVersion: 1,
  hostInstanceId: instance,
  selectedRun: { runId, target: FixtureTarget.make("parity") },
  limits: runningHostLimits
})
const child = (args: ReadonlyArray<string>, input = "") =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve) => {
        const processChild = execFile(
          process.execPath,
          [builtEntry, ...args],
          { signal, timeout: 15000, maxBuffer: runningHostLimits.frameBytes },
          (error, stdout, stderr) =>
            resolve({ stdout, stderr, status: error === null ? 0 : typeof error.code === "number" ? error.code : null })
        )
        processChild.stdin?.end(input)
      }),
    catch: (error) => new ParityFixtureError({ detail: String(error) })
  })
const normalize = (error: RunningHostError) =>
  error._tag === "WriteTimedOut" ? { ...error, subject: { _tag: "Request", requestId: "per-client-request" } } : error

it.live(
  "actual CLI and MCP preserve every passive failure from the same HTTP peer",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let current: (request: RunningHostRequest) => RunningHostError = () => ({
          _tag: "ReadFailed",
          causeTag: "Fixture",
          detail: "fixture"
        })
        const server = createServer((request, response) => {
          response.setHeader("content-type", "application/json")
          if (request.url === "/dalph/v1/descriptor") {
            response.end(JSON.stringify(descriptor))
            return
          }
          const chunks: Array<Buffer> = []
          request.on("data", (chunk: Buffer) => {
            chunks.push(chunk)
          })
          request.on("end", () => {
            const decoded = Schema.decodeUnknownSync(RunningHostRequest)(
              JSON.parse(Buffer.concat(chunks).toString("utf8"))
            )
            response.end(JSON.stringify(runningHostFailureEnvelope(decoded, current(decoded))))
          })
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                server.close(() => resolve())
                server.closeAllConnections()
              })
          )
        )
        const address = yield* Effect.tryPromise({
          try: () =>
            new Promise<LocalHostAddress>((resolve, reject) => {
              server.once("error", reject)
              server.listen(0, "127.0.0.1", () => {
                const bound = server.address()
                if (bound === null || typeof bound === "string") {
                  reject(new Error("LocalPortUnavailable"))
                  return
                }
                resolve(LocalHostAddress.make(`http://127.0.0.1:${bound.port}`))
              })
            }),
          catch: (error) => new ParityFixtureError({ detail: String(error) })
        })
        const errors: ReadonlyArray<RunningHostError> = [
          { _tag: "InvalidRequest", fieldPath: "operation", code: "Invalid" },
          { _tag: "RunMismatch", requestedRunId: RunId.make("other"), selectedRunId: runId },
          {
            _tag: "HostInstanceMismatch",
            requestedHostInstanceId: HostInstanceId.make("old"),
            actualHostInstanceId: instance
          },
          { _tag: "HostUnavailable", address, reason: "NoListener" },
          { _tag: "ProtocolVersionUnsupported", requestedVersion: 2, supportedVersions: [1] },
          { _tag: "HostClosing", hostInstanceId: instance, cutoff: "AdmissionClosed" },
          { _tag: "ReadFailed", causeTag: "JournalRead", detail: "unavailable" },
          { _tag: "ProjectionFailed", causeTag: "Projection", detail: "invalid" },
          {
            _tag: "FrameTooLarge",
            direction: "Outgoing",
            maximumBytes: runningHostLimits.resultBytes,
            measuredBytes: runningHostLimits.resultBytes + 1
          },
          {
            _tag: "WriteTimedOut",
            subject: { _tag: "Request", requestId: RequestId.make("replaced-per-request") },
            deadlineMillis: runningHostLimits.writeDeadlineMillis
          },
          { _tag: "TransportFailed", phase: "Response", reason: "ConnectionLost" }
        ]
        for (const error of errors) {
          current = (request) =>
            error._tag === "WriteTimedOut"
              ? { ...error, subject: { _tag: "Request", requestId: request.requestId } }
              : error
          for (const operation of ["snapshot", "control"] as const) {
            const source = yield* callRunningHost(address, runId, {
              _tag: operation === "snapshot" ? "ReadSnapshot" : "ReadRunControl"
            })
            if (source.result._tag !== "Failure") return expect.fail("source client must return the shared failure")
            expect(normalize(source.result.error)).toEqual(normalize(error))
            const cli = yield* child(["attach", operation, "--host", address, "--run", runId, "--json"])
            const expectedStatus = ["HostUnavailable", "WriteTimedOut", "TransportFailed"].includes(error._tag) ? 3 : 2
            expect(cli.status, `${operation}/${error._tag}: ${cli.stderr}`).toBe(expectedStatus)
            const cliEnvelope = Schema.decodeUnknownSync(RunningHostEnvelope)(JSON.parse(cli.stdout))
            expect(cliEnvelope.result._tag).toBe("Failure")
            const messages = [
              {
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                  protocolVersion: "2025-11-25",
                  capabilities: {},
                  clientInfo: { name: "parity", version: "1" }
                }
              },
              { jsonrpc: "2.0", method: "notifications/initialized" },
              {
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: {
                  name: operation === "snapshot" ? "dalph_read_snapshot" : "dalph_read_run_control",
                  arguments: { runId }
                }
              }
            ]
            const mcp = yield* child(
              ["mcp", "--host", address, "--run", runId],
              messages.map((message) => JSON.stringify(message)).join("\n") + "\n"
            )
            expect(mcp.status, mcp.stderr).toBe(0)
            const result = JSON.parse(mcp.stdout.trim().split("\n").at(-1) ?? "").result
            expect(result.isError).toBe(true)
            const mcpEnvelope = Schema.decodeUnknownSync(RunningHostEnvelope)(result.structuredContent)
            if (cliEnvelope.result._tag !== "Failure" || mcpEnvelope.result._tag !== "Failure")
              return expect.fail("both clients must return shared failures")
            expect(normalize(cliEnvelope.result.error)).toEqual(normalize(error))
            expect(normalize(mcpEnvelope.result.error)).toEqual(normalize(error))
          }
        }
      })
    ),
  60000
)

it.live(
  "blocked CLI and MCP stdout aborts the exact sink within its deadline and leaves the host available",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const largeDetail = "x".repeat(1024 * 1024)
        let reads = 0
        const server = createServer((request, response) => {
          response.setHeader("content-type", "application/json")
          if (request.url === "/dalph/v1/descriptor") {
            response.end(JSON.stringify(descriptor))
            return
          }
          const chunks: Array<Buffer> = []
          request.on("data", (chunk: Buffer) => {
            chunks.push(chunk)
          })
          request.on("end", () => {
            const decoded = Schema.decodeUnknownSync(RunningHostRequest)(
              JSON.parse(Buffer.concat(chunks).toString("utf8"))
            )
            reads += 1
            response.end(
              JSON.stringify(
                runningHostFailureEnvelope(decoded, {
                  _tag: "ReadFailed",
                  causeTag: "ControlledLargeFailure",
                  detail: largeDetail
                })
              )
            )
          })
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                server.close(() => resolve())
                server.closeAllConnections()
              })
          )
        )
        const address = yield* Effect.tryPromise({
          try: () =>
            new Promise<LocalHostAddress>((resolve, reject) => {
              server.once("error", reject)
              server.listen(0, "127.0.0.1", () => {
                const bound = server.address()
                if (bound === null || typeof bound === "string") {
                  reject(new Error("LocalPortUnavailable"))
                  return
                }
                resolve(LocalHostAddress.make(`http://127.0.0.1:${bound.port}`))
              })
            }),
          catch: (error) => new ParityFixtureError({ detail: String(error) })
        })
        for (const adapter of ["CLI", "MCP"] as const) {
          const started = yield* Clock.currentTimeMillis
          const observed = yield* Effect.tryPromise({
            try: (signal) =>
              new Promise<{ status: number | null; timedOut: boolean; stderr: string }>((resolve, reject) => {
                const args =
                  adapter === "CLI"
                    ? ["attach", "snapshot", "--host", address, "--run", runId, "--json"]
                    : ["mcp", "--host", address, "--run", runId]
                const blocked = spawn(process.execPath, [builtEntry, ...args], {
                  signal,
                  stdio: ["pipe", "pipe", "pipe"]
                })
                let stderr = ""
                let timedOut = false
                const timer = setTimeout(() => {
                  timedOut = true
                  blocked.kill("SIGKILL")
                }, runningHostLimits.writeDeadlineMillis + 3000)
                blocked.stderr.on("data", (chunk: Buffer) => {
                  stderr += chunk.toString("utf8")
                })
                blocked.once("error", (error) => {
                  clearTimeout(timer)
                  reject(error)
                })
                blocked.once("exit", (status) => {
                  clearTimeout(timer)
                  blocked.stdout.destroy()
                  resolve({ status, timedOut, stderr })
                })
                // Deliberately do not read stdout: pipe backpressure must outlive the complete write budget.
                const messages = [
                  {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                      protocolVersion: "2025-11-25",
                      capabilities: {},
                      clientInfo: { name: "blocked", version: "1" }
                    }
                  },
                  { jsonrpc: "2.0", method: "notifications/initialized" },
                  {
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/call",
                    params: { name: "dalph_read_snapshot", arguments: { runId } }
                  }
                ]
                blocked.stdin.end(
                  adapter === "CLI" ? "" : messages.map((message) => JSON.stringify(message)).join("\n") + "\n"
                )
              }),
            catch: (error) => new ParityFixtureError({ detail: String(error) })
          })
          expect(observed.timedOut, `${adapter}: ${observed.stderr}`).toBe(false)
          expect(observed.status, adapter).toBe(3)
          expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(runningHostLimits.writeDeadlineMillis + 3000)
          const replacement = yield* child(["attach", "descriptor", "--host", address, "--json"])
          expect(replacement.status, replacement.stderr).toBe(0)
          expect(Schema.decodeUnknownSync(RunningHostDescriptor)(JSON.parse(replacement.stdout))).toEqual(descriptor)
        }
        expect(reads).toBe(2)
      })
    ),
  30000
)

it.live(
  "both public adapters enforce the shared response ceiling and reject open descriptor shapes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let responseBytes: number = runningHostLimits.resultBytes
        let extraDescriptor = false
        let oversizedDescriptorFailure = false
        let operationCalls = 0
        const sizedFailure = (input: unknown) => {
          const error = { _tag: "ReadFailed" as const, causeTag: "ControlledSize", detail: "x" }
          const envelope = runningHostFailureEnvelope(input, error)
          const padding = responseBytes - new TextEncoder().encode(JSON.stringify(envelope)).byteLength + 1
          return JSON.stringify({
            ...envelope,
            result: { _tag: "Failure", error: { ...error, detail: "x".repeat(padding) } }
          })
        }
        const server = createServer((request, response) => {
          response.setHeader("content-type", "application/json")
          if (request.url === "/dalph/v1/descriptor") {
            response.end(
              oversizedDescriptorFailure
                ? sizedFailure(null)
                : JSON.stringify(extraDescriptor ? { ...descriptor, unexpected: true } : descriptor)
            )
            return
          }
          const chunks: Array<Buffer> = []
          request.on("data", (chunk: Buffer) => {
            chunks.push(chunk)
          })
          request.on("end", () => {
            operationCalls += 1
            const decoded = Schema.decodeUnknownSync(RunningHostRequest)(
              JSON.parse(Buffer.concat(chunks).toString("utf8"))
            )
            response.end(sizedFailure(decoded))
          })
        })
        yield* Effect.addFinalizer(() =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                server.close(() => resolve())
                server.closeAllConnections()
              })
          )
        )
        const address = yield* Effect.tryPromise({
          try: () =>
            new Promise<LocalHostAddress>((resolve, reject) => {
              server.once("error", reject)
              server.listen(0, "127.0.0.1", () => {
                const bound = server.address()
                if (bound === null || typeof bound === "string") {
                  reject(new Error("LocalPortUnavailable"))
                  return
                }
                resolve(LocalHostAddress.make(`http://127.0.0.1:${bound.port}`))
              })
            }),
          catch: (error) => new ParityFixtureError({ detail: String(error) })
        })
        const mcpInput =
          [
            {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "response-size", version: "1" }
              }
            },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: { name: "dalph_read_snapshot", arguments: { runId } }
            }
          ]
            .map((message) => JSON.stringify(message))
            .join("\n") + "\n"
        for (const bytes of [runningHostLimits.resultBytes, runningHostLimits.resultBytes + 1]) {
          responseBytes = bytes
          const source = yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })
          const cli = yield* child(["attach", "snapshot", "--host", address, "--run", runId, "--json"])
          const mcp = yield* child(["mcp", "--host", address, "--run", runId], mcpInput)
          expect(cli.status, cli.stderr).toBe(2)
          expect(mcp.status, mcp.stderr).toBe(0)
          const cliEnvelope = Schema.decodeUnknownSync(RunningHostEnvelope)(JSON.parse(cli.stdout))
          const mcpResult = JSON.parse(mcp.stdout.trim().split("\n").at(-1) ?? "").result
          expect(mcpResult.isError).toBe(true)
          const mcpEnvelope = Schema.decodeUnknownSync(RunningHostEnvelope)(mcpResult.structuredContent)
          expect(cliEnvelope.result).toEqual(source.result)
          expect(mcpEnvelope.result).toEqual(source.result)
          if (bytes === runningHostLimits.resultBytes) {
            expect(source.result).toMatchObject({
              _tag: "Failure",
              error: { _tag: "ReadFailed", causeTag: "ControlledSize" }
            })
            expect(new TextEncoder().encode(JSON.stringify(source)).byteLength).toBe(bytes)
          } else {
            expect(source.result).toEqual({
              _tag: "Failure",
              error: {
                _tag: "FrameTooLarge",
                direction: "Outgoing",
                maximumBytes: runningHostLimits.resultBytes,
                measuredBytes: bytes
              }
            })
          }
        }
        expect(operationCalls).toBe(6)
        oversizedDescriptorFailure = true
        const oversizedSource = yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })
        expect(oversizedSource.result).toEqual({
          _tag: "Failure",
          error: {
            _tag: "FrameTooLarge",
            direction: "Outgoing",
            maximumBytes: runningHostLimits.resultBytes,
            measuredBytes: runningHostLimits.resultBytes + 1
          }
        })
        const oversizedCli = yield* child(["attach", "descriptor", "--host", address, "--json"])
        expect(oversizedCli.status, oversizedCli.stderr).toBe(2)
        expect(Schema.decodeUnknownSync(RunningHostEnvelope)(JSON.parse(oversizedCli.stdout)).result).toEqual(
          oversizedSource.result
        )
        const oversizedMcp = yield* child(["mcp", "--host", address, "--run", runId], mcpInput)
        expect(oversizedMcp.status, oversizedMcp.stderr).toBe(0)
        expect(JSON.parse(oversizedMcp.stdout.trim().split("\n")[0] ?? "")).toMatchObject({
          error: {
            data: {
              _tag: "FrameTooLarge",
              maximumBytes: runningHostLimits.resultBytes,
              measuredBytes: runningHostLimits.resultBytes + 1
            }
          }
        })
        expect(operationCalls).toBe(6)
        oversizedDescriptorFailure = false
        extraDescriptor = true
        const source = yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })
        expect(source.result).toMatchObject({
          _tag: "Failure",
          error: { _tag: "TransportFailed", phase: "Handshake", reason: "DescriptorSchemaInvalid" }
        })
        const cli = yield* child(["attach", "descriptor", "--host", address, "--json"])
        expect(cli.status, cli.stderr).toBe(3)
        expect(Schema.decodeUnknownSync(RunningHostEnvelope)(JSON.parse(cli.stdout)).result).toEqual(source.result)
        const mcp = yield* child(["mcp", "--host", address, "--run", runId], mcpInput)
        expect(mcp.status, mcp.stderr).toBe(0)
        expect(JSON.parse(mcp.stdout.trim().split("\n")[0] ?? "")).toMatchObject({
          error: { data: { _tag: "TransportFailed", phase: "Handshake", reason: "DescriptorSchemaInvalid" } }
        })
        expect(operationCalls).toBe(6)
      })
    ),
  30000
)
