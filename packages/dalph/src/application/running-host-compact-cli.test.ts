/* eslint-disable import/no-nodejs-modules -- Controlled public HTTP server and actual built CLI process. */
import { createServer } from "node:http"
import { writeSync } from "node:fs"
import { execFile } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { FixtureTarget } from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { compactFixturePrivateMarker, compactSnapshotFixture } from "../../test-support/compact-snapshot-fixture.js"
import { publicDeliveryClient } from "../../test-support/public-delivery-client.js"
import { CompactRunningHostEnvelope } from "./running-host-compact.js"
import {
  HostInstanceId,
  RunningHostDescriptor,
  RunningHostRequest,
  RunningHostEnvelope,
  LocalHostAddress,
  runningHostSuccessEnvelope,
  runningHostFailureEnvelope,
  runningHostLimits
} from "./running-host-contract.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
class CompactClientFailure extends Schema.TaggedError<CompactClientFailure>()("CompactClientFailure", {
  detail: Schema.String
}) {}
const controlledSnapshotHost = (failed = false) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const snapshot = compactSnapshotFixture()
        const descriptor = RunningHostDescriptor.make({
          protocolVersion: 1,
          hostInstanceId: HostInstanceId.make("compact-test-host"),
          selectedRun: { runId: snapshot.runId, target: FixtureTarget.make("compact-test-target") },
          limits: runningHostLimits
        })
        const requests: Array<string> = []
        const server = createServer((request, response) => {
          response.setHeader("content-type", "application/json")
          if (request.method === "GET" && request.url === "/dalph/v1/descriptor") {
            response.end(JSON.stringify(descriptor))
            return
          }
          let body = ""
          request.setEncoding("utf8")
          request.on("data", (chunk: string) => {
            body += chunk
          })
          request.on("end", () => {
            const decoded = Schema.decodeUnknownSync(RunningHostRequest)(JSON.parse(body))
            requests.push(decoded.operation._tag)
            response.end(
              JSON.stringify(
                failed
                  ? runningHostFailureEnvelope(decoded, {
                      _tag: "ReadFailed",
                      causeTag: "ControlledFailure",
                      detail: compactFixturePrivateMarker
                    })
                  : runningHostSuccessEnvelope(decoded, snapshot)
              )
            )
          })
        })
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject)
          server.listen(0, "127.0.0.1", resolve)
        })
        const address = server.address()
        if (address === null || typeof address === "string") throw new Error("expected bound local TCP address")
        return { server, requests, snapshot, address: LocalHostAddress.make(`http://127.0.0.1:${address.port}`) }
      },
      catch: (error) => new CompactClientFailure({ detail: String(error) })
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
            server.closeAllConnections()
          })
      )
  )
const compactChild = (address: string, runId: string, compact = true) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<{ stdout: string; stderr: string; status: number }>((resolve) => {
        execFile(
          process.execPath,
          [
            builtEntry,
            "attach",
            "snapshot",
            "--host",
            address,
            "--run",
            runId,
            "--json",
            ...(compact ? ["--compact"] : [])
          ],
          { signal, timeout: 10000, maxBuffer: compact ? 8192 : 2097152 },
          (error, stdout, stderr) =>
            resolve({ stdout, stderr, status: error === null ? 0 : typeof error.code === "number" ? error.code : -1 })
        )
      }),
    catch: (error) => new CompactClientFailure({ detail: String(error) })
  })

it.live("the built CLI reads a large observation once and emits bounded JSON", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* controlledSnapshotHost()
      const child = yield* compactChild(host.address, host.snapshot.runId)
      expect(child.status).toBe(0)
      expect(child.stderr).toBe("")
      expect(new TextEncoder().encode(child.stdout).byteLength).toBeLessThanOrEqual(8192)
      const compact = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CompactRunningHostEnvelope))(child.stdout)
      expect(compact.result).toMatchObject({
        publication: "Ready",
        observation: { graph: { total: 500 }, delivery: { blocked: { total: 5 } } }
      })
      expect(host.requests).toEqual(["ReadSnapshot"])
      expect(child.stdout).not.toContain(compactFixturePrivateMarker)
      const fullChild = yield* compactChild(host.address, host.snapshot.runId, false)
      expect(fullChild.status).toBe(0)
      const full = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RunningHostEnvelope))(fullChild.stdout)
      expect(full.result).toEqual({ _tag: "Success", value: host.snapshot })
      writeSync(
        2,
        `[compact-measurement] tasks=500 fullBytes=${Buffer.byteLength(fullChild.stdout)} compactBytes=${Buffer.byteLength(child.stdout)}\n`
      )
      const mcp = yield* publicDeliveryClient("MCP", host.address, host.snapshot.runId)
      expect(mcp).toEqual(full.result)
      expect(host.requests).toEqual(["ReadSnapshot", "ReadSnapshot", "ReadSnapshot"])
    })
  )
)

it.live("compact output preserves failure exit status", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* controlledSnapshotHost(true)
      const child = yield* compactChild(host.address, host.snapshot.runId)
      expect(child.status).toBe(2)
      const compact = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CompactRunningHostEnvelope))(child.stdout)
      expect(compact.result).toEqual({ _tag: "Failure", category: "ReadFailed", phase: null, detailsOmitted: true })
      expect(child.stdout).not.toContain(compactFixturePrivateMarker)
      expect(host.requests).toEqual(["ReadSnapshot"])
    })
  )
)
