/* eslint-disable import/no-nodejs-modules -- this test launches only local protocol fixtures. */
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, FileSystem, Layer, Option, Path } from "effect"
import { expect } from "vitest"
import {
  CodexAppServer,
  CodexAppServerFailure,
  type CodexAppServerService,
  codexAppServerNodeLayer
} from "./codex-app-server.js"
import { CodexOwnedTurnToken, memoryCodexAttemptStoreLayer } from "./codex-attempt-store.js"

const protocolFixture = String.raw`#!/usr/bin/env node
const path = require("node:path")
let buffer = ""
let requestNumber = 0
const mode = path.basename(process.argv[1])
const validThread = {
  id: "protocol-thread",
  cwd: "/fixture/worktree",
  status: "idle",
  turns: []
}
const validTurn = {
  id: "protocol-turn",
  status: "completed",
  items: [
    { type: "userMessage", content: [{ type: "input_text", text: "work" }] },
    { type: "agentMessage", text: "done" }
  ]
}
const write = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
const writeError = (id) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "fixture failure" } }) + "\n")
const responseFor = (method) => {
  if (mode === "initialize-rpc-error" && method === "initialize") return { error: true }
  if (mode === "initialize-family-contradiction" && method === "initialize") {
    return { userAgent: "fixture-codex/protocol", codexHome: "/tmp/fixture-codex", platformFamily: "windows", platformOs: "linux" }
  }
  if (mode === "rpc-error" && method === "thread/start") return { error: true }
  if (mode === "response-not-object" && method === "thread/start") return "not-an-object"
  if (mode === "missing-thread" && method === "thread/start") return {}
  if (mode === "invalid-thread-fields" && method === "thread/start") {
    return { thread: { id: "", cwd: "", status: "unknown", turns: [] } }
  }
  if (mode === "thread-turns-not-array" && method === "thread/start") {
    return { thread: { ...validThread, turns: {} } }
  }
  if (mode === "invalid-turn" && method === "thread/start") {
    return { thread: { ...validThread, turns: [null] } }
  }
  if (mode === "invalid-turn-fields" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ id: "", status: "unknown", items: [] }] } }
  }
  if (mode === "invalid-turn-items" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, items: {} }] } }
  }
  if (mode === "invalid-turn-correlation" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, correlation: { runId: "run" } }] } }
  }
  if (mode === "invalid-turn-token" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, ownedTurnToken: 42 }] } }
  }
  if (mode === "duplicate-turn-marker" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [
          {
            ...validTurn,
            input: [{ type: "text", text: "<!-- dalph-owned-turn-token:v1:one --> <!-- dalph-owned-turn-token:v1:two -->" }]
          }
        ]
      }
    }
  }
  if (mode === "contradictory-turn-token" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{ ...validTurn, ownedTurnToken: "metadata", input: [{ type: "text", text: "<!-- dalph-owned-turn-token:v1:marker -->" }] }]
      }
    }
  }
  if (mode === "status-object" && method === "thread/start") {
    return { thread: { ...validThread, status: { type: "idle" } } }
  }
  if (mode === "invalid-thread-correlation" && method === "thread/start") {
    return { thread: { ...validThread, correlation: { runId: "run" } } }
  }
  if (mode === "turn-start-invalid-response" && method === "turn/start") return { turn: null }
  if (mode === "turn-start-invalid-status" && method === "turn/start") {
    return { turn: { ...validTurn, status: "unknown" } }
  }
  if (mode === "turn-start-invalid-items" && method === "turn/start") {
    return { turn: { ...validTurn, items: {} } }
  }
  if (mode === "turn-start-token-mismatch" && method === "turn/start") {
    return { turn: { ...validTurn, ownedTurnToken: "different" } }
  }
  if (mode === "turn-start-marker-token" && method === "turn/start") {
    return {
      turn: {
        ...validTurn,
        items: [
          {
            type: "userMessage",
            content: [{ type: "input_text", text: "<!-- dalph-owned-turn-token:v1:wire-token -->" }]
          }
        ]
      }
    }
  }
  if (mode === "turn-start-direct-token" && method === "turn/start") {
    return { turn: { ...validTurn, ownedTurnToken: "wire-token" } }
  }
  if (mode === "turn-start-correlation" && method === "turn/start") {
    return { turn: { ...validTurn, correlation: { runId: "run:protocol", attemptId: "attempt:protocol" } } }
  }
  if (mode === "background-not-array" && method === "thread/backgroundTerminals/list") return { data: {} }
  if (mode === "background-invalid-item" && method === "thread/backgroundTerminals/list") return { data: [null] }
  if (mode === "background-invalid-identity" && method === "thread/backgroundTerminals/list") {
    return { data: [{ processId: "p", itemId: "i", command: "echo", cwd: "" }] }
  }
  if (mode === "background-invalid-pid" && method === "thread/backgroundTerminals/list") {
    return { data: [{ processId: "p", itemId: "i", command: "echo", cwd: "/fixture", osPid: -1 }] }
  }
  if (mode === "background-valid-null-pid" && method === "thread/backgroundTerminals/list") {
    return { data: [{ processId: "p", itemId: "i", command: "echo", cwd: "/fixture", osPid: null }] }
  }
  if (mode === "terminate-invalid" && method === "thread/backgroundTerminals/terminate") return { terminated: "yes" }
  if (mode === "malformed-json" && method === "thread/start") return "__MALFORMED__"
  return method === "initialize"
    ? { userAgent: "fixture-codex/protocol", codexHome: "/tmp/fixture-codex", platformFamily: "unix", platformOs: "linux" }
    : method === "thread/start" || method === "thread/read" || method === "thread/resume"
      ? { thread: validThread }
      : method === "turn/start"
        ? { turn: validTurn }
        : method === "thread/backgroundTerminals/list"
          ? { data: [] }
          : method === "thread/backgroundTerminals/terminate"
            ? { terminated: true }
            : {}
}
const onMessage = (message) => {
  if (message.method === "initialized") return
  requestNumber += 1
  if (mode === "stderr-noise" && requestNumber === 1) process.stderr.write("diagnostic-only\n")
  if (mode === "blank-line" && requestNumber === 1) process.stdout.write("\n")
  if (mode === "non-number-response-id" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: "bad", result: {} }) + "\n")
    return
  }
  if (mode === "unknown-response-id" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} }) + "\n")
  }
  if (mode === "no-id-response" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "fixture/notice" }) + "\n")
  }
  if (mode === "malformed-json" && message.method === "thread/start") {
    process.stdout.write("not-json\n")
    return
  }
  const response = responseFor(message.method)
  if (response && response.error) return writeError(message.id)
  if (mode === "close-after-initialize" && message.method === "initialize") {
    write(message.id, response)
    return setTimeout(() => process.exit(0), 10)
  }
  return write(message.id, response)
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

const expectAppFailure = (exit: Exit.Exit<unknown, unknown>, operation: string): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = Cause.findErrorOption(exit.cause)
    expect(Option.isSome(failure)).toBe(true)
    if (Option.isSome(failure)) {
      expect(failure.value).toBeInstanceOf(CodexAppServerFailure)
      if (failure.value instanceof CodexAppServerFailure) expect(failure.value.operation).toBe(operation)
    }
  }
}

const withFixture = <A>(mode: string, action: (app: CodexAppServerService) => Effect.Effect<A, unknown>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-protocol-${mode}-` })
      const executable = path.join(root, mode)
      yield* fileSystem.writeFileString(executable, protocolFixture)
      yield* fileSystem.chmod(executable, 0o755)
      const layer = codexAppServerNodeLayer({ executable }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()))
      return yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        return yield* action(app).pipe(Effect.ensuring(app.close.pipe(Effect.orDie)))
      }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer))
    }).pipe(Effect.provide(NodeServices.layer))
  )

