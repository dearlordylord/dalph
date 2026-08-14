/* eslint-disable import/no-nodejs-modules -- this test launches only a local protocol fixture, never OpenAI. */
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Exit, FileSystem, Layer, Path } from "effect"
import { expect } from "vitest"
import {
  CodexAppServer,
  codexAppServerLayer,
  codexAppServerNodeLayer,
  controlledCodexProcessOwnershipLayer
} from "./codex-app-server.js"
import { CodexServerIncarnation, CodexServerLaunchRecord, memoryCodexAttemptStoreLayer } from "./codex-attempt-store.js"

const fakeServer = String.raw`#!/usr/bin/env node
let buffer = ""
let thread = { id: "fixture-thread", cwd: "/unset", status: "idle", turns: [] }
const write = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
const onMessage = (message) => {
  if (message.method === "initialized") return
  if (message.method === "initialize") return write(message.id, {})
  if (message.method === "thread/start") {
    thread = { ...thread, cwd: message.params.cwd, status: "idle", turns: [] }
    return write(message.id, { thread })
  }
  if (message.method === "thread/read" || message.method === "thread/resume") return write(message.id, { thread })
  if (message.method === "turn/start") {
    const turn = { id: "fixture-turn", status: "completed", items: [{ type: "agentMessage", text: "fixture" }] }
    thread = { ...thread, cwd: message.params.cwd, status: "idle", turns: [turn] }
    return write(message.id, { turn })
  }
  if (message.method === "turn/interrupt") return write(message.id, {})
  if (message.method === "thread/backgroundTerminals/list") return write(message.id, { data: [] })
  if (message.method === "thread/backgroundTerminals/terminate") return write(message.id, { terminated: true })
  return write(message.id, {})
}
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n")
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() !== "") onMessage(JSON.parse(line))
  }
})
`

it.effect("speaks the normalized app-server protocol with exact per-call cwd", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)

      const appLayer = codexAppServerNodeLayer({ executable }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()))
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        const thread = yield* app.startThread("/exact/worktree")
        expect(thread.cwd).toBe("/exact/worktree")
        const turn = yield* app.startTurn(thread.id, "/exact/worktree", "turn text")
        expect(turn.status).toBe("completed")
        expect((yield* app.listBackgroundTerminals(thread.id)).length).toBe(0)
        yield* app.close
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer))
      expect(result).toBeUndefined()
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reconciles a surviving prior server incarnation before launching a replacement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-gate-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const prior = CodexServerLaunchRecord.make({
        command: [executable, "app-server"],
        incarnation: CodexServerIncarnation.make("prior-incarnation"),
        phase: "Live",
        pid: 31337
      })
      const observations: Array<string> = []
      let stopped = false
      let observationsAfterStop = 0
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: () =>
              Effect.sync(() => {
                if (stopped) observationsAfterStop += 1
                const isAbsent = stopped && observationsAfterStop >= 2
                observations.push(isAbsent ? "Absent" : "ExactLive")
                return isAbsent ? { _tag: "Absent" as const } : { _tag: "ExactLive" as const, pid: 31337 }
              }),
            stop: () =>
              Effect.sync(() => {
                stopped = true
              })
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.close
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
      expect(observations).toEqual(["ExactLive", "ExactLive", "Absent"])
      expect(stopped).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
