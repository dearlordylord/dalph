/* eslint-disable import/no-nodejs-modules -- Starts actual public CLI/MCP children at the process boundary. */
import { execFile, spawn } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import type { RunId } from "@dalph/contracts"
import { Deferred, Effect, FiberSet, Schema } from "effect"
import { RunningHostEnvelope, type RefreshInterest } from "../src/application/running-host-contract.js"
const lastReplyOffset = -1
const watchResourceReadRpcId = 3
const builtEntry = fileURLToPath(new URL("../dist/bin/dalph.js", import.meta.url))
class IntermediateClientFailure extends Schema.TaggedError<IntermediateClientFailure>()("IntermediateClientFailure", {
  detail: Schema.String
}) {}
export const publicDeliveryClient = (
  adapter: "CLI" | "MCP",
  address: string,
  runId: RunId,
  operation: "snapshot" | "control" | "refresh" | "set-capacity" | "start" | "unpause" = "snapshot",
  interest: RefreshInterest = { _tag: "WholeGraph" }
) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [
            builtEntry,
            ...(adapter === "CLI"
              ? [
                  "attach",
                  operation,
                  "--host",
                  address,
                  "--run",
                  runId,
                  "--json",
                  ...(operation === "refresh"
                    ? interest._tag === "WholeGraph"
                      ? ["--whole-graph"]
                      : interest.taskIds.flatMap((taskId) => ["--task", taskId])
                    : operation === "set-capacity"
                      ? ["--capacity", "2", "--expected-revision", "1"]
                      : [])
                ]
              : ["mcp", "--host", address, "--run", runId])
          ],
          { signal, timeout: 10000 },
          (error, stdout, stderr) => {
            if (error === null) resolve(stdout)
            else reject(new Error(`${stderr}: ${stdout}`))
          }
        )
        child.stdin?.end(
          adapter === "CLI"
            ? ""
            : [
                {
                  jsonrpc: "2.0",
                  id: 1,
                  method: "initialize",
                  params: {
                    protocolVersion: "2025-11-25",
                    capabilities: {},
                    clientInfo: { name: "intermediate", version: "1" }
                  }
                },
                { jsonrpc: "2.0", method: "notifications/initialized" },
                {
                  jsonrpc: "2.0",
                  id: 2,
                  method: "tools/call",
                  params: {
                    name:
                      operation === "snapshot"
                        ? "dalph_read_snapshot"
                        : operation === "control"
                          ? "dalph_read_run_control"
                          : operation === "refresh"
                            ? "dalph_refresh"
                            : operation === "set-capacity"
                              ? "dalph_set_capacity"
                              : operation === "start"
                                ? "dalph_start_work"
                                : "dalph_unpause",
                    arguments: {
                      runId,
                      ...(operation === "refresh"
                        ? { interest }
                        : operation === "set-capacity"
                          ? { capacity: 2, expectedRevision: 1 }
                          : {})
                    }
                  }
                }
              ]
                .map((message) => JSON.stringify(message))
                .join("\n") + "\n"
        )
      }),
    catch: (error) => new IntermediateClientFailure({ detail: String(error) })
  }).pipe(
    Effect.flatMap((stdout) => {
      const reply = JSON.parse(stdout.trim().split("\n").at(lastReplyOffset) ?? "")
      return Schema.decodeUnknownEffect(RunningHostEnvelope)(adapter === "CLI" ? reply : reply.result.structuredContent)
    }),
    Effect.map((envelope) => envelope.result)
  )

export const losePublicDeliveryWatchClient = (adapter: "CLI" | "MCP", address: string, runId: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const run = yield* FiberSet.makeRuntime<never, void, never>()
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn(
            process.execPath,
            [
              builtEntry,
              ...(adapter === "CLI"
                ? ["attach", "watch", "--host", address, "--run", runId, "--json"]
                : ["mcp", "--host", address, "--run", runId])
            ],
            { stdio: ["pipe", "pipe", "pipe"] }
          )
        ),
        (child) =>
          Effect.sync(() => {
            child.kill("SIGTERM")
          })
      )
      let pending = ""
      child.stdout.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8")
        while (pending.includes("\n")) {
          const end = pending.indexOf("\n")
          const value = JSON.parse(pending.slice(0, end))
          pending = pending.slice(end + 1)
          if (adapter === "CLI" && value.frame?._tag === "Snapshot")
            run(Deferred.succeed(observed, undefined).pipe(Effect.asVoid))
          const opened = value.result?.structuredContent?.result?.value
          if (opened?._tag === "WatchOpened")
            child.stdin.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: watchResourceReadRpcId,
                method: "resources/read",
                params: { uri: opened.uri }
              }) + "\n"
            )
          if (adapter === "MCP" && value.id === watchResourceReadRpcId)
            run(Deferred.succeed(observed, undefined).pipe(Effect.asVoid))
        }
      })
      child.once("close", () => run(Deferred.succeed(closed, undefined).pipe(Effect.asVoid)))
      if (adapter === "MCP")
        child.stdin.write(
          [
            {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "watch-loss", version: "1" }
              }
            },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: { name: "dalph_watch_snapshots", arguments: { runId } }
            }
          ]
            .map((value) => JSON.stringify(value))
            .join("\n") + "\n"
        )
      yield* Deferred.await(observed).pipe(Effect.timeout("10 seconds"))
      child.kill("SIGTERM")
      yield* Deferred.await(closed).pipe(Effect.timeout("10 seconds"))
    })
  )
