/* eslint-disable import/no-nodejs-modules -- Acceptance observes terminal OS exits of exact owned host/client handles. */
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import process from "node:process"
import { Effect, Fiber, Queue, Ref, Schema } from "effect"
import { HostDeathFixtureEvent, type HostDeathFixtureInput } from "../bin/running-host-death-fixture-contract.js"
import {
  RunningHostEnvelope,
  RunningHostError,
  type LocalHostAddress
} from "../src/application/running-host-contract.js"
import type { RunId } from "@dalph/contracts"

const McpHandshakeReply = Schema.Union([
  Schema.Struct({ result: Schema.Unknown }),
  Schema.Struct({ error: Schema.Struct({ code: Schema.Int, message: Schema.String, data: RunningHostError }) })
])
const lastReplyOffset = -1

const start = Effect.fn("HostDeathTest.startProcess")(
  (entry: string, args: ReadonlyArray<string>, custody: Ref.Ref<boolean>, ipc = false) =>
    Effect.gen(function* () {
      const child = yield* Effect.sync(() =>
        spawn(process.execPath, [entry, ...args], {
          detached: true,
          stdio: ipc ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"]
        })
      )
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (bytes: Buffer) => {
        stdout += bytes.toString("utf8")
      })
      child.stderr?.on("data", (bytes: Buffer) => {
        stderr += bytes.toString("utf8")
      })
      const closed = yield* Effect.callback<{ code: number | null; signal: NodeJS.Signals | null }>((resume) => {
        child.once("error", (cause) => resume(Effect.die(cause)))
        child.once("close", (code, signal) => resume(Effect.succeed({ code, signal })))
      }).pipe(Effect.forkScoped)
      const stop = Effect.gen(function* () {
        if (child.pid === undefined) return yield* Effect.die("fixture process has no group identity")
        const group = child.pid
        yield* Effect.sync(() => {
          try {
            process.kill(-group, "SIGKILL")
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
          }
        })
        const receipt = yield* Fiber.join(closed)
        for (;;) {
          const absent = yield* Effect.sync(() => {
            try {
              process.kill(-group, 0)
              return false
            } catch (error) {
              if (error instanceof Error && "code" in error && error.code === "ESRCH") return true
              throw error
            }
          })
          if (absent) return receipt
          yield* Effect.sleep("20 millis")
        }
      }).pipe(
        Effect.timeout("5 seconds"),
        Effect.interruptible,
        Effect.onError(() => Ref.set(custody, false))
      )
      yield* Effect.addFinalizer(() => stop.pipe(Effect.orDie))
      return { child, closed, stdout: Effect.sync(() => stdout), stderr: Effect.sync(() => stderr), kill: stop }
    }).pipe(Effect.uninterruptible)
)

export const startDeathHost = Effect.fn("HostDeathTest.startHost")(function* (
  entry: string,
  input: typeof HostDeathFixtureInput.Type,
  custody: Ref.Ref<boolean>
) {
  const host = yield* start(entry, [JSON.stringify(input)], custody, true)
  const events = yield* Queue.unbounded<HostDeathFixtureEvent>()
  const lines = yield* Queue.unbounded<string>()
  const log = yield* Ref.make<ReadonlyArray<HostDeathFixtureEvent>>([])
  if (host.child.stdout === null) return yield* Effect.die("host stdout pipe is missing")
  const reader = createInterface({ input: host.child.stdout })
  reader.on("line", (line) => {
    Queue.offerUnsafe(lines, line)
  })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      reader.close()
    })
  )
  yield* Effect.gen(function* () {
    for (;;) {
      const event = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(HostDeathFixtureEvent))(
        yield* Queue.take(lines)
      )
      yield* Ref.update(log, (all) => [...all, event])
      yield* Queue.offer(events, event)
    }
  }).pipe(Effect.forkScoped)
  const take = <T extends HostDeathFixtureEvent["_tag"]>(tag: T) =>
    Effect.gen(function* () {
      for (;;) {
        const event = yield* Queue.take(events)
        if (event._tag === tag) return event
      }
    }).pipe(
      Effect.timeout("20 seconds"),
      Effect.catchTag("TimeoutError", () =>
        host.stderr.pipe(Effect.flatMap((stderr) => Effect.die(`host did not reach ${tag}: ${stderr}`)))
      )
    )
  return {
    ...host,
    events,
    log,
    take,
    send: (command: "Pause" | "Arm" | "History") =>
      Effect.sync(() => {
        host.child.send(command)
      })
  }
})

export const startDeathClient = Effect.fn("HostDeathTest.startClient")(function* (
  entry: string,
  adapter: "CLI" | "MCP",
  address: LocalHostAddress,
  runId: RunId,
  custody: Ref.Ref<boolean>,
  operation: "unpause" | "control" | "snapshot" = "unpause"
) {
  const client = yield* start(
    entry,
    adapter === "CLI"
      ? ["attach", operation, "--host", address, "--run", runId, "--json"]
      : ["mcp", "--host", address, "--run", runId],
    custody
  )
  let handshakeFailure: Extract<typeof McpHandshakeReply.Type, { readonly error: unknown }> | undefined
  if (adapter === "MCP") {
    if (client.child.stdout === null || client.child.stdin === null) return yield* Effect.die("MCP pipes missing")
    const lines = yield* Queue.unbounded<string>()
    const reader = createInterface({ input: client.child.stdout })
    reader.on("line", (line) => Queue.offerUnsafe(lines, line))
    yield* Effect.addFinalizer(() => Effect.sync(() => reader.close()))
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "death", version: "1" } }
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: { unpause: "dalph_unpause", control: "dalph_read_run_control", snapshot: "dalph_read_snapshot" }[
            operation
          ],
          arguments: { runId }
        }
      }
    ]
    client.child.stdin.write(JSON.stringify(messages[0]) + "\n")
    const handshake = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(McpHandshakeReply))(
      yield* Queue.take(lines).pipe(Effect.timeout("15 seconds"))
    )
    if ("error" in handshake) {
      handshakeFailure = handshake
      client.child.stdin.end()
    } else {
      client.child.stdin.end(
        messages
          .slice(1)
          .map((message) => JSON.stringify(message))
          .join("\n") + "\n"
      )
    }
  }
  return {
    ...client,
    reply: Fiber.join(client.closed).pipe(
      Effect.timeout("15 seconds"),
      Effect.andThen(client.stdout),
      Effect.flatMap((stdout) =>
        Effect.gen(function* () {
          if (handshakeFailure !== undefined) return handshakeFailure
          if (adapter === "CLI")
            return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RunningHostEnvelope))(stdout.trim())
          const message = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Struct({ result: Schema.Struct({ structuredContent: RunningHostEnvelope }) }))
          )(stdout.trim().split("\n").at(lastReplyOffset))
          return message.result.structuredContent
        })
      )
    )
  }
})
