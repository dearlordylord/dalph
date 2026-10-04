import { NodeServices } from "@effect/platform-node"
import type { RunId } from "@dalph/contracts"
import { Deferred, Effect, Fiber, Layer, Queue, Ref, Schema, Stream } from "effect"
import { Command } from "effect/unstable/cli"
import { makeRunningHostCommands, RunningHostCliOutput } from "../src/application/running-host-cli.js"
import { runRunningHostMcp } from "../src/application/running-host-mcp.js"
import {
  type LocalHostAddress,
  RunningHostWatchFrame,
  RunningHostEnvelope
} from "../src/application/running-host-contract.js"

/** Public adapter projections over an actual production host transport. */
export const attachWatchAdapters = Effect.fn("RunningHostTest.attachAdapters")(function* (
  address: LocalHostAddress,
  runId: RunId
) {
  const cliFirst = yield* Deferred.make<void>()
  const cliFrames = yield* Ref.make<ReadonlyArray<RunningHostWatchFrame>>([])
  const output = Layer.succeed(RunningHostCliOutput, {
    writeLine: (text: string) =>
      Schema.decodeUnknownEffect(RunningHostWatchFrame)(JSON.parse(text)).pipe(
        Effect.orDie,
        Effect.flatMap((frame) => Ref.update(cliFrames, (values) => [...values, frame])),
        Effect.andThen(Deferred.succeed(cliFirst, undefined)),
        Effect.asVoid
      )
  })
  const cli = yield* Command.runWith(
    Command.make("dalph").pipe(
      Command.withSubcommands(
        makeRunningHostCommands(
          () => Effect.die("watch cannot create a host"),
          {
            addSignalListener: () => Effect.die("watch cannot install host signals"),
            removeSignalListener: () => Effect.die("watch cannot own host signals")
          },
          output
        )
      )
    ),
    { version: "test" }
  )(["attach", "watch", "--host", address, "--run", runId, "--json"]).pipe(
    Effect.provide(NodeServices.layer),
    Effect.exit,
    Effect.forkChild
  )
  yield* Deferred.await(cliFirst)
  const input = yield* Queue.unbounded<Uint8Array>()
  const replies = yield* Queue.unbounded<unknown>()
  const notifications = yield* Ref.make(0)
  const mcp = yield* runRunningHostMcp(address, runId, {
    input: Stream.fromQueue(input),
    write: (line) =>
      line.includes('"notifications/resources/updated"')
        ? Ref.update(notifications, (count) => count + 1)
        : Queue.offer(replies, JSON.parse(line)).pipe(Effect.asVoid)
  }).pipe(Effect.exit, Effect.forkChild)
  const send = (message: unknown) => Queue.offer(input, new TextEncoder().encode(JSON.stringify(message) + "\n"))
  yield* send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "shutdown-test", version: "1" } }
  })
  yield* Queue.take(replies)
  yield* send({ jsonrpc: "2.0", method: "notifications/initialized" })
  yield* send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "dalph_watch_snapshots", arguments: { runId } }
  })
  const openedReply = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ result: Schema.Struct({ structuredContent: RunningHostEnvelope }) })
  )(yield* Queue.take(replies)).pipe(Effect.orDie)
  const opened = openedReply.result.structuredContent.result
  if (opened._tag !== "Success" || opened.value._tag !== "WatchOpened") return yield* Effect.die("watch failed to open")
  const uri = opened.value.uri
  yield* send({ jsonrpc: "2.0", id: 3, method: "resources/subscribe", params: { uri } })
  yield* Queue.take(replies)
  const lastSetupRequest = 3
  let request = lastSetupRequest
  const read = Effect.fn("RunningHostTest.readWatch")(function* () {
    request += 1
    yield* send({ jsonrpc: "2.0", id: request, method: "resources/read", params: { uri } })
    const reply = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ result: Schema.Struct({ contents: Schema.Array(Schema.Struct({ text: Schema.String })) }) })
    )(yield* Queue.take(replies)).pipe(Effect.orDie)
    return yield* Schema.decodeUnknownEffect(RunningHostWatchFrame)(
      JSON.parse(reply.result.contents[0]?.text ?? "null")
    ).pipe(Effect.orDie)
  })
  const initial = yield* read()
  const readTerminal = Effect.fn("RunningHostTest.readTerminal")(function* () {
    for (;;) {
      const frame = yield* read()
      if (frame.frame._tag === "Failure" || frame.frame.value._tag === "Closed") return frame
      yield* Effect.sleep("5 millis")
    }
  })
  return { cli, cliFrames, initial, readTerminal, notifications, stop: Fiber.interrupt(mcp).pipe(Effect.asVoid) }
})
