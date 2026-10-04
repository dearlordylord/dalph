/* eslint-disable import/no-nodejs-modules -- A controlled HTTP peer exercises the actual watch response decoder. */
import { createServer } from "node:http"
import { RunId } from "@dalph/contracts"
import { FixtureTarget } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, Schema, Stream } from "effect"
import { expect } from "vitest"
import {
  HostInstanceId,
  LocalHostAddress,
  RequestId,
  RunningHostDescriptor,
  RunningHostRequest,
  runningHostFailureEnvelope,
  runningHostLimits
} from "./running-host-contract.js"
import { watchRunningHost } from "./running-host-watch-client.js"

class WatchPeerUnavailable extends Schema.TaggedError<WatchPeerUnavailable>()("WatchPeerUnavailable", {}) {}

for (const mode of ["Exact", "Request", "Run", "ExtraField"] as const) {
  it.live(`Watch JSON refusal validates exact correlation and closed schema: ${mode}`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runId = RunId.make("watch-refusal-run")
        const descriptor = RunningHostDescriptor.make({
          protocolVersion: 1,
          hostInstanceId: HostInstanceId.make("watch-refusal-peer"),
          selectedRun: { runId, target: FixtureTarget.make("watch-refusal") },
          limits: runningHostLimits
        })
        const server = createServer((request, response) => {
          response.setHeader("content-type", "application/json")
          if (request.url === "/dalph/v1/descriptor") {
            response.end(JSON.stringify(descriptor))
            return
          }
          const chunks: Array<Buffer> = []
          request.on("data", (chunk: Buffer) => chunks.push(chunk))
          request.on("end", () => {
            const decoded = Schema.decodeUnknownSync(RunningHostRequest)(JSON.parse(Buffer.concat(chunks).toString()))
            const envelope = runningHostFailureEnvelope(
              {
                ...decoded,
                requestId: mode === "Request" ? RequestId.make("foreign-request") : decoded.requestId,
                runId: mode === "Run" ? RunId.make("foreign-run") : decoded.runId
              },
              { _tag: "HostClosing", hostInstanceId: descriptor.hostInstanceId, cutoff: "AdmissionClosed" }
            )
            response.end(JSON.stringify(mode === "ExtraField" ? { ...envelope, graph: {} } : envelope))
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
                if (bound === null || typeof bound === "string") return reject(new Error("PortUnavailable"))
                resolve(LocalHostAddress.make(`http://127.0.0.1:${bound.port}`))
              })
            }),
          catch: () => new WatchPeerUnavailable({})
        })
        const result = yield* watchRunningHost(address, runId).pipe(Stream.runCollect, Effect.result)
        expect(result).toMatchObject({
          _tag: "Failure",
          failure:
            mode === "Exact"
              ? { _tag: "HostClosing", hostInstanceId: descriptor.hostInstanceId }
              : mode === "ExtraField"
                ? { _tag: "TransportFailed", reason: "WatchRejectedSchemaInvalid" }
                : { _tag: "TransportFailed", reason: "ResponseCorrelationMismatch" }
        })
      })
    )
  )
}