it.effect("maps malformed thread and turn state to typed protocol failures", () =>
  Effect.forEach(
    [
      ["response-not-object", "thread/start"],
      ["missing-thread", "thread/start"],
      ["invalid-thread-fields", "thread/start"],
      ["thread-turns-not-array", "thread/start"],
      ["invalid-turn", "thread/start"],
      ["invalid-turn-fields", "thread/start"],
      ["invalid-turn-items", "thread/start"],
      ["invalid-turn-correlation", "thread/start"],
      ["invalid-turn-token", "thread/start"],
      ["duplicate-turn-marker", "thread/start"],
      ["contradictory-turn-token", "thread/start"],
      ["invalid-thread-correlation", "thread/start"]
    ] as const,
    ([mode, operation]) =>
      withFixture(mode, (app) =>
        Effect.exit(app.startThread("/fixture/worktree")).pipe(
          Effect.tap((exit) => Effect.sync(() => expectAppFailure(exit, operation)))
        )
      )
  )
)

it.effect("reconciles valid turn markers, metadata, status, and correlation through public reads", () =>
  Effect.gen(function* () {
    const direct = yield* withFixture("turn-start-direct-token", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        const turn = yield* app.startTurn(
          thread.id,
          "/fixture/worktree",
          "work",
          CodexOwnedTurnToken.make("wire-token")
        )
        expect(turn.ownedTurnToken).toBe("wire-token")
        return turn.status
      })
    )
    expect(direct).toBe("completed")

    const marker = yield* withFixture("turn-start-marker-token", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        const turn = yield* app.startTurn(
          thread.id,
          "/fixture/worktree",
          "work",
          CodexOwnedTurnToken.make("wire-token")
        )
        expect(turn.ownedTurnToken).toBe("wire-token")
        return turn.status
      })
    )
    expect(marker).toBe("completed")

    const correlation = yield* withFixture("turn-start-correlation", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        const turn = yield* app.startTurn(thread.id, "/fixture/worktree", "work")
        expect(turn.correlation?.runId).toBe("run:protocol")
        return turn.correlation?.attemptId
      })
    )
    expect(correlation).toBe("attempt:protocol")

    const status = yield* withFixture("status-object", (app) =>
      Effect.map(app.startThread("/fixture/worktree"), (thread) => thread.status)
    )
    expect(status).toBe("idle")
  })
)

it.effect("rejects invalid turn-start responses and preserves the requested token boundary", () =>
  Effect.forEach(
    [
      ["turn-start-invalid-response", "turn/start"],
      ["turn-start-invalid-status", "turn/start"],
      ["turn-start-invalid-items", "turn/start"],
      ["turn-start-token-mismatch", "turn/start"]
    ] as const,
    ([mode, operation]) =>
      withFixture(mode, (app) =>
        Effect.gen(function* () {
          const thread = yield* app.startThread("/fixture/worktree")
          const result = yield* Effect.exit(
            app.startTurn(thread.id, "/fixture/worktree", "work", CodexOwnedTurnToken.make("wire-token"))
          )
          expectAppFailure(result, operation)
        })
      )
  )
)

it.effect("normalizes background terminal observations and rejects unsafe terminal controls", () =>
  Effect.gen(function* () {
    const valid = yield* withFixture("background-valid-null-pid", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        const terminals = yield* app.listBackgroundTerminals(thread.id)
        expect(terminals).toEqual([{ processId: "p", itemId: "i", command: "echo", cwd: "/fixture", osPid: null }])
        return yield* app.terminateBackgroundTerminal(thread.id, "p")
      })
    )
    expect(valid).toBe(true)

    for (const mode of [
      "background-not-array",
      "background-invalid-item",
      "background-invalid-identity",
      "background-invalid-pid"
    ] as const) {
      const result = yield* withFixture(mode, (app) =>
        Effect.gen(function* () {
          const thread = yield* app.startThread("/fixture/worktree")
          return yield* Effect.exit(app.listBackgroundTerminals(thread.id))
        })
      )
      expectAppFailure(result, "thread/backgroundTerminals/list")
    }

    const invalidTermination = yield* withFixture("terminate-invalid", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        return yield* Effect.exit(app.terminateBackgroundTerminal(thread.id, "p"))
      })
    )
    expectAppFailure(invalidTermination, "thread/backgroundTerminals/terminate")
  })
)

it.effect("classifies transport protocol errors without fabricating a thread", () =>
  Effect.forEach(
    [
      ["rpc-error", "thread/start"],
      ["malformed-json", "thread/start"],
      ["non-number-response-id", "initialize"],
      ["initialize-family-contradiction", "initialize"]
    ] as const,
    ([mode, operation]) =>
      withFixture(mode, (app) =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(app.startThread("/fixture/worktree"))
          expectAppFailure(result, operation)
        })
      )
  )
)

it.effect("ignores a response for an unknown request id before matching the real response", () =>
  withFixture("unknown-response-id", (app) =>
    Effect.map(app.startThread("/fixture/worktree"), (thread) => {
      expect(thread.id).toBe("protocol-thread")
      return thread.status
    })
  )
)

it.effect("keeps diagnostic stderr, blank lines, and notifications outside protocol state", () =>
  Effect.forEach(["stderr-noise", "blank-line", "no-id-response"] as const, (mode) =>
    withFixture(mode, (app) => Effect.map(app.startThread("/fixture/worktree"), (started) => started.id))
  )
)

it.effect("rejects a request after the transport closes and joins repeated close calls", () =>
  withFixture("happy", (app) =>
    Effect.gen(function* () {
      yield* app.close
      yield* app.close
      const afterClose = yield* Effect.exit(app.startThread("/fixture/worktree"))
      expectAppFailure(afterClose, "thread/start")
    })
  )
)

it.effect("maps an initialization RPC error to unavailable app-server behavior", () =>
  withFixture("initialize-rpc-error", (app) =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(app.startThread("/fixture/worktree"))
      expectAppFailure(result, "initialize")
    })
  )
)
